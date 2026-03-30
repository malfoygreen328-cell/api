import dotenv from "dotenv";
import path from "path";

// ✅ Load .env ONLY in local development
if (process.env.NODE_ENV !== "production") {
  dotenv.config({
    path: path.resolve(process.cwd(), ".env"),
  });
}

// 🔍 Debug (remove later)
console.log("ENV CHECK:", {
  MONGO_URI: process.env.MONGO_URI ? "Loaded ✅" : "Missing ❌",
  PORT: process.env.PORT,
  NODE_ENV: process.env.NODE_ENV,
});

import app from "./app.js";
import connectDB from "./config/db.js";

// Handle unhandled promise rejections
process.on("unhandledRejection", (err) => {
  console.error("❌ Unhandled Rejection:", err);
});

// Handle uncaught exceptions
process.on("uncaughtException", (err) => {
  console.error("❌ Uncaught Exception:", err);
});

const startServer = async () => {
  try {
    // 🔌 Connect DB (non-blocking)
    connectDB()
      .then(() => console.log("✅ MongoDB connected"))
      .catch((err) =>
        console.error("❌ MongoDB connection failed:", err.message)
      );

    // ✅ Use Azure-provided PORT
    const PORT = process.env.PORT || 8080;

    const server = app.listen(PORT, "0.0.0.0", () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });

    // ✅ Graceful shutdown
    const shutdown = () => {
      console.log("⚡ Shutting down server...");
      server.close(() => {
        console.log("💤 Server closed");
        process.exit(0);
      });
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  } catch (err) {
    console.error("❌ Failed to start server:", err.message);
    process.exit(1);
  }
};

startServer();
