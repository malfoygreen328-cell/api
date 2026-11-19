import Store from "../models/Store.js";
import Vendor from "../models/Vendor.js";
import slugify from "slugify";
import {
  sanitizeCategories,
  sanitizeMultiline,
  sanitizeProvince,
  sanitizeSocialLinks,
  sanitizeText,
  sanitizeThemeColor,
} from "../utils/contentSanitizer.js";
import { isFashionCategory } from "../config/brandConfig.js";

// Fields that are safe to expose on public store endpoints. Vendor identity,
// approval metadata, discovery controls and financial/security fields are
// deliberately excluded.
const PUBLIC_STORE_FIELDS = [
  "_id",
  "storeName",
  "storeSlug",
  "logo",
  "banner",
  "themeColor",
  "description",
  "story",
  "province",
  "city",
  "fashionCategories",
  "socialLinks",
  "featured",
  "createdAt",
];

const publicStoreView = (store) => {
  const source = typeof store?.toObject === "function" ? store.toObject() : store || {};
  const view = {};
  for (const key of PUBLIC_STORE_FIELDS) {
    if (source[key] !== undefined) view[key] = source[key];
  }
  return view;
};

/* =========================================
   CREATE STORE
   Protected: vendor only
========================================= */
export const createStore = async (req, res, next) => {
  try {
    const { description, themeColor, socialLinks, vendorId: bodyVendorId } = req.body;
    // Admin/brand management posts { name }, vendor onboarding posts { storeName }.
    const rawStoreName = req.body.storeName || req.body.name;
    const storeName = sanitizeText(rawStoreName, 120);

    const isAdminUser = ["admin", "superadmin"].includes(req.user?.role);
    const vendorId = isAdminUser ? bodyVendorId : req.user?._id;

    if (!storeName) {
      const error = new Error("Store name is required");
      error.status = 400;
      throw error;
    }

    if (!vendorId) {
      const error = new Error("A vendor is required to create a store");
      error.status = 400;
      throw error;
    }

    const cleanThemeColor = sanitizeThemeColor(themeColor, "#004225");
    if (!cleanThemeColor) {
      const error = new Error("Theme colour must be a 3 or 6 digit hex value");
      error.status = 400;
      throw error;
    }

    const existingStore = await Store.findOne({ vendor: vendorId });
    if (existingStore) {
      const error = new Error("Vendor already owns a store");
      error.status = 400;
      throw error;
    }

    const store = await Store.create({
      vendor: vendorId,
      owner: vendorId,
      storeName,
      description: sanitizeText(description, 2000),
      story: sanitizeMultiline(req.body.story, 5000),
      province: sanitizeProvince(req.body.province),
      city: sanitizeText(req.body.city, 100),
      fashionCategories: sanitizeCategories(req.body.fashionCategories).filter(isFashionCategory),
      themeColor: cleanThemeColor,
      socialLinks: sanitizeSocialLinks(socialLinks),
      storeSlug: slugify(storeName, { lower: true, strict: true }),
      // New/legacy brands always start unapproved and ineligible; only the
      // admin discovery approval flow may publish them.
      approvalStatus: "PENDING",
      approvalReason: "",
      approvedAt: null,
      approvedBy: null,
      discoveryEligible: false,
    });

    res.status(201).json({
      success: true,
      message: "Store created successfully",
      store,
    });
  } catch (err) {
    next(err);
  }
};

/* =========================================
   HELPERS
========================================= */
const isAdmin = (req) => ["admin", "superadmin"].includes(req.user?.role);

const ownsStore = (req, store) =>
  isAdmin(req) ||
  String(store?.vendor?._id || store?.vendor || "") === String(req.user?._id || "");

/* =========================================
   GET ALL STORES
   Public endpoint
========================================= */
export const getAllStores = async (req, res, next) => {
  try {
    // Admins manage every store; the public may only ever see brands that are
    // approved, not de-listed, and owned by an approved vendor. Without this
    // gate the legacy store list leaked unapproved brand profiles.
    const adminView = isAdmin(req);
    const filter = adminView
      ? {}
      : { approvalStatus: "APPROVED", discoveryEligible: true };

    if (adminView) {
      const stores = await Store.find(filter)
        .populate("vendor", "name")
        .sort({ createdAt: -1 });
      return res.json({
        success: true,
        count: stores.length,
        stores,
      });
    }

    const approvedVendors = await Vendor.find({ status: "APPROVED" }).distinct("_id");
    const approvedSet = new Set(approvedVendors.map(String));
    const stores = await Store.find(filter)
      .select([...PUBLIC_STORE_FIELDS, "vendor"].join(" "))
      .sort({ createdAt: -1 })
      .lean();

    const publicStores = stores
      .filter((store) => approvedSet.has(String(store.vendor)))
      .map(publicStoreView);

    res.json({
      success: true,
      count: publicStores.length,
      stores: publicStores,
    });
  } catch (err) {
    next(err);
  }
};

