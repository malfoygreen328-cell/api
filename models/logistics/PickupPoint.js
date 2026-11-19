// src/models/logistics/PickupPoint.js
import mongoose from "mongoose";

const pickupPointSchema = new mongoose.Schema(
  {
    provider: { type: String, trim: true, required: true },
    externalId: { type: String, trim: true, required: true, index: true },
    name: { type: String, trim: true },
    address: {
      street: { type: String, trim: true },
      city: { type: String, trim: true },
      province: { type: String, trim: true },
      postalCode: { type: String, trim: true },
      country: { type: String, trim: true, default: "South Africa" },
    },
    latitude: { type: Number },
    longitude: { type: Number },
    distance: { type: Number },
    openingHours: { type: String, trim: true },
    availability: { type: Boolean, default: true },
    services: { type: [String], default: [] },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

pickupPointSchema.index({ provider: 1, externalId: 1 }, { unique: true });
pickupPointSchema.index({ "address.city": 1, "address.province": 1 });

export default mongoose.model("PickupPoint", pickupPointSchema);
