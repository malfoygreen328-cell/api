// src/models/BrandStory.js
//
// Editorial brand stories are written/managed by administrators only. Vendors
// cannot publish their own editorial content. Bodies are stored as plain text
// and rendered with textContent on the storefront.

import mongoose from "mongoose";

const brandStorySchema = new mongoose.Schema(
  {
    brand: { type: mongoose.Schema.Types.ObjectId, ref: "Store", required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    slug: { type: String, required: true, unique: true, lowercase: true, index: true },
    excerpt: { type: String, default: "", trim: true, maxlength: 500 },
    body: { type: String, default: "", trim: true, maxlength: 20000 },
    image: { type: String, default: "" },
    status: {
      type: String,
      enum: ["DRAFT", "PUBLISHED", "ARCHIVED"],
      default: "DRAFT",
      index: true,
    },
    publishedAt: { type: Date, default: null, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null },
  },
  { timestamps: true, versionKey: false }
);

brandStorySchema.index({ status: 1, publishedAt: -1 });
brandStorySchema.index({ brand: 1, status: 1, publishedAt: -1 });

export default mongoose.model("BrandStory", brandStorySchema);
