// src/services/ledgerService.js
//
// Append-only vendor earnings ledger.
//
// Every monetary value is an integer number of ZAR cents. The Order/vendorOrder
// documents only ever store 2-decimal rand values, so they are converted once at
// this boundary. No floating point arithmetic is performed on ledger balances.
//
// Sign convention (from the vendor's perspective):
//   SALE_CREDIT            +gross suborder subtotal
//   COMMISSION             -marketplace commission for that suborder
//   PAYMENT_FEE            -vendor share of the payment processing fee
//   REFUND_REVERSAL        -gross amount being refunded
//   COMMISSION_REVERSAL    +commission being given back
//   PAYMENT_FEE_REVERSAL   +fee being given back
//   PAYOUT_SETTLEMENT      -money transferred to the vendor
//   SUBSCRIPTION_CHARGE    -plan charge (separate from sales commission)
//   ADJUSTMENT             +/- documented correction
//
// Entries are never updated or deleted. Refunds/adjustments create new
// compensating entries with their own unique eventKey.

import mongoose from "mongoose";
import LedgerEntry from "../models/LedgerEntry.js";
import { toCents } from "../utils/finance.js";

export const CURRENCY = "ZAR";

const objectIdString = (value) => {
  if (!value) return null;
  return typeof value === "string" ? value : value.toString();
};

export const saleEventKey = (orderId, vendorOrderId, suffix) =>
  `order:${objectIdString(orderId)}:vo:${objectIdString(vendorOrderId)}:${suffix}`;

export const refundEventKey = (refundId, orderId, vendorOrderId, suffix) =>
  `refund:${objectIdString(refundId)}:order:${objectIdString(orderId)}:vo:${objectIdString(vendorOrderId)}:${suffix}`;

const validVendorOrder = (vo) =>
  vo && vo.vendor && vo._id && Number.isFinite(Number(vo.subTotal));

/**
 * Build the three ledger rows for one vendor suborder after a verified
 * payment. Amounts come exclusively from the persisted vendorOrder split
 * (which was calculated server-side at order creation) - never from a client.
 */
export const buildSaleEntriesForOrder = (
  order,
  {
    source = "payfast_ipn",
    description = "",
    feeBearer = "unresolved",
    feeAllocations = null,
  } = {}
) => {
  if (!order || !order._id) throw new Error("Order is required");
  const vendorOrders = Array.isArray(order.vendorOrders) ? order.vendorOrders : [];
  const entries = [];

  for (const vo of vendorOrders) {
    if (!validVendorOrder(vo)) continue;

    const grossCents = toCents(vo.subTotal);
    const commissionCents = Math.abs(toCents(vo.commissionAmount) || 0);

    if (grossCents === null || grossCents <= 0) continue;

    // The provider fee is a single transaction-level charge. It is only
    // allocated to a vendor when the fee bearer is the vendor AND an explicit
    // allocation map was supplied by trusted settlement policy.
    let feeCents = 0;
    if (feeBearer === "vendor" && feeAllocations) {
      const allocated = feeAllocations[objectIdString(vo._id)];
      feeCents = Math.abs(Math.round(Number(allocated) || 0));
    }

    const payoutCents = grossCents - commissionCents - feeCents;
    if (payoutCents < 0) {
      throw new Error(
        `Vendor order ${vo._id} would have a negative payout (gross ${grossCents}c - commission ${commissionCents}c - fee ${feeCents}c)`
      );
    }

    const base = {
      vendor: vo.vendor,
      order: order._id,
      vendorOrderId: vo._id,
      currency: CURRENCY,
      source,
      description,
      actorType: "system",
      metadata: {
        orderId: objectIdString(order._id),
        vendorOrderId: objectIdString(vo._id),
        subTotalCents: grossCents,
        commissionCents,
        feeBearer,
        feeAllocatedCents: feeCents,
        payoutCents,
        commissionPercent: vo.commissionPercent,
      },
    };

    entries.push({
      ...base,
      type: "SALE_CREDIT",
      amountCents: grossCents,
      eventKey: saleEventKey(order._id, vo._id, "sale"),
    });
    if (commissionCents > 0) {
      entries.push({
        ...base,
        type: "COMMISSION",
        amountCents: -commissionCents,
        eventKey: saleEventKey(order._id, vo._id, "commission"),
      });
    }
    if (feeCents > 0) {
      entries.push({
        ...base,
        type: "PAYMENT_FEE",
        amountCents: -feeCents,
        eventKey: saleEventKey(order._id, vo._id, "fee"),
      });
    }
  }

  return entries;
};

/**
 * Build compensating rows for a refund.
 *
 * `allocation` maps a vendorOrderId to the gross cents refunded for that
 * vendor. The caller decides the partial-refund allocation policy; this
 * service only records the agreed allocation, proportionally reversing
 * commission and payment fee using the same rate as the original suborder.
 * The default (no allocation supplied) reverses the full suborder for every
 * vendor - matching the current full-order refund flow.
 */
