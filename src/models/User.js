import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const userSchema = new mongoose.Schema(
  {
    name: { 
      type: String, 
      required: [true, "Please provide your name"], 
      trim: true 
    },

    email: { 
      type: String, 
      required: [true, "Please provide your email"], 
      unique: true, 
      lowercase: true, 
      trim: true,
      match: [/.+@.+\..+/, "Please enter a valid email"] // added validation
    },

    password: { 
      type: String, 
      required: [true, "Please provide a password"] 
    },

    role: {
      type: String,
      enum: ["customer", "vendor_owner", "staff", "admin"],
      default: "customer"
    },

    store: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Store",
      default: null // explicit default
    },

    // Password reset
    resetPasswordToken: {
      type: String,
      default: null
    },

    resetPasswordExpires: {
      type: Date,
      default: null
    },

    // Subscription
    subscription: {
      type: String,
      enum: ["BASIC", "PREMIUM"],
      default: "BASIC"
    },

    subscriptionExpiresAt: {
      type: Date,
      default: null
    }
  },
  { timestamps: true }
);

/* =========================================
   🔐 HASH PASSWORD BEFORE SAVE
========================================= */
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

/* =========================================
   🔎 COMPARE PASSWORD METHOD
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