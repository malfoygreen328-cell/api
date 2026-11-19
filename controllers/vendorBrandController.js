// src/controllers/vendorBrandController.js
//
// Vendor-facing brand profile management. A vendor can only ever read or edit
// the store linked to their own verified account. Governance fields (featured,
// approvalStatus, discoveryEligible) are never writable here: only admins can
// change them through /api/admin/discovery.

import Store from "../models/Store.js";
import { computeCompleteness } from "../services/discoveryService.js";
import { FASHION_CATEGORY_LABELS } from "../config/brandConfig.js";
import {
  sanitizeCategories,
  sanitizeCity,
  sanitizeMultiline,
  sanitizeProvince,
  sanitizeSocialLinks,
  sanitizeText,
  sanitizeUrl,
} from "../utils/contentSanitizer.js";

const vendorIdOf = (req) => {
  const user = req.user;
  if (!user) return null;
  if (user.constructor?.modelName === "Vendor") return user._id;
  return user.vendorId || user.vendor || user._vendorDoc?._id || null;
};

const serializeBrand = (store) => {
  const completeness = computeCompleteness(store);
  return {
    id: String(store._id),
    name: store.storeName || "",
    slug: store.storeSlug || "",
    description: store.description || "",
    story: store.story || "",
    logo: store.logo || "",
    banner: store.banner || "",
    themeColor: store.themeColor || "#004225",
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
    discoveryEligible: store.discoveryEligible !== false,
    completeness: Number(completeness.score.toFixed(3)),
    missingProfileFields: completeness.missing,
    updatedAt: store.updatedAt,
  };
};

export const getMyBrand = async (req, res, next) => {
  try {
    const vendorId = vendorIdOf(req);
    if (!vendorId) {
      return res.status(403).json({ success: false, message: "Vendor account required" });
    }
    const store = await Store.findOne({ vendor: vendorId });
    if (!store) {
      return res.json({ success: true, brand: null });
    }
    res.json({ success: true, brand: serializeBrand(store) });
  } catch (err) {
    next(err);
  }
};

export const updateMyBrand = async (req, res, next) => {
  try {
    const vendorId = vendorIdOf(req);
    if (!vendorId) {
      return res.status(403).json({ success: false, message: "Vendor account required" });
    }

    const body = req.body || {};
    const storeName = sanitizeText(body.storeName ?? body.name, 120);
    if (!storeName) {
      return res.status(400).json({ success: false, message: "Brand name is required" });
    }

    let store = await Store.findOne({ vendor: vendorId });
    const isNew = !store;
    if (isNew) {
      store = new Store({ vendor: vendorId, owner: vendorId });
    }

    const updates = {
      storeName,
      description: sanitizeText(body.description, 2000),
      story: sanitizeMultiline(body.story, 5000),
      province: sanitizeProvince(body.province),
      city: sanitizeCity(body.city),
      fashionCategories: sanitizeCategories(body.fashionCategories ?? body.categories),
    };
    if (body.logo !== undefined) updates.logo = sanitizeUrl(body.logo);
    if (body.banner !== undefined) updates.banner = sanitizeUrl(body.banner);
    if (body.socialLinks !== undefined) updates.socialLinks = sanitizeSocialLinks(body.socialLinks);
    if (body.themeColor !== undefined && /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(String(body.themeColor))) {
      updates.themeColor = body.themeColor;
    }

    const publicFields = [
      "storeName",
      "description",
      "story",
      "province",
      "city",
      "fashionCategories",
      "logo",
      "banner",
      "socialLinks",
      "themeColor",
    ];
    const changedPublicProfile = publicFields.some((key) => updates[key] !== undefined);

    Object.assign(store, updates);

    // Editing a live public profile requires re-moderation. New/never-approved
    // brands simply stay PENDING/REJECTED until an admin acts.
    if (
      !isNew &&
      changedPublicProfile &&
      (store.approvalStatus === "APPROVED" || store.approvalStatus === "REJECTED")
    ) {
      store.approvalStatus = "PENDING";
      store.approvalReason = "";
      store.approvedAt = null;
      store.approvedBy = null;
    }

    await store.save();

    res.status(isNew ? 201 : 200).json({
      success: true,
      message: "Brand profile saved. It will be reviewed before appearing in Discover Brands.",
      brand: serializeBrand(store),
    });
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({ success: false, message: "That brand name is already taken" });
    }
    next(err);
  }
};

export const uploadBrandImage = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "No image uploaded" });
    }
    if (!String(req.file.mimetype || "").startsWith("image/")) {
      return res.status(400).json({ success: false, message: "Only image files are allowed" });
    }
    const url = `/uploads/${req.file.filename}`;
    res.status(201).json({ success: true, url, type: req.body?.type === "banner" ? "banner" : "logo" });
  } catch (err) {
    next(err);
  }
};

export default { getMyBrand, updateMyBrand, uploadBrandImage };
