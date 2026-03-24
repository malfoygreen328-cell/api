// src/middleware/authMiddleware.js
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import Vendor from "../models/Vendor.js";
import Admin from "../models/Admin.js";

/* =========================================
   HELPER: EXTRACT TOKEN FROM HEADER OR COOKIE
========================================= */
const getToken = (req) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.split(" ")[1];
  }
  if (req.cookies?.token) {
    return req.cookies.token;
  }
  return null;
};

/* =========================================
   PROTECT (AUTH MIDDLEWARE)
   Supports Admins, Vendors, and Users
========================================= */
export const protect = async (req, res, next) => {
  try {
    const token = getToken(req);

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Access denied. No token provided.",
      });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      console.error("JWT verification error:", err.message);
      return res.status(401).json({
        success: false,
        message:
          err.name === "TokenExpiredError"
            ? "Session expired. Please log in again."
            : "Invalid authentication token.",
      });
    }

    // Attach role to request for convenience
    req.role = decoded.role;

    let user = null;

    switch (decoded.role) {
      case "admin":
      case "superadmin":
        user = await Admin.findById(decoded.id).select("-password");
        break;
      case "vendor_owner":
      case "vendor_staff":
        user = await Vendor.findById(decoded.id).select("-password");
        break;
      case "user":
        user = await User.findById(decoded.id).select("-password");
        break;
      default:
        return res.status(401).json({
          success: false,
          message: "Unauthorized: invalid role",
        });
    }

    if (!user) {
      return res.status(401).json({
        success: false,
        message: `Auth failed: ${decoded.role} not found for ID: ${decoded.id}`,
      });
    }

    req.user = user;
    next();
  } catch (err) {
    console.error("Auth middleware error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error during authentication.",
    });
  }
};

/* =========================================
   OPTIONAL ALIAS
========================================= */
export const verifyToken = protect;

/* =========================================
   ROLE-BASED ACCESS
   Pass one or multiple roles as arguments
========================================= */
export const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized access.",
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Forbidden: '${req.user.role}' role not allowed.`,
      });
    }

    next();
  };
};

/* =========================================
   ADMIN ONLY (shortcut)
========================================= */
export const adminOnly = (req, res, next) => {
  if (!req.user || !["admin", "superadmin"].includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      message: "Admin access only.",
    });
  }
  next();
};