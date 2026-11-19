// src/services/paymentSettlementService.js
//
// Single settlement path for every verified PayFast payment (IPN or Query API
// confirmation). It performs, in order:
//   1. exact amount check (integer cents, no tolerance)
//   2. processing-state transition + PaymentTransaction upsert
//   3. append-only ledger writes per vendor suborder (idempotent eventKeys)
//   4. order + vendorOrder completion
//   5. PaymentTransaction completion
//
// Fee policy:
//   - The authoritative provider fee is the one PayFast reports on the verified
//     IPN. A missing fee is UNKNOWN, never zero.
//   - The fee is a single transaction-level charge. It is only pushed down to
//     vendors when PAYFAST_FEE_BEARER=vendor AND
//     PAYFAST_FEE_ALLOCATION=proportional are explicitly configured.
//   - Without a resolved fee/bearer, the order is marked provisional/blocked,
//     payoutLocked stays true, and no vendor payout is finalised.
//
// The ledger is written before the order is marked complete. If any step fails,
// the order is left payable so a later IPN/confirmation can retry; ledger
// eventKeys prevent double posting.

import Order from "../models/Order.js";
import PaymentTransaction from "../models/PaymentTransaction.js";
import {
  toCents,
  fromCents,
  getProviderFeeCentsFromIpn,
  getPaymentFeePolicy,
} from "../utils/finance.js";
import { resolveSettlementCommissionPercent } from "../config/platformConfig.js";
import {
  buildSaleEntriesForOrder,
  postLedgerEntries,
} from "./ledgerService.js";
import { withOptionalTransaction } from "./transactionService.js";
import { recordAudit } from "./auditService.js";

export class PaymentSettlementError extends Error {
  constructor(message, { code = "PAYMENT_SETTLEMENT_FAILED", status = 400 } = {}) {
    super(message);
    this.name = "PaymentSettlementError";
    this.code = code;
    this.status = status;
  }
}

const moneyCents = (value) => {
  const cents = toCents(value);
  return cents === null ? null : cents;
};

const asId = (value) => (value ? String(value) : "");

const distributeProportionally = (totalCents, rows) => {
  const allocations = {};
  if (!Number.isInteger(totalCents) || totalCents <= 0 || rows.length === 0) {
    return allocations;
  }

  const baseTotal = rows.reduce(
    (sum, row) => sum + Math.max(0, moneyCents(row.subTotal) || 0),
    0
  );
  if (baseTotal <= 0) return allocations;

  let allocated = 0;
  rows.forEach((row, index) => {
    const base = Math.max(0, moneyCents(row.subTotal) || 0);
    const isLast = index === rows.length - 1;
    const share = isLast
      ? totalCents - allocated
      : Math.floor((totalCents * base) / baseTotal);
    allocations[String(row._id)] = share;
    allocated += share;
  });
  return allocations;
};

const sumCents = (rows, field) =>
  rows.reduce((sum, row) => sum + (moneyCents(row[field]) || 0), 0);

/**
 * @param {object} params
 * @param {string|object} params.orderId
 * @param {object} params.ipn            Verified PayFast fields (or Query API
 *                                       raw fields). Never client-supplied JSON.
 * @param {string} params.source         payfast_ipn | order_confirmation | payfast_query
 * @param {string} params.pfPaymentId
 * @param {number} [params.commissionPercent] persisted order rate for audit
 * @returns {Promise<{order: object, transaction: object, alreadyProcessed: boolean}>}
 */
