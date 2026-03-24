import Admin from "../models/Admin.js";
import crypto from "crypto";
import sendEmail from "../utils/emailService.js";
import bcrypt from "bcryptjs";

/* =========================================
   📩 REQUEST PASSWORD RESET
========================================= */
export const requestPasswordReset = async (req, res, next) => {
  try {
    const { email } = req.body;

    // 🔎 Validate input
    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    const admin = await Admin.findOne({ email });

    // ⚠️ Do NOT reveal if admin exists (security best practice)
    if (!admin) {
      return res.status(200).json({
        success: true,
        message: "If that email exists, a reset link has been sent",
      });
    }

    // 🔐 Generate reset token
    const resetToken = admin.getResetPasswordToken();

    await admin.save({ validateBeforeSave: false });

    const resetUrl = `${process.env.FRONTEND_URL}/reset-password/${resetToken}`;

    const message = `
You requested a password reset.

Click the link below to reset your password:
${resetUrl}

If you did not request this, please ignore this email.
`;

    try {
      await sendEmail({
        to: admin.email,
        subject: "Azania Admin Password Reset",
        text: message,
      });

      return res.status(200).json({
        success: true,
        message: "Reset email sent",
      });
    } catch (err) {
      // Cleanup if email fails
      admin.resetPasswordToken = undefined;
      admin.resetPasswordExpire = undefined;

      await admin.save({ validateBeforeSave: false });

      return res.status(500).json({
        success: false,
        message: "Email could not be sent",
      });
    }
  } catch (error) {
    next(error);
  }
};

/* =========================================
   🔑 RESET PASSWORD
========================================= */
export const resetPassword = async (req, res, next) => {
  try {
    const { password } = req.body;

    // 🔎 Validate input
    if (!password || password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters",
      });
    }

    // 🔐 Hash token from params
    const resetPasswordToken = crypto
      .createHash("sha256")
      .update(req.params.token)
      .digest("hex");

    // 🔎 Find admin with valid token
    const admin = await Admin.findOne({
      resetPasswordToken,
      resetPasswordExpire: { $gt: Date.now() },
    });

    if (!admin) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired token",
      });
    }

    // 🔐 Hash password manually (extra safety)
    const salt = await bcrypt.genSalt(10);
    admin.password = await bcrypt.hash(password, salt);

    // 🧹 Clear reset fields
    admin.resetPasswordToken = undefined;
    admin.resetPasswordExpire = undefined;

    await admin.save();

    return res.status(200).json({
      success: true,
      message: "Password reset successful",
    });
  } catch (error) {
    next(error);
  }
};