// src/routes/vendorPayoutRoutes.js
import express from "express";
import { protect, requireRole } from "../middleware/authMiddleware.js";
import {
  createVendorPayouts,
  markPayoutPaid,
  getVendorPayouts,
} from "../controllers/vendorPayoutController.js";

const router = express.Router();

// ------------------ PROTECTED & ADMIN ONLY ------------------
router.use(protect, requireRole("admin"));

// Create payouts from completed orders
router.post("/create", createVendorPayouts);

// Mark a payout as paid
router.put("/:payoutId/paid", markPayoutPaid);

// Get all payouts
router.get("/", getVendorPayouts);

export default router;