import mongoose from "mongoose";
import Product from "../models/Product.js";
import Store from "../models/Store.js";
import Vendor from "../models/Vendor.js";
import { getPlanConfig, getVendorSubscriptionStatus } from "../config/platformConfig.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

const isAdmin = (user) => ADMIN_ROLES.has(user?.role);

const requestVendorId = (user) =>
  String(user?.vendor || (user?.constructor?.modelName === "Vendor" ? user._id : "") || "");

const publicProduct = (product) => product;

const validateProductInput = (body = {}, { requireAll = true } = {}) => {
  const { name, description, price, stock } = body;

  if ((requireAll || name !== undefined) && (!name || !String(name).trim())) {
    return "Product name is required";
  }
  if (name !== undefined && String(name).trim().length > 120) {
    return "Product name is too long";
  }
  if (requireAll || price !== undefined) {
    if (price === undefined || !Number.isFinite(Number(price)) || Number(price) <= 0) {
      return "Price must be a positive number";
    }
  }
  if (requireAll || stock !== undefined) {
    if (stock === undefined || !Number.isInteger(Number(stock)) || Number(stock) < 0) {
      return "Stock must be a non-negative whole number";
    }
  }
  if (description !== undefined && String(description).length > 2000) {
    return "Description is too long";
  }
  return null;
};

const metadataFromBody = (body = {}) => {
  const metadata = {};
  const strings = ["category", "subcategory", "productType", "color", "size", "brand"];
  for (const key of strings) {
    if (body[key] !== undefined) metadata[key] = String(body[key]).trim().slice(0, 120);
  }
  const arrays = ["tags", "colors", "sizes"];
  for (const key of arrays) {
    if (Array.isArray(body[key])) {
      metadata[key] = body[key].slice(0, 20).map((v) => String(v).trim().slice(0, 60));
    }
  }
  if (body.attributes && typeof body.attributes === "object" && !Array.isArray(body.attributes)) {
    metadata.attributes = body.attributes;
  }
  if (body.salePrice !== undefined) {
    const salePrice = Number(body.salePrice);
    if (Number.isFinite(salePrice) && salePrice >= 0) metadata.salePrice = salePrice;
  }
  if (body.featured !== undefined) metadata.featured = Boolean(body.featured);
  if (body.trending !== undefined) metadata.trending = Boolean(body.trending);
  if (Array.isArray(body.images)) {
    metadata.images = body.images.slice(0, 10).map((i) => String(i).slice(0, 500));
  }
  return metadata;
};

const findOwnedProduct = async (req, id) => {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  const product = await Product.findById(id);
  if (!product) return null;
  if (isAdmin(req.user)) return product;

  const vendorId = requestVendorId(req.user);
  if (!vendorId) return null;
  if (product.vendor?.toString() === vendorId) return product;

  const store = await Store.findById(product.store).select("vendor");
  return store && store.vendor?.toString() === vendorId ? product : null;
};

const resolveOwnedStore = async (req, storeId) => {
  if (!mongoose.Types.ObjectId.isValid(storeId)) {
    return { error: "Invalid store id" };
  }
  const store = await Store.findById(storeId);
  if (!store) return { error: "Store not found" };

  if (isAdmin(req.user)) return { store };

  const vendorId = requestVendorId(req.user);
  if (!vendorId || store.vendor?.toString() !== vendorId) {
    return { error: "You can only add products to your own store", forbidden: true };
  }
  return { store };
};

const resolveListingVendor = async (req, store) => {
  if (isAdmin(req.user)) return { vendor: null, isAdmin: true };
  const vendorId = store.vendor?.toString() || requestVendorId(req.user);
  if (!vendorId) return { error: "Vendor account not found", forbidden: true };
  const vendor = await Vendor.findById(vendorId);
  if (!vendor) return { error: "Vendor account not found", forbidden: true };
  return { vendor, isAdmin: false };
};

const assertSubscriptionAndLimit = (vendor, isAdminUser) => {
  if (isAdminUser) return { limit: Number.MAX_SAFE_INTEGER };
  const subscription = getVendorSubscriptionStatus(vendor);
  if (!subscription.active) {
    return {
      error:
        "An active subscription or trial is required to manage listings. Please renew your plan.",
      code: "SUBSCRIPTION_REQUIRED",
    };
  }
  return { limit: getPlanConfig(vendor.subscriptionPlan).productLimit };
};

