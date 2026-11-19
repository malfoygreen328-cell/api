// src/models/DiscoveryCampaign.js
//
// A lightweight admin-curated grouping of brands for seasonal/editorial
// discovery moments. Campaigns are NOT paid placements: the public API labels
// them as curated campaigns and never mixes them into organic ranking without
// a label. Sponsored placement is intentionally not implemented here.

import mongoose from "mongoose";

const discoveryCampaignSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    slug: { type: String, required: true, unique: true, lowercase: true, index: true },
    description: { type: String, default: "", trim: true, maxlength: 1000 },
    status: {
      type: String,
      enum: ["DRAFT", "ACTIVE", "ARCHIVED"],
      default: "DRAFT",
      index: true,
    },
    brands: [{ type: mongoose.Schema.Types.ObjectId, ref: "Store" }],
    startsAt: { type: Date, default: null },
    endsAt: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null },
  },
  { timestamps: true, versionKey: false }
);

discoveryCampaignSchema.index({ status: 1, startsAt: -1 });

export default mongoose.model("DiscoveryCampaign", discoveryCampaignSchema);