/* =========================================
   GET STORE BY SLUG
========================================= */
export const getStoreBySlug = async (req, res, next) => {
  try {
    const { slug } = req.params;

    const store = await Store.findOne({ storeSlug: slug }).populate("vendor", "status");
    if (!store) {
      const error = new Error("Store not found");
      error.status = 404;
      throw error;
    }

    const adminView = isAdmin(req);
    const ownerView =
      String(store.vendor?._id || store.vendor || "") === String(req.user?._id || "");
    const vendorApproved = store.vendor?.status === "APPROVED";
    const publiclyVisible =
      store.approvalStatus === "APPROVED" &&
      store.discoveryEligible !== false &&
      vendorApproved;

    if (!publiclyVisible && !adminView && !ownerView) {
      return res.status(404).json({ success: false, message: "Store not found" });
    }

    // Owner/admin previews may include internal moderation fields; anonymous
    // and customer reads get the public allowlist only.
    if (adminView || ownerView) {
      const privateStore = await Store.findById(store._id).populate(
        "vendor",
        "name email status"
      );
      return res.json({ success: true, store: privateStore });
    }

    res.json({ success: true, store: publicStoreView(store) });
  } catch (err) {
    next(err);
  }
};

/* =========================================
   GET STORE BY VENDOR
   Vendor or admin can fetch store by vendor ID
========================================= */
export const getStoreByVendor = async (req, res, next) => {
  try {
    const { vendorId } = req.params;

    const store = await Store.findOne({ vendor: vendorId }).populate("vendor", "name email");

    if (!store) {
      const error = new Error("Store not found for this vendor");
      error.status = 404;
      throw error;
    }

    // Vendors may only read their own store; admins may read any
    if (!ownsStore(req, store)) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }

    res.json({ success: true, store });
  } catch (err) {
    next(err);
  }
};

/* =========================================
   UPDATE STORE
========================================= */
export const updateStore = async (req, res, next) => {
  try {
    const { id } = req.params;

    const store = await Store.findById(id);
    if (!store) {
      const error = new Error("Store not found");
      error.status = 404;
      throw error;
    }

    // Vendors may only update their own store
    if (!ownsStore(req, store)) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }

    const adminView = isAdmin(req);
    // Whitelist update fields (prevents mass-assignment). Discovery-governed
    // fields (featured, approvalStatus, discoveryEligible, approvedBy...) are
    // intentionally NOT editable here; only admin discovery endpoints can
    // change them.
    const allowed = [
      "storeName",
      "name",
      "description",
      "themeColor",
      "logo",
      "banner",
      "socialLinks",
      "story",
      "province",
      "city",
      "fashionCategories",
    ];
    const updateData = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updateData[key] = req.body[key];
    }
    if (updateData.name && !updateData.storeName) {
      updateData.storeName = updateData.name;
    }
    delete updateData.name;

    // Sanitize all user-supplied text/URLs before persisting.
    if (updateData.storeName !== undefined) {
      updateData.storeName = sanitizeText(updateData.storeName, 120);
      if (!updateData.storeName) {
        return res.status(400).json({ success: false, message: "Store name cannot be empty" });
      }
    }
    if (updateData.description !== undefined) {
      updateData.description = sanitizeText(updateData.description, 2000);
    }
    if (updateData.story !== undefined) {
      updateData.story = sanitizeMultiline(updateData.story, 5000);
    }
    if (updateData.themeColor !== undefined) {
      updateData.themeColor = sanitizeThemeColor(updateData.themeColor);
      if (!updateData.themeColor) {
        return res.status(400).json({
          success: false,
          message: "Theme colour must be a 3 or 6 digit hex value",
        });
      }
    }
    if (updateData.province !== undefined) {
      updateData.province = sanitizeProvince(updateData.province);
    }
    if (updateData.city !== undefined) updateData.city = sanitizeText(updateData.city, 100);
    if (updateData.socialLinks !== undefined) {
      updateData.socialLinks = sanitizeSocialLinks(updateData.socialLinks);
    }
    if (updateData.fashionCategories !== undefined) {
      updateData.fashionCategories = sanitizeCategories(updateData.fashionCategories).filter(
        isFashionCategory
      );
    }
    if (updateData.province !== undefined && !String(updateData.province).trim()) {
      updateData.province = "";
    }

    const publicFields = [
      "storeName",
      "description",
      "logo",
      "banner",
      "socialLinks",
      "story",
      "province",
      "city",
      "fashionCategories",
    ];
    const changesPublicProfile = publicFields.some((key) => updateData[key] !== undefined);

    Object.assign(store, updateData);

    // A vendor editing their public profile sends it back to moderation until
    // an admin re-approves. Admins using this endpoint do not reset status
    // (they use the dedicated discovery endpoints).
    if (!adminView && changesPublicProfile && store.approvalStatus === "APPROVED") {
      store.approvalStatus = "PENDING";
      store.approvalReason = "";
      store.approvedAt = null;
      store.approvedBy = null;
    }

    await store.save();

    res.json({ success: true, message: "Store updated successfully", store });
  } catch (err) {
    next(err);
  }
};

/* =========================================
   DELETE STORE
========================================= */
export const deleteStore = async (req, res, next) => {
  try {
    const { id } = req.params;

    const store = await Store.findById(id);
    if (!store) {
      const error = new Error("Store not found");
      error.status = 404;
      throw error;
    }

    // Vendors may only delete their own store
    if (!ownsStore(req, store)) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }

    await store.deleteOne();

    res.json({ success: true, message: "Store deleted successfully" });
  } catch (err) {
    next(err);
  }
};

/* =========================================
   EXPORT ALL CONTROLLERS
========================================= */
export default {
  createStore,
  getAllStores,
  getStoreBySlug,
  getStoreByVendor,
  updateStore,
  deleteStore,
};