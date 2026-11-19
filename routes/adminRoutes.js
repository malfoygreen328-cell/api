// src/routes/adminRoutes.js
import express from "express";
import mongoose from "mongoose";
import path from "path";
import fs from "fs";
import Vendor from "../models/Vendor.js";
import Order from "../models/Order.js";
import LedgerEntry from "../models/LedgerEntry.js";
import PaymentTransaction from "../models/PaymentTransaction.js";
import Refund from "../models/Refund.js";
import { protect, requireRole } from "../middleware/authMiddleware.js";
import { sendEmail } from "../utils/emailService.js";
import { recordAudit } from "../services/auditService.js";
import { reconciliationReport } from "../services/reconciliationService.js";
import { syncBrandDiscoveryEligibility } from "../services/brandEligibilityService.js";
import {
  getMarketplaceCommissionRate,
  getMarketplaceCommissionPercent,
  getFoundingConfig,
  getVendorSubscriptionStatus,
  getPlanConfig,
} from "../config/platformConfig.js";

const router = express.Router();

/* ---------------- AUTH & ROLE PROTECTION ---------------- */
// superadmin must inherit all admin privileges
router.use(protect, requireRole("admin", "superadmin"));

/* ---------------- HELPERS ---------------- */
const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

const ORDER_STATUSES = [
  "pending",
  "paid",
  "processing",
  "shipped",
  "delivered",
  "cancelled",
  "refunded",
];

const ADMIN_TRANSITIONS = {
  pending: ["paid", "cancelled"],
  paid: ["processing", "cancelled"],
  processing: ["shipped", "cancelled"],
  shipped: ["delivered"],
  delivered: [],
  cancelled: [],
  refunded: [],
};

const VENDOR_STATUSES = ["PENDING", "APPROVED", "DECLINED", "SUSPENDED"];

/* ---------------- VENDOR DOCUMENTS ---------------- */

// GET: Stream a vendor's uploaded KYC document (admin only).
// Documents are never served from the public /uploads mount - they are
// resolved by exact field name and served here with content-disposition.
// Only the filename stored on the record is used (no traversal).
const VENDOR_DOC_FIELDS = new Set([
  "registrationCert",
  "directorId",
  "proofOfAddress",
  "bankLetter",
]);

router.get("/vendor/:id/document/:field", async (req, res, next) => {
  try {
    const field = req.params.field;
    if (!VENDOR_DOC_FIELDS.has(field)) {
      return res.status(400).json({ success: false, message: "Invalid document field" });
    }

    const vendor = await Vendor.findById(req.params.id).select(`documents.${field}`);
    if (!vendor) return res.status(404).json({ success: false, message: "Vendor not found" });

    const relPath = vendor.documents?.[field];
    if (!relPath) return res.status(404).json({ success: false, message: "Document not found" });

    const safeName = path.basename(relPath);
    const fullPath = path.join(process.cwd(), "uploads", safeName);

    // Only serve previously-uploaded files, never directories
    if (!safeName || !fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
      return res.status(404).json({ success: false, message: "Document not found" });
    }

    // Do not render HTML in the browser - force download
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(safeName)}"`
    );
    return res.sendFile(fullPath);
  } catch (error) {
    next(error);
  }
});

/* ---------------- VENDOR MANAGEMENT ---------------- */

// GET: List pending vendors
router.get("/vendors/pending", async (req, res, next) => {
  try {
    const vendors = await Vendor.find({ status: "PENDING" })
      .select("-password")
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      count: vendors.length,
      vendors,
    });
  } catch (error) {
    next(error);
  }
});

// GET: Get a specific vendor (admin)
router.get("/vendor/:id", async (req, res, next) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid vendor ID" });
    }
    const vendor = await Vendor.findById(req.params.id).select("-password");
    if (!vendor) return res.status(404).json({ success: false, message: "Vendor not found" });
    res.json({ success: true, vendor });
  } catch (error) {
    next(error);
  }
});

