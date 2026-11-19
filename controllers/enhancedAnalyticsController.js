import mongoose from "mongoose";
import AnalyticsService from "../services/AnalyticsService.js";
import MarketplaceAnalytics from "../models/MarketplaceAnalytics.js";
import VendorAnalytics from "../models/VendorAnalytics.js";
import CustomerAnalytics from "../models/CustomerAnalytics.js";

export const trackEvent = async (req, res, next) => {
  try {
    const analyticsCtrl = await import("./analyticsController.js");
    return analyticsCtrl.trackEvent(req, res, next);
  } catch (error) {
    next(error);
  }
};

export const getMarketplaceAnalytics = async (req, res, next) => {
  try {
    const analytics = await AnalyticsService.generateMarketplaceAnalytics();
    res.json({ success: true, data: analytics });
  } catch (error) {
    next(error);
  }
};

export const getMarketplaceAnalyticsHistory = async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit) || 30;
    const analytics = await MarketplaceAnalytics.find()
      .sort({ date: -1 })
      .limit(limit);
    res.json({ success: true, data: analytics });
  } catch (error) {
    next(error);
  }
};

export const getCrossVendorMetrics = async (req, res, next) => {
  try {
    const metrics = await AnalyticsService.calculateCrossVendorCustomerRate();
    res.json({ success: true, data: metrics });
  } catch (error) {
    next(error);
  }
};

export const getRecommendationMetrics = async (req, res, next) => {
  try {
    const metrics = await AnalyticsService.getRecommendationMetrics();
    res.json({ success: true, data: metrics });
  } catch (error) {
    next(error);
  }
};

export const getVendorAnalytics = async (req, res, next) => {
  try {
    const { vendorId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(vendorId)) {
      return res.status(400).json({ success: false, message: "Invalid vendor id" });
    }

    const isAdmin = ["admin", "superadmin"].includes(req.user?.role);
    const isOwner = req.user?._id?.toString() === vendorId;

    if (!isAdmin && !isOwner) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }

    const analytics = await VendorAnalytics.findOne({ vendor: vendorId });
    res.json({ success: true, data: analytics });
  } catch (error) {
    next(error);
  }
};

export const getCustomerAnalytics = async (req, res, next) => {
  try {
    const customerId = req.user?._id;
    const analytics = await CustomerAnalytics.findOne({ customer: customerId });
    res.json({ success: true, data: analytics || { customer: customerId } });
  } catch (error) {
    next(error);
  }
};
