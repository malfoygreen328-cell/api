// src/routes/recommendationRoutes.js
//
// Cross-vendor recommendations API. Public-by-design for marketplace discovery:
// the endpoints work for anonymous shoppers while still personalising for signed-in
// customers (via optionalAuth + session/anonymous id headers). Authorization is
// enforced only when recording clicks (see trackRecommendationClick).

import express from "express";
import {
  getHomepageRecommendations,
  getProductRecommendations,
  getSimilarProducts,
  getCompleteTheLook,
  getCustomersAlsoBought,
  getCartRecommendations,
  getPostPurchaseRecommendations,
  getCategoryRecommendations,
  getSearchRecommendations,
  getWishlistRecommendations,
  getRecentlyViewed,
  getTrending,
  getNewArrivals,
  getBestSellers,
  getBrandsYouMayLike,
  getSimilarBrands,
  trackRecommendationClick,
} from "../controllers/recommendationController.js";
import { optionalAuth, protect } from "../middleware/authMiddleware.js";
import { recommendationLimiter } from "../middleware/rateLimitMiddleware.js";

const router = express.Router();

router.use(recommendationLimiter);
router.use(optionalAuth);

// --- HOME / GLOBAL ---
router.get("/home", getHomepageRecommendations);
router.get("/trending", getTrending);
router.get("/new-arrivals", getNewArrivals);
router.get("/best-sellers", getBestSellers);
router.get("/brands", getBrandsYouMayLike);

// --- PRODUCT PAGE ---
router.get("/product/:productId", getProductRecommendations);
router.get("/similar/:productId", getSimilarProducts);
router.get("/complete-the-look/:productId", getCompleteTheLook);
router.get("/customers-also-bought/:productId", getCustomersAlsoBought);
router.get("/brands/similar/:productId", getSimilarBrands);

// --- CART / POST-PURCHASE ---
router.get("/cart", getCartRecommendations);
router.get("/post-purchase", getPostPurchaseRecommendations);

// --- DISCOVERY / PERSONAL ---
router.get("/category", getCategoryRecommendations);
router.get("/search", getSearchRecommendations);
router.get("/wishlist", protect, getWishlistRecommendations);
router.get("/recently-viewed", protect, getRecentlyViewed);

// --- ATTRIBUTION ---
router.post("/click/:recommendationId", optionalAuth, trackRecommendationClick);

export default router;
