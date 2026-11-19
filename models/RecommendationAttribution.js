import mongoose from "mongoose";

const recommendationAttributionSchema = new mongoose.Schema(
  {
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },
    sessionId: {
      type: String,
      index: true,
    },
    anonymousId: {
      type: String,
      index: true,
    },
    sourceContext: {
      type: String,
      enum: [
        "homepage",
        "product_page",
        "cart",
        "post_purchase",
        "category_page",
        "search_page",
        "wishlist",
        "customer_profile",
      ],
      required: true,
      index: true,
    },
    sourceProduct: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
    },
    recommendedProduct: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    recommendedVendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vendor",
      required: true,
    },
    recommendationType: {
      type: String,
      enum: [
        "trending",
        "new_arrivals",
        "best_sellers",
        "recommended_for_you",
        "similar_products",
        "customers_also_bought",
        "complete_the_look",
        "shop_the_look",
        "similar_brands",
        "brands_you_may_like",
        "recently_viewed",
        "wishlist",
        "products_from_followed_brands",
        "category_collection",
        "price_based",
        "seasonal",
        "collection",
      ],
      index: true,
    },
    position: {
      type: Number,
      default: 0,
    },
    clicked: {
      type: Boolean,
      default: false,
      index: true,
    },
    clickedAt: {
      type: Date,
    },
    addedToCart: {
      type: Boolean,
      default: false,
    },
    addedToCartAt: {
      type: Date,
    },
    purchased: {
      type: Boolean,
      default: false,
      index: true,
    },
    purchasedAt: {
      type: Date,
    },
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
    },
    impressionCount: {
      type: Number,
      default: 1,
    },
  },
  { timestamps: true }
);

recommendationAttributionSchema.index({ recommendedProduct: 1 });
recommendationAttributionSchema.index({ recommendedVendor: 1, createdAt: -1 });
recommendationAttributionSchema.index({ purchased: 1, clicked: 1 });
recommendationAttributionSchema.index({ sourceContext: 1, createdAt: -1 });
// Fast lookup of a shopper's most recent impression for a product (used to
// attribute a purchase back to the recommendation that led to it).
recommendationAttributionSchema.index({ customer: 1, recommendedProduct: 1, createdAt: -1 });
recommendationAttributionSchema.index({ sessionId: 1, recommendedProduct: 1, createdAt: -1 });
recommendationAttributionSchema.index({ createdAt: 1 });

export default mongoose.model("RecommendationAttribution", recommendationAttributionSchema);
