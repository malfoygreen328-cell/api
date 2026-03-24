import express from "express";
import {
  createStore,
  getStoreBySlug,
  getStoreByVendor,
  getAllStores,
  updateStore,
  deleteStore,
} from "../controllers/storeController.js";

// ✅ Updated imports from authMiddleware
import { verifyToken, requireRole } from "../middleware/authMiddleware.js";

const router = express.Router();

/* =========================================
   CREATE STORE
   Only vendors can create their store
   POST /api/stores
========================================= */
router.post("/", verifyToken, requireRole("vendor_owner"), createStore);

/* =========================================
   GET ALL STORES
   Public endpoint
   GET /api/stores
========================================= */
router.get("/", getAllStores);

/* =========================================
   GET STORE BY SLUG
   Public endpoint
   GET /api/stores/slug/:slug
========================================= */
router.get("/slug/:slug", getStoreBySlug);

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
router.put("/:id", verifyToken, requireRole("vendor_owner", "admin"), updateStore);

/* =========================================
   DELETE STORE
   Vendor can delete own store
   Admin can delete any store
   DELETE /api/stores/:id
========================================= */
router.delete("/:id", verifyToken, requireRole("vendor_owner", "admin"), deleteStore);

export default router;