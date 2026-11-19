// tests/brandDiscovery.integration.test.js
//
// Live integration test against a disposable local MongoDB database. It uses
// the real Express app, real JWT auth and the real Mongoose models. The database
// is dropped afterwards. Requires a local mongod on 127.0.0.1:27017.

import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";

import Vendor from "../src/models/Vendor.js";
import Store from "../src/models/Store.js";
import User from "../src/models/User.js";
import Admin from "../src/models/Admin.js";
import Product from "../src/models/Product.js";
import BrandFollow from "../src/models/BrandFollow.js";
import BrandStory from "../src/models/BrandStory.js";
import DiscoveryCampaign from "../src/models/DiscoveryCampaign.js";
import AuditLog from "../src/models/AuditLog.js";

const TEST_SECRET = "discovery-integration-secret";
process.env.JWT_SECRET = TEST_SECRET;
process.env.NODE_ENV = "test";

const DB_NAME = `azania_discovery_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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

const makeVendor = async (suffix, status) => {
  const vendor = await Vendor.create({
    fullName: `Vendor ${suffix}`,
    email: `vendor-${suffix}@example.com`,
    password: "secret123",
    phone: "0712345678",
    businessName: `Vendor Business ${suffix}`,
    registrationNumber: `REG-${suffix}`,
    taxNumber: `TAX-${suffix}`,
    businessType: "Pty Ltd",
    status,
    documents: {
      registrationCert: "/uploads/reg.pdf",
      directorId: "/uploads/id.pdf",
      proofOfAddress: "/uploads/poa.pdf",
    },
  });
  return vendor;
};

const makeStore = async (vendor, suffix, overrides = {}) => {
  const store = await Store.create({
    vendor: vendor._id,
    storeName: `Brand ${suffix}`,
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
  return store;
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

  // Store.vendor is unique, so each store fixture needs its own vendor even
  // when the vendor account is in the same approval state.
  ids.vendorApproved = await makeVendor("approved", "APPROVED");
  ids.vendorApproved2 = await makeVendor("approved2", "APPROVED");
  ids.vendorApprovedPendingStore = await makeVendor("approved-pending-store", "APPROVED");
  ids.vendorApprovedHidden = await makeVendor("approved-hidden", "APPROVED");
  ids.vendorPending = await makeVendor("pending", "PENDING");
  ids.vendorDeclined = await makeVendor("declined", "DECLINED");

  ids.storeApproved = await makeStore(ids.vendorApproved, "Approved", {
    storeName: "Approved Brand",
    storeSlug: "approved-brand",
    approvalStatus: "APPROVED",
  });
  ids.storeApproved2 = await makeStore(ids.vendorApproved2, "Approved Two", {
    storeName: "Approved Brand Two",
    storeSlug: "approved-brand-two",
    approvalStatus: "APPROVED",
  });
  ids.storePending = await makeStore(ids.vendorApprovedPendingStore, "Pending", {
    storeName: "Pending Brand",
    storeSlug: "pending-brand",
  });
  ids.storeHidden = await makeStore(ids.vendorApprovedHidden, "Hidden", {
    storeName: "Hidden Brand",
    storeSlug: "hidden-brand",
    approvalStatus: "APPROVED",
    discoveryEligible: false,
  });
  ids.storeVendorPending = await makeStore(ids.vendorPending, "Vendor Pending", {
    storeName: "Vendor Pending Brand",
    storeSlug: "vendor-pending-brand",
    approvalStatus: "APPROVED",
  });
  ids.storeVendorDeclined = await makeStore(ids.vendorDeclined, "Vendor Declined", {
    storeName: "Vendor Declined Brand",
    storeSlug: "vendor-declined-brand",
    approvalStatus: "APPROVED",
  });

  // A brand cannot exist twice for one vendor (unique vendor index), so keep
  // the extra stores on separate vendors and only use them where necessary.

  ids.customer = await User.create({
    name: "Customer One",
    email: "customer-one@example.com",
    password: "secret123",
    isVerified: true,
  });
  ids.customer2 = await User.create({
    name: "Customer Two",
    email: "customer-two@example.com",
    password: "secret123",
    isVerified: true,
  });
  ids.admin = await Admin.create({
    fullName: "Admin One",
    email: "admin-one@example.com",
    password: "secret123",
    role: "admin",
  });

  ids.product = await Product.create({
    store: ids.storeApproved._id,
    vendor: ids.vendorApproved._id,
    name: "Test Dress",
    description: "A test dress",
    price: 499.99,
    stock: 10,
    category: "clothing",
    images: ["/uploads/dress.jpg"],
    isActive: true,
  });

  ids.tokenCustomer = tokenFor(ids.customer, "customer");
  ids.tokenCustomer2 = tokenFor(ids.customer2, "customer");
  ids.tokenAdmin = tokenFor(ids.admin, "admin");
  ids.tokenVendor = tokenFor(ids.vendorApproved, "vendor_owner");
  ids.tokenVendorPendingStore = tokenFor(ids.vendorApprovedPendingStore, "vendor_owner");
});

after(async () => {
  if (!dbReady) return;
  if (server) await new Promise((resolve) => server.close(resolve));
  if (mongoose.connection.readyState) {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});

test("public discovery only returns approved, eligible brands of approved vendors", async (t) => {
  if (!dbReady) return t.skip("Local MongoDB not available");

  const list = await api("/api/brands?limit=50");
  assert.equal(list.status, 200);
  assert.equal(list.body.success, true);

  const slugs = list.body.brands.map((b) => b.slug).sort();
  assert.deepEqual(slugs, ["approved-brand", "approved-brand-two"]);
  assert.equal(list.body.total, 2);
  assert.equal(list.body.ranking.sponsored, false);
  assert.equal(list.body.ranking.transparent, true);

  for (const hidden of [
    "pending-brand",
    "hidden-brand",
    "vendor-pending-brand",
    "vendor-declined-brand",
  ]) {
    const res = await api(`/api/brands/${hidden}`);
    assert.equal(res.status, 404, `${hidden} must not be public`);
  }

  const meta = await api("/api/brands/meta");
  assert.equal(meta.status, 200);
  assert.equal(meta.body.totalBrands, 2);

  const stories = await api("/api/brands/stories");
  assert.equal(stories.status, 200);
  assert.ok(Array.isArray(stories.body.stories));

  const approved = await api("/api/brands/approved-brand");
  assert.equal(approved.status, 200);
  assert.equal(approved.body.brand.slug, "approved-brand");
  assert.ok(Array.isArray(approved.body.products));
  assert.equal(approved.body.products.length, 1);
  assert.equal(approved.body.products[0].brand.slug, "approved-brand");
});

test("legacy store endpoints do not leak unapproved brands", async (t) => {
  if (!dbReady) return t.skip("Local MongoDB not available");

  const list = await api("/api/stores");
  assert.equal(list.status, 200);
  const slugs = (list.body.stores || []).map((s) => s.storeSlug).sort();
  assert.deepEqual(slugs, ["approved-brand", "approved-brand-two"]);

  const hidden = await api("/api/stores/slug/pending-brand");
  assert.equal(hidden.status, 404);

  const ownerPreview = await api("/api/stores/slug/pending-brand", {
    token: ids.tokenVendorPendingStore,
  });
  assert.equal(ownerPreview.status, 200);
  assert.equal(ownerPreview.body.store.storeSlug, "pending-brand");

  const adminPreview = await api("/api/stores/slug/pending-brand", {
    token: ids.tokenAdmin,
  });
  assert.equal(adminPreview.status, 200);
});

test("follow requires a customer token and derives identity from the token", async (t) => {
  if (!dbReady) return t.skip("Local MongoDB not available");

  const anonymous = await api("/api/brands/approved-brand/follow", { method: "POST" });
  assert.equal(anonymous.status, 401);

  const vendorAttempt = await api("/api/brands/approved-brand/follow", {
    method: "POST",
    token: ids.tokenVendor,
  });
  assert.equal(vendorAttempt.status, 403);

  const first = await api("/api/brands/approved-brand/follow", {
    method: "POST",
    token: ids.tokenCustomer,
  });
  assert.equal(first.status, 201);
  assert.equal(first.body.following, true);

  const duplicate = await api("/api/brands/approved-brand/follow", {
    method: "POST",
    token: ids.tokenCustomer,
  });
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.alreadyFollowing, true);

  const spoof = await api("/api/brands/approved-brand-two/follow", {
    method: "POST",
    token: ids.tokenCustomer,
    body: { customer: String(ids.customer2._id) },
  });
  assert.equal(spoof.status, 201);

  const follows = await BrandFollow.find({ store: ids.storeApproved2._id }).lean();
  assert.equal(follows.length, 1);
  assert.equal(String(follows[0].customer), String(ids.customer._id));

  const mine = await api("/api/brands/followed", { token: ids.tokenCustomer });
  assert.equal(mine.status, 200);
  assert.equal(mine.body.brands.length, 2);

  const theirs = await api("/api/brands/followed", { token: ids.tokenCustomer2 });
  assert.equal(theirs.status, 200);
  assert.equal(theirs.body.brands.length, 0);

  const feed = await api("/api/brands/followed/feed", { token: ids.tokenCustomer });
  assert.equal(feed.status, 200);
  assert.equal(feed.body.products.length, 1);
  assert.equal(feed.body.products[0].brand.slug, "approved-brand");

  const unfollow = await api("/api/brands/approved-brand/follow", {
    method: "DELETE",
    token: ids.tokenCustomer,
  });
  assert.equal(unfollow.status, 200);
  assert.equal(unfollow.body.following, false);

  const afterUnfollow = await api("/api/brands/followed", { token: ids.tokenCustomer });
  assert.equal(afterUnfollow.body.brands.length, 1);
});

test("admin discovery actions are role-guarded, effective and audited", async (t) => {
  if (!dbReady) return t.skip("Local MongoDB not available");

  const anonymous = await api("/api/admin/discovery/brands");
  assert.equal(anonymous.status, 401);

  const customer = await api("/api/admin/discovery/brands", { token: ids.tokenCustomer });
  assert.equal(customer.status, 403);

  const adminList = await api("/api/admin/discovery/brands?limit=50", { token: ids.tokenAdmin });
  assert.equal(adminList.status, 200);
  assert.equal(adminList.body.total, 6);
  assert.ok(adminList.body.brands.every((b) => b.vendor && b.vendor.email));

  const featureUnapproved = await api(
    `/api/admin/discovery/brands/${ids.storePending._id}/feature`,
    { method: "PATCH", token: ids.tokenAdmin }
  );
  assert.equal(featureUnapproved.status, 400);

  const approve = await api(`/api/admin/discovery/brands/${ids.storePending._id}/approve`, {
    method: "PATCH",
    token: ids.tokenAdmin,
  });
  assert.equal(approve.status, 200);
  assert.equal(approve.body.brand.approvalStatus, "APPROVED");

  const nowPublic = await api("/api/brands/pending-brand");
  assert.equal(nowPublic.status, 200);

  const feature = await api(`/api/admin/discovery/brands/${ids.storeApproved._id}/feature`, {
    method: "PATCH",
    token: ids.tokenAdmin,
  });
  assert.equal(feature.status, 200);
  assert.equal(feature.body.brand.featured, true);

  const unfeature = await api(`/api/admin/discovery/brands/${ids.storeApproved._id}/unfeature`, {
    method: "PATCH",
    token: ids.tokenAdmin,
  });
  assert.equal(unfeature.status, 200);
  assert.equal(unfeature.body.brand.featured, false);

  const rejectMissingReason = await api(
    `/api/admin/discovery/brands/${ids.storeHidden._id}/reject`,
    { method: "PATCH", token: ids.tokenAdmin, body: {} }
  );
  assert.equal(rejectMissingReason.status, 400);

  const reject = await api(`/api/admin/discovery/brands/${ids.storeHidden._id}/reject`, {
    method: "PATCH",
    token: ids.tokenAdmin,
    body: { reason: "Profile is incomplete" },
  });
  assert.equal(reject.status, 200);
  assert.equal(reject.body.brand.approvalStatus, "REJECTED");
  assert.equal(reject.body.brand.discoveryEligible, false);
  assert.equal(reject.body.brand.approvalReason, "Profile is incomplete");

  const eligibility = await api(
    `/api/admin/discovery/brands/${ids.storeHidden._id}/eligibility`,
    { method: "PATCH", token: ids.tokenAdmin, body: { eligible: true } }
  );
  assert.equal(eligibility.status, 200);
  assert.equal(eligibility.body.brand.discoveryEligible, true);

  const actions = await AuditLog.distinct("action", {
    resourceId: String(ids.storeApproved._id),
  });
  assert.ok(actions.includes("brand.featured"));
});

test("admin can publish stories and curated campaigns", async (t) => {
  if (!dbReady) return t.skip("Local MongoDB not available");

  const story = await api("/api/admin/discovery/stories", {
    method: "POST",
    token: ids.tokenAdmin,
    body: {
      brandId: String(ids.storeApproved._id),
      title: "Behind the seams",
      excerpt: "How this brand started.",
      body: "A longer story about the brand.",
      status: "PUBLISHED",
      image: "https://example.com/story.jpg",
    },
  });
  assert.equal(story.status, 201);

  const stories = await api("/api/brands/stories");
  assert.equal(stories.status, 200);
  assert.ok(stories.body.stories.some((s) => s.slug === story.body.story.slug));

  const detail = await api(`/api/brands/stories/${story.body.story.slug}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.story.brand.slug, "approved-brand");

  const campaign = await api("/api/admin/discovery/campaigns", {
    method: "POST",
    token: ids.tokenAdmin,
    body: {
      name: "Winter Edit",
      description: "Curated winter picks",
      status: "ACTIVE",
      brands: [String(ids.storeApproved._id)],
    },
  });
  assert.equal(campaign.status, 201);

  const active = await api("/api/brands/campaigns/active");
  assert.equal(active.status, 200);
  const found = active.body.campaigns.find((c) => c.name === "Winter Edit");
  assert.ok(found);
  assert.equal(found.sponsored, false);
  assert.equal(found.label, "Curated by Azania");
  assert.equal(found.brands[0].slug, "approved-brand");

  const storyCount = await BrandStory.countDocuments();
  const campaignCount = await DiscoveryCampaign.countDocuments();
  assert.equal(storyCount, 1);
  assert.equal(campaignCount, 1);
});

