// src/models/logistics/ShipmentEvent.js
import mongoose from "mongoose";

const shipmentEventSchema = new mongoose.Schema(
  {
    shipmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Shipment", required: true, index: true },
    eventType: { type: String, trim: true, required: true },
    provider: { type: String, trim: true },
    providerEventCode: { type: String, trim: true },
    status: { type: String, trim: true },
    description: { type: String, trim: true },
    timestamp: { type: Date, default: Date.now },
    location: { type: String, trim: true },
    rawEventReference: { type: String, trim: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

shipmentEventSchema.index({ shipmentId: 1, timestamp: -1 });
shipmentEventSchema.index({ provider: 1, providerEventCode: 1 }, { sparse: true });

export default mongoose.model("ShipmentEvent", shipmentEventSchema);
