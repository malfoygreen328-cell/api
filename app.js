// src/app.js
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import mongoSanitize from "express-mongo-sanitize";
import xss from "xss-clean";
import path from "path";
import querystring from "querystring";
import { fileURLToPath } from "url";
import { getDefaultAllowedOrigins, isStaging } from "./config/environment.js";
import {
  assertStagingBuildDir,
  getAdminBuildDir,
  getVendorBuildDir,
} from "./config/buildPaths.js";

// Routes
import userRoutes from "./routes/userRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import adminAuthRoutes from "./routes/adminAuthRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import orderRoutes from "./routes/orderRoutes.js";
import payfastRoutes from "./routes/payfastRoutes.js";
import refundRoutes from "./routes/refundRoutes.js";
import productRoutes from "./routes/productRoutes.js"; // ✅ ADD THIS LINE
import logisticsRoutes from './routes/logisticsRoutes.js';
import testRoutes from "./routes/testRoutes.js";
import enhancedAnalyticsRoutes from "./routes/enhancedAnalyticsRoutes.js";
import productRelationshipRoutes from "./routes/productRelationshipRoutes.js";
import collectionRoutes from "./routes/collectionRoutes.js";
import wishlistRoutes from "./routes/wishlistRoutes.js";
import analyticsRoutes from "./routes/analyticsRoutes.js";
import recommendationRoutes from "./routes/recommendationRoutes.js";
import commissionRoutes from "./routes/commissionRoutes.js";
import vendorRoutes from "./routes/vendorRoutes.js";
import vendorAuthRoutes from "./routes/vendorAuthRoutes.js";
import vendorFinancialRoutes from "./routes/vendorFinancialRoutes.js";
import storeRoutes from "./routes/storeRoutes.js";
import adRoutes from "./routes/adRoutes.js";
import auditRoutes from "./routes/auditRoutes.js";
import brandRoutes from "./routes/brandRoutes.js";
import adminDiscoveryRoutes from "./routes/adminDiscoveryRoutes.js";
import vendorBrandRoutes from "./routes/vendorBrandRoutes.js";

const app = express();

// ðŸ”¥ CRITICAL FIX: Trust Azure proxy (FIXES rate-limit + HTTPS issues)
app.set("trust proxy", 1);

/* =========================================
   ðŸ“ STATIC FILES (LOGO, IMAGES, ETC.)
========================================= */

// Fix __dirname for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../..");

