// src/controllers/publicStoreController.js
//
// Legacy public store endpoints. These are NOT the brand discovery API, but
// they expose store data, so they must apply the same eligibility rules:
// approved brand + discovery enabled + approved vendor. Without this, an
// unapproved brand profile could be read through an older endpoint.

import Store from "../models/Store.js";
import Product from "../models/Product.js";
import Vendor from "../models/Vendor.js";

const eligibleFilter = { approvalStatus: "APPROVED", discoveryEligible: true };

const approvedVendorIds = async () => {
  const ids = await Vendor.find({ status: "APPROVED" }).distinct("_id");
  return ids;
};

export const listStores = async (_req, res, next) => {
  try {
    const vendorIds = await approvedVendorIds();
    const stores = await Store.find({ ...eligibleFilter, vendor: { $in: vendorIds } })
      .select("storeName storeSlug description logo banner")
      .sort({ createdAt: -1 });

    res.json({ success: true, count: stores.length, stores });
  } catch (err) {
    next(err);
  }
};

export const getStoreDetails = async (req, res, next) => {
  try {
    const { slug } = req.params;

    const store = await Store.findOne({ storeSlug: slug, ...eligibleFilter });
    if (!store) {
      const error = new Error("Store not found");
      error.status = 404;
      throw error;
    }
    const vendor = await Vendor.findOne({ _id: store.vendor, status: "APPROVED" }).select("_id");
    if (!vendor) {
      const error = new Error("Store not found");
      error.status = 404;
      throw error;
    }

    res.json({ success: true, store });
  } catch (err) {
    next(err);
  }
};

export const listStoreProducts = async (req, res, next) => {
  try {
    const { slug } = req.params;

    const store = await Store.findOne({ storeSlug: slug, ...eligibleFilter });
    if (!store) {
      const error = new Error("Store not found");
      error.status = 404;
      throw error;
    }
    const vendor = await Vendor.findOne({ _id: store.vendor, status: "APPROVED" }).select("_id");
    if (!vendor) {
      const error = new Error("Store not found");
      error.status = 404;
      throw error;
    }

    const products = await Product.find({ store: store._id, isActive: true }).sort({
      createdAt: -1,
    });

    res.json({ success: true, store, products });
  } catch (err) {
    next(err);
  }
};
