// src/services/RecommendationService.js
//
// Azania Cross-Vendor Sales & Discovery Engine (deterministic core).
//
// Design goals:
//   * Relevance FIRST, vendor diversity SECOND.
//   * Only real marketplace data - no fabricated/random products.
//   * Deterministic + testable: the scoring and diversification helpers are
//     pure functions (no DB) so they can be unit-tested and later swapped for
//     an ML/vector implementation without touching the controllers.
//   * Bounded, indexed queries + short-lived caching so product pages stay fast.
//   * Recommendations are returned WITH a recommendationId so impressions,
//     clicks, add-to-cart and purchases can be attributed (see
//     recordImpressions / attributePurchase).
//
// The public entrypoint `generateRecommendations(context, options)` is the only
// thing controllers depend on; everything else is internal and replaceable.

import Product from "../models/Product.js";
import Order from "../models/Order.js";
import Wishlist from "../models/Wishlist.js";
import RecentlyViewed from "../models/RecentlyViewed.js";
import BrandFollow from "../models/BrandFollow.js";
import ProductRelationship from "../models/ProductRelationship.js";
import UserBehaviourEvent from "../models/UserBehaviourEvent.js";
import RecommendationAttribution from "../models/RecommendationAttribution.js";
import Store from "../models/Store.js";
import Vendor from "../models/Vendor.js";
import { cacheWrap } from "../utils/recommendationCache.js";

/* =========================================================
   CONSTANTS
========================================================= */

const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 40;
const CANDIDATE_MULTIPLIER = 5; // pull a wider pool, then score + diversify
const CACHE_TTL = 180; // seconds for non-personalised pools
const PURCHASE_ATTRIBUTION_WINDOW_DAYS = 30;

// Fields needed to render a marketplace product card (keeps documents small).
const PRODUCT_FIELDS =
  "name description price salePrice images category subcategory tags productType " +
  "gender color colors sizes brand rating reviewCount soldCount views stock isActive " +
  "featured trending vendor store createdAt";

// Curated relationship first, then heuristic complementary categories.
const COMPLEMENT_HINTS = {
  hoodie: ["pants", "bottoms", "shoes", "sneakers", "cap", "jacket", "accessories"],
  hoody: ["pants", "bottoms", "shoes", "sneakers", "cap", "jacket", "accessories"],
  tshirt: ["jeans", "pants", "shorts", "shoes", "cap", "accessories"],
  shirt: ["pants", "jeans", "shoes", "jacket", "accessories"],
  jacket: ["pants", "jeans", "shoes", "sneakers", "cap"],
  jeans: ["shirt", "tshirt", "shoes", "sneakers", "cap", "jacket"],
  pants: ["shirt", "tshirt", "hoodie", "shoes", "sneakers", "cap"],
  shorts: ["tshirt", "shirt", "sneakers", "cap"],
  dress: ["heels", "shoes", "jacket", "accessories", "handbag"],
  skirt: ["top", "blouse", "shoes", "accessories"],
  sneakers: ["pants", "jeans", "shorts", "tshirt", "cap"],
  shoes: ["pants", "jeans", "tshirt", "shirt", "accessories"],
  cap: ["tshirt", "hoodie", "jacket", "sneakers"],
  accessories: ["shirt", "tshirt", "hoodie", "jacket"],
};

/* =========================================================
   PURE HELPERS (unit-testable, no DB)
========================================================= */

const clamp01 = (n) => Math.max(0, Math.min(1, Number(n) || 0));

const log1p = (n) => Math.log1p(Math.max(0, Number(n) || 0));

const num = (n) => (Number.isFinite(Number(n)) ? Number(n) : 0);

const vendorIdOf = (p) => {
  if (!p) return null;
  const v = p.vendor;
  if (v && typeof v === "object" && v._id) return v._id.toString();
  if (v) return v.toString();
  const sv = p.store && typeof p.store === "object" ? p.store.vendor : null;
  if (sv && typeof sv === "object" && sv._id) return sv._id.toString();
  if (sv) return sv.toString();
  return null;
};

export const productIdOf = (p) => {
  if (!p) return null;
  if (typeof p === "string") return p;
  return (p._id || p.id || null)?.toString?.() || null;
};

/** Exponential-ish recency score in [0,1]; ~1.0 for brand-new, decays over ~30 days. */
export const freshnessScore = (createdAt, now = Date.now()) => {
  if (!createdAt) return 0.3;
  const ageDays = (now - new Date(createdAt).getTime()) / 86400000;
  if (!Number.isFinite(ageDays) || ageDays < 0) return 1;
  return 1 / (1 + ageDays / 30);
};

