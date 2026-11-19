// src/models/logistics/Shipment.js
import mongoose from "mongoose";

const addressSchema = new mongoose.Schema(
  {
    street: { type: String, trim: true },
    city: { type: String, trim: true },
    province: { type: String, trim: true },
    postalCode: { type: String, trim: true },
    country: { type: String, trim: true, default: "South Africa" },
  },
  { _id: false }
);

const parcelSchema = new mongoose.Schema(
  {
    weight: { type: Number, min: 0 },
    length: { type: Number, min: 0 },
    width: { type: Number, min: 0 },
    height: { type: Number, min: 0 },
    itemsCount: { type: Number, default: 1, min: 1 },
    description: { type: String, trim: true },
  },
  { _id: false }
);

const pickupPointSchema = new mongoose.Schema(
  {
    provider: { type: String, trim: true },
    externalId: { type: String, trim: true },
    name: { type: String, trim: true },
    address: addressSchema,
    latitude: { type: Number },
    longitude: { type: Number },
    distance: { type: Number },
    openingHours: { type: String, trim: true },
    services: { type: [String], default: [] },
    selectedAt: { type: Date },
  },
  { _id: false }
);

const shipmentSchema = new mongoose.Schema(
  {
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order", required: true, index: true },
    vendorId: { type: mongoose.Schema.Types.ObjectId, ref: "Vendor", index: true },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    shipmentReference: { type: String, unique: true, index: true, trim: true },
    provider: { type: String, trim: true, index: true },
    providerShipmentId: { type: String, trim: true, index: true },
    providerOrderId: { type: String, trim: true },
    fulfillmentMethod: {
      type: String,
      enum: ["VENDOR_FULFILLED", "AZANIA_FULFILLED", "PARTNER_FULFILLED", "LOCAL_EXPRESS"],
      default: "VENDOR_FULFILLED",
    },
    shippingMethod: {
      type: String,
      enum: ["HOME_DELIVERY", "PICKUP_POINT", "EXPRESS", "SAME_DAY", "VENDOR_LOCAL_DELIVERY"],
      default: "HOME_DELIVERY",
    },
    serviceLevel: { type: String, trim: true },
    originAddress: addressSchema,
    destinationAddress: addressSchema,
    pickupPoint: pickupPointSchema,
    parcelDetails: parcelSchema,
    quotedShippingCost: { type: Number, default: 0, min: 0 },
    customerShippingCharge: { type: Number, default: 0, min: 0 },
    vendorShippingContribution: { type: Number, default: 0, min: 0 },
    azaniaShippingSubsidy: { type: Number, default: 0, min: 0 },
    currency: { type: String, default: "ZAR" },
    trackingNumber: { type: String, trim: true, index: true },
    trackingUrl: { type: String, trim: true },
    labelUrl: { type: String, trim: true },
    status: {
      type: String,
      enum: [
        "CREATED", "AWAITING_VENDOR", "PACKED", "BOOKING_PENDING", "BOOKED", "LABEL_READY", "COLLECTION_PENDING", "COLLECTED", "IN_TRANSIT", "OUT_FOR_DELIVERY", "READY_FOR_PICKUP", "DELIVERED", "PICKED_UP", "FAILED_DELIVERY", "DELIVERY_EXCEPTION", "CANCELLED", "RETURN_PENDING", "RETURN_IN_TRANSIT", "RETURNED",
      ],
      default: "CREATED",
      index: true,
    },
    previousStatus: { type: String, trim: true },
    estimatedDeliveryAt: { type: Date },
    actualDeliveryAt: { type: Date },
    bookedAt: { type: Date },
    collectedAt: { type: Date },
    deliveredAt: { type: Date },
    idempotencyKey: { type: String, trim: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

shipmentSchema.index({ orderId: 1, vendorId: 1 });
shipmentSchema.index({ customerId: 1, createdAt: -1 });
shipmentSchema.index({ status: 1, createdAt: -1 });
shipmentSchema.index({ providerShipmentId: 1, provider: 1 }, { sparse: true });
shipmentSchema.index({ idempotencyKey: 1 }, { sparse: true });

export default mongoose.model("Shipment", shipmentSchema);