const buildProductData = (store, vendorId, body) => ({
  store: store._id,
  vendor: store.vendor || vendorId,
  name: String(body.name).trim().slice(0, 120),
  description: String(body.description || "").trim().slice(0, 2000),
  price: Number(body.price),
  stock: Number(body.stock),
  ...metadataFromBody(body),
});

/* =========================================
   SEARCH PRODUCTS (Public)
========================================= */
export const searchProducts = async (req, res, next) => {
  try {
    const query = String(req.query.q || "").trim().slice(0, 120);

    if (!query) {
      return res.status(400).json({ success: false, message: "Search query is required" });
    }

    const products = await Product.find(
      { $text: { $search: query }, isActive: true },
      { score: { $meta: "textScore" } }
    )
      .sort({ score: { $meta: "textScore" } })
      .limit(20);

    res.json({ success: true, data: products });
  } catch (error) {
    next(error);
  }
};

/* =========================================
   GET ALL PRODUCTS (Public, active only)
========================================= */
export const listProducts = async (req, res, next) => {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 100));
    const products = await Product.find({ isActive: true })
      .limit(limit)
      .populate("store", "storeName storeSlug")
      .lean();
    // Expose a stable brand link without changing the legacy `store` id shape.
    const data = products.map((product) => {
      if (product.store && typeof product.store === "object") {
        return {
          ...product,
          storeName: product.store.storeName || "",
          storeSlug: product.store.storeSlug || "",
          store: product.store._id,
        };
      }
      return product;
    });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

/* =========================================
   GET PRODUCTS BY STORE (Public; owner sees inactive)
========================================= */
export const listProductsByStore = async (req, res, next) => {
  try {
    const { storeId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(storeId)) {
      return res.status(400).json({ success: false, message: "Invalid store id" });
    }

    const store = await Store.findById(storeId).select("vendor");
    if (!store) {
      return res.status(404).json({ success: false, message: "Store not found" });
    }

    const vendorId = requestVendorId(req.user);
    const ownerView =
      isAdmin(req.user) ||
      (vendorId && store.vendor?.toString() === vendorId);

    const filter = { store: storeId };
    if (!ownerView) filter.isActive = true;

    const products = await Product.find(filter).sort({ createdAt: -1 });
    res.json({ success: true, data: products });
  } catch (error) {
    next(error);
  }
};

/* =========================================
   GET PRODUCTS IN CATEGORY (Public)
========================================= */
export const listProductsByCategory = async (req, res, next) => {
  try {
    const category = String(req.params.category || "").trim().slice(0, 120);
    if (!category) {
      return res.status(400).json({ success: false, message: "Category is required" });
    }
    const products = await Product.find({ category, isActive: true }).limit(200);
    res.json({ success: true, data: products });
  } catch (error) {
    next(error);
  }
};

/* =========================================
   GET OWN PRODUCTS (Vendor)
========================================= */
export const listVendorProducts = async (req, res, next) => {
  try {
    const vendorId = requestVendorId(req.user);
    if (!vendorId && !isAdmin(req.user)) {
      return res.status(403).json({ success: false, message: "Vendor access only" });
    }
    const filter = vendorId ? { vendor: vendorId } : {};
    const products = await Product.find(filter).sort({ createdAt: -1 });
    res.json({ success: true, data: products });
  } catch (error) {
    next(error);
  }
};

/* =========================================
   GET SINGLE PRODUCT
   Public for active products; owners/admins also see inactive products.
========================================= */
export const getProductById = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid product id" });
    }
    const product = await Product.findById(id);
    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }
    if (!product.isActive) {
      const owned = await findOwnedProduct(req, id);
      if (!owned) {
        return res.status(404).json({ success: false, message: "Product not found" });
      }
    }
    res.json({ success: true, data: publicProduct(product) });
  } catch (error) {
    next(error);
  }
};

/* =========================================
   LOW STOCK (Vendor)
========================================= */
export const getLowStockProducts = async (req, res, next) => {
  try {
    const vendorId = requestVendorId(req.user);
    if (!vendorId && !isAdmin(req.user)) {
      return res.status(403).json({ success: false, message: "Vendor access only" });
    }
    const threshold = Math.max(0, parseInt(req.query.threshold, 10) || 10);
    const filter = { stock: { $lte: threshold } };
    if (vendorId) filter.vendor = vendorId;
    const products = await Product.find(filter).sort({ stock: 1 }).limit(200);
    res.json({ success: true, data: products, threshold });
  } catch (error) {
    next(error);
  }
};

