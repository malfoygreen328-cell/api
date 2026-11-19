// tests/storePrivacy.integration.test.js
//
// Regression coverage for public store allowlists, legacy store creation
// sanitisation, customer order response sanitisation and brand product
// isolation. Runs against the real app and a disposable MongoDB database.

import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import fs from "node:fs";

import Vendor from "../src/models/Vendor.js";
import Store from "../src/models/Store.js";
import User from "../src/models/User.js";
import Admin from "../src/models/Admin.js";
import Product from "../src/models/Product.js";

const TEST_SECRET = "store-privacy-secret";
process.env.JWT_SECRET = TEST_SECRET;
process.env.NODE_ENV = "test";

const DB_NAME = `azania_store_privacy_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const MONGO_URI = `mongodb://127.0.0.1:27017/${DB_NAME}`;

let app;
let server;
let baseUrl;
let dbReady = false;
const ids = {};

const tokenFor = (principal, role) =>
  jwt.sign({ id: String(principal._id), role }, TEST_SECRET, { expiresIn: "1h" });

const api = async (path, { method = "GET", token, body } = {}) => {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, body: json, text };
};

const makeVendor = async (suffix, status = "APPROVED") =>
  Vendor.create({
    fullName: `Vendor ${suffix}`,
    email: `privacy-vendor-${suffix}@example.com`,
    password: "secret123",
    phone: "0712345678",
    businessName: `Privacy Business ${suffix}`,
    registrationNumber: `REG-PRIV-${suffix}`,
    taxNumber: `TAX-PRIV-${suffix}`,
    businessType: "Pty Ltd",
    status,
    documents: {
      registrationCert: "/uploads/reg.pdf",
      directorId: "/uploads/id.pdf",
      proofOfAddress: "/uploads/poa.pdf",
    },
  });

const makeStore = async (vendor, suffix, overrides = {}) =>
  Store.create({
    vendor: vendor._id,
    storeName: `Public Brand ${suffix}`,
    description: "A".repeat(100),
    story: "B".repeat(200),
    logo: "/uploads/logo.jpg",
    banner: "/uploads/banner.jpg",
    province: "Gauteng",
    city: "Johannesburg",
    fashionCategories: ["clothing"],
    socialLinks: { instagram: "https://instagram.com/brand" },
    ...overrides,
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

  ids.vendorPublic = await makeVendor("public");
  ids.vendorHidden = await makeVendor("hidden");
  ids.vendorPending = await makeVendor("pending", "PENDING");
  ids.vendorNew = await makeVendor("new");

  ids.storePublic = await makeStore(ids.vendorPublic, "Public", {
    storeName: "Public Approved Brand",
    storeSlug: "public-approved-brand",
    approvalStatus: "APPROVED",
  });
  ids.storeHidden = await makeStore(ids.vendorHidden, "Hidden", {
    storeName: "Hidden Approval Brand",
    storeSlug: "hidden-approval-brand",
    approvalStatus: "REJECTED",
    discoveryEligible: false,
    approvalReason: "Private moderation reason",
  });
  ids.storePendingVendor = await makeStore(ids.vendorPending, "Pending", {
    storeName: "Pending Vendor Brand",
    storeSlug: "pending-vendor-brand",
    approvalStatus: "APPROVED",
  });

  ids.customer = await User.create({
    name: "Privacy Customer",
    email: "privacy-customer@example.com",
    password: "secret123",
    isVerified: true,
  });
  ids.admin = await Admin.create({
    fullName: "Privacy Admin",
    email: "privacy-admin@example.com",
    password: "secret123",
    role: "admin",
    isActive: true,
  });

  ids.productPublic = await Product.create({
    store: ids.storePublic._id,
    vendor: ids.vendorPublic._id,
    name: "Public Dress",
    description: "A public dress",
    price: 499.99,
    stock: 10,
    category: "clothing",
    images: ["/uploads/public-dress.jpg"],
    isActive: true,
  });
  ids.productHidden = await Product.create({
    store: ids.storeHidden._id,
    vendor: ids.vendorHidden._id,
    name: "Hidden Dress",
    description: "A hidden dress",
    price: 299.99,
    stock: 10,
    category: "clothing",
    images: ["/uploads/hidden-dress.jpg"],
    isActive: true,
  });

  ids.tokenPublicVendor = tokenFor(ids.vendorPublic, "vendor_owner");
  ids.tokenNewVendor = tokenFor(ids.vendorNew, "vendor_owner");
  ids.tokenCustomer = tokenFor(ids.customer, "customer");
  ids.tokenAdmin = tokenFor(ids.admin, "admin");
});

