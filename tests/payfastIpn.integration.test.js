// tests/payfastIpn.integration.test.js
//
// Regression coverage for PayFast IPN validation. Online validation is
// fail-closed and can only be overridden by an explicit test-only injection
// through app.locals; NODE_ENV=test alone must never bypass it.

import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import mongoose from "mongoose";
import fs from "node:fs";

import Vendor from "../src/models/Vendor.js";
import User from "../src/models/User.js";
import Order from "../src/models/Order.js";
import PaymentTransaction from "../src/models/PaymentTransaction.js";
import {
  verifyIpnSignature,
  validateIpnOnline,
  getPayfastHost,
} from "../src/services/payments/payfastService.js";
import { resolveIpnValidator } from "../src/controllers/payfastController.js";

const DB_NAME = `azania_payfast_ipn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const MONGO_URI = `mongodb://127.0.0.1:27017/${DB_NAME}`;

process.env.NODE_ENV = "test";
process.env.PAYFAST_MERCHANT_ID = "10000100";
process.env.PAYFAST_MERCHANT_KEY = "test-merchant-key";
process.env.PAYFAST_PASS_PHRASE = "test-passphrase";

let app;
let server;
let baseUrl;
let dbReady = false;
let customer;
let vendor;

const buildIpn = (order, overrides = {}) => {
  const fields = {
    merchant_id: process.env.PAYFAST_MERCHANT_ID,
    m_payment_id: String(order._id),
    pf_payment_id: `pf-test-${order._id}`,
    payment_status: "COMPLETE",
    amount_gross: Number(order.totalAmount).toFixed(2),
    item_name: "Azania Test Order",
    ...overrides,
  };
  const raw = new URLSearchParams(fields).toString();
  const signature = verifyIpnSignature(raw, process.env.PAYFAST_PASS_PHRASE);
  return { fields, raw: `${raw}&signature=${signature}` };
};

const postIpn = async (raw) => {
  const res = await fetch(`${baseUrl}/api/payfast/notify`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: raw,
  });
  return { status: res.status, text: await res.text() };
};

const makeOrder = async (suffix) =>
  Order.create({
    customer: customer._id,
    customerName: "IPN Customer",
    customerEmail: "ipn-customer@example.com",
    items: [
      {
        product: new mongoose.Types.ObjectId(),
        vendor: vendor._id,
        name: `IPN Item ${suffix}`,
        quantity: 1,
        price: 100,
      },
    ],
    totalAmount: 100,
    shippingAddress: "1 IPN Street, Johannesburg, 2000, South Africa",
    paymentStatus: "pending",
    status: "pending",
  });

before(async () => {
  try {
    await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 1500 });
  } catch {
    dbReady = false;
    return;
  }
  dbReady = true;
  ({ default: app } = await import("../src/app.js"));

  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  customer = await User.create({
    name: "IPN Customer",
    email: "ipn-customer@example.com",
    password: "secret123",
    isVerified: true,
  });
  vendor = await Vendor.create({
    fullName: "IPN Vendor",
    email: "ipn-vendor@example.com",
    password: "secret123",
    phone: "0712345678",
    businessName: "IPN Business",
    registrationNumber: "REG-IPN",
    taxNumber: "TAX-IPN",
    businessType: "Pty Ltd",
    status: "APPROVED",
    documents: {
      registrationCert: "/uploads/reg.pdf",
      directorId: "/uploads/id.pdf",
      proofOfAddress: "/uploads/poa.pdf",
    },
  });
});