// PUT/PATCH: Update vendor (admin) - sensitive changes audited
const updateVendorHandler = async (req, res, next) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid vendor ID" });
    }
    const allowed = [
      "status",
      "subscriptionPlan",
      "subscriptionLimit",
      "subscriptionPaid",
      "subscriptionDue",
      "subscriptionStartedAt",
      "subscriptionEndsAt",
      "trialStartedAt",
      "trialEndsAt",
      "trialUsed",
      "suspendedAt",
      "suspensionReason",
      "role",
    ];
    const update = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) update[key] = req.body[key];
    }
    if (update.status !== undefined && !VENDOR_STATUSES.includes(update.status)) {
      return res.status(400).json({ success: false, message: "Invalid vendor status" });
    }
    if (update.role !== undefined && !["vendor_owner", "vendor_staff"].includes(update.role)) {
      return res.status(400).json({ success: false, message: "Invalid vendor role" });
    }

    const vendor = await Vendor.findByIdAndUpdate(req.params.id, update, {
      new: true,
      runValidators: true,
    }).select("-password");
    if (!vendor) return res.status(404).json({ success: false, message: "Vendor not found" });

    await recordAudit({
      req,
      action: "vendor.updated",
      resourceType: "vendor",
      resourceId: String(vendor._id),
      metadata: { update },
    });

    res.json({ success: true, vendor });
  } catch (error) {
    next(error);
  }
};
router.put("/vendor/:id", updateVendorHandler);
router.patch("/vendor/:id", updateVendorHandler);

// PATCH: Approve vendor
router.patch("/vendors/:id/approve", async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid vendor ID" });
    }

    const vendor = await Vendor.findById(id);
    if (!vendor) return res.status(404).json({ success: false, message: "Vendor not found" });
    if (vendor.status === "APPROVED") {
      return res.status(400).json({ success: false, message: "Vendor already approved" });
    }

    vendor.status = "APPROVED";
    await vendor.save();
    await syncBrandDiscoveryEligibility(vendor._id);

    await recordAudit({
      req,
      action: "vendor.approved",
      resourceType: "vendor",
      resourceId: String(vendor._id),
    });

    res.json({ success: true, message: "Vendor approved successfully", vendor });
  } catch (error) {
    next(error);
  }
});

// PATCH: Reject vendor
router.patch("/vendors/:id/reject", async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid vendor ID" });
    }

    const vendor = await Vendor.findById(id);
    if (!vendor) return res.status(404).json({ success: false, message: "Vendor not found" });
    if (vendor.status === "DECLINED") {
      return res.status(400).json({ success: false, message: "Vendor already rejected" });
    }

    vendor.status = "DECLINED";
    await vendor.save();

    await recordAudit({
      req,
      action: "vendor.rejected",
      resourceType: "vendor",
      resourceId: String(vendor._id),
      reason: String(req.body?.reason || "").slice(0, 1000),
    });

    res.json({ success: true, message: "Vendor rejected successfully", vendor });
  } catch (error) {
    next(error);
  }
});

// PATCH: Suspend / reinstate vendor
router.patch("/vendors/:id/suspend", async (req, res, next) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid vendor ID" });
    }
    const reason = String(req.body?.reason || "").trim().slice(0, 1000);
    const vendor = await Vendor.findByIdAndUpdate(
      req.params.id,
      { $set: { status: "SUSPENDED", suspendedAt: new Date(), suspensionReason: reason } },
      { new: true }
    ).select("-password");
    if (!vendor) return res.status(404).json({ success: false, message: "Vendor not found" });

    await recordAudit({
      req,
      action: "vendor.suspended",
      resourceType: "vendor",
      resourceId: String(vendor._id),
      reason,
    });
    res.json({ success: true, vendor });
  } catch (error) {
    next(error);
  }
});

router.patch("/vendors/:id/reinstate", async (req, res, next) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid vendor ID" });
    }
    const vendor = await Vendor.findByIdAndUpdate(
      req.params.id,
      { $set: { status: "APPROVED", suspendedAt: null, suspensionReason: "" } },
      { new: true }
    ).select("-password");
    if (!vendor) return res.status(404).json({ success: false, message: "Vendor not found" });
    await syncBrandDiscoveryEligibility(vendor._id);

    await recordAudit({
      req,
      action: "vendor.reinstated",
      resourceType: "vendor",
      resourceId: String(vendor._id),
    });
    res.json({ success: true, vendor });
  } catch (error) {
    next(error);
  }
});