after(async () => {
  if (!dbReady) return;
  if (server) await new Promise((resolve) => server.close(resolve));
  if (mongoose.connection.readyState) {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});

const PUBLIC_FORBIDDEN_FIELDS = [
  "vendor",
  "owner",
  "approvalStatus",
  "approvalReason",
  "approvedAt",
  "approvedBy",
  "discoveryEligible",
  "featuredAt",
  "featuredBy",
  "email",
];

test("public store list/detail use an allowlist and never leak vendor data", async (t) => {
  if (!dbReady) return t.skip("Local MongoDB not available");

  const list = await api("/api/stores");
  assert.equal(list.status, 200);
  assert.equal(list.body.success, true);
  assert.ok(list.body.stores.length >= 1);

  for (const store of list.body.stores) {
    for (const field of PUBLIC_FORBIDDEN_FIELDS) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(store, field),
        false,
        `public store list must not expose ${field}`
      );
    }
    assert.equal(typeof store.storeName, "string");
  }

  const detail = await api("/api/stores/slug/public-approved-brand");
  assert.equal(detail.status, 200);
  for (const field of PUBLIC_FORBIDDEN_FIELDS) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(detail.body.store, field),
      false,
      `public store detail must not expose ${field}`
    );
  }
  assert.equal(JSON.stringify(detail.body).includes("privacy-vendor-public@example.com"), false);

  const owner = await api("/api/stores/slug/public-approved-brand", {
    token: ids.tokenPublicVendor,
  });
  assert.equal(owner.status, 200);
  assert.equal(owner.body.store.vendor.email, "privacy-vendor-public@example.com");

  const admin = await api("/api/stores/slug/public-approved-brand", {
    token: ids.tokenAdmin,
  });
  assert.equal(admin.status, 200);
  assert.equal(admin.body.store.approvalStatus, "APPROVED");

  const hidden = await api("/api/stores/slug/hidden-approval-brand");
  assert.equal(hidden.status, 404);
  const pendingVendor = await api("/api/stores/slug/pending-vendor-brand");
  assert.equal(pendingVendor.status, 404);
});

