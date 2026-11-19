// controllers/registerVendorController.js
import Vendor from "../models/Vendor.js";
import Store from "../models/Store.js";
import {
  getFoundingVendorRegistrationFields,
  getVendorTrialFields,
} from "../config/platformConfig.js";

const ALLOWED_PLANS = new Set(["BASIC", "PREMIUM"]);

/**
 * Register a new vendor (canonical Vendor + Store onboarding).
 * POST /api/v1/vendor/register (multipart/form-data)
 * Public route.
 */
export const registerVendor = async (req, res) => {
  try {
    const {
      fullName,
      businessName,
      email,
      password,
      phone,
      subscription,
      registrationNumber,
      taxNumber,
      businessType,
      address,
    } = req.body || {};

    const normalizedEmail = String(email || "").trim().toLowerCase();
    const plan = String(subscription || "BASIC").trim().toUpperCase();

    if (
      !String(fullName || "").trim() ||
      !String(businessName || "").trim() ||
      !normalizedEmail ||
      !password ||
      !String(phone || "").trim() ||
      !String(registrationNumber || "").trim() ||
      !String(businessType || "").trim()
    ) {
      return res.status(400).json({
        success: false,
        message: "All required fields must be filled",
      });
    }

    if (!/.+@.+\..+/.test(normalizedEmail)) {
      return res.status(400).json({ success: false, message: "Please provide a valid email address" });
    }
    if (String(password).length < 6 || String(password).length > 128) {
      return res.status(400).json({
        success: false,
        message: "Password must be between 6 and 128 characters",
      });
    }
    if (!ALLOWED_PLANS.has(plan)) {
      return res.status(400).json({
        success: false,
        message: "Subscription plan must be BASIC or PREMIUM",
      });
    }

    const existingVendor = await Vendor.findOne({ email: normalizedEmail });
    if (existingVendor) {
      return res.status(409).json({
        success: false,
        message: "Email already registered",
      });
    }

    const registrationCert = req.files?.registrationCert?.[0]?.filename;
    const directorId = req.files?.directorId?.[0]?.filename;
    const proofOfAddress = req.files?.proofOfAddress?.[0]?.filename;
    const bankLetter = req.files?.bankLetter?.[0]?.filename;

    if (!registrationCert || !directorId || !proofOfAddress) {
      return res.status(400).json({
        success: false,
        message: "All required documents must be uploaded",
      });
    }

    // Password is hashed exactly once by the Vendor model's pre-save hook.
    const vendor = await Vendor.create({
      fullName: String(fullName).trim(),
      businessName: String(businessName).trim(),
      email: normalizedEmail,
      password: String(password),
      phone: String(phone).trim(),
      registrationNumber: String(registrationNumber).trim(),
      taxNumber: taxNumber ? String(taxNumber).trim() : undefined,
      businessType: String(businessType).trim(),
      address: address ? String(address).trim().slice(0, 500) : undefined,
      subscriptionPlan: plan,
      documents: {
        registrationCert,
        directorId,
        proofOfAddress,
        ...(bankLetter ? { bankLetter } : {}),
      },
      status: "PENDING",
      role: "vendor_owner",
      ...getVendorTrialFields(),
      ...getFoundingVendorRegistrationFields(),
    });

    let store = null;
    try {
      store = await Store.create({
        vendor: vendor._id,
        storeName: vendor.businessName,
      });
      vendor.store = store._id;
      await vendor.save();
    } catch (storeErr) {
      // Do not leave a half-created vendor without a store record.
      if (store?._id) await Store.deleteOne({ _id: store._id });
      await Vendor.deleteOne({ _id: vendor._id });
      throw storeErr;
    }

    return res.status(201).json({
      success: true,
      message:
        "Vendor registered successfully. Await admin approval to activate your account.",
      vendorId: vendor._id,
      id: vendor._id,
      vendor: {
        id: vendor._id,
        fullName: vendor.fullName,
        businessName: vendor.businessName,
        email: vendor.email,
        status: vendor.status,
        subscriptionPlan: vendor.subscriptionPlan,
        store: store?._id || null,
      },
      store: store
        ? { id: store._id, storeName: store.storeName, storeSlug: store.storeSlug }
        : null,
    });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ success: false, message: "Email already registered" });
    }
    if (error?.name === "ValidationError") {
      const first = Object.values(error.errors || {})[0];
      return res.status(400).json({
        success: false,
        message: first?.message || "Please check the submitted details",
      });
    }
    console.error("Register Vendor Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error. Please try again later.",
    });
  }
};

export default registerVendor;
