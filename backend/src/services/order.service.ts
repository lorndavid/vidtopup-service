import mongoose from 'mongoose';
import { HTTP_STATUS, ERROR_MESSAGES, ORDER_STATUS, PAYMENT_POLL_TIMEOUT, STOCK_RETRY_MAX } from '../constants';
import { config } from '../config';
import { AppError } from '../middleware/errorHandler';
import { generateReference } from '../utils/generateReference';
import { bay2gameService } from './bay2game.service';
import { cutluyService } from './cutluy.service';
import { orderRepository } from '../repositories/OrderRepository';
import { notificationService } from './notification.service';
import { webSocketService } from './websocket.service';
import { pushNotificationService } from './pushNotification.service';
import { PromoCodeModel } from '../models/PromoCode';

export class OrderService {
  /**
   * Create a new order and generate CutLuy payment (KHQR via ABA PayWay).
   *
   * Flow:
   *   1. Create order in DB with 'awaiting_payment' status
   *   2. Call CutLuy API to create a payment and get QR string + checkout URL
   *   3. Generate QR image from the raw KHQR string
   *   4. Return payment details to the frontend
   *
   * The customer scans the QR (or opens the checkout URL) with any Cambodian
   * banking app that supports KHQR (ABA, ACLEDA, Wing, Bakong, etc.).
   * The underlying ABA PayWay payment link processes the transaction.
   */
  async createPaymentRequest(params: {
    gameCode: string;
    productCode: string;
    productName: string;
    gameName: string;
    playerId: string;
    serverId?: string;
    amount: number;
    promoCode?: string;
  }) {
    // Check database connection before proceeding
    if (mongoose.connection.readyState !== 1) {
      throw new AppError(
        'Database is not connected. Please try again in a moment.',
        HTTP_STATUS.SERVICE_UNAVAILABLE
      );
    }

    const reference = generateReference();

    // Validate and calculate promo code discount if provided
    let finalAmount = params.amount;
    let discountAmount = 0;
    let appliedPromo: string | undefined = undefined;

    if (params.promoCode && typeof params.promoCode === 'string') {
      const cleanCode = params.promoCode.trim().toUpperCase();
      const promo = await PromoCodeModel.findOne({ code: cleanCode });
      if (promo && promo.is_active) {
        const now = new Date();
        const validDates =
          (!promo.start_date || now >= new Date(promo.start_date)) &&
          (!promo.end_date || now <= new Date(promo.end_date));
        const validUsage = !promo.usage_limit || promo.used_count < promo.usage_limit;
        const validMinSpend = !promo.min_spend || params.amount >= promo.min_spend;
        const validGame =
          !promo.applicable_games?.length || promo.applicable_games.includes(params.gameCode);

        if (validDates && validUsage && validMinSpend && validGame) {
          if (promo.discount_type === 'percentage') {
            discountAmount = (params.amount * promo.discount_value) / 100;
            if (promo.max_discount_amount && discountAmount > promo.max_discount_amount) {
              discountAmount = promo.max_discount_amount;
            }
          } else {
            discountAmount = promo.discount_value;
          }
          discountAmount = Math.round(discountAmount * 100) / 100;
          if (discountAmount >= params.amount) {
            discountAmount = Math.max(0, Math.round((params.amount - 0.01) * 100) / 100);
          }
          finalAmount = Math.max(0.01, Math.round((params.amount - discountAmount) * 100) / 100);
          appliedPromo = promo.code;
        }
      }
    }

    // 1. Create the order in our DB
    const order = await orderRepository.create({
      reference,
      game_code: params.gameCode,
      product_code: params.productCode,
      product_name: params.productName,
      game_name: params.gameName,
      game_user_id: params.playerId,
      game_zone_id: params.serverId,
      amount: finalAmount,
      original_amount: params.amount,
      discount_amount: discountAmount,
      promo_code: appliedPromo,
      player_id: params.playerId,
      server_id: params.serverId,
      payment_method: 'cutluy',
      payment_status: 'pending',
      order_status: 'awaiting_payment',
    });

    // 2. Create payment on CutLuy (uses the store's ABA PayWay payment link)
    //    The payment link configured in CutLuy is:
    //      https://link.payway.com.kh/ABAPAY7a479793u
    //    This is an ABA PayWay link that accepts Bakong KHQR payments.
    const cutluyPayment = await cutluyService.createPayment({
      amount: finalAmount,
      reference_id: reference,
      metadata: {
        game_code: params.gameCode,
        product_code: params.productCode,
        product_name: params.productName,
        game_name: params.gameName,
        player_id: params.playerId,
        server_id: params.serverId,
        promo_code: appliedPromo || '',
        discount_amount: discountAmount,
      },
    });

    // 3. Store the CutLuy payment ID and checkout URL on the order
    await orderRepository.updateStatus(reference, {
      cutluy_payment_id: cutluyPayment.cutluyPaymentId,
      khqr_image: cutluyPayment.qrImage,
      khqr_data: cutluyPayment.qr_string,
      checkout_url: cutluyPayment.checkout_url,
    });

    return {
      reference: order.reference,
      amount: cutluyPayment.amount,
      khqr_image: cutluyPayment.qrImage,
      khqr_data: cutluyPayment.qr_string,
      checkout_url: cutluyPayment.checkout_url,
      cutluy_payment_id: cutluyPayment.cutluyPaymentId,
      expires_at: cutluyPayment.expires_at,
    };
  }

