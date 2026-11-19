import mongoose from "mongoose";

const vendorAnalyticsSchema = new mongoose.Schema(
  {
    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vendor",
      required: true,
      unique: true,
    },
    store: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Store",
    },
    totalOrders: {
      type: Number,
      default: 0,
    },
    totalSales: {
      type: Number,
      default: 0,
    },
    totalGMV: {
      type: Number,
      default: 0,
    },
    totalProducts: {
      type: Number,
      default: 0,
    },
    activeProducts: {
      type: Number,
      default: 0,
    },
    uniqueCustomers: {
      type: Number,
      default: 0,
    },
    repeatCustomers: {
      type: Number,
      default: 0,
    },
    customersWhoAlsoPurchasedFromOthers: {
      type: Number,
      default: 0,
    },
    conversionRate: {
      type: Number,
      default: 0,
    },
    averageOrderValue: {
      type: Number,
      default: 0,
    },
    lastSaleDate: {
      type: Date,
    },
  },
  { timestamps: true }
);

vendorAnalyticsSchema.index({ totalGMV: 1 });

export default mongoose.model("VendorAnalytics", vendorAnalyticsSchema);
