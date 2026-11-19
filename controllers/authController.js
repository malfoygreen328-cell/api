// src/controllers/authController.js
import bcrypt from "bcryptjs";
import crypto from "crypto";

import User from "../models/User.js";
import Admin from "../models/Admin.js";
import Store from "../models/Store.js";
import Vendor from "../models/Vendor.js";
import { sendEmail } from "../utils/emailService.js";
import { generateToken, setAuthCookie, clearAuthCookie } from "../utils/jwt.js";

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
   HELPER: Storefront origin
   FRONTEND_URL is a comma-separated CORS list, so only its first entry is a
   usable base URL for links (the storefront). Falls back to the live domain.
========================================= */
const storefrontUrl = () => {
  const first = String(process.env.FRONTEND_URL || "")
    .split(",")[0]
    .trim()
    .replace(/\/$/, "");
  return first || "https://azaniashop.co.za";
};

/* =========================================
   USER REGISTRATION
   ✅ Pass plain password - User model handles hashing
========================================= */
export const registerUser = async (req, res, next) => {
  try {
    const { name, email, password } = req.body;

    const normalizedEmail = String(email || "").trim().toLowerCase();
    const cleanName = String(name || "").trim();

    if (cleanName.length < 2) {
      return res.status(400).json({ success: false, message: "Please provide your name (min 2 characters)." });
    }
    if (!/.+@.+\..+/.test(normalizedEmail)) {
      return res.status(400).json({ success: false, message: "Please provide a valid email address." });
    }
    if (!password || password.length < 6 || password.length > 128) {
      return res.status(400).json({ success: false, message: "Password must be between 6 and 128 characters." });
    }

    // Check if user exists
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "An account with this email already exists."
      });
    }

    // Create user - plain password, model will hash it
    const user = await User.create({
      name: cleanName,
      email: normalizedEmail,
      password, // Plain password
      role: ROLES.CUSTOMER,
      isVerified: false,
    });

    // 📧 Generate + email verification link (already hashed in DB)
    const plainToken = user.getEmailVerificationToken();
    await User.findByIdAndUpdate(user._id, {
      verificationToken: user.verificationToken,
      verificationTokenExpires: user.verificationTokenExpires,
    });

    const verifyUrl = `${storefrontUrl()}/verify-email?token=${plainToken}`;
    await sendEmail({
      to: normalizedEmail,
      subject: "🔐 Verify your Azania email",
      html: `<p>Hi ${name},</p>
        <p>Please confirm your email to activate your Azania account.</p>
        <p><a href="${verifyUrl}">✅ Verify my email</a></p>
        <p>This link expires in 24 hours.</p>`,
    });

    const token = generateToken(user._id, user.role);
    setAuthCookie(res, token);

    res.status(201).json({
      success: true,
      message: "Registered! Check your inbox to verify your email.",
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      isVerified: false,
      token,
      requiresVerification: true,
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

    const normalizedEmail = String(email || "").trim().toLowerCase();
    const cleanName = String(name || "").trim();

    if (cleanName.length < 2) {
      return res.status(400).json({ success: false, message: "Please provide your name (min 2 characters)." });
    }
    if (!/.+@.+\..+/.test(normalizedEmail)) {
      return res.status(400).json({ success: false, message: "Please provide a valid email address." });
    }
    if (!password || password.length < 6 || password.length > 128) {
      return res.status(400).json({ success: false, message: "Password must be between 6 and 128 characters." });
    }
    if (!String(storeName || "").trim()) {
      return res.status(400).json({ success: false, message: "Please provide a store name." });
    }

    // Check if vendor exists
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "An account with this email already exists."
      });
    }

    // Create vendor - plain password, model will hash it
    const vendor = await User.create({
      name: cleanName,
      email: normalizedEmail,
      password, // Plain password
      role: ROLES.VENDOR
    });

    // Create store for vendor
    const store = await Store.create({
      vendor: vendor._id,
      owner: vendor._id,
      storeName: String(storeName).trim().slice(0, 60)
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

    const normalizedEmail = String(email || "").trim().toLowerCase();
    if (!String(fullName || "").trim() || !/.+@.+\..+/.test(normalizedEmail) || !password || password.length < 6) {
      return res.status(400).json({ success: false, message: "Valid full name, email and password (min 6 chars) are required." });
    }

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
      fullName: String(fullName).trim(),
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

    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required." });
    }
    const normalizedEmail = String(email).trim().toLowerCase();

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
      // 🔹 Check users/vendors - select verification fields too so the
      //    email-verification gate below actually evaluates.
      // Keeping the projection additive preserves role/name/email while
      // explicitly selecting the password and verification gate fields.
      const foundUser = await User.findOne({ email: normalizedEmail }).select(
        "+password +verificationToken"
      );
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

    /* =========================================
       📧 ACCOUNT ACTIVATION GATE
       Existing accounts (no verification token) log in
       as before. NEW registrations must verify first.
       The token is stored hashed with select:false, so it has
       to be selected explicitly - without this the gate silently
       never triggered (unverified accounts could log straight in).
    ========================================= */
    if (user.verificationToken && !user.isVerified) {
      return res.status(403).json({
        success: false,
        message:
          "Please verify your email before logging in. Check your inbox for the verification link.",
        requiresVerification: true,
        email: user.email,
      });
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
    setAuthCookie(res, token);

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
  clearAuthCookie(res);
  res.json({
    success: true,
    message: "Logged out successfully"
  });
};

/* =========================================
   VERIFY EMAIL (from emailed link)
========================================= */
export const verifyEmail = async (req, res, next) => {
  try {
    const { token } = req.params;

    // Hash the provided token to match stored SHA-256 hash
    const hashedToken = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");

    const user = await User.findOne({
      verificationToken: hashedToken,
      verificationTokenExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired verification link."
      });
    }

    user.isVerified = true;
    user.verificationToken = undefined;
    user.verificationTokenExpires = undefined;
    await user.save({ validateBeforeSave: false });

    res.json({
      success: true,
      message: "Email verified! You can now log in.",
      email: user.email
    });
  } catch (err) {
    next(err);
  }
};

/* =========================================
   RESEND VERIFICATION EMAIL
========================================= */
export const resendVerification = async (req, res, next) => {
  try {
    const { email } = req.body;
    const normalizedEmail = email.toLowerCase();

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "No account found with that email."
      });
    }

    if (user.isVerified || !user.verificationToken) {
      return res.status(400).json({
        success: false,
        message: "This account is already verified."
      });
    }

    const plainToken = user.getEmailVerificationToken();
    await User.findByIdAndUpdate(user._id, {
      verificationToken: user.verificationToken,
      verificationTokenExpires: user.verificationTokenExpires
    });

    const verifyUrl = `${storefrontUrl()}/verify-email?token=${plainToken}`;
    await sendEmail({
      to: normalizedEmail,
      subject: "🔐 Resend: Verify your Azania email",
      html: `<p>Hi ${user.name},</p>
        <p>Here's a fresh link to verify your Azania account.</p>
        <p><a href="${verifyUrl}">✅ Verify my email</a></p>
        <p>This link expires in 24 hours.</p>`
    });

    res.json({
      success: true,
      message: "Verification email resent. Check your inbox."
    });
  } catch (err) {
    next(err);
  }
};