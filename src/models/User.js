import mongoose from "mongoose";
import bcrypt from "bcryptjs";

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

/* =========================================
   🔐 HASH PASSWORD BEFORE SAVE
========================================= */
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();

  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (err) {
    next(err);
  }
});

/* =========================================
   🔎 COMPARE PASSWORD
========================================= */
userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

/* =========================================
   🚫 CLEAN RESPONSE
========================================= */
userSchema.methods.toJSON = function () {
  const obj = this.toObject();

  delete obj.password;
  delete obj.resetPasswordToken;
  delete obj.resetPasswordExpires;
  delete obj.__v;

  return obj;
};

const User = mongoose.model("User", userSchema);

export default User;
