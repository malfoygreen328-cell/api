import mongoose from "mongoose";

const userBehaviourEventSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    sessionId: {
      type: String,
      index: true,
    },
    // Stable client-generated id that survives across a browsing session. It
    // lets anonymous behaviour be captured (privacy-first, no PII) and later
    // re-associated with a customer account after login.
    anonymousId: {
      type: String,
      index: true,
    },
    eventType: {
      type: String,
      enum: [
        "product_viewed",
        "product_searched",
        "product_added_to_cart",
        "product_removed_from_cart",
        "product_added_to_wishlist",
        "product_removed_from_wishlist",
        "product_purchased",
        "product_reviewed",
        "brand_viewed",
        "brand_followed",
        "brand_unfollowed",
        "recommendation_viewed",
        "recommendation_clicked",
        "recommendation_purchased",
      ],
      required: true,
      index: true,
    },
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
    },
    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vendor",
    },
    brand: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Store",
    },
    searchQuery: {
      type: String,
    },
    category: {
      type: String,
    },
    subcategory: {
      type: String,
    },
    recommendationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RecommendationAttribution",
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    ipAddress: {
      type: String,
    },
    userAgent: {
      type: String,
    },
  },
  { timestamps: true }
);

userBehaviourEventSchema.index({ user: 1, createdAt: -1 });
userBehaviourEventSchema.index({ anonymousId: 1, createdAt: -1 });
userBehaviourEventSchema.index({ sessionId: 1, eventType: 1, createdAt: -1 });
userBehaviourEventSchema.index({ product: 1, eventType: 1 });
userBehaviourEventSchema.index({ eventType: 1, createdAt: -1 });
userBehaviourEventSchema.index({ createdAt: 1 });

export default mongoose.model("UserBehaviourEvent", userBehaviourEventSchema);
