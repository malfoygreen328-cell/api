import express from "express";
import Product from "../models/Product.js";
import Order from "../models/Order.js";
import RecommendationService from "../services/RecommendationService.js";
import EventService from "../services/EventService.js";
import RecommendationAttribution from "../models/RecommendationAttribution.js";
import AnalyticsService from "../services/AnalyticsService.js";

const router = express.Router();

router.post("/test-recommendations", async (req, res) => {
  try {
    const { context = "homepage", limit = 5 } = req.body;
    const results = await RecommendationService.generateRecommendations(context, {
      limit,
      customerId: req.body.customerId,
    });
    res.json({ success: true, data: results, count: results.length });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get("/test-impressions", async (req, res) => {
  try {
    const products = await RecommendationService.getTrendingRecommendations(3);
    const annotated = await RecommendationService.recordImpressions(
      "homepage",
      "trending",
      products,
      { sessionId: "test-session" }
    );
    res.json({ success: true, data: annotated });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get("/test-cross-vendor", async (req, res) => {
  try {
    const metrics = await AnalyticsService.calculateCrossVendorCustomerRate();
    res.json({ success: true, data: metrics });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get("/test-analytics", async (req, res) => {
  try {
    const metrics = await AnalyticsService.generateMarketplaceAnalytics();
    res.json({ success: true, data: metrics });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
