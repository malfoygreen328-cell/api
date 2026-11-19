import express from "express";
import {
  listBrands,
  listNewBrands,
  listEmergingBrands,
  listFeaturedBrands,
  searchBrands,
  getBrandMeta,
  getBrandBySlug,
  listBrandProducts,
  listRecentBrandProducts,
  listBrandStories,
  getBrandStoryBySlug,
  listActiveCampaigns,
} from "../controllers/brandController.js";
import {
  followBrand,
  unfollowBrand,
  getFollowedBrands,
  getFollowedFeed,
} from "../controllers/brandFollowController.js";
import { protect, optionalAuth, requireRole } from "../middleware/authMiddleware.js";

const router = express.Router();

// Static routes MUST be declared before /:slug so they are not swallowed by it.
// optionalAuth attaches the verified customer (when present) so list responses
// can include the caller's isFollowing state without requiring a login.
router.get("/", optionalAuth, listBrands);
router.get("/search", optionalAuth, searchBrands);
router.get("/new", optionalAuth, listNewBrands);
router.get("/emerging", optionalAuth, listEmergingBrands);
router.get("/featured", optionalAuth, listFeaturedBrands);
router.get("/meta", getBrandMeta);
router.get("/stories", listBrandStories);
router.get("/stories/:slug", getBrandStoryBySlug);
router.get("/products/recent", listRecentBrandProducts);
router.get("/campaigns/active", listActiveCampaigns);

// Customer follow endpoints. Identity is taken ONLY from the verified token.
router.get("/followed", protect, requireRole("customer", "user"), getFollowedBrands);
router.get("/followed/feed", protect, requireRole("customer", "user"), getFollowedFeed);

router.post(
  "/:slug/follow",
  protect,
  requireRole("customer", "user"),
  followBrand
);
router.delete(
  "/:slug/follow",
  protect,
  requireRole("customer", "user"),
  unfollowBrand
);

router.get("/:slug/products", listBrandProducts);
router.get("/:slug", optionalAuth, getBrandBySlug);

export default router;
