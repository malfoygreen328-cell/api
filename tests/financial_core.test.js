// tests/financial_core.test.js
//
// Source-level regression tests (no live DB required).

import assert from "node:assert/strict";
import test from "node:test";
import {
  toCents,
  fromCents,
  calculateCommissionCents,
  calculateOrderBreakdown,
} from "../src/utils/finance.js";
import { resolveSettlementCommissionPercent } from "../src/config/platformConfig.js";
import { getJwtExpiry, getJwtTtlMs } from "../src/utils/jwt.js";
import { sanitizeAuditValue } from "../src/models/AuditLog.js";

const FEE_ENV_KEYS = [
  "PAYFAST_FEE_SCHEDULE_CONFIRMED",
  "PAYFAST_FEE_PERCENT",
  "PAYFAST_FEE_FIXED_CENTS",
  "PAYFAST_FEE_BEARER",
  "PAYFAST_FEE_ALLOCATION",
];

const clearFeeEnv = () => {
  const previous = {};
  for (const key of FEE_ENV_KEYS) {
    previous[key] = process.env[key];
    delete process.env[key];
  }
  return () => {
    for (const key of FEE_ENV_KEYS) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  };
};

test("finance uses integer cents", () => {
  assert.equal(toCents("100.50"), 10050);
  assert.equal(toCents(50), 5000);
  assert.equal(fromCents(10050), 100.5);
  assert.equal(calculateCommissionCents(10050, 5), 503);
});

test("commission is computed in cents and never guessed from the client", () => {
  const restore = clearFeeEnv();
  try {
    const b = calculateOrderBreakdown({
      customerTransactionAmount: 100,
      eligibleVendorSubtotal: 100,
      commissionPercent: 5,
      paymentMethod: "card",
    });
    assert.equal(b.customerTransactionAmount, 100);
    assert.equal(b.commissionCents, 500);
    assert.equal(b.commission, 5);
    assert.equal(b.provisionalVendorPayoutCents, 9500);
    assert.equal(b.vendorPayout, null);
    assert.equal(b.settlementStatus, "blocked");
  } finally {
    restore();
  }
});

test("settlement uses the persisted order commission percent", () => {
  assert.equal(resolveSettlementCommissionPercent({ commissionPercent: 4.5 }), 4.5);
  assert.equal(resolveSettlementCommissionPercent({ commissionPercent: 23 }), 23);
  assert.equal(resolveSettlementCommissionPercent({ commissionPercent: null }), 5);
  assert.equal(resolveSettlementCommissionPercent({ commissionPercent: 300 }), 5);
});

test("JWT expiry comes from env", () => {
  const prev = process.env.JWT_EXPIRES_IN;
  process.env.JWT_EXPIRES_IN = "2d";
  assert.equal(getJwtExpiry(), "2d");
  assert.equal(getJwtTtlMs(), 2 * 24 * 60 * 60 * 1000);
  process.env.JWT_EXPIRES_IN = prev;
});

test("audit log sanitizes secrets", () => {
  const clean = sanitizeAuditValue({ password: "x", token: "y", email: "a@b.com" });
  assert.equal(clean.password, "[REDACTED]");
  assert.equal(clean.token, "[REDACTED]");
  assert.equal(clean.email, "a@b.com");
});
