import express from "express";
import { protect, requireRole } from "../middleware/authMiddleware.js";
import {
  getVendorDashboard,
  getVendors,
  createVendor,
  updateVendor,
  deleteVendor,
  approveVendor,
  declineVendor,
  getUnpaidVendors,
  getVendorApplications,
} from "../controllers/vendorController.js";

const router = express.Router();

/* =========================================
   VENDOR DASHBOARD
   Access: vendor_owner only
========================================= */
router.get(
  "/dashboard",
  protect,
  requireRole("vendor_owner"),
  getVendorDashboard
);

/* =========================================
   GET ALL VENDORS
   Access: admin only
========================================= */
router.get("/", protect, requireRole("admin"), getVendors);

/* =========================================
   GET VENDOR APPLICATIONS (PENDING)
   Access: admin only
   Endpoint for dashboard
========================================= */
router.get("/applications", protect, requireRole("admin"), getVendorApplications);

/* =========================================
   GET UNPAID VENDORS
   Access: admin only
========================================= */
router.get("/unpaid", protect, requireRole("admin"), getUnpaidVendors);

/* =========================================
   CREATE VENDOR
   Access: Public OR Admin
========================================= */
router.post(
  "/",
  createVendor
  // For admin-only creation, uncomment:
  // protect,
  // requireRole("admin")
);

/* =========================================
   UPDATE VENDOR
   Access: admin OR vendor_owner
========================================= */
router.put("/:id", protect, requireRole("admin", "vendor_owner"), updateVendor);

/* =========================================
   DELETE VENDOR
   Access: admin only
========================================= */
router.delete("/:id", protect, requireRole("admin"), deleteVendor);

/* =========================================
   APPROVE VENDOR
   Access: admin only
   Method: PATCH
========================================= */
router.patch("/:id/approve", protect, requireRole("admin"), approveVendor);

/* =========================================
   DECLINE VENDOR
   Access: admin only
   Method: PATCH
========================================= */
router.patch("/:id/decline", protect, requireRole("admin"), declineVendor);

export default router;