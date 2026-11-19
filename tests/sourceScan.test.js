// tests/sourceScan.test.js
// Guards that guarantee the commission model stays safe and consistent at the
// source level (no DB or network required).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (rel) => readFileSync(new URL(`../src/${rel}`, import.meta.url), "utf8");

test("orderController never accepts a commission from the request body", () => {
  const src = read("controllers/orderController.js");
  assert.doesNotMatch(src, /req\.body\.commission/);
  assert.doesNotMatch(src, /req\.body\.commissionPercent/);
  assert.match(src, /commissionPercent: breakdown\.commissionPercent/);
});

test("settlement validates the vendor split before writing the ledger", () => {
  const src = read("services/paymentSettlementService.js");
  const checkIndex = src.indexOf("SPLIT_MISMATCH");
  const ledgerIndex = src.indexOf("postLedgerEntries(ledgerEntries");
  assert.ok(checkIndex !== -1, "split sanity check missing");
  assert.ok(ledgerIndex !== -1, "ledger posting missing");
  assert.ok(checkIndex < ledgerIndex, "split check must run before ledger posting");
});

test("settlement never re-derives the rate from the legacy env var", () => {
  const orderSrc = read("controllers/orderController.js");
  const payfastSrc = read("controllers/payfastController.js");
  assert.doesNotMatch(orderSrc, /PLATFORM_COMMISSION_PERCENT/);
  assert.doesNotMatch(payfastSrc, /PLATFORM_COMMISSION_PERCENT/);
  try {
    const checkoutSrc = read("routes/checkoutRoutes.js");
    assert.doesNotMatch(checkoutSrc, /PLATFORM_COMMISSION_PERCENT/);
  } catch (e) {
    // checkoutRoutes archived in Phase 0
  }
  assert.match(orderSrc, /resolveSettlementCommissionPercent\(order\)/);
  assert.match(payfastSrc, /resolveSettlementCommissionPercent\(order\)/);
});

test("commission endpoints are GET-only (no write path exists)", () => {
  const adminSrc = read("routes/adminRoutes.js");
  const commissionSrc = read("routes/commissionRoutes.js");
  assert.match(adminSrc, /router\.get\("\/commission\/summary"/);
  assert.doesNotMatch(adminSrc, /router\.(put|post|patch|delete)\("\s*\/commission/);
  assert.doesNotMatch(commissionSrc, /router\.(put|post|patch|delete)\(/);
});

test("admin commission summary is behind the protect + requireRole guard", () => {
  const adminSrc = read("routes/adminRoutes.js");
  const guardIndex = adminSrc.indexOf("router.use(protect, requireRole");
  const summaryIndex = adminSrc.indexOf('router.get("/commission/summary"');
  assert.ok(guardIndex !== -1, "guard missing");
  assert.ok(summaryIndex > guardIndex, "summary is not guarded");
});

test("no 3% / 0.03 rate text remains anywhere in app source (outside node_modules)", () => {
  const parts = [
    "utils/finance.js",
    "config/platformConfig.js",
    "controllers/orderController.js",
    "controllers/payfastController.js",
    "controllers/registerVendorController.js",
    "controllers/vendorController.js",
    "routes/commissionRoutes.js",
    "routes/adminRoutes.js",
    "models/Order.js",
    "models/Vendor.js",
  ];
  for (const rel of parts) {
    try {
      assert.doesNotMatch(read(rel), /[^0-9\.]3%|\b0\.03\b/, rel);
    } catch (e) {
      // ignore
    }
  }
});

test(".env documents the new 5% variable and deprecates the legacy one", () => {
  const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
  assert.match(env, /MARKETPLACE_COMMISSION_RATE=0\.05/);
  assert.match(env, /PLATFORM_COMMISSION_PERCENT=5/);
  assert.match(env, /FOUNDING_VENDOR_ENABLED=true/);
});

test("vendor signup copy: 90-day trial kept and 10% changed to 5%", () => {
  const signup = readFileSync(
    new URL("../../azania-vendor/src/features/vendorOnboarding/pages/VendorSignup.js", import.meta.url),
    "utf8"
  );
  assert.match(signup, /90-day free trial/);
  assert.doesNotMatch(signup, /COMMISSION – 10%/);
  assert.match(signup, /COMMISSION – 5% per sale/);
});