/* ---------------- ORDER MANAGEMENT ---------------- */

// GET: List all orders (paginated)
router.get("/orders", async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const orders = await Order.find()
      .populate("customer", "fullName email")
      .populate("items.product", "name price")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Order.countDocuments();

    res.json({
      success: true,
      page,
      pages: Math.ceil(total / limit),
      count: orders.length,
      total,
      orders,
    });
  } catch (error) {
    next(error);
  }
});

// PUT: Update order status
router.put("/orders/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: "Invalid order ID" });
    }
    if (!status || !ORDER_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid order status" });
    }

    const order = await Order.findById(id);
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });

    if (order.status !== status) {
      const allowed = ADMIN_TRANSITIONS[order.status] || [];
      if (!allowed.includes(status)) {
        return res.status(400).json({
          success: false,
          message: `Invalid status transition from ${order.status} to ${status}`,
        });
      }
    }

    // Payment state is owned by the payment gateway/settlement service. An
    // admin must never be able to fake "paid" or cancel money already captured.
    if (status === "paid" && order.paymentStatus !== "complete") {
      return res.status(400).json({
        success: false,
        message: "An order can only be marked paid after a verified payment",
      });
    }
    if (status === "cancelled" && order.paymentStatus === "complete") {
      return res.status(400).json({
        success: false,
        message: "A paid order cannot be cancelled; use the refund workflow",
      });
    }

    order.status = status;
    for (const vo of order.vendorOrders || []) {
      if (!["cancelled", "refunded"].includes(vo.status)) vo.status = status;
    }
    await order.save();

    await recordAudit({
      req,
      action: "order.status_updated",
      resourceType: "order",
      resourceId: String(order._id),
      metadata: { status },
    });

    res.json({
      success: true,
      message: "Order status updated successfully",
      order,
    });
  } catch (error) {
    next(error);
  }
});

// GET: A handful of latest orders for the store-monitor dashboard
router.get("/orders/recent", async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 5, 50);
    const orders = await Order.find()
      .populate("customer", "fullName email")
      .sort({ createdAt: -1 })
      .limit(limit);

    res.json({ success: true, count: orders.length, data: orders });
  } catch (error) {
    next(error);
  }
});

/* ---------------- DASHBOARD STATS ---------------- */

// GET: Traffic proxy (number of vendor applications to date)
router.get("/stats/traffic", async (req, res, next) => {
  try {
    const vendors = await Vendor.countDocuments();
    const pending = await Vendor.countDocuments({ status: "PENDING" });
    res.json({ success: true, traffic: vendors, vendors, pending });
  } catch (error) {
    next(error);
  }
});

// GET: Revenue + commission totals
router.get("/stats/revenue", async (req, res, next) => {
  try {
    const paid = await Order.aggregate([
      { $match: { paymentStatus: "complete" } },
      {
        $group: {
          _id: null,
          revenue: { $sum: "$totalAmount" },
          commissionAmount: { $sum: "$commissionAmount" },
          vendorPayout: { $sum: "$vendorPayout" },
          platformProfit: { $sum: "$platformProfit" },
          count: { $sum: 1 },
        },
      },
    ]);

    const totals = paid[0] || {
      revenue: 0,
      commissionAmount: 0,
      vendorPayout: 0,
      platformProfit: 0,
      count: 0,
    };

    res.json({ success: true, ...totals, data: totals });
  } catch (error) {
    next(error);
  }
});

// GET: Top vendor by completed-order revenue
router.get("/stats/top", async (req, res, next) => {
  try {
    const top = await Order.aggregate([
      { $match: { paymentStatus: "complete" } },
      { $unwind: "$vendorOrders" },
      {
        $group: {
          _id: "$vendorOrders.vendor",
          revenue: { $sum: "$vendorOrders.subTotal" },
        },
      },
      { $sort: { revenue: -1 } },
      { $limit: 1 },
      {
        $lookup: {
          from: "vendors",
          localField: "_id",
          foreignField: "_id",
          as: "vendor",
        },
      },
      { $unwind: { path: "$vendor", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 1,
          revenue: 1,
          fullName: "$vendor.fullName",
          businessName: "$vendor.businessName",
        },
      },
    ]);

    res.json({ success: true, topVendor: top[0] || null, data: top[0] || null });
  } catch (error) {
    next(error);
  }
});

