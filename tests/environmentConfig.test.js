// tests/environmentConfig.test.js
//
// Configuration regression coverage for staging isolation. These tests do not
// need a database or network. They evaluate the real frontend configuration
// modules and the backend environment validator.

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import vm from "node:vm";

import {
  applyStagingEnvironment,
  getDefaultAllowedOrigins,
  validateEnvironment,
} from "../src/config/environment.js";
import { resolveEmailRecipient } from "../src/utils/emailService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

const read = (relativePath) =>
  readFileSync(path.join(REPO_ROOT, relativePath), "utf8");

const walk = (dir) => {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
};

/* ------------------------------------------------------------------ */
/* Frontend config evaluation                                         */
/* ------------------------------------------------------------------ */

const evaluateStorefrontConfig = ({
  hostname,
  origin,
  azaniaEnv,
  apiOrigin,
  config,
}) => {
  const source = read("azania-store/js/config.js");
  const window = {
    location: { hostname, origin },
    AZANIA_ENV: azaniaEnv,
    AZANIA_API_ORIGIN: apiOrigin,
    AZANIA_CONFIG: config,
  };
  vm.runInNewContext(source, { window, URL, URLSearchParams, console });
  return window.AZANIA_CONFIG;
};

const evaluateReactApiConfig = (relativePath, { hostname, origin, env = {} }) => {
  let source = read(relativePath);
  source = source
    .replace(/export const /g, "const ")
    .replace(/export default [^;]+;/g, "");

  const window = { location: { hostname, origin } };
  const wrapped = `(function () {
    ${source}
    return {
      API_ORIGIN: typeof API_ORIGIN !== "undefined" ? API_ORIGIN : undefined,
      API_BASE_URL: typeof API_BASE_URL !== "undefined" ? API_BASE_URL : undefined,
      API_V1_BASE_URL: typeof API_V1_BASE_URL !== "undefined" ? API_V1_BASE_URL : undefined,
      STOREFRONT_URL: typeof STOREFRONT_URL !== "undefined" ? STOREFRONT_URL : undefined
    };
  })()`;

  return vm.runInNewContext(wrapped, {
    process: { env: { ...env } },
    window,
    URL,
    console,
  });
};

const VENDOR_CONFIG = "azania-vendor/src/api/origin.js";
const ADMIN_CONFIG = "azania-admin/src/config/apiConfig.js";

/* ------------------------------------------------------------------ */
/* Staging validator fixtures                                         */
/* ------------------------------------------------------------------ */

const validStagingEnv = () => ({
  NODE_ENV: "staging",
  STAGING_MONGO_URI:
    "mongodb+srv://staging_user:staging_password@staging-cluster.example.invalid/azania_staging",
  MONGO_URI:
    "mongodb+srv://production_user:production_password@prod-cluster.example.invalid/azania",
  STAGING_JWT_SECRET: "staging-only-jwt-secret-value-that-is-long-enough",
  JWT_SECRET: "production-only-jwt-secret-value-that-is-long-enough",
  FRONTEND_URL: "https://staging.example.invalid",
  API_URL: "https://staging-api.example.invalid",
  CORS_ALLOWED_ORIGINS:
    "https://staging.example.invalid,https://admin-staging.example.invalid",
  RECAPTCHA_SECRET: "staging-recaptcha-secret-placeholder",
  RECAPTCHA_ALLOWED_HOSTS: "staging.example.invalid,admin-staging.example.invalid",
  RECAPTCHA_ENABLED: "true",
  RECAPTCHA_TEST_BYPASS: "false",
  PAYFAST_MODE: "sandbox",
  STAGING_PAYFAST_MERCHANT_ID: "staging-merchant-id",
  STAGING_PAYFAST_MERCHANT_KEY: "staging-merchant-key",
  STAGING_PAYFAST_PASS_PHRASE: "staging-passphrase",
  STAGING_EMAIL_ALLOWLIST: "qa@example.invalid",
});

const errorText = (result) => result.errors.join(" ");

