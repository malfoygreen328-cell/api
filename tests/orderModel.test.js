// tests/orderModel.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyRefundLocks } from "../src/models/Order.js";

test("applyRefundLocks clamps negative financials", () => {
  const order = { platformProfit: -5, vendorPayout: -3, refundStatus: "none" };
  applyRefundLocks(order);
  assert.equal(order.platformProfit, 0);
  assert.equal(order.vendorPayout, 0);
});

test("applyRefundLocks leaves a payable order untouched", () => {
  const order = { platformProfit: 13, vendorPayout: 913, refundStatus: "none", payoutLocked: false, payoutStatus: "unpaid" };
  applyRefundLocks(order);
  assert.equal(order.platformProfit, 13);
  assert.equal(order.vendorPayout, 913);
  assert.equal(order.payoutLocked, false);
});

test("applyRefundLocks zeros payouts and locks them on approved/refunded orders", () => {
  for (const refundStatus of ["approved", "refunded"]) {
    const order = {
      platformProfit: 13,
      vendorPayout: 913,
      refundStatus,
      payoutLocked: false,
      payoutStatus: "processing",
    };
    applyRefundLocks(order);
    assert.equal(order.vendorPayout, 0, refundStatus);
    assert.equal(order.platformProfit, 0, refundStatus);
    assert.equal(order.payoutLocked, true, refundStatus);
    assert.equal(order.payoutStatus, "unpaid", refundStatus);
  }
});

test("Order model exposes commissionPercent field for persistence", () => {
  const fingerprint = readFileSync(new URL("../src/models/Order.js", import.meta.url), "utf8");
  assert.match(fingerprint, /commissionPercent/);
});