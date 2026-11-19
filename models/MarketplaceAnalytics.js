import mongoose from "mongoose";

const marketplaceAnalyticsSchema = new mongoose.Schema(
  {
    date: {
      type: Date,
      required: true,
      unique: true,
      index: true,
    },
    totalCustomers: {
      type: Number,
      default: 0,
    },
    activeCustomers: {
      type: Number,
      default: 0,
    },
    repeatCustomers: {
      type: Number,
      default: 0,
    },
    totalOrders: {
      type: Number,
      default: 0,
    },
    totalGMV: {
      type: Number,
      default: 0,
    },
    averageOrderValue: {
      type: Number,
      default: 0,
    },
    averageOrdersPerCustomer: {
      type: Number,
      default: 0,
    },
    customersWithOneVendor: {
      type: Number,
      default: 0,
    },
    customersWithTwoVendors: {
      type: Number,
      default: 0,
    },
    customersWithThreePlusVendors: {
      type: Number,
      default: 0,
    },
    customersWithFivePlusVendors: {
      type: Number,
      default: 0,
    },
    crossVendorCustomers: {
      type: Number,
      default: 0,
    },
    crossVendorCustomerRate: {
      type: Number,
      default: 0,
    },
    repeatPurchaseRate: {
      type: Number,
      default: 0,
    },
    crossVendorPurchaseRate: {
      type: Number,
      default: 0,
    },
    recommendationImpressions: {
      type: Number,
      default: 0,
    },
    recommendationClicks: {
      type: Number,
      default: 0,
    },
    recommendationCTR: {
      type: Number,
      default: 0,
    },
    recommendationPurchases: {
      type: Number,
      default: 0,
    },
    recommendationConversion: {
      type: Number,
      default: 0,
    },
    recommendationAttributedGMV: {
      type: Number,
      default: 0,
    },
    totalVendors: {
      type: Number,
      default: 0,
    },
    activeVendors: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

export default mongoose.model("MarketplaceAnalytics", marketplaceAnalyticsSchema);
