// src/routes/refundRoutes.js
import express from "express";
import { protect, requireRole } from "../middleware/authMiddleware.js";
import {
  requestRefund,
  approveRefund,
  rejectRefund,
  getRefunds,
} from "../controllers/refundController.js";

const router = express.Router();

/* =========================================
   💸 CUSTOMER: REQUEST REFUND
   POST /api/refunds/:orderId/request
========================================= */
router.post(
  "/:orderId/request",
  protect,
  requireRole("customer"), // Only customers can request
  requestRefund
);

/* =========================================
   🛡️ ADMIN: APPROVE REFUND
   PATCH /api/refunds/:refundId/approve
========================================= */
router.patch(
  "/:refundId/approve",
  protect,
  requireRole("admin"), // Only admins
  approveRefund
);

/* =========================================
   🛡️ ADMIN: REJECT REFUND
   PATCH /api/refunds/:refundId/reject
========================================= */
router.patch(
  "/:refundId/reject",
  protect,
  requireRole("admin"), // Only admins
  rejectRefund
);

/* =========================================
   🛡️ ADMIN: GET ALL REFUNDS
   GET /api/refunds
========================================= */
router.get(
  "/",
  protect,
  requireRole("admin"),
  getRefunds
);

export default router;