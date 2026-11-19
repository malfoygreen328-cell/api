import express from "express";
import {
  createStore,
  getStoreBySlug,
  getStoreByVendor,
  getAllStores,
  updateStore,
  deleteStore,
} from "../controllers/storeController.js";
import Store from "../models/Store.js";

// ✅ Updated imports from authMiddleware
import { verifyToken, requireRole, optionalAuth } from "../middleware/authMiddleware.js";

const router = express.Router();

/* =========================================
   CREATE STORE
   Only vendors can create their store
   POST /api/stores
========================================= */
router.post(
  "/",
  verifyToken,
  requireRole("vendor_owner", "admin", "superadmin"),
  createStore
);

/* =========================================
   BULK DELETE STORES
   Admin only
   POST /api/stores/delete-multiple
======================================== */
router.post(
  "/delete-multiple",
  verifyToken,
  requireRole("admin", "superadmin"),
  async (req, res, next) => {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ success: false, message: "No store ids provided" });
      }
      const result = await Store.deleteMany({ _id: { $in: ids } });
      res.json({ success: true, deleted: result.deletedCount });
    } catch (err) {
      next(err);
    }
  }
);

/* =========================================
   GET ALL STORES
   Public endpoint
   GET /api/stores
======================================== */
// optionalAuth lets admins/owners preview unapproved stores while anonymous
// visitors only receive publicly approved brands from the controller.
router.get("/", optionalAuth, getAllStores);

/* =========================================
   GET STORE BY SLUG
   Public endpoint
   GET /api/stores/slug/:slug
========================================= */
router.get("/slug/:slug", optionalAuth, getStoreBySlug);

/* =========================================
   GET STORE BY VENDOR
   Vendor can view their own store
   Admin can view any store
   GET /api/stores/vendor/:vendorId
========================================= */
router.get(
  "/vendor/:vendorId",
  verifyToken,
  requireRole("vendor_owner", "admin"),
  getStoreByVendor
);

/* =========================================
   UPDATE STORE
   Vendor can update own store
   Admin can update any store
   PUT /api/stores/:id
========================================= */
router.put(
  "/:id",
  verifyToken,
  requireRole("vendor_owner", "admin", "superadmin"),
  updateStore
);

/* =========================================
   DELETE STORE
   Vendor can delete own store
   Admin can delete any store
   DELETE /api/stores/:id
========================================= */
router.delete(
  "/:id",
  verifyToken,
  requireRole("vendor_owner", "admin", "superadmin"),
  deleteStore
);

export default router;