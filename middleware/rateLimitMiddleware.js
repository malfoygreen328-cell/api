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

// Recommendation read limiter. Generous enough for a browsing session (several
// sections per page) but bounded to protect the DB from scraping/abuse.
export const recommendationLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many recommendation requests. Please slow down.",
  },
});

// Behaviour-event limiter. Events fire frequently during browsing, so this is
// higher than the write limiters but still prevents event-flooding abuse.
export const eventLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many events. Please slow down.",
  },
});