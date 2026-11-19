// tests/platformConfig.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getMarketplaceCommissionRate,
  getMarketplaceCommissionPercent,
  getFoundingConfig,
  isFoundingVendorPeriod,
  getFoundingVendorRegistrationFields,
  getCommissionRateForVendor,
  resolveSettlementCommissionPercent,
} from "../src/config/platformConfig.js";

const resetEnv = () => {
  delete process.env.MARKETPLACE_COMMISSION_RATE;
  delete process.env.FOUNDING_VENDOR_ENABLED;
  delete process.env.FOUNDING_VENDOR_START_DATE;
  delete process.env.FOUNDING_VENDOR_END_DATE;
  delete process.env.FOUNDING_VENDOR_COMMISSION_RATE;
  delete process.env.FOUNDING_VENDOR_RATE_LOCKED;
};

test("default commission rate is 5% (0.05) when env is unset", () => {
  resetEnv();
  assert.equal(getMarketplaceCommissionRate(), 0.05);
  assert.equal(getMarketplaceCommissionPercent(), 5);
});

test("accepts rate form (0.05) and percent form (5 or 7.5)", () => {
  process.env.MARKETPLACE_COMMISSION_RATE = "0.05";
  assert.equal(getMarketplaceCommissionRate(), 0.05);
  assert.equal(getMarketplaceCommissionPercent(), 5);

  process.env.MARKETPLACE_COMMISSION_RATE = "7.5";
  assert.equal(getMarketplaceCommissionRate(), 0.075);
  assert.equal(getMarketplaceCommissionPercent(), 7.5);
  resetEnv();
});

test("invalid/out-of-range MARKETPLACE_COMMISSION_RATE falls back to 5%", () => {
  for (const bad of ["abc", "-3", "0", "101", "", "  "]) {
    process.env.MARKETPLACE_COMMISSION_RATE = bad;
    assert.equal(getMarketplaceCommissionRate(), 0.05, `rate=${bad}`);
  }
  resetEnv();
});

test("legacy PLATFORM_COMMISSION_PERCENT is never honored", () => {
  process.env.PLATFORM_COMMISSION_PERCENT = "10";
  process.env.MARKETPLACE_COMMISSION_RATE = "0.05";
  assert.equal(getMarketplaceCommissionRate(), 0.05);
  assert.equal(getMarketplaceCommissionPercent(), 5);
  resetEnv();
  delete process.env.PLATFORM_COMMISSION_PERCENT;
});

test("founding window respects start/end dates and enabled flag", () => {
  resetEnv();
  process.env.FOUNDING_VENDOR_START_DATE = "2026-01-01T00:00:00Z";
  process.env.FOUNDING_VENDOR_END_DATE = "2026-12-31T23:59:59Z";

  assert.equal(isFoundingVendorPeriod(new Date("2026-06-01T00:00:00Z")), true);
  assert.equal(isFoundingVendorPeriod(new Date("2025-12-31T23:59:59Z")), false);
  assert.equal(isFoundingVendorPeriod(new Date("2027-01-01T00:00:00Z")), false);

  process.env.FOUNDING_VENDOR_ENABLED = "false";
  assert.equal(isFoundingVendorPeriod(new Date("2026-06-01T00:00:00Z")), false);
  resetEnv();
});

test("founding registration fields lock the 5% rate during the window", () => {
  resetEnv();
  process.env.FOUNDING_VENDOR_START_DATE = "2026-01-01T00:00:00Z";
  process.env.FOUNDING_VENDOR_END_DATE = "2026-12-31T23:59:59Z";
  process.env.FOUNDING_VENDOR_COMMISSION_RATE = "0.05";
  process.env.FOUNDING_VENDOR_RATE_LOCKED = "true";

  const fields = getFoundingVendorRegistrationFields();
  assert.equal(fields.foundingVendor, true);
  assert.equal(fields.commissionRateLocked, true);
  assert.equal(fields.lockedCommissionRate, 0.05);
  assert.ok(fields.foundingVendorSince instanceof Date);

  resetEnv();
});

test("no founding fields are stamped outside the window", () => {
  resetEnv();
  process.env.FOUNDING_VENDOR_START_DATE = "2020-01-01T00:00:00Z";
  process.env.FOUNDING_VENDOR_END_DATE = "2020-12-31T23:59:59Z";
  assert.deepEqual(getFoundingVendorRegistrationFields(), {});
  resetEnv();
});

test("getCommissionRateForVendor prefers a locked rate, then founding, then standard", () => {
  resetEnv();

  // Locked rate wins regardless of window.
  assert.equal(
    getCommissionRateForVendor({ commissionRateLocked: true, lockedCommissionRate: 0.05 }),
    0.05
  );

  // Founding vendor inside the open window gets the founding rate.
  assert.equal(getCommissionRateForVendor({ foundingVendor: true }), 0.05);

  // Regular vendor gets the standard rate.
  assert.equal(getCommissionRateForVendor({}), 0.05);

  process.env.MARKETPLACE_COMMISSION_RATE = "0.08";
  assert.equal(getCommissionRateForVendor({}), 0.08);
  resetEnv();
});

test("resolveSettlementCommissionPercent uses persisted percent, else current config", () => {
  resetEnv();
  assert.equal(resolveSettlementCommissionPercent({ commissionPercent: 5 }), 5);
  assert.equal(resolveSettlementCommissionPercent({ commissionPercent: 4.5 }), 4.5);
  assert.equal(resolveSettlementCommissionPercent({ commissionPercent: null }), 5);
  assert.equal(resolveSettlementCommissionPercent({}), 5);

  process.env.MARKETPLACE_COMMISSION_RATE = "0.06";
  assert.equal(resolveSettlementCommissionPercent({ commissionPercent: null }), 6);
  resetEnv();

  // A client-supplied percent on a legacy order is ignored (never present in body).
  assert.equal(resolveSettlementCommissionPercent({ commissionPercent: 0.0001 }), 0.0001);
});

test("resolveSettlementCommissionPercent rejects out-of-range persisted values", () => {
  resetEnv();
  assert.equal(resolveSettlementCommissionPercent({ commissionPercent: -5 }), 5);
  assert.equal(resolveSettlementCommissionPercent({ commissionPercent: 150 }), 5);
  assert.equal(resolveSettlementCommissionPercent({ commissionPercent: "abc" }), 5);
});