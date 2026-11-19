// src/controllers/adminDiscoveryController.js
//
// Administrative brand discovery management. Every mutation is permission
// protected by the router (admin/superadmin) and audit logged with the acting
// admin, action, resource and reason. Vendors have no route into these
// handlers, so a vendor can never feature or approve their own brand through an
// untrusted client request.

import mongoose from "mongoose";
import Store from "../models/Store.js";
import Vendor from "../models/Vendor.js";
import BrandStory from "../models/BrandStory.js";
import DiscoveryCampaign from "../models/DiscoveryCampaign.js";
import { recordAudit } from "../services/auditService.js";
import { statsForStores } from "../services/brandStatsService.js";
import { computeCompleteness } from "../services/discoveryService.js";
import {
  hasCompletePublicProfile,
  isBrandDiscoverable,
} from "../services/brandEligibilityService.js";
import {
  FASHION_CATEGORIES,
  FASHION_CATEGORY_LABELS,
  PROVINCES,
  isFashionCategory,
} from "../config/brandConfig.js";
import {
  sanitizeCategories,
  sanitizeMultiline,
  sanitizeSlug,
  sanitizeText,
  sanitizeUrl,
} from "../utils/contentSanitizer.js";

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

const parsePaging = (query = {}) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
  return { page, limit, skip: (page - 1) * limit };
};

const escapeRegex = (value) => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const uniqueSlug = async (Model, base, excludeId = null) => {
  let root = sanitizeSlug(base) || "item";
  let slug = root;
  let counter = 1;
  // Bounded loop: slug space is large enough for practical use.
  while (
    await Model.findOne({
      slug,
      ...(excludeId ? { _id: { $ne: excludeId } } : {}),
    })
  ) {
    slug = `${root}-${counter++}`;
    if (counter > 500) {
      slug = `${root}-${Date.now().toString(36)}`;
      break;
    }
  }
  return slug;
};

const adminBrandPayload = (store, vendor, stats = {}) => ({
  id: String(store._id),
  name: store.storeName || "",
  slug: store.storeSlug || "",
  logo: store.logo || "",
  banner: store.banner || "",
  description: store.description || "",
  story: store.story || "",
  province: store.province || "",
  city: store.city || "",
  categories: (store.fashionCategories || []).map((slug) => ({
    slug,
    label: FASHION_CATEGORY_LABELS[slug] || slug,
  })),
  socialLinks: store.socialLinks || {},
  approvalStatus: store.approvalStatus,
  approvalReason: store.approvalReason || "",
  approvedAt: store.approvedAt || null,
  featured: Boolean(store.featured),
  featuredAt: store.featuredAt || null,
  discoveryEligible: store.discoveryEligible !== false,
  completeness: Number(computeCompleteness(store).score.toFixed(3)),
  missingProfileFields: computeCompleteness(store).missing,
  brandCreatedAt: store.createdAt,
  updatedAt: store.updatedAt,
  vendor: vendor
    ? {
        id: String(vendor._id),
        businessName: vendor.businessName || "",
        fullName: vendor.fullName || "",
        email: vendor.email || "",
        status: vendor.status || "",
      }
    : null,
  metrics: {
    followersCount: stats.followersCount || 0,
    productCount: stats.productCount || 0,
    activeProductCount: stats.activeProductCount || 0,
    reviewCount: stats.reviewCount || 0,
    rating: Number(Number(stats.rating || 0).toFixed(1)),
    views: stats.views || 0,
    sold: stats.sold || 0,
  },
});

const loadVendorMap = async (stores) => {
  const ids = stores.map((s) => s.vendor).filter(Boolean);
  if (!ids.length) return new Map();
  const vendors = await Vendor.find({ _id: { $in: ids } })
    .select("businessName fullName email status")
    .lean();
  return new Map(vendors.map((v) => [String(v._id), v]));
};

