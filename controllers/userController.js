// src/controllers/userController.js
import User from "../models/User.js";

/* =========================================
   CREATE USER (admin-created account)
   Role is always forced to "customer" - the body
   can never escalate a user to admin/vendor/superadmin.
========================================= */
export const createUser = async (req, res, next) => {
  try {
    const name = String((req.body || {}).name || "").trim();
    const email = String((req.body || {}).email || "").trim().toLowerCase();
    const password = (req.body || {}).password;

    if (name.length < 2) {
      return res.status(400).json({ success: false, message: "Name must be at least 2 characters." });
    }
    if (!/.+@.+\..+/.test(email)) {
      return res.status(400).json({ success: false, message: "Please provide a valid email address." });
    }
    if (!password || password.length < 6 || password.length > 128) {
      return res.status(400).json({ success: false, message: "Password must be between 6 and 128 characters." });
    }

    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ success: false, message: "User already exists." });
    }

    // Explicit whitelist - req.body.role / req.body.subscription etc. are ignored.
    const user = await User.create({
      name,
      email,
      password,
      role: "customer",
      isVerified: true,
    });

    res.status(201).json({
      success: true,
      message: "User created successfully.",
      data: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    next(err);
  }
};

/* =========================================
   GET ALL USERS (admin only)
   Minimal projection - no passwords/tokens and
   excludes role-endpoint fields from the shape.
========================================= */
export const getUsers = async (req, res, next) => {
  try {
    const users = await User.find()
      .select("_id name email role isVerified createdAt updatedAt");

    res.json({
      success: true,
      count: users.length,
      data: users,
    });
  } catch (err) {
    next(err);
  }
};