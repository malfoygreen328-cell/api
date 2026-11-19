import Wishlist from "../models/Wishlist.js";

class WishlistService {
  async getWishlist(customerId) {
    try {
      let wishlist = await Wishlist.findOne({ customer: customerId }).populate({
        path: "products.product",
        populate: {
          path: "vendor store",
        },
      });

      if (!wishlist) {
        wishlist = await Wishlist.create({ customer: customerId, products: [] });
        return wishlist;
      }

      return wishlist;
    } catch (error) {
      console.error("Error getting wishlist:", error);
      throw error;
    }
  }

  async addToWishlist(customerId, productId) {
    try {
      const wishlist = await Wishlist.findOneAndUpdate(
        { customer: customerId },
        { $addToSet: { products: { product: productId, addedAt: Date.now() } } },
        { new: true, upsert: true }
      ).populate({
        path: "products.product",
        populate: {
          path: "vendor store",
        },
      });

      return wishlist;
    } catch (error) {
      console.error("Error adding to wishlist:", error);
      throw error;
    }
  }

  async removeFromWishlist(customerId, productId) {
    try {
      const wishlist = await Wishlist.findOneAndUpdate(
        { customer: customerId },
        { $pull: { products: { product: productId } } },
        { new: true }
      ).populate({
        path: "products.product",
        populate: {
          path: "vendor store",
        },
      });

      return wishlist || { customer: customerId, products: [] };
    } catch (error) {
      console.error("Error removing from wishlist:", error);
      throw error;
    }
  }
}

export default new WishlistService();