/* ------------------------------------------------------------------ */
/* 1. All three frontends can select a staging API URL                */
/* ------------------------------------------------------------------ */

test("storefront selects the staging API origin from deployment injection", () => {
  const config = evaluateStorefrontConfig({
    hostname: "staging.example.invalid",
    origin: "https://staging.example.invalid",
    apiOrigin: "https://staging-api.example.invalid",
  });
  assert.equal(config.environment, "staging");
  assert.equal(config.apiOrigin, "https://staging-api.example.invalid");
  assert.equal(config.apiBaseUrl, "https://staging-api.example.invalid/api");
});

test("storefront never falls back to the production API on an unknown host", () => {
  const config = evaluateStorefrontConfig({
    hostname: "staging.example.invalid",
    origin: "https://staging.example.invalid",
  });
  assert.equal(config.environment, "staging");
  assert.equal(config.apiOrigin, "https://staging.example.invalid");
  assert.equal(config.apiBaseUrl, "https://staging.example.invalid/api");
  assert.doesNotMatch(config.apiBaseUrl, /api\.azaniashop\.co\.za/);
});

test("storefront ignores an injected production API URL on a staging host", () => {
  const config = evaluateStorefrontConfig({
    hostname: "staging.example.invalid",
    origin: "https://staging.example.invalid",
    azaniaEnv: "production",
    apiOrigin: "https://api.azaniashop.co.za",
    config: {
      apiOrigin: "https://api.azaniashop.co.za",
      apiBaseUrl: "https://api.azaniashop.co.za/api",
    },
  });
  assert.equal(config.environment, "staging");
  assert.equal(config.apiOrigin, "https://staging.example.invalid");
  assert.equal(config.apiBaseUrl, "https://staging.example.invalid/api");
});

test("vendor and admin ignore injected production API URLs on staging hosts", () => {
  for (const [configPath, hostname] of [
    [VENDOR_CONFIG, "vendor-staging.example.invalid"],
    [ADMIN_CONFIG, "admin-staging.example.invalid"],
  ]) {
    const config = evaluateReactApiConfig(configPath, {
      hostname,
      origin: `https://${hostname}`,
      env: {
        REACT_APP_API_URL: "https://api.azaniashop.co.za/api/v1",
        REACT_APP_API_BASE_URL: "https://api.azaniashop.co.za/api",
      },
    });
    assert.equal(config.API_ORIGIN, `https://${hostname}`);
    assert.equal(config.API_V1_BASE_URL, `https://${hostname}/api/v1`);
    assert.equal(config.API_BASE_URL, `https://${hostname}/api`);
  }
});

test("production admin navigation targets the production storefront", () => {
  const config = evaluateReactApiConfig(ADMIN_CONFIG, {
    hostname: "admin.azaniashop.co.za",
    origin: "https://admin.azaniashop.co.za",
  });
  assert.equal(config.STOREFRONT_URL, "https://azaniashop.co.za");
});

test("staging admin navigation uses the explicitly configured staging storefront", () => {
  const config = evaluateReactApiConfig(ADMIN_CONFIG, {
    hostname: "admin-staging.example.invalid",
    origin: "https://admin-staging.example.invalid",
    env: {
      REACT_APP_STOREFRONT_URL: "https://staging.example.invalid",
    },
  });
  assert.equal(config.STOREFRONT_URL, "https://staging.example.invalid");
});

test("staging admin navigation infers the staging storefront and never production", () => {
  for (const hostname of [
    "admin-staging.example.invalid",
    "admin.staging.example.invalid",
  ]) {
    const config = evaluateReactApiConfig(ADMIN_CONFIG, {
      hostname,
      origin: `https://${hostname}`,
    });
    assert.equal(config.STOREFRONT_URL, "https://staging.example.invalid");
    assert.doesNotMatch(config.STOREFRONT_URL, /azaniashop\.co\.za/);
  }
});

test("staging admin ignores a production storefront URL", () => {
  const config = evaluateReactApiConfig(ADMIN_CONFIG, {
    hostname: "admin-staging.example.invalid",
    origin: "https://admin-staging.example.invalid",
    env: { REACT_APP_STOREFRONT_URL: "https://azaniashop.co.za" },
  });
  assert.equal(config.STOREFRONT_URL, "https://staging.example.invalid");
});

