import Vendor from "../models/Vendor.js";
import User from "../models/User.js";
import Store from "../models/Store.js";
import { generateToken, setAuthCookie, clearAuthCookie } from "../utils/jwt.js";
import {
  getVendorSubscriptionStatus,
  getPlanConfig,
} from "../config/platformConfig.js";

const publicVendor = (vendor) => {
  const plan = getPlanConfig(vendor.subscriptionPlan);
  const subscription = getVendorSubscriptionStatus(vendor);
  return {
    id: vendor._id,
    _id: vendor._id,
    name: vendor.fullName,
    fullName: vendor.fullName,
    businessName: vendor.businessName,
    storeName: vendor.businessName,
    email: vendor.email,
    phone: vendor.phone,
    role: vendor.role || "vendor_owner",
    status: vendor.status,
    store: vendor.store || null,
    subscriptionPlan: plan.name,
    subscription,
    createdAt: vendor.createdAt,
  };
};

const findVendorByEmail = async (email) => {
  const normalized = String(email || "").trim().toLowerCase();
  let vendor = await Vendor.findOne({ email: normalized }).select("+password");
  if (vendor) return vendor;

  // Legacy User-vendor fallback: resolve the linked canonical Vendor record.
  const legacy = await User.findOne({ email: normalized }).select("+password");
  if (!legacy) return null;
  vendor = await Vendor.findOne({ $or: [{ user: legacy._id }, { email: legacy.email }] })
    .select("+password");
  if (vendor) return vendor;
  return null;
};

// Legacy direct registration. The public vendor portal uses the full
// onboarding route (/api/vendor/register) so KYC documents and the canonical
// Vendor+Store are created together. This handler remains for API
// compatibility but now delegates to that same validation/flow.
export const registerVendor = async (req, res) => {
  const { registerVendor: registerVendorFull } = await import(
    "./registerVendorController.js"
  );
  return registerVendorFull(req, res);
};

export const loginVendor = async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required" });
    }

    const vendor = await findVendorByEmail(email);
    if (!vendor || !vendor.password) {
      return res.status(401).json({ success: false, message: "Invalid email or password" });
    }

    if (vendor.status === "SUSPENDED") {
      return res.status(403).json({
        success: false,
        message: "This vendor account is suspended. Please contact support.",
      });
    }
    if (vendor.status === "DECLINED") {
      return res.status(403).json({
        success: false,
        message: "This vendor application was declined. Please contact support.",
      });
    }

    const isMatch = await vendor.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: "Invalid email or password" });
    }

    const token = generateToken(vendor._id, vendor.role || "vendor_owner");
    setAuthCookie(res, token);

    const profile = publicVendor(vendor);
    res.json({
      success: true,
      message: "Login successful",
      token,
      ...profile,
      vendor: profile,
    });
  } catch (error) {
    console.error("Vendor login error:", error.message);
    res.status(500).json({ success: false, message: "Login failed" });
  }
};

export const getVendorMe = async (req, res) => {
  try {
    if (!req.user || !["vendor_owner", "vendor_staff"].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: "Vendor access only" });
    }

    // req.user is the canonical Vendor for vendor tokens. Legacy tokens resolve
    // through attachVendorContext and expose vendorId.
    const vendor =
      req.user.constructor?.modelName === "Vendor"
        ? req.user
        : await Vendor.findById(req.user.vendor || req.user.vendorId).select("-password");
    if (!vendor) {
      return res.status(404).json({ success: false, message: "Vendor not found" });
    }

    const store = vendor.store ? await Store.findById(vendor.store) : null;
    const profile = publicVendor(vendor);
    res.json({
      success: true,
      ...profile,
      user: profile,
      storeDetails: store,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Could not load vendor profile" });
  }
};

export const logoutVendor = async (_req, res) => {
  clearAuthCookie(res);
  res.json({ success: true, message: "Logged out successfully" });
};

export default { registerVendor, loginVendor, getVendorMe, logoutVendor };
