import express from "express";
import { registerUser, registerVendor, loginUser } from "../controllers/authController.js";

const router = express.Router();

// User registration
router.post("/register", registerUser);

// Vendor registration
router.post("/register-vendor", registerVendor);

// Login
router.post("/login", loginUser);

export default router;