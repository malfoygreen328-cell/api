// src/services/reconciliationService.js
//
// Compare verified payments, order totals, vendor splits, commissions, fees,
// refunds and ledger balances. Discrepancies are reported as errors (never
// auto-corrected). Used by admin reporting and the dry-run migration script.

import mongoose from "mongoose";
import Order from "../models/Order.js";
import LedgerEntry from "../models/LedgerEntry.js";
import PaymentTransaction from "../models/PaymentTransaction.js";
import Refund from "../models/Refund.js";
import { toCents } from "../utils/finance.js";

const cents = (v) => {
  const c = toCents(v);
  return c === null ? 0 : c;
};

export const reconcileOrderSnapshot = (
  order,
  { transaction = null, refunds = [], ledger = [] } = {}
) => {
  const errors = [];
  const warnings = [];

  const parentCents = cents(order.totalAmount);
  const vendorOrders = Array.isArray(order.vendorOrders) ? order.vendorOrders : [];

  if (order.paymentStatus === "complete" && !transaction) {
    errors.push("Payment complete but no PaymentTransaction record exists");
  }
  if (transaction?.paymentStatus === "complete" && transaction.amountGrossCents !== parentCents) {
    errors.push(
      `PaymentTransaction amount ${transaction.amountGrossCents}c != order total ${parentCents}c`
    );
  }

  // The provider fee is a single transaction-level charge. It only lives on the
  // vendor suborders when the vendor is the fee bearer. When the marketplace
  // bears it, vendorOrders.payfastFee is intentionally 0 while order.payfastFee
  // holds the full fee - that is not a discrepancy.
  const feePushedToVendors = order.feeBearer === "vendor";

  let sumSub = 0;
  let sumComm = 0;
  let sumFee = 0;
  let sumPayout = 0;
  for (const vo of vendorOrders) {
    if (!vo.vendor || !vo._id) warnings.push("vendorOrder missing vendor or id");
    sumSub += cents(vo.subTotal);
    sumComm += cents(vo.commissionAmount);
    sumFee += cents(vo.payfastFee);
    sumPayout += cents(vo.vendorPayout);
    // A locked payout is intentionally held at 0 until the fee split is
    // definitive, so the balance equation does not apply yet.
    if (
      !vo.payoutLocked &&
      cents(vo.subTotal) - cents(vo.commissionAmount) - cents(vo.payfastFee) !== cents(vo.vendorPayout)
    ) {
      errors.push(`vendorOrder ${vo._id} does not balance`);
    }
  }

  if (vendorOrders.length > 0) {
    if (sumSub !== parentCents) errors.push(`vendorOrder subtotal sum ${sumSub}c != parent ${parentCents}c`);
    if (cents(order.commissionAmount) !== sumComm) errors.push(`order.commissionAmount ${cents(order.commissionAmount)}c != sum ${sumComm}c`);
    if (feePushedToVendors && cents(order.payfastFee) !== sumFee) {
      errors.push(`order.payfastFee ${cents(order.payfastFee)}c != sum ${sumFee}c`);
    }
    if (cents(order.vendorPayout) !== sumPayout) errors.push(`order.vendorPayout ${cents(order.vendorPayout)}c != sum ${sumPayout}c`);
  } else if (order.paymentStatus === "complete") {
    warnings.push("Order complete with no vendorOrders split - cannot post per-vendor ledger entries");
  }

  // Ledger must exist for every vendor suborder on a complete paid order
  for (const vo of vendorOrders) {
    const hasSale = ledger.some(
      (e) => String(e.vendorOrderId) === String(vo._id) && e.type === "SALE_CREDIT"
    );
    if (order.paymentStatus === "complete" && !hasSale) {
      errors.push(`Missing SALE_CREDIT ledger entry for vendorOrder ${vo._id}`);
    }
  }

  // Refund accounting
  if (order.refundStatus === "refunded") {
    const refundCents = cents(order.refundAmount) || parentCents;
    if (refunds.length === 0) warnings.push("Order refunded but no Refund document found");
    const hasReversal = ledger.some((e) => e.type === "REFUND_REVERSAL");
    if (!hasReversal) errors.push("Refunded order has no REFUND_REVERSAL ledger entries");
  }

  // Per-vendor balance check from ledger
  const vendorIds = [...new Set(vendorOrders.map((vo) => String(vo.vendor)).filter(Boolean))];
  for (const vid of vendorIds) {
    const balance = ledger
      .filter((e) => String(e.vendor) === vid)
      .reduce((acc, e) => acc + (e.amountCents || 0), 0);
    if (!Number.isInteger(balance)) errors.push(`Vendor ${vid} ledger balance is not integer cents`);
  }

  return {
    orderId: String(order._id),
    paymentStatus: order.paymentStatus,
    refundStatus: order.refundStatus,
    vendorOrderCount: vendorOrders.length,
    hasTransaction: Boolean(transaction),
    refundCount: refunds.length,
    ledgerCount: ledger.length,
    errors,
    warnings,
    ok: errors.length === 0,
  };
};

