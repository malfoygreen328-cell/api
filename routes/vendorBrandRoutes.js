import express from "express";
import {
  getMyBrand,
  updateMyBrand,
  uploadBrandImage,
} from "../controllers/vendorBrandController.js";
import { protect, requireRole } from "../middleware/authMiddleware.js";
import { upload } from "../middleware/uploadMiddleware.js";

const router = express.Router();

router.use(protect, requireRole("vendor_owner", "vendor_staff"));

router.get("/", getMyBrand);
router.put("/", updateMyBrand);
router.post("/upload", upload.single("image"), uploadBrandImage);

export default router;
