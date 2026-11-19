import express from "express";
import {
  getCollections,
  getCollectionBySlug,
  createCollection,
  updateCollection,
} from "../controllers/collectionController.js";
import { protect, requireRole } from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/", getCollections);
router.get("/:slug", getCollectionBySlug);
router.post("/", protect, requireRole("admin", "superadmin"), createCollection);
router.put("/:id", protect, requireRole("admin", "superadmin"), updateCollection);

export default router;