export const listBrands = async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePaging(req.query);
    const filter = {};

    if (req.query.approvalStatus) {
      const status = String(req.query.approvalStatus).toUpperCase();
      if (!["PENDING", "APPROVED", "REJECTED"].includes(status)) {
        return res.status(400).json({ success: false, message: "Invalid approval status" });
      }
      filter.approvalStatus = status;
    }
    if (req.query.featured === "true") filter.featured = true;
    if (req.query.featured === "false") filter.featured = false;
    if (req.query.eligible === "true") filter.discoveryEligible = true;
    if (req.query.eligible === "false") filter.discoveryEligible = false;
    if (req.query.category && isFashionCategory(req.query.category)) {
      filter.fashionCategories = String(req.query.category).toLowerCase();
    }
    if (req.query.province && PROVINCES.includes(String(req.query.province))) {
      filter.province = String(req.query.province);
    }
    const search = String(req.query.q || "").trim().slice(0, 80);
    if (search) {
      const rx = new RegExp(escapeRegex(search), "i");
      filter.$or = [{ storeName: rx }, { city: rx }, { province: rx }, { description: rx }];
    }

    const [stores, total] = await Promise.all([
      Store.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Store.countDocuments(filter),
    ]);
    const vendorMap = await loadVendorMap(stores);
    const stats = await statsForStores(stores.map((s) => s._id));

    res.json({
      success: true,
      brands: stores.map((s) =>
        adminBrandPayload(s, vendorMap.get(String(s.vendor)), stats[String(s._id)])
      ),
      page,
      limit,
      total,
      pages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (err) {
    next(err);
  }
};

export const getBrand = async (req, res, next) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid brand id" });
    }
    const store = await Store.findById(req.params.id).lean();
    if (!store) return res.status(404).json({ success: false, message: "Brand not found" });
    const vendor = await Vendor.findById(store.vendor)
      .select("businessName fullName email status")
      .lean();
    const stats = await statsForStores([store._id]);
    res.json({
      success: true,
      brand: adminBrandPayload(store, vendor, stats[String(store._id)]),
    });
  } catch (err) {
    next(err);
  }
};

const loadBrandOr404 = async (id) => {
  if (!isValidId(id)) return { error: { status: 400, message: "Invalid brand id" } };
  const store = await Store.findById(id);
  if (!store) return { error: { status: 404, message: "Brand not found" } };
  return { store };
};

export const approveBrand = async (req, res, next) => {
  try {
    const { store, error } = await loadBrandOr404(req.params.id);
    if (error) return res.status(error.status).json({ success: false, message: error.message });

    const vendor = await Vendor.findById(store.vendor).select("status").lean();
    const profileComplete = hasCompletePublicProfile(store);
    const vendorApproved = vendor?.status === "APPROVED";

    store.approvalStatus = "APPROVED";
    store.approvalReason = "";
    store.approvedAt = new Date();
    store.approvedBy = req.user._id;
    // Re-approval must clear the rejection kill-switch, but only when the
    // brand is actually publishable. A suspended/pending vendor or an
    // incomplete profile keeps the brand out of discovery.
    store.discoveryEligible = isBrandDiscoverable({
      store,
      vendorStatus: vendor?.status,
    });
    await store.save();

    await recordAudit({
      req,
      action: "brand.approved",
      resourceType: "brand",
      resourceId: String(store._id),
      metadata: {
        vendorApproved,
        profileComplete,
        discoveryEligible: store.discoveryEligible,
      },
    });

    let message = "Brand approved and eligible for discovery";
    if (!profileComplete) {
      message =
        "Brand approved, but its public profile is incomplete. It will not be discoverable until the profile is complete and re-approved.";
    } else if (!vendorApproved) {
      message =
        "Brand approved. It will become discoverable automatically once the vendor account is approved.";
    }

    res.json({
      success: true,
      message,
      brand: adminBrandPayload(store.toObject(), null),
    });
  } catch (err) {
    next(err);
  }
};

export const rejectBrand = async (req, res, next) => {
  try {
    const { store, error } = await loadBrandOr404(req.params.id);
    if (error) return res.status(error.status).json({ success: false, message: error.message });

    const reason = sanitizeText(req.body?.reason, 1000);
    if (!reason) {
      return res.status(400).json({ success: false, message: "A rejection reason is required" });
    }

    store.approvalStatus = "REJECTED";
    store.approvalReason = reason;
    store.approvedAt = null;
    store.approvedBy = null;
    store.discoveryEligible = false;
    await store.save();

    await recordAudit({
      req,
      action: "brand.rejected",
      resourceType: "brand",
      resourceId: String(store._id),
      reason,
    });

    res.json({ success: true, message: "Brand rejected", brand: adminBrandPayload(store.toObject(), null) });
  } catch (err) {
    next(err);
  }
};

export const featureBrand = async (req, res, next) => {
  try {
    const { store, error } = await loadBrandOr404(req.params.id);
    if (error) return res.status(error.status).json({ success: false, message: error.message });
    if (store.approvalStatus !== "APPROVED") {
      return res.status(400).json({
        success: false,
        message: "Only approved brands can be featured",
      });
    }

    store.featured = true;
    store.featuredAt = new Date();
    store.featuredBy = req.user._id;
    await store.save();

    await recordAudit({
      req,
      action: "brand.featured",
      resourceType: "brand",
      resourceId: String(store._id),
    });
    res.json({ success: true, message: "Brand featured", brand: adminBrandPayload(store.toObject(), null) });
  } catch (err) {
    next(err);
  }
};

