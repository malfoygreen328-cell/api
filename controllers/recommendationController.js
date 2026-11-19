// src/controllers/recommendationController.js
//
// Secure REST surface over RecommendationService.
//
// SECURITY RULES (enforced here, never in the client):
//   * Customer identity is ALWAYS derived from the verified token (req.user).
//     Query/body customerId is ignored.
//   * Anonymous shoppers may pass an x-session-id / x-anonymous-id so their
//     behaviour can still be captured (no PII) and later re-associated.
//   * Every returned recommendation is annotated with its recommendationId so
//     the impression can be attributed end-to-end.
//   * Product ids are validated before any DB access.

import mongoose from "mongoose";
import RecommendationService from "../services/RecommendationService.js";
import RecommendationAttribution from "../models/RecommendationAttribution.js";

const isObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

const parseIds = (value) => {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") return value.split(",").map((s) => s.trim()).filter(Boolean);
  return [];
};

/** Derive shopper identity from the request - token first, session second. */
const identityFrom = (req) => {
  const role = req.user?.role;
  const customerId =
    (role === "customer" || role === "user") && req.user?._id ? req.user._id : null;
  const clip = (v) => (v ? String(v).slice(0, 128) : null);
  return {
    customerId,
    sessionId: clip(req.headers["x-session-id"] || req.query.sessionId || req.body?.sessionId),
    anonymousId: clip(
      req.headers["x-anonymous-id"] || req.query.anonymousId || req.body?.anonymousId
    ),
  };
};

const validate = (res, productId) => {
  if (productId && !isObjectId(productId)) {
    res.status(400).json({ success: false, message: "Invalid product id" });
    return false;
  }
  return true;
};

const ok = (res, data) =>
  res.json({ success: true, data, count: Array.isArray(data) ? data.length : undefined });

