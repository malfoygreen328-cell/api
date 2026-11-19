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

const refundAdmin = requireRole("admin", "superadmin");

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
   🛡️ ADMIN/SUPERADMIN: APPROVE REFUND
   PATCH /api/refunds/:orderId/approve
========================================= */
router.patch(
  "/:orderId/approve",
  protect,
  refundAdmin,
  approveRefund
);

/* =========================================
   🛡️ ADMIN/SUPERADMIN: REJECT REFUND
   PATCH /api/refunds/:orderId/reject
========================================= */
router.patch(
  "/:orderId/reject",
  protect,
  refundAdmin,
  rejectRefund
);

/* =========================================
   🛡️ ADMIN/SUPERADMIN: GET ALL REFUNDS
   GET /api/refunds
========================================= */
router.get(
  "/",
  protect,
  refundAdmin,
  getRefunds
);

export default router;