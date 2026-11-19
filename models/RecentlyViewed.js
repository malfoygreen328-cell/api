import mongoose from "mongoose";

const recentlyViewedSchema = new mongoose.Schema(
  {
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    viewedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

recentlyViewedSchema.index({ customer: 1, viewedAt: -1 });
recentlyViewedSchema.index({ customer: 1, product: 1 }, { unique: true });

export default mongoose.model("RecentlyViewed", recentlyViewedSchema);