/* =========================================
   🌐 STATIC SITES BEHIND THE CLOUDFLARE TUNNEL
   The tunnel sends every hostname to this app;
   the Host header decides what gets served.
========================================= */
// Hostnames are production defaults. A staging deployment can override them
// with STORE_HOSTS / ADMIN_HOSTS / VENDOR_HOSTS without editing this file.
const hostsFromEnv = (name, fallback) => {
  const configured = String(process.env[name] || "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  return configured.length ? configured : fallback;
};

const adminBuildDir = getAdminBuildDir();
const vendorBuildDir = getVendorBuildDir();

// Fail closed in staging: only a directory carrying the staging build marker
// may be served. This prevents a production build/ (or a stale copy) from
// being presented as a staging deployment.
if (isStaging(process.env)) {
  assertStagingBuildDir({
    envName: "ADMIN_BUILD_DIR",
    appDir: "azania-admin",
    dir: adminBuildDir,
  });
  assertStagingBuildDir({
    envName: "VENDOR_BUILD_DIR",
    appDir: "azania-vendor",
    dir: vendorBuildDir,
  });
}

const SITES = [
  {
    name: "store",
    hosts: hostsFromEnv("STORE_HOSTS", ["azaniashop.co.za", "www.azaniashop.co.za"]),
    dir: path.join(REPO_ROOT, "azania-store"),
    spa: false,
  },
  {
    name: "admin",
    hosts: hostsFromEnv("ADMIN_HOSTS", ["admin.azaniashop.co.za"]),
    dir: adminBuildDir,
    spa: true,
  },
  {
    name: "vendor",
    hosts: hostsFromEnv("VENDOR_HOSTS", ["vendor.azaniashop.co.za"]),
    dir: vendorBuildDir,
    spa: true,
  },
];

const hostOf = (req) =>
  String((req.headers && req.headers.host) || "")
    .split(":")[0]
    .toLowerCase();

const siteFor = (req) => SITES.find((s) => s.hosts.includes(hostOf(req)));

/* =========================================
   HTTPS ENFORCEMENT
   TLS terminates at Cloudflare; cloudflared tells us the original scheme in
   X-Forwarded-Proto. Cloudflare's "Always Use HTTPS" already does this at the
   edge - this is the origin-side belt-and-braces so a misconfigured or
   bypassed proxy can never serve the site over plain HTTP.
   - header present and not "https"  -> redirect (proxy saw plain HTTP)
   - header absent in production     -> redirect (client bypassed the tunnel)
   - header absent in dev/test       -> let it through (local development)
========================================= */
app.use((req, res, next) => {
  const proto = String(req.headers["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  if (proto === "https") return next();
  if (proto !== "" || process.env.NODE_ENV === "production") {
    return res.redirect(301, `https://${hostOf(req)}${req.originalUrl}`);
  }
  next();
});

// Real client IP behind the tunnel. Cloudflare sets CF-Connecting-IP;
// fall back to Express's resolved proxy address.
const clientIp = (req) =>
  String(
    (req.headers && req.headers["cf-connecting-ip"]) ||
      req.ip ||
      (req.socket && req.socket.remoteAddress) ||
      "unknown"
  ).trim();

// Legacy Firebase-era assets (/public). Kept off the site hostnames so the
// storefront/portal index.html always wins, and index:false so "/" falls
// through to the health check below instead of a stale welcome page.
const legacyPublic = express.static(path.join(__dirname, "../public"), {
  index: false,
  dotfiles: "deny",
});
app.use((req, res, next) => {
  if (siteFor(req)) return next();
  legacyPublic(req, res, next);
});

// Product images live in /uploads and are public, but ONLY image files.
// Vendor KYC documents (IDs, proof of address, CIPC docs) are sensitive and
// must never be served publicly here - they are streamed via the protected
// /api/admin/vendor/:id/document/:field endpoint instead.
const IMAGE_EXT = /\.(jpe?g|png|webp|gif|avif|bmp)$/i;

app.use((req, res, next) => {
  if (!req.path.startsWith("/uploads/")) return next();
  if (!IMAGE_EXT.test(req.path)) {
    return next(); // fall through to 404 - not publicly served
  }
  next();
});
app.use(
  "/uploads",
  express.static(path.resolve(process.cwd(), "uploads"), {
    fallthrough: true,
    index: false,
    dotfiles: "deny",
    setHeaders: (res, filePath) => {
      res.setHeader("X-Content-Type-Options", "nosniff");
    },
  })
);

/* =========================================
   ðŸ” SECURITY MIDDLEWARE
========================================= */

// Secure HTTP headers
app.use(
  helmet({
    contentSecurityPolicy: false,
  })
);

// Restrictive CSP + frame protection for API responses only
// (the static storefront / React portals keep the relaxed global CSP)
app.use((req, res, next) => {
  if (req.path.startsWith("/api/")) {
    return helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'none'"],
          scriptSrc: ["'none'"],
          styleSrc: ["'none'"],
          imgSrc: ["'none'"],
          connectSrc: ["'none'"],
          fontSrc: ["'none'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: false,
    })(req, res, next);
  }
  next();
});

// ðŸŒ Global Rate Limiting (improved)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
});
// Only API traffic is rate limited. Static storefront assets must never
// consume a visitor's API budget or be served a 429 page.
app.use("/api", limiter);

// ðŸ” Stricter rate limiting for sensitive routes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many attempts, please try again later.",
  },
});

// Apply auth limiter
app.use("/api/admin/auth/login", authLimiter);
app.use("/api/admin/auth/request-password-reset", authLimiter);
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/forgot-password", authLimiter);
// v1 aliases used by the React portals
app.use("/api/v1/admin/auth/login", authLimiter);
app.use("/api/v1/admin/auth/request-password-reset", authLimiter);
app.use("/api/v1/auth/login", authLimiter);
app.use("/api/v1/auth/forgot-password", authLimiter);

// Sensitive-route limiter (registration, verification, order/payment creation)
const sensitiveLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many requests, please try again later.",
  },
});
app.use("/api/auth/register", sensitiveLimiter);
app.use("/api/auth/verify-email", sensitiveLimiter);
app.use("/api/auth/resend-verification", sensitiveLimiter);
app.use("/api/auth/register-vendor", sensitiveLimiter);
app.use("/api/users", sensitiveLimiter);
app.use("/api/orders", sensitiveLimiter);
app.use("/api/payfast/create-payment", sensitiveLimiter);
// v1 aliases
app.use("/api/v1/auth/register", sensitiveLimiter);
app.use("/api/v1/auth/verify-email", sensitiveLimiter);
app.use("/api/v1/auth/resend-verification", sensitiveLimiter);
app.use("/api/v1/auth/register-vendor", sensitiveLimiter);
app.use("/api/v1/users", sensitiveLimiter);
app.use("/api/v1/orders", sensitiveLimiter);

