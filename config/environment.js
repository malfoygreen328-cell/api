// src/config/environment.js
//
// Environment classification and staging safety rules.
//
// This module is deliberately dependency-free and MUST NOT log or return any
// secret VALUES. It only reports the NAMES of missing or unsafe variables so
// startup failures can be diagnosed without leaking credentials.

export const ENVIRONMENTS = Object.freeze({
  DEVELOPMENT: "development",
  TEST: "test",
  STAGING: "staging",
  PRODUCTION: "production",
});

// Exact production hostnames. Matching is by hostname equality, not substring,
// so a staging host such as staging.azaniashop.co.za is NOT treated as
// production while the real production services still are.
export const PRODUCTION_HOSTNAMES = Object.freeze([
  "azaniashop.co.za",
  "www.azaniashop.co.za",
  "api.azaniashop.co.za",
  "admin.azaniashop.co.za",
  "vendor.azaniashop.co.za",
  "azaniashop.netlify.app",
]);

export const PRODUCTION_ORIGINS = Object.freeze([
  "https://azaniashop.co.za",
  "https://www.azaniashop.co.za",
  "https://azaniashop.netlify.app",
  "https://admin.azaniashop.co.za",
  "https://vendor.azaniashop.co.za",
]);

const TRUTHY = new Set(["1", "true", "yes", "on"]);

export const getNodeEnv = (env = process.env) =>
  String(env.NODE_ENV || ENVIRONMENTS.DEVELOPMENT).trim().toLowerCase();

export const isStaging = (env = process.env) =>
  getNodeEnv(env) === ENVIRONMENTS.STAGING;

export const isProduction = (env = process.env) =>
  getNodeEnv(env) === ENVIRONMENTS.PRODUCTION;

export const isTruthy = (value) =>
  TRUTHY.has(String(value === undefined || value === null ? "" : value).trim().toLowerCase());

export const parseList = (value) =>
  String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

export const hostnameOf = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    // Accept bare hostnames too (e.g. RECAPTCHA_ALLOWED_HOSTS entries).
    return raw
      .replace(/^https?:\/\//i, "")
      .split("/")[0]
      .split(":")[0]
      .toLowerCase();
  }
};

export const isProductionHostname = (hostname) =>
  PRODUCTION_HOSTNAMES.includes(String(hostname || "").toLowerCase());

export const urlUsesProductionHost = (value) => {
  const host = hostnameOf(value);
  return Boolean(host) && isProductionHostname(host);
};

/**
 * Built-in first-party origins. Production behaviour is unchanged. Staging gets
 * an empty default so it can never inherit production CORS allowances; staging
 * origins must be supplied explicitly through FRONTEND_URL/CORS_ALLOWED_ORIGINS.
 */
export const getDefaultAllowedOrigins = (env = process.env) =>
  isStaging(env) ? [] : [...PRODUCTION_ORIGINS];

const hasValue = (value) => String(value || "").trim() !== "";

/**
 * Validate the current environment. Only staging has hard requirements: this
 * keeps production and local development behaviour untouched while making it
 * impossible for a misconfigured staging process to silently use production
 * resources.
 *
 * @returns {{ ok: boolean, environment: string, errors: string[], warnings: string[] }}
 */
