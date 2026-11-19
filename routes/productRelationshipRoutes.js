import express from "express";
import {
  getCompleteTheLook,
  addCompleteTheLook,
  getProductRelationships,
} from "../controllers/productRelationshipController.js";
import { protect, requireRole } from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/product/:productId/complete-the-look", getCompleteTheLook);
router.get("/product/:productId", getProductRelationships);
router.post("/complete-the-look", protect, requireRole("admin", "superadmin"), addCompleteTheLook);

export default router;
