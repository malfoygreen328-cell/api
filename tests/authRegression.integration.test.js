// tests/authRegression.integration.test.js
//
// Regression coverage for the customer login projection bug: login must return
// the caller's persisted role (and profile fields) while still loading the
// password/verification fields explicitly. Uses the real Express app and a
// disposable local MongoDB database.

import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";

import User from "../src/models/User.js";
import Admin from "../src/models/Admin.js";
import Vendor from "../src/models/Vendor.js";

const TEST_SECRET = "auth-regression-secret";
process.env.JWT_SECRET = TEST_SECRET;
process.env.NODE_ENV = "test";
process.env.RECAPTCHA_TEST_BYPASS = "true";

const DB_NAME = `azania_auth_regression_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const MONGO_URI = `mongodb://127.0.0.1:27017/${DB_NAME}`;

let app;
let server;
let baseUrl;
let dbReady = false;
const ids = {};

const api = async (path, { method = "GET", token, body } = {}) => {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, body: json };
};

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

  ids.customer = await User.create({
    name: "Regression Customer",
    email: "regression-customer@example.com",
    password: "customer-secret",
    isVerified: true,
  });
  ids.unverified = await User.create({
    name: "Unverified Customer",
    email: "unverified-customer@example.com",
    password: "customer-secret",
    isVerified: false,
    verificationToken: "pending-verification-token",
    verificationTokenExpires: new Date(Date.now() + 60_000),
  });
  ids.admin = await Admin.create({
    fullName: "Regression Admin",
    email: "regression-admin@example.com",
    password: "admin-secret",
    role: "admin",
    isActive: true,
  });
  ids.vendor = await Vendor.create({
    fullName: "Regression Vendor",
    email: "regression-vendor@example.com",
    password: "vendor-secret",
    phone: "0712345678",
    businessName: "Regression Vendor Business",
    registrationNumber: "REG-REGRESSION",
    taxNumber: "TAX-REGRESSION",
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

test("customer login preserves persisted role and profile fields", async (t) => {
  if (!dbReady) return t.skip("Local MongoDB not available");

  const login = await api("/api/auth/login", {
    method: "POST",
    body: { email: ids.customer.email, password: "customer-secret" },
  });
  assert.equal(login.status, 200);
  assert.equal(login.body.success, true);
  assert.equal(login.body.role, "customer");
  assert.equal(login.body.name, "Regression Customer");
  assert.equal(login.body.email, ids.customer.email);
  assert.ok(login.body.token);

  const decoded = jwt.verify(login.body.token, TEST_SECRET);
  assert.equal(decoded.role, "customer");
  ids.customerToken = login.body.token;

  const orders = await api("/api/orders", { token: ids.customerToken });
  assert.equal(orders.status, 200, "customer token must pass requireRole('customer')");
  assert.equal(orders.body.success, true);
});

test("real login token reaches other customer-protected routes", async (t) => {
  if (!dbReady) return t.skip("Local MongoDB not available");

  const token = ids.customerToken;
  assert.ok(token, "prior login test must have issued a real token");

  const createOrder = await api("/api/orders", {
    method: "POST",
    token,
    body: {},
  });
  assert.equal(
    createOrder.status,
    400,
    "authenticated order creation must reach validation, not 401/403"
  );

  const payfast = await api("/api/payfast/create-payment", {
    method: "POST",
    token,
    body: {},
  });
  assert.equal(
    payfast.status,
    400,
    "authenticated PayFast initiation must reach validation, not 401/403"
  );
});

test("login ignores client-supplied role escalation fields", async (t) => {
  if (!dbReady) return t.skip("Local MongoDB not available");

  const login = await api("/api/auth/login", {
    method: "POST",
    body: {
      email: ids.customer.email,
      password: "customer-secret",
      role: "admin",
    },
  });
  assert.equal(login.status, 200);
  assert.equal(login.body.role, "customer");

  const adminAttempt = await api("/api/admin/discovery/brands?limit=1", {
    token: login.body.token,
  });
  assert.equal(adminAttempt.status, 403);
});

test("wrong password and unverified accounts are rejected", async (t) => {
  if (!dbReady) return t.skip("Local MongoDB not available");

  const wrong = await api("/api/auth/login", {
    method: "POST",
    body: { email: ids.customer.email, password: "wrong-password" },
  });
  assert.equal(wrong.status, 401);

  const unverified = await api("/api/auth/login", {
    method: "POST",
    body: { email: ids.unverified.email, password: "customer-secret" },
  });
  assert.equal(unverified.status, 403);
  assert.equal(unverified.body.requiresVerification, true);
});

test("admin and vendor login keep their real roles and route access", async (t) => {
  if (!dbReady) return t.skip("Local MongoDB not available");

  const adminLogin = await api("/api/auth/login", {
    method: "POST",
    body: { email: ids.admin.email, password: "admin-secret" },
  });
  assert.equal(adminLogin.status, 200);
  assert.equal(adminLogin.body.role, "admin");
  const adminBrands = await api("/api/admin/discovery/brands?limit=1", {
    token: adminLogin.body.token,
  });
  assert.equal(adminBrands.status, 200);

  const vendorLogin = await api("/api/vendor/login", {
    method: "POST",
    body: { email: ids.vendor.email, password: "vendor-secret" },
  });
  assert.equal(vendorLogin.status, 200);
  assert.equal(vendorLogin.body.role, "vendor_owner");
  const vendorOrders = await api("/api/orders/vendor", {
    token: vendorLogin.body.token,
  });
  assert.equal(vendorOrders.status, 200, "vendor token must reach vendor order routes");
});

test("login projection remains additive (role is not dropped)", async (t) => {
  if (!dbReady) return t.skip("Local MongoDB not available");

  const user = await User.findOne({ email: ids.customer.email })
    .select("+password +verificationToken")
    .lean();
  assert.equal(user.role, "customer");
  assert.equal(user.name, "Regression Customer");
  assert.ok(user.password);
});
