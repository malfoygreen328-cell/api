// src/middleware/errorHandler.js

/**
 * Centralized error handler middleware
 * Usage: app.use(errorHandler) at the end of all routes
 */
const errorHandler = (err, req, res, next) => {
  console.error("Error:", err);

  const statusCode = err.status || 500;

  res.status(statusCode).json({
    success: false,
    message: err.message || "Internal Server Error",
    // Optionally include stack trace in development mode
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
};

export default errorHandler;