/* =========================================
   CREATE PRODUCT (vendor_owner | admin)
   The store must belong to the requesting vendor.
========================================= */
export const createProduct = async (req, res, next) => {
  try {
    const inputError = validateProductInput(req.body);
    if (inputError) {
      return res.status(400).json({ success: false, message: inputError });
    }

    const { store, error, forbidden } = await resolveOwnedStore(req, req.body.storeId);
    if (error) {
      return res.status(forbidden ? 403 : 400).json({ success: false, message: error });
    }

    const resolved = await resolveListingVendor(req, store);
    if (resolved.error) {
      return res.status(resolved.forbidden ? 403 : 400).json({
        success: false,
        message: resolved.error,
      });
    }

    const limitInfo = assertSubscriptionAndLimit(resolved.vendor, resolved.isAdmin);
    if (limitInfo.error) {
      return res.status(403).json({
        success: false,
        message: limitInfo.error,
        code: limitInfo.code,
      });
    }

    const vendorId = store.vendor || requestVendorId(req.user);
    const count = await Product.countDocuments({ vendor: vendorId });
    if (count >= limitInfo.limit) {
      return res.status(403).json({
        success: false,
        message: `Listing limit reached. Your plan allows ${limitInfo.limit} products.`,
        code: "LISTING_LIMIT_REACHED",
      });
    }

    const product = await Product.create(buildProductData(store, vendorId, req.body));

    if (!resolved.isAdmin) {
      const countAfter = await Product.countDocuments({ vendor: vendorId });
      if (countAfter > limitInfo.limit) {
        await product.deleteOne();
        return res.status(403).json({
          success: false,
          message: `Listing limit reached. Your plan allows ${limitInfo.limit} products.`,
          code: "LISTING_LIMIT_REACHED",
        });
      }
    }

    res.status(201).json({ success: true, message: "Product created successfully", product });
  } catch (error) {
    next(error);
  }
};