after(async () => {
  if (!dbReady) return;
  if (server) await new Promise((resolve) => server.close(resolve));
  if (mongoose.connection.readyState) {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});

test("unsigned IPN and invalid signatures are rejected without mutation", async (t) => {
  if (!dbReady) return t.skip("Local MongoDB not available");

  const order = await makeOrder("unsigned");
  const unsigned = await postIpn(
    `merchant_id=${process.env.PAYFAST_MERCHANT_ID}&m_payment_id=${order._id}&pf_payment_id=pf-unsigned`
  );
  assert.equal(unsigned.status, 400);

  const valid = buildIpn(order, { pf_payment_id: "pf-bad-signature" });
  const badSignature = await postIpn(valid.raw.replace(/signature=[0-9a-f]+/, "signature=0000"));
  assert.equal(badSignature.status, 400);

  const unchanged = await Order.findById(order._id).lean();
  assert.equal(unchanged.paymentStatus, "pending");
});

test("online validation failure and timeout fail closed", async (t) => {
  if (!dbReady) return t.skip("Local MongoDB not available");

  const order = await makeOrder("validator");
  const { raw } = buildIpn(order);

  app.locals.payfastIpnValidator = async () => false;
  const rejected = await postIpn(raw);
  assert.equal(rejected.status, 400);
  assert.match(rejected.text, /Validation failed/);
  assert.equal((await Order.findById(order._id).lean()).paymentStatus, "pending");

  app.locals.payfastIpnValidator = async () => {
    throw new Error("validation timeout");
  };
  const unavailable = await postIpn(raw);
  assert.equal(unavailable.status, 503);
  assert.match(unavailable.text, /Validation unavailable/);
  assert.equal((await Order.findById(order._id).lean()).paymentStatus, "pending");

  delete app.locals.payfastIpnValidator;
});

test("amount mismatches are rejected even after validation succeeds", async (t) => {
  if (!dbReady) return t.skip("Local MongoDB not available");

  const order = await makeOrder("amount");
  const { raw } = buildIpn(order, { amount_gross: "105.00" });

  app.locals.payfastIpnValidator = async () => true;
  const mismatch = await postIpn(raw);
  assert.equal(mismatch.status, 400);
  assert.match(mismatch.text, /AMOUNT_MISMATCH/);

  const unchanged = await Order.findById(order._id).lean();
  assert.equal(unchanged.paymentStatus, "pending");
  delete app.locals.payfastIpnValidator;
});

test("missing merchant identity and unknown payment references are rejected", async (t) => {
  if (!dbReady) return t.skip("Local MongoDB not available");

  const order = await makeOrder("identifiers");

  const wrongMerchant = await postIpn(
    buildIpn(order, { merchant_id: "99999999" }).raw
  );
  assert.equal(wrongMerchant.status, 400);
  assert.match(wrongMerchant.text, /Invalid IPN/);

  const missingPaymentId = await postIpn(
    buildIpn(order, { pf_payment_id: "" }).raw
  );
  assert.equal(missingPaymentId.status, 400);
  assert.match(missingPaymentId.text, /Invalid IPN/);

  const unknownReference = new mongoose.Types.ObjectId().toString();
  app.locals.payfastIpnValidator = async () => true;
  const unknown = await postIpn(
    buildIpn(order, { m_payment_id: unknownReference }).raw
  );
  assert.equal(unknown.status, 404);
  assert.match(unknown.text, /Order not found/);

  const unchanged = await Order.findById(order._id).lean();
  assert.equal(unchanged.paymentStatus, "pending");
  delete app.locals.payfastIpnValidator;
});

test("IPN validator injection is ignored outside the test environment", async () => {
  const fake = async () => true;
  const req = { app: { locals: { payfastIpnValidator: fake } } };
  const previous = process.env.NODE_ENV;

  try {
    assert.equal(resolveIpnValidator(req), fake);

    process.env.NODE_ENV = "staging";
    assert.equal(resolveIpnValidator(req), validateIpnOnline);
    assert.notEqual(resolveIpnValidator(req), fake);

    process.env.NODE_ENV = "production";
    assert.equal(resolveIpnValidator(req), validateIpnOnline);
    assert.notEqual(resolveIpnValidator(req), fake);
  } finally {
    process.env.NODE_ENV = previous;
  }
});

test("PayFast host is selected from explicit sandbox mode only", async () => {
  const previous = process.env.PAYFAST_MODE;
  try {
    process.env.PAYFAST_MODE = "sandbox";
    assert.equal(getPayfastHost(), "https://sandbox.payfast.co.za");

    process.env.PAYFAST_MODE = "live";
    assert.equal(getPayfastHost(), "https://www.payfast.co.za");

    delete process.env.PAYFAST_MODE;
    assert.equal(getPayfastHost(), "https://www.payfast.co.za");
  } finally {
    if (previous === undefined) delete process.env.PAYFAST_MODE;
    else process.env.PAYFAST_MODE = previous;
  }
});

test("valid IPN settles once and duplicate notifications are idempotent", async (t) => {
  if (!dbReady) return t.skip("Local MongoDB not available");

  const order = await makeOrder("success");
  const { raw } = buildIpn(order);

  app.locals.payfastIpnValidator = async () => true;
  const first = await postIpn(raw);
  assert.equal(first.status, 200);
  assert.equal(first.text, "OK");

  const paid = await Order.findById(order._id).lean();
  assert.equal(paid.paymentStatus, "complete");

  const duplicate = await postIpn(raw);
  assert.equal(duplicate.status, 200);
  assert.match(duplicate.text, /already processed/i);

  const transactions = await PaymentTransaction.countDocuments({ order: order._id });
  assert.equal(transactions, 1);
  delete app.locals.payfastIpnValidator;
});

test("IPN service contains no environment-based online-validation bypass", async (t) => {
  if (!dbReady) return t.skip("Local MongoDB not available");

  const source = fs.readFileSync(
    new URL("../src/services/payments/payfastService.js", import.meta.url),
    "utf8"
  );
  const validateBlock = source.slice(
    source.indexOf("export const validateIpnOnline"),
    source.indexOf("export const createPayfastPayment")
  );
  assert.equal(validateBlock.includes('NODE_ENV === "test"'), false);
  assert.equal(/return true\s*;/.test(validateBlock), false);
});
