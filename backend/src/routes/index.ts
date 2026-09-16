import { Router } from 'express';
import { getCategories, getCambodiaGames, getProductsByGame, getPriceDropsByGame } from '../controllers/category.controller';
import { createPayment, getPaymentStatus, handleCutLuyWebhook, manualConfirmPayment } from '../controllers/payment.controller';
import { createOrder, getOrder, getOrdersByPlayer, cancelOrder, retryOrder } from '../controllers/order.controller';
import { verifyPlayer, checkGameId } from '../controllers/player.controller';
import { getBalance } from '../controllers/balance.controller';
import { receiveStockAlert, getRecentAlerts, triggerDailySummary, testNotification } from '../controllers/webhook.controller';
import { login, loginWithApiKey, verifyToken } from '../controllers/adminAuth.controller';
import {
  getOrders,
  getOrderDetail,
  updateOrderStatus,
  getDashboardStats,
} from '../controllers/adminOrders.controller';
import {
  getProducts,
  updateProductProfit,
  deleteProductOverride,
  getProfitMargins,
  saveProfitMargin,
  saveProfitMarginsBatch,
  getGames,
} from '../controllers/adminProducts.controller';
import {
  getFundingHistory,
  getBalanceAlert,
  getWebhookConfig,
  testWebhook,
  checkPlayerId,
  getDirectOrderGames,
  getDirectOrderProducts,
  createDirectOrder,
} from '../controllers/adminOperations.controller';
import { getAnalytics } from '../controllers/adminAnalytics.controller';import { trackEvent, getStats as getAnalyticsStats } from '../controllers/analytics.controller';
import { getActiveAnnouncements,
  getAllAnnouncements,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
  toggleAnnouncement,
} from '../controllers/announcement.controller';
import {
  validatePromoCode,
  getAdminPromos,
  createAdminPromo,
  updateAdminPromo,
  deleteAdminPromo,
  toggleAdminPromo,
} from '../controllers/promo.controller';
import { config } from '../config';
import { pushNotificationService } from '../services/pushNotification.service';
import {
  adminLoginLimiter,
  paymentCreateLimiter,
  playerVerifyLimiter,
  analyticsLimiter,
} from '../middleware/rateLimiter';

const router = Router();

// Categories & Products
router.get('/categories', getCategories);
router.get('/cambodia-games', getCambodiaGames);
router.get('/products/:gameCode', getProductsByGame);

// Promo codes (public validation)
router.post('/promos/validate', validatePromoCode);

// Player Verification
router.post('/verify-player', playerVerifyLimiter, verifyPlayer);
router.get('/check-id', playerVerifyLimiter, checkGameId);

// Payment (CutLuy / ABA PayWay KHQR)
router.post('/payment/create', paymentCreateLimiter, createPayment);
router.get('/payment/status/:reference', getPaymentStatus);
router.post('/payment/manual-confirm/:reference', verifyToken, manualConfirmPayment);

// CutLuy Webhook (receives payment status updates from CutLuy)
// IMPORTANT: Must use express.raw() middleware to verify signature
// This is set up in server.ts with a dedicated route
router.post('/webhooks/cutluy', handleCutLuyWebhook);

// Balance check (for customers to see if shop has stock before paying)
router.get('/balance', getBalance);

// Orders
router.post('/order', createOrder);
router.get('/order/:reference', getOrder);
router.get('/orders/player/:playerId', getOrdersByPlayer);
router.post('/order/:reference/cancel', cancelOrder);
router.post('/order/:reference/retry', retryOrder);

// Webhook (receiver for local stock alerts)
router.post('/webhook/stock-alert', receiveStockAlert);
router.get('/webhook/recent-alerts', getRecentAlerts);
router.post('/webhook/test', testNotification);
router.post('/webhook/daily-summary', triggerDailySummary);

// Push notifications
router.post('/push/subscribe', (req, res) => {
  const { endpoint, keys, userAgent } = req.body;
  if (!endpoint || !keys?.auth || !keys?.p256dh) {
    return res.status(400).json({ success: false, message: 'Invalid subscription object' });
  }
  const result = pushNotificationService.subscribe({ endpoint, keys, userAgent, createdAt: new Date() });
  res.json({ success: true, message: result.message });
});

