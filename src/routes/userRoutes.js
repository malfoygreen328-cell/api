// src/routes/userRoutes.js
import express from "express";
import {
  getUsers,
  createUser,
  loginUser
} from "../controllers/userController.js";

const router = express.Router();

// ==========================
// GET all users
// ==========================
router.get("/", getUsers);

// ==========================
// POST create new user
// ==========================
router.post("/", createUser);

// ==========================
// POST login
// ==========================
router.post("/login", loginUser);

export default router;
