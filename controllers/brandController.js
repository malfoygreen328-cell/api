// src/controllers/brandController.js
//
// Public brand discovery APIs. Every read path enforces approval at the
// database query level: unapproved, rejected or suspended brands are never
// returned even if a client guesses a slug.

import Store from "../models/Store.js";
import Vendor from "../models/Vendor.js";
import Product from "../models/Product.js";
import Review from "../models/Review.js";
import BrandFollow from "../models/BrandFollow.js";
import BrandStory from "../models/BrandStory.js";
import {
  DISCOVERY,
  FASHION_CATEGORIES,
  FASHION_CATEGORY_LABELS,
  PROVINCES,
  isFashionCategory,
  isProvince,
} from "../config/brandConfig.js";
import {
  capPerBrand,
  escapeRegex,
  publicBrand,
  rankBrands,
  rotationKey,
} from "../services/discoveryService.js";
import { sanitizeMultiline, sanitizeText, sanitizeUrl } from "../utils/contentSanitizer.js";
import { statsForStores } from "../services/brandStatsService.js";

const MAX_SEARCH_LENGTH = 80;

const parsePaging = (query = {}) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(48, Math.max(1, parseInt(query.limit, 10) || 12));
  return { page, limit, skip: (page - 1) * limit };
};

const approvedVendorIds = () => Vendor.find({ status: "APPROVED" }).distinct("_id");

const baseEligibleFilter = (vendorIds) => ({
  vendor: { $in: vendorIds },
  approvalStatus: "APPROVED",
  discoveryEligible: true,
});

const buildFilter = (query = {}, vendorIds = []) => {
  const filter = baseEligibleFilter(vendorIds);

  const category = String(query.category || "").trim().toLowerCase();
  if (category && category !== "all") {
    if (!isFashionCategory(category)) return { filter: null, invalid: "Invalid category" };
    filter.fashionCategories = category;
  }

  const province = String(query.province || "").trim();
  if (province) {
    if (!isProvince(province)) return { filter: null, invalid: "Invalid province" };
    filter.province = province;
  }

  const city = String(query.city || "").trim();
  if (city) {
    filter.city = new RegExp(`^${escapeRegex(city)}$`, "i");
  }

  if (String(query.featured || "") === "true") filter.featured = true;

  const search = String(query.q || query.search || "").trim().slice(0, MAX_SEARCH_LENGTH);
  if (search) {
    const rx = new RegExp(escapeRegex(search), "i");
    filter.$or = [
      { storeName: rx },
      { description: rx },
      { story: rx },
      { city: rx },
      { province: rx },
    ];
  }

  return { filter, invalid: null, search };
};

const publicProduct = (product) => {
  const images = Array.isArray(product.images) ? product.images.slice(0, 5) : [];
  return {
    id: String(product._id),
    name: sanitizeText(product.name, 160),
    description: sanitizeText(product.description, 500),
    price: Number(product.price) || 0,
    salePrice: product.salePrice !== undefined ? Number(product.salePrice) : null,
    images,
    image: images[0] || "",
    category: sanitizeText(product.category, 80),
    subcategory: sanitizeText(product.subcategory, 80),
    stock: Number(product.stock) || 0,
    isActive: Boolean(product.isActive),
    createdAt: product.createdAt,
  };
};

const respondBrandList = async (res, { stores, statsById, page, limit, total, sort, now, customerId }) => {
  let following = new Set();
  if (customerId && stores.length) {
    const rows = await BrandFollow.find({
      customer: customerId,
      store: { $in: stores.map((s) => s._id) },
    })
      .select("store")
      .lean();
    following = new Set(rows.map((row) => String(row.store)));
  }
  const brands = stores.map((store) => {
    const stats = statsById[String(store._id)] || {};
    return publicBrand(store, {
      now,
      ...stats,
      isFollowing: following.has(String(store._id)),
    });
  });
  return res.json({
    success: true,
    brands,
    page,
    limit,
    total,
    pages: Math.max(1, Math.ceil(total / limit)),
    ranking: {
      strategy: sort,
      transparent: true,
      sponsored: false,
      rotationWindowHours: DISCOVERY.rotationWindowHours,
      rotationWindow: rotationKey(now),
    },
  });
};

