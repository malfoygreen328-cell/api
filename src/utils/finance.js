// src/utils/finance.js

/**
 * 🔒 Round to 2 decimal places (CRITICAL for money)
 */
const round = (num) => Math.round((num + Number.EPSILON) * 100) / 100;

/**
 * ⚙️ DEFAULT CONFIG (can come from .env later)
 */
const DEFAULTS = {
  COMMISSION_PERCENT: 10,        // %
  PAYFAST_PERCENT: 3.5,         // %
  PAYFAST_FIXED: 2,             // R
};

/**
 * 🛑 Validate amount
 */
const validateAmount = (amount) => {
  if (typeof amount !== "number" || isNaN(amount) || amount <= 0) {
    throw new Error("Invalid amount");
  }
};

/**
 * 💰 Platform commission
 */
export const calculateCommission = (amount, percent = DEFAULTS.COMMISSION_PERCENT) => {
  validateAmount(amount);
  return round((percent / 100) * amount);
};

/**
 * 💳 PayFast fee
 */
export const calculatePayfastFee = (
  amount,
  percent = DEFAULTS.PAYFAST_PERCENT,
  fixed = DEFAULTS.PAYFAST_FIXED
) => {
  validateAmount(amount);

  const percentageFee = (percent / 100) * amount;
  return round(percentageFee + fixed);
};

/**
 * 📦 Vendor payout
 */
export const calculateVendorPayout = (amount, commission, payfastFee) => {
  validateAmount(amount);

  const payout = amount - commission - payfastFee;

  // 🚨 Prevent negative payouts
  return round(Math.max(payout, 0));
};

/**
 * 📈 Platform profit
 */
export const calculatePlatformProfit = (commission, payfastFee) => {
  const profit = commission - payfastFee;

  // 🚨 Prevent negative profit (VERY IMPORTANT)
  return round(Math.max(profit, 0));
};

/**
 * 🧠 FULL ORDER BREAKDOWN (CORE ENGINE)
 */
export const calculateOrderBreakdown = ({
  amount,
  commissionPercent = DEFAULTS.COMMISSION_PERCENT,
  payfastPercent = DEFAULTS.PAYFAST_PERCENT,
  payfastFixed = DEFAULTS.PAYFAST_FIXED,
}) => {
  validateAmount(amount);

  const commission = calculateCommission(amount, commissionPercent);
  const payfastFee = calculatePayfastFee(amount, payfastPercent, payfastFixed);
  const vendorPayout = calculateVendorPayout(amount, commission, payfastFee);
  const platformProfit = calculatePlatformProfit(commission, payfastFee);

  return {
    currency: "ZAR",
    amount: round(amount),
    commissionPercent,
    payfastPercent,
    payfastFixed,

    commission,
    payfastFee,
    vendorPayout,
    platformProfit,

    // 📊 useful flags
    isProfitable: platformProfit > 0,
  };
};

/**
 * 🛒 MULTI-ITEM SUPPORT (for cart/orders)
 */
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