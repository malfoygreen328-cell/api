import express from "express";
import Vendor from "../models/Vendor.js";
import Order from "../models/Order.js";
import { protect, requireRole } from "../middleware/authMiddleware.js";

const router = express.Router();

// ---------------- AUTH & ROLE PROTECTION ----------------
// All routes in this router are accessible by admin only
router.use(protect, requireRole("admin"));

/* ---------------- VENDOR MANAGEMENT ---------------- */

// List pending vendors
router.get("/vendors/pending", async (req, res) => {
  try {
    const pendingVendors = await Vendor.find({ status: "PENDING" });
    res.json({ success: true, data: pendingVendors });
  } catch (error) {
    console.error("Fetch pending vendors error:", error.message);
    res.status(500).json({ success: false, message: "Failed to fetch vendors", error: error.message });
  }
});

// Approve vendor
router.patch("/vendors/:id/approve", async (req, res) => {
  try {
    const vendor = await Vendor.findById(req.params.id);
    if (!vendor) return res.status(404).json({ success: false, message: "Vendor not found" });

    vendor.status = "APPROVED";
    await vendor.save();

    res.json({ success: true, message: "Vendor approved", vendor });
  } catch (error) {
    console.error("Approve vendor error:", error.message);
    res.status(500).json({ success: false, message: "Failed to approve vendor", error: error.message });
  }
});

// Reject vendor
router.patch("/vendors/:id/reject", async (req, res) => {
  try {
    const vendor = await Vendor.findById(req.params.id);
    if (!vendor) return res.status(404).json({ success: false, message: "Vendor not found" });

    vendor.status = "REJECTED";
    await vendor.save();

    res.json({ success: true, message: "Vendor rejected", vendor });
  } catch (error) {
    console.error("Reject vendor error:", error.message);
    res.status(500).json({ success: false, message: "Failed to reject vendor", error: error.message });
  }
});

/* ---------------- ORDER MANAGEMENT ---------------- */

// List all orders
router.get("/orders", async (req, res) => {
  try {
    const orders = await Order.find().populate("userId", "name email");
    res.json({ success: true, data: orders });
  } catch (error) {
    console.error("Fetch orders error:", error.message);
    res.status(500).json({ success: false, message: "Failed to fetch orders", error: error.message });
  }
});

// Update order status
router.put("/orders/:id", async (req, res) => {
  try {
    const { status } = req.body;
    if (!status) return res.status(400).json({ success: false, message: "Status is required" });

    const updatedOrder = await Order.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );

    if (!updatedOrder) return res.status(404).json({ success: false, message: "Order not found" });

    res.json({ success: true, message: "Order updated", updatedOrder });
  } catch (error) {
    console.error("Update order error:", error.message);
    res.status(500).json({ success: false, message: "Failed to update order", error: error.message });
  }
});

export default router;