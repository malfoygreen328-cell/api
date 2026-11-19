import express from "express";
import { protect, requireRole } from "../middleware/authMiddleware.js";
import {
  loginVendor,
  getVendorMe,
  logoutVendor,
} from "../controllers/VendorAuthController.js";

const router = express.Router();

router.post("/login", loginVendor);
router.post("/logout", logoutVendor);
router.get("/me", protect, requireRole("vendor_owner", "vendor_staff"), getVendorMe);

export default router;
