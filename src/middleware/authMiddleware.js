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
      return res.status(401).json({
        success: false,
        message:
          err.name === "TokenExpiredError"
            ? "Session expired. Please log in again."
            : "Invalid authentication token.",
      });
    }

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
        message: `Auth failed: ${decoded.role} not found`,
      });
    }

    // ✅ Attach user & role
    req.user = user;
    req.user.role = decoded.role; // 🔥 ensure role always exists
    req.role = decoded.role;

    next();
  } catch (err) {
    console.error("🔥 Auth middleware error:", err);

    // ✅ CRITICAL FIX: pass error to global handler
    next(err);
  }
};

/* =========================================
   OPTIONAL ALIAS
========================================= */
export const verifyToken = protect;

/* =========================================
   ROLE-BASED ACCESS
========================================= */
export const requireRole = (...roles) => {
  return (req, res, next) => {
    try {
      if (!req.user || !req.user.role) {
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
    } catch (err) {
      next(err); // ✅ safety
    }
  };
};

/* =========================================
   ADMIN ONLY (shortcut)
========================================= */
export const adminOnly = (req, res, next) => {
  try {
    if (!req.user || !["admin", "superadmin"].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "Admin access only.",
      });
    }

    next();
  } catch (err) {
    next(err); // ✅ safety
  }
};
