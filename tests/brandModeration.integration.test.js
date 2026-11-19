// tests/brandModeration.integration.test.js
//
// Regression coverage for brand re-approval eligibility, campaign brand
// eligibility and follow state on discovery list responses.

import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";

import Vendor from "../src/models/Vendor.js";
import Store from "../src/models/Store.js";
import User from "../src/models/User.js";
import Admin from "../src/models/Admin.js";
import BrandFollow from "../src/models/BrandFollow.js";

const TEST_SECRET = "brand-moderation-secret";
process.env.JWT_SECRET = TEST_SECRET;
process.env.NODE_ENV = "test";

const DB_NAME = `azania_brand_moderation_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, body: json };
};

const makeVendor = async (suffix, status = "APPROVED") =>
  Vendor.create({
    fullName: `Moderation Vendor ${suffix}`,
    email: `moderation-vendor-${suffix}@example.com`,
    password: "secret123",
    phone: "0712345678",
    businessName: `Moderation Business ${suffix}`,
    registrationNumber: `REG-MOD-${suffix}`,
    taxNumber: `TAX-MOD-${suffix}`,
    businessType: "Pty Ltd",
    status,
    documents: {
      registrationCert: "/uploads/reg.pdf",
      directorId: "/uploads/id.pdf",
      proofOfAddress: "/uploads/poa.pdf",
    },
  });

const completeProfile = {
  description: "D".repeat(120),
  story: "S".repeat(220),
  logo: "/uploads/logo.jpg",
  banner: "/uploads/banner.jpg",
  province: "Gauteng",
  city: "Johannesburg",
  fashionCategories: ["clothing"],
};

const makeStore = async (vendor, suffix, overrides = {}) =>
  Store.create({
    vendor: vendor._id,
    storeName: `Moderation Brand ${suffix}`,
    ...completeProfile,
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

  ids.vendorRejected = await makeVendor("rejected");
  ids.vendorIncomplete = await makeVendor("incomplete");
  ids.vendorSuspended = await makeVendor("suspended", "SUSPENDED");
  ids.vendorDeclined = await makeVendor("declined", "DECLINED");
  ids.vendorPending = await makeVendor("pending", "PENDING");
  ids.vendorCampaign = await makeVendor("campaign");
  ids.vendorRejectedCampaign = await makeVendor("rejected-campaign");
  ids.vendorDraft = await makeVendor("draft");

  ids.storeRejected = await makeStore(ids.vendorRejected, "Rejected", {
    storeName: "Rejected Then Approved",
    storeSlug: "rejected-then-approved",
    approvalStatus: "REJECTED",
    approvalReason: "Previous rejection",
    discoveryEligible: false,
  });
  ids.storeIncomplete = await makeStore(ids.vendorIncomplete, "Incomplete", {
    storeName: "Incomplete Profile",
    storeSlug: "incomplete-profile",
    description: "Too short",
    story: "Too short",
    approvalStatus: "PENDING",
  });
  ids.storeSuspended = await makeStore(ids.vendorSuspended, "Suspended", {
    storeName: "Suspended Vendor Brand",
    storeSlug: "suspended-vendor-brand",
    approvalStatus: "PENDING",
  });
  ids.storeDeclined = await makeStore(ids.vendorDeclined, "Declined", {
    storeName: "Declined Vendor Brand",
    storeSlug: "declined-vendor-brand",
    approvalStatus: "PENDING",
  });
  ids.storeRejectedCampaign = await makeStore(ids.vendorRejectedCampaign, "RejectedCampaign", {
    storeName: "Rejected Campaign Brand",
    storeSlug: "rejected-campaign-brand",
    approvalStatus: "REJECTED",
  });
  ids.storePendingVendor = await makeStore(ids.vendorPending, "PendingVendor", {
    storeName: "Pending Vendor Approval",
    storeSlug: "pending-vendor-approval",
    approvalStatus: "PENDING",
  });
  ids.storeCampaign = await makeStore(ids.vendorCampaign, "Campaign", {
    storeName: "Campaign Ready Brand",
    storeSlug: "campaign-ready-brand",
    approvalStatus: "APPROVED",
  });
  ids.storeDraft = await makeStore(ids.vendorDraft, "Draft", {
    storeName: "Draft Campaign Brand",
    storeSlug: "draft-campaign-brand",
    approvalStatus: "APPROVED",
  });

  ids.customer = await User.create({
    name: "Moderation Customer",
    email: "moderation-customer@example.com",
    password: "secret123",
    isVerified: true,
  });
  ids.admin = await Admin.create({
    fullName: "Moderation Admin",
    email: "moderation-admin@example.com",
    password: "secret123",
    role: "admin",
    isActive: true,
  });

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

test("re-approving a rejected brand restores eligibility and public visibility", async (t) => {
  if (!dbReady) return t.skip("Local MongoDB not available");

  const before = await api("/api/brands/rejected-then-approved");
  assert.equal(before.status, 404);

  const approve = await api(
    `/api/admin/discovery/brands/${ids.storeRejected._id}/approve`,
    { method: "PATCH", token: ids.tokenAdmin }
  );
  assert.equal(approve.status, 200);
  assert.equal(approve.body.brand.approvalStatus, "APPROVED");
  assert.equal(approve.body.brand.discoveryEligible, true);

  const afterApprove = await api("/api/brands/rejected-then-approved");
  assert.equal(afterApprove.status, 200);
  assert.equal(afterApprove.body.brand.slug, "rejected-then-approved");
});

test("approval keeps an incomplete profile ineligible", async (t) => {
  if (!dbReady) return t.skip("Local MongoDB not available");

  const approve = await api(
    `/api/admin/discovery/brands/${ids.storeIncomplete._id}/approve`,
    { method: "PATCH", token: ids.tokenAdmin }
  );
  assert.equal(approve.status, 200);
  assert.equal(approve.body.brand.approvalStatus, "APPROVED");
  assert.equal(approve.body.brand.discoveryEligible, false);

  const publicRead = await api("/api/brands/incomplete-profile");
  assert.equal(publicRead.status, 404);
});

test("approval does not make a suspended vendor's brand eligible", async (t) => {
  if (!dbReady) return t.skip("Local MongoDB not available");

  const approve = await api(
    `/api/admin/discovery/brands/${ids.storeSuspended._id}/approve`,
    { method: "PATCH", token: ids.tokenAdmin }
  );
  assert.equal(approve.status, 200);
  assert.equal(approve.body.brand.approvalStatus, "APPROVED");
  assert.equal(approve.body.brand.discoveryEligible, false);

  const publicRead = await api("/api/brands/suspended-vendor-brand");
  assert.equal(publicRead.status, 404);
});

test("approval does not make a declined vendor's brand eligible", async (t) => {
  if (!dbReady) return t.skip("Local MongoDB not available");

  const approve = await api(
    `/api/admin/discovery/brands/${ids.storeDeclined._id}/approve`,
    { method: "PATCH", token: ids.tokenAdmin }
  );
  assert.equal(approve.status, 200);
  assert.equal(approve.body.brand.approvalStatus, "APPROVED");
  assert.equal(approve.body.brand.discoveryEligible, false);

  const publicRead = await api("/api/brands/declined-vendor-brand");
  assert.equal(publicRead.status, 404);
});

test("brand approved before its vendor becomes discoverable after vendor approval", async (t) => {
  if (!dbReady) return t.skip("Local MongoDB not available");

  const approve = await api(
    `/api/admin/discovery/brands/${ids.storePendingVendor._id}/approve`,
    { method: "PATCH", token: ids.tokenAdmin }
  );
  assert.equal(approve.status, 200);
  assert.equal(approve.body.brand.discoveryEligible, false);

  const hidden = await api("/api/brands/pending-vendor-approval");
  assert.equal(hidden.status, 404);

  const approveVendor = await api(`/api/admin/vendors/${ids.vendorPending._id}/approve`, {
    method: "PATCH",
    token: ids.tokenAdmin,
  });
  assert.equal(approveVendor.status, 200);

  const store = await Store.findById(ids.storePendingVendor._id).lean();
  assert.equal(store.discoveryEligible, true);

  const visible = await api("/api/brands/pending-vendor-approval");
  assert.equal(visible.status, 200);
});

test("campaign creation rejects ineligible brands and activation re-checks brands", async (t) => {
  if (!dbReady) return t.skip("Local MongoDB not available");

  const incomplete = await api("/api/admin/discovery/campaigns", {
    method: "POST",
    token: ids.tokenAdmin,
    body: {
      name: "Incomplete Campaign",
      status: "ACTIVE",
      brands: [String(ids.storeIncomplete._id)],
    },
  });
  assert.equal(incomplete.status, 400);

  const suspended = await api("/api/admin/discovery/campaigns", {
    method: "POST",
    token: ids.tokenAdmin,
    body: {
      name: "Suspended Campaign",
      status: "ACTIVE",
      brands: [String(ids.storeSuspended._id)],
    },
  });
  assert.equal(suspended.status, 400);

  const rejectedBrand = await api("/api/admin/discovery/campaigns", {
    method: "POST",
    token: ids.tokenAdmin,
    body: {
      name: "Rejected Brand Campaign",
      status: "ACTIVE",
      brands: [String(ids.storeRejectedCampaign._id)],
    },
  });
  assert.equal(rejectedBrand.status, 400);

  const draft = await api("/api/admin/discovery/campaigns", {
    method: "POST",
    token: ids.tokenAdmin,
    body: {
      name: "Draft Campaign",
      status: "DRAFT",
      brands: [String(ids.storeDraft._id)],
    },
  });
  assert.equal(draft.status, 201);

  const reject = await api(
    `/api/admin/discovery/brands/${ids.storeDraft._id}/reject`,
    {
      method: "PATCH",
      token: ids.tokenAdmin,
      body: { reason: "No longer eligible" },
    }
  );
  assert.equal(reject.status, 200);

  const activate = await api(
    `/api/admin/discovery/campaigns/${draft.body.campaign._id}`,
    {
      method: "PATCH",
      token: ids.tokenAdmin,
      body: { status: "ACTIVE" },
    }
  );
  assert.equal(activate.status, 400);
});

test("discovery list marks followed brands for the authenticated customer", async (t) => {
  if (!dbReady) return t.skip("Local MongoDB not available");

  const followed = await api("/api/brands/rejected-then-approved/follow", {
    method: "POST",
    token: ids.tokenCustomer,
  });
  assert.equal(followed.status, 201);
  assert.equal(await BrandFollow.countDocuments({ customer: ids.customer._id }), 1);

  const authed = await api("/api/brands?limit=50", { token: ids.tokenCustomer });
  assert.equal(authed.status, 200);
  const followedBrand = authed.body.brands.find((b) => b.slug === "rejected-then-approved");
  assert.ok(followedBrand);
  assert.equal(followedBrand.isFollowing, true);
  const otherBrand = authed.body.brands.find((b) => b.slug === "campaign-ready-brand");
  assert.ok(otherBrand);
  assert.equal(otherBrand.isFollowing, false);

  const anonymous = await api("/api/brands?limit=50");
  assert.equal(anonymous.status, 200);
  assert.ok(anonymous.body.brands.every((b) => b.isFollowing === false));
});