const listBrandsImpl = async (req, res, next, overrides = {}) => {
  try {
    const now = new Date();
    const { page, limit, skip } = parsePaging(req.query);
    const sortInput = String(overrides.sort || req.query.sort || "relevance").toLowerCase();
    const sort = ["relevance", "new", "emerging", "featured", "name"].includes(sortInput)
      ? sortInput
      : "relevance";

    const vendorIds = await approvedVendorIds();
    const built = buildFilter(req.query, vendorIds);
    if (!built.filter) {
      return await respondBrandList(res, {
        stores: [],
        statsById: {},
        page,
        limit,
        total: 0,
        sort,
        now,
        customerId: req.user?._id,
      });
    }
    const filter = built.filter;

    if (sort === "featured") filter.featured = true;

    if (sort === "new") {
      const total = await Store.countDocuments(filter);
      const stores = await Store.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean();
      const statsById = await statsForStores(stores.map((s) => s._id));
      return await respondBrandList(res, {
        stores,
        statsById,
        page,
        limit,
        total,
        sort,
        now,
        customerId: req.user?._id,
      });
    }

    if (sort === "name") {
      const total = await Store.countDocuments(filter);
      const stores = await Store.find(filter)
        .collation({ locale: "en", strength: 2 })
        .sort({ storeName: 1 })
        .skip(skip)
        .limit(limit)
        .lean();
      const statsById = await statsForStores(stores.map((s) => s._id));
      return await respondBrandList(res, {
        stores,
        statsById,
        page,
        limit,
        total,
        sort,
        now,
        customerId: req.user?._id,
      });
    }

    // Ranked feeds (relevance / emerging / featured-with-rotation) need stats
    // and computed scores. Candidate count is bounded so payloads stay fast.
    const candidates = await Store.find(filter)
      .sort({ createdAt: -1 })
      .limit(DISCOVERY.maxRankingCandidates)
      .lean();
    const statsById = await statsForStores(candidates.map((s) => s._id));

    let ranked = rankBrands(candidates, {
      now,
      sort,
      category: built.filter.fashionCategories || "",
      query: built.search || "",
      statsById,
    });

    if (sort === "emerging") {
      ranked = ranked.filter(({ meta }) => meta.emerging);
    }

    const total = ranked.length;
    const pageItems = ranked.slice(skip, skip + limit).map(({ store }) => store);
    return await respondBrandList(res, {
      stores: pageItems,
      statsById,
      page,
      limit,
      total,
      sort,
      now,
      customerId: req.user?._id,
    });
  } catch (err) {
    next(err);
  }
};

export const listBrands = (req, res, next) => listBrandsImpl(req, res, next);
export const listNewBrands = (req, res, next) => listBrandsImpl(req, res, next, { sort: "new" });
export const listEmergingBrands = (req, res, next) =>
  listBrandsImpl(req, res, next, { sort: "emerging" });
export const listFeaturedBrands = (req, res, next) =>
  listBrandsImpl(req, res, next, { sort: "featured" });

export const searchBrands = async (req, res, next) => {
  const q = String(req.query.q || "").trim();
  if (!q) {
    return res.status(400).json({ success: false, message: "Search query is required" });
  }
  return listBrandsImpl(req, res, next, { sort: "relevance" });
};

export const getBrandMeta = async (req, res, next) => {
  try {
    const now = new Date();
    const vendorIds = await approvedVendorIds();
    const filter = baseEligibleFilter(vendorIds);

    const [totalBrands, categoryRows, provinceRows, cityRows] = await Promise.all([
      Store.countDocuments(filter),
      Store.aggregate([
        { $match: filter },
        { $unwind: "$fashionCategories" },
        { $group: { _id: "$fashionCategories", count: { $sum: 1 } } },
      ]),
      Store.aggregate([
        { $match: { ...filter, province: { $ne: "" } } },
        { $group: { _id: "$province", count: { $sum: 1 } } },
        { $sort: { count: -1, _id: 1 } },
      ]),
      Store.aggregate([
        { $match: { ...filter, city: { $ne: "" } } },
        { $group: { _id: { province: "$province", city: "$city" }, count: { $sum: 1 } } },
        { $sort: { count: -1, "_id.city": 1 } },
        { $limit: 100 },
      ]),
    ]);

    const counts = categoryRows.reduce((acc, row) => {
      acc[row._id] = row.count;
      return acc;
    }, {});

    res.json({
      success: true,
      totalBrands,
      categories: FASHION_CATEGORIES.map((c) => ({
        ...c,
        count: counts[c.slug] || 0,
      })),
      provinces: PROVINCES.map((name) => ({
        name,
        count: (provinceRows.find((r) => r._id === name) || {}).count || 0,
      })),
      cities: cityRows.map((row) => ({
        province: row._id.province || "",
        city: row._id.city,
        count: row.count,
      })),
      rotationWindowHours: DISCOVERY.rotationWindowHours,
      rotationWindow: rotationKey(now),
    });
  } catch (err) {
    next(err);
  }
};

