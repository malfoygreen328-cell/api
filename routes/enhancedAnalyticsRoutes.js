import express from "express";
import {
  getMarketplaceAnalytics,
  getMarketplaceAnalyticsHistory,
  getCrossVendorMetrics,
  getRecommendationMetrics,
  getVendorAnalytics,
  getCustomerAnalytics,
  trackEvent,
} from "../controllers/enhancedAnalyticsController.js";
import { protect, requireRole } from "../middleware/authMiddleware.js";

const router = express.Router();

import { optionalAuth } from "../middleware/authMiddleware.js";
import { eventLimiter } from "../middleware/rateLimitMiddleware.js";
router.use(eventLimiter);
router.post("/events", optionalAuth, trackEvent);
router.get("/cross-vendor", protect, requireRole("admin", "superadmin"), getCrossVendorMetrics);
router.get("/recommendations", protect, requireRole("admin", "superadmin"), getRecommendationMetrics);
router.get("/marketplace", protect, requireRole("admin", "superadmin"), getMarketplaceAnalytics);
router.get("/marketplace/history", protect, requireRole("admin", "superadmin"), getMarketplaceAnalyticsHistory);
router.get("/vendor/:vendorId", protect, getVendorAnalytics);
router.get("/customer", protect, getCustomerAnalytics);

export default router;
