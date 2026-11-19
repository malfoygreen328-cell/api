import UserBehaviourEvent from "../models/UserBehaviourEvent.js";
import ProductView from "../models/ProductView.js";
import RecentlyViewed from "../models/RecentlyViewed.js";
import Product from "../models/Product.js";

class EventService {
  async trackEvent(eventData) {
    try {
      const {
        userId,
        sessionId,
        anonymousId,
        eventType,
        productId,
        vendorId,
        brandId,
        searchQuery,
        category,
        subcategory,
        recommendationId,
        metadata = {},
        ipAddress,
        userAgent,
      } = eventData;

      const payload = {
        user: userId || undefined,
        customer: userId || undefined,
        sessionId: sessionId || undefined,
        anonymousId: anonymousId || undefined,
        eventType,
        product: productId || undefined,
        vendor: vendorId || undefined,
        brand: brandId || undefined,
        searchQuery: searchQuery || undefined,
        category: category || undefined,
        subcategory: subcategory || undefined,
        recommendationId: recommendationId || undefined,
        metadata,
        ipAddress,
        userAgent,
      };

      const event = await UserBehaviourEvent.create(payload);

      if (eventType === "product_viewed" && productId) {
        await this.trackProductView(productId, userId, sessionId, ipAddress, userAgent);
        if (userId) {
          await this.updateRecentlyViewed(userId, productId);
        }
      }

      return event;
    } catch (error) {
      console.error("Error tracking event:", error);
      return null;
    }
  }

  async trackProductView(productId, userId, sessionId, ipAddress, userAgent) {
    try {
      await ProductView.create({
        product: productId,
        user: userId,
        sessionId,
        ipAddress,
        userAgent,
      });

      await Product.findByIdAndUpdate(productId, { $inc: { views: 1 } });
    } catch (error) {
      console.error("Error tracking product view:", error);
    }
  }

  async updateRecentlyViewed(userId, productId) {
    try {
      await RecentlyViewed.findOneAndUpdate(
        { customer: userId, product: productId },
        { viewedAt: Date.now() },
        { upsert: true }
      );

      const count = await RecentlyViewed.countDocuments({ customer: userId });
      if (count > 50) {
        const oldest = await RecentlyViewed.find({ customer: userId })
          .sort({ viewedAt: 1 })
          .limit(count - 50);
        if (oldest.length > 0) {
          const ids = oldest.map(o => o._id);
          await RecentlyViewed.deleteMany({ _id: { $in: ids } });
        }
      }
    } catch (error) {
      console.error("Error updating recently viewed:", error);
    }
  }
}

export default new EventService();
