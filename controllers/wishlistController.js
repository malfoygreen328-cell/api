import WishlistService from "../services/WishlistService.js";

export const getWishlist = async (req, res, next) => {
  try {
    const customerId = req.user?._id;
    if (!customerId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    const wishlist = await WishlistService.getWishlist(customerId);
    res.json({ success: true, data: wishlist });
  } catch (error) {
    next(error);
  }
};

export const addToWishlist = async (req, res, next) => {
  try {
    const customerId = req.user?._id;
    if (!customerId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    const { productId } = req.body;
    if (!productId) {
      return res.status(400).json({ success: false, message: "productId is required" });
    }
    const wishlist = await WishlistService.addToWishlist(customerId, productId);
    res.json({ success: true, data: wishlist });
  } catch (error) {
    next(error);
  }
};

export const removeFromWishlist = async (req, res, next) => {
  try {
    const customerId = req.user?._id;
    if (!customerId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    const { productId } = req.params;
    if (!productId) {
      return res.status(400).json({ success: false, message: "productId is required" });
    }
    const wishlist = await WishlistService.removeFromWishlist(customerId, productId);
    res.json({ success: true, data: wishlist });
  } catch (error) {
    next(error);
  }
};
