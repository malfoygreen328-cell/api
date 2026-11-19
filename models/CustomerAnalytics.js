import mongoose from "mongoose";

const customerAnalyticsSchema = new mongoose.Schema(
  {
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    totalOrders: {
      type: Number,
      default: 0,
    },
    totalSpent: {
      type: Number,
      default: 0,
    },
    averageOrderValue: {
      type: Number,
      default: 0,
    },
    firstOrderDate: {
      type: Date,
    },
    lastOrderDate: {
      type: Date,
    },
    uniqueVendors: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Vendor",
      },
    ],
    uniqueVendorCount: {
      type: Number,
      default: 0,
    },
    viewedProducts: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Product",
      },
    ],
    wishlistCount: {
      type: Number,
      default: 0,
    },
    cartItemsCount: {
      type: Number,
      default: 0,
    },
    preferredCategories: [String],
    preferredVendors: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Vendor",
      },
    ],
  },
  { timestamps: true }
);

customerAnalyticsSchema.index({ uniqueVendorCount: 1 });
customerAnalyticsSchema.index({ totalSpent: 1 });

export default mongoose.model("CustomerAnalytics", customerAnalyticsSchema);
