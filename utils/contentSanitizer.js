// src/utils/contentSanitizer.js
//
// Vendor-controlled brand content is stored as plain text and rendered with
// textContent in the storefront. We still normalise it on write so that raw
// HTML, control characters and javascript: URLs can never reach a database
// record that might later be rendered by a less careful client.

import {
  FASHION_CATEGORY_SLUGS,
  PROVINCES,
  isFashionCategory,
  isProvince,
} from "../config/brandConfig.js";

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const HTML_TAG = /<[^>]*>/g;

export const sanitizeText = (value, maxLength = 500) => {
  if (value === null || value === undefined) return "";
  let text = String(value)
    .replace(CONTROL_CHARS, "")
    .replace(HTML_TAG, "")
    .replace(/[<>]/g, "")
    .trim();
  if (Number.isFinite(maxLength) && maxLength > 0) text = text.slice(0, maxLength);
  return text;
};

export const sanitizeMultiline = (value, maxLength = 5000) => {
  if (value === null || value === undefined) return "";
  let text = String(value)
    .replace(CONTROL_CHARS, "")
    .replace(/\r\n/g, "\n")
    .replace(HTML_TAG, "")
    .replace(/[<>]/g, "")
    .trim();
  if (Number.isFinite(maxLength) && maxLength > 0) text = text.slice(0, maxLength);
  return text;
};

export const sanitizeSlug = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

export const isValidSlug = (value) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(value || ""));

// Only absolute http(s) URLs and local /uploads paths are accepted. This blocks
// javascript:, data:, vbscript: and other script-capable schemes.
export const sanitizeUrl = (value, maxLength = 500) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.startsWith("/uploads/")) {
    if (/[\s"'<>]/.test(raw)) return "";
    return raw.slice(0, maxLength);
  }
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    if (url.username || url.password) return "";
    return url.toString().slice(0, maxLength);
  } catch {
    return "";
  }
};

export const sanitizeSocialLinks = (links = {}) => {
  const source = links && typeof links === "object" ? links : {};
  return {
    instagram: sanitizeUrl(source.instagram),
    facebook: sanitizeUrl(source.facebook),
    tiktok: sanitizeUrl(source.tiktok),
    website: sanitizeUrl(source.website),
  };
};

export const sanitizeCategories = (value) => {
  const list = Array.isArray(value)
    ? value
    : typeof value === "string"
    ? value.split(",")
    : [];
  const seen = new Set();
  const result = [];
  for (const item of list) {
    const slug = String(item || "").trim().toLowerCase();
    if (isFashionCategory(slug) && !seen.has(slug)) {
      seen.add(slug);
      result.push(slug);
    }
  }
  return result;
};

export const sanitizeProvince = (value) => {
  const province = sanitizeText(value, 80);
  return isProvince(province) ? province : "";
};

export const sanitizeCity = (value) => sanitizeText(value, 100);

// Theme colours are written into CSS variables on the storefront, so only
// plain 3/6-digit hex values are accepted. Anything else (named colours,
// rgb(), url(), expressions) is rejected rather than silently coerced.
export const sanitizeThemeColor = (value, fallback = "") => {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(raw) ? raw : "";
};

export const categoryLabel = (slug) => {
  const found = FASHION_CATEGORY_SLUGS.includes(slug);
  return found ? slug : "";
};

export const isAllowedProvince = (value) => !value || PROVINCES.includes(value);

export default {
  sanitizeText,
  sanitizeMultiline,
  sanitizeSlug,
  isValidSlug,
  sanitizeUrl,
  sanitizeSocialLinks,
  sanitizeCategories,
  sanitizeProvince,
  sanitizeCity,
  sanitizeThemeColor,
};
