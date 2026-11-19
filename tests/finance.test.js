// tests/finance.test.js
//
// Contract tests for the settlement maths. The provider fee schedule and the
// fee bearer are only trusted when they come from server config, so every
// breakdown is expected to be non-definitive by default.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calculateCommission,
  calculatePayfastFee,
  calculateVendorPayout,
  calculatePlatformProfit,
  calculateOrderBreakdown,
  getPaymentFeePolicy,
  estimateProviderFeeCents,
  getProviderFeeCentsFromIpn,
} from "../src/utils/finance.js";

const FEE_ENV_KEYS = [
  "PAYFAST_FEE_SCHEDULE_CONFIRMED",
  "PAYFAST_FEE_PERCENT",
  "PAYFAST_FEE_FIXED_CENTS",
  "PAYFAST_FEE_BEARER",
  "PAYFAST_FEE_ALLOCATION",
];

const withFeeEnv = (values, run) => {
  const previous = {};
  for (const key of FEE_ENV_KEYS) previous[key] = process.env[key];
  for (const key of FEE_ENV_KEYS) delete process.env[key];
  Object.assign(process.env, values);
  try {
    return run();
  } finally {
    for (const key of FEE_ENV_KEYS) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
};

test("commission defaults to the configured standard 5%", () => {
  delete process.env.MARKETPLACE_COMMISSION_RATE;
  assert.equal(calculateCommission(1000), 50);
  assert.equal(calculateCommission(250.5), 12.53);
});

test("explicit percent overrides the default", () => {
  assert.equal(calculateCommission(1000, 10), 100);
  assert.equal(calculateCommission(1000, 4.5), 45);
});

test("invalid commission amounts are rejected", () => {
  assert.throws(() => calculateCommission(0));
  assert.throws(() => calculateCommission(-10));
  assert.throws(() => calculateCommission("100"));
  assert.throws(() => calculateCommission(NaN));
});

test("legacy payfast fee helper is explicitly indicative, never settlement", () => {
  assert.equal(calculatePayfastFee(1000), 34);
  assert.equal(calculatePayfastFee(100), 5.2);
  const policy = getPaymentFeePolicy("card");
  assert.equal(policy.scheduleConfirmed, false);
  assert.equal(policy.executable, false);
  assert.equal(estimateProviderFeeCents(100000), null);
});

test("breakdown is blocked when no server fee policy is configured", () => {
  withFeeEnv({}, () => {
    const b = calculateOrderBreakdown({ amount: 1000 });
    assert.equal(b.commissionPercent, 5);
    assert.equal(b.commissionCents, 5000);
    assert.equal(b.commission, 50);
    assert.equal(b.providerFeeCents, null);
    assert.equal(b.providerFee, null);
    assert.equal(b.feeBearer, "unresolved");
    assert.equal(b.settlementStatus, "blocked");
    assert.equal(b.definitive, false);
    assert.equal(b.vendorPayout, null);
    assert.equal(b.provisionalVendorPayoutCents, 95000);
    assert.equal(b.provisionalVendorPayout, 950);
    assert.equal(b.platformProfit, null);
    assert.equal(b.isProfitable, null);
  });
});

test("confirmed fee schedule without a fee bearer stays provisional", () => {
  withFeeEnv({ PAYFAST_FEE_SCHEDULE_CONFIRMED: "true" }, () => {
    const b = calculateOrderBreakdown({ amount: 1000 });
    assert.equal(b.providerFeeCents, 3400);
    assert.equal(b.feeStatus, "estimated");
    assert.equal(b.settlementStatus, "provisional");
    assert.equal(b.definitive, false);
    assert.equal(b.vendorPayout, null);
    assert.equal(b.platformProfit, null);
  });
});

test("marketplace bearer with confirmed schedule yields a definitive payout", () => {
  withFeeEnv(
    { PAYFAST_FEE_SCHEDULE_CONFIRMED: "true", PAYFAST_FEE_BEARER: "marketplace" },
    () => {
      const b = calculateOrderBreakdown({ amount: 1000 });
      assert.equal(b.providerFeeCents, 3400);
      assert.equal(b.settlementStatus, "ready");
      assert.equal(b.definitive, true);
      assert.equal(b.vendorPayout, 950);
      assert.equal(b.platformProfit, 16);
      assert.equal(b.isProfitable, true);
    }
  );
});

test("vendor bearer deducts the actual IPN fee from the vendor payout", () => {
  withFeeEnv({ PAYFAST_FEE_BEARER: "vendor" }, () => {
    const b = calculateOrderBreakdown({ amount: 1000, providerFeeCents: 2900 });
    assert.equal(b.feeStatus, "actual");
    assert.equal(b.providerFeeCents, 2900);
    assert.equal(b.settlementStatus, "ready");
    assert.equal(b.vendorPayout, 921);
    assert.equal(b.platformProfit, 50);
  });
});

test("breakdown honors the persisted order percent", () => {
  withFeeEnv(
    { PAYFAST_FEE_SCHEDULE_CONFIRMED: "true", PAYFAST_FEE_BEARER: "marketplace" },
    () => {
      const b = calculateOrderBreakdown({ amount: 1000, commissionPercent: 4.5 });
      assert.equal(b.commission, 45);
      assert.equal(b.vendorPayout, 955);
      assert.equal(b.platformProfit, 11);
    }
  );
});

test("client-supplied fee bearer and confirmation flags are ignored", () => {
  withFeeEnv({}, () => {
    const b = calculateOrderBreakdown({
      amount: 1000,
      feeBearer: "marketplace",
      feeScheduleConfirmed: true,
    });
    assert.equal(b.feeBearer, "unresolved");
    assert.equal(b.feeScheduleConfirmed, false);
    assert.equal(b.settlementStatus, "blocked");
  });
});

test("a fee larger than the vendor payout blocks settlement instead of going negative", () => {
  withFeeEnv({ PAYFAST_FEE_BEARER: "vendor" }, () => {
    const b = calculateOrderBreakdown({ amount: 100, providerFeeCents: 10000 });
    assert.equal(b.settlementStatus, "blocked");
    assert.equal(b.vendorPayout, null);
    assert.equal(b.platformProfit, null);
  });
  assert.equal(calculateVendorPayout(100, 50, 100), 0);
  assert.equal(calculatePlatformProfit(10, 50), 0);
});

test("IPN fees are parsed in cents and blanks stay unknown", () => {
  assert.equal(getProviderFeeCentsFromIpn({ amount_fee: "29.00" }), 2900);
  assert.equal(getProviderFeeCentsFromIpn({ amount_fee: 0 }), 0);
  assert.equal(getProviderFeeCentsFromIpn({ amount_fee: "" }), null);
  assert.equal(getProviderFeeCentsFromIpn({}), null);
  assert.equal(getProviderFeeCentsFromIpn({ amount_fee: "-2" }), null);
});

test("cents maths avoids floating point drift", () => {
  const b = calculateOrderBreakdown({ amount: 250.5 });
  assert.equal(b.commissionCents, 1253);
  assert.equal(b.commission, 12.53);
  assert.equal(b.provisionalVendorPayoutCents, 23797);
});