/** Weighted facet overlap between a candidate and a seed product. */
export const facetOverlap = (product, seed) => {
  if (!product || !seed) return 0;
  let s = 0;
  if (seed.category && product.category === seed.category) s += 2;
  if (seed.subcategory && product.subcategory === seed.subcategory) s += 1.5;
  if (seed.productType && product.productType === seed.productType) s += 1.5;
  if (seed.gender && product.gender === seed.gender) s += 1;
  if (
    seed.color &&
    (product.color === seed.color || (product.colors || []).includes(seed.color))
  ) {
    s += 0.75;
  }
  const ptags = new Set(product.tags || []);
  const overlap = (seed.tags || []).filter((t) => ptags.has(t)).length;
  s += Math.min(overlap, 3) * 0.75;
  return s;
};

/**
 * Deterministic product score. Higher = more relevant.
 *
 * @param {object} product   lean product doc
 * @param {object} ctx
 * @param {Array<object>} [ctx.seeds]              seed products for facet relevance
 * @param {Set<string>}   [ctx.preferredCategories]
 * @param {Set<string>}   [ctx.preferredVendors]
 * @param {Set<string>}   [ctx.purchasedProductIds]
 * @param {Number[]}      [ctx.referencePrices]
 */
export const scoreProduct = (product, ctx = {}) => {
  const {
    seeds = [],
    preferredCategories = new Set(),
    preferredVendors = new Set(),
    purchasedProductIds = new Set(),
    referencePrices = [],
  } = ctx;

  let score = 0;

  // --- Marketplace popularity / quality signals ---
  score += 2.0 * log1p(product.soldCount);
  score += 0.5 * log1p(product.views);
  score += 1.5 * clamp01(num(product.rating) / 5);
  score += 0.8 * log1p(product.reviewCount);
  score += 1.5 * freshnessScore(product.createdAt);
  if (product.featured) score += 0.7;
  if (product.trending) score += 0.7;

  // --- Relevance to the seeds (dominant factor) ---
  let bestOverlap = 0;
  for (const seed of seeds) {
    const o = facetOverlap(product, seed);
    if (o > bestOverlap) bestOverlap = o;
  }
  score += 1.2 * bestOverlap;

  // --- Personalisation ---
  const vendorId = vendorIdOf(product);
  if (product.category && preferredCategories.has(product.category)) score += 1.5;
  if (vendorId && preferredVendors.has(vendorId)) score += 0.8;

  // --- Price affinity (near the shopper's / seed's price band) ---
  if (referencePrices.length) {
    const sorted = [...referencePrices].filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
    if (sorted.length) {
      const median = sorted[Math.floor(sorted.length / 2)];
      const price = num(product.salePrice || product.price);
      const affinity = 1 - Math.min(1, Math.abs(price - median) / (median + 1));
      score += 1.0 * clamp01(affinity);
    }
  }

  // --- Gently demote items the shopper already bought (repeat buys are rare) ---
  const pid = productIdOf(product);
  if (pid && purchasedProductIds.has(pid)) score -= 2.5;

  return score;
};

/**
 * Prioritised round-robin across vendors: at every step the vendor whose
 * remaining best item has the highest score contributes one product. This
 * preserves relevance while guaranteeing that one vendor cannot fill the list
 * when qualified alternatives from other vendors exist.
 *
 * @param {Array<{product:object,score:number}>} scored  sorted desc by score
 * @param {number} limit
 * @param {object} [opts]
 * @param {string|null} [opts.excludeVendor] vendor to defer until the end
 */
export const applyVendorDiversity = (scored, limit, opts = {}) => {
  const { excludeVendor = null } = opts;

  const groups = new Map();
  for (const entry of scored) {
    const vid = vendorIdOf(entry.product) || "__no_vendor__";
    if (!groups.has(vid)) groups.set(vid, []);
    groups.get(vid).push(entry);
  }

  const primary = [];
  const deferred = [];
  for (const [vid, items] of groups) {
    if (excludeVendor && vid === excludeVendor) deferred.push(...items);
    else primary.push(items);
  }
  // Deferred (same vendor as the seed) still ranks by score among themselves.
  deferred.sort((a, b) => b.score - a.score);

  const result = [];
  const buckets = primary; // each bucket is already score-sorted (input order)

  while (result.length < limit && buckets.some((b) => b.length)) {
    let bestIdx = -1;
    let bestScore = -Infinity;
    for (let i = 0; i < buckets.length; i++) {
      const head = buckets[i][0];
      if (!head) continue;
      if (head.score > bestScore) {
        bestScore = head.score;
        bestIdx = i;
      }
    }
    if (bestIdx === -1) break;
    result.push(buckets[bestIdx].shift());
  }

  // Fill any remainder from the deferred (seed-vendor) items - relevance first.
  let di = 0;
  while (result.length < limit && di < deferred.length) {
    result.push(deferred[di++]);
  }

  return result.map((e) => e.product);
};

export const dedupeById = (items, excludeId = null) => {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const id = productIdOf(item);
    if (!id) continue;
    if (excludeId && id === excludeId.toString()) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(item);
  }
  return out;
};

