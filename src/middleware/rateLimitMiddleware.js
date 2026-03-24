import rateLimit from "express-rate-limit";

// Login route limiter
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // max 5 requests per IP
  message: {
    success: false,
    message: "Too many login attempts. Try again later.",
  },
});

// Refund route limiter
export const refundLimiter = rateLimit({
  windowMs: 30 * 60 * 1000, // 30 minutes
  max: 10,
  message: {
    success: false,
    message: "Too many refund requests. Try again later.",
  },
});

// Payment route limiter
export const paymentLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 20,
  message: {
    success: false,
    message: "Too many payment attempts. Try again later.",
  },
});