/* ---------------- SEND EMAIL ---------------- */

// POST: Send a one-off transactional email from the admin dashboard
router.post("/send-email", async (req, res, next) => {
  try {
    const { to, subject, message, html } = req.body;

    if (!to || !subject || (!message && !html)) {
      return res.status(400).json({
        success: false,
        message: "to, subject and message are required",
      });
    }

    const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to);
    if (!isValidEmail) {
      return res.status(400).json({ success: false, message: "Invalid recipient email" });
    }

    const sent = await sendEmail({
      to,
      subject: String(subject).slice(0, 200),
      html:
        html ||
        `<p>${String(message)
          .replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]))
          .replace(/\n/g, "<br/>")}</p>`,
    });

    if (!sent) {
      return res.status(502).json({ success: false, message: "Email could not be sent" });
    }

    await recordAudit({
      req,
      action: "admin.email_sent",
      resourceType: "email",
      resourceId: String(to),
      metadata: { subject },
    });

    res.json({ success: true, message: "Email sent successfully" });
  } catch (error) {
    next(error);
  }
});

/* ---------------- COMMISSION SUMMARY ---------------- */

// GET: Commission configuration + financial summary (admin only).
// Read-only: the rate itself is server config and is NOT writable via HTTP.
router.get("/commission/summary", async (req, res, next) => {
  try {
    const [paid, refunded, founders] = await Promise.all([
      Order.aggregate([
        { $match: { paymentStatus: "complete" } },
        {
          $group: {
            _id: null,
            commissionAmount: { $sum: "$commissionAmount" },
            payfastFee: { $sum: "$payfastFee" },
            vendorPayout: { $sum: "$vendorPayout" },
            platformProfit: { $sum: "$platformProfit" },
            count: { $sum: 1 },
          },
        },
      ]),
      Order.aggregate([
        { $match: { paymentStatus: "refunded" } },
        {
          $group: {
            _id: null,
            refundAmount: { $sum: "$refundAmount" },
            count: { $sum: 1 },
          },
        },
      ]),
      Vendor.countDocuments({ foundingVendor: true }),
    ]);

    const totals = paid[0] || {
      commissionAmount: 0,
      payfastFee: 0,
      vendorPayout: 0,
      platformProfit: 0,
      count: 0,
    };
    const refundedTotals = refunded[0] || { refundAmount: 0, count: 0 };
    const founding = getFoundingConfig();

    res.json({
      success: true,
      currency: "ZAR",
      commission: {
        rate: getMarketplaceCommissionRate(),
        percent: getMarketplaceCommissionPercent(),
      },
      totals: {
        paidOrders: totals.count,
        commissionAmount: totals.commissionAmount,
        payfastFee: totals.payfastFee,
        vendorPayout: totals.vendorPayout,
        platformProfit: totals.platformProfit,
        refundedOrders: refundedTotals.count,
        refundAmount: refundedTotals.refundAmount,
      },
      founders: {
        total: founders,
        commissionRate: founding.commissionRate,
        eligibleCount: founders,
      },
    });
  } catch (error) {
    next(error);
  }
});

/* ---------------- PAYMENTS / SETTLEMENTS / SUBSCRIPTIONS ---------------- */

// GET: All payments/transactions
router.get("/payments", async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const skip = (page - 1) * limit;
    const filter = {};
    if (req.query.status) filter.paymentStatus = String(req.query.status);
    if (req.query.feeStatus) filter.feeStatus = String(req.query.feeStatus);

    const [transactions, total] = await Promise.all([
      PaymentTransaction.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("order", "totalAmount paymentReference status customerEmail settlementStatus")
        .lean(),
      PaymentTransaction.countDocuments(filter),
    ]);
    res.json({ success: true, transactions, page, limit, total, pages: Math.ceil(total / limit) });
  } catch (error) {
    next(error);
  }
});

