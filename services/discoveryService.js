// src/services/discoveryService.js
//
// Fair, transparent brand discovery ranking.
//
// Principles (documented in DISCOVERY_SYSTEM.md):
// - Only approved, discovery-eligible brands connected to an APPROVED vendor
//   can be ranked. Eligibility is enforced by the query, not by the client.
// - Ranking never uses advertising spend (there is no sponsored placement).
// - Sales/followers are used only as a small, real-data engagement signal.
// - Emerging brands receive a rotating slot. The rotation value is a
//   deterministic hash of (brand id + time window), so it changes over time
//   and cannot be gamed by reloading the page.
// - Every score component is bounded and the final score is 0..1.
//
// The pure functions in this file are exported separately so they can be
// tested without a database.

import {
  DISCOVERY,
  FASHION_CATEGORY_LABELS,
  FASHION_CATEGORY_SLUGS,
} from "../config/brandConfig.js";
import { sanitizeUrl } from "../utils/contentSanitizer.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export const escapeRegex = (value) =>
  String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// FNV-1a style 32-bit hash. Deterministic across processes.
export const hashString = (value) => {
  let hash = 0x811c9dc5;
  const str = String(value || "");
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
};

export const rotationKey = (now = new Date(), windowHours = DISCOVERY.rotationWindowHours) => {
  const ms = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const windowMs = Math.max(1, Number(windowHours) || DISCOVERY.rotationWindowHours) * HOUR_MS;
  return Math.floor(ms / windowMs);
};

export const rotationValue = (id, now, windowHours) => {
  const bucket = rotationKey(now, windowHours);
  return hashString(`${String(id)}:${bucket}`) / 0xffffffff;
};

export const daysSince = (date, now = new Date()) => {
  if (!date) return Infinity;
  const then = date instanceof Date ? date.getTime() : new Date(date).getTime();
  if (!Number.isFinite(then)) return Infinity;
  return Math.max(0, (now.getTime() - then) / DAY_MS);
};

export const isNewBrand = (store, now = new Date(), days = DISCOVERY.newBrandDays) =>
  daysSince(store?.createdAt, now) <= days;

export const isEmergingBrand = (
  { followersCount = 0, productCount = 0, createdAt } = {},
  now = new Date()
) => {
  const ageDays = daysSince(createdAt, now);
  return (
    ageDays <= DISCOVERY.emergingMaxAgeDays &&
    followersCount <= DISCOVERY.emergingMaxFollowers &&
    productCount <= DISCOVERY.emergingMaxProducts
  );
};

export const computeCompleteness = (store = {}) => {
  const checks = [
    { key: "logo", weight: 0.12, pass: Boolean(String(store.logo || "").trim()) },
    { key: "banner", weight: 0.12, pass: Boolean(String(store.banner || "").trim()) },
    {
      key: "description",
      weight: 0.18,
      pass: String(store.description || "").trim().length >= 80,
    },
    { key: "story", weight: 0.18, pass: String(store.story || "").trim().length >= 150 },
    { key: "province", weight: 0.08, pass: Boolean(String(store.province || "").trim()) },
    { key: "city", weight: 0.08, pass: Boolean(String(store.city || "").trim()) },
    {
      key: "categories",
      weight: 0.14,
      pass: Array.isArray(store.fashionCategories) && store.fashionCategories.length > 0,
    },
    {
      key: "social",
      weight: 0.1,
      pass: Boolean(
        store.socialLinks &&
          Object.values(store.socialLinks).some((v) => String(v || "").trim())
      ),
    },
  ];
  const score = checks.reduce((sum, c) => sum + (c.pass ? c.weight : 0), 0);
  const missing = checks.filter((c) => !c.pass).map((c) => c.key);
  return { score: Math.min(1, score), missing };
};

const clamp01 = (n) => Math.max(0, Math.min(1, Number(n) || 0));

