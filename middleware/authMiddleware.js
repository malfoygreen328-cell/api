import jwt from "jsonwebtoken";
import User from "../models/User.js";
import Vendor from "../models/Vendor.js";
import Admin from "../models/Admin.js";
import Store from "../models/Store.js";

/* =========================================
   HELPER: EXTRACT TOKEN FROM HEADER OR COOKIE
========================================= */
const getToken = (req) => {
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.split(" ")[1];
  }

  if (req.cookies?.azania_token) {
    return req.cookies.azania_token;
  }
  if (req.cookies?.token) {
    return req.cookies.token;
  }

  return null;
};

async function attachVendorContext(user) {
  if (!user) return user;
  // user here is a Mongoose document (Vendor or User depending on lookup).
  try {
    let vendor = null;
    if (user.constructor && user.constructor.modelName === "Vendor") {
      vendor = user;
    } else if (user.constructor && user.constructor.modelName === "User") {
      vendor = await Vendor.findOne({ $or: [{ user: user._id }, { email: user.email }] })
        .select("-password");
    }
    if (vendor) {
      user.vendor = vendor._id || vendor.id;
      user.vendorId = vendor._id || vendor.id;
      user.store = vendor.store || user.store || null;
      if (!user.role && vendor.role) user.role = vendor.role;
      // Attach full vendor reference where helpful (non-enumerable to avoid
      // changing JSON shapes unexpectedly).
      Object.defineProperty(user, "_vendorDoc", { value: vendor, enumerable: false, writable: true });
    } else if (user._id) {
      const store = await Store.findOne({ vendor: user._id }).select("_id");
      if (store) {
        user.store = store._id;
      }
    }
  } catch (err) {
    // Best-effort: never block authentication because context lookup failed.
  }
  return user;
}

/* =========================================
   TOKEN -> PRINCIPAL RESOLVER
   Canonical vendor identity = Vendor. Legacy User-vendor accounts are
   resolved via Vendor.user/email as a fallback.
   Shared by protect (required) and optionalAuth (best-effort).
========================================= */
export const resolvePrincipal = async (token) => {
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return {
      error:
        err.name === "TokenExpiredError"
          ? "Session expired. Please log in again."
          : "Invalid authentication token.",
    };
  }

  let user = null;
  const tokenRole = decoded.role;

  switch (tokenRole) {
    case "admin":
    case "superadmin":
      user = await Admin.findById(decoded.id).select("-password");
      break;

    case "vendor_owner":
    case "vendor_staff":
      // Try Vendor first (canonical). Fall back to User for legacy tokens.
      user = await Vendor.findById(decoded.id).select("-password");
      if (!user) {
        const legacy = await User.findById(decoded.id).select("-password +verificationToken");
        if (legacy) {
          user = await Vendor.findOne({ $or: [{ user: legacy._id }, { email: legacy.email }] }).select("-password");
          if (!user) {
            // Legacy account only exists as User - still attach context if possible.
            user = legacy;
          }
        }
      }
      break;

    case "user":
    case "customer":
      // Select verificationToken/isVerified (both hidden by default) so the
      // email-verification gate can be enforced on protected endpoints.
      user = await User.findById(decoded.id).select("+verificationToken");
      break;

    default:
      return { error: "Unauthorized: invalid role" };
  }

  if (!user) {
    return { error: `Auth failed: ${tokenRole} not found` };
  }

  user.role = tokenRole || user.role; // ensure role always exists
  await attachVendorContext(user);
  return { user, role: user.role };
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

    const { user, role, error } = await resolvePrincipal(token);

    if (error || !user) {
      return res.status(401).json({
        success: false,
        message: error || "Invalid authentication token.",
      });
    }

    // ✅ Attach user & role
    req.user = user;
    req.role = role;

    // Email-verification gate: accounts with a pending verification token that
    // have not verified their email cannot act on protected endpoints. This
    // closes the bypass where clients could use the token returned directly by
    // registration without ever verifying ownership of the email address.
    if (
      (role === "user" || role === "customer") &&
      req.user.verificationToken &&
      !req.user.isVerified
    ) {
      return res.status(403).json({
        success: false,
        message:
          "Please verify your email address before continuing. Check your inbox or request a new verification link.",
        code: "EMAIL_NOT_VERIFIED",
      });
    }

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

/* =========================================
   RESTRICT TO (alias for requireRole)
========================================= */
export const restrictTo = (...roles) => requireRole(...roles);

/* =========================================
   OPTIONAL AUTH
   Public discovery/analytics endpoints must work for anonymous shoppers while
   still personalising for signed-in customers. Unlike protect, a missing or
   invalid token is NOT an error here: req.user stays undefined and the request
   continues. Never trust any client-supplied identity - attribution is derived
   solely from the verified token (or an anonymous session id).
========================================= */
export const optionalAuth = async (req, _res, next) => {
  try {
    const token = getToken(req);
    if (!token) return next();

    const { user, role } = await resolvePrincipal(token);
    if (user) {
      req.user = user;
      req.role = role;
    }
  } catch (err) {
    // Best-effort: swallow and continue as anonymous.
  }
  next();
};