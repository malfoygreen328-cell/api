// src/utils/finance.js
//
// Money helpers for Azania. Everything that reaches the ledger is handled in
// exact integer ZAR cents; rand values only exist at the document/API boundary.
//
// IMPORTANT - payment provider fee policy:
// The published PayFast card rate below is INDICATIVE ONLY (it excludes VAT)
// and is NOT proof of Azania's approved merchant agreement. Unless the server
// environment explicitly confirms the schedule AND the fee bearer, all
// settlement figures must be treated as provisional. Callers can never certify
// a fee schedule from a browser request; only trusted server config is read.

import { getMarketplaceCommissionPercent } from "../config/platformConfig.js";

const round = (num) => Math.round((num + Number.EPSILON) * 100) / 100;

export const toCents = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const num = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(num)) return null;
  return Math.round(num * 100);
};

export const fromCents = (cents) => {
  if (cents === null || cents === undefined) return null;
  const num = Number(cents);
  if (!Number.isFinite(num)) return null;
  return Math.round(num) / 100;
};

export const roundCents = (value) => Math.round(Number(value) || 0);

export const calculateCommissionCents = (amountCents, percent) => {
  if (!Number.isInteger(amountCents) || amountCents < 0) {
    throw new Error("Invalid amountCents");
  }
  const rate = Number(percent);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
    throw new Error("Invalid commission percent");
  }
  return Math.round((rate / 100) * amountCents);
};

/* =========================================================
   FEE SCHEDULE - INDICATIVE ONLY
   ========================================================= */

const FEE_DEFAULTS = Object.freeze({
  percent: 3.2,
  fixed: 2.0,
  currency: "ZAR",
  excludesVat: true,
});

export const FEE_SCHEDULE = Object.freeze({
  card: Object.freeze({
    method: "card",
    type: "percentage_plus_fixed",
    percent: FEE_DEFAULTS.percent,
    fixed: FEE_DEFAULTS.fixed,
    currency: FEE_DEFAULTS.currency,
    feeBearerDefault: "unknown",
    confirmed: false,
    indicative: true,
    excludesVat: true,
    notes: "Published PayFast card rate (indicative only, excludes VAT). Not confirmed for Azania.",
  }),
  payfast: Object.freeze({
    method: "payfast",
    type: "percentage_plus_fixed",
    percent: FEE_DEFAULTS.percent,
    fixed: FEE_DEFAULTS.fixed,
    currency: FEE_DEFAULTS.currency,
    feeBearerDefault: "unknown",
    confirmed: false,
    indicative: true,
    excludesVat: true,
    notes: "Legacy alias for card (indicative only).",
  }),
  "instant-eft": Object.freeze({
    method: "instant-eft",
    type: "percentage_with_minimum",
    percent: 2.0,
    fixed: 0,
    minimum: 2.0,
    currency: FEE_DEFAULTS.currency,
    feeBearerDefault: "unknown",
    confirmed: false,
    indicative: true,
    excludesVat: true,
    notes: "Published PayFast Instant EFT rate (indicative only, excludes VAT, min R2).",
  }),
  "capitec-pay": Object.freeze({
    method: "capitec-pay",
    type: "percentage_with_minimum",
    percent: 2.0,
    fixed: 0,
    minimum: 2.0,
    currency: FEE_DEFAULTS.currency,
    feeBearerDefault: "unknown",
    confirmed: false,
    indicative: true,
    excludesVat: true,
    notes: "Published PayFast Capitec Pay rate (indicative only, excludes VAT, min R2).",
  }),
  eft: Object.freeze({
    method: "eft",
    type: "unknown",
    percent: null,
    fixed: null,
    minimum: null,
    feeBearerDefault: "unknown",
    confirmed: false,
    indicative: false,
    excludesVat: true,
    notes: "Fee structure not confirmed from codebase.",
  }),
  snapscan: Object.freeze({
    method: "snapscan",
    type: "unknown",
    percent: null,
    fixed: null,
    minimum: null,
    feeBearerDefault: "unknown",
    confirmed: false,
    indicative: false,
    excludesVat: true,
    notes: "Fee structure not confirmed from codebase.",
  }),
  yobogate: Object.freeze({
    method: "yobogate",
    type: "unknown",
    percent: null,
    fixed: null,
    minimum: null,
    feeBearerDefault: "unknown",
    confirmed: false,
    indicative: false,
    excludesVat: true,
    notes: "Fee structure not confirmed from codebase.",
  }),
});