export const scoreBrand = (
  store,
  { now = new Date(), category = "", query = "", stats = {} } = {}
) => {
  const followersCount = Number(stats.followersCount) || 0;
  const productCount = Number(stats.productCount) || 0;
  const rating = Number(stats.rating) || 0;
  const completeness = computeCompleteness(store).score;

  const categories = Array.isArray(store.fashionCategories) ? store.fashionCategories : [];
  let relevance = 0.5;
  if (category) relevance = categories.includes(category) ? 1 : 0;
  if (query) {
    const haystack = [
      store.storeName,
      store.description,
      store.story,
      store.city,
      store.province,
      ...categories.map((c) => FASHION_CATEGORY_LABELS[c] || c),
    ]
      .join(" ")
      .toLowerCase();
    if (haystack.includes(String(query).toLowerCase())) relevance = Math.max(relevance, 0.8);
  }

  const age = daysSince(store.createdAt, now);
  const recency = clamp01(1 - age / 730); // decays over two years

  const rotation = rotationValue(store._id, now);
  const emerging = isEmergingBrand({ followersCount, productCount, createdAt: store.createdAt }, now);

  const followerSignal = followersCount > 0 ? clamp01(Math.log10(followersCount + 1) / 2) : 0;
  const ratingSignal = rating > 0 ? clamp01(rating / 5) : 0;
  const engagement = clamp01(followerSignal * 0.7 + ratingSignal * 0.3);

  const w = DISCOVERY.weights;
  const score =
    w.relevance * relevance +
    w.completeness * completeness +
    w.recency * recency +
    w.emergingRotation * rotation +
    w.engagement * engagement +
    w.featured * (store.featured ? 1 : 0);

  return {
    score: clamp01(score),
    relevance,
    completeness,
    recency,
    rotation,
    engagement,
    emerging,
    isNew: isNewBrand(store, now),
  };
};

// Rank a bounded candidate list. For the emerging feed, the rotating value is
// the primary key so that new/low-engagement brands are not permanently
// outranked by established brands. All other feeds use the transparent weighted
// score with a stable id tie-break.
export const rankBrands = (stores = [], options = {}) => {
  const { sort = "relevance", now = new Date(), statsById = {} } = options;
  const scored = stores.map((store) => ({
    store,
    ...scoreBrand(store, {
      ...options,
      now,
      stats: statsById[String(store._id)] || {},
    }),
  }));

  scored.sort((a, b) => {
    if (sort === "emerging") {
      if (b.rotation !== a.rotation) return b.rotation - a.rotation;
    }
    if (b.score !== a.score) return b.score - a.score;
    return String(a.store._id).localeCompare(String(b.store._id));
  });

  return scored.map(({ store, ...meta }) => ({ store, meta }));
};

export const publicSocialLinks = (links = {}) => {
  const out = {};
  for (const key of ["instagram", "facebook", "tiktok", "website"]) {
    const value = sanitizeUrl(links?.[key]);
    if (value) out[key] = value;
  }
  return out;
};

export const publicBrand = (
  store,
  {
    now = new Date(),
    followersCount = 0,
    productCount = 0,
    rating = 0,
    reviewCount = 0,
    isFollowing = false,
  } = {}
) => {
  const categories = (Array.isArray(store.fashionCategories) ? store.fashionCategories : [])
    .filter((c) => FASHION_CATEGORY_SLUGS.includes(c))
    .map((slug) => ({ slug, label: FASHION_CATEGORY_LABELS[slug] || slug }));

  return {
    id: String(store._id),
    name: store.storeName || "",
    slug: store.storeSlug || "",
    logo: store.logo || "",
    banner: store.banner || "",
    description: store.description || "",
    story: store.story || "",
    province: store.province || "",
    city: store.city || "",
    location: [store.city, store.province].filter(Boolean).join(", "),
    categories,
    socialLinks: publicSocialLinks(store.socialLinks),
    featured: Boolean(store.featured),
    isNew: isNewBrand(store, now),
    isEmerging: isEmergingBrand(
      { followersCount, productCount, createdAt: store.createdAt },
      now
    ),
    completeness: Number(computeCompleteness(store).score.toFixed(3)),
    followersCount: Number(followersCount) || 0,
    productCount: Number(productCount) || 0,
    rating: Number(Number(rating || 0).toFixed(1)),
    reviewCount: Number(reviewCount) || 0,
    isFollowing: Boolean(isFollowing),
    brandCreatedAt: store.createdAt,
  };
};

// Small helper used to stagger public product rails so a single brand cannot
// fill an entire "recently added" strip with the same catalogue.
export const capPerBrand = (items = [], getBrandId, cap = DISCOVERY.recentProductPerBrandCap) => {
  const counts = new Map();
  const out = [];
  for (const item of items) {
    const id = String(getBrandId(item) || "");
    const count = counts.get(id) || 0;
    if (id && count >= cap) continue;
    counts.set(id, count + 1);
    out.push(item);
  }
  return out;
};

export const DISCOVERY_CONSTANTS = DISCOVERY;

export default {
  escapeRegex,
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
};