export function validateEnvironment(env = process.env) {
  const environment = getNodeEnv(env);
  const errors = [];
  const warnings = [];

  if (environment !== ENVIRONMENTS.STAGING) {
    return { ok: true, environment, errors, warnings };
  }

  // --- Database: staging must use an explicitly dedicated URI ----------------
  if (!hasValue(env.STAGING_MONGO_URI)) {
    errors.push(
      "STAGING_MONGO_URI is required in staging; the backend will not fall back to MONGO_URI."
    );
  }
  if (
    hasValue(env.STAGING_MONGO_URI) &&
    hasValue(env.MONGO_URI) &&
    String(env.STAGING_MONGO_URI).trim() === String(env.MONGO_URI).trim()
  ) {
    errors.push(
      "STAGING_MONGO_URI must not reuse the production MONGO_URI value."
    );
  }
  if (
    hasValue(env.STAGING_MONGO_URI) &&
    hasValue(env.PRODUCTION_MONGO_URI) &&
    String(env.STAGING_MONGO_URI).trim() === String(env.PRODUCTION_MONGO_URI).trim()
  ) {
    errors.push(
      "STAGING_MONGO_URI must not reuse PRODUCTION_MONGO_URI."
    );
  }

  // --- JWT: staging must use a distinct secret -------------------------------
  if (!hasValue(env.STAGING_JWT_SECRET)) {
    errors.push(
      "STAGING_JWT_SECRET is required in staging; the backend will not fall back to JWT_SECRET."
    );
  } else {
    const stagingSecret = String(env.STAGING_JWT_SECRET);
    if (stagingSecret.trim().length < 32) {
      errors.push("STAGING_JWT_SECRET must be at least 32 characters.");
    }
    for (const name of ["JWT_SECRET", "PRODUCTION_JWT_SECRET"]) {
      if (hasValue(env[name]) && String(env[name]) === stagingSecret) {
        errors.push(`STAGING_JWT_SECRET must not reuse ${name}.`);
      }
    }
  }

  // --- URLs / CORS: staging must not point at production ---------------------
  for (const name of ["FRONTEND_URL", "API_URL"]) {
    if (!hasValue(env[name])) {
      errors.push(`${name} is required in staging.`);
    } else if (urlUsesProductionHost(env[name])) {
      errors.push(`${name} must not point at a production host in staging.`);
    }
  }

  const corsOrigins = parseList(env.CORS_ALLOWED_ORIGINS);
  if (corsOrigins.length === 0) {
    errors.push("CORS_ALLOWED_ORIGINS is required in staging.");
  } else if (corsOrigins.some(urlUsesProductionHost)) {
    errors.push("CORS_ALLOWED_ORIGINS must not include production hosts in staging.");
  }

  // --- reCAPTCHA: real credentials only, never the test bypass ---------------
  if (!hasValue(env.RECAPTCHA_SECRET)) {
    errors.push("RECAPTCHA_SECRET is required in staging (test bypass is not allowed).");
  }
  if (isTruthy(env.RECAPTCHA_TEST_BYPASS)) {
    errors.push("RECAPTCHA_TEST_BYPASS must not be enabled in staging.");
  }
  if (String(env.RECAPTCHA_ENABLED || "").trim().toLowerCase() === "false") {
    errors.push("RECAPTCHA_ENABLED=false is not allowed in staging.");
  }
  const recaptchaHosts = parseList(env.RECAPTCHA_ALLOWED_HOSTS);
  if (recaptchaHosts.length === 0) {
    errors.push("RECAPTCHA_ALLOWED_HOSTS is required in staging.");
  } else if (recaptchaHosts.some((host) => isProductionHostname(hostnameOf(host)))) {
    errors.push("RECAPTCHA_ALLOWED_HOSTS must not include production hosts in staging.");
  }

  // --- PayFast: sandbox only, with staging-scoped credentials ----------------
  const payfastMode = String(env.PAYFAST_MODE || "").trim().toLowerCase();
  if (payfastMode !== "sandbox") {
    errors.push("PAYFAST_MODE must be 'sandbox' in staging.");
  }
  const stagingPayfast = {
    STAGING_PAYFAST_MERCHANT_ID: "PAYFAST_MERCHANT_ID",
    STAGING_PAYFAST_MERCHANT_KEY: "PAYFAST_MERCHANT_KEY",
    STAGING_PAYFAST_PASS_PHRASE: "PAYFAST_PASS_PHRASE",
  };
  for (const [stagingName, productionName] of Object.entries(stagingPayfast)) {
    if (!hasValue(env[stagingName])) {
      errors.push(`${stagingName} is required in staging.`);
      continue;
    }
    if (
      hasValue(env[productionName]) &&
      String(env[stagingName]).trim() === String(env[productionName]).trim()
    ) {
      errors.push(`${stagingName} must not reuse production ${productionName}.`);
    }
  }

  // --- Email: staging must never deliver to real customers ------------------
  const allowlist = parseList(env.STAGING_EMAIL_ALLOWLIST);
  if (allowlist.length === 0 && !hasValue(env.STAGING_EMAIL_REDIRECT_TO)) {
    errors.push(
      "STAGING_EMAIL_ALLOWLIST or STAGING_EMAIL_REDIRECT_TO is required in staging."
    );
  }

  return { ok: errors.length === 0, environment, errors, warnings };
}

/**
 * Map staging-scoped variables onto the names the application already reads.
 * This only runs after validation has passed, so an invalid staging process
 * exits before any production value could be adopted.
 */
export function applyStagingEnvironment(env = process.env) {
  if (!isStaging(env)) return env;

  if (hasValue(env.STAGING_MONGO_URI)) env.MONGO_URI = env.STAGING_MONGO_URI;
  if (hasValue(env.STAGING_JWT_SECRET)) env.JWT_SECRET = env.STAGING_JWT_SECRET;

  if (hasValue(env.STAGING_PAYFAST_MERCHANT_ID)) {
    env.PAYFAST_MERCHANT_ID = env.STAGING_PAYFAST_MERCHANT_ID;
  }
  if (hasValue(env.STAGING_PAYFAST_MERCHANT_KEY)) {
    env.PAYFAST_MERCHANT_KEY = env.STAGING_PAYFAST_MERCHANT_KEY;
  }
  if (hasValue(env.STAGING_PAYFAST_PASS_PHRASE)) {
    env.PAYFAST_PASS_PHRASE = env.STAGING_PAYFAST_PASS_PHRASE;
  }

  env.PAYFAST_MODE = "sandbox";
  return env;
}

export default {
  ENVIRONMENTS,
  PRODUCTION_HOSTNAMES,
  PRODUCTION_ORIGINS,
  getNodeEnv,
  isStaging,
  isProduction,
  isTruthy,
  parseList,
  hostnameOf,
  isProductionHostname,
  urlUsesProductionHost,
  getDefaultAllowedOrigins,
  validateEnvironment,
  applyStagingEnvironment,
};
