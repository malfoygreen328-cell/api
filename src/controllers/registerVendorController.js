// controllers/registerVendorController.js
import Vendor from "../models/Vendor.js";
import Store from "../models/Store.js";
import bcrypt from "bcryptjs";

/**
 * Register a new vendor (VendorOnboarding)
 * POST /api/v1/vendor/register
 * Public route
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
    } = req.body;

    // ---------------- Validation ----------------
    if (!fullName || !businessName || !email || !password || !phone || !registrationNumber || !businessType) {
      return res.status(400).json({
        success: false,
        message: "All required fields must be filled",
      });
    }

    // Check if email already exists
    const existingVendor = await Vendor.findOne({ email });
    if (existingVendor) {
      return res.status(400).json({
        success: false,
        message: "Email already registered",
      });
    }

    // ---------------- Handle uploaded files ----------------
    const registrationCert = req.files?.registrationCert?.[0]?.path;
    const directorId = req.files?.directorId?.[0]?.path;
    const proofOfAddress = req.files?.proofOfAddress?.[0]?.path;

    if (!registrationCert || !directorId || !proofOfAddress) {
      return res.status(400).json({
        success: false,
        message: "All required documents must be uploaded",
      });
    }

    // ---------------- Hash Password ----------------
    const hashedPassword = await bcrypt.hash(password, 12);

    // ---------------- Create Vendor ----------------
    const vendor = await Vendor.create({
      fullName,
      businessName,
      email,
      password: hashedPassword,
      phone,
      registrationNumber,
      taxNumber,
      businessType,
      subscriptionPlan: subscription || "BASIC", // matches schema
      documents: {
        registrationCert,
        directorId,        // matches schema
        proofOfAddress,
      },
      status: "PENDING",
      role: "vendor_owner",
    });

    // ---------------- Optional: Create empty store ----------------
    await Store.create({
      vendor: vendor._id,
      name: businessName,
    });

    // ---------------- Response ----------------
    return res.status(201).json({
      success: true,
      message:
        "Vendor registered successfully. Await admin approval to activate your account.",
      vendorId: vendor._id,
    });
  } catch (error) {
    console.error("Register Vendor Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error. Please try again later.",
    });
  }
};