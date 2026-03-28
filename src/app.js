// src/app.js
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

// Routes
import userRoutes from "./routes/userRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import adminAuthRoutes from "./routes/adminAuthRoutes.js";
import orderRoutes from "./routes/orderRoutes.js";
import payfastRoutes from "./routes/payfastRoutes.js";
import refundRoutes from "./routes/refundRoutes.js";

const app = express();

/* =========================================
   🔐 SECURITY MIDDLEWARE
========================================= */

// Secure HTTP headers
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
  })
);

// Global Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 mins
  max: 100, // limit each IP
});
app.use(limiter);

// Stricter rate limiting for sensitive routes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5, // 5 attempts per 15 min
  message: "Too many attempts, please try again later.",
});
app.use("/api/admin/auth/login", authLimiter);
app.use("/api/admin/auth/request-password-reset", authLimiter);

/* =========================================
   🌍 CORS CONFIG
========================================= */
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://www.azaniaShop.com",
    credentials: true,
  })
);

/* =========================================
   📦 BODY PARSING
========================================= */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* =========================================
   🔒 FORCE HTTPS (Production)
========================================= */
if (process.env.NODE_ENV === "production") {
  app.use((req, res, next) => {
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
app.get("/", (req, res) => {
  res.send("🚀 Azania API is running...");
});

app.use("/api/users", userRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/admin/auth", adminAuthRoutes);
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
