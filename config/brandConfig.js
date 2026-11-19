// src/config/brandConfig.js
//
// Single source of truth for the brand discovery domain. Only the three
// marketplace categories are allowed - Azania does not sell food, crafts or
// unrelated goods. Keep the stored category values as stable slugs so that
// filtering does not break when labels are reworded.

export const FASHION_CATEGORIES = [
  { slug: "clothing", label: "Clothing" },
  { slug: "accessories", label: "Fashion Accessories" },
  { slug: "wigs", label: "Wigs" },
];

export const FASHION_CATEGORY_SLUGS = FASHION_CATEGORIES.map((c) => c.slug);
export const FASHION_CATEGORY_LABELS = FASHION_CATEGORIES.reduce((acc, c) => {
  acc[c.slug] = c.label;
  return acc;
}, {});

export const PROVINCES = [
  "Eastern Cape",
  "Free State",
  "Gauteng",
  "KwaZulu-Natal",
  "Limpopo",
  "Mpumalanga",
  "Northern Cape",
  "North West",
  "Western Cape",
];

export const BRAND_APPROVAL_STATUSES = ["PENDING", "APPROVED", "REJECTED"];

export const BRAND_STATUS_LABELS = {
  PENDING: "Pending review",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};

// Transparent, documented discovery thresholds. Nothing here is derived from a
// fabricated statistic: followers/product counts come from real collections.
export const DISCOVERY = {
  newBrandDays: 30,
  emergingMaxAgeDays: 3 * 365,
  emergingMaxFollowers: 100,
  emergingMaxProducts: 50,
  rotationWindowHours: 6,
  maxRankingCandidates: 500,
  recentProductPerBrandCap: 2,
  // Weights are relative and documented in DISCOVERY_SYSTEM.md. They must sum
  // to 1 for the weighted score to stay in the 0..1 range.
  weights: {
    relevance: 0.35,
    completeness: 0.2,
    recency: 0.15,
    emergingRotation: 0.2,
    engagement: 0.07,
    featured: 0.03,
  },
};

export const isFashionCategory = (value) =>
  FASHION_CATEGORY_SLUGS.includes(String(value || "").trim().toLowerCase());

export const isProvince = (value) => PROVINCES.includes(String(value || "").trim());
