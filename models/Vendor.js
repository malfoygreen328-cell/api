import mongoose from "mongoose";
import bcrypt from "bcryptjs";

// Vendor Schema
const vendorSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, "Please enter a valid email address"],
      index: true,
    },
    password: { type: String, required: true, minlength: 6, select: false },
    phone: { type: String, required: true, trim: true },
    businessName: { type: String, required: true, trim: true },
    registrationNumber: { type: String, required: true, trim: true },
    taxNumber: { type: String, trim: true },
    businessType: { type: String, required: true, trim: true },
    address: { type: String, trim: true, maxlength: 500, default: "" },
    documents: {
      registrationCert: { type: String, required: true },
      directorId: { type: String, required: true },
      proofOfAddress: { type: String, required: true },
      bankLetter: { type: String },
    },
    status: { type: String, enum: ["PENDING", "APPROVED", "DECLINED", "SUSPENDED"], default: "PENDING" }, // match frontend
    role: { type: String, enum: ["vendor_owner", "vendor_staff"], default: "vendor_owner" },
    // Canonical vendor identity is this document. `user` is an optional link
    // for legacy accounts that were originally created in the User collection.
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    store: { type: mongoose.Schema.Types.ObjectId, ref: "Store" },
    subscriptionPlan: { type: String, enum: ["BASIC", "PREMIUM", "COMMISSION"], default: "BASIC" },
    subscriptionLimit: { type: Number, default: 50 },
    subscriptionPaid: { type: Boolean, default: false },
    subscriptionDue: { type: Number, default: 0 },       // <-- for unpaid vendors table
    subscriptionStartedAt: { type: Date, default: null },
    subscriptionEndsAt: { type: Date, default: null },
    trialStartedAt: { type: Date, default: null },
    trialEndsAt: { type: Date, default: null },
    trialUsed: { type: Boolean, default: false },
    suspendedAt: { type: Date, default: null },
    suspensionReason: { type: String, default: "", trim: true },
    subscriptionHistory: [
      {
        plan: { type: String, enum: ["BASIC", "PREMIUM", "COMMISSION"], required: true },
        amountCents: { type: Number, default: 0, min: 0 },
        currency: { type: String, default: "ZAR" },
        status: { type: String, enum: ["pending", "paid", "waived", "failed"], default: "pending" },
        source: { type: String, default: "manual" },
        reference: { type: String, default: "" },
        periodStart: { type: Date, default: null },
        periodEnd: { type: Date, default: null },
        changedBy: { type: mongoose.Schema.Types.ObjectId, default: null },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    revenue: { type: Number, default: 0 },              // <-- for stats/top vendor

    // =========================
    // FOUNDING VENDOR PROGRAM
    // =========================
    foundingVendor: { type: Boolean, default: false },
    foundingVendorSince: { type: Date, default: null },
    commissionRateLocked: { type: Boolean, default: false },
    lockedCommissionRate: { type: Number, default: null, min: 0, max: 1 }, // fraction (0.05 = 5%)
  },
  { timestamps: true, versionKey: false }
);

vendorSchema.index({ user: 1 }, { sparse: true });
vendorSchema.index({ status: 1, createdAt: -1 });
vendorSchema.index({ trialEndsAt: 1 });

// Hash password before save
vendorSchema.pre("save", async function () {
  if (!this.isModified("password") || !this.password) return;
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// Adjust subscription limit based on plan
vendorSchema.pre("save", function () {
  if (this.isModified("subscriptionPlan") || this.isNew) {
    switch (this.subscriptionPlan) {
      case "PREMIUM":
        this.subscriptionLimit = 1000;
        break;
      case "COMMISSION":
        this.subscriptionLimit = Number.MAX_SAFE_INTEGER;
        break;
      default:
        this.subscriptionLimit = 50;
    }
  }
});

// Every new vendor starts a single 90-day trial. Approved vendors keep the
// trial dates; the expiry job/middleware can then gate listings without
// silently deleting data.
vendorSchema.pre("save", function () {
  if (!this.isNew) return;
  if (!this.trialStartedAt) this.trialStartedAt = new Date();
  if (!this.trialEndsAt) {
    this.trialEndsAt = new Date(this.trialStartedAt.getTime() + 90 * 24 * 60 * 60 * 1000);
  }
  if (this.trialEndsAt && !this.trialUsed) this.trialUsed = true;
});

// Compare password
vendorSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Remove sensitive info from JSON
vendorSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  return obj;
};

const Vendor = mongoose.model("Vendor", vendorSchema);

export default Vendor;