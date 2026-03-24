// src/routes/adRoutes.js
import express from "express";
import {
  createAd,
  getAds,
  updateAd,
  deleteAd,
} from "../controllers/adController.js";
import { verifyToken, requireRole } from "../middleware/authMiddleware.js";

const router = express.Router();

/* ---------------- CREATE AD ---------------- */
// POST /api/v1/ads
// Protected: only admins or vendor owners can create
router.post("/", verifyToken, requireRole(["admin", "vendor_owner"]), createAd);

/* ---------------- GET ALL ADS ---------------- */
// GET /api/v1/ads
// Public: anyone can view ads on frontend
router.get("/", getAds);

/* ---------------- UPDATE AD ---------------- */
// PUT /api/v1/ads/:id
// Protected: only admins or vendor owners can update
router.put("/:id", verifyToken, requireRole(["admin", "vendor_owner"]), updateAd);

/* ---------------- DELETE AD ---------------- */
// DELETE /api/v1/ads/:id
// Protected: only admins or vendor owners can delete
router.delete("/:id", verifyToken, requireRole(["admin", "vendor_owner"]), deleteAd);

export default router;