export const reconcileOrder = async (orderId) => {
  const order = await Order.findById(orderId).lean();
  if (!order) throw new Error("Order not found");

  const transaction = await PaymentTransaction.findOne({ order: order._id })
    .sort({ createdAt: -1 })
    .lean();
  const refunds = await Refund.find({ order: order._id }).lean();
  const ledger = await LedgerEntry.find({ order: order._id }).lean();

  return reconcileOrderSnapshot(order, { transaction, refunds, ledger });
};

export const reconciliationReport = async ({ limit = 100 } = {}) => {
  const orders = await Order.find({ paymentStatus: "complete" })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
  const results = [];
  for (const order of orders) {
    try {
      results.push(await reconcileOrder(order._id));
    } catch (err) {
      results.push({ orderId: String(order._id), ok: false, errors: [err.message] });
    }
  }
  const failed = results.filter((r) => !r.ok);
  return { count: results.length, failedCount: failed.length, results, failed };
};

export const dryRunMigration = async () => {
  const orders = await Order.find({}).lean();
  const report = {
    totalOrders: orders.length,
    needsLedger: [],
    completeButNoSplit: [],
    completeButNoLedger: [],
    refundedMissingReversal: [],
    duplicatePaymentRefs: [],
    missingVendorOrders: [],
    notes: [],
  };

  // Find duplicate payment references
  const refs = orders
    .map((o) => o.paymentReference)
    .filter((r) => r && r !== "PayFast");
  const seen = new Set();
  for (const ref of refs) {
    if (seen.has(ref)) {
      if (report.duplicatePaymentRefs.filter((x) => x === ref).length === 0) {
        report.duplicatePaymentRefs.push(ref);
      }
    }
    seen.add(ref);
  }

  for (const order of orders) {
    const vendorOrders = Array.isArray(order.vendorOrders) ? order.vendorOrders : [];
    const ledgerCount = await LedgerEntry.countDocuments({ order: order._id });
    const txCount = await PaymentTransaction.countDocuments({ order: order._id });

    if (order.paymentStatus === "complete" && vendorOrders.length === 0) {
      report.completeButNoSplit.push(String(order._id));
    }
    if (order.paymentStatus === "complete" && vendorOrders.length > 0 && ledgerCount === 0) {
      report.completeButNoLedger.push(String(order._id));
    }
    if (order.refundStatus === "refunded") {
      const rev = await LedgerEntry.countDocuments({ order: order._id, type: "REFUND_REVERSAL" });
      if (rev === 0) report.refundedMissingReversal.push(String(order._id));
    }
    if (order.paymentStatus === "complete" && txCount === 0) {
      report.missingVendorOrders.push({ orderId: String(order._id), reason: "complete with no PaymentTransaction" });
    }
    if (
      order.paymentStatus === "complete" &&
      vendorOrders.length > 0 &&
      ledgerCount === 0
    ) {
      report.needsLedger.push(String(order._id));
    }
  }

  report.notes.push("This is a READ-ONLY dry run. No database changes were made.");
  report.notes.push("Backfill is NOT automatic - write a reviewed, idempotent script with explicit approval before applying.");
  report.notes.push("Use ledger eventKeys tied to the verified payment to avoid double-crediting.");
  return report;
};

export default {
  reconcileOrder,
  reconcileOrderSnapshot,
  reconciliationReport,
  dryRunMigration,
};
