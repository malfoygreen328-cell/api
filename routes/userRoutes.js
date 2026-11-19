// src/routes/userRoutes.js
import express from "express";
import {
  getUsers,
  createUser
} from "../controllers/userController.js";
import { protect, adminOnly } from "../middleware/authMiddleware.js";

const router = express.Router();

// User management is admin-only. Public registration/login/verification flows
// live under /api/auth (authRoutes) - keeping them out of /api/users prevents
// the PII dump, self-service role escalation and the duplicate/gated logic.
router.use(protect, adminOnly);

// ==========================
// GET all users (admin only)
// ==========================
router.get("/", getUsers);

// ==========================
// POST create new user (admin only)
// ==========================
router.post("/", createUser);

export default router;