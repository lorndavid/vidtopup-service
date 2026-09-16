import { Request, Response, NextFunction } from 'express';
import { orderService } from '../services/order.service';
import { cutluyService } from '../services/cutluy.service';
import { paymentCreateSchema } from '../validators';
import { HTTP_STATUS } from '../constants';
import { AppError } from '../middleware/errorHandler';

export async function createPayment(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const validation = paymentCreateSchema.safeParse(req.body);
    if (!validation.success) {
      throw new AppError(
        validation.error.errors.map((e) => e.message).join(', '),
        HTTP_STATUS.BAD_REQUEST
      );
    }

    const { game_code, product_code, product_name, game_name, player_id, server_id, amount, promo_code } = validation.data;
    const result = await orderService.createPaymentRequest({
      gameCode: game_code,
      productCode: product_code,
      productName: product_name,
      gameName: game_name,
      playerId: player_id,
      serverId: server_id,
      amount,
      promoCode: promo_code,
    });

    res.status(HTTP_STATUS.CREATED).json({
      success: true,
      message: 'Payment request created',
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

export async function getPaymentStatus(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { reference } = req.params;

    if (!reference) {
      throw new AppError('Reference is required', HTTP_STATUS.BAD_REQUEST);
    }

    const status = await orderService.checkPaymentStatus(reference);

    res.status(HTTP_STATUS.OK).json({
      success: true,
      message: 'Payment status retrieved',
      data: status,
    });
  } catch (error) {
    next(error);
  }
}

export async function manualConfirmPayment(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { reference } = req.params;

    if (!reference) {
      throw new AppError('Reference is required', HTTP_STATUS.BAD_REQUEST);
    }

    const result = await orderService.manualConfirmPayment(reference);

    res.status(HTTP_STATUS.OK).json({
      success: true,
      message: result.message,
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Handle CutLuy webhook for payment status updates.
 *
 * IMPORTANT: This endpoint must receive the RAW request body (not parsed JSON)
 * for webhook signature verification. The raw body parser is configured
 * in server.ts via app.use('/api/webhooks/cutluy', express.raw({ type: 'application/json' })).
 *
 * CutLuy sends:
 *   - payment.completed  → order is paid → trigger top-up
 *   - payment.expired    → QR expired unpaid
 *   - payment.failed     → payment failed
 */
export async function handleCutLuyWebhook(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // Get the raw body for signature verification
    const rawBody = (req as any).rawBody || JSON.stringify(req.body);
    const signature = req.headers['x-cutluy-signature'] as string;
    const eventType = req.headers['x-cutluy-event'] as string;

    // Verify webhook signature
    if (signature) {
      const isValid = cutluyService.verifyWebhookSignature(rawBody, signature);
      if (!isValid) {
        console.warn('⚠️  CutLuy webhook signature verification failed — rejecting');
        res.status(400).json({ error: 'invalid signature' });
        return;
      }
    }

    const event = req.body;

    if (!event || !event.type) {
      console.warn('⚠️  CutLuy webhook: invalid payload');
      res.status(400).json({ error: 'invalid payload' });
      return;
    }

    console.log(`📨 CutLuy webhook: ${event.type}`, {
      payment_id: event.data?.payment?.id,
      reference_id: event.data?.payment?.reference_id,
      status: event.data?.payment?.status,
    });

    await orderService.handleCutLuyWebhook(event);

    // Always respond 200 to acknowledge receipt
    res.status(HTTP_STATUS.OK).json({ received: true });
  } catch (error) {
    // Log but don't fail — CutLuy will retry if we send non-2xx
    console.error('❌ CutLuy webhook error:', error);
    res.status(HTTP_STATUS.OK).json({ received: true });
  }
}