/* =========================================
   BULK CREATE (Vendor | admin)
========================================= */
export const bulkCreateProducts = async (req, res, next) => {
  try {
    const items = req.body?.products;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: "products must be a non-empty array" });
    }
    if (items.length > 100) {
      return res.status(400).json({ success: false, message: "A maximum of 100 products can be uploaded at once" });
    }

    const prepared = [];
    for (const item of items) {
      const inputError = validateProductInput(item);
      if (inputError) {
        return res.status(400).json({ success: false, message: inputError });
      }
      const { store, error, forbidden } = await resolveOwnedStore(req, item.storeId);
      if (error) {
        return res.status(forbidden ? 403 : 400).json({ success: false, message: error });
      }
      const resolved = await resolveListingVendor(req, store);
      if (resolved.error) {
        return res.status(resolved.forbidden ? 403 : 400).json({
          success: false,
          message: resolved.error,
        });
      }
      const limitInfo = assertSubscriptionAndLimit(resolved.vendor, resolved.isAdmin);
      if (limitInfo.error) {
        return res.status(403).json({
          success: false,
          message: limitInfo.error,
          code: limitInfo.code,
        });
      }
      prepared.push({
        store,
        vendorId: store.vendor || requestVendorId(req.user),
        limit: limitInfo.limit,
        isAdmin: resolved.isAdmin,
        data: buildProductData(store, store.vendor || requestVendorId(req.user), item),
      });
    }

    const groups = new Map();
    for (const entry of prepared) {
      const key = entry.vendorId.toString();
      const group = groups.get(key) || { vendorId: entry.vendorId, limit: entry.limit, isAdmin: entry.isAdmin, entries: [] };
      group.entries.push(entry);
      groups.set(key, group);
    }

    for (const group of groups.values()) {
      if (group.isAdmin) continue;
      const count = await Product.countDocuments({ vendor: group.vendorId });
      if (count + group.entries.length > group.limit) {
        return res.status(403).json({
          success: false,
          message: `Listing limit reached. Your plan allows ${group.limit} products.`,
          code: "LISTING_LIMIT_REACHED",
        });
      }
    }

    const created = await Product.insertMany(prepared.map((entry) => entry.data));

    for (const group of groups.values()) {
      if (group.isAdmin) continue;
      const countAfter = await Product.countDocuments({ vendor: group.vendorId });
      if (countAfter > group.limit) {
        const ids = created
          .filter((doc) => doc.vendor?.toString() === group.vendorId.toString())
          .map((doc) => doc._id);
        await Product.deleteMany({ _id: { $in: ids } });
        return res.status(403).json({
          success: false,
          message: `Listing limit reached. Your plan allows ${group.limit} products.`,
          code: "LISTING_LIMIT_REACHED",
        });
      }
    }

    res.status(201).json({
      success: true,
      message: `${created.length} products created successfully`,
      data: created,
      products: created,
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================
   UPDATE PRODUCT (owner | admin)
========================================= */
export const updateProduct = async (req, res, next) => {
  try {
    const product = await findOwnedProduct(req, req.params.id);
    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    const inputError = validateProductInput(req.body, { requireAll: false });
    if (inputError) {
      return res.status(400).json({ success: false, message: inputError });
    }

    const { name, description, price, stock, isActive } = req.body;

    if (name !== undefined) product.name = String(name).trim().slice(0, 120);
    if (description !== undefined) product.description = String(description).trim().slice(0, 2000);
    if (stock !== undefined) product.stock = Number(stock);
    if (price !== undefined) product.price = Number(price);
    if (isActive !== undefined) product.isActive = Boolean(isActive);

    const metadata = metadataFromBody(req.body);
    for (const [key, value] of Object.entries(metadata)) {
      product[key] = value;
    }

    await product.save();
    res.json({ success: true, message: "Product updated successfully", product });
  } catch (error) {
    next(error);
  }
};

/* =========================================
   PARTIAL UPDATES (stock / price / status)
========================================= */
export const updateProductStock = async (req, res, next) => {
  try {
    const stock = Number(req.body?.stock);
    if (!Number.isInteger(stock) || stock < 0) {
      return res.status(400).json({ success: false, message: "Stock must be a non-negative whole number" });
    }
    const product = await findOwnedProduct(req, req.params.id);
    if (!product) return res.status(404).json({ success: false, message: "Product not found" });
    product.stock = stock;
    await product.save();
    res.json({ success: true, product });
  } catch (error) {
    next(error);
  }
};

export const updateProductPrice = async (req, res, next) => {
  try {
    const price = Number(req.body?.price);
    if (!Number.isFinite(price) || price <= 0) {
      return res.status(400).json({ success: false, message: "Price must be a positive number" });
    }
    const product = await findOwnedProduct(req, req.params.id);
    if (!product) return res.status(404).json({ success: false, message: "Product not found" });
    product.price = price;
    await product.save();
    res.json({ success: true, product });
  } catch (error) {
    next(error);
  }
};

export const toggleProductStatus = async (req, res, next) => {
  try {
    const { isActive } = req.body || {};
    if (typeof isActive !== "boolean") {
      return res.status(400).json({ success: false, message: "isActive must be a boolean" });
    }
    const product = await findOwnedProduct(req, req.params.id);
    if (!product) return res.status(404).json({ success: false, message: "Product not found" });
    product.isActive = isActive;
    await product.save();
    res.json({ success: true, product });
  } catch (error) {
    next(error);
  }
};

export const uploadProductImage = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "An image file is required" });
    }
    if (!String(req.file.mimetype || "").startsWith("image/")) {
      return res.status(400).json({ success: false, message: "Only image uploads are allowed here" });
    }

    const product = await findOwnedProduct(req, req.params.id);
    if (!product) return res.status(404).json({ success: false, message: "Product not found" });

    const imageUrl = `/uploads/${req.file.filename}`;
    product.images = [...(product.images || []), imageUrl].slice(-10);
    await product.save();

    res.status(201).json({ success: true, message: "Image uploaded", imageUrl, images: product.images });
  } catch (error) {
    next(error);
  }
};

/* =========================================
   DELETE PRODUCT (owner | admin)
========================================= */
export const deleteProduct = async (req, res, next) => {
  try {
    const product = await findOwnedProduct(req, req.params.id);
    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    await product.deleteOne();
    res.json({ success: true, message: "Product deleted successfully" });
  } catch (error) {
    next(error);
  }
};
