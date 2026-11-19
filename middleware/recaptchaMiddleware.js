import axios from "axios";

/*
 * Server-side Google reCAPTCHA v3 verification (fail-closed).
 *
 * The browser only collects a token; trust is decided here. A protected route
 * is allowed through only after Google's siteverify endpoint confirms the token
 * is valid, unexpired, matches the expected action + hostname and meets the
 * minimum score.
 *
 * Configuration (backend environment only - NEVER commit the secret):
 *   RECAPTCHA_SECRET          reCAPTCHA v3 SECRET key. REQUIRED in production.
 *   RECAPTCHA_MIN_SCORE       minimum acceptable score (default 0.5).
 *   RECAPTCHA_ALLOWED_HOSTS   comma-separated hostname allowlist.
 *   RECAPTCHA_ENABLED         set to "false" to hard-disable.
 *   RECAPTCHA_TEST_BYPASS     explicit non-production bypass. Ignored in
 *                             production. This is the ONLY path that skips
 *                             verification without a secret.
 *
 * Production behaviour: missing/disabled secret, missing token, Google error,
 * action/hostname mismatch, unknown score or low score => request rejected.
 * There is no silent "secret not deployed yet" bypass.
 */

const VERIFY_URL = "https://www.google.com/recaptcha/api/siteverify";

const DEFAULT_ALLOWED_HOSTS = [
  "azaniashop.co.za",
  "www.azaniashop.co.za",
  "azaniashop.netlify.app",
  "admin.azaniashop.co.za",
  "vendor.azaniashop.co.za",
];

let warnedBypass = false;

const isProduction = () => process.env.NODE_ENV === "production";

export function secretKey() {
  return String(process.env.RECAPTCHA_SECRET || "").trim();
}

export function isRecaptchaConfigured() {
  return secretKey() !== "";
}

export function isRecaptchaDisabled() {
  return process.env.RECAPTCHA_ENABLED === "false";
}

export function isTestBypassAllowed() {
  return !isProduction() && process.env.RECAPTCHA_TEST_BYPASS === "true";
}

export function minScore() {
  const n = parseFloat(process.env.RECAPTCHA_MIN_SCORE);
  return Number.isFinite(n) ? n : 0.5;
}

export function allowedHosts() {
  const raw = process.env.RECAPTCHA_ALLOWED_HOSTS;
  const base = raw && raw.trim() ? raw.split(",") : DEFAULT_ALLOWED_HOSTS;
  const hosts = base
    .map((h) => h.trim().toLowerCase().replace(/:\d+$/, ""))
    .filter(Boolean);
  if (!isProduction()) {
    hosts.push("localhost", "127.0.0.1");
  }
  return Array.from(new Set(hosts));
}

/**
 * Validate that the deployment is safe. Returns an error string or null.
 * server.js logs this at boot so misconfiguration is visible immediately.
 */
export function validateRecaptchaConfig() {
  if (isProduction() && isRecaptchaDisabled()) {
    return "RECAPTCHA_ENABLED=false is not allowed in production (auth forms would be unprotected).";
  }
  if (isProduction() && !isRecaptchaConfigured()) {
    return "RECAPTCHA_SECRET is required in production; protected auth routes are fail-closed.";
  }
  return null;
}

function reject(res, status, message, code) {
  return res.status(status).json({ success: false, message, code });
}

function notConfigured(res) {
  return reject(
    res,
    503,
    "Security check is not configured. Please contact support.",
    "RECAPTCHA_NOT_CONFIGURED"
  );
}

/**
 * Express middleware factory. `expectedAction` is the reCAPTCHA v3 action name
 * the frontend used (e.g. "customer_register").
 */
export function verifyRecaptcha(expectedAction) {
  return async function recaptchaGuard(req, res, next) {
    if (isRecaptchaDisabled()) {
      if (isTestBypassAllowed()) return next();
      return notConfigured(res);
    }

    if (!isRecaptchaConfigured()) {
      if (isTestBypassAllowed()) {
        if (!warnedBypass) {
          warnedBypass = true;
          console.warn(
            "[recaptcha] NON-PRODUCTION TEST BYPASS active (RECAPTCHA_TEST_BYPASS=true). Never use in production."
          );
        }
        return next();
      }
      return notConfigured(res);
    }

    const token = req.body && req.body.recaptchaToken;
    if (!token || typeof token !== "string") {
      return reject(
        res,
        400,
        "Security check missing. Please refresh the page and try again.",
        "RECAPTCHA_MISSING"
      );
    }

    try {
      const params = new URLSearchParams();
      params.append("secret", secretKey());
      params.append("response", token);

      const forwarded = String(
        req.headers["cf-connecting-ip"] || req.ip || ""
      ).split(",")[0].trim();
      if (forwarded) params.append("remoteip", forwarded);

      const { data } = await axios.post(VERIFY_URL, params.toString(), {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: 10000,
      });

      if (!data || data.success !== true) {
        return reject(
          res,
          403,
          "Security check failed. Please try again.",
          "RECAPTCHA_FAILED"
        );
      }

      if (expectedAction && data.action !== expectedAction) {
        return reject(
          res,
          403,
          "Security check failed. Please try again.",
          "RECAPTCHA_ACTION_MISMATCH"
        );
      }

      const hosts = allowedHosts();
      const hostname = data.hostname ? String(data.hostname).toLowerCase() : "";
      if (!hostname || (hosts.length && !hosts.includes(hostname))) {
        return reject(
          res,
          403,
          "Security check failed. Please try again.",
          "RECAPTCHA_HOST_MISMATCH"
        );
      }

      // Google always returns a score for v3. A missing score is treated as a
      // configuration/verification failure rather than letting it through.
      if (typeof data.score !== "number" || !Number.isFinite(data.score)) {
        return reject(
          res,
          403,
          "Security check failed. Please try again.",
          "RECAPTCHA_SCORE_MISSING"
        );
      }
      if (data.score < minScore()) {
        return reject(
          res,
          403,
          "Security check failed. Please try again.",
          "RECAPTCHA_LOW_SCORE"
        );
      }

      req.recaptcha = {
        score: data.score,
        action: data.action,
        hostname: data.hostname,
      };
      return next();
    } catch (err) {
      console.error("[recaptcha] Verification error:", err && err.message);
      return reject(
        res,
        503,
        "Security check temporarily unavailable. Please try again shortly.",
        "RECAPTCHA_UNAVAILABLE"
      );
    }
  };
}

export default verifyRecaptcha;