  /**
   * Check payment status (called by frontend polling every 3 seconds).
   *
   * Verification:
   *   1. PRIMARY: Check with CutLuy API via cutluy_payment_id
   *   2. FALLBACK: Timeout after 5 minutes → mark as failed
   *
   * CutLuy's API covers ALL Cambodian banks through the Bakong KHQR system.
   * When the customer scans and pays, CutLuy reports the payment as 'paid'.
   */
  async checkPaymentStatus(reference: string) {
    const order = await orderRepository.findByReference(reference);
    if (!order) {
      throw new AppError(ERROR_MESSAGES.ORDER_NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }

    // If already paid/processing/completed/failed, return current status immediately
    if (order.payment_status !== 'pending') {
      return {
        reference: order.reference,
        payment_status: order.payment_status,
        order_status: order.order_status,
      };
    }

    // ── 1. Try the CutLuy API check ─────────────────
    if (order.cutluy_payment_id) {
      try {
        const cutluyResult = await cutluyService.retrievePayment(order.cutluy_payment_id);

        if (cutluyService.isPaid(cutluyResult.status)) {
          const updated = await orderRepository.markPaid(reference);
          if (order.promo_code) {
            PromoCodeModel.updateOne({ code: order.promo_code }, { $inc: { used_count: 1 } }).catch(() => {});
          }

          // Notify connected clients in real-time
          webSocketService.emitPaymentStatus({
            reference,
            payment_status: 'paid',
            order_status: 'paid',
          });

          // Trigger top-up processing (non-blocking)
          this.processTopUp(reference).catch((err) =>
            console.error('Top-up processing error:', err)
          );

          return {
            reference,
            payment_status: updated?.payment_status || 'paid',
            order_status: updated?.order_status || 'paid',
          };
        }

        // CutLuy says expired/failed — mark as failed
        if (cutluyResult.status === 'expired' || cutluyResult.status === 'failed') {
          console.warn(`⏰ CutLuy payment ${cutluyResult.status} for ${reference}`);
          await orderRepository.updateStatus(reference, {
            payment_status: 'failed',
            order_status: 'failed',
          });

          return {
            reference,
            payment_status: 'failed',
            order_status: 'failed',
          };
        }

        // Still pending — but surface 'scanned' so the UI can swap the QR
        // for a "confirm in your banking app" panel (CutLuy scanned state).
        return {
          reference: order.reference,
          payment_status: cutluyResult.status === 'scanned' ? 'scanned' : order.payment_status,
          order_status: order.order_status,
        };
      } catch (error) {
        // CutLuy API check failed (network error, etc.)
        // Log it but don't fail the order — let it try again on next poll
        console.warn('⚠️  CutLuy API payment check failed:', error);
      }
    }

    // ── 2. Timeout check (elapsed ≥ 5 min → auto-fail) ────
    const elapsed = Date.now() - new Date(order.created_at).getTime();
    if (elapsed >= PAYMENT_POLL_TIMEOUT) {
      console.warn(`⏰ Payment timeout for ${reference} — marking as failed`);
      await orderRepository.updateStatus(reference, {
        payment_status: 'failed',
        order_status: 'failed',
      });

      return {
        reference,
        payment_status: 'failed',
        order_status: 'failed',
      };
    }

    // Still pending — return current status
    return {
      reference: order.reference,
      payment_status: order.payment_status,
      order_status: order.order_status,
    };
  }

  /**
   * Process top-up via Bay2Game after payment confirmed.
   *
   * If the Bay2Game API returns INSUFFICIENT_BALANCE (reseller has no stock),
   * instead of marking the order as failed, we mark it as 'awaiting_stock'.
   * The auto-retry scheduler will keep retrying until the reseller tops up
   * their Bay2Game wallet.
   *
   * This ensures: "Customer paid → money is safe with reseller → order is queued
   *                → auto-delivered when stock becomes available"
   */
  async processTopUp(reference: string) {
    const order = await orderRepository.findByReference(reference);
    if (!order) {
      throw new AppError(ERROR_MESSAGES.ORDER_NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }

    // Allow processing for both freshly paid orders AND awaiting_stock retries
    if (order.payment_status !== 'paid') {
      throw new AppError(
        ERROR_MESSAGES.PAYMENT_PENDING,
        HTTP_STATUS.UNPROCESSABLE_ENTITY
      );
    }

    await orderRepository.markProcessing(reference);

    try {
      const result = await bay2gameService.createOrder({
        productCode: order.product_code,
        gameUserId: order.player_id,
        reference: order.reference,
        gameZoneId: order.server_id || undefined,
      });

      const completedAt = result.completed_at
        ? new Date(result.completed_at)
        : new Date();

      await orderRepository.markCompleted(reference, completedAt);

      // Notify connected clients in real-time
      webSocketService.emitPaymentStatus({
        reference,
        payment_status: 'paid',
        order_status: 'completed',
      });

      // ─── Send order completion notification ───────────────────
      // We check the order's status BEFORE markProcessing changed it
      const wasAwaitingStock = order.order_status === 'awaiting_stock';

      if (wasAwaitingStock) {
        // Awaiting-stock recovery: sends "STOCK DELIVERED" alert
        notificationService.alertOrderFulfilled({
          reference: order.reference,
          game_name: order.game_name,
          product_name: order.product_name,
          player_id: order.player_id,
          server_id: order.server_id,
          amount: order.amount,
          completed_at: completedAt.toISOString(),
          was_awaiting_stock: true,
        });
      } else {
        // Normal order: sends "ORDER COMPLETED" alert for admin awareness
        notificationService.alertOrderCompleted({
          reference: order.reference,
          game_name: order.game_name,
          product_name: order.product_name,
          player_id: order.player_id,
          server_id: order.server_id,
          amount: order.amount,
          completed_at: completedAt.toISOString(),
        });
      }

      // ─── Send push notification to customer's device ──────────
      pushNotificationService.notifyOrderCompleted(
        order.reference,
        order.game_name,
        order.player_id
      ).catch(() => {});

      return {
        success: true,
        message: 'Top-up completed successfully',
        reference: order.reference,
        product_name: result.product_name,
        game_name: result.game_name,
        amount: result.amount,
        completed_at: completedAt.toISOString(),
      };
    } catch (error) {
      // ─── Graceful handling: insufficient balance ≠ permanent failure ───
      if (
        error instanceof AppError &&
        error.message === ERROR_MESSAGES.INSUFFICIENT_BALANCE
      ) {
        console.warn(
          `⚠️  Insufficient balance for order ${reference} — queuing for retry`
        );

        // Check if we've exceeded max retries
        const retryCount = order.retry_count || 0;
        if (retryCount >= STOCK_RETRY_MAX) {
          console.error(
            `❌ Order ${reference} exceeded max retries (${STOCK_RETRY_MAX}) — marking as failed`
          );
          await orderRepository.markFailed(reference);
          throw new AppError(
            'Order failed after maximum retry attempts. Please contact support.',
            HTTP_STATUS.UNPROCESSABLE_ENTITY
          );
        }

        // Mark as awaiting stock (payment received, just need balance)
        await orderRepository.markAwaitingStock(reference);

        // Notify connected clients in real-time
        webSocketService.emitPaymentStatus({
          reference,
          payment_status: 'paid',
          order_status: 'awaiting_stock',
        });

        // ─── Fire notification alerts (fire-and-forget) ───────────
        notificationService.alertAwaitingStock({
          reference: order.reference,
          game_name: order.game_name,
          product_name: order.product_name,
          player_id: order.player_id,
          server_id: order.server_id,
          amount: order.amount,
          created_at: order.created_at.toISOString(),
        });

        throw error;
      }

      // ─── Other errors: mark as failed ───
      await orderRepository.markFailed(reference);

      // Notify connected clients in real-time
      webSocketService.emitPaymentStatus({
        reference,
        payment_status: 'failed',
        order_status: 'failed',
      });

      throw error;
    }
  }

  /**
   * Retry all orders currently in 'awaiting_stock' status whose next_retry_at
   * has passed. Called by the auto-retry scheduler (see server.ts) and can also
   * be triggered manually via POST /order/:reference/retry.
   *
   * Each retry attempt uses exponential backoff:
   *   Retry 1: 30s, Retry 2: 60s, Retry 3: 120s, ..., capped at 1 hour
   */
  async retryAwaitingOrders(): Promise<{
    attempted: number;
    succeeded: number;
    still_waiting: number;
  }> {
    const orders = await orderRepository.findAwaitingStock();

    let succeeded = 0;
    let still_waiting = 0;

    await Promise.allSettled(
      orders.map(async (order) => {
        try {
          await this.processTopUp(order.reference);
          succeeded++;
        } catch {
          await orderRepository.incrementRetry(order.reference);
          still_waiting++;
        }
      })
    );

    if (orders.length > 0) {
      console.log(
        `🔄 Stock retry: ${orders.length} orders, ${succeeded} succeeded, ${still_waiting} still waiting`
      );
    }

    return {
      attempted: orders.length,
      succeeded,
      still_waiting,
    };
  }

  /**
   * Manually retry a single order that is awaiting stock.
   * Used by the reseller/admin via the API endpoint.
   */
  async retryOrder(reference: string) {
    const order = await orderRepository.findByReference(reference);
    if (!order) {
      throw new AppError(ERROR_MESSAGES.ORDER_NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }

    if (order.order_status !== 'awaiting_stock') {
      throw new AppError(
        'Order is not awaiting stock. Current status: ' + order.order_status,
        HTTP_STATUS.UNPROCESSABLE_ENTITY
      );
    }

    await orderRepository.updateStatus(reference, {
      order_status: 'paid',
    });

    return this.processTopUp(reference);
  }

  /**
   * Get order details by reference
   */
  async getOrder(reference: string) {
    const order = await orderRepository.findByReference(reference);
    if (!order) {
      throw new AppError(ERROR_MESSAGES.ORDER_NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }

    return {
      reference: order.reference,
      game_code: order.game_code,
      product_code: order.product_code,
      product_name: order.product_name,
      game_name: order.game_name,
      player_id: order.player_id,
      server_id: order.server_id,
      amount: order.amount,
      payment_method: order.payment_method,
      payment_status: order.payment_status,
      order_status: order.order_status,
      retry_count: order.retry_count || 0,
      next_retry_at: order.next_retry_at?.toISOString() || null,
      created_at: order.created_at.toISOString(),
      updated_at: order.updated_at.toISOString(),
      completed_at: order.completed_at?.toISOString() || null,
    };
  }

  /**
   * Cancel an order that is still awaiting payment.
   */
  async cancelOrder(reference: string) {
    const order = await orderRepository.findByReference(reference);
    if (!order) {
      throw new AppError(ERROR_MESSAGES.ORDER_NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }

    if (order.order_status !== ORDER_STATUS.AWAITING_PAYMENT) {
      throw new AppError(
        ERROR_MESSAGES.ORDER_ALREADY_PROCESSED,
        HTTP_STATUS.UNPROCESSABLE_ENTITY
      );
    }

    await orderRepository.markCancelled(reference);

    webSocketService.emitPaymentStatus({
      reference,
      payment_status: 'cancelled',
      order_status: 'cancelled',
    });

    return {
      success: true,
      message: 'Order cancelled successfully',
      reference,
    };
  }

  /**
   * Handle CutLuy payment webhook callback.
   *
   * CutLuy sends a POST to our webhook endpoint when:
   *   - payment.completed → payment was successful
   *   - payment.expired → QR expired unpaid
   *   - payment.failed → payment failed
   *
   * The webhook body contains the payment object with reference_id matching
   * our order reference.
   */
  async handleCutLuyWebhook(event: {
    type: string;
    data: {
      payment: {
        id: string;
        status: string;
        amount: string;
        currency: string;
        reference_id: string | null;
        approved_at: string | null;
      };
    };
  }) {
    const reference = event.data.payment.reference_id;
    if (!reference) {
      console.warn('⚠️  CutLuy webhook received without reference_id — skipping');
      return { received: true };
    }

    const order = await orderRepository.findByReference(reference);
    if (!order) {
      console.warn(`⚠️  CutLuy webhook: order ${reference} not found — skipping`);
      return { received: true };
    }

    const paymentStatus = cutluyService.mapStatus(event.data.payment.status);
    const cutluyIsPaid = cutluyService.isPaid(event.data.payment.status);

    // 'scanned' is a non-terminal hint — push it to subscribed clients so the
    // KHQR card can swap the QR for a "confirm in your banking app" panel.
    // The order in the DB stays 'pending' until the terminal event arrives.
    if (event.data.payment.status === 'scanned' && order.payment_status === 'pending') {
      console.log(`👀 CutLuy webhook: QR scanned for ${reference} — awaiting confirmation`);
      webSocketService.emitPaymentStatus({
        reference,
        payment_status: 'scanned',
        order_status: order.order_status,
      });
      return { received: true };
    }

    if (cutluyIsPaid && order.payment_status !== 'paid') {
      console.log(`✅ CutLuy webhook: payment completed for ${reference}`);
      await orderRepository.markPaid(reference);
      if (order.promo_code) {
        PromoCodeModel.updateOne({ code: order.promo_code }, { $inc: { used_count: 1 } }).catch(() => {});
      }

      webSocketService.emitPaymentStatus({
        reference,
        payment_status: 'paid',
        order_status: 'paid',
      });

      // Trigger top-up processing (non-blocking)
      this.processTopUp(reference).catch((err) =>
        console.error('Top-up processing error:', err)
      );
    } else if (paymentStatus === 'failed' && order.payment_status === 'pending') {
      console.log(`❌ CutLuy webhook: payment failed for ${reference}`);
      await orderRepository.updateStatus(reference, {
        payment_status: 'failed',
        order_status: 'failed',
      });

      webSocketService.emitPaymentStatus({
        reference,
        payment_status: 'failed',
        order_status: 'failed',
      });
    }

    return { received: true };
  }

  /**
   * Manually confirm payment for an order.
   * Used when webhook auto-verification is unavailable.
   * The admin can mark an order as paid after verifying payment in their bank app.
   */
  async manualConfirmPayment(reference: string) {
    const order = await orderRepository.findByReference(reference);
    if (!order) {
      throw new AppError(ERROR_MESSAGES.ORDER_NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }

    if (order.payment_status !== 'pending') {
      throw new AppError(
        'Order is not pending payment. Current status: ' + order.payment_status,
        HTTP_STATUS.UNPROCESSABLE_ENTITY
      );
    }

    if (order.order_status !== 'awaiting_payment') {
      throw new AppError(
        'Order is not awaiting payment. Current status: ' + order.order_status,
        HTTP_STATUS.UNPROCESSABLE_ENTITY
      );
    }

    console.log(`💡 Manual payment confirmation for ${reference}`);

    const updated = await orderRepository.markPaid(reference);

    webSocketService.emitPaymentStatus({
      reference,
      payment_status: 'paid',
      order_status: 'paid',
    });

    this.processTopUp(reference).catch((err) =>
      console.error('Top-up processing error:', err)
    );

    return {
      success: true,
      message: 'Payment confirmed manually. Top-up processing started.',
      reference,
      payment_status: updated?.payment_status || 'paid',
      order_status: updated?.order_status || 'paid',
    };
  }

  /**
   * Create order directly (after payment).
   * This is called after payment is confirmed to trigger the Bay2Game top-up.
   */
  async createOrder(params: {
    reference: string;
    gameCode: string;
    productCode: string;
    playerId: string;
    serverId?: string;
    amount: number;
  }) {
    const order = await orderRepository.findByReference(params.reference);
    if (!order) {
      throw new AppError(ERROR_MESSAGES.ORDER_NOT_FOUND, HTTP_STATUS.NOT_FOUND);
    }
    if (order.payment_status !== 'paid') {
      throw new AppError(
        ERROR_MESSAGES.PAYMENT_PENDING,
        HTTP_STATUS.UNPROCESSABLE_ENTITY
      );
    }
    return this.processTopUp(params.reference);
  }
}

export const orderService = new OrderService();
