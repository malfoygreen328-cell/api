// src/routes/adminRoutes.js
import express from "express";
import Vendor from "../models/Vendor.js";
import Order from "../models/Order.js";
import { protect, requireRole } from "../middleware/authMiddleware.js";

const router = express.Router();

/* =========================================
   AUTH & ROLE PROTECTION
   All routes are admin-only
========================================= */
router.use(protect, requireRole("admin", "superadmin"));

/* =========================================
   VENDOR MANAGEMENT
========================================= */

// GET: List all pending vendors
router.get("/vendors/pending", async (req, res) => {
  try {
    const pendingVendors = await Vendor.find({ status: "PENDING" });
    res.json({
      success: true,
      count: pendingVendors.length,
      vendors: pendingVendors,
    });
  } catch (error) {
    console.error("Fetch pending vendors error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch vendors",
      error: error.message,
    });
  }
});

// PATCH: Approve a vendor
router.patch("/vendors/:id/approve", async (req, res) => {
  try {
    const vendor = await Vendor.findById(req.params.id);
    if (!vendor)
      return res.status(404).json({ success: false, message: "Vendor not found" });

    vendor.status = "APPROVED";
    await vendor.save();

    res.json({ success: true, message: "Vendor approved successfully", vendor });
  } catch (error) {
    console.error("Approve vendor error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to approve vendor",
      error: error.message,
    });
  }
});

// PATCH: Reject a vendor
router.patch("/vendors/:id/reject", async (req, res) => {
  try {
    const vendor = await Vendor.findById(req.params.id);
    if (!vendor)
      return res.status(404).json({ success: false, message: "Vendor not found" });

    vendor.status = "REJECTED";
    await vendor.save();

    res.json({ success: true, message: "Vendor rejected successfully", vendor });
  } catch (error) {
    console.error("Reject vendor error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to reject vendor",
      error: error.message,
    });
  }
});

/* =========================================
   ORDER MANAGEMENT
========================================= */

// GET: List all orders with customer and product info
router.get("/orders", async (req, res) => {
  try {
    const orders = await Order.find()
      .populate("customer", "fullName email")
      .populate("items.product", "name price");

    res.json({
      success: true,
      count: orders.length,
      orders,
    });
  } catch (error) {
    console.error("Fetch orders error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch orders",
      error: error.message,
    });
  }
});

// PUT: Update order status
router.put("/orders/:id", async (req, res) => {
  try {
    const { status } = req.body;
    if (!status)
      return res.status(400).json({ success: false, message: "Status is required" });

    const validStatuses = [
      "pending",
      "paid",
      "processing",
      "shipped",
      "delivered",
      "cancelled",
    ];
    if (!validStatuses.includes(status))
      return res.status(400).json({ success: false, message: "Invalid order status" });

    const order = await Order.findById(req.params.id);
    if (!order)
      return res.status(404).json({ success: false, message: "Order not found" });

    order.status = status;
    await order.save();

    res.json({ success: true, message: "Order status updated successfully", order });
  } catch (error) {
    console.error("Update order error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update order",
      error: error.message,
    });
  }
});

export default router;