/* =========================================================
   HOMEPAGE
========================================================= */
export const getHomepageRecommendations = async (req, res, next) => {
  try {
    const limit = req.query.limit;
    const perSection = req.query.perSection;
    const identity = identityFrom(req);
    const customerId = identity.customerId;

    const [flat, sections] = await Promise.all([
      RecommendationService.getHomepageRecommendations(customerId, limit),
      RecommendationService.getHomepageFeed(customerId, { perSection }),
    ]);

    // Attribute the flat feed as one homepage impression batch, and each
    // section separately so per-section CTR can be measured.
    const attributedFlat = await RecommendationService.recordImpressions(
      "homepage",
      "recommended_for_you",
      flat,
      identity
    );

    const attributedSections = [];
    for (const section of sections) {
      const products = await RecommendationService.recordImpressions(
        section.type === "trending" || section.type === "new_arrivals" ? "homepage" : "homepage",
        section.type,
        section.products,
        identity
      );
      attributedSections.push({ ...section, products });
    }

    res.json({ success: true, data: attributedFlat, sections: attributedSections });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
   PRODUCT PAGE (similar / complete-the-look / also-bought)
========================================================= */
export const getProductRecommendations = async (req, res, next) => {
  try {
    const { productId } = req.params;
    const type = req.query.type || "similar_products";
    if (!validate(res, productId)) return;

    const allowed = [
      "similar_products",
      "complete_the_look",
      "customers_also_bought",
      "shop_the_look",
      "product_page",
    ];
    const context = allowed.includes(type) ? type : "similar_products";

    const products = await RecommendationService.generateRecommendations(context, {
      productId,
      limit: req.query.limit,
    });
    const attributed = await RecommendationService.recordImpressions(
      context,
      type === "product_page" ? "similar_products" : type,
      products,
      { ...identityFrom(req), sourceProductId: productId }
    );
    ok(res, attributed);
  } catch (error) {
    next(error);
  }
};

export const getSimilarProducts = async (req, res, next) => {
  try {
    const { productId } = req.params;
    if (!validate(res, productId)) return;
    const products = await RecommendationService.getSimilarProducts(productId, req.query.limit);
    const attributed = await RecommendationService.recordImpressions(
      "product_page",
      "similar_products",
      products,
      { ...identityFrom(req), sourceProductId: productId }
    );
    ok(res, attributed);
  } catch (error) {
    next(error);
  }
};

export const getCompleteTheLook = async (req, res, next) => {
  try {
    const { productId } = req.params;
    if (!validate(res, productId)) return;
    const products = await RecommendationService.getCompleteTheLook(productId, req.query.limit);
    const attributed = await RecommendationService.recordImpressions(
      "product_page",
      "complete_the_look",
      products,
      { ...identityFrom(req), sourceProductId: productId }
    );
    ok(res, attributed);
  } catch (error) {
    next(error);
  }
};

export const getCustomersAlsoBought = async (req, res, next) => {
  try {
    const { productId } = req.params;
    if (!validate(res, productId)) return;
    const products = await RecommendationService.getCustomersAlsoBought(productId, req.query.limit);
    const attributed = await RecommendationService.recordImpressions(
      "product_page",
      "customers_also_bought",
      products,
      { ...identityFrom(req), sourceProductId: productId }
    );
    ok(res, attributed);
  } catch (error) {
    next(error);
  }
};

/* =========================================================
   CART / POST-PURCHASE
========================================================= */
export const getCartRecommendations = async (req, res, next) => {
  try {
    const productIds = parseIds(req.query.productIds);
    const products = await RecommendationService.getCartRecommendations(
      productIds,
      req.query.limit
    );
    const attributed = await RecommendationService.recordImpressions(
      "cart",
      "customers_also_bought",
      products,
      identityFrom(req)
    );
    ok(res, attributed);
  } catch (error) {
    next(error);
  }
};

export const getPostPurchaseRecommendations = async (req, res, next) => {
  try {
    const productIds = parseIds(req.query.productIds);
    const products = await RecommendationService.getPostPurchaseRecommendations(
      productIds,
      req.query.limit
    );
    const attributed = await RecommendationService.recordImpressions(
      "post_purchase",
      "customers_also_bought",
      products,
      identityFrom(req)
    );
    ok(res, attributed);
  } catch (error) {
    next(error);
  }
};

/* =========================================================
   CATEGORY / SEARCH
========================================================= */
export const getCategoryRecommendations = async (req, res, next) => {
  try {
    const category = String(req.query.category || "").slice(0, 80);
    const products = await RecommendationService.getCategoryRecommendations(
      category,
      req.query.limit
    );
    const attributed = await RecommendationService.recordImpressions(
      "category_page",
      "category_collection",
      products,
      identityFrom(req)
    );
    ok(res, attributed);
  } catch (error) {
    next(error);
  }
};

export const getSearchRecommendations = async (req, res, next) => {
  try {
    const products = await RecommendationService.getSearchRecommendations(
      req.query.q,
      req.query.limit
    );
    const attributed = await RecommendationService.recordImpressions(
      "search_page",
      "trending",
      products,
      identityFrom(req)
    );
    ok(res, attributed);
  } catch (error) {
    next(error);
  }
};

/* =========================================================
   PERSONAL COLLECTIONS
========================================================= */
export const getWishlistRecommendations = async (req, res, next) => {
  try {
    const { customerId } = identityFrom(req);
    if (!customerId) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }
    const products = await RecommendationService.getWishlistRecommendations(
      customerId,
      req.query.limit
    );
    const attributed = await RecommendationService.recordImpressions(
      "wishlist",
      "wishlist",
      products,
      { customerId }
    );
    ok(res, attributed);
  } catch (error) {
    next(error);
  }
};

export const getRecentlyViewed = async (req, res, next) => {
  try {
    const { customerId } = identityFrom(req);
    if (!customerId) return ok(res, []);
    const products = await RecommendationService.getRecentlyViewed(customerId, req.query.limit);
    const attributed = await RecommendationService.recordImpressions(
      "customer_profile",
      "recently_viewed",
      products,
      { customerId }
    );
    ok(res, attributed);
  } catch (error) {
    next(error);
  }
};

/* =========================================================
   GLOBAL POOLS
========================================================= */
export const getTrending = async (req, res, next) => {
  try {
    const products = await RecommendationService.getTrendingRecommendations(req.query.limit);
    const attributed = await RecommendationService.recordImpressions(
      "homepage",
      "trending",
      products,
      identityFrom(req)
    );
    ok(res, attributed);
  } catch (error) {
    next(error);
  }
};

export const getNewArrivals = async (req, res, next) => {
  try {
    const products = await RecommendationService.getNewArrivals(req.query.limit);
    const attributed = await RecommendationService.recordImpressions(
      "homepage",
      "new_arrivals",
      products,
      identityFrom(req)
    );
    ok(res, attributed);
  } catch (error) {
    next(error);
  }
};

export const getBestSellers = async (req, res, next) => {
  try {
    const products = await RecommendationService.getBestSellers(req.query.limit);
    const attributed = await RecommendationService.recordImpressions(
      "homepage",
      "best_sellers",
      products,
      identityFrom(req)
    );
    ok(res, attributed);
  } catch (error) {
    next(error);
  }
};

/* =========================================================
   BRANDS
========================================================= */
export const getBrandsYouMayLike = async (req, res, next) => {
  try {
    const { customerId } = identityFrom(req);
    const brands = await RecommendationService.getBrandsYouMayLike(customerId, req.query.limit);
    res.json({ success: true, data: brands, count: brands.length });
  } catch (error) {
    next(error);
  }
};

export const getSimilarBrands = async (req, res, next) => {
  try {
    const { productId } = req.params;
    if (!validate(res, productId)) return;
    const brands = await RecommendationService.getSimilarBrands(productId, req.query.limit);
    res.json({ success: true, data: brands, count: brands.length });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
   ATTRIBUTION: CLICK
========================================================= */
export const trackRecommendationClick = async (req, res, next) => {
  try {
    const { recommendationId } = req.params;
    if (!isObjectId(recommendationId)) {
      return res.status(400).json({ success: false, message: "Invalid recommendation id" });
    }

    const identity = identityFrom(req);
    const attribution = await RecommendationAttribution.findById(recommendationId);
    if (!attribution) {
      return res.status(404).json({ success: false, message: "Recommendation not found" });
    }

    // Object-level authorization: only the attributed shopper may record a
    // click. Anonymous impressions are matched by session/anonymous id.
    const owns =
      (identity.customerId &&
        attribution.customer &&
        attribution.customer.toString() === identity.customerId.toString()) ||
      (identity.sessionId && attribution.sessionId === identity.sessionId) ||
      (identity.anonymousId && attribution.anonymousId === identity.anonymousId);

    if (!owns) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }

    if (!attribution.clicked) {
      attribution.clicked = true;
      attribution.clickedAt = new Date();
      await attribution.save();
    }
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
};
