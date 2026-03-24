// src/models/Admin.js
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import crypto from "crypto";

/* -------------------- ADMIN SCHEMA -------------------- */
const adminSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: [true, "Full name is required"],
      trim: true,
      maxlength: [100, "Name cannot exceed 100 characters"],
    },

    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true, // ✅ automatically creates a unique index
      lowercase: true,
      trim: true,
      match: [
        /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/,
        "Please enter a valid email",
      ],
    },

    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: [6, "Password must be at least 6 characters"],
      select: false, // 🔐 hide password in queries by default
    },

    role: {
      type: String,
      enum: ["admin", "superadmin"],
      default: "admin",
    },

    isActive: {
      type: Boolean,
      default: true, // can disable admin accounts
    },

    lastLogin: {
      type: Date,
    },

    resetPasswordToken: String,
    resetPasswordExpire: Date,
  },
  {
    timestamps: true,
  }
);

/* -------------------- PASSWORD HASHING -------------------- */
adminSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();

  const salt = await bcrypt.genSalt(12); // 🔥 strong hash
  this.password = await bcrypt.hash(this.password, salt);

  next();
});

/* -------------------- PASSWORD VERIFICATION -------------------- */
adminSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

/* -------------------- RESET PASSWORD TOKEN -------------------- */
adminSchema.methods.getResetPasswordToken = function () {
  const resetToken = crypto.randomBytes(32).toString("hex"); // 🔐 strong token

  this.resetPasswordToken = crypto
    .createHash("sha256")
    .update(resetToken)
    .digest("hex");

  this.resetPasswordExpire = Date.now() + 10 * 60 * 1000; // 10 min expiry

  return resetToken;
};

/* -------------------- CLEAN JSON RESPONSE -------------------- */
adminSchema.methods.toJSON = function () {
  const obj = this.toObject();

  delete obj.password;
  delete obj.resetPasswordToken;
  delete obj.resetPasswordExpire;
  delete obj.__v;

  return obj;
};

/* -------------------- EXPORT MODEL -------------------- */
const Admin = mongoose.model("Admin", adminSchema);
export default Admin;