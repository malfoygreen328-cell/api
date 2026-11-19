// tests/discoverySecurity.test.js
//
// Source-level security regressions. These are intentionally static: they guard
// the exact rules that must not be relaxed later (mass-assignment, identity
// spoofing, unapproved brand leakage, route shadowing).

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (relativePath) =>
  readFileSync(new URL(`../src/${relativePath}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("vendor store updates exclude discovery governance fields", () => {
  const source = read("controllers/storeController.js");
  const allowlistMatch = source.match(/const allowed = \[([\s\S]*?)\];/);
  assert.ok(allowlistMatch, "store update allowlist must exist");
  const allowlist = allowlistMatch[1];

  assert.ok(allowlist.includes("storeName"));
  assert.ok(allowlist.includes("story"));
  assert.ok(allowlist.includes("fashionCategories"));
  assert.ok(!allowlist.includes("approvalStatus"));
  assert.ok(!allowlist.includes("featured"));
  assert.ok(!allowlist.includes("discoveryEligible"));
  assert.ok(!allowlist.includes("approvedBy"));
});

test("vendor brand endpoint cannot write governance fields", () => {
  const source = read("controllers/vendorBrandController.js");
  assert.ok(!/updates\.approvalStatus/.test(source));
  assert.ok(!/updates\.featured\s*=/.test(source));
  assert.ok(!/updates\.discoveryEligible\s*=/.test(source));
  assert.ok(source.includes("approvalStatus = \"PENDING\""));
});

test("public brand reads enforce approval and discovery eligibility", () => {
  const source = read("controllers/brandController.js");
  assert.ok(source.includes('approvalStatus: "APPROVED"'));
  assert.ok(source.includes("discoveryEligible: true"));
  assert.ok(source.includes('vendor.status !== "APPROVED"'));
});

test("legacy store endpoints apply the same eligibility gate", () => {
  const source = read("controllers/storeController.js");
  assert.ok(source.includes('approvalStatus: "APPROVED"'));
  assert.ok(source.includes("discoveryEligible: true"));

  const publicSource = read("controllers/publicStoreController.js");
  assert.ok(publicSource.includes('approvalStatus: "APPROVED"'));
  assert.ok(publicSource.includes("discoveryEligible: true"));
  assert.ok(publicSource.includes('status: "APPROVED"'));
});

test("follow identity is taken from the token, never the request body", () => {
  const source = read("controllers/brandFollowController.js");
  assert.ok(source.includes("customer: req.user._id"));
  assert.ok(!/req\.body\.(customer|customerId|userId)/.test(source));
});

test("story and campaign mutations are admin guarded and audited", () => {
  const routes = read("routes/adminDiscoveryRoutes.js");
  assert.ok(routes.includes("router.use(protect, requireRole(\"admin\", \"superadmin\"))"));

  const controller = read("controllers/adminDiscoveryController.js");
  for (const action of [
    "brand.approved",
    "brand.rejected",
    "brand.featured",
    "brand.unfeatured",
    "brand_story.created",
    "discovery_campaign.created",
  ]) {
    assert.ok(controller.includes(action), `missing audit action ${action}`);
  }
});

test("brand router declares static paths before /:slug", () => {
  const source = read("routes/brandRoutes.js");
  const slugIndex = source.indexOf('router.get("/:slug"');
  assert.ok(slugIndex > 0);
  for (const staticPath of [
    '"/search"',
    '"/new"',
    '"/emerging"',
    '"/featured"',
    '"/meta"',
    '"/stories"',
    '"/products/recent"',
    '"/campaigns/active"',
    '"/followed"',
  ]) {
    const index = source.indexOf(staticPath);
    assert.ok(index > 0 && index < slugIndex, `${staticPath} must come before /:slug`);
  }
});

test("vendor brand router is mounted before the broad vendor router", () => {
  const source = read("app.js");
  const brandMount = source.indexOf('app.use("/api/vendor/brand", vendorBrandRoutes)');
  const vendorMount = source.indexOf('app.use("/api/vendor", vendorRoutes)');
  assert.ok(brandMount > 0);
  assert.ok(vendorMount > brandMount);
});

test("public store routes use optional auth for owner/admin preview", () => {
  const source = read("routes/storeRoutes.js");
  assert.ok(source.includes('router.get("/", optionalAuth, getAllStores)'));
  assert.ok(source.includes('router.get("/slug/:slug", optionalAuth, getStoreBySlug)'));
});

test("all vendor-supplied brand text is sanitized on write", () => {
  const vendor = read("controllers/vendorBrandController.js");
  for (const fn of [
    "sanitizeText",
    "sanitizeMultiline",
    "sanitizeUrl",
    "sanitizeSocialLinks",
    "sanitizeCategories",
  ]) {
    assert.ok(vendor.includes(fn), `vendor brand controller must use ${fn}`);
  }
});
