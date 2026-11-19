// src/routes/payfastRoutes.js
import express from "express";
import { createPayfastPayment, handlePayfastIPN } from "../controllers/payfastController.js";
import { protect, requireRole } from "../middleware/authMiddleware.js";

const router = express.Router();

/* =========================================
   💳 CREATE PAYFAST PAYMENT
   Customers initiate payment for their order
   POST /api/payfast/create-payment
========================================= */
router.post(
  "/create-payment",
  protect,
  requireRole("customer"), // only customers can create payments
  createPayfastPayment
);

/* =========================================
   🔔 PAYFAST IPN (Instant Payment Notification)
   PayFast sends POST here on payment status changes
   No authentication required
   POST /api/payfast/notify
========================================= */
router.post(
  "/notify",
  express.urlencoded({ extended: false }), // PayFast sends URL-encoded payload
  handlePayfastIPN
);

export default router;