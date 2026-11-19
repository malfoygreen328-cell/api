// src/models/Refund.js
import mongoose from "mongoose";

/*
 * Refund record. `amountCents` is authoritative; `amount` is kept for legacy
 * readers. A stable `refundKey` makes approval idempotent.
 *
 * Provider execution is deliberately NOT automatic: until the PayFast
 * marketplace/refund agreement is in place, providerStatus stays
 * "pending_manual" and an operator must complete the money movement with the
 * provider. The internal ledger reversal is still recorded atomically.
 */
const refundSchema = new mongoose.Schema(
  {
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
      index: true,
    },
    refundKey: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    amountCents: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: "amountCents must be an integer (minor units)",
      },
    },
    currency: { type: String, default: "ZAR", enum: ["ZAR"] },
    allocations: {
      type: [
        {
          vendorOrderId: { type: mongoose.Schema.Types.ObjectId, required: true },
          vendor: { type: mongoose.Schema.Types.ObjectId, ref: "Vendor" },
          amountCents: { type: Number, required: true, min: 0 },
        },
      ],
      default: [],
    },
    reason: {
      type: String,
      default: "",
      trim: true,
      maxlength: 1000,
    },
    status: {
      type: String,
      enum: ["pending", "processed", "failed"],
      default: "processed",
      index: true,
    },
    providerStatus: {
      type: String,
      enum: ["not_required", "pending_manual", "processing", "refunded", "failed"],
      default: "pending_manual",
      index: true,
    },
    providerReference: { type: String, default: "", trim: true },
    providerError: { type: String, default: "", trim: true },
    processedAt: Date,
    admin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    processedBy: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    notes: String,
  },
  { timestamps: true }
);

refundSchema.index({ order: 1, createdAt: -1 });

export default mongoose.model("Refund", refundSchema);
