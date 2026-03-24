// src/controllers/vendorController.js
import Vendor from "../models/Vendor.js";
import { sendEmail } from "../utils/emailService.js";

/* =========================================
   CREATE VENDOR (REGISTER)
========================================= */
export const createVendor = async (req, res) => {
  try {
    const {
      fullName,
      email,
      password,
      phone,
      businessName,
      registrationNumber,
      taxNumber,
      businessType,
      subscriptionPlan,
    } = req.body;

    // Required fields check
    if (
      !fullName ||
      !email ||
      !password ||
      !phone ||
      !businessName ||
      !registrationNumber ||
      !businessType
    ) {
      return res.status(400).json({
        success: false,
        message: "All required fields must be filled.",
      });
    }

    // Email uniqueness
    const existingVendor = await Vendor.findOne({ email: email.toLowerCase() });
    if (existingVendor) {
      return res.status(400).json({
        success: false,
        message: "Email already registered.",
      });
    }

    // Required documents check
    if (
      !req.files ||
      !req.files.registrationCert ||
      !req.files.directorId ||
      !req.files.proofOfAddress
    ) {
      return res.status(400).json({
        success: false,
        message: "All required documents must be uploaded.",
      });
    }

    // Create vendor
    const vendor = new Vendor({
      fullName,
      email: email.toLowerCase(),
      password,
      phone,
      businessName,
      registrationNumber,
      taxNumber: taxNumber || "",
      businessType,
      subscriptionPlan: subscriptionPlan || "BASIC",
      documents: {
        registrationCert: req.files.registrationCert[0].path,
        directorId: req.files.directorId[0].path,
        proofOfAddress: req.files.proofOfAddress[0].path,
        bankLetter: req.files.bankLetter?.[0]?.path || "",
      },
      status: "PENDING",
    });

    await vendor.save();

    // Optional: Notify admin about new vendor registration
    await sendEmail({
      to: process.env.ADMIN_EMAIL,
      subject: `New Vendor Registration: ${vendor.businessName}`,
      html: `<p>A new vendor <b>${vendor.fullName}</b> has applied for registration.</p>
             <p>Email: ${vendor.email}</p>
             <p>Business: ${vendor.businessName}</p>`,
    });

    res.status(201).json({
      success: true,
      message: "Vendor application submitted successfully",
      vendorId: vendor._id,
    });
  } catch (error) {
    console.error("Create vendor error:", error);
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

/* =========================================
   GET ALL VENDORS (ADMIN)
========================================= */
export const getVendors = async (req, res) => {
  try {
    const vendors = await Vendor.find().sort({ createdAt: -1 });
    res.status(200).json({ success: true, data: vendors });
  } catch (error) {
    console.error("Get vendors error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/* =========================================
   GET VENDOR APPLICATIONS (ADMIN)
========================================= */
export const getVendorApplications = async (req, res) => {
  try {
    const vendors = await Vendor.find().sort({ createdAt: -1 });

    const pendingVendors = vendors.filter((v) => v.status === "PENDING");
    const totalTraffic = vendors.length;
    const totalRevenue = vendors.reduce((sum, v) => sum + (v.revenue || 0), 0);

    res.status(200).json({
      success: true,
      data: pendingVendors,
      traffic: totalTraffic,
      revenue: totalRevenue,
    });
  } catch (error) {
    console.error("Get vendor applications error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/* =========================================
   GET UNPAID VENDORS (ADMIN)
========================================= */
export const getUnpaidVendors = async (req, res) => {
  try {
    const vendors = await Vendor.find({ subscriptionDue: { $gt: 0 } }).sort({
      createdAt: -1,
    });
    res.status(200).json({ success: true, data: vendors });
  } catch (error) {
    console.error("Get unpaid vendors error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/* =========================================
   APPROVE VENDOR
========================================= */
export const approveVendor = async (req, res) => {
  try {
    const vendor = await Vendor.findById(req.params.id);
    if (!vendor)
      return res.status(404).json({ success: false, message: "Vendor not found" });

    vendor.status = "APPROVED";
    await vendor.save();

    // Notify vendor via email
    await sendEmail({
      to: vendor.email,
      subject: "Vendor Application Approved",
      html: `<p>Congratulations! Your vendor application for <b>${vendor.businessName}</b> has been approved.</p>`,
    });

    res.status(200).json({ success: true, message: "Vendor approved" });
  } catch (error) {
    console.error("Approve vendor error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/* =========================================
   DECLINE VENDOR
========================================= */
export const declineVendor = async (req, res) => {
  try {
    const vendor = await Vendor.findById(req.params.id);
    if (!vendor)
      return res.status(404).json({ success: false, message: "Vendor not found" });

    vendor.status = "DECLINED";
    await vendor.save();

    // Notify vendor via email
    await sendEmail({
      to: vendor.email,
      subject: "Vendor Application Declined",
      html: `<p>We regret to inform you that your vendor application for <b>${vendor.businessName}</b> has been declined.</p>`,
    });

    res.status(200).json({ success: true, message: "Vendor declined" });
  } catch (error) {
    console.error("Decline vendor error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/* =========================================
   UPDATE VENDOR
========================================= */
export const updateVendor = async (req, res) => {
  try {
    const { id } = req.params;
    const vendor = await Vendor.findById(id);
    if (!vendor) return res.status(404).json({ success: false, message: "Vendor not found" });

    Object.assign(vendor, req.body);
    await vendor.save();

    res
      .status(200)
      .json({ success: true, message: "Vendor updated successfully", data: vendor });
  } catch (error) {
    console.error("Update vendor error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/* =========================================
   DELETE VENDOR
========================================= */
export const deleteVendor = async (req, res) => {
  try {
    const { id } = req.params;
    const vendor = await Vendor.findByIdAndDelete(id);
    if (!vendor) return res.status(404).json({ success: false, message: "Vendor not found" });

    res.status(200).json({ success: true, message: "Vendor deleted successfully" });
  } catch (error) {
    console.error("Delete vendor error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/* =========================================
   VENDOR DASHBOARD
========================================= */
export const getVendorDashboard = async (req, res) => {
  try {
    const vendor = await Vendor.findById(req.user._id);
    if (!vendor) return res.status(404).json({ success: false, message: "Vendor not found" });

    res.status(200).json({ success: true, data: vendor });
  } catch (error) {
    console.error("Vendor dashboard error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};