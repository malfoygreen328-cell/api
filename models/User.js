import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import crypto from "crypto";

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Please provide your name"],
      trim: true,
      minlength: [2, "Name must be at least 2 characters"],
    },

    email: {
      type: String,
      required: [true, "Please provide your email"],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/.+@.+\..+/, "Please enter a valid email"],
      index: true, // 🔥 faster lookups
    },

    password: {
      type: String,
      required: [true, "Please provide a password"],
      minlength: [6, "Password must be at least 6 characters"],
      select: false, // 🔥 never return password unless explicitly asked
    },

    role: {
      type: String,
      enum: [
        "customer",
        "vendor_owner",
        "vendor_staff", // 🔥 aligned with your auth middleware
        "admin",
        "superadmin",
      ],
      default: "customer",
    },

    store: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Store",
      default: null,
    },

    // Optional link for legacy vendor accounts. New vendors are created in the
    // canonical Vendor collection, never as User+vendor_owner.
    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vendor",
      default: null,
    },

    /* =========================================
       🔐 PASSWORD RESET
    ========================================= */
    resetPasswordToken: {
      type: String,
      default: null,
      select: false,
    },

    resetPasswordExpires: {
      type: Date,
      default: null,
      select: false,
    },

    /* =========================================
       📧 EMAIL VERIFICATION
    ========================================= */
    isVerified: {
      type: Boolean,
      default: false,
    },

    verificationToken: {
      type: String,
      default: null,
      select: false,
      index: true, // 🔥 fast lookup on verify
    },

    verificationTokenExpires: {
      type: Date,
      default: null,
    },

    /* =========================================
       💳 SUBSCRIPTION
    ========================================= */
    subscription: {
      type: String,
      enum: ["BASIC", "PREMIUM"],
      default: "BASIC",
    },

    subscriptionExpiresAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

// Mongoose 9: pre('save') no longer receives a `next` callback (the first
// argument is SaveOptions) - do the work in an async hook instead.
userSchema.pre("save", async function () {
  if (!this.isModified("password")) return;

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

/* =========================================
   🔎 COMPARE PASSWORD
========================================= */
userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

/* =========================================
   📧 GENERATE EMAIL VERIFICATION TOKEN
   Returns the PLAIN token (emailed to user);
   only the SHA-256 hash is stored.
========================================= */
userSchema.methods.getEmailVerificationToken = function () {
  const plainToken = crypto.randomBytes(32).toString("hex");

  this.verificationToken = crypto
    .createHash("sha256")
    .update(plainToken)
    .digest("hex");

  this.verificationTokenExpires = Date.now() + 24 * 60 * 60 * 1000; // 24h

  return plainToken;
};

/* =========================================
   🚫 CLEAN RESPONSE
========================================= */
userSchema.methods.toJSON = function () {
  const obj = this.toObject();

  delete obj.password;
  delete obj.resetPasswordToken;
  delete obj.resetPasswordExpires;
  delete obj.verificationToken;
  delete obj.__v;

  return obj;
};

const User = mongoose.model("User", userSchema);

export default User;