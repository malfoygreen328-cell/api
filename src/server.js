import dotenv from "dotenv";
import path from "path";

// 🔥 Force correct .env loading (bulletproof)
dotenv.config({
  path: path.resolve(process.cwd(), ".env"),
});

// 🔍 Debug (remove after it works)
console.log("ENV CHECK:", {
  MONGO_URI: process.env.MONGO_URI ? "Loaded ✅" : "Missing ❌",
  PORT: process.env.PORT,
});

import app from "./app.js";
import connectDB from "./config/db.js";

// Catch unhandled promise rejections
process.on("unhandledRejection", (err) => {
  console.error("❌ Unhandled Rejection:", err);
  process.exit(1);
});

// Start server
const startServer = async () => {
  try {
    // 🔌 Connect DB first
    await connectDB();

    const PORT = process.env.PORT || 5000;

    const server = app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });

    // Graceful shutdown
    const shutdown = () => {
      console.log("⚡ Shutting down server...");
      server.close(() => process.exit(0));
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

  } catch (err) {
    console.error("❌ Failed to start server:", err.message);
    process.exit(1);
  }
};

startServer();