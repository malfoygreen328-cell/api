// src/app.js
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import path from "path";
import { fileURLToPath } from "url";

// Routes
import userRoutes from "./routes/userRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import adminAuthRoutes from "./routes/adminAuthRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import orderRoutes from "./routes/orderRoutes.js";
import payfastRoutes from "./routes/payfastRoutes.js";
import refundRoutes from "./routes/refundRoutes.js";

const app = express();

// 🔥 CRITICAL FIX: Trust Azure proxy (FIXES rate-limit + HTTPS issues)
app.set("trust proxy", 1);

/* =========================================
   📁 STATIC FILES (LOGO, IMAGES, ETC.)
========================================= */

// Fix __dirname for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve files from /public
app.use(express.static(path.join(__dirname, "../public")));

/* =========================================
   🔐 SECURITY MIDDLEWARE
========================================= */

// Secure HTTP headers
app.use(
  helmet({
    contentSecurityPolicy: false,
  })
);

// 🌍 Global Rate Limiting (improved)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// 🔐 Stricter rate limiting for sensitive routes
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

/* =========================================
   🌍 CORS CONFIG
========================================= */

app.use(
  cors({
    origin: process.env.FRONTEND_URL || "https://azaniashop.com",
    credentials: true,
  })
);

/* =========================================
   📦 BODY PARSING
========================================= */

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* =========================================
   🔒 FORCE HTTPS (Production - Azure Safe)
========================================= */

if (process.env.NODE_ENV === "production") {
  app.use((req, res, next) => {
    // ✅ Now works correctly because trust proxy is enabled
    if (req.headers["x-forwarded-proto"] !== "https") {
      return res.redirect(`https://${req.headers.host}${req.url}`);
    }
    next();
  });
}

/* =========================================
   📄 LOGGER
========================================= */

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

/* =========================================
   🚀 ROUTES
========================================= */

// Health check
app.get("/", (req, res) => {
  res.send("🚀 Azania API is running...");
});

// Auth Routes
app.use("/api/auth", authRoutes);

// User/Admin Routes
app.use("/api/users", userRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/admin/auth", adminAuthRoutes);

// Other Routes
app.use("/api/orders", orderRoutes);
app.use("/api/payfast", payfastRoutes);
app.use("/api/refunds", refundRoutes);

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
   ⚠️ GLOBAL ERROR HANDLER
========================================= */

app.use((err, req, res, next) => {
  console.error("🔥 ERROR:", err.stack);

  res.status(res.statusCode !== 200 ? res.statusCode : 500).json({
    success: false,
    message: err.message || "Server Error",
    ...(process.env.NODE_ENV !== "production" && { stack: err.stack }),
  });
});

export default app;
