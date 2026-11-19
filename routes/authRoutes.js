import express from "express";
import {
  registerUser,
  loginUser,
  verifyEmail,
  resendVerification,
  logout,
} from "../controllers/authController.js";
import { registerVendor as registerVendorFull } from "../controllers/registerVendorController.js";
import { verifyRecaptcha } from "../middleware/recaptchaMiddleware.js";
import { upload } from "../middleware/uploadMiddleware.js";

const router = express.Router();

// User registration (reCAPTCHA v3 action: customer_register)
router.post("/register", verifyRecaptcha("customer_register"), registerUser);

// Vendor registration (legacy path retained; uses the same canonical
// Vendor+Store onboarding flow as /api/v1/vendor/register).
router.post(
  "/register-vendor",
  upload.fields([
    { name: "registrationCert", maxCount: 1 },
    { name: "directorId", maxCount: 1 },
    { name: "proofOfAddress", maxCount: 1 },
    { name: "bankLetter", maxCount: 1 },
  ]),
  registerVendorFull
);

// Email verification
router.post("/verify-email/:token", verifyEmail);
router.post("/resend-verification", resendVerification);

// Login (reCAPTCHA v3 action: customer_login)
router.post("/login", verifyRecaptcha("customer_login"), loginUser);

// Logout
router.post("/logout", logout);

export default router;
