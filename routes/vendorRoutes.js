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
import { registerVendor as registerVendorFull } from "../controllers/registerVendorController.js";
import { upload } from "../middleware/uploadMiddleware.js";

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
router.get("/", protect, requireRole("admin", "superadmin"), getVendors);

/* =========================================
   GET VENDOR APPLICATIONS (PENDING)
   Access: admin only
   Endpoint for dashboard
========================================= */
router.get("/applications", protect, requireRole("admin", "superadmin"), getVendorApplications);

/* =========================================
   GET UNPAID VENDORS
   Access: admin only
========================================= */
router.get("/unpaid", protect, requireRole("admin", "superadmin"), getUnpaidVendors);

/* =========================================
   CREATE VENDOR / REGISTRATION
   Vendor portal posts to /api/vendor/register (and /api/v1/vendor/register)
   Legacy /api/vendor also accepts the full onboarding form with documents.
========================================= */
router.post(
  "/register",
  upload.fields([
    { name: "registrationCert", maxCount: 1 },
    { name: "directorId", maxCount: 1 },
    { name: "proofOfAddress", maxCount: 1 },
    { name: "bankLetter", maxCount: 1 },
  ]),
  registerVendorFull
);

// Legacy admin-side vendor creation. Public onboarding lives at
// POST /register (validated, creates the Store + trial fields). Creating a
// vendor here must never be reachable anonymously.
router.post(
  "/",
  protect,
  requireRole("admin", "superadmin"),
  upload.fields([
    { name: "registrationCert", maxCount: 1 },
    { name: "directorId", maxCount: 1 },
    { name: "proofOfAddress", maxCount: 1 },
    { name: "bankLetter", maxCount: 1 },
  ]),
  createVendor
);

/* =========================================
   UPDATE VENDOR
   Access: admin OR vendor_owner
========================================= */
router.put("/:id", protect, requireRole("admin", "superadmin", "vendor_owner"), updateVendor);

/* =========================================
   DELETE VENDOR
   Access: admin only
========================================= */
router.delete("/:id", protect, requireRole("admin", "superadmin"), deleteVendor);

/* =========================================
   APPROVE VENDOR
   Access: admin only
   Method: PATCH
========================================= */
router.patch("/:id/approve", protect, requireRole("admin", "superadmin"), approveVendor);

/* =========================================
   DECLINE VENDOR
   Access: admin only
   Method: PATCH
========================================= */
router.patch("/:id/decline", protect, requireRole("admin", "superadmin"), declineVendor);

export default router;