export const buildRefundEntriesForOrder = (
  order,
  refund,
  { allocation = null, source = "refund", description = "" } = {}
) => {
  if (!order || !order._id || !refund || !refund._id) {
    throw new Error("Order and refund are required");
  }
  const vendorOrders = Array.isArray(order.vendorOrders) ? order.vendorOrders : [];
  const entries = [];

  for (const vo of vendorOrders) {
    if (!validVendorOrder(vo)) continue;

    const grossCents = toCents(vo.subTotal);
    const commissionCents = Math.abs(toCents(vo.commissionAmount) || 0);
    const feeCents = Math.abs(toCents(vo.payfastFee) || 0);
    if (grossCents === null || grossCents <= 0) continue;

    let refundGross;
    if (allocation && allocation[objectIdString(vo._id)] !== undefined) {
      refundGross = Math.round(Number(allocation[objectIdString(vo._id)]) || 0);
    } else if (allocation) {
      refundGross = 0;
    } else {
      refundGross = grossCents;
    }

    if (refundGross <= 0) continue;
    if (refundGross > grossCents) {
      throw new Error(`Refund allocation for vendor order ${vo._id} exceeds its subtotal`);
    }

    const ratio = refundGross / grossCents;
    const refundCommission = Math.round(commissionCents * ratio);
    const refundFee = Math.round(feeCents * ratio);

    const base = {
      vendor: vo.vendor,
      order: order._id,
      vendorOrderId: vo._id,
      currency: CURRENCY,
      source,
      description,
      actorType: "system",
      reversalOf: null,
      metadata: {
        refundId: objectIdString(refund._id),
        orderId: objectIdString(order._id),
        vendorOrderId: objectIdString(vo._id),
        refundGrossCents: refundGross,
        ratio,
        policy:
          allocation
            ? "caller-supplied per-vendor refund allocation"
            : "full suborder reversal",
      },
    };

    entries.push({
      ...base,
      type: "REFUND_REVERSAL",
      amountCents: -refundGross,
      eventKey: refundEventKey(refund._id, order._id, vo._id, "sale"),
    });
    if (refundCommission > 0) {
      entries.push({
        ...base,
        type: "COMMISSION_REVERSAL",
        amountCents: refundCommission,
        eventKey: refundEventKey(refund._id, order._id, vo._id, "commission"),
      });
    }
    if (refundFee > 0) {
      entries.push({
        ...base,
        type: "PAYMENT_FEE_REVERSAL",
        amountCents: refundFee,
        eventKey: refundEventKey(refund._id, order._id, vo._id, "fee"),
      });
    }
  }

  return entries;
};

/**
 * Idempotently persist ledger rows. A single business event has a stable
 * eventKey per row; the unique index on eventKey is the final guard against
 * concurrent duplicate inserts. Duplicate keys are treated as success only if
 * every requested key already exists (i.e. the entire event was previously
 * recorded), otherwise the error is rethrown so the payment is not completed
 * with a partial ledger.
 */
export const postLedgerEntries = async (entries, { session = null } = {}) => {
  if (!Array.isArray(entries) || entries.length === 0) {
    return { created: 0, existing: 0, entries: [] };
  }

  const keys = entries.map((entry) => entry.eventKey);
  if (new Set(keys).size !== keys.length) {
    throw new Error("Duplicate eventKey inside a single ledger batch");
  }

  for (const entry of entries) {
    if (!Number.isInteger(entry.amountCents)) {
      throw new Error(`Ledger entry ${entry.eventKey} has a non-integer amount`);
    }
  }

  const existing = await LedgerEntry.find({ eventKey: { $in: keys } })
    .select("eventKey")
    .session(session)
    .lean();
  const existingKeys = new Set(existing.map((row) => row.eventKey));
  const missing = entries.filter((entry) => !existingKeys.has(entry.eventKey));

  if (missing.length === 0) {
    return { created: 0, existing: entries.length, entries: [] };
  }

  let inserted = [];
  try {
    inserted = await LedgerEntry.insertMany(missing, {
      ordered: true,
      session: session || undefined,
    });
  } catch (err) {
    const duplicate = err && (err.code === 11000 || err.code === 11001);
    if (!duplicate) throw err;

    // A concurrent writer may have inserted some rows between our read and
    // write. Re-read and only accept the batch if every requested key now
    // exists; otherwise surface the failure.
    const after = await LedgerEntry.find({ eventKey: { $in: keys } })
      .select("eventKey")
      .session(session)
      .lean();
    if (after.length !== entries.length) throw err;
    return { created: 0, existing: entries.length, entries: [] };
  }

  return {
    created: inserted.length,
    existing: entries.length - inserted.length,
    entries: inserted,
  };
};

export const getVendorBalanceCents = async (vendorId, { session = null } = {}) => {
  const rows = await LedgerEntry.aggregate([
    { $match: { vendor: new mongoose.Types.ObjectId(objectIdString(vendorId)) } },
    { $group: { _id: null, balanceCents: { $sum: "$amountCents" } } },
  ]).session(session);
  return rows[0]?.balanceCents || 0;
};

export const getVendorLedgerTotals = async (vendorId) => {
  const rows = await LedgerEntry.aggregate([
    { $match: { vendor: new mongoose.Types.ObjectId(objectIdString(vendorId)) } },
    {
      $group: {
        _id: "$type",
        totalCents: { $sum: "$amountCents" },
        count: { $sum: 1 },
      },
    },
  ]);
  const totals = {};
  for (const row of rows) {
    totals[row._id] = { totalCents: row.totalCents, count: row.count };
  }
  return totals;
};

export default {
  CURRENCY,
  buildSaleEntriesForOrder,
  buildRefundEntriesForOrder,
  postLedgerEntries,
  getVendorBalanceCents,
  getVendorLedgerTotals,
  saleEventKey,
  refundEventKey,
};