test("local admin navigation uses a local storefront default", () => {
  const config = evaluateReactApiConfig(ADMIN_CONFIG, {
    hostname: "localhost",
    origin: "http://localhost:3000",
  });
  assert.equal(config.STOREFRONT_URL, "http://localhost:3000");
});

test("admin navigation components use STOREFRONT_URL instead of hardcoded URLs", () => {
  const sidebar = read("azania-admin/src/components/AdminSidebar.js");
  assert.match(sidebar, /import \{ STOREFRONT_URL \}/);
  assert.match(sidebar, /window\.open\(STOREFRONT_URL/);
  assert.doesNotMatch(sidebar, /https:\/\/azaniashop\.co\.za/);

  const storePage = read("azania-admin/src/pages/AzaniaStore.js");
  assert.match(storePage, /import \{ STOREFRONT_URL \}/);
  assert.match(storePage, /href=\{STOREFRONT_URL\}/);
  assert.doesNotMatch(storePage, /https:\/\/azaniashop\.co\.za/);
});

test("vendor dashboard selects the staging API URL", () => {
  const config = evaluateReactApiConfig(VENDOR_CONFIG, {
    hostname: "vendor-staging.example.invalid",
    origin: "https://vendor-staging.example.invalid",
    env: { REACT_APP_API_ORIGIN: "https://staging-api.example.invalid" },
  });
  assert.equal(config.API_ORIGIN, "https://staging-api.example.invalid");
  assert.equal(config.API_V1_BASE_URL, "https://staging-api.example.invalid/api/v1");
});

test("admin dashboard selects the staging API URL", () => {
  const config = evaluateReactApiConfig(ADMIN_CONFIG, {
    hostname: "admin-staging.example.invalid",
    origin: "https://admin-staging.example.invalid",
    env: { REACT_APP_API_URL: "https://staging-api.example.invalid/api/v1" },
  });
  assert.equal(config.API_ORIGIN, "https://staging-api.example.invalid");
  assert.equal(config.API_V1_BASE_URL, "https://staging-api.example.invalid/api/v1");
});

/* ------------------------------------------------------------------ */
/* 2. No staging build uses a hardcoded production API URL            */
/* ------------------------------------------------------------------ */

test("production API host only appears in the central frontend config modules", () => {
  const allowed = new Set([
    path.join(REPO_ROOT, "azania-store", "js", "config.js"),
    path.join(REPO_ROOT, VENDOR_CONFIG),
    path.join(REPO_ROOT, ADMIN_CONFIG),
  ]);

  const files = [
    ...walk(path.join(REPO_ROOT, "azania-store")).filter(
      (file) => file.endsWith(".html") || file.endsWith(".js")
    ),
    ...walk(path.join(REPO_ROOT, "azania-vendor", "src")),
    ...walk(path.join(REPO_ROOT, "azania-admin", "src")),
  ];

  for (const file of files) {
    if (allowed.has(file)) continue;
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(
      source,
      /api\.azaniashop\.co\.za/,
      `${path.relative(REPO_ROOT, file)} hardcodes the production API host`
    );
  }
});

test("React portals use their central config modules instead of inline URLs", () => {
  const vendorOrigin = read(VENDOR_CONFIG);
  assert.match(vendorOrigin, /REACT_APP_API_ORIGIN/);
  assert.match(vendorOrigin, /REACT_APP_API_URL/);

  const adminConfig = read(ADMIN_CONFIG);
  assert.match(adminConfig, /REACT_APP_API_ORIGIN/);
  assert.match(adminConfig, /REACT_APP_API_URL/);

  assert.match(read("azania-admin/src/api/api.js"), /API_V1_BASE_URL/);
  assert.match(read("azania-vendor/src/api/axios.js"), /API_ORIGIN/);
});

/* ------------------------------------------------------------------ */
/* 3. Production configuration remains unchanged                     */
/* ------------------------------------------------------------------ */

test("storefront production hostname still resolves to the production API", () => {
  const config = evaluateStorefrontConfig({
    hostname: "azaniashop.co.za",
    origin: "https://azaniashop.co.za",
  });
  assert.equal(config.environment, "production");
  assert.equal(config.apiOrigin, "https://api.azaniashop.co.za");
  assert.equal(config.apiBaseUrl, "https://api.azaniashop.co.za/api");
});

test("vendor and admin production hostnames still resolve to production", () => {
  for (const configPath of [VENDOR_CONFIG, ADMIN_CONFIG]) {
    const config = evaluateReactApiConfig(configPath, {
      hostname: "admin.azaniashop.co.za",
      origin: "https://admin.azaniashop.co.za",
    });
    assert.equal(config.API_ORIGIN, "https://api.azaniashop.co.za");
    assert.equal(config.API_V1_BASE_URL, "https://api.azaniashop.co.za/api/v1");
  }
});

test("backend production CORS allowlist is unchanged; staging defaults to empty", () => {
  assert.deepEqual(getDefaultAllowedOrigins({ NODE_ENV: "production" }), [
    "https://azaniashop.co.za",
    "https://www.azaniashop.co.za",
    "https://azaniashop.netlify.app",
    "https://admin.azaniashop.co.za",
    "https://vendor.azaniashop.co.za",
  ]);
  assert.deepEqual(getDefaultAllowedOrigins({ NODE_ENV: "staging" }), []);
});

/* ------------------------------------------------------------------ */
/* 4. Staging cannot start with production database configuration     */
/* ------------------------------------------------------------------ */

test("staging requires a dedicated STAGING_MONGO_URI", () => {
  const env = validStagingEnv();
  delete env.STAGING_MONGO_URI;
  const result = validateEnvironment(env);
  assert.equal(result.ok, false);
  assert.match(errorText(result), /STAGING_MONGO_URI is required/);
});

test("staging rejects reusing the production MONGO_URI value", () => {
  const env = validStagingEnv();
  env.STAGING_MONGO_URI = env.MONGO_URI;
  const result = validateEnvironment(env);
  assert.equal(result.ok, false);
  assert.match(errorText(result), /must not reuse the production MONGO_URI/);
});

test("staging applies the dedicated database URI instead of the generic one", () => {
  const env = validStagingEnv();
  const productionUri = env.MONGO_URI;
  applyStagingEnvironment(env);
  assert.equal(env.MONGO_URI, env.STAGING_MONGO_URI);
  assert.notEqual(env.MONGO_URI, productionUri);
  assert.equal(env.PAYFAST_MODE, "sandbox");
});

/* ------------------------------------------------------------------ */
/* 5. Staging requires a separate JWT secret                          */
/* ------------------------------------------------------------------ */

test("staging requires STAGING_JWT_SECRET", () => {
  const env = validStagingEnv();
  delete env.STAGING_JWT_SECRET;
  const result = validateEnvironment(env);
  assert.equal(result.ok, false);
  assert.match(errorText(result), /STAGING_JWT_SECRET is required/);
});

test("staging rejects reusing JWT_SECRET and enforces minimum length", () => {
  const reused = validStagingEnv();
  reused.STAGING_JWT_SECRET = reused.JWT_SECRET;
  assert.equal(validateEnvironment(reused).ok, false);
  assert.match(errorText(validateEnvironment(reused)), /must not reuse JWT_SECRET/);

  const short = validStagingEnv();
  short.STAGING_JWT_SECRET = "too-short";
  assert.equal(validateEnvironment(short).ok, false);
  assert.match(errorText(validateEnvironment(short)), /at least 32 characters/);
});

test("staging applies only the staging JWT secret", () => {
  const env = validStagingEnv();
  applyStagingEnvironment(env);
  assert.equal(env.JWT_SECRET, env.STAGING_JWT_SECRET);
});

/* ------------------------------------------------------------------ */
/* 6. Staging rejects live PayFast mode                               */
/* ------------------------------------------------------------------ */

test("staging rejects live PayFast mode", () => {
  const env = validStagingEnv();
  env.PAYFAST_MODE = "live";
  const result = validateEnvironment(env);
  assert.equal(result.ok, false);
  assert.match(errorText(result), /PAYFAST_MODE must be 'sandbox'/);
});

test("staging rejects production PayFast credentials", () => {
  const env = validStagingEnv();
  env.PAYFAST_MERCHANT_ID = env.STAGING_PAYFAST_MERCHANT_ID;
  const result = validateEnvironment(env);
  assert.equal(result.ok, false);
  assert.match(errorText(result), /must not reuse production PAYFAST_MERCHANT_ID/);
});

/* ------------------------------------------------------------------ */
/* 7. Staging cannot enable the reCAPTCHA test bypass                 */
/* ------------------------------------------------------------------ */

test("staging rejects RECAPTCHA_TEST_BYPASS=true", () => {
  const env = validStagingEnv();
  env.RECAPTCHA_TEST_BYPASS = "true";
  const result = validateEnvironment(env);
  assert.equal(result.ok, false);
  assert.match(errorText(result), /RECAPTCHA_TEST_BYPASS must not be enabled/);
});

test("staging rejects production hosts in reCAPTCHA allowed hosts", () => {
  const env = validStagingEnv();
  env.RECAPTCHA_ALLOWED_HOSTS = "azaniashop.co.za";
  const result = validateEnvironment(env);
  assert.equal(result.ok, false);
  assert.match(errorText(result), /RECAPTCHA_ALLOWED_HOSTS must not include production/);
});

/* ------------------------------------------------------------------ */
/* 8. Secrets are not exposed in frontend bundles or logs             */
/* ------------------------------------------------------------------ */

test("frontend sources contain no secret assignments", () => {
  const files = [
    ...walk(path.join(REPO_ROOT, "azania-store")).filter(
      (file) => file.endsWith(".html") || file.endsWith(".js")
    ),
    ...walk(path.join(REPO_ROOT, "azania-vendor", "src")),
    ...walk(path.join(REPO_ROOT, "azania-admin", "src")),
  ];

  const secretAssignment =
    /(RECAPTCHA_SECRET|JWT_SECRET|PAYFAST_PASS_PHRASE|PAYFAST_MERCHANT_KEY|MONGO_URI|STAGING_JWT_SECRET|STAGING_MONGO_URI)\s*[:=]\s*["'][^"']+/;

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(
      source,
      secretAssignment,
      `${path.relative(REPO_ROOT, file)} appears to contain a secret value`
    );
  }
});

test("validator errors never echo secret values", () => {
  const env = validStagingEnv();
  const secret = "super-secret-value-that-must-never-be-logged";
  env.STAGING_JWT_SECRET = secret;
  env.JWT_SECRET = secret;
  env.STAGING_MONGO_URI = `mongodb://${secret}@staging.example.invalid/db`;
  env.MONGO_URI = env.STAGING_MONGO_URI;

  const result = validateEnvironment(env);
  assert.equal(result.ok, false);
  assert.equal(errorText(result).includes(secret), false);
});

test("staging email delivery only reaches allowlisted or redirected recipients", () => {
  const env = validStagingEnv();
  assert.equal(resolveEmailRecipient("customer@real-customer.invalid", env), null);
  assert.equal(
    resolveEmailRecipient("qa@example.invalid", env),
    "qa@example.invalid"
  );
  assert.equal(
    resolveEmailRecipient("customer@real-customer.invalid", {
      ...env,
      STAGING_EMAIL_REDIRECT_TO: "qa@example.invalid",
    }),
    "qa@example.invalid"
  );
  assert.equal(
    resolveEmailRecipient("customer@real-customer.invalid", {
      NODE_ENV: "production",
    }),
    "customer@real-customer.invalid"
  );
});

test("a fully configured staging environment passes validation", () => {
  const result = validateEnvironment(validStagingEnv());
  assert.equal(result.ok, true, result.errors.join("; "));
  assert.equal(result.environment, "staging");
});
