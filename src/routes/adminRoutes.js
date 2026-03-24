// src/routes/adminRoutes.js
import express from "express";
import mongoose from "mongoose";
import Vendor from "../models/Vendor.js";
import Order from "../models/Order.js";
import { protect, requireRole } from "../middleware/authMiddleware.js";

const router = express.Router();

/* ---------------- AUTH & ROLE PROTECTION ---------------- */
router.use(protect, requireRole("admin"));

/* ---------------- HELPERS ---------------- */
const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

/* ---------------- VENDOR MANAGEMENT ---------------- */

// GET: List pending vendors
router.get("/vendors/pending", async (req, res, next) => {
  try {
    const vendors = await Vendor.find({ status: "PENDING" }).sort({ createdAt: -1 });

    res.json({
      success: true,
      count: vendors.length,
      vendors,
    });
  } catch (error) {
    next(error);
  }
});

// PATCH: Approve vendor
router.patch("/vendors/:id/approve", async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid vendor ID" });
    }

    const vendor = await Vendor.findById(id);

    if (!vendor) {
      return res.status(404).json({ success: false, message: "Vendor not found" });
    }

    if (vendor.status === "APPROVED") {
      return res.status(400).json({
        success: false,
        message: "Vendor already approved",
      });
    }

    vendor.status = "APPROVED";
    await vendor.save();

    // 🧾 Audit log (basic)
    console.log(`ADMIN ${req.user.id} approved vendor ${vendor._id}`);

    res.json({
      success: true,
      message: "Vendor approved successfully",
      vendor,
    });
  } catch (error) {
    next(error);
  }
});

// PATCH: Reject vendor
router.patch("/vendors/:id/reject", async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid vendor ID" });
    }

    const vendor = await Vendor.findById(id);

    if (!vendor) {
      return res.status(404).json({ success: false, message: "Vendor not found" });
    }

    if (vendor.status === "REJECTED") {
      return res.status(400).json({
        success: false,
        message: "Vendor already rejected",
      });
    }

    vendor.status = "REJECTED";
    await vendor.save();

    console.log(`ADMIN ${req.user.id} rejected vendor ${vendor._id}`);

    res.json({
      success: true,
      message: "Vendor rejected successfully",
      vendor,
    });
  } catch (error) {
    next(error);
  }
});

/* ---------------- ORDER MANAGEMENT ---------------- */

// GET: List all orders (paginated)
router.get("/orders", async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;

    const skip = (page - 1) * limit;

    const orders = await Order.find()
      .populate("customer", "fullName email")
      .populate("items.product", "name price")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Order.countDocuments();

    res.json({
      success: true,
      page,
      pages: Math.ceil(total / limit),
      count: orders.length,
      total,
      orders,
    });
  } catch (error) {
    next(error);
  }
});

// PUT: Update order status
router.put("/orders/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid order ID" });
    }

    if (!status) {
      return res.status(400).json({
        success: false,
        message: "Status is required",
      });
    }

    const validStatuses = [
      "pending",
      "paid",
      "processing",
      "shipped",
      "delivered",
      "cancelled",
    ];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid order status",
      });
    }

    const order = await Order.findById(id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // 🚨 Prevent invalid transitions (important)
    if (order.status === "delivered") {
      return res.status(400).json({
        success: false,
        message: "Delivered orders cannot be changed",
      });
    }

    order.status = status;
    await order.save();

    console.log(`ADMIN ${req.user.id} updated order ${order._id} → ${status}`);

    res.json({
      success: true,
      message: "Order status updated successfully",
      order,
    });
  } catch (error) {
    next(error);
  }
});

export default router;