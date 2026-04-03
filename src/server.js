import dotenv from "dotenv";
import path from "path";

// 🔥 Load environment variables (works locally + Azure)
dotenv.config({
  path: path.resolve(process.cwd(), ".env"),
});

// 🔍 Debug (REMOVE in production)
console.log("ENV CHECK:", {
  MONGO_URI: process.env.MONGO_URI ? "Loaded ✅" : "Missing ❌",
  PORT: process.env.PORT,
  NODE_ENV: process.env.NODE_ENV,
});

import app from "./app.js";
import connectDB from "./config/db.js";

// 🚨 Catch unhandled promise rejections
process.on("unhandledRejection", (err) => {
  console.error("❌ Unhandled Rejection:", err);
});

// 🚨 Catch uncaught exceptions
process.on("uncaughtException", (err) => {
  console.error("❌ Uncaught Exception:", err);
});

const startServer = async () => {
  try {
    // 🔌 Connect DB (NON-BLOCKING — don't delay server start)
    connectDB()
      .then(() => console.log("✅ MongoDB connected"))
      .catch((err) =>
        console.error("❌ MongoDB connection failed:", err.message)
      );

    // ✅ Azure-safe port handling
    const PORT = process.env.PORT || 80;

    const server = app.listen(PORT, "0.0.0.0", () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });

    // ⛔ Optional: detect if server never becomes ready
    const startupTimeout = setTimeout(() => {
      console.error("❌ Server startup timeout");
    }, 200000); // 200s (before Azure kills it at ~230s)

    server.on("listening", () => {
      clearTimeout(startupTimeout);
    });

    // 💤 Graceful shutdown
    const shutdown = (signal) => {
      console.log(`⚡ Received ${signal}. Shutting down...`);
      server.close(() => {
        console.log("💤 Server closed");
        process.exit(0);
      });

      // Force shutdown if stuck
      setTimeout(() => {
        console.error("❌ Forced shutdown");
        process.exit(1);
      }, 10000);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

  } catch (err) {
    console.error("❌ Failed to start server:", err.message);
    process.exit(1);
  }
};

startServer();
