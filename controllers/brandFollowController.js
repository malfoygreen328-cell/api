// src/controllers/brandFollowController.js
//
// Follow/unfollow is strictly derived from the verified access token. The
// client can never choose a customer id, so one customer cannot modify another
// customer's follows. Duplicate follows are prevented both by an explicit
// lookup and by the unique (customer, store) index on BrandFollow.

import BrandFollow from "../models/BrandFollow.js";
import Store from "../models/Store.js";
import Vendor from "../models/Vendor.js";
import Product from "../models/Product.js";
import { sanitizeText } from "../utils/contentSanitizer.js";

const findEligibleBrand = async (slug) => {
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

const parsePaging = (query = {}) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(48, Math.max(1, parseInt(query.limit, 10) || 12));
  return { page, limit, skip: (page - 1) * limit };
};

const followerCount = (storeId) => BrandFollow.countDocuments({ store: storeId });

const publicProduct = (product, brand) => {
  const images = Array.isArray(product.images) ? product.images.slice(0, 5) : [];
  return {
    id: String(product._id),
    name: sanitizeText(product.name, 160),
    price: Number(product.price) || 0,
    images,
    image: images[0] || "",
    category: sanitizeText(product.category, 80),
    stock: Number(product.stock) || 0,
    createdAt: product.createdAt,
    brand: { name: brand.storeName || "", slug: brand.storeSlug || "" },
  };
};

export const followBrand = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }
    const store = await findEligibleBrand(req.params.slug);
    if (!store) {
      return res.status(404).json({ success: false, message: "Brand not found" });
    }

    const existing = await BrandFollow.findOne({ customer: req.user._id, store: store._id });
    if (existing) {
      const followersCount = await followerCount(store._id);
      return res.json({
        success: true,
        alreadyFollowing: true,
        following: true,
        followersCount,
        message: "You already follow this brand",
      });
    }

    try {
      await BrandFollow.create({
        customer: req.user._id,
        store: store._id,
        vendor: store.vendor,
      });
    } catch (err) {
      // Unique index race: treat as idempotent success.
      if (err?.code !== 11000) throw err;
    }

    const followersCount = await followerCount(store._id);
    return res.status(201).json({
      success: true,
      following: true,
      followersCount,
      message: `You are now following ${store.storeName}`,
    });
  } catch (err) {
    next(err);
  }
};

export const unfollowBrand = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }
    const store = await findEligibleBrand(req.params.slug);
    if (!store) {
      return res.status(404).json({ success: false, message: "Brand not found" });
    }

    await BrandFollow.deleteOne({ customer: req.user._id, store: store._id });
    const followersCount = await followerCount(store._id);
    return res.json({
      success: true,
      following: false,
      followersCount,
      message: "You have unfollowed this brand",
    });
  } catch (err) {
    next(err);
  }
};

export const getFollowedBrands = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }
    const { page, limit, skip } = parsePaging(req.query);
    const follows = await BrandFollow.find({ customer: req.user._id })
      .sort({ createdAt: -1 })
      .lean();

    const storeIds = follows.map((f) => f.store).filter(Boolean);
    const stores = storeIds.length
      ? await Store.find({
          _id: { $in: storeIds },
          approvalStatus: "APPROVED",
          discoveryEligible: true,
        }).lean()
      : [];
    const approvedVendors = stores.length
      ? await Vendor.find({
          _id: { $in: stores.map((s) => s.vendor) },
          status: "APPROVED",
        }).distinct("_id")
      : [];
    const approvedSet = new Set(approvedVendors.map(String));
    const visible = stores.filter((s) => approvedSet.has(String(s.vendor)));

    // Preserve follow recency order.
    const order = new Map(storeIds.map((id, index) => [String(id), index]));
    visible.sort((a, b) => (order.get(String(a._id)) || 0) - (order.get(String(b._id)) || 0));

    const pageItems = visible.slice(skip, skip + limit);
    const stats = pageItems.length
      ? await BrandFollow.aggregate([
          { $match: { store: { $in: pageItems.map((s) => s._id) } } },
          { $group: { _id: "$store", count: { $sum: 1 } } },
        ])
      : [];
    const followers = new Map(stats.map((row) => [String(row._id), row.count]));

    res.json({
      success: true,
      brands: pageItems.map((store) => ({
        id: String(store._id),
        name: store.storeName || "",
        slug: store.storeSlug || "",
        logo: store.logo || "",
        banner: store.banner || "",
        description: store.description || "",
        province: store.province || "",
        city: store.city || "",
        followersCount: followers.get(String(store._id)) || 0,
      })),
      page,
      limit,
      total: visible.length,
      pages: Math.max(1, Math.ceil(visible.length / limit)),
    });
  } catch (err) {
    next(err);
  }
};

export const getFollowedFeed = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }
    const { page, limit, skip } = parsePaging(req.query);

    const storeIds = await BrandFollow.find({ customer: req.user._id }).distinct("store");
    if (!storeIds.length) {
      return res.json({ success: true, products: [], page, limit, total: 0, pages: 1 });
    }

    const visibleStores = await Store.find({
      _id: { $in: storeIds },
      approvalStatus: "APPROVED",
      discoveryEligible: true,
    }).select("_id storeName storeSlug vendor").lean();
    const approvedVendors = await Vendor.find({
      _id: { $in: visibleStores.map((s) => s.vendor) },
      status: "APPROVED",
    }).distinct("_id");
    const approvedSet = new Set(approvedVendors.map(String));
    const stores = visibleStores.filter((s) => approvedSet.has(String(s.vendor)));
    const storeMap = new Map(stores.map((s) => [String(s._id), s]));
    if (!stores.length) {
      return res.json({ success: true, products: [], page, limit, total: 0, pages: 1 });
    }

    const filter = { store: { $in: stores.map((s) => s._id) }, isActive: true };
    const [products, total] = await Promise.all([
      Product.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Product.countDocuments(filter),
    ]);

    res.json({
      success: true,
      products: products.map((p) => publicProduct(p, storeMap.get(String(p.store)) || {})),
      page,
      limit,
      total,
      pages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (err) {
    next(err);
  }
};

export default { followBrand, unfollowBrand, getFollowedBrands, getFollowedFeed };