const normalizeMethod = (paymentMethod) =>
  String(paymentMethod || "card").toLowerCase().replace(/_/g, "-");

export const getFeeSchedule = (paymentMethod = "card") =>
  FEE_SCHEDULE[normalizeMethod(paymentMethod)] || null;

const calculateFeeFromScheduleCents = (amountCents, schedule) => {
  if (!schedule) throw new Error("Fee schedule not found");
  if (schedule.type === "percentage_plus_fixed") {
    return (
      Math.round((Number(schedule.percent) / 100) * amountCents) +
      Math.round(Number(schedule.fixed) * 100)
    );
  }
  if (schedule.type === "percentage_with_minimum") {
    const pctFee = Math.round((Number(schedule.percent) / 100) * amountCents);
    const minFee = Math.round(Number(schedule.minimum || 0) * 100);
    return Math.max(pctFee, minFee);
  }
  throw new Error(`Fee structure unknown for ${schedule.method}`);
};

/* =========================================================
   SERVER-ONLY FEE POLICY
   ========================================================= */

const feeBearerFromEnv = () => {
  const raw = String(process.env.PAYFAST_FEE_BEARER || "").trim().toLowerCase();
  if (raw === "marketplace" || raw === "vendor") return raw;
  return "unresolved";
};

/**
 * Read the trusted fee policy from server config. Never accept any part of
 * this from a request body.
 *
 *   PAYFAST_FEE_SCHEDULE_CONFIRMED=true   -> schedule may be estimated
 *   PAYFAST_FEE_PERCENT=3.2               -> optional confirmed percent
 *   PAYFAST_FEE_FIXED_CENTS=200           -> optional confirmed fixed cents
 *   PAYFAST_FEE_BEARER=marketplace|vendor -> who pays the provider fee
 *   PAYFAST_FEE_ALLOCATION=proportional   -> required for vendor-bearer
 *                                            multi-vendor orders
 */
export const getPaymentFeePolicy = (paymentMethod = "card") => {
  const method = normalizeMethod(paymentMethod);
  const schedule = getFeeSchedule(method);
  const confirmed = process.env.PAYFAST_FEE_SCHEDULE_CONFIRMED === "true";

  const percentEnv = process.env.PAYFAST_FEE_PERCENT;
  const percent =
    percentEnv !== undefined && percentEnv !== ""
      ? Number(percentEnv)
      : schedule?.percent;

  const fixedCentsEnv = process.env.PAYFAST_FEE_FIXED_CENTS;
  const fixedCents =
    fixedCentsEnv !== undefined && fixedCentsEnv !== ""
      ? Math.round(Number(fixedCentsEnv))
      : schedule?.fixed !== null && schedule?.fixed !== undefined
      ? Math.round(Number(schedule.fixed) * 100)
      : null;

  const minimumCents =
    schedule?.minimum !== null && schedule?.minimum !== undefined
      ? Math.round(Number(schedule.minimum) * 100)
      : null;

  return {
    paymentMethod: method,
    schedule,
    scheduleConfirmed: confirmed,
    type: schedule?.type || "unknown",
    percent: Number.isFinite(percent) ? percent : null,
    fixedCents: Number.isFinite(fixedCents) ? fixedCents : null,
    minimumCents,
    feeBearer: feeBearerFromEnv(),
    allocation: String(process.env.PAYFAST_FEE_ALLOCATION || "").trim().toLowerCase(),
    executable: confirmed && feeBearerFromEnv() !== "unresolved",
  };
};

/**
 * Estimate the provider fee from trusted config. Returns null when the
 * schedule is not explicitly confirmed or unknown for the method.
 */
export const estimateProviderFeeCents = (amountCents, paymentMethod = "card") => {
  if (!Number.isInteger(amountCents) || amountCents < 0) {
    throw new Error("Invalid amountCents");
  }
  const policy = getPaymentFeePolicy(paymentMethod);
  if (!policy.scheduleConfirmed || policy.type === "unknown") return null;

  if (policy.type === "percentage_plus_fixed") {
    if (!Number.isFinite(policy.percent) || !Number.isFinite(policy.fixedCents)) return null;
    return Math.round((policy.percent / 100) * amountCents) + policy.fixedCents;
  }
  if (policy.type === "percentage_with_minimum") {
    if (!Number.isFinite(policy.percent)) return null;
    return Math.max(
      Math.round((policy.percent / 100) * amountCents),
      policy.minimumCents || 0
    );
  }
  return null;
};

/**
 * The authoritative fee is the one PayFast reports on the verified IPN.
 * Missing/blank amounts are UNKNOWN - never silently treated as zero.
 */
export const getProviderFeeCentsFromIpn = (ipn = {}) => {
  const raw = ipn.amount_fee;
  if (raw === undefined || raw === null || String(raw).trim() === "") return null;
  const cents = toCents(raw);
  if (cents === null || cents < 0) return null;
  return cents;
};

/* =========================================================
   LEGACY RAND HELPERS (kept for compatibility)
   ========================================================= */

const validateAmount = (amount) => {
  if (typeof amount !== "number" || isNaN(amount) || amount <= 0) {
    throw new Error("Invalid amount");
  }
};

export const calculateCommission = (
  amount,
  percent = getMarketplaceCommissionPercent()
) => {
  validateAmount(amount);
  const rate = Number(percent);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
    throw new Error("Invalid commission percent");
  }
  return round((rate / 100) * amount);
};

// Uses the indicative schedule only; prefer estimateProviderFeeCents().
export const calculatePayfastFee = (
  amount,
  percent = FEE_DEFAULTS.percent,
  fixed = FEE_DEFAULTS.fixed
) => {
  validateAmount(amount);
  return round((percent / 100) * amount + fixed);
};

export const calculateVendorPayout = (amount, commission, fee = 0) => {
  const payout = Number(amount) - Number(commission) - Number(fee);
  return Math.max(0, round(payout));
};

export const calculatePlatformProfit = (commission, fee = 0) =>
  Math.max(0, round(Number(commission) - Number(fee)));

/* =========================================================
   ORDER BREAKDOWN
   ========================================================= */

/**
 * Build a transaction-level breakdown.
 *
 * Definitive figures are returned ONLY when both the provider fee is known
 * (actual IPN fee, or an explicitly confirmed schedule) and the fee bearer has
 * been resolved from server config. Otherwise the result is explicitly marked
 * `definitive: false` with a settlement status of `provisional` (fee known,
 * bearer unknown) or `blocked` (fee/bearer unknown). Callers must not present
 * provisional figures as an amount owed.
 *
 * @param {object} params
 * @param {number} [params.providerFeeCents] actual provider fee in cents
 * @param {number} [params.providerFee]      legacy rand equivalent
 * @param {string} [params.feeBearer]        ignored unless it matches server policy
 * @param {boolean} [params.feeScheduleConfirmed] ignored (server config only)
 */
export const calculateOrderBreakdown = ({
  customerTransactionAmount,
  eligibleVendorSubtotal,
  amount,
  subtotal,
  commissionPercent = getMarketplaceCommissionPercent(),
  paymentMethod = "card",
  providerFeeCents,
  providerFee,
  // Accepted for backwards compatibility but never trusted:
  feeBearer: _ignoredFeeBearer,
  feeScheduleConfirmed: _ignoredFeeScheduleConfirmed,
  feeOverrides = {},
  platformBearsFee: _ignoredPlatformBearsFee,
  vendorOrderAllocations: _ignoredVendorOrderAllocations,
} = {}) => {
  const custAmt =
    customerTransactionAmount !== undefined ? customerTransactionAmount : amount;
  const vendSub =
    eligibleVendorSubtotal !== undefined
      ? eligibleVendorSubtotal
      : subtotal !== undefined
      ? subtotal
      : custAmt;

  validateAmount(custAmt);
  validateAmount(vendSub);

  const method = normalizeMethod(paymentMethod);
  const policy = getPaymentFeePolicy(method);

  const custCents = toCents(custAmt);
  const vendCents = toCents(vendSub);
  if (custCents === null || vendCents === null) {
    throw new Error("Invalid amount");
  }

  const commissionCents = calculateCommissionCents(vendCents, commissionPercent);

  let actualFeeCents = null;
  let feeStatus = "unknown";
  if (Number.isInteger(providerFeeCents) && providerFeeCents >= 0) {
    actualFeeCents = providerFeeCents;
    feeStatus = "actual";
  } else if (typeof providerFee === "number" && Number.isFinite(providerFee)) {
    actualFeeCents = Math.max(0, Math.round(providerFee * 100));
    feeStatus = "actual";
  } else {
    const estimated = estimateProviderFeeCents(custCents, method);
    if (estimated !== null) {
      actualFeeCents = estimated;
      feeStatus = "estimated";
    }
  }

  const feeBearer = policy.feeBearer;
  const bearerResolved = feeBearer === "marketplace" || feeBearer === "vendor";
  const feeKnown = actualFeeCents !== null;

  let settlementStatus;
  let reason;
  if (!feeKnown && !bearerResolved) {
    settlementStatus = "blocked";
    reason = "Payment provider fee and fee bearer are unresolved";
  } else if (!feeKnown) {
    settlementStatus = "blocked";
    reason = "Payment provider fee is unresolved";
  } else if (!bearerResolved) {
    settlementStatus = "provisional";
    reason = "Payment provider fee is known but the fee bearer is unresolved";
  } else {
    settlementStatus = "ready";
    reason = "";
  }
  const definitive = settlementStatus === "ready";

  const provisionalVendorPayoutCents = vendCents - commissionCents;
  let vendorPayoutCents = null;
  let platformNetCents = null;
  if (definitive) {
    if (feeBearer === "marketplace") {
      vendorPayoutCents = provisionalVendorPayoutCents;
      platformNetCents = commissionCents - actualFeeCents;
    } else {
      vendorPayoutCents = provisionalVendorPayoutCents - actualFeeCents;
      platformNetCents = commissionCents;
    }
    if (vendorPayoutCents < 0) {
      settlementStatus = "blocked";
      reason = "Provider fee exceeds vendor subtotal after commission; manual review required";
      vendorPayoutCents = null;
      platformNetCents = null;
    }
  }

  const toRand = (cents) => (cents === null ? null : fromCents(cents));

  return {
    currency: "ZAR",
    paymentMethod: method,
    customerTransactionAmount: fromCents(custCents),
    eligibleVendorSubtotal: fromCents(vendCents),

    commissionPercent,
    commission: fromCents(commissionCents),
    azaniaCommission: fromCents(commissionCents),
    commissionCents,
    azaniaGrossCommissionRevenue: fromCents(commissionCents),
    platformGrossCommission: fromCents(commissionCents),

    providerFee: toRand(actualFeeCents),
    payfastFee: toRand(actualFeeCents),
    providerFeeCents: actualFeeCents,
    feeStatus,
    feeBearer,
    feeAllocation: policy.allocation || null,
    feeScheduleConfirmed: policy.scheduleConfirmed,
    providerFeeSchedule: {
      method: policy.schedule?.method || method,
      type: policy.type,
      percent: policy.percent,
      fixedCents: policy.fixedCents,
      minimumCents: policy.minimumCents,
      confirmed: policy.scheduleConfirmed,
      indicative: policy.schedule?.indicative ?? true,
      excludesVat: policy.schedule?.excludesVat ?? true,
      notes: policy.schedule?.notes || "Fee schedule unavailable",
    },

    settlementStatus,
    definitive,
    settlementBlockedReason: reason,

    provisionalVendorPayout: fromCents(provisionalVendorPayoutCents),
    provisionalVendorPayoutCents,
    vendorPayableAmount: toRand(vendorPayoutCents),
    vendorPayout: toRand(vendorPayoutCents),
    platformNet: toRand(platformNetCents),
    platformProfit: toRand(platformNetCents),
    platformNetCents,
    isProfitable: platformNetCents === null ? null : platformNetCents > 0,
    feeAllocatedOnce: true,
  };
};

export const calculateCartTotal = (items = []) => {
  if (!Array.isArray(items)) {
    throw new Error("Items must be an array");
  }
  const total = items.reduce((sum, item) => {
    if (!item.price || !item.quantity) return sum;
    return sum + item.price * item.quantity;
  }, 0);
  return round(total);
};

export default {
  toCents,
  fromCents,
  roundCents,
  calculateCommissionCents,
  calculateCommission,
  calculatePayfastFee,
  calculateVendorPayout,
  calculatePlatformProfit,
  calculateOrderBreakdown,
  calculateCartTotal,
  FEE_SCHEDULE,
  getFeeSchedule,
  getPaymentFeePolicy,
  estimateProviderFeeCents,
  getProviderFeeCentsFromIpn,
};
