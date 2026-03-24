import { loginLimiter, refundLimiter, paymentLimiter } from "../middleware/rateLimitMiddleware.js";

// Admin login
router.post("/login", loginLimiter, loginAdmin);

// Refund requests
router.post("/request/:orderId", protect, requireRole("customer"), refundLimiter, requestRefund);

// PayFast payment creation
router.post("/create", protect, paymentLimiter, createPayfastPayment);