test("vendor can edit only their own brand and cannot self-approve or self-feature", async (t) => {
  if (!dbReady) return t.skip("Local MongoDB not available");

  const mine = await api("/api/vendor/brand", { token: ids.tokenVendor });
  assert.equal(mine.status, 200);
  assert.equal(mine.body.brand.slug, "approved-brand");

  const update = await api("/api/vendor/brand", {
    method: "PUT",
    token: ids.tokenVendor,
    body: {
      storeName: "Approved Brand Renamed",
      description: "Updated description that is long enough to count towards completeness for the brand profile.",
      story: "Updated story. ".repeat(12),
      province: "Gauteng",
      city: "Pretoria",
      fashionCategories: ["clothing", "accessories"],
      socialLinks: { instagram: "https://instagram.com/renamed", website: "javascript:alert(1)" },
      featured: true,
      approvalStatus: "APPROVED",
      discoveryEligible: false,
    },
  });
  assert.equal(update.status, 200);
  assert.equal(update.body.brand.name, "Approved Brand Renamed");
  assert.equal(update.body.brand.featured, false);
  assert.equal(update.body.brand.discoveryEligible, true);
  assert.equal(update.body.brand.approvalStatus, "PENDING");
  assert.equal(update.body.brand.socialLinks.website, "");

  const refreshed = await Store.findById(ids.storeApproved._id).lean();
  assert.equal(refreshed.featured, false);
  assert.equal(refreshed.approvalStatus, "PENDING");
  assert.equal(refreshed.socialLinks.website, "");

  const hiddenFromPublic = await api("/api/brands/approved-brand");
  assert.equal(hiddenFromPublic.status, 404);

  const uploadWithoutFile = await api("/api/vendor/brand/upload", {
    method: "POST",
    token: ids.tokenVendor,
    body: {},
  });
  assert.equal(uploadWithoutFile.status, 400);
});
