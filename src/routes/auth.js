import express from "express";
import crypto from "crypto";
import User from "../models/User.js";

const router = express.Router();

/**
 * FORGOT PASSWORD
 * Generate reset token and send reset link
 */
router.post("/forgot-password", async (req, res) => {
  try {

    const { email } = req.body;

    const user = await User.findOne({ email });

    // Prevent email enumeration
    if (!user) {
      return res.json({
        message: "If an account exists, a reset link has been sent."
      });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString("hex");

    user.resetPasswordToken = resetToken;
    user.resetPasswordExpire = Date.now() + 3600000; // 1 hour

    await user.save();

    const resetURL = `http://localhost:3000/reset-password/${resetToken}`;

    console.log("Reset Link:", resetURL);

    res.json({
      message: "Reset link sent to your email"
    });

  } catch (error) {
    res.status(500).json({
      message: "Server error",
      error: error.message
    });
  }
});


/**
 * RESET PASSWORD
 */
router.post("/reset-password/:token", async (req, res) => {
  try {

    const { token } = req.params;
    const { password } = req.body;

    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpire: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({
        message: "Invalid or expired token"
      });
    }

    user.password = password;

    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;

    await user.save();

    res.json({
      message: "Password reset successful"
    });

  } catch (error) {
    res.status(500).json({
      message: "Server error",
      error: error.message
    });
  }
});

export default router;