/* =========================================
   ðŸŒ CORS CONFIG
========================================= */

// Built-in first-party origins (storefront + dashboards). Production keeps its
// exact existing list. Staging intentionally starts empty so it can never
// inherit production CORS allowances; staging origins come from FRONTEND_URL /
// CORS_ALLOWED_ORIGINS only.
const DEFAULT_ALLOWED_ORIGINS = getDefaultAllowedOrigins();

const allowedOrigins = Array.from(
  new Set(
    [
      ...DEFAULT_ALLOWED_ORIGINS,
      ...(process.env.FRONTEND_URL ? process.env.FRONTEND_URL.split(",") : []),
      ...(process.env.CORS_ALLOWED_ORIGINS
        ? process.env.CORS_ALLOWED_ORIGINS.split(",")
        : []),
    ]
      .map((o) => String(o).trim().replace(/\/$/, ""))
      .filter(Boolean)
  )
);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      if (
        process.env.NODE_ENV !== "production" &&
        /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
      ) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  })
);

/* =========================================
   BODY PARSING
========================================= */

// Signature verification (PayFast IPN, BobGo webhook) needs the exact raw
// bytes, so these two routes are buffered as raw text BEFORE any JSON /
// urlencoded parser runs. express.raw sets req._body, which makes the global
// parsers below (and the route-level parsers) skip the request.
const captureWebhookRaw = (parseFn) => [
  express.raw({ type: "*/*", limit: "256kb" }),
  (req, res, next) => {
    if (Buffer.isBuffer(req.body)) {
      req.rawBody = req.body.toString("utf8");
      req.body = parseFn(req.rawBody);
    }
    next();
  },
];

