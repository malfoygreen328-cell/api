import Store from "../models/Store.js";
import slugify from "slugify";

/* =========================================
   CREATE STORE
   Protected: vendor only
========================================= */
export const createStore = async (req, res, next) => {
  try {
    const { storeName, description, themeColor, socialLinks } = req.body;
    const vendorId = req.user?._id;

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
      description,
      themeColor,
      socialLinks,
      storeSlug: slugify(storeName, { lower: true, strict: true }),
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
   GET ALL STORES
   Public endpoint
========================================= */
export const getAllStores = async (req, res, next) => {
  try {
    const stores = await Store.find().populate("vendor", "name").sort({ createdAt: -1 });

    res.json({
      success: true,
      count: stores.length,
      stores,
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

    const store = await Store.findOne({ storeSlug: slug }).populate("vendor", "name email");
    if (!store) {
      const error = new Error("Store not found");
      error.status = 404;
      throw error;
    }

    res.json({ success: true, store });
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
    const updateData = { ...req.body };

    if (updateData.storeName) {
      updateData.storeSlug = slugify(updateData.storeName, { lower: true, strict: true });
    }

    const store = await Store.findByIdAndUpdate(id, updateData, { new: true, runValidators: true });

    if (!store) {
      const error = new Error("Store not found");
      error.status = 404;
      throw error;
    }

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

    const store = await Store.findByIdAndDelete(id);
    if (!store) {
      const error = new Error("Store not found");
      error.status = 404;
      throw error;
    }

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