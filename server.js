// Load and validate the environment BEFORE any other module is evaluated.
// This import must stay first: ESM evaluates imports in source order.
import "./config/loadEnv.js";

import app from "./app.js";
import connectDB from "./config/db.js";
import mongoose from "mongoose";
import { validateRecaptchaConfig } from "./middleware/recaptchaMiddleware.js";

// Catch unhandled promise rejections
process.on("unhandledRejection", (err) => {
  console.error("Unhandled Rejection:", err?.message || err);
});

// Catch uncaught exceptions
process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err?.message || err);
});

const startServer = async () => {
  try {
    // Ensure production explicitly sets NODE_ENV if not already set
    if (!process.env.NODE_ENV) {
      process.env.NODE_ENV = "development";
    }

    const recaptchaConfigError = validateRecaptchaConfig();
    if (recaptchaConfigError) {
      console.error(`[startup] ${recaptchaConfigError}`);
    }

    // Connect DB BEFORE accepting traffic
    await connectDB();
    console.log("MongoDB connected");

    const PORT = process.env.PORT || 5000;

    const server = app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on port ${PORT} in ${process.env.NODE_ENV} mode`);
    });

    // Graceful shutdown
    const shutdown = (signal) => {
      console.log(`Received ${signal}. Shutting down gracefully...`);
      server.close(async () => {
        try {
          if (mongoose.connection.readyState !== 0) {
            await mongoose.connection.close();
          }
          console.log("Server and DB closed");
          process.exit(0);
        } catch (e) {
          console.error("Error during shutdown:", e?.message || e);
          process.exit(1);
        }
      });

      // Force shutdown if stuck
      setTimeout(() => {
        console.error("Forced shutdown");
        process.exit(1);
      }, 10000);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  } catch (err) {
    console.error("Failed to start server:", err?.message || err);
    process.exit(1);
  }
};

startServer();