app.use(
  "/api/payfast/notify",
  ...captureWebhookRaw((raw) => querystring.parse(raw))
);
app.use(
  "/api/logistics/webhooks/bobgo",
  ...captureWebhookRaw((raw) => {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// NoSQL injection & malicious-character sanitisation (applied to parsed bodies)
app.use(mongoSanitize());
app.use(xss());

/* =========================================
   ðŸª DEPENDENCY-FREE COOKIE PARSER
   Populates req.cookies so the httpOnly
   azania_token cookie set on login is
   readable (no cookie-parser dep needed).
========================================= */
app.use((req, res, next) => {
  const header = req.headers.cookie;
  req.cookies = {};
  if (header) {
    header.split(";").forEach((pair) => {
      const idx = pair.indexOf("=");
      if (idx > -1) {
        const key = pair.slice(0, idx).trim();
        const value = pair.slice(idx + 1).trim();
        try {
          req.cookies[key] = decodeURIComponent(value);
        } catch {
          req.cookies[key] = value;
        }
      }
    });
  }
  next();
});

/* =========================================
   LOGGER
========================================= */

app.use((req, res, next) => {
  // Redact credentials/tokens that may appear in the URL (email verify links,
  // password resets, PayFast callbacks) before writing to the log.
  const sensitive = /([?&](?:token|signature|pf_payment_id|m_payment_id|reset_token|password|api_key|secret|code)=)[^&\s]+/gi;
  const cleanUrl = req.originalUrl.replace(sensitive, (match, prefix) => `${prefix}[REDACTED]`);
  console.log(`[${new Date().toISOString()}] ${req.method} ${cleanUrl}`);
  next();
});

/* =========================================
   ðŸš€ ROUTES
========================================= */

// Health check (site hostnames get the storefront instead)
app.get("/", (req, res, next) => {
  if (siteFor(req)) return next();
  res.send("🚀 Azania API is running...");
});

// Test endpoint for debugging - never exposed in production
app.get("/api/test", (req, res, next) => {
  if (process.env.NODE_ENV === "production") return next();
  res.json({ 
    success: true, 
    message: "Backend is connected!",
    endpoints: {
      products: "/api/products"
    }
  });
});

// Auth Routes
app.use("/api/auth", authRoutes);

// Admin auth (login / password reset) must be mounted BEFORE /api/admin so its
// public routes are not shadowed by the admin protect-wall in adminRoutes.
app.use("/api/admin/auth", adminAuthRoutes);
// Brand discovery governance. Mounted before /api/admin so its explicit
// protect/role guards run and are not shadowed by the broad admin router.
app.use("/api/admin/discovery", adminDiscoveryRoutes);

// User/Admin Routes
app.use("/api/users", userRoutes);
app.use("/api/admin", adminRoutes);

// Public brand discovery + customer follow endpoints
app.use("/api/brands", brandRoutes);

// Vendor brand profile. MUST be mounted before the broad /api/vendor router so
// PUT /api/vendor/brand is not captured by PUT /api/vendor/:id.
app.use("/api/vendor/brand", vendorBrandRoutes);

// Vendors (applications, approve/decline, unpaid)
app.use("/api/vendor", vendorAuthRoutes);
app.use("/api/vendor", vendorRoutes);

// Stores (admin "Brands" management + public storefront reads)
app.use("/api/stores", storeRoutes);

// Ads
app.use("/api/ads", adRoutes);

// Other Routes
app.use("/api/orders", orderRoutes);
app.use("/api/payfast", payfastRoutes);
app.use("/api/refunds", refundRoutes);

// ✅ PRODUCT ROUTES - Mount at /api/products (matches your route file)
app.use("/api/products", productRoutes);

// Cross-vendor marketplace discovery & collections
app.use("/api/collections", collectionRoutes);
app.use("/api/product-relationships", productRelationshipRoutes);
app.use("/api/recommendations", recommendationRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/analytics/enhanced", enhancedAnalyticsRoutes);

// Wishlist
app.use("/api/wishlist", wishlistRoutes);

// Logistics Routes
app.use("/api/logistics", logisticsRoutes);

// Commission (public read-only config for webshops and dashboards)
app.use("/api/commission", commissionRoutes);

// V1 aliases (matches spec /api/v1/* while keeping existing /api/* intact).
// The React portals (admin/vendor) call the API through /api/v1/*.
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/admin/auth", adminAuthRoutes);
app.use("/api/v1/admin/discovery", adminDiscoveryRoutes);
app.use("/api/v1/admin", adminRoutes);
app.use("/api/v1/admin/audit-logs", auditRoutes);
app.use("/api/v1/brands", brandRoutes);
app.use("/api/v1/vendor/brand", vendorBrandRoutes);
app.use("/api/v1/vendor", vendorAuthRoutes);
app.use("/api/v1/vendor", vendorRoutes);
app.use("/api/v1/vendor", vendorFinancialRoutes);
app.use("/api/v1/stores", storeRoutes);
app.use("/api/v1/ads", adRoutes);
app.use("/api/v1/products", productRoutes);
app.use("/api/v1/orders", orderRoutes);
app.use("/api/v1/commission", commissionRoutes);
app.use("/api/v1/collections", collectionRoutes);
app.use("/api/v1/product-relationships", productRelationshipRoutes);
app.use("/api/v1/recommendations", recommendationRoutes);
app.use("/api/v1/analytics", analyticsRoutes);
app.use("/api/v1/analytics/enhanced", enhancedAnalyticsRoutes);
app.use("/api/v1/wishlist", wishlistRoutes);
app.use("/api/v1/payfast", payfastRoutes);
app.use("/api/v1/refunds", refundRoutes);
app.use("/api/v1/logistics", logisticsRoutes);

/* =========================================
   🌐 FRONTENDS (served by hostname)
   Storefront on the apex/www, React portals on
   their subdomains. Reached via next() from the
   health check above, or by falling past /api/*.
========================================= */

SITES.forEach((site) => {
  const serve = express.static(site.dir, {
    index: "index.html",
    fallthrough: true,
    dotfiles: "deny",
    maxAge: process.env.NODE_ENV === "production" ? "1h" : 0,
  });

  app.use((req, res, next) => {
    if (!site.hosts.includes(hostOf(req))) return next();
    serve(req, res, next);
  });
});

// SPA fallback — React Router needs index.html for every GET
app.use((req, res, next) => {
  const site = siteFor(req);
  if (!site || !site.spa) return next();
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  if (req.path.startsWith("/api/") || req.path.startsWith("/uploads/")) {
    return next();
  }
  res.sendFile(path.join(site.dir, "index.html"));
});

/* =========================================
   ❌ 404 HANDLER
========================================= */

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});

/* =========================================
   âš ï¸ GLOBAL ERROR HANDLER
========================================= */

app.use((err, req, res, next) => {
  const isProd = process.env.NODE_ENV === "production";
  // Never log full stacks in production (may contain request data); log them in dev only.
  if (isProd) {
    console.error("ERROR:", err.message || "Server Error");
  } else {
    console.error("ERROR:", err.stack || err.message);
  }

  const status = err.status >= 400 ? err.status : res.statusCode >= 400 ? res.statusCode : 500;

  // Client errors (4xx, set explicitly by handlers) still surface their message;
  // 5xx are generic to avoid leaking internals.
  const exposeMessage = !isProd || (status && status < 500);

  res.status(status).json({
    success: false,
    message: exposeMessage ? err.message || "Server Error" : "Internal Server Error",
    ...(!isProd && { stack: err.stack }),
  });
});

export default app;








