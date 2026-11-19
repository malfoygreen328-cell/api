// src/utils/jwt.js
import jwt from "jsonwebtoken";

const DEFAULT_EXPIRY = "7d";

/**
 * Single source of truth for access-token lifetime. Every auth flow must use
 * this module so a policy change cannot silently leave one portal on a
 * different expiry (the pre-existing bug was customer=7d, vendor=1d,
 * admin=7d depending on which controller issued the token).
 */
export function getJwtExpiry() {
  const configured = String(process.env.JWT_EXPIRES_IN || "").trim();
  return configured || DEFAULT_EXPIRY;
}

export function getJwtTtlMs() {
  return parseDurationMs(getJwtExpiry(), 7 * 24 * 60 * 60 * 1000);
}

export function parseDurationMs(value, fallbackMs) {
  if (typeof value === "number" && Number.isFinite(value)) return value * 1000;

  const raw = String(value || "").trim();
  if (!raw) return fallbackMs;

  const match = raw.match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d|w)?$/i);
  if (!match) return fallbackMs;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return fallbackMs;

  const unit = (match[2] || "s").toLowerCase();
  const multipliers = {
    ms: 1,
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
  };
  return Math.round(amount * multipliers[unit]);
}

export const generateToken = (userId, role) => {
  return jwt.sign({ id: userId, role }, process.env.JWT_SECRET, {
    expiresIn: getJwtExpiry(),
  });
};

export function setAuthCookie(res, token) {
  res.cookie("azania_token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    maxAge: getJwtTtlMs(),
    path: "/",
  });
}

export function clearAuthCookie(res) {
  res.clearCookie("azania_token", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    path: "/",
  });
}

export default { generateToken, getJwtExpiry, getJwtTtlMs, parseDurationMs, setAuthCookie, clearAuthCookie };
