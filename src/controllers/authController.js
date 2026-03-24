// src/controllers/authController.js
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

import User from "../models/User.js";
import Admin from "../models/Admin.js";
import Store from "../models/Store.js";

/* =========================================
   HELPER: Generate JWT
========================================= */
const generateToken = (id, role) => {
  return jwt.sign({ id, role }, process.env.JWT_SECRET, { expiresIn: "1d" });
};

/* =========================================
   USER REGISTRATION
========================================= */
export const registerUser = async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    const normalizedEmail = email.toLowerCase();

    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(400).json({ success: false, message: "User already exists" });
    }

    const user = await User.create({ name, email: normalizedEmail, password, role: "user" });

    const token = generateToken(user._id, user.role);

    res.status(201).json({
      success: true,
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      token,
    });
  } catch (err) {
    next(err);
  }
};

/* =========================================
   VENDOR REGISTRATION
========================================= */
export const registerVendor = async (req, res, next) => {
  try {
    const { name, email, password, storeName } = req.body;
    const normalizedEmail = email.toLowerCase();

    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(400).json({ success: false, message: "Vendor already exists" });
    }

    const vendor = await User.create({ name, email: normalizedEmail, password, role: "vendor" });

    const store = await Store.create({
      vendor: vendor._id,
      owner: vendor._id,
      storeName: storeName || `${name}'s Store`,
    });

    const token = generateToken(vendor._id, vendor.role);

    res.status(201).json({
      success: true,
      message: "Vendor registered successfully",
      vendor: {
        id: vendor._id,
        name: vendor.name,
        email: vendor.email,
        role: vendor.role,
      },
      store: {
        id: store._id,
        storeName: store.storeName,
        storeSlug: store.storeSlug,
      },
      token,
    });
  } catch (err) {
    next(err);
  }
};

/* =========================================
   ADMIN REGISTRATION
   Only for creating admin accounts
========================================= */
export const registerAdmin = async (req, res, next) => {
  try {
    const { fullName, email, password } = req.body;
    const normalizedEmail = email.toLowerCase();

    const existingAdmin = await Admin.findOne({ email: normalizedEmail });
    if (existingAdmin) {
      return res.status(400).json({ success: false, message: "Admin already exists" });
    }

    const admin = await Admin.create({ fullName, email: normalizedEmail, password });
    const token = generateToken(admin._id, "admin");

    res.status(201).json({
      success: true,
      message: "Admin created successfully",
      admin: {
        id: admin._id,
        fullName: admin.fullName,
        email: admin.email,
        role: "admin",
      },
      token,
    });
  } catch (err) {
    next(err);
  }
};

/* =========================================
   LOGIN (User / Vendor / Admin)
========================================= */
export const loginUser = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const normalizedEmail = email.toLowerCase();

    let user = null;
    let role = null;

    // Check admin first
    const admin = await Admin.findOne({ email: normalizedEmail });
    if (admin) {
      user = admin;
      role = "admin";
    } else {
      // Check regular users/vendors
      const foundUser = await User.findOne({ email: normalizedEmail });
      if (foundUser) {
        user = foundUser;
        role = foundUser.role;
      }
    }

    if (!user) {
      return res.status(400).json({ success: false, message: "Invalid email or password" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: "Invalid email or password" });
    }

    const token = generateToken(user._id, role);

    let store = null;
    if (role === "vendor") {
      store = await Store.findOne({ vendor: user._id }).select("_id storeName storeSlug");
    }

    res.json({
      success: true,
      id: user._id,
      name: user.name || user.fullName,
      email: user.email,
      role,
      token,
      store,
    });
  } catch (err) {
    next(err);
  }
};