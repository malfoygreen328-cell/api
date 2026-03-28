import dotenv from "dotenv";
import path from "path";

// 🔥 Load environment variables (safe for Azure & local)
dotenv.config({
  path: path.resolve(process.cwd(), ".env"),
});

// 🔍 Debug (remove in production later)
console.log("ENV CHECK:", {
  MONGO_URI: process.env.MONGO_URI ? "Loaded ✅" : "Missing ❌",
  PORT: process.env.PORT,
  NODE_ENV: process.env.NODE_ENV,
});

import app from "./app.js";
import connectDB from "./config/db.js";

// Catch unhandled promise rejections (DO NOT crash app immediately)
process.on("unhandledRejection", (err) => {
  console.error("❌ Unhandled Rejection:", err);
});

// Catch uncaught exceptions
process.on("uncaughtException", (err) => {
  console.error("❌ Uncaught Exception:", err);
});

// Start server
const startServer = async () => {
  try {
    // 🔌 Connect DB (NON-BLOCKING — critical for Azure)
    connectDB()
      .then(() => console.log("✅ MongoDB connected"))
      .catch((err) => console.error("❌ MongoDB connection failed:", err.message));

    const PORT = process.env.PORT || 3000; // 🔥 Azure requires dynamic PORT

    const server = app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });

    // Graceful shutdown
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