export const normaliseLimit = (limit) => {
  const n = parseInt(limit, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
};

/* =========================================================
   SERVICE
========================================================= */

class RecommendationService {
  constructor() {
    this.defaultLimit = DEFAULT_LIMIT;
  }

  /* ---------------------------------------------------------
     ENTRYPOINT
  --------------------------------------------------------- */
  async generateRecommendations(context, options = {}) {
    const limit = normaliseLimit(options.limit);
    const { customerId, productId, productIds = [], sessionId } = options;

    try {
      switch (context) {
        case "homepage":
          return await this.getHomepageRecommendations(customerId, limit, options);
        case "product_page":
        case "similar_products":
          return await this.getSimilarProducts(productId, limit, options);
        case "complete_the_look":
        case "shop_the_look":
          return await this.getCompleteTheLook(productId, limit, options);
        case "customers_also_bought":
          return await this.getCustomersAlsoBought(productId, limit, options);
        case "cart":
          return await this.getCartRecommendations(productIds, limit, options);
        case "post_purchase":
          return await this.getPostPurchaseRecommendations(productIds, limit, options);
        case "category_page":
          return await this.getCategoryRecommendations(options.category, limit, options);
        case "search_page":
          return await this.getSearchRecommendations(options.query, limit, options);
        case "wishlist":
          return await this.getWishlistRecommendations(customerId, limit, options);
        case "recently_viewed":
          return await this.getRecentlyViewed(customerId, limit, options);
        case "brands_you_follow":
          return await this.getProductsFromFollowedBrands(customerId, limit);
        case "similar_brands":
          return await this.getSimilarBrands(productId, limit);
        case "brands_you_may_like":
          return await this.getBrandsYouMayLike(customerId, limit);
        case "new_arrivals":
          return await this.getNewArrivals(limit);
        case "best_sellers":
          return await this.getBestSellers(limit);
        case "recommended_for_you":
          return await this.getRecommendedForYou(customerId, limit);
        case "trending":
        default:
          return await this.getTrendingRecommendations(limit);
      }
    } catch (error) {
      console.error(`Recommendation error [${context}]:`, error.message);
      return this.getTrendingRecommendations(limit);
    }
  }

  /* ---------------------------------------------------------
     CANDIDATE QUERIES (bounded + indexed)
  --------------------------------------------------------- */
  baseQuery(extra = {}) {
    return { isActive: true, stock: { $gt: 0 }, ...extra };
  }

  fetchProducts(query, sort, limit) {
    return Product.find(query)
      .select(PRODUCT_FIELDS)
      .populate("store", "storeName storeSlug logo")
      .populate("vendor", "businessName")
      .sort(sort)
      .limit(limit)
      .lean();
  }

  /* ---------------------------------------------------------
     SEED / PROFILE BUILDERS
  --------------------------------------------------------- */
  async buildCustomerContext(customerId) {
    const ctx = {
      preferredCategories: new Set(),
      preferredVendors: new Set(),
      purchasedProductIds: new Set(),
      referencePrices: [],
      seeds: [],
    };
    if (!customerId) return ctx;

    const [recentOrders, viewedIds, follows, wishlist] = await Promise.all([
      Order.find({ customer: customerId, paymentStatus: "complete" })
        .sort({ createdAt: -1 })
        .limit(5)
        .select("items.product items.vendor totalAmount")
        .lean(),
      UserBehaviourEvent.find({
        $or: [{ user: customerId }, { customer: customerId }],
        eventType: "product_viewed",
        product: { $exists: true },
      })
        .sort({ createdAt: -1 })
        .limit(20)
        .distinct("product"),
      BrandFollow.find({ customer: customerId }).limit(20).lean(),
      Wishlist.findOne({ customer: customerId }).select("products.product").lean(),
    ]);

    for (const order of recentOrders) {
      for (const item of order.items || []) {
        if (item.product) ctx.purchasedProductIds.add(item.product.toString());
        if (item.vendor) ctx.preferredVendors.add(item.vendor.toString());
      }
    }

    const seedIds = new Set([...viewedIds.map(String)]);
    if (wishlist?.products) {
      for (const p of wishlist.products) if (p.product) seedIds.add(p.product.toString());
    }
    for (const f of follows) if (f.vendor) ctx.preferredVendors.add(f.vendor.toString());

    if (seedIds.size) {
      const seedProducts = await Product.find({ _id: { $in: [...seedIds].slice(0, 30) } })
        .select("category subcategory productType tags gender color colors price")
        .lean();
      for (const p of seedProducts) {
        ctx.seeds.push(p);
        if (p.category) ctx.preferredCategories.add(p.category);
        if (p.price) ctx.referencePrices.push(p.price);
      }
    }
    return ctx;
  }

  async loadSeed(productId) {
    if (!productId) return null;
    try {
      return await Product.findById(productId)
        .select("category subcategory productType tags gender color colors price vendor store name")
        .lean();
    } catch {
      return null;
    }
  }

  scoreAndDiversify(pool, ctx, limit, opts = {}) {
    const scored = dedupeById(pool)
      .map((product) => ({ product, score: scoreProduct(product, ctx) }))
      .sort((a, b) => b.score - a.score);
    return applyVendorDiversity(scored, limit, opts);
  }

  /* ---------------------------------------------------------
     CONTEXT: HOMEPAGE (personalised feed)
  --------------------------------------------------------- */
  async getHomepageRecommendations(customerId, limit = DEFAULT_LIMIT) {
    const flat = [];
    if (customerId) {
      const [recommended, recent, followed] = await Promise.all([
        this.getRecommendedForYou(customerId, Math.ceil(limit / 2)),
        this.getRecentlyViewed(customerId, 4),
        this.getProductsFromFollowedBrands(customerId, 4),
      ]);
      flat.push(...recommended, ...recent, ...followed);
    }
    if (flat.length < limit) {
      const trending = await this.getTrendingRecommendations(limit - flat.length);
      flat.push(...trending);
    }
    return dedupeById(flat).slice(0, limit);
  }

  /**
   * Structured homepage feed - dynamic, server-generated sections (never
   * hard-coded). Each section carries its own recommendationType so the
   * storefront can label and attribute it.
   */
  async getHomepageFeed(customerId, options = {}) {
    const perSection = normaliseLimit(options.perSection || 8);
    const sections = [];
    const push = (key, title, type, products) => {
      if (products && products.length) sections.push({ key, title, type, products });
    };

    const [recommended, trending, newArrivals, brandsYouFollow, recentlyViewed, brands] =
      await Promise.all([
        customerId ? this.getRecommendedForYou(customerId, perSection) : Promise.resolve([]),
        this.getTrendingRecommendations(perSection),
        this.getNewArrivals(perSection),
        customerId ? this.getProductsFromFollowedBrands(customerId, perSection) : Promise.resolve([]),
        customerId ? this.getRecentlyViewed(customerId, perSection) : Promise.resolve([]),
        this.getBrandsYouMayLike(customerId, 8),
      ]);

    push("recommended_for_you", "Recommended For You", "recommended_for_you", recommended);
    push("trending", "Trending", "trending", trending);
    push("new_arrivals", "New Arrivals", "new_arrivals", newArrivals);
    push(
      "brands_you_follow",
      "New From Brands You Follow",
      "products_from_followed_brands",
      brandsYouFollow
    );
    push("recently_viewed", "Recently Viewed", "recently_viewed", recentlyViewed);
    if (brands.length) {
      sections.push({ key: "discover_brands", title: "Discover South African Brands", type: "brands_you_may_like", brands });
    }
    return sections;
  }

  /* ---------------------------------------------------------
     CONTEXT: RECOMMENDED FOR YOU
  --------------------------------------------------------- */
  async getRecommendedForYou(customerId, limit = DEFAULT_LIMIT) {
    if (!customerId) return this.getTrendingRecommendations(limit);
    const ctx = await this.buildCustomerContext(customerId);

    const conditions = [];
    if (ctx.preferredCategories.size) {
      conditions.push({ category: { $in: [...ctx.preferredCategories] } });
    }
    if (ctx.preferredVendors.size) {
      conditions.push({ vendor: { $in: [...ctx.preferredVendors] } });
    }
    const pidList = [...ctx.purchasedProductIds];
    const query = this.baseQuery(
      conditions.length ? { $or: conditions } : {}
    );
    if (pidList.length) query._id = { $nin: pidList };

    let pool = await this.fetchProducts(
      query,
      { soldCount: -1, views: -1, createdAt: -1 },
      limit * CANDIDATE_MULTIPLIER
    );
    if (pool.length < limit) {
      const extra = await this.getTrendingRecommendations(limit);
      pool = pool.concat(extra);
    }
    return this.scoreAndDiversify(pool, ctx, limit);
  }

  /* ---------------------------------------------------------
     CONTEXT: PRODUCT PAGE / SIMILAR
  --------------------------------------------------------- */
  async getSimilarProducts(productId, limit = DEFAULT_LIMIT) {
    if (!productId) return this.getTrendingRecommendations(limit);
    const seed = await this.loadSeed(productId);
    if (!seed) return this.getTrendingRecommendations(limit);

    // Curated relationships win when an admin has defined them.
    let curated = [];
    try {
      const rels = await ProductRelationship.find({
        sourceProduct: productId,
        relationshipType: "similar",
        isActive: true,
      })
        .populate({ path: "relatedProduct", select: PRODUCT_FIELDS, populate: [{ path: "store", select: "storeName storeSlug logo" }, { path: "vendor", select: "businessName" }] })
        .limit(limit)
        .lean();
      curated = rels
        .map((r) => r.relatedProduct)
        .filter((p) => p && p.isActive && p.stock > 0);
    } catch { /* non-fatal */ }

    const conditions = [];
    if (seed.category) conditions.push({ category: seed.category });
    if (seed.subcategory) conditions.push({ subcategory: seed.subcategory });
    if (seed.productType) conditions.push({ productType: seed.productType });
    if (seed.tags?.length) conditions.push({ tags: { $in: seed.tags } });

    const pool = [
      ...curated,
      ...(await this.fetchProducts(
        this.baseQuery({
          _id: { $ne: productId },
          ...(conditions.length ? { $or: conditions } : {}),
        }),
        { soldCount: -1, views: -1, rating: -1 },
        limit * CANDIDATE_MULTIPLIER
      )),
    ];

    const ctx = {
      seeds: [seed],
      referencePrices: seed.price ? [seed.price] : [],
      preferredCategories: new Set(seed.category ? [seed.category] : []),
      preferredVendors: new Set(),
      purchasedProductIds: new Set(),
    };

    return this.scoreAndDiversify(pool, ctx, limit, {
      excludeVendor: vendorIdOf(seed),
    });
  }

  /* ---------------------------------------------------------
     CONTEXT: COMPLETE THE LOOK
  --------------------------------------------------------- */
  async getCompleteTheLook(productId, limit = DEFAULT_LIMIT) {
    if (!productId) return [];
    const seed = await this.loadSeed(productId);
    if (!seed) return [];

    // 1. Curated relationships
    try {
      const rels = await ProductRelationship.find({
        sourceProduct: productId,
        relationshipType: { $in: ["complete_the_look", "shop_the_look", "complementary"] },
        isActive: true,
      })
        .populate({ path: "relatedProduct", select: PRODUCT_FIELDS, populate: [{ path: "store", select: "storeName storeSlug logo" }, { path: "vendor", select: "businessName" }] })
        .limit(limit)
        .lean();
      const curated = rels
        .map((r) => r.relatedProduct)
        .filter((p) => p && p.isActive && p.stock > 0);
      if (curated.length >= Math.min(limit, 3)) {
        return dedupeById(curated, productId).slice(0, limit);
      }
    } catch { /* non-fatal */ }

    // 2. Heuristic: complementary product types / categories (different vendor preferred)
    const typeKey = String(seed.productType || seed.subcategory || seed.category || "").toLowerCase();
    const complements = COMPLEMENT_HINTS[typeKey] || COMPLEMENT_HINTS[(seed.category || "").toLowerCase()] || [];

    const conditions = complements.length
      ? complements.flatMap((c) => [
          { productType: c },
          { subcategory: c },
          { category: c },
          { tags: c },
        ])
      : seed.category
        ? [{ category: seed.category }]
        : [];

    let pool = conditions.length
      ? await this.fetchProducts(
          this.baseQuery({ _id: { $ne: productId }, $or: conditions }),
          { soldCount: -1, rating: -1 },
          limit * CANDIDATE_MULTIPLIER
        )
      : [];

    if (pool.length < limit) {
      const similar = await this.getSimilarProducts(productId, limit);
      pool = pool.concat(similar);
    }

    const ctx = {
      seeds: [seed],
      referencePrices: seed.price ? [seed.price] : [],
      preferredCategories: new Set(),
      preferredVendors: new Set(),
      purchasedProductIds: new Set(),
    };
    return this.scoreAndDiversify(pool, ctx, limit, { excludeVendor: vendorIdOf(seed) });
  }

  /* ---------------------------------------------------------
     CONTEXT: CUSTOMERS ALSO BOUGHT (collaborative, deterministic)
  --------------------------------------------------------- */
  async getCustomersAlsoBought(productId, limit = DEFAULT_LIMIT) {
    if (!productId) return this.getTrendingRecommendations(limit);
    try {
      const coPurchase = await Order.aggregate([
        { $match: { "items.product": productId, paymentStatus: "complete" } },
        { $unwind: "$items" },
        { $match: { "items.product": { $ne: productId } } },
        {
          $group: {
            _id: "$items.product",
            count: { $sum: "$items.quantity" },
          },
        },
        { $sort: { count: -1 } },
        { $limit: limit * CANDIDATE_MULTIPLIER },
      ]);

      const MIN_CO_PURCHASE_EVIDENCE = 2;
      const enoughData = coPurchase.length > 0 && coPurchase[0].count >= MIN_CO_PURCHASE_EVIDENCE;

      if (enoughData) {
        const ids = coPurchase.map((c) => c._id);
        const products = await Product.find(
          this.baseQuery({ _id: { $in: ids } })
        )
          .select(PRODUCT_FIELDS)
          .populate("store", "storeName storeSlug logo")
          .populate("vendor", "businessName")
          .lean();
        const order = new Map(ids.map((id, i) => [id.toString(), i]));
        products.sort(
          (a, b) => order.get(a._id.toString()) - order.get(b._id.toString())
        );
        // Co-purchase evidence is real signal; still diversify across vendors.
        const scored = products.map((product) => ({ product, score: 1 / (order.get(product._id.toString()) + 1) + scoreProduct(product, {}) / 100 }));
        scored.sort((a, b) => b.score - a.score);
        return applyVendorDiversity(scored, limit);
      }
    } catch (error) {
      console.error("customers_also_bought error:", error.message);
    }
    // Graceful fallback when transaction data is insufficient.
    return this.getSimilarProducts(productId, limit);
  }

  /* ---------------------------------------------------------
     CONTEXT: CART
  --------------------------------------------------------- */
  async getCartRecommendations(productIds = [], limit = DEFAULT_LIMIT, options = {}) {
    const ids = [...new Set((productIds || []).map(String))].filter(Boolean).slice(0, 10);
    if (!ids.length) return this.getTrendingRecommendations(limit);

    const seeds = await Product.find({ _id: { $in: ids } })
      .select("category subcategory productType tags gender color colors price vendor")
      .lean();
    if (!seeds.length) return this.getTrendingRecommendations(limit);

    const refPrices = seeds.map((s) => s.price).filter(Boolean);
    const conditions = [];
    for (const s of seeds) {
      if (s.category) conditions.push({ category: s.category });
      if (s.productType) conditions.push({ productType: s.productType });
      if (s.tags?.length) conditions.push({ tags: { $in: s.tags } });
    }

    let pool = await this.fetchProducts(
      this.baseQuery({ _id: { $nin: ids }, ...(conditions.length ? { $or: conditions } : {}) }),
      { soldCount: -1, rating: -1 },
      limit * CANDIDATE_MULTIPLIER
    );

    const ctx = {
      seeds,
      referencePrices: refPrices,
      preferredCategories: new Set(seeds.map((s) => s.category).filter(Boolean)),
      preferredVendors: new Set(),
      purchasedProductIds: new Set(),
    };
    let result = this.scoreAndDiversify(pool, ctx, limit, {
      excludeVendor: ids.length === 1 ? vendorIdOf(seeds[0]) : null,
    });
    if (result.length < limit) {
      result = dedupeById(result.concat(await this.getTrendingRecommendations(limit)), null).slice(0, limit);
    }
    return result;
  }

  /* ---------------------------------------------------------
     CONTEXT: POST-PURCHASE
  --------------------------------------------------------- */
  async getPostPurchaseRecommendations(productIds = [], limit = DEFAULT_LIMIT) {
    const ids = [...new Set((productIds || []).map(String))].filter(Boolean).slice(0, 10);
    if (!ids.length) return this.getTrendingRecommendations(limit);

    const collected = [];
    for (const id of ids.slice(0, 5)) {
      const alsoBought = await this.getCustomersAlsoBought(id, limit);
      collected.push(...alsoBought);
    }
    let result = dedupeById(collected, null).slice(0, limit);
    if (result.length < limit) {
      const cartLike = await this.getCartRecommendations(ids, limit);
      result = dedupeById([...result, ...cartLike], null).slice(0, limit);
    }
    return result;
  }

  /* ---------------------------------------------------------
     CONTEXT: CATEGORY / SEARCH
  --------------------------------------------------------- */
  async getCategoryRecommendations(category, limit = DEFAULT_LIMIT) {
    if (!category) return this.getTrendingRecommendations(limit);
    const pool = await this.fetchProducts(
      this.baseQuery({ category }),
      { soldCount: -1, views: -1, createdAt: -1 },
      limit * CANDIDATE_MULTIPLIER
    );
    return this.scoreAndDiversify(pool, { seeds: [{ category }] }, limit);
  }

  async getSearchRecommendations(query, limit = DEFAULT_LIMIT) {
    const q = String(query || "").trim().slice(0, 120);
    if (!q) return this.getTrendingRecommendations(limit);
    try {
      const pool = await Product.find(
        { $text: { $search: q }, ...this.baseQuery() },
        { score: { $meta: "textScore" } }
      )
        .select(PRODUCT_FIELDS)
        .populate("store", "storeName storeSlug logo")
        .populate("vendor", "businessName")
        .sort({ score: { $meta: "textScore" } })
        .limit(limit * CANDIDATE_MULTIPLIER)
        .lean();
      if (pool.length >= limit) return pool.slice(0, limit);
      return dedupeById(pool.concat(await this.getTrendingRecommendations(limit))).slice(0, limit);
    } catch {
      return this.getTrendingRecommendations(limit);
    }
  }

  /* ---------------------------------------------------------
     CONTEXT: WISHLIST / RECENTLY VIEWED / FOLLOWED BRANDS
  --------------------------------------------------------- */
  async getWishlistRecommendations(customerId, limit = DEFAULT_LIMIT) {
    if (!customerId) return this.getTrendingRecommendations(limit);
    const wishlist = await Wishlist.findOne({ customer: customerId })
      .select("products.product")
      .lean();
    const productIds = (wishlist?.products || []).map((p) => p.product).filter(Boolean);
    if (!productIds.length) return this.getRecommendedForYou(customerId, limit);

    const seeds = await Product.find({ _id: { $in: productIds } })
      .select("category subcategory productType tags gender color colors price vendor")
      .lean();
    const conditions = [];
    for (const s of seeds) {
      if (s.category) conditions.push({ category: s.category });
      if (s.productType) conditions.push({ productType: s.productType });
      if (s.tags?.length) conditions.push({ tags: { $in: s.tags } });
    }
    const pool = await this.fetchProducts(
      this.baseQuery({ _id: { $nin: productIds }, ...(conditions.length ? { $or: conditions } : {}) }),
      { soldCount: -1, rating: -1 },
      limit * CANDIDATE_MULTIPLIER
    );
    return this.scoreAndDiversify(pool, {
      seeds,
      referencePrices: seeds.map((s) => s.price).filter(Boolean),
      purchasedProductIds: new Set(),
    }, limit);
  }

  async getRecentlyViewed(customerId, limit = DEFAULT_LIMIT) {
    if (!customerId) return [];
    const rows = await RecentlyViewed.find({ customer: customerId })
      .sort({ viewedAt: -1 })
      .limit(limit * 2)
      .populate({ path: "product", select: PRODUCT_FIELDS, populate: [{ path: "store", select: "storeName storeSlug logo" }, { path: "vendor", select: "businessName" }] })
      .lean();
    return rows
      .map((r) => r.product)
      .filter((p) => p && p.isActive && p.stock > 0)
      .slice(0, limit);
  }

  async getProductsFromFollowedBrands(customerId, limit = DEFAULT_LIMIT) {
    if (!customerId) return [];
    const follows = await BrandFollow.find({ customer: customerId }).limit(30).lean();
    const vendorIds = follows.map((f) => f.vendor).filter(Boolean);
    if (!vendorIds.length) return [];
    return this.fetchProducts(
      this.baseQuery({ vendor: { $in: vendorIds } }),
      { createdAt: -1 },
      limit
    );
  }

  /* ---------------------------------------------------------
     CONTEXT: BRANDS (cross-vendor discovery)
  --------------------------------------------------------- */
  async getBrandsYouMayLike(customerId, limit = 8) {
    try {
      let vendorIds = [];

      if (customerId) {
        // Brands the customer already engaged with (to avoid re-suggesting).
        const [owned, follows] = await Promise.all([
          Order.distinct("items.vendor", { customer: customerId, paymentStatus: "complete" }),
          BrandFollow.find({ customer: customerId }).distinct("vendor"),
        ]);
        vendorIds = [...new Set([...owned, ...follows].map(String))];
      }

      const stores = await Store.find({})
        .select("storeName storeSlug logo description vendor")
        .sort({ createdAt: -1 })
        .limit(limit * 3)
        .lean();

      return stores
        .filter((s) => !vendorIds.includes(String(s.vendor)))
        .slice(0, limit);
    } catch (error) {
      console.error("brands_you_may_like error:", error.message);
      return [];
    }
  }

  async getSimilarBrands(productId, limit = 6) {
    try {
      const seed = await this.loadSeed(productId);
      if (!seed) return [];
      const seedVendor = vendorIdOf(seed);

      // Brands sharing the seed's category, ranked by how much they sell.
      const sameCategoryVendors = await Product.aggregate([
        { $match: { category: seed.category, isActive: true, vendor: { $ne: null } } },
        { $group: { _id: "$vendor", sold: { $sum: "$soldCount" } } },
        { $sort: { sold: -1 } },
        { $limit: limit * 3 },
      ]);

      const vendorIds = sameCategoryVendors
        .map((v) => v._id?.toString())
        .filter((id) => id && id !== seedVendor);

      if (!vendorIds.length) return [];
      const stores = await Store.find({ vendor: { $in: vendorIds } })
        .select("storeName storeSlug logo description vendor")
        .lean();
      const rank = new Map(vendorIds.map((id, i) => [id, i]));
      stores.sort((a, b) => (rank.get(String(a.vendor)) ?? 999) - (rank.get(String(b.vendor)) ?? 999));
      return stores.slice(0, limit);
    } catch (error) {
      console.error("similar_brands error:", error.message);
      return [];
    }
  }

  /* ---------------------------------------------------------
     GLOBAL POOLS (cached)
  --------------------------------------------------------- */
  async getTrendingRecommendations(limit = DEFAULT_LIMIT) {
    const l = normaliseLimit(limit);
    return cacheWrap(`rec:trending:${l}`, CACHE_TTL, () =>
      this.fetchProducts(this.baseQuery(), { soldCount: -1, views: -1, createdAt: -1 }, l)
    );
  }

  async getNewArrivals(limit = DEFAULT_LIMIT) {
    const l = normaliseLimit(limit);
    return cacheWrap(`rec:new:${l}`, 60, () =>
      this.fetchProducts(this.baseQuery(), { createdAt: -1 }, l)
    );
  }

  async getBestSellers(limit = DEFAULT_LIMIT) {
    const l = normaliseLimit(limit);
    return cacheWrap(`rec:best:${l}`, CACHE_TTL, () =>
      this.fetchProducts(this.baseQuery(), { soldCount: -1, rating: -1 }, l)
    );
  }

  /* ---------------------------------------------------------
     ATTRIBUTION
  --------------------------------------------------------- */

  /**
   * Persist an impression for every shown recommendation and return the items
   * annotated with a recommendationId. Identity is derived server-side only.
   *
   * @param {string} context   source context key
   * @param {string} type      recommendationType label
   * @param {Array}  products  lean products (may include .vendor)
   * @param {object} identity  { customerId, sessionId, anonymousId }
   */
  async recordImpressions(context, type, products, identity = {}) {
    const items = products.map((p) => ({ ...p, recommendationType: type }));
    const { customerId, sessionId, anonymousId } = identity;
    if (!customerId && !sessionId && !anonymousId) return items;
    if (!items.length) return items;

    const sourceContext = this.mapSourceContext(context);
    const docs = [];
    // `position` uniquely identifies an item within this batch, so we can map
    // inserted docs back to items even if insertMany (ordered:false) drops a
    // document on validation failure.
    items.forEach((p, index) => {
      const vendor = vendorIdOf(p);
      const pid = productIdOf(p);
      if (!pid || !vendor) return; // recommendedVendor is required
      docs.push({
        customer: customerId || undefined,
        sessionId: sessionId || undefined,
        anonymousId: anonymousId || undefined,
        sourceContext,
        sourceProduct: identity.sourceProductId || undefined,
        recommendedProduct: pid,
        recommendedVendor: vendor,
        recommendationType: type,
        position: index,
        impressionCount: 1,
      });
    });

    if (!docs.length) return items;

    try {
      const created = await RecommendationAttribution.insertMany(docs, { ordered: false });
      const byPosition = new Map(created.map((d) => [d.position, d._id.toString()]));
      items.forEach((p, index) => {
        const id = byPosition.get(index);
        if (id) p.recommendationId = id;
      });
    } catch (error) {
      console.error("recordImpressions error:", error.message);
    }
    return items;
  }

  mapSourceContext(context) {
    switch (context) {
      case "cart": return "cart";
      case "post_purchase": return "post_purchase";
      case "category_page": return "category_page";
      case "search_page": return "search_page";
      case "wishlist": return "wishlist";
      case "product_page":
      case "similar_products":
      case "complete_the_look":
      case "shop_the_look":
      case "customers_also_bought":
      case "similar_brands":
        return "product_page";
      case "customer_profile":
      case "recommended_for_you":
      case "brands_you_follow":
      case "brands_you_may_like":
        return "customer_profile";
      default:
        return "homepage";
    }
  }

  async createAttribution(data) {
    try {
      return await RecommendationAttribution.create(data);
    } catch (error) {
      console.error("createAttribution error:", error.message);
      return null;
    }
  }

  /**
   * Best-effort purchase attribution. Called after an order is paid.
   * Prefers the explicit recommendationId captured on the order line item
   * (already validated server-side at order creation); otherwise falls back to
   * the shopper's most recent clicked/impressed attribution for that product.
   */
  async attributePurchase(order) {
    if (!order || !order.customer) return 0;
    const customerId = order.customer.toString();
    let attributed = 0;
    const since = new Date(Date.now() - PURCHASE_ATTRIBUTION_WINDOW_DAYS * 86400000);

    for (const item of order.items || []) {
      const pid = item.product?.toString?.() || item.product;
      if (!pid) continue;

      let attribution = null;
      if (item.recommendationId) {
        attribution = await RecommendationAttribution.findOne({
          _id: item.recommendationId,
          customer: customerId,
          recommendedProduct: pid,
        });
      }
      if (!attribution) {
        attribution = await RecommendationAttribution.findOne({
          customer: customerId,
          recommendedProduct: pid,
          createdAt: { $gte: since },
        })
          .sort({ clicked: -1, createdAt: -1 });
      }
      if (!attribution || attribution.purchased) continue;

      attribution.purchased = true;
      attribution.purchasedAt = new Date();
      attribution.order = order._id;
      await attribution.save();
      attributed++;

      try {
        await UserBehaviourEvent.create({
          user: order.customer,
          customer: order.customer,
          eventType: "recommendation_purchased",
          product: pid,
          vendor: attribution.recommendedVendor,
          recommendationId: attribution._id,
          metadata: { orderId: order._id?.toString?.() },
        });
      } catch { /* analytics are best-effort */ }
    }
    return attributed;
  }
}

export default new RecommendationService();
