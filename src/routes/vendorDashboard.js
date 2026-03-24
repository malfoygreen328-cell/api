import express from "express";
import { verifyToken, requireRole } from "../middleware/authMiddleware.js";
import Product from "../models/Product.js";
import Order from "../models/Order.js";

const router = express.Router();

// Protect all vendor routes
router.use(verifyToken, requireRole("vendor_owner"));

/* ---------------- PRODUCTS ---------------- */

// Get all products for vendor
router.get("/products", async (req, res) => {
  try {
    const products = await Product.find({ vendor: req.user._id });
    res.json({ products });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch products", error: error.message });
  }
});

// Add a new product (enforce subscription limit)
router.post("/products", async (req, res) => {
  try {
    const currentCount = await Product.countDocuments({ vendor: req.user._id });
    if (req.user.subscriptionPlan === "Basic" && currentCount >= req.user.subscriptionLimit) {
      return res.status(403).json({ message: "Basic plan limit reached. Upgrade to Premium for unlimited products." });
    }

    const { name, description, price } = req.body;
    if (!name || !price) return res.status(400).json({ message: "Name and price required" });

    const product = new Product({
      name,
      description,
      price,
      vendor: req.user._id,
    });

    await product.save();
    res.status(201).json({ message: "Product added successfully", product });
  } catch (error) {
    res.status(500).json({ message: "Failed to add product", error: error.message });
  }
});

/* ---------------- ORDERS ---------------- */

// Get all orders for vendor
router.get("/orders", async (req, res) => {
  try {
    const orders = await Order.find({ "items.vendor": req.user._id }).populate("customer", "fullName email");
    res.json({ orders });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch orders", error: error.message });
  }
});

// Get revenue for vendor
router.get("/revenue", async (req, res) => {
  try {
    const orders = await Order.find({ "items.vendor": req.user._id });
    const revenue = orders.reduce((sum, order) => {
      const vendorItems = order.items.filter(i => i.vendor.toString() === req.user._id.toString());
      return sum + vendorItems.reduce((s, i) => s + i.price * i.quantity, 0);
    }, 0);

    res.json({ revenue });
  } catch (error) {
    res.status(500).json({ message: "Failed to calculate revenue", error: error.message });
  }
});

export default router;