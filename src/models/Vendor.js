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
    documents: {
      registrationCert: { type: String, required: true },
      directorId: { type: String, required: true },
      proofOfAddress: { type: String, required: true },
      bankLetter: { type: String },
    },
    status: { type: String, enum: ["PENDING", "APPROVED", "DECLINED"], default: "PENDING" }, // match frontend
    role: { type: String, enum: ["vendor_owner", "vendor_staff"], default: "vendor_owner" },
    store: { type: mongoose.Schema.Types.ObjectId, ref: "Store" },
    subscriptionPlan: { type: String, enum: ["BASIC", "PREMIUM", "COMMISSION"], default: "BASIC" },
    subscriptionLimit: { type: Number, default: 50 },
    subscriptionPaid: { type: Boolean, default: false },
    subscriptionDue: { type: Number, default: 0 },       // <-- for unpaid vendors table
    revenue: { type: Number, default: 0 },              // <-- for stats/top vendor
  },
  { timestamps: true, versionKey: false }
);

// Hash password before save
vendorSchema.pre("save", async function () {
  if (!this.isModified("password") || !this.password) return;
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// Adjust subscription limit based on plan
vendorSchema.pre("save", function () {
  if (this.isModified("subscriptionPlan")) {
    switch (this.subscriptionPlan) {
      case "PREMIUM":
        this.subscriptionLimit = 2000;
        break;
      case "COMMISSION":
        this.subscriptionLimit = Number.MAX_SAFE_INTEGER;
        break;
      default:
        this.subscriptionLimit = 50;
    }
  }
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