export const settleVerifiedPayment = async ({
  orderId,
  ipn = {},
  source = "payfast_ipn",
  pfPaymentId,
}) => {
  if (!orderId) {
    throw new PaymentSettlementError("orderId is required", { code: "ORDER_REQUIRED" });
  }

  const pfId = String(pfPaymentId || ipn.pf_payment_id || "").trim();
  if (!pfId) {
    throw new PaymentSettlementError("pf_payment_id is required", {
      code: "PAYMENT_ID_REQUIRED",
    });
  }

  const result = await withOptionalTransaction(async (session) => {
    const order = await Order.findById(orderId).session(session || null);
    if (!order) {
      throw new PaymentSettlementError("Order not found", {
        code: "ORDER_NOT_FOUND",
        status: 404,
      });
    }

    const orderCents = moneyCents(order.totalAmount);
    const paidCents = moneyCents(ipn.amount_gross ?? ipn.amount ?? order.totalAmount);
    if (orderCents === null || paidCents === null) {
      throw new PaymentSettlementError("Invalid payment amount", {
        code: "AMOUNT_INVALID",
      });
    }
    if (paidCents !== orderCents) {
      throw new PaymentSettlementError(
        `Amount mismatch: expected ${orderCents} cents, received ${paidCents} cents`,
        { code: "AMOUNT_MISMATCH" }
      );
    }

    // Actual provider fee only. null = unknown (do NOT treat as zero).
    const feeCents = getProviderFeeCentsFromIpn(ipn);
    const feeKnown = feeCents !== null;
    const feePolicy = getPaymentFeePolicy(order.paymentMethod || "card");
    const feeBearer = feePolicy.feeBearer;
    const bearerResolved = feeBearer === "marketplace" || feeBearer === "vendor";

    let transaction = await PaymentTransaction.findOne({ order: order._id })
      .session(session || null);

    if (transaction?.paymentStatus === "complete" && order.paymentStatus === "complete") {
      return { order, transaction, alreadyProcessed: true };
    }

    if (
      transaction?.pfPaymentId &&
      transaction.pfPaymentId !== pfId &&
      transaction.paymentStatus === "complete"
    ) {
      throw new PaymentSettlementError(
        "A different payment id has already settled this order",
        { code: "PAYMENT_ID_CONFLICT", status: 409 }
      );
    }

    if (order.paymentStatus === "complete") {
      // Order settled but transaction log incomplete - reconcile forward.
      if (!transaction) {
        transaction = await PaymentTransaction.create(
          [
            {
              order: order._id,
              user: order.customer || null,
              pfPaymentId: pfId,
              mPaymentId: asId(order._id),
              paymentStatus: "complete",
              amountGrossCents: paidCents,
              amountFeeCents: feeCents,
              amountNetCents: feeKnown ? Math.max(0, paidCents - feeCents) : null,
              feeStatus: feeKnown ? "actual" : "unknown",
              settlementStatus: order.settlementStatus || "blocked",
              signature: String(ipn.signature || ""),
              signatureValid: true,
              itnReceivedAt: new Date(),
              processedAt: order.paidAt || new Date(),
              rawPayload: ipn,
              ipnHistory: [
                {
                  paymentStatus: String(ipn.payment_status || "COMPLETE"),
                  pfPaymentId: pfId,
                  amountGross: String(ipn.amount_gross ?? ipn.amount ?? ""),
                  valid: true,
                  note: "settled order recovered from existing payment state",
                },
              ],
            },
          ],
          { session: session || undefined }
        ).then((rows) => rows[0]);
      }
      return { order, transaction, alreadyProcessed: true };
    }

    if (!transaction) {
      try {
        const rows = await PaymentTransaction.create(
          [
            {
              order: order._id,
              user: order.customer || null,
              vendorOrders: (order.vendorOrders || []).map((vo) => ({
                vendor: vo.vendor,
                vendorOrderId: vo._id,
                amountCents: Math.max(0, moneyCents(vo.subTotal) || 0),
              })),
              pfPaymentId: pfId,
              mPaymentId: asId(order._id),
              pfTransactionId: String(ipn.pf_transaction_id || ""),
              paymentStatus: "processing",
              amountGrossCents: paidCents,
              amountFeeCents: feeCents,
              amountNetCents: feeKnown ? Math.max(0, paidCents - feeCents) : null,
              feeStatus: feeKnown ? "actual" : "unknown",
              settlementStatus: "processing",
              signature: String(ipn.signature || ""),
              signatureValid: true,
              itnReceivedAt: new Date(),
              paymentProcessingAt: new Date(),
              rawPayload: ipn,
              ipnHistory: [
                {
                  paymentStatus: String(ipn.payment_status || "COMPLETE"),
                  pfPaymentId: pfId,
                  amountGross: String(ipn.amount_gross ?? ipn.amount ?? ""),
                  valid: true,
                  note: `source=${source}`,
                },
              ],
            },
          ],
          { session: session || undefined }
        );
        transaction = rows[0];
      } catch (err) {
        if (err?.code !== 11000) throw err;
        // Concurrent insert: reload and continue idempotently.
        transaction = await PaymentTransaction.findOne({ order: order._id })
          .session(session || null);
        if (!transaction) throw err;
      }
    } else {
      transaction.paymentStatus = "processing";
      transaction.pfPaymentId = pfId;
      transaction.amountGrossCents = paidCents;
      transaction.amountFeeCents = feeCents;
      transaction.amountNetCents = feeKnown ? Math.max(0, paidCents - feeCents) : null;
      transaction.feeStatus = feeKnown ? "actual" : "unknown";
      transaction.settlementStatus = "processing";
      transaction.signature = String(ipn.signature || transaction.signature || "");
      transaction.signatureValid = true;
      transaction.itnReceivedAt = transaction.itnReceivedAt || new Date();
      transaction.paymentProcessingAt = new Date();
      transaction.rawPayload = ipn;
      transaction.ipnHistory.push({
        paymentStatus: String(ipn.payment_status || "COMPLETE"),
        pfPaymentId: pfId,
        amountGross: String(ipn.amount_gross ?? ipn.amount ?? ""),
        valid: true,
        note: `source=${source}`,
      });
      await transaction.save({ session: session || undefined });
    }

    const vendorOrders = Array.isArray(order.vendorOrders) ? order.vendorOrders : [];

    // Sanity: the persisted vendor split must add up to the amount actually
    // paid. Check BEFORE any ledger write so a mismatched split can never post
    // money for an order that then fails to settle.
    if (vendorOrders.length > 0) {
      const grossSubtotalCents = sumCents(vendorOrders, "subTotal");
      if (grossSubtotalCents !== paidCents) {
        throw new PaymentSettlementError(
          `Vendor subtotal ${grossSubtotalCents}c does not equal paid amount ${paidCents}c`,
          { code: "SPLIT_MISMATCH", status: 409 }
        );
      }
    }

    // Fee allocation: only for an explicitly configured vendor-bearer policy.
    let feeAllocations = null;
    let feeAllocationStatus = "not_required";
    if (feeBearer === "vendor") {
      if (feeKnown && feePolicy.allocation === "proportional" && vendorOrders.length > 0) {
        feeAllocations = distributeProportionally(feeCents, vendorOrders);
        feeAllocationStatus = "allocated";
      } else {
        feeAllocationStatus = "unresolved";
      }
    } else if (feeBearer === "unresolved") {
      feeAllocationStatus = "unresolved";
    }

    const definitive =
      feeKnown && bearerResolved && feeAllocationStatus !== "unresolved";
    const settlementStatus = !feeKnown
      ? "blocked"
      : definitive
      ? "ready"
      : "provisional";

    order.paymentStatus = "processing";
    order.paymentReference = pfId;

    // Ledger entries use the server-calculated vendorOrder split persisted at
    // order creation. Never recompute commission from the client or request.
    const ledgerEntries = buildSaleEntriesForOrder(order, {
      source,
      description: `Payment settlement ${pfId}`,
      feeBearer,
      feeAllocations,
    });
    await postLedgerEntries(ledgerEntries, { session });

    if (vendorOrders.length > 0) {
      for (const vo of vendorOrders) {
        const grossCents = Math.max(0, moneyCents(vo.subTotal) || 0);
        const commissionCents = Math.abs(moneyCents(vo.commissionAmount) || 0);
        const allocatedFeeCents =
          feeAllocations && feeAllocations[String(vo._id)]
            ? feeAllocations[String(vo._id)]
            : 0;
        const payoutCents = grossCents - commissionCents - allocatedFeeCents;

        vo.commissionPercent = vo.commissionPercent ?? resolveSettlementCommissionPercent(order);
        vo.commissionAmount = fromCents(commissionCents);
        vo.provisionalVendorPayout = fromCents(grossCents - commissionCents);
        vo.payfastFee = fromCents(allocatedFeeCents);
        vo.vendorPayout = definitive ? fromCents(Math.max(0, payoutCents)) : 0;
        vo.providerFeeCents = feeBearer === "vendor" ? allocatedFeeCents : null;
        vo.platformNetCents = definitive ? commissionCents : null;
        vo.platformProfit = definitive ? fromCents(Math.max(0, commissionCents)) : 0;
        vo.settlementStatus = definitive ? "settled" : settlementStatus;
        vo.feeStatus = feeKnown ? "actual" : "unknown";
        vo.feeBearer = feeBearer;
        vo.status = "paid";
        vo.payoutStatus = "unpaid";
        vo.payoutLocked = !definitive;
      }

      const commissionCents = sumCents(vendorOrders, "commissionAmount");
      const payoutCents = sumCents(vendorOrders, "vendorPayout");
      const provisionalPayoutCents = sumCents(vendorOrders, "provisionalVendorPayout");

      order.commissionAmount = fromCents(commissionCents);
      order.payfastFee = feeKnown ? fromCents(feeCents) : 0;
      order.providerFeeCents = feeKnown ? feeCents : null;
      order.vendorPayout = definitive ? fromCents(payoutCents) : 0;
      order.provisionalVendorPayout = fromCents(provisionalPayoutCents);
      order.platformProfit = definitive
        ? fromCents(
            Math.max(
              0,
              feeBearer === "marketplace" ? commissionCents - feeCents : commissionCents
            )
          )
        : 0;
      order.platformNetCents = definitive
        ? feeBearer === "marketplace"
          ? commissionCents - feeCents
          : commissionCents
        : null;
      order.settlementStatus = definitive ? "settled" : settlementStatus;
      order.feeStatus = feeKnown ? "actual" : "unknown";
      order.feeBearer = feeBearer;
      order.feeAllocationStatus = feeAllocationStatus;
      order.payoutLocked = !definitive;
    } else {
      // Legacy orders without a vendor split cannot post vendor ledger entries.
      const percent = resolveSettlementCommissionPercent(order);
      const commissionCents = Math.round((percent / 100) * paidCents);
      order.commissionPercent = percent;
      order.commissionAmount = fromCents(commissionCents);
      order.payfastFee = feeKnown ? fromCents(feeCents) : 0;
      order.providerFeeCents = feeKnown ? feeCents : null;
      order.vendorPayout = 0;
      order.provisionalVendorPayout = fromCents(paidCents - commissionCents);
      order.platformProfit = 0;
      order.platformNetCents = null;
      order.settlementStatus = "blocked";
      order.feeStatus = feeKnown ? "actual" : "unknown";
      order.feeBearer = feeBearer;
      order.feeAllocationStatus = "unresolved";
      order.payoutLocked = true;
    }

    order.status = "paid";
    order.paymentStatus = "complete";
    order.paidAt = order.paidAt || new Date();

    await order.save({ session: session || undefined });

    transaction.paymentStatus = "complete";
    transaction.processedAt = new Date();
    transaction.amountFeeCents = feeCents;
    transaction.amountNetCents = feeKnown ? Math.max(0, paidCents - feeCents) : null;
    transaction.feeStatus = feeKnown ? "actual" : "unknown";
    transaction.settlementStatus = order.settlementStatus;
    transaction.vendorOrders = vendorOrders.map((vo) => ({
      vendor: vo.vendor,
      vendorOrderId: vo._id,
      amountCents: Math.max(0, moneyCents(vo.subTotal) || 0),
    }));
    await transaction.save({ session: session || undefined });

    return { order, transaction, alreadyProcessed: false };
  });

  if (result.alreadyProcessed) return result;

  // Post-commit side effects: recommendation attribution + audit. Failures are
  // logged but must not un-settle a paid order.
  try {
    const RecommendationService = (await import("./RecommendationService.js")).default;
    await RecommendationService.attributePurchase(result.order);
  } catch (err) {
    console.warn("Payment attribution warning:", err.message);
  }

  await recordAudit({
    action: "payment.settled",
    resourceType: "order",
    resourceId: String(result.order._id),
    metadata: {
      pfPaymentId: result.transaction?.pfPaymentId,
      amountCents: result.transaction?.amountGrossCents,
      providerFeeCents: result.transaction?.amountFeeCents,
      feeStatus: result.transaction?.feeStatus,
      settlementStatus: result.order?.settlementStatus,
      source,
      vendorCount: result.transaction?.vendorOrders?.length || 0,
    },
  });

  return result;
};

export default { settleVerifiedPayment, PaymentSettlementError };
