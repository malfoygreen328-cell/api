// src/routes/passwordRoutes.js
import express from "express";
import crypto from "crypto";
import User from "../models/User.js";
import Admin from "../models/Admin.js";

const router = express.Router();

/**
 * FORGOT PASSWORD - User
 * Generate reset token and send reset link
 */
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    const normalizedEmail = email.toLowerCase();

    // Check both User and Admin collections
    let user = await User.findOne({ email: normalizedEmail });
    let isAdmin = false;

    if (!user) {
      user = await Admin.findOne({ email: normalizedEmail });
      if (user) isAdmin = true;
    }

    // Prevent email enumeration - always return same message
    if (!user) {
      return res.status(200).json({
        success: true,
        message: "If an account exists, a password reset link has been sent."
      });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString("hex");
    
    // Hash token before storing (for security)
    const hashedToken = crypto
      .createHash("sha256")
      .update(resetToken)
      .digest("hex");

    user.resetPasswordToken = hashedToken;
    user.resetPasswordExpire = Date.now() + 3600000; // 1 hour

    await user.save();

    // Create reset URL
    const resetURL = isAdmin 
      ? `https://admin.azaniashop.com/reset-password/${resetToken}`
      : `https://azaniashop.com/reset-password/${resetToken}`;

    // Log the reset link (in production, send via email)
    console.log(`🔐 Reset password link for ${email}:`, resetURL);
    console.log(`⚠️ This link expires in 1 hour`);

    // TODO: Send email with reset link
    // await sendEmail({
    //   to: user.email,
    //   subject: "Password Reset Request",
    //   html: `<p>Click <a href="${resetURL}">here</a> to reset your password. Link expires in 1 hour.</p>`
    // });

    res.status(200).json({
      success: true,
      message: "If an account exists, a password reset link has been sent.",
      // Only include resetURL in development
      ...(process.env.NODE_ENV === "development" && { resetURL })
    });
  } catch (error) {
    console.error("Forgot password error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message
    });
  }
});

/**
 * RESET PASSWORD - User/Admin
 */
router.post("/reset-password/:token", async (req, res) => {
  try {
    const { token } = req.params;
    const { password } = req.body;

    // Validate password
    if (!password || password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters"
      });
    }

    // Hash the received token to compare with stored hash
    const hashedToken = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");

    // Check both User and Admin collections
    let user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpire: { $gt: Date.now() }
    }).select("+password"); // Include password field

    let isAdmin = false;

    if (!user) {
      user = await Admin.findOne({
        resetPasswordToken: hashedToken,
        resetPasswordExpire: { $gt: Date.now() }
      }).select("+password");
      if (user) isAdmin = true;
    }

    if (!user) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired reset token. Please request a new one."
      });
    }

    // Set new password (model's pre-save hook will hash it)
    user.password = password;
    
    // Clear reset token fields
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;

    await user.save();

    res.status(200).json({
      success: true,
      message: "Password has been reset successfully. You can now login with your new password."
    });
  } catch (error) {
    console.error("Reset password error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message
    });
  }
});

/**
 * VERIFY RESET TOKEN - Check if token is valid
 */
router.get("/verify-reset-token/:token", async (req, res) => {
  try {
    const { token } = req.params;

    const hashedToken = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");

    // Check User collection
    let user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpire: { $gt: Date.now() }
    });

    // Check Admin collection if not found in User
    if (!user) {
      user = await Admin.findOne({
        resetPasswordToken: hashedToken,
        resetPasswordExpire: { $gt: Date.now() }
      });
    }

    if (!user) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired token"
      });
    }

    res.status(200).json({
      success: true,
      message: "Token is valid",
      email: user.email
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message
    });
  }
});

/**
 * CHANGE PASSWORD - Authenticated user
 */
router.put("/change-password", async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user?.id; // From auth middleware
    const isAdmin = req.user?.role === "admin" || req.user?.role === "superadmin";

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Not authenticated"
      });
    }

    // Validate new password
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: "New password must be at least 6 characters"
      });
    }

    // Get user with password field
    let user;
    if (isAdmin) {
      user = await Admin.findById(userId).select("+password");
    } else {
      user = await User.findById(userId).select("+password");
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    // Verify current password
    const isMatch = await user.matchPassword(currentPassword);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Current password is incorrect"
      });
    }

    // Set new password (model's pre-save hook will hash it)
    user.password = newPassword;
    await user.save();

    res.status(200).json({
      success: true,
      message: "Password changed successfully"
    });
  } catch (error) {
    console.error("Change password error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message
    });
  }
});

export default router;