export const unfeatureBrand = async (req, res, next) => {
  try {
    const { store, error } = await loadBrandOr404(req.params.id);
    if (error) return res.status(error.status).json({ success: false, message: error.message });

    store.featured = false;
    store.featuredAt = null;
    store.featuredBy = null;
    await store.save();

    await recordAudit({
      req,
      action: "brand.unfeatured",
      resourceType: "brand",
      resourceId: String(store._id),
    });
    res.json({ success: true, message: "Brand unfeatured", brand: adminBrandPayload(store.toObject(), null) });
  } catch (err) {
    next(err);
  }
};

export const setEligibility = async (req, res, next) => {
  try {
    const { store, error } = await loadBrandOr404(req.params.id);
    if (error) return res.status(error.status).json({ success: false, message: error.message });

    if (typeof req.body?.eligible !== "boolean") {
      return res.status(400).json({ success: false, message: "eligible must be a boolean" });
    }
    store.discoveryEligible = req.body.eligible;
    await store.save();

    await recordAudit({
      req,
      action: req.body.eligible ? "brand.eligibility_enabled" : "brand.eligibility_disabled",
      resourceType: "brand",
      resourceId: String(store._id),
      reason: sanitizeText(req.body?.reason, 1000),
    });
    res.json({
      success: true,
      message: req.body.eligible ? "Brand is eligible for discovery" : "Brand removed from discovery",
      brand: adminBrandPayload(store.toObject(), null),
    });
  } catch (err) {
    next(err);
  }
};

export const setCategories = async (req, res, next) => {
  try {
    const { store, error } = await loadBrandOr404(req.params.id);
    if (error) return res.status(error.status).json({ success: false, message: error.message });

    const categories = sanitizeCategories(req.body?.categories);
    if (!categories.length) {
      return res.status(400).json({ success: false, message: "Select at least one valid category" });
    }
    store.fashionCategories = categories;
    await store.save();

    await recordAudit({
      req,
      action: "brand.categories_updated",
      resourceType: "brand",
      resourceId: String(store._id),
      metadata: { categories },
    });
    res.json({ success: true, brand: adminBrandPayload(store.toObject(), null) });
  } catch (err) {
    next(err);
  }
};

