// src/routes/adminAuthRoutes.js
import express from "express";
import mongoose from "mongoose";
import Vendor from "../models/Vendor.js";
import Order from "../models/Order.js";
import { protect, requireRole } from "../middleware/authMiddleware.js";
import { loginAdmin, getAdminProfile } from "../controllers/adminController.js";
import { syncBrandDiscoveryEligibility } from "../services/brandEligibilityService.js";
import {
  requestPasswordReset,
  resetPassword,
} from "../controllers/adminAuthController.js";

const router = express.Router();

/* =========================================
   PUBLIC AUTH ROUTES
   These MUST be declared before the protect()
   wall below, otherwise login/reset are blocked.
======================================== */

// POST /api/admin/auth/login
router.post("/login", loginAdmin);

// POST /api/admin/auth/request-password-reset
router.post("/request-password-reset", requestPasswordReset);

// PUT /api/admin/auth/reset-password/:token
router.put("/reset-password/:token", resetPassword);

// POST /api/admin/auth/logout
router.post("/logout", (req, res) => {
  res.clearCookie("azania_token", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    path: "/",
  });
  res.json({ success: true, message: "Logged out" });
});

/* =========================================
   AUTH & ROLE PROTECTION
   Everything below is admin-only
======================================== */
router.use(protect, requireRole("admin", "superadmin"));

// GET /api/admin/auth/profile
router.get("/profile", getAdminProfile);

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
    await syncBrandDiscoveryEligibility(vendor._id);

    res.json({ success: true, message: "Vendor approved successfully", vendor });
  } catch (error) {
    console.error("Approve vendor error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to approve vendor",

    });
  }
});

// PATCH: Reject a vendor
router.patch("/vendors/:id/reject", async (req, res) => {
  try {
    const vendor = await Vendor.findById(req.params.id);
    if (!vendor)
      return res.status(404).json({ success: false, message: "Vendor not found" });

    vendor.status = "DECLINED";
    await vendor.save();

    res.json({ success: true, message: "Vendor rejected successfully", vendor });
  } catch (error) {
    console.error("Reject vendor error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to reject vendor",

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

    });
  }
});

// PUT: Update order status (validated transitions, id checked)
router.put("/orders/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid order ID" });
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

    const order = await Order.findById(id);
    if (!order)
      return res.status(404).json({ success: false, message: "Order not found" });

    const validTransitions = {
      pending: ["paid", "cancelled"],
      paid: ["processing", "cancelled"],
      processing: ["shipped"],
      shipped: ["delivered"],
      delivered: [],
    };

    if (order.status !== status) {
      const allowed = validTransitions[order.status] || [];
      if (!allowed.includes(status)) {
        return res.status(400).json({
          success: false,
          message: `Invalid status transition from ${order.status} to ${status}`,
        });
      }
    }

    order.status = status;
    await order.save();

    res.json({ success: true, message: "Order status updated successfully", order });
  } catch (error) {
    console.error("Update order error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update order",
    });
  }
});

export default router;