const findPublicBrand = async (slug) => {
  const cleanSlug = String(slug || "").trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(cleanSlug)) return null;
  const store = await Store.findOne({
    storeSlug: cleanSlug,
    approvalStatus: "APPROVED",
    discoveryEligible: true,
  }).lean();
  if (!store) return null;
  const vendor = await Vendor.findById(store.vendor).select("status").lean();
  if (!vendor || vendor.status !== "APPROVED") return null;
  return store;
};

export const getBrandBySlug = async (req, res, next) => {
  try {
    const now = new Date();
    const store = await findPublicBrand(req.params.slug);
    if (!store) {
      return res.status(404).json({ success: false, message: "Brand not found" });
    }

    const [statsMap, products, categoryRows, reviews, isFollowing] = await Promise.all([
      statsForStores([store._id]),
      Product.find({ store: store._id, isActive: true })
        .sort({ createdAt: -1 })
        .limit(12)
        .lean(),
      Product.aggregate([
        { $match: { store: store._id, isActive: true, category: { $ne: "" } } },
        { $group: { _id: "$category", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      Review.aggregate([
        { $lookup: { from: "products", localField: "product", foreignField: "_id", as: "p" } },
        { $unwind: "$p" },
        { $match: { "p.store": store._id } },
        { $sort: { createdAt: -1 } },
        { $limit: 8 },
        {
          $lookup: { from: "users", localField: "user", foreignField: "_id", as: "author" },
        },
        { $unwind: { path: "$author", preserveNullAndEmptyArrays: true } },
        {
          $project: {
            _id: 1,
            rating: 1,
            comment: 1,
            createdAt: 1,
            productName: "$p.name",
            authorName: "$author.name",
          },
        },
      ]),
      req.user ? BrandFollow.exists({ customer: req.user._id, store: store._id }) : false,
    ]);

    const stats = statsMap[String(store._id)] || {};
    const brand = publicBrand(store, { now, ...stats, isFollowing: Boolean(isFollowing) });

    const safeProducts = products.map((p) => ({
      ...publicProduct(p),
      brand: { name: store.storeName, slug: store.storeSlug },
    }));

    res.json({
      success: true,
      brand,
      products: safeProducts,
      newArrivals: safeProducts.slice(0, 8),
      productCategories: categoryRows.map((row) => ({
        name: sanitizeText(row._id, 80),
        count: row.count,
      })),
      reviews: reviews.map((r) => ({
        id: String(r._id),
        rating: Number(r.rating) || 0,
        comment: sanitizeText(r.comment, 1000),
        authorName: sanitizeText(r.authorName || "Azania customer", 80),
        productName: sanitizeText(r.productName, 160),
        createdAt: r.createdAt,
      })),
      follow: {
        authenticated: Boolean(req.user),
        isFollowing: Boolean(isFollowing),
      },
    });
  } catch (err) {
    next(err);
  }
};

export const listBrandProducts = async (req, res, next) => {
  try {
    const store = await findPublicBrand(req.params.slug);
    if (!store) {
      return res.status(404).json({ success: false, message: "Brand not found" });
    }
    const { page, limit, skip } = parsePaging(req.query);
    const filter = { store: store._id, isActive: true };
    const category = String(req.query.category || "").trim();
    if (category && category !== "all") filter.category = sanitizeText(category, 80);

    const [products, total] = await Promise.all([
      Product.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Product.countDocuments(filter),
    ]);

    res.json({
      success: true,
      brand: {
        id: String(store._id),
        name: store.storeName,
        slug: store.storeSlug,
      },
      products: products.map((p) => ({
        ...publicProduct(p),
        brand: { name: store.storeName, slug: store.storeSlug },
      })),
      page,
      limit,
      total,
      pages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (err) {
    next(err);
  }
};

export const listRecentBrandProducts = async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePaging(req.query);
    const vendorIds = await approvedVendorIds();
    const stores = await Store.find(baseEligibleFilter(vendorIds)).select("_id storeName storeSlug").lean();
    const storeIds = stores.map((s) => s._id);
    const storeMap = new Map(stores.map((s) => [String(s._id), s]));

    if (!storeIds.length) {
      return res.json({ success: true, products: [], page, limit, total: 0, pages: 1 });
    }

    const category = String(req.query.category || "").trim().toLowerCase();
    const filter = { store: { $in: storeIds }, isActive: true };
    if (category && category !== "all") filter.category = category;

    // Fetch a slightly larger window so the per-brand cap still yields a full
    // page without letting one brand fill the rail.
    const fetchLimit = Math.min(200, Math.max(limit * 4, 24));
    const raw = await Product.find(filter)
      .sort({ createdAt: -1 })
      .limit(fetchLimit + skip)
      .lean();

    const capped = capPerBrand(raw, (p) => p.store);
    const pageItems = capped.slice(skip, skip + limit);

    res.json({
      success: true,
      products: pageItems.map((p) => {
        const brand = storeMap.get(String(p.store)) || {};
        return {
          ...publicProduct(p),
          brand: { name: brand.storeName || "", slug: brand.storeSlug || "" },
        };
      }),
      page,
      limit,
      total: capped.length,
      pages: Math.max(1, Math.ceil(capped.length / limit)),
    });
  } catch (err) {
    next(err);
  }
};

export const listBrandStories = async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePaging(req.query);
    const vendorIds = await approvedVendorIds();
    const stores = await Store.find(baseEligibleFilter(vendorIds)).select("_id storeName storeSlug logo").lean();
    const storeMap = new Map(stores.map((s) => [String(s._id), s]));

    if (!stores.length) {
      return res.json({ success: true, stories: [], page, limit, total: 0, pages: 1 });
    }

    const filter = { status: "PUBLISHED", brand: { $in: stores.map((s) => s._id) } };
    const [stories, total] = await Promise.all([
      BrandStory.find(filter).sort({ publishedAt: -1, createdAt: -1 }).skip(skip).limit(limit).lean(),
      BrandStory.countDocuments(filter),
    ]);

    res.json({
      success: true,
      stories: stories.map((story) => {
        const brand = storeMap.get(String(story.brand)) || {};
        return {
          id: String(story._id),
          title: sanitizeText(story.title, 160),
          slug: story.slug,
          excerpt: sanitizeText(story.excerpt, 500),
          image: sanitizeUrl(story.image) || "",
          publishedAt: story.publishedAt,
          brand: {
            name: brand.storeName || "",
            slug: brand.storeSlug || "",
            logo: brand.logo || "",
          },
        };
      }),
      page,
      limit,
      total,
      pages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (err) {
    next(err);
  }
};

export const getBrandStoryBySlug = async (req, res, next) => {
  try {
    const slug = String(req.params.slug || "").trim().toLowerCase();
    const story = await BrandStory.findOne({ slug, status: "PUBLISHED" }).lean();
    if (!story) {
      return res.status(404).json({ success: false, message: "Story not found" });
    }
    const store = await findPublicBrandById(story.brand);
    if (!store) {
      return res.status(404).json({ success: false, message: "Story not found" });
    }
    res.json({
      success: true,
      story: {
        id: String(story._id),
        title: sanitizeText(story.title, 160),
        slug: story.slug,
        excerpt: sanitizeText(story.excerpt, 500),
        body: sanitizeMultiline(story.body, 20000),
        image: sanitizeUrl(story.image) || "",
        publishedAt: story.publishedAt,
        brand: {
          name: store.storeName,
          slug: store.storeSlug,
          logo: store.logo || "",
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

const findPublicBrandById = async (id) => {
  const store = await Store.findOne({
    _id: id,
    approvalStatus: "APPROVED",
    discoveryEligible: true,
  }).lean();
  if (!store) return null;
  const vendor = await Vendor.findById(store.vendor).select("status").lean();
  if (!vendor || vendor.status !== "APPROVED") return null;
  return store;
};

export const listActiveCampaigns = async (req, res, next) => {
  try {
    const DiscoveryCampaign = (await import("../models/DiscoveryCampaign.js")).default;
    const now = new Date();
    const vendorIds = await approvedVendorIds();
    const stores = await Store.find(baseEligibleFilter(vendorIds)).select("_id storeName storeSlug logo").lean();
    const storeMap = new Map(stores.map((s) => [String(s._id), s]));

    const campaigns = await DiscoveryCampaign.find({
      status: "ACTIVE",
      $and: [
        { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
        { $or: [{ endsAt: null }, { endsAt: { $gte: now } }] },
      ],
    })
      .sort({ startsAt: -1 })
      .limit(10)
      .lean();

    res.json({
      success: true,
      campaigns: campaigns.map((campaign) => ({
        id: String(campaign._id),
        name: sanitizeText(campaign.name, 160),
        slug: campaign.slug,
        description: sanitizeText(campaign.description, 1000),
        label: "Curated by Azania",
        sponsored: false,
        brands: (campaign.brands || [])
          .map((id) => storeMap.get(String(id)))
          .filter(Boolean)
          .map((s) => ({ id: String(s._id), name: s.storeName, slug: s.storeSlug, logo: s.logo || "" })),
      })),
    });
  } catch (err) {
    next(err);
  }
};

export default {
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
};
