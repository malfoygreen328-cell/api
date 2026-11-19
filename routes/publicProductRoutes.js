import express from "express";
import Product from "../models/Product.js";
import Store from "../models/Store.js";

const router = express.Router();

/**
 * GET /api/products
 * Public: List all active products with pagination, search, filters
 */
router.get("/", async (req, res) => {
  try {
    let { page = 1, limit = 20, search = "", minPrice, maxPrice } = req.query;
    page = parseInt(page) || 1;
    limit = parseInt(limit) || 20;
    page = Math.max(1, page);
    limit = Math.min(100, Math.max(1, limit)); // cap to 100 max

    const filter = { isActive: true };

    if (search) {
      filter.name = { $regex: search, $options: "i" };
    }

    if (minPrice || maxPrice) {
      filter.price = {};
      if (minPrice) filter.price.$gte = parseFloat(minPrice);
      if (maxPrice) filter.price.$lte = parseFloat(maxPrice);
    }

    const total = await Product.countDocuments(filter);
    const products = await Product.find(filter)
      .populate("store", "storeName storeSlug")
      .skip((page - 1) * limit)
      .limit(limit)
      .sort({ createdAt: -1 });

    res.json({
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      products,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch products", error: error.message });
  }
});

/**
 * GET /api/products/:id
 * Public: Get product details
 */
router.get("/:id", async (req, res) => {
  try {
    const product = await Product.findById(req.params.id)
      .populate("store", "storeName storeSlug description");
    if (!product) return res.status(404).json({ message: "Product not found" });
    res.json(product);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch product", error: error.message });
  }
});

export default router;