router.post('/push/unsubscribe', (req, res) => {
  const { endpoint } = req.body;
  if (!endpoint) {
    return res.status(400).json({ success: false, message: 'Endpoint required' });
  }
  const result = pushNotificationService.unsubscribe(endpoint);
  res.json({ success: true, message: result.message });
});

router.get('/push/stats', (_req, res) => {
  const stats = pushNotificationService.getStats();
  res.json({ success: true, data: stats });
});

router.get('/push/vapid-key', (_req, res) => {
  res.json({
    success: true,
    data: { publicKey: config.push.publicKey },
  });
});

// Price drops
// Analytics (public: tracking endpoint — rate limited, unauthenticated)
router.post('/analytics/track', analyticsLimiter, trackEvent);

// Analytics (admin: aggregated stats — JWT protected)
router.get('/admin/analytics/stats', verifyToken, getAnalyticsStats);

// Announcements (public)
router.get('/announcements', getActiveAnnouncements);

// Price drops
router.get('/price-drops/:gameCode', getPriceDropsByGame);

// Config
router.get('/config/new-products', (_req, res) => {
  res.json({
    success: true,
    message: 'New products config fetched',
    data: {
      mlbb: [11, 22, 55, 112],          // Newly added MLBB diamond packages
      freefire_sgmy: [],
      freefire_global: [],
      pubgm: [],
    },
  });
});

// ─── Admin Dashboard ──────────────────────────────
// Public: login (protected by rate limiter against brute force)
router.post('/admin/login', adminLoginLimiter, login);
router.post('/admin/login/apikey', adminLoginLimiter, loginWithApiKey);

// Protected: all admin routes below require JWT
router.get('/admin/dashboard', verifyToken, getDashboardStats);
router.get('/admin/orders', verifyToken, getOrders);
router.get('/admin/orders/:reference', verifyToken, getOrderDetail);
router.post('/admin/orders/:reference/status', verifyToken, updateOrderStatus);
router.get('/admin/products', verifyToken, getProducts);
router.put('/admin/products/profit', verifyToken, updateProductProfit);
router.delete('/admin/products/override/:productCode', verifyToken, deleteProductOverride);
router.get('/admin/profit-margins', verifyToken, getProfitMargins);
router.post('/admin/profit-margins', verifyToken, saveProfitMargin);
router.post('/admin/profit-margins/batch', verifyToken, saveProfitMarginsBatch);
router.get('/admin/games', verifyToken, getGames);

// Admin analytics
router.get('/admin/analytics', verifyToken, getAnalytics);

// Admin operations (funding, balance alert, webhooks, player lookup, direct order)
router.get('/admin/funding-history', verifyToken, getFundingHistory);
router.get('/admin/balance-alert', verifyToken, getBalanceAlert);
router.get('/admin/webhooks', verifyToken, getWebhookConfig);
router.post('/admin/webhooks/test', verifyToken, testWebhook);
router.post('/admin/check-player-id', verifyToken, checkPlayerId);
router.get('/admin/direct-order/games', verifyToken, getDirectOrderGames);
router.get('/admin/direct-order/products/:gameCode', verifyToken, getDirectOrderProducts);
router.post('/admin/direct-order/create', verifyToken, createDirectOrder);

// Admin: Announcements
router.get('/admin/announcements', verifyToken, getAllAnnouncements);
router.post('/admin/announcements', verifyToken, createAnnouncement);
router.put('/admin/announcements/:id', verifyToken, updateAnnouncement);
router.delete('/admin/announcements/:id', verifyToken, deleteAnnouncement);
router.patch('/admin/announcements/:id/toggle', verifyToken, toggleAnnouncement);

// Admin: Promo Codes CMS
router.get('/admin/promos', verifyToken, getAdminPromos);
router.post('/admin/promos', verifyToken, createAdminPromo);
router.put('/admin/promos/:id', verifyToken, updateAdminPromo);
router.delete('/admin/promos/:id', verifyToken, deleteAdminPromo);
router.patch('/admin/promos/:id/toggle', verifyToken, toggleAdminPromo);

export default router;
