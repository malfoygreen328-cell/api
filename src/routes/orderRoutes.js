// src/routes/orderRoutes.js
import express from "express";
import {
  createOrder,
  getCustomerOrders,
  getVendorOrders,
  getOrderDetails,
  updateOrderStatus,
  confirmPayment,
} from "../controllers/orderController.js";

import { protect, requireRole } from "../middleware/authMiddleware.js";

const router = express.Router();

/* =========================================
   CREATE ORDER
   POST /api/orders
========================================= */
router.post("/", protect, requireRole("customer"), createOrder);

/* =========================================
   GET CUSTOMER ORDERS
   GET /api/orders
========================================= */
router.get("/", protect, requireRole("customer"), getCustomerOrders);

/* =========================================
   GET VENDOR ORDERS
   GET /api/orders/vendor
========================================= */
router.get("/vendor", protect, requireRole("vendor_owner"), getVendorOrders);

/* =========================================
   CONFIRM PAYMENT
   POST /api/orders/confirm
   ⚠️ Must be before /:id route
========================================= */
router.post("/confirm", protect, requireRole("customer"), confirmPayment);

/* =========================================
   VERIFY PAYMENT STATUS
   GET /api/orders/:id/verify
========================================= */
router.get("/:id/verify", protect, async (req, res) => {
  try {
    const Order = (await import("../models/Order.js")).default;
    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    res.json({
      success: true,
      status: order.status,
      trackingNumber: order.trackingNumber,
      shippingCarrier: order.shippingCarrier,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

/* =========================================
   GET ORDER DETAILS
   GET /api/orders/:id
   ⚠️ Keep after all special routes
========================================= */
router.get("/:id", protect, getOrderDetails);

/* =========================================
   UPDATE ORDER STATUS & TRACKING
   PATCH /api/orders/:id
   Supports shipping updates
========================================= */
router.patch("/:id", protect, requireRole("vendor_owner", "admin"), async (req, res) => {
  try {
    const Order = (await import("../models/Order.js")).default;
    const order = await Order.findById(req.params.id);

    if (!order) return res.status(404).json({ success: false, message: "Order not found" });

    const { status, trackingNumber, shippingCarrier } = req.body;

    // Vendor can only update their own items
    if (req.user.role === "vendor_owner") {
      const hasAccess = order.items.some(
        (item) => item.vendor?.toString() === req.user._id.toString()
      );
      if (!hasAccess) return res.status(403).json({ message: "Not authorized" });
    }

    // Update status
    if (status) order.status = status;

    // Update shipping info
    if (trackingNumber) order.trackingNumber = trackingNumber;
    if (shippingCarrier) order.shippingCarrier = shippingCarrier;

    await order.save();

    res.json({ success: true, message: "Order updated successfully", order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;