// src/routes/vendorFinancialRoutes.js
import express from "express";
import mongoose from "mongoose";
import { protect, requireRole } from "../middleware/authMiddleware.js";
import Vendor from "../models/Vendor.js";
import Order from "../models/Order.js";
import LedgerEntry from "../models/LedgerEntry.js";
import { getVendorBalanceCents, getVendorLedgerTotals } from "../services/ledgerService.js";
import { getVendorSubscriptionStatus, getPlanConfig } from "../config/platformConfig.js";

const router = express.Router();

const getVendor = async (req) => {
  if (req.user?.constructor?.modelName === "Vendor") return req.user;
  if (req.user?.vendor || req.user?.vendorId) {
    const v = await Vendor.findById(req.user.vendor || req.user.vendorId);
    if (v) return v;
  }
  if (req.user?._id) {
    return (
      (await Vendor.findById(req.user._id)) ||
      (await Vendor.findOne({ user: req.user._id }))
    );
  }
  return null;
};

const vendorOnly = [protect, requireRole("vendor_owner", "vendor_staff")];

// GET /api/v1/vendor/me - alias provided by vendorAuthRoutes; this remains
// harmless if mounted again (auth still enforced)
router.get("/me", vendorOnly, async (req, res) => {
  try {
    const vendor = await getVendor(req);
    if (!vendor) return res.status(404).json({ success: false, message: "Vendor not found" });
    const plan = getPlanConfig(vendor.subscriptionPlan);
    const subscription = getVendorSubscriptionStatus(vendor);
    res.json({
      success: true,
      id: vendor._id,
      vendor: {
        id: vendor._id,
        fullName: vendor.fullName,
        businessName: vendor.businessName,
        email: vendor.email,
        role: vendor.role,
        status: vendor.status,
        subscriptionPlan: plan.name,
        subscription,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to load vendor" });
  }
});

router.get("/dashboard/summary", vendorOnly, async (req, res) => {
  try {
    const vendor = await getVendor(req);
    if (!vendor) return res.status(404).json({ success: false, message: "Vendor not found" });
    const vid = vendor._id;

    const [orders, ledgerTotals, balanceCents] = await Promise.all([
      Order.find({ "vendorOrders.vendor": vid })
        .select("status paymentStatus vendorOrders totalAmount createdAt")
        .sort({ createdAt: -1 })
        .lean(),
      getVendorLedgerTotals(vid),
      getVendorBalanceCents(vid),
    ]);

    let totalSales = 0;
    let pendingOrders = 0;
    let paidOrders = 0;
    for (const order of orders) {
      for (const vo of order.vendorOrders || []) {
        if (String(vo.vendor) !== String(vid)) continue;
        const amt = Number(vo.subTotal || 0);
        if (Number.isFinite(amt)) totalSales += amt;
        if (vo.status === "pending") pendingOrders += 1;
        if (vo.status === "paid" || order.paymentStatus === "complete") paidOrders += 1;
      }
    }

    res.json({
      success: true,
      summary: {
        totalSales: Math.round(totalSales * 100) / 100,
        orders: orders.length,
        pendingOrders,
        paidOrders,
        balanceCents,
        balanceZAR: Math.round(balanceCents) / 100,
        ledgerTotals,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to load dashboard summary" });
  }
});

router.get("/earnings", vendorOnly, async (req, res) => {
  try {
    const vendor = await getVendor(req);
    if (!vendor) return res.status(404).json({ success: false, message: "Vendor not found" });
    const [balanceCents, totals] = await Promise.all([
      getVendorBalanceCents(vendor._id),
      getVendorLedgerTotals(vendor._id),
    ]);
    res.json({
      success: true,
      earnings: {
        balanceCents,
        balanceZAR: Math.round(balanceCents) / 100,
        totals,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to load earnings" });
  }
});

router.get("/earnings/transactions", vendorOnly, async (req, res) => {
  try {
    const vendor = await getVendor(req);
    if (!vendor) return res.status(404).json({ success: false, message: "Vendor not found" });
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const skip = (page - 1) * limit;

    const filter = { vendor: vendor._id };
    if (req.query.type) filter.type = String(req.query.type);

    const [entries, total] = await Promise.all([
      LedgerEntry.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("order", "paymentReference status createdAt")
        .lean(),
      LedgerEntry.countDocuments(filter),
    ]);

    res.json({
      success: true,
      transactions: entries,
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to load transactions" });
  }
});

router.get("/commissions", vendorOnly, async (req, res) => {
  try {
    const vendor = await getVendor(req);
    if (!vendor) return res.status(404).json({ success: false, message: "Vendor not found" });
    const entries = await LedgerEntry.find({ vendor: vendor._id, type: { $in: ["COMMISSION", "COMMISSION_REVERSAL"] } })
      .sort({ createdAt: -1 })
      .lean();
    res.json({ success: true, commissions: entries });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to load commissions" });
  }
});

router.get("/payouts", vendorOnly, async (req, res) => {
  try {
    const vendor = await getVendor(req);
    if (!vendor) return res.status(404).json({ success: false, message: "Vendor not found" });
    const payouts = await LedgerEntry.find({ vendor: vendor._id, type: "PAYOUT_SETTLEMENT" })
      .sort({ createdAt: -1 })
      .lean();
    res.json({ success: true, payouts, note: "Automated vendor payouts are currently disabled pending PayFast marketplace settlement approval." });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to load payouts" });
  }
});

router.get("/settlements", vendorOnly, async (req, res) => {
  try {
    const vendor = await getVendor(req);
    if (!vendor) return res.status(404).json({ success: false, message: "Vendor not found" });
    res.json({
      success: true,
      settlements: [],
      status: "disabled",
      message: "Payout execution is disabled pending PayFast marketplace settlement approval. No automatic transfers are configured.",
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to load settlements" });
  }
});

router.get("/refunds", vendorOnly, async (req, res) => {
  try {
    const vendor = await getVendor(req);
    if (!vendor) return res.status(404).json({ success: false, message: "Vendor not found" });
    const refunds = await LedgerEntry.find({ vendor: vendor._id, type: { $in: ["REFUND_REVERSAL", "COMMISSION_REVERSAL", "PAYMENT_FEE_REVERSAL"] } })
      .sort({ createdAt: -1 })
      .lean();
    res.json({ success: true, refunds });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to load refunds" });
  }
});

router.get("/subscription", vendorOnly, async (req, res) => {
  try {
    const vendor = await getVendor(req);
    if (!vendor) return res.status(404).json({ success: false, message: "Vendor not found" });
    const plan = getPlanConfig(vendor.subscriptionPlan);
    const subscription = getVendorSubscriptionStatus(vendor);
    res.json({
      success: true,
      subscription: {
        plan: plan.name,
        amountCents: plan.amountCents,
        currency: plan.currency,
        productLimit: plan.productLimit,
        ...subscription,
        startedAt: vendor.subscriptionStartedAt,
        endsAt: vendor.subscriptionEndsAt,
        trialStartedAt: vendor.trialStartedAt,
        trialEndsAt: vendor.trialEndsAt,
        trialUsed: vendor.trialUsed,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to load subscription" });
  }
});

router.get("/subscription/history", vendorOnly, async (req, res) => {
  try {
    const vendor = await getVendor(req);
    if (!vendor) return res.status(404).json({ success: false, message: "Vendor not found" });
    res.json({
      success: true,
      history: Array.isArray(vendor.subscriptionHistory) ? vendor.subscriptionHistory : [],
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to load subscription history" });
  }
});

export default router;