// GET: Settlements/payout overview
router.get("/settlements", async (req, res, next) => {
  try {
    const [vendorOrders, ledgerBalances, recentPayouts, blocked] = await Promise.all([
      Order.aggregate([
        { $unwind: "$vendorOrders" },
        { $match: { "vendorOrders.payoutStatus": { $ne: "paid" } } },
        {
          $group: {
            _id: "$vendorOrders.vendor",
            provisionalOwedCents: {
              $sum: {
                $multiply: [
                  { $toDouble: { $ifNull: ["$vendorOrders.provisionalVendorPayout", 0] } },
                  100,
                ],
              },
            },
            payableCents: {
              $sum: {
                $multiply: [
                  { $toDouble: { $ifNull: ["$vendorOrders.vendorPayout", 0] } },
                  100,
                ],
              },
            },
            blockedCount: {
              $sum: {
                $cond: [{ $eq: ["$vendorOrders.payoutLocked", true] }, 1, 0],
              },
            },
            count: { $sum: 1 },
          },
        },
      ]),
      LedgerEntry.aggregate([
        { $group: { _id: "$vendor", balanceCents: { $sum: "$amountCents" } } },
      ]),
      LedgerEntry.find({ type: "PAYOUT_SETTLEMENT" }).sort({ createdAt: -1 }).limit(100).lean(),
      Order.countDocuments({
        settlementStatus: { $in: ["blocked", "provisional"] },
        paymentStatus: "complete",
      }),
    ]);

    res.json({
      success: true,
      unpaidByVendor: vendorOrders,
      ledgerBalances,
      recentPayouts,
      blockedSettlements: blocked,
      executionEnabled: false,
      message:
        "Automated payout execution disabled pending PayFast marketplace settlement approval and a confirmed provider fee policy.",
    });
  } catch (error) {
    next(error);
  }
});

// GET: Subscriptions
router.get("/subscriptions", async (req, res, next) => {
  try {
    const now = new Date();
    const vendors = await Vendor.find({})
      .select(
        "fullName businessName email subscriptionPlan subscriptionPaid subscriptionDue subscriptionEndsAt subscriptionStartedAt trialStartedAt trialEndsAt trialUsed status"
      )
      .sort({ createdAt: -1 })
      .lean();

    const data = vendors.map((vendor) => ({
      ...vendor,
      plan: getPlanConfig(vendor.subscriptionPlan),
      subscription: getVendorSubscriptionStatus(vendor, now),
    }));

    res.json({ success: true, vendors: data });
  } catch (error) {
    next(error);
  }
});

// GET: Reconciliation report
router.get("/reconciliation", async (req, res, next) => {
  try {
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 100));
    const report = await reconciliationReport({ limit });
    res.json({ success: true, ...report });
  } catch (error) {
    next(error);
  }
});

// GET: Refunds (admin view)
router.get("/refunds", async (req, res, next) => {
  try {
    const refunds = await Refund.find()
      .populate("order", "totalAmount paymentStatus refundStatus customerEmail")
      .populate("admin", "fullName email")
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();
    res.json({ success: true, count: refunds.length, refunds });
  } catch (error) {
    next(error);
  }
});

// GET: Vendor balances from the append-only ledger
router.get("/ledger/balances", async (req, res, next) => {
  try {
    const balances = await LedgerEntry.aggregate([
      {
        $group: {
          _id: "$vendor",
          balanceCents: { $sum: "$amountCents" },
          lastEntryAt: { $max: "$createdAt" },
        },
      },
      { $lookup: { from: "vendors", localField: "_id", foreignField: "_id", as: "vendor" } },
      { $unwind: { path: "$vendor", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          vendorId: "$_id",
          balanceCents: 1,
          lastEntryAt: 1,
          businessName: "$vendor.businessName",
          fullName: "$vendor.fullName",
        },
      },
      { $sort: { balanceCents: -1 } },
    ]);
    res.json({ success: true, balances });
  } catch (error) {
    next(error);
  }
});

export default router;