test("legacy store creation sanitises content and cannot self-approve", async (t) => {
  if (!dbReady) return t.skip("Local MongoDB not available");

  const invalidTheme = await api("/api/stores", {
    method: "POST",
    token: ids.tokenNewVendor,
    body: {
      storeName: "Legacy Brand",
      themeColor: "url(javascript:alert(1))",
    },
  });
  assert.equal(invalidTheme.status, 400);

  const created = await api("/api/stores", {
    method: "POST",
    token: ids.tokenNewVendor,
    body: {
      storeName: "<img src=x onerror=alert(1)>Legacy Brand",
      description: "<script>alert(1)</script> A safe description",
      story: "<b>Story</b> " + "S".repeat(180),
      themeColor: "#123456",
      socialLinks: {
        instagram: "javascript:alert(1)",
        website: "https://example.com/brand",
      },
      province: "Gauteng",
      city: "<b>Johannesburg</b>",
      fashionCategories: ["clothing", "not-a-category"],
      approvalStatus: "APPROVED",
      discoveryEligible: true,
      featured: true,
    },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.store.storeName.includes("<"), false);
  assert.equal(created.body.store.storeName.includes("Legacy Brand"), true);
  assert.equal(created.body.store.description.includes("<script>"), false);
  assert.equal(created.body.store.description.includes("<"), false);
  assert.equal(created.body.store.city.includes("Johannesburg"), true);
  assert.equal(created.body.store.city.includes("<"), false);
  assert.equal(created.body.store.themeColor, "#123456");
  assert.equal(created.body.store.socialLinks.instagram, "");
  assert.equal(created.body.store.socialLinks.website, "https://example.com/brand");
  assert.deepEqual(created.body.store.fashionCategories, ["clothing"]);
  assert.equal(created.body.store.approvalStatus, "PENDING");
  assert.equal(created.body.store.discoveryEligible, false);
  assert.equal(created.body.store.featured, false);

  const hiddenFromPublic = await api(
    `/api/stores/slug/${encodeURIComponent(created.body.store.storeSlug)}`
  );
  assert.equal(hiddenFromPublic.status, 404);
});

test("order creation and customer order reads hide marketplace financial internals", async (t) => {
  if (!dbReady) return t.skip("Local MongoDB not available");

  const created = await api("/api/orders", {
    method: "POST",
    token: ids.tokenCustomer,
    body: {
      products: [{ productId: String(ids.productPublic._id), quantity: 2 }],
      shippingAddress: {
        fullName: "Privacy Customer",
        address: "1 Test Street",
        city: "Johannesburg",
        postal: "2000",
        country: "South Africa",
      },
    },
  });
  assert.equal(created.status, 201);
  const order = created.body.order;
  for (const field of [
    "commissionPercent",
    "commissionAmount",
    "platformProfit",
    "vendorPayout",
    "provisionalVendorPayout",
    "settlementStatus",
    "payoutLocked",
    "providerFeeCents",
    "platformNetCents",
    "feeStatus",
  ]) {
    assert.equal(Object.prototype.hasOwnProperty.call(order, field), false, `order must hide ${field}`);
  }
  assert.ok(order.vendorOrders.length >= 1);
  for (const vendorOrder of order.vendorOrders) {
    for (const field of [
      "commissionPercent",
      "commissionAmount",
      "platformProfit",
      "vendorPayout",
      "provisionalVendorPayout",
      "settlementStatus",
      "payoutLocked",
      "providerFeeCents",
    ]) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(vendorOrder, field),
        false,
        `vendor order must hide ${field}`
      );
    }
  }

  const fetched = await api(`/api/orders/${order._id}`, { token: ids.tokenCustomer });
  assert.equal(fetched.status, 200);
  for (const field of ["commissionPercent", "commissionAmount", "platformProfit", "vendorPayout"]) {
    assert.equal(Object.prototype.hasOwnProperty.call(fetched.body.order, field), false);
  }
});

test("store product listing stays isolated to the requested brand", async (t) => {
  if (!dbReady) return t.skip("Local MongoDB not available");

  const publicProducts = await api(`/api/products/store/${ids.storePublic._id}`);
  assert.equal(publicProducts.status, 200);
  const names = (publicProducts.body.data || []).map((p) => p.name);
  assert.deepEqual(names, ["Public Dress"]);
  assert.equal(names.includes("Hidden Dress"), false);

  const brandHtml = fs.readFileSync(
    new URL("../../azania-store/brand.html", import.meta.url),
    "utf8"
  );
  assert.match(brandHtml, /dashboard\.html\?brand=/);

  const dashboardHtml = fs.readFileSync(
    new URL("../../azania-store/dashboard.html", import.meta.url),
    "utf8"
  );
  assert.match(dashboardHtml, /window\.AZANIA_CONFIG\.apiBaseUrl/);
  assert.match(dashboardHtml, /\/brands\//);
  assert.match(dashboardHtml, /\/products\/store\//);
});
