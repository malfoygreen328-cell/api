// tests/discoveryAlgorithm.test.js
//
// Pure ranking/eligibility unit tests. No database required.

import assert from "node:assert/strict";
import test from "node:test";
import {
  hashString,
  rotationKey,
  rotationValue,
  daysSince,
  isNewBrand,
  isEmergingBrand,
  computeCompleteness,
  scoreBrand,
  rankBrands,
  publicBrand,
  capPerBrand,
  DISCOVERY_CONSTANTS,
} from "../src/services/discoveryService.js";
import {
  DISCOVERY,
  FASHION_CATEGORIES,
  PROVINCES,
} from "../src/config/brandConfig.js";
import { sanitizeUrl } from "../src/utils/contentSanitizer.js";

const now = new Date("2026-06-15T12:00:00.000Z");
const daysAgo = (days) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

const store = (overrides = {}) => ({
  _id: overrides._id || "507f1f77bcf86cd799439011",
  storeName: "Test Brand",
  storeSlug: "test-brand",
  description: "A".repeat(100),
  story: "B".repeat(200),
  logo: "/uploads/logo.jpg",
  banner: "/uploads/banner.jpg",
  province: "Gauteng",
  city: "Johannesburg",
  fashionCategories: ["clothing"],
  socialLinks: { instagram: "https://instagram.com/testbrand" },
  createdAt: daysAgo(10),
  featured: false,
  ...overrides,
});

test("discovery weights are transparent and sum to 1", () => {
  const total = Object.values(DISCOVERY.weights).reduce((sum, weight) => sum + weight, 0);
  assert.ok(Math.abs(total - 1) < 1e-9);
  assert.equal(DISCOVERY.weights.relevance, 0.35);
  assert.equal(DISCOVERY.sponsoredPlacement, undefined);
});

test("config only allows Azania fashion categories and SA provinces", () => {
  assert.deepEqual(
    FASHION_CATEGORIES.map((c) => c.slug),
    ["clothing", "accessories", "wigs"]
  );
  assert.equal(PROVINCES.length, 9);
  assert.ok(PROVINCES.includes("Gauteng"));
});

test("hash and rotation are deterministic and window-bounded", () => {
  assert.equal(hashString("brand:1"), hashString("brand:1"));
  assert.notEqual(hashString("brand:1"), hashString("brand:2"));

  const window = DISCOVERY.rotationWindowHours;
  const a = rotationValue("brand-1", now, window);
  assert.equal(a, rotationValue("brand-1", now, window));
  assert.ok(a >= 0 && a <= 1);

  const later = new Date(now.getTime() + window * 60 * 60 * 1000 + 1000);
  assert.notEqual(rotationKey(now, window), rotationKey(later, window));
});

test("daysSince handles missing and future dates safely", () => {
  assert.equal(daysSince(null, now), Infinity);
  assert.ok(daysSince(daysAgo(3), now) >= 2.99);
  assert.equal(daysSince(new Date(now.getTime() + 100000), now), 0);
});

test("new and emerging thresholds use real signals", () => {
  assert.equal(isNewBrand({ createdAt: daysAgo(5) }, now), true);
  assert.equal(isNewBrand({ createdAt: daysAgo(45) }, now), false);
  assert.equal(
    isEmergingBrand({ createdAt: daysAgo(100), followersCount: 10, productCount: 5 }, now),
    true
  );
  assert.equal(
    isEmergingBrand({ createdAt: daysAgo(100), followersCount: 1000, productCount: 5 }, now),
    false
  );
});

test("completeness is bounded and reports missing sections", () => {
  const complete = computeCompleteness(store());
  assert.ok(Math.abs(complete.score - 1) < 1e-9);
  assert.deepEqual(complete.missing, []);

  const empty = computeCompleteness({});
  assert.equal(empty.score, 0);
  assert.ok(empty.missing.includes("logo"));
  assert.ok(empty.score >= 0 && empty.score <= 1);
});

test("scoreBrand is bounded and improves with a featured flag", () => {
  const base = scoreBrand(store(), { now });
  const featured = scoreBrand(store({ featured: true }), { now });

  assert.ok(base.score >= 0 && base.score <= 1);
  assert.ok(featured.score >= base.score);
  assert.ok(featured.score - base.score <= DISCOVERY.weights.featured + 1e-9);
});

test("relevance rewards matching category and search text", () => {
  const match = scoreBrand(store(), { now, category: "clothing" });
  const miss = scoreBrand(store(), { now, category: "wigs" });
  assert.equal(match.relevance, 1);
  assert.equal(miss.relevance, 0);
  assert.ok(match.score > miss.score);
});

test("emerging feed is primarily rotation-ordered, not follower-ordered", () => {
  const stores = [1, 2, 3, 4, 5].map((n) =>
    store({ _id: `507f1f77bcf86cd79943901${n}`, storeName: `Brand ${n}` })
  );
  const statsById = {};
  stores.forEach((s, index) => {
    statsById[String(s._id)] = {
      followersCount: index * 10,
      productCount: index,
      rating: index,
      reviewCount: index,
    };
  });

  const ranked = rankBrands(stores, { now, sort: "emerging", statsById });
  for (let i = 1; i < ranked.length; i += 1) {
    assert.ok(ranked[i - 1].meta.rotation >= ranked[i].meta.rotation);
  }
});

test("relevance ranking is stable and uses an id tie-break", () => {
  const stores = [
    store({ _id: "507f1f77bcf86cd799439012" }),
    store({ _id: "507f1f77bcf86cd799439011" }),
  ];
  const first = rankBrands(stores, { now, sort: "relevance" }).map((r) => String(r.store._id));
  const second = rankBrands([...stores].reverse(), { now, sort: "relevance" }).map((r) =>
    String(r.store._id)
  );
  assert.deepEqual(first, second);
});

test("capPerBrand stops one brand filling a product rail", () => {
  const items = [
    { id: 1, store: "a" },
    { id: 2, store: "a" },
    { id: 3, store: "a" },
    { id: 4, store: "b" },
  ];
  const capped = capPerBrand(items, (item) => item.store, 2);
  assert.deepEqual(
    capped.map((item) => item.id),
    [1, 2, 4]
  );
});

test("publicBrand never exposes governance or private vendor fields", () => {
  const brand = publicBrand(store({ approvalReason: "internal", featuredBy: "admin" }), {
    now,
    followersCount: 12,
    productCount: 3,
    rating: 4.4,
    reviewCount: 2,
  });

  assert.equal(brand.followersCount, 12);
  assert.equal(brand.rating, 4.4);
  assert.equal(brand.approvalReason, undefined);
  assert.equal(brand.featuredBy, undefined);
  assert.equal(brand.vendor, undefined);
  assert.deepEqual(brand.categories, [{ slug: "clothing", label: "Clothing" }]);
});

test("sanitizeUrl blocks script-capable schemes", () => {
  assert.equal(sanitizeUrl("javascript:alert(1)"), "");
  assert.equal(sanitizeUrl("data:text/html;base64,PHNjcmlwdD4="), "");
  assert.equal(sanitizeUrl("vbscript:msgbox(1)"), "");
  assert.equal(sanitizeUrl("https://example.com/shop"), "https://example.com/shop");
  assert.equal(sanitizeUrl("/uploads/pic.jpg"), "/uploads/pic.jpg");
});

test("constants expose the documented rotation window", () => {
  assert.equal(DISCOVERY_CONSTANTS.rotationWindowHours, 6);
});
