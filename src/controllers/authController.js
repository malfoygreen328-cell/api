// src/controllers/authController.js
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

import User from "../models/User.js";
import Admin from "../models/Admin.js";
import Store from "../models/Store.js";

/* =========================================
   ROLES (Single source of truth)
========================================= */
const ROLES = {
  CUSTOMER: "customer",
  VENDOR: "vendor_owner",
  STAFF: "vendor_staff",
  ADMIN: "admin",
  SUPERADMIN: "superadmin"
};

/* =========================================
   HELPER: Generate JWT
========================================= */
const generateToken = (id, role) => {
  return jwt.sign({ id, role }, process.env.JWT_SECRET, {
    expiresIn: "1d"
  });
};

/* =========================================
   USER REGISTRATION
   ✅ Pass plain password - User model handles hashing
========================================= */
export const registerUser = async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    const normalizedEmail = email.toLowerCase();

    // Check if user exists
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "User already exists"
      });
    }

    // Create user - plain password, model will hash it
    const user = await User.create({
      name,
      email: normalizedEmail,
      password, // Plain password
      role: ROLES.CUSTOMER
    });

    const token = generateToken(user._id, user.role);

    res.status(201).json({
      success: true,
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      token
    });
  } catch (err) {
    next(err);
  }
};

/* =========================================
   VENDOR REGISTRATION
   ✅ Pass plain password - User model handles hashing
========================================= */
export const registerVendor = async (req, res, next) => {
  try {
    const { name, email, password, storeName } = req.body;
    const normalizedEmail = email.toLowerCase();

    // Check if vendor exists
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "Vendor already exists"
      });
    }

    // Create vendor - plain password, model will hash it
    const vendor = await User.create({
      name,
      email: normalizedEmail,
      password, // Plain password
      role: ROLES.VENDOR
    });

    // Create store for vendor
    const store = await Store.create({
      vendor: vendor._id,
      owner: vendor._id,
      storeName: storeName || `${name}'s Store`
    });

    const token = generateToken(vendor._id, vendor.role);

    res.status(201).json({
      success: true,
      message: "Vendor registered successfully",
      vendor: {
        id: vendor._id,
        name: vendor.name,
        email: vendor.email,
        role: vendor.role
      },
      store: {
        id: store._id,
        storeName: store.storeName,
        storeSlug: store.storeSlug
      },
      token
    });
  } catch (err) {
    next(err);
  }
};

/* =========================================
   ADMIN REGISTRATION
   ✅ Pass plain password - Admin model handles hashing
========================================= */
export const registerAdmin = async (req, res, next) => {
  try {
    const { fullName, email, password } = req.body;
    const normalizedEmail = email.toLowerCase();

    // Check if admin exists
    const existingAdmin = await Admin.findOne({ email: normalizedEmail });
    if (existingAdmin) {
      return res.status(400).json({
        success: false,
        message: "Admin already exists"
      });
    }

    // Create admin - plain password, Admin model will hash it
    const admin = await Admin.create({
      fullName,
      email: normalizedEmail,
      password // Plain password
    });

    const token = generateToken(admin._id, ROLES.ADMIN);

    res.status(201).json({
      success: true,
      message: "Admin created successfully",
      admin: {
        id: admin._id,
        fullName: admin.fullName,
        email: admin.email,
        role: ROLES.ADMIN
      },
      token
    });
  } catch (err) {
    next(err);
  }
};

/* =========================================
   LOGIN (User / Vendor / Admin)
   ✅ CRITICAL: Must use .select("+password") for both User and Admin
========================================= */
export const loginUser = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const normalizedEmail = email.toLowerCase();

    let user = null;
    let role = null;

    // 🔹 Check admin first - MUST include .select("+password")
    const admin = await Admin.findOne({ email: normalizedEmail }).select("+password");
    
    if (admin) {
      // Check if admin account is active
      if (!admin.isActive) {
        return res.status(401).json({
          success: false,
          message: "Admin account is disabled. Please contact support."
        });
      }
      
      user = admin;
      role = admin.role === "superadmin" ? ROLES.SUPERADMIN : ROLES.ADMIN;
    } else {
      // 🔹 Check users/vendors - MUST include .select("+password")
      const foundUser = await User.findOne({ email: normalizedEmail }).select("+password");
      if (foundUser) {
        user = foundUser;
        role = foundUser.role;
      }
    }

    // No user found
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password"
      });
    }

    // Safety check - password should exist
    if (!user.password) {
      console.error("User found but password field is missing:", user._id);
      return res.status(500).json({
        success: false,
        message: "Account configuration error. Please contact support."
      });
    }

    // ✅ Compare password using the model's method
    let isMatch = false;
    
    try {
      // Use the model's matchPassword method if available
      if (typeof user.matchPassword === 'function') {
        isMatch = await user.matchPassword(password);
      } else {
        // Fallback to direct bcrypt comparison
        isMatch = await bcrypt.compare(password, user.password);
      }
    } catch (compareError) {
      console.error("Password comparison error:", compareError);
      return res.status(500).json({
        success: false,
        message: "Error verifying credentials. Please try again."
      });
    }

    // Password doesn't match
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password"
      });
    }

    // ✅ Update last login for admin
    if (role === ROLES.ADMIN || role === ROLES.SUPERADMIN) {
      await Admin.findByIdAndUpdate(user._id, { lastLogin: new Date() });
    }

    // ✅ Generate token
    const token = generateToken(user._id, role);

    // ✅ Get store info for vendors
    let store = null;
    if (role === ROLES.VENDOR) {
      store = await Store.findOne({ vendor: user._id })
        .select("_id storeName storeSlug");
    }

    // ✅ Send success response
    res.json({
      success: true,
      id: user._id,
      name: user.name || user.fullName,
      email: user.email,
      role,
      token,
      store,
      ...(role === ROLES.ADMIN || role === ROLES.SUPERADMIN ? {
        isActive: user.isActive
      } : {})
    });
  } catch (err) {
    console.error("Login error details:", err);
    next(err);
  }
};

/* =========================================
   GET CURRENT USER (Protected Route)
========================================= */
export const getMe = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).select("-password");
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    res.json({
      success: true,
      user
    });
  } catch (err) {
    next(err);
  }
};

/* =========================================
   GET CURRENT ADMIN (Protected Route)
========================================= */
export const getCurrentAdmin = async (req, res, next) => {
  try {
    const admin = await Admin.findById(req.user.id).select("-password");
    
    if (!admin) {
      return res.status(404).json({
        success: false,
        message: "Admin not found"
      });
    }

    res.json({
      success: true,
      admin
    });
  } catch (err) {
    next(err);
  }
};

/* =========================================
   LOGOUT (Client-side only - token removal)
========================================= */
export const logout = async (req, res) => {
  res.json({
    success: true,
    message: "Logged out successfully"
  });
};