export const getBrandMetrics = async (req, res, next) => {
  try {
    if (req.params.id) {
      if (!isValidId(req.params.id)) {
        return res.status(400).json({ success: false, message: "Invalid brand id" });
      }
      const store = await Store.findById(req.params.id).lean();
      if (!store) return res.status(404).json({ success: false, message: "Brand not found" });
      const stats = await statsForStores([store._id]);
      return res.json({
        success: true,
        brand: adminBrandPayload(store, null, stats[String(store._id)]),
      });
    }

    const { page, limit, skip } = parsePaging(req.query);
    const [stores, total] = await Promise.all([
      Store.find().sort({ createdAt: -1 }).skip(skip).limit(limit).select("_id storeName storeSlug").lean(),
      Store.countDocuments(),
    ]);
    const stats = await statsForStores(stores.map((s) => s._id));
    res.json({
      success: true,
      brands: stores.map((s) => ({
        id: String(s._id),
        name: s.storeName,
        slug: s.storeSlug,
        ...(stats[String(s._id)] || {}),
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

/* ----------------------------- Stories ----------------------------- */

export const listStories = async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePaging(req.query);
    const filter = {};
    if (req.query.status) filter.status = String(req.query.status).toUpperCase();
    if (req.query.brand && isValidId(req.query.brand)) filter.brand = req.query.brand;

    const [stories, total] = await Promise.all([
      BrandStory.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("brand", "storeName storeSlug")
        .lean(),
      BrandStory.countDocuments(filter),
    ]);

    res.json({
      success: true,
      stories,
      page,
      limit,
      total,
      pages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (err) {
    next(err);
  }
};

export const createStory = async (req, res, next) => {
  try {
    const brandId = req.body?.brandId || req.body?.brand;
    if (!isValidId(brandId)) {
      return res.status(400).json({ success: false, message: "A valid brand is required" });
    }
    const store = await Store.findById(brandId).select("_id").lean();
    if (!store) return res.status(404).json({ success: false, message: "Brand not found" });

    const title = sanitizeText(req.body?.title, 160);
    if (!title) {
      return res.status(400).json({ success: false, message: "Title is required" });
    }

    const status = ["DRAFT", "PUBLISHED", "ARCHIVED"].includes(req.body?.status)
      ? req.body.status
      : "DRAFT";

    const story = await BrandStory.create({
      brand: store._id,
      title,
      slug: await uniqueSlug(BrandStory, req.body?.slug || title),
      excerpt: sanitizeText(req.body?.excerpt, 500),
      body: sanitizeMultiline(req.body?.body, 20000),
      image: sanitizeUrl(req.body?.image),
      status,
      publishedAt: status === "PUBLISHED" ? new Date() : null,
      createdBy: req.user._id,
      updatedBy: req.user._id,
    });

    await recordAudit({
      req,
      action: "brand_story.created",
      resourceType: "brand_story",
      resourceId: String(story._id),
      metadata: { brandId: String(store._id), status },
    });

    res.status(201).json({ success: true, story });
  } catch (err) {
    next(err);
  }
};

export const updateStory = async (req, res, next) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid story id" });
    }
    const story = await BrandStory.findById(req.params.id);
    if (!story) return res.status(404).json({ success: false, message: "Story not found" });

    if (req.body?.title !== undefined) {
      const title = sanitizeText(req.body.title, 160);
      if (!title) return res.status(400).json({ success: false, message: "Title cannot be empty" });
      story.title = title;
    }
    if (req.body?.excerpt !== undefined) story.excerpt = sanitizeText(req.body.excerpt, 500);
    if (req.body?.body !== undefined) story.body = sanitizeMultiline(req.body.body, 20000);
    if (req.body?.image !== undefined) story.image = sanitizeUrl(req.body.image);
    if (req.body?.brandId && isValidId(req.body.brandId)) {
      const store = await Store.findById(req.body.brandId).select("_id").lean();
      if (!store) return res.status(404).json({ success: false, message: "Brand not found" });
      story.brand = store._id;
    }
    if (req.body?.status !== undefined) {
      if (!["DRAFT", "PUBLISHED", "ARCHIVED"].includes(req.body.status)) {
        return res.status(400).json({ success: false, message: "Invalid story status" });
      }
      story.status = req.body.status;
      if (req.body.status === "PUBLISHED" && !story.publishedAt) story.publishedAt = new Date();
    }
    story.updatedBy = req.user._id;
    await story.save();

    await recordAudit({
      req,
      action: "brand_story.updated",
      resourceType: "brand_story",
      resourceId: String(story._id),
      metadata: { status: story.status },
    });
    res.json({ success: true, story });
  } catch (err) {
    next(err);
  }
};

export const deleteStory = async (req, res, next) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid story id" });
    }
    const story = await BrandStory.findByIdAndDelete(req.params.id);
    if (!story) return res.status(404).json({ success: false, message: "Story not found" });
    await recordAudit({
      req,
      action: "brand_story.deleted",
      resourceType: "brand_story",
      resourceId: String(story._id),
    });
    res.json({ success: true, message: "Story deleted" });
  } catch (err) {
    next(err);
  }
};

/* ---------------------------- Campaigns ---------------------------- */

const parseDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

export const listCampaigns = async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePaging(req.query);
    const filter = {};
    if (req.query.status) filter.status = String(req.query.status).toUpperCase();
    const [campaigns, total] = await Promise.all([
      DiscoveryCampaign.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("brands", "storeName storeSlug approvalStatus")
        .lean(),
      DiscoveryCampaign.countDocuments(filter),
    ]);
    res.json({ success: true, campaigns, page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) });
  } catch (err) {
    next(err);
  }
};

const validateCampaignBrands = async (ids) => {
  if (!Array.isArray(ids)) return { brands: [] };
  const valid = ids.filter(isValidId);
  const stores = await Store.find({ _id: { $in: valid } })
    .select("_id approvalStatus discoveryEligible vendor")
    .lean();
  if (stores.length !== valid.length) return { error: "One or more brands do not exist" };

  const vendorIds = stores.map((s) => s.vendor);
  const vendors = await Vendor.find({ _id: { $in: vendorIds } })
    .select("_id status")
    .lean();
  const vendorStatus = new Map(vendors.map((v) => [String(v._id), v.status]));

  const ineligible = stores.find(
    (store) =>
      store.approvalStatus !== "APPROVED" ||
      store.discoveryEligible !== true ||
      vendorStatus.get(String(store.vendor)) !== "APPROVED"
  );
  if (ineligible) {
    return {
      error:
        "Campaign brands must be approved, discovery-eligible, and owned by an approved vendor",
    };
  }

  return { brands: stores.map((s) => s._id) };
};

export const createCampaign = async (req, res, next) => {
  try {
    const name = sanitizeText(req.body?.name, 160);
    if (!name) return res.status(400).json({ success: false, message: "Campaign name is required" });
    const status = ["DRAFT", "ACTIVE", "ARCHIVED"].includes(req.body?.status)
      ? req.body.status
      : "DRAFT";
    const { brands, error } = await validateCampaignBrands(req.body?.brands || []);
    if (error) return res.status(400).json({ success: false, message: error });

    const campaign = await DiscoveryCampaign.create({
      name,
      slug: await uniqueSlug(DiscoveryCampaign, req.body?.slug || name),
      description: sanitizeText(req.body?.description, 1000),
      status,
      brands,
      startsAt: parseDate(req.body?.startsAt) ?? null,
      endsAt: parseDate(req.body?.endsAt) ?? null,
      createdBy: req.user._id,
      updatedBy: req.user._id,
    });

    await recordAudit({
      req,
      action: "discovery_campaign.created",
      resourceType: "discovery_campaign",
      resourceId: String(campaign._id),
      metadata: { status, brandCount: brands.length },
    });
    res.status(201).json({ success: true, campaign });
  } catch (err) {
    next(err);
  }
};

export const updateCampaign = async (req, res, next) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid campaign id" });
    }
    const campaign = await DiscoveryCampaign.findById(req.params.id);
    if (!campaign) return res.status(404).json({ success: false, message: "Campaign not found" });
    const wasActive = campaign.status === "ACTIVE";

    if (req.body?.name !== undefined) {
      const name = sanitizeText(req.body.name, 160);
      if (!name) return res.status(400).json({ success: false, message: "Campaign name cannot be empty" });
      campaign.name = name;
    }
    if (req.body?.description !== undefined) {
      campaign.description = sanitizeText(req.body.description, 1000);
    }
    if (req.body?.status !== undefined) {
      if (!["DRAFT", "ACTIVE", "ARCHIVED"].includes(req.body.status)) {
        return res.status(400).json({ success: false, message: "Invalid campaign status" });
      }
      campaign.status = req.body.status;
    }
    if (req.body?.brands !== undefined) {
      const { brands, error } = await validateCampaignBrands(req.body.brands);
      if (error) return res.status(400).json({ success: false, message: error });
      campaign.brands = brands;
    }
    if (req.body?.startsAt !== undefined) campaign.startsAt = parseDate(req.body.startsAt) ?? null;
    if (req.body?.endsAt !== undefined) campaign.endsAt = parseDate(req.body.endsAt) ?? null;

    // Brands can lose eligibility after a campaign was drafted. Re-check on
    // activation (and whenever the brand set changes) so a campaign never
    // publishes an unapproved, rejected, suspended or ineligible brand.
    if (campaign.status === "ACTIVE" && (!wasActive || req.body?.brands !== undefined)) {
      const { error } = await validateCampaignBrands(campaign.brands);
      if (error) return res.status(400).json({ success: false, message: error });
    }

    campaign.updatedBy = req.user._id;
    await campaign.save();

    await recordAudit({
      req,
      action: "discovery_campaign.updated",
      resourceType: "discovery_campaign",
      resourceId: String(campaign._id),
      metadata: { status: campaign.status, brandCount: campaign.brands.length },
    });
    res.json({ success: true, campaign });
  } catch (err) {
    next(err);
  }
};

export const deleteCampaign = async (req, res, next) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid campaign id" });
    }
    const campaign = await DiscoveryCampaign.findByIdAndDelete(req.params.id);
    if (!campaign) return res.status(404).json({ success: false, message: "Campaign not found" });
    await recordAudit({
      req,
      action: "discovery_campaign.deleted",
      resourceType: "discovery_campaign",
      resourceId: String(campaign._id),
    });
    res.json({ success: true, message: "Campaign deleted" });
  } catch (err) {
    next(err);
  }
};

export const getOptions = (_req, res) =>
  res.json({
    success: true,
    categories: FASHION_CATEGORIES,
    provinces: PROVINCES,
  });

export default {
  listBrands,
  getBrand,
  approveBrand,
  rejectBrand,
  featureBrand,
  unfeatureBrand,
  setEligibility,
  setCategories,
  getBrandMetrics,
  listStories,
  createStory,
  updateStory,
  deleteStory,
  listCampaigns,
  createCampaign,
  updateCampaign,
  deleteCampaign,
  getOptions,
};
