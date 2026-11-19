// tests/reconciliation.test.js
//
// Pure reconciliation checks (no live DB required).

import assert from "node:assert/strict";
import test from "node:test";
import { reconcileOrderSnapshot } from "../src/services/reconciliationService.js";

const saleLedger = (vendorOrderId, vendor, amountCents) => [
  { vendorOrderId, vendor, type: "SALE_CREDIT", amountCents },
];

const paidTransaction = (amountGrossCents) => ({
  paymentStatus: "complete",
  amountGrossCents,
});

test("marketplace fee bearer is not flagged for order fee vs zero vendor fees", () => {
  const order = {
    _id: "order-marketplace",
    totalAmount: 100,
    paymentStatus: "complete",
    feeBearer: "marketplace",
    commissionAmount: 5,
    payfastFee: 2.5,
    vendorPayout: 95,
    vendorOrders: [
      {
        _id: "vo1",
        vendor: "v1",
        subTotal: 100,
        commissionAmount: 5,
        payfastFee: 0,
        vendorPayout: 95,
        payoutLocked: false,
      },
    ],
  };

  const result = reconcileOrderSnapshot(order, {
    transaction: paidTransaction(10000),
    ledger: saleLedger("vo1", "v1", 10000),
  });

  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test("vendor fee bearer still reconciles the allocated fee sum", () => {
  const order = {
    _id: "order-vendor",
    totalAmount: 100,
    paymentStatus: "complete",
    feeBearer: "vendor",
    commissionAmount: 5,
    payfastFee: 2.5,
    vendorPayout: 95,
    vendorOrders: [
      {
        _id: "vo2",
        vendor: "v2",
        subTotal: 100,
        commissionAmount: 5,
        payfastFee: 0,
        vendorPayout: 95,
        payoutLocked: false,
      },
    ],
  };

  const result = reconcileOrderSnapshot(order, {
    transaction: paidTransaction(10000),
    ledger: saleLedger("vo2", "v2", 10000),
  });

  assert.ok(
    result.errors.some((e) => e.includes("order.payfastFee")),
    JSON.stringify(result.errors)
  );
});

test("locked provisional payouts are not flagged as unbalanced", () => {
  const order = {
    _id: "order-provisional",
    totalAmount: 100,
    paymentStatus: "complete",
    feeBearer: "unresolved",
    commissionAmount: 5,
    payfastFee: 0,
    vendorPayout: 0,
    vendorOrders: [
      {
        _id: "vo3",
        vendor: "v3",
        subTotal: 100,
        commissionAmount: 5,
        payfastFee: 0,
        vendorPayout: 0,
        payoutLocked: true,
      },
    ],
  };

  const result = reconcileOrderSnapshot(order, {
    transaction: paidTransaction(10000),
    ledger: saleLedger("vo3", "v3", 10000),
  });

  assert.equal(result.ok, true, JSON.stringify(result.errors));
});
