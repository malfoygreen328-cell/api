// src/config/platformConfig.js
//
// Central marketplace commission + founding-vendor configuration.
// All values are read lazily from process.env: server.js calls dotenv.config()
// in its module body, and ESM imports are hoisted, so env vars are NOT available
// at module-load time.

const DEFAULT_COMMISSION_RATE = 0.05; // 5%
const DEFAULT_FOUNDING_COMMISSION_RATE = 0.05; // 5%
const DEFAULT_FOUNDING_RATE_LOCKED = true;

const toFiniteNumber = (value) => {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  if (trimmed === "") return null;
  const num = Number(trimmed);
  return Number.isFinite(num) ? num : null;
};

const toBool = (value, fallback) => {
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  return fallback;
};

/**
 * Marketplace commission rate as a decimal fraction (0.05 = 5%).
 * Accepts either rate form (0.05) or percent form (5) in
 * MARKETPLACE_COMMISSION_RATE; invalid or out-of-range values fall back
 * to the 5% default.
 *
 * NOTE: the legacy PLATFORM_COMMISSION_PERCENT variable is intentionally
 * NOT read here - it may hold a stale value (e.g. 10) in production and
 * would silently override the intended standard rate.
 */
export const getMarketplaceCommissionRate = () => {
  const raw = toFiniteNumber(process.env.MARKETPLACE_COMMISSION_RATE);
  if (raw !== null) {
    if (raw > 0 && raw <= 1) return raw;
    if (raw > 1 && raw <= 100) return raw / 100;
  }
  return DEFAULT_COMMISSION_RATE;
};

/**
 * Same as above but expressed as a percentage (5 = 5%).
 */
export const getMarketplaceCommissionPercent = () => {
  const percent = getMarketplaceCommissionRate() * 100;
  return Math.round(percent * 1e6) / 1e6;
};

/* =========================================================
   FOUNDING VENDOR PROGRAM
   ========================================================= */

const parseDate = (value) => {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const date = new Date(String(value).trim());
  return Number.isNaN(date.getTime()) ? null : date;
};

export const getFoundingConfig = () => ({
  enabled: toBool(process.env.FOUNDING_VENDOR_ENABLED, true),
  startDate: parseDate(process.env.FOUNDING_VENDOR_START_DATE),
  endDate: parseDate(process.env.FOUNDING_VENDOR_END_DATE),
  commissionRate: (() => {
    const raw = toFiniteNumber(process.env.FOUNDING_VENDOR_COMMISSION_RATE);
    if (raw !== null) {
      if (raw > 0 && raw <= 1) return raw;
      if (raw > 1 && raw <= 100) return raw / 100;
    }
    return DEFAULT_FOUNDING_COMMISSION_RATE;
  })(),
  rateLocked: toBool(process.env.FOUNDING_VENDOR_RATE_LOCKED, DEFAULT_FOUNDING_RATE_LOCKED),
});

/**
 * Is the given moment inside the founding-vendor enrollment window?
 * No start date = open from the beginning; no end date = open-ended.
 */
export const isFoundingVendorPeriod = (date = new Date()) => {
  const { enabled, startDate, endDate } = getFoundingConfig();
  if (!enabled) return false;
  const at = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  if (startDate && at < startDate) return false;
  if (endDate && at > endDate) return false;
  return true;
};

/**
 * Fields to stamp on a Vendor when it is created during the founding window.
 */
export const getFoundingVendorRegistrationFields = () => {
  if (!isFoundingVendorPeriod()) return {};
  const founding = getFoundingConfig();
  return {
    foundingVendor: true,
    foundingVendorSince: new Date(),
    commissionRateLocked: founding.rateLocked,
    lockedCommissionRate: founding.rateLocked ? founding.commissionRate : null,
  };
};

/**
 * Effective commission rate (decimal fraction) for a given vendor.
 * Priority:
 *   1. A locked rate stored on the vendor (permanent for that vendor).
 *   2. Founding vendors keep the founding rate while the program window
 *      is still open (for unlocked founding vendors the rate lapses with
 *      the window).
 *   3. Standard marketplace rate.
 */
export const getCommissionRateForVendor = (vendor, at = new Date()) => {
  if (vendor) {
    if (vendor.commissionRateLocked) {
      const locked = toFiniteNumber(vendor.lockedCommissionRate);
      if (locked !== null && locked >= 0 && locked <= 1) return locked;
    }
    if (vendor.foundingVendor && isFoundingVendorPeriod(at)) {
      return getFoundingConfig().commissionRate;
    }
  }
  return getMarketplaceCommissionRate();
};

/* =========================================================
   ORDER SETTLEMENT
   ========================================================= */

/**
 * Commission percent to use when settling (paying) an order.
 * Orders created after commission-percent persistence carry their own
 * rate; legacy orders (null) fall back to the current configuration.
 * Never re-derives the rate from the client or from the legacy env var.
 */
export const resolveSettlementCommissionPercent = (order) => {
  const persisted = toFiniteNumber(order?.commissionPercent);
  if (persisted !== null && persisted >= 0 && persisted <= 100) return persisted;
  return getMarketplaceCommissionPercent();
};

/* =========================================================
   SUBSCRIPTION PLANS
   ========================================================= */

export const TRIAL_DAYS = Number(process.env.VENDOR_TRIAL_DAYS) > 0
  ? Number(process.env.VENDOR_TRIAL_DAYS)
  : 90;

export const PLAN_CATALOG = Object.freeze({
  BASIC: { name: "BASIC", amountCents: 15000, currency: "ZAR", productLimit: 50, commissionRate: null },
  PREMIUM: { name: "PREMIUM", amountCents: 38000, currency: "ZAR", productLimit: 1000, commissionRate: null },
  COMMISSION: { name: "COMMISSION", amountCents: 0, currency: "ZAR", productLimit: Number.MAX_SAFE_INTEGER, commissionRate: null },
});

export const getPlanConfig = (plan) => {
  const key = String(plan || "BASIC").toUpperCase();
  return PLAN_CATALOG[key] || PLAN_CATALOG.BASIC;
};

export const getVendorTrialFields = (startedAt = new Date()) => {
  const start = startedAt instanceof Date && !Number.isNaN(startedAt.getTime()) ? startedAt : new Date();
  return {
    trialStartedAt: start,
    trialEndsAt: new Date(start.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000),
    trialUsed: true,
  };
};

const dateOrNull = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const getVendorSubscriptionStatus = (vendor, now = new Date()) => {
  const trialEndsAt = dateOrNull(vendor?.trialEndsAt);
  const subscriptionEndsAt = dateOrNull(vendor?.subscriptionEndsAt);
  const plan = getPlanConfig(vendor?.subscriptionPlan);
  const isTrialActive = Boolean(trialEndsAt && trialEndsAt > now);
  const isSubscriptionActive = Boolean(subscriptionEndsAt && subscriptionEndsAt > now);
  return {
    plan: plan.name,
    planConfig: plan,
    trialActive: isTrialActive,
    trialEndsAt,
    subscriptionActive: isSubscriptionActive,
    subscriptionEndsAt,
    active: isTrialActive || isSubscriptionActive,
    productLimit: isTrialActive || isSubscriptionActive ? plan.productLimit : 0,
  };
};
