import mongoose from "mongoose";

/*
 * PayFast payment integrity log. Unlike the legacy `Payment` model (card
 * metadata only), this records the transaction lifecycle that can be reconciled
 * against IPN callbacks and protects against replay/amount tampering.
 * Entries are append-oriented for auditability but some fields may be updated
 * by the IPN handler; the write paths are restricted to service code.
 */

const paymentTransactionSchema = new mongoose.Schema(
  {
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
      index: true,
      unique: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    vendorOrders: [
      {
        vendor: { type: mongoose.Schema.Types.ObjectId, ref: "Vendor" },
        vendorOrderId: { type: mongoose.Schema.Types.ObjectId },
        amountCents: { type: Number, min: 0 },
      },
    ],
    pfPaymentId: {
      type: String,
      default: null,
      trim: true,
      index: true,
      unique: true,
      sparse: true,
    },
    mPaymentId: { type: String, default: "", trim: true, index: true },
    pfTransactionId: { type: String, default: "", trim: true },
    paymentStatus: {
      type: String,
      enum: ["pending", "processing", "complete", "failed", "cancelled", "refunded", "partially_refunded"],
      default: "pending",
      index: true,
    },
    amountGrossCents: { type: Number, required: true, min: 0 },
    // null means the provider did not report a fee (UNKNOWN), not zero.
    amountFeeCents: { type: Number, default: null, min: 0 },
    amountNetCents: { type: Number, default: null, min: 0 },
    feeStatus: {
      type: String,
      enum: ["unknown", "estimated", "actual"],
      default: "unknown",
      index: true,
    },
    settlementStatus: {
      type: String,
      enum: ["pending", "processing", "blocked", "provisional", "ready", "settled", "refunded"],
      default: "pending",
      index: true,
    },
    currency: { type: String, default: "ZAR", enum: ["ZAR"] },
    signature: { type: String, default: "", trim: true },
    signatureValid: { type: Boolean, default: null },
    itnReceivedAt: { type: Date, default: null },
    processedAt: { type: Date, default: null },
    paymentProcessingAt: { type: Date, default: null },
    rawPayload: { type: mongoose.Schema.Types.Mixed, default: {} },
    ipnHistory: [
      {
        receivedAt: { type: Date, default: Date.now },
        paymentStatus: { type: String },
        pfPaymentId: { type: String },
        amountGross: { type: String },
        valid: { type: Boolean },
        note: { type: String },
      },
    ],
    error: { type: String, default: "", trim: true },
  },
  { timestamps: true, versionKey: false }
);

paymentTransactionSchema.index({ order: 1, paymentStatus: 1 });
paymentTransactionSchema.index({ pfPaymentId: 1, createdAt: -1 });

paymentTransactionSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.__v;
  delete obj.signature;
  delete obj.rawPayload;
  return obj;
};

export default mongoose.model("PaymentTransaction", paymentTransactionSchema);
