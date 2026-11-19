import mongoose from "mongoose";
import slugify from "slugify";
import {
  FASHION_CATEGORY_SLUGS,
  PROVINCES,
} from "../config/brandConfig.js";

const storeSchema = new mongoose.Schema({
  vendor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Vendor",
    required: true,
    unique: true,
  },

  storeName: {
    type: String,
    required: true,
    trim: true,
  },

  storeSlug: {
    type: String,
    unique: true,
    lowercase: true,
    index: true,
  },

  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  },

  logo: { type: String, default: "" },
  banner: { type: String, default: "" },

  themeColor: {
    type: String,
    default: "#004225",
    match: [/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, "Invalid hex color"],
  },

  createdAt: {
    type: Date,
    default: Date.now
  },

  description: {
    type: String,
    trim: true,
    default: "",
  },

  // Long-form brand story (plain text, rendered with textContent).
  story: {
    type: String,
    trim: true,
    default: "",
    maxlength: 5000,
  },

  province: {
    type: String,
    enum: ["", ...PROVINCES],
    default: "",
    index: true,
  },

  city: {
    type: String,
    trim: true,
    default: "",
    maxlength: 100,
    index: true,
  },

  // Only the marketplace's fashion categories are allowed.
  fashionCategories: {
    type: [{ type: String, enum: FASHION_CATEGORY_SLUGS }],
    default: [],
    index: true,
  },

  socialLinks: {
    instagram: { type: String, default: "" },
    facebook: { type: String, default: "" },
    tiktok: { type: String, default: "" },
    website: { type: String, default: "" },
  },

  // Publication workflow. A brand is only publicly discoverable when
  // approvalStatus === "APPROVED" AND discoveryEligible !== false AND the
  // linked vendor account is APPROVED. Brand approval is deliberately separate
  // from vendor account approval so admins can review the public profile.
  approvalStatus: {
    type: String,
    enum: ["PENDING", "APPROVED", "REJECTED"],
    default: "PENDING",
    index: true,
  },
  approvalReason: { type: String, default: "", trim: true, maxlength: 1000 },
  approvedAt: { type: Date, default: null },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null },

  featured: { type: Boolean, default: false, index: true },
  featuredAt: { type: Date, default: null },
  featuredBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null },

  // Admin-controlled kill switch. Even an approved brand can be removed from
  // discovery without changing its approval history.
  discoveryEligible: { type: Boolean, default: true, index: true },
}, { timestamps: true });

storeSchema.pre("save", async function () {
  if (this.isModified("storeName") || !this.storeSlug) {
    const baseSlug =
      slugify(String(this.storeName || ""), {
        lower: true,
        strict: true,
      }) || "brand";

    let slug = baseSlug;
    let counter = 1;

    // Exclude self so renaming a store does not create an unnecessary suffix.
    while (
      await mongoose.models.Store.findOne({
        storeSlug: slug,
        ...(this._id ? { _id: { $ne: this._id } } : {}),
      })
    ) {
      slug = `${baseSlug}-${counter++}`;
    }

    this.storeSlug = slug;
  }
});

// Discovery query indexes. These mirror the filters used by the public brand
// APIs (approved + eligible, category, location, newest, featured).
storeSchema.index({ approvalStatus: 1, discoveryEligible: 1, featured: -1, createdAt: -1 });
storeSchema.index({ province: 1, city: 1, approvalStatus: 1 });
storeSchema.index({ fashionCategories: 1, approvalStatus: 1 });
storeSchema.index({ storeName: "text", description: "text", story: "text" });

storeSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.__v;
  return obj;
};

export default mongoose.model("Store", storeSchema);