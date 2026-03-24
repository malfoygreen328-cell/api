import Store from "../models/Store.js";
import Product from "../models/Product.js";

/* =========================================
   LIST ALL STORES (Public)
========================================= */
export const listStores = async (req, res, next) => {
  try {
    const stores = await Store.find()
      .select("storeName storeSlug description logo banner")
      .sort({ createdAt: -1 });

    res.json({ success: true, count: stores.length, stores });
  } catch (err) {
    next(err);
  }
};

/* =========================================
   GET STORE DETAILS BY SLUG (Public)
========================================= */
export const getStoreDetails = async (req, res, next) => {
  try {
    const { slug } = req.params;

    const store = await Store.findOne({ storeSlug: slug });
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
   LIST PRODUCTS FOR A STORE (Public)
========================================= */
export const listStoreProducts = async (req, res, next) => {
  try {
    const { slug } = req.params;

    const store = await Store.findOne({ storeSlug: slug });
    if (!store) {
      const error = new Error("Store not found");
      error.status = 404;
      throw error;
    }

    const products = await Product.find({ store: store._id, isActive: true })
      .sort({ createdAt: -1 });

    res.json({ success: true, store, products });
  } catch (err) {
    next(err);
  }
};