// src/routes/orderRoutes.js
import express from "express";
import {
  createOrder,
  getCustomerOrders,
  getVendorOrders,
  getOrderDetails,
  updateOrderStatus,
  confirmPayment,
  verifyOrder,
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
router.get("/vendor", protect, requireRole("vendor_owner", "vendor_staff"), getVendorOrders);

/* =========================================
   CONFIRM PAYMENT
   POST /api/orders/confirm
   ⚠️ Must be before /:id route
========================================= */
router.post("/confirm", protect, requireRole("customer"), confirmPayment);

/* =========================================
   VERIFY PAYMENT STATUS / TRACKING
   GET /api/orders/:id/verify
   Authorization enforced (owner, order vendor, admin)
========================================= */
router.get("/:id/verify", protect, verifyOrder);

/* =========================================
   GET ORDER DETAILS
   GET /api/orders/:id
   ⚠️ Keep after all special routes
========================================= */
router.get("/:id", protect, getOrderDetails);

/* =========================================
   UPDATE ORDER STATUS & TRACKING
   PATCH /api/orders/:id
   Uses the shared, transition-safe controller
========================================= */
router.patch("/:id", protect, requireRole("vendor_owner", "vendor_staff", "admin", "superadmin"), updateOrderStatus);

export default router;