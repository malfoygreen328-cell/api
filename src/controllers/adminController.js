// src/controllers/adminController.js
import Admin from "../models/Admin.js";
import jwt from "jsonwebtoken";

/* =========================================
   🔑 GENERATE JWT TOKEN
========================================= */
const generateToken = (admin) => {
  return jwt.sign(
    {
      id: admin._id,
      role: admin.role,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: "7d",
    }
  );
};

/* =========================================
   🛡️ ADMIN LOGIN
   POST /api/admin/login
========================================= */
export const loginAdmin = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    // Find admin and include password for verification
    const admin = await Admin.findOne({ email }).select("+password");

    if (!admin) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    // Check password match
    const isMatch = await admin.matchPassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    // Generate JWT
    const token = generateToken(admin);

    res.json({
      success: true,
      message: "Login successful",
      token,
      admin: {
        id: admin._id,
        fullName: admin.fullName,
        email: admin.email,
        role: admin.role,
      },
    });
  } catch (err) {
    next(err);
  }
};

/* =========================================
   👤 GET ADMIN PROFILE
   GET /api/admin/profile
========================================= */
export const getAdminProfile = async (req, res, next) => {
  try {
    const admin = await Admin.findById(req.user._id);

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: "Admin not found",
      });
    }

    res.json({
      success: true,
      admin: {
        id: admin._id,
        fullName: admin.fullName,
        email: admin.email,
        role: admin.role,
      },
    });
  } catch (err) {
    next(err);
  }
};

/* =========================================
   🔄 UPDATE ADMIN PROFILE
   PUT /api/admin/profile
========================================= */
export const updateAdminProfile = async (req, res, next) => {
  try {
    const admin = await Admin.findById(req.user._id).select("+password");

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: "Admin not found",
      });
    }

    // Update fields
    admin.fullName = req.body.fullName || admin.fullName;
    admin.email = req.body.email || admin.email;

    // Update password if provided
    if (req.body.password) {
      admin.password = req.body.password;
    }

    const updatedAdmin = await admin.save();

    res.json({
      success: true,
      message: "Profile updated successfully",
      admin: {
        id: updatedAdmin._id,
        fullName: updatedAdmin.fullName,
        email: updatedAdmin.email,
        role: updatedAdmin.role,
      },
    });
  } catch (err) {
    next(err);
  }
};