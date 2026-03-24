// src/models/Order.js
import mongoose from "mongoose";

const orderSchema = new mongoose.Schema(
  {
    // =========================
    // CUSTOMER
    // =========================
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    customerName: { type: String, required: true, trim: true },
    customerEmail: { type: String, required: true, lowercase: true, trim: true },

    // =========================
    // ORDER ITEMS
    // =========================
    items: [
      {
        product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
        vendor: { type: mongoose.Schema.Types.ObjectId, ref: "Vendor", required: true },
        name: { type: String, required: true },
        quantity: { type: Number, required: true, min: 1 },
        price: { type: Number, required: true, min: 0 },
      },
    ],

    // =========================
    // TOTAL & CURRENCY
    // =========================
    totalAmount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: "ZAR" },

    // =========================
    // SHIPPING & TRACKING
    // =========================
    shippingAddress: { type: String, required: true, trim: true },
    trackingNumber: { type: String, index: true, default: null },
    shippingCarrier: { type: String, default: "Local" },

    store: { type: mongoose.Schema.Types.ObjectId, ref: "Store" },

    // =========================
    // ORDER STATUS
    // =========================
    status: {
      type: String,
      enum: ["pending", "paid", "processing", "shipped", "delivered", "cancelled"],
      default: "pending",
      index: true,
    },

    // =========================
    // FINANCE
    // =========================
    commissionAmount: { type: Number, default: 0, min: 0 },
    payfastFee: { type: Number, default: 0, min: 0 },
    vendorPayout: { type: Number, default: 0, min: 0 },
    platformProfit: { type: Number, default: 0, min: 0 },

    // =========================
    // PAYMENT INFO
    // =========================
    paymentMethod: { type: String, default: "payfast" },
    paymentReference: { type: String, index: true },
    paymentStatus: { type: String, enum: ["pending", "complete", "failed"], default: "pending", index: true },
    paidAt: { type: Date },

    // =========================
    // REFUND SYSTEM
    // =========================
    refundStatus: { type: String, enum: ["none", "requested", "approved", "rejected", "refunded"], default: "none", index: true },
    refundAmount: { type: Number, default: 0, min: 0 },
    refundReason: { type: String, default: "", trim: true },
    refundedAt: { type: Date },

    // =========================
    // PAYOUT TRACKING
    // =========================
    payoutStatus: { type: String, enum: ["unpaid", "processing", "paid"], default: "unpaid", index: true },
    payoutDate: { type: Date },
    payoutLocked: { type: Boolean, default: false },
  },
  { timestamps: true }
);

/* =========================
   INDEXES
========================= */
orderSchema.index({ customer: 1, createdAt: -1 });
orderSchema.index({ "items.vendor": 1 });
orderSchema.index({ payoutStatus: 1, paymentStatus: 1 });
orderSchema.index({ trackingNumber: 1 });

/* =========================
   HOOKS
========================= */
orderSchema.pre("save", function (next) {
  if (this.platformProfit < 0) this.platformProfit = 0;
  if (this.vendorPayout < 0) this.vendorPayout = 0;

  // Lock payout if refund approved
  if (["approved", "refunded"].includes(this.refundStatus)) {
    this.vendorPayout = 0;
    this.platformProfit = 0;
    this.payoutLocked = true;
    this.payoutStatus = "unpaid";
  }

  next();
});

/* =========================
   HELPER METHODS
========================= */
orderSchema.methods.canBeRefunded = function () {
  return this.paymentStatus === "complete" && ["paid", "processing", "shipped"].includes(this.status);
};

orderSchema.methods.canBePaidOut = function () {
  return this.paymentStatus === "complete" && this.payoutStatus === "unpaid" && !this.payoutLocked && this.refundStatus === "none";
};

/* =========================
   CLEAN RESPONSE
========================= */
orderSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.__v;
  return obj;
};

export default mongoose.model("Order", orderSchema);