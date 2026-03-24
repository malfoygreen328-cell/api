import express from "express";
import Product from "../models/Product.js";
import { protect, requireRole } from "../middleware/authMiddleware.js";

const router = express.Router();

/* =====================================================
   SEARCH PRODUCTS (Public)
   GET /api/products/search?q=cap
===================================================== */
router.get("/search", async (req, res) => {
  try {
    const query = req.query.q;

    if (!query) {
      return res.status(400).json({
        success: false,
        message: "Search query is required",
      });
    }

    const products = await Product.find(
      { $text: { $search: query }, isActive: true },
      { score: { $meta: "textScore" } }
    )
      .sort({ score: { $meta: "textScore" } })
      .limit(20);

    res.json({
      success: true,
      data: products,
    });
  } catch (error) {
    console.error("Search error:", error.message);
    res.status(500).json({
      success: false,
      message: "Search failed",
    });
  }
});

/* =====================================================
   GET ALL PRODUCTS (Public)
   GET /api/products
===================================================== */
router.get("/", async (req, res) => {
  try {
    const products = await Product.find({ isActive: true });

    res.json({
      success: true,
      data: products,
    });
  } catch (error) {
    console.error("Load products error:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to load products",
    });
  }
});

/* =====================================================
   CREATE PRODUCT (Private — vendor_owner only)
   POST /api/products
===================================================== */
router.post(
  "/",
  protect,
  requireRole("vendor_owner"),
  async (req, res) => {
    try {
      const { name, description, price, stock, storeId } = req.body;

      if (!name || !description || !price || stock === undefined || !storeId) {
        return res.status(400).json({
          success: false,
          message: "All product fields are required",
        });
      }

      const product = new Product({
        store: storeId,
        name,
        description,
        price,
        stock,
      });

      await product.save();

      res.status(201).json({
        success: true,
        message: "Product created successfully",
        product,
      });
    } catch (error) {
      console.error("Create product error:", error.message);
      res.status(500).json({
        success: false,
        message: "Failed to create product",
      });
    }
  }
);

/* =====================================================
   UPDATE PRODUCT (Private — vendor_owner or admin)
   PUT /api/products/:id
===================================================== */
router.put(
  "/:id",
  protect,
  requireRole("vendor_owner", "admin"),
  async (req, res) => {
    try {
      const { name, description, price, stock } = req.body;

      const product = await Product.findById(req.params.id);

      if (!product) {
        return res.status(404).json({
          success: false,
          message: "Product not found",
        });
      }

      if (name) product.name = name;
      if (description) product.description = description;
      if (price !== undefined) product.price = price;
      if (stock !== undefined) product.stock = stock;

      await product.save();

      res.json({
        success: true,
        message: "Product updated successfully",
        product,
      });
    } catch (error) {
      console.error("Update product error:", error.message);
      res.status(500).json({
        success: false,
        message: "Failed to update product",
      });
    }
  }
);

/* =====================================================
   DELETE PRODUCT (Private — vendor_owner or admin)
   DELETE /api/products/:id
===================================================== */
router.delete(
  "/:id",
  protect,
  requireRole("vendor_owner", "admin"),
  async (req, res) => {
    try {
      const product = await Product.findById(req.params.id);

      if (!product) {
        return res.status(404).json({
          success: false,
          message: "Product not found",
        });
      }

      await product.deleteOne();

      res.json({
        success: true,
        message: "Product deleted successfully",
      });
    } catch (error) {
      console.error("Delete product error:", error.message);
      res.status(500).json({
        success: false,
        message: "Failed to delete product",
      });
    }
  }
);

export default router;