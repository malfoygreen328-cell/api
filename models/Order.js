// src/models/Order.js
import mongoose from "mongoose";

/* =========================
   PER-VENDOR SPLIT
   A single customer order (one payment) is split into one vendorOrder per
   vendor. Each vendorOrder owns its own items, financial breakdown, status
   and payout state, so vendors are isolated from one another and settled
   independently. The parent order keeps the customer, payment and totals.
========================= */
const vendorOrderSchema = new mongoose.Schema(
  {
    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vendor",
      required: true,
    },
    items: [
      {
        product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
        name: { type: String, required: true },
        quantity: { type: Number, required: true, min: 1 },
        price: { type: Number, required: true, min: 0 },
      },
    ],
    subTotal: { type: Number, required: true, min: 0 },
    commissionPercent: { type: Number, default: null, min: 0, max: 100 },
    commissionAmount: { type: Number, default: 0, min: 0 },
    // The provider fee is a single transaction-level amount. Per-vendor
    // payfastFee is only populated when the fee bearer is the vendor and an
    // explicit allocation policy exists.
    payfastFee: { type: Number, default: 0, min: 0 },
    vendorPayout: { type: Number, default: 0, min: 0 },
    provisionalVendorPayout: { type: Number, default: null, min: 0 },
    platformProfit: { type: Number, default: 0, min: 0 },
    platformNetCents: { type: Number, default: null },
    settlementStatus: {
      type: String,
      enum: ["pending", "blocked", "provisional", "ready", "settled", "refunded"],
      default: "pending",
      index: true,
    },
    feeStatus: {
      type: String,
      enum: ["unknown", "estimated", "actual"],
      default: "unknown",
    },
    feeBearer: {
      type: String,
      enum: ["unresolved", "marketplace", "vendor"],
      default: "unresolved",
    },
    providerFeeCents: { type: Number, default: null, min: 0 },
    status: {
      type: String,
      enum: [
        "pending",
        "paid",
        "processing",
        "shipped",
        "delivered",
        "cancelled",
        "refunded",
      ],
      default: "pending",
      index: true,
    },
    trackingNumber: { type: String, default: null },
    shippingCarrier: { type: String, default: "Local" },
    payoutStatus: {
      type: String,
      enum: ["unpaid", "processing", "paid"],
      default: "unpaid",
      index: true,
    },
    payoutDate: { type: Date },
    payoutLocked: { type: Boolean, default: false },
    refundStatus: {
      type: String,
      enum: ["none", "requested", "approved", "rejected", "refunded"],
      default: "none",
    },
    refundAmount: { type: Number, default: 0, min: 0 },
  },
  { _id: true }
);

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
        // Optional link back to the recommendation impression that led to this
        // line item. Validated server-side at order creation (must belong to
        // the ordering customer and reference the same product) - never trusted
        // raw from the client.
        recommendationId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "RecommendationAttribution",
          default: null,
        },
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
    trackingNumber: { type: String, index: true, default: null }, // ✅ keep this
    shippingCarrier: { type: String, default: "Local" },

    // =========================
    // PER-VENDOR SPLIT
    // One entry per vendor involved in this order. Populated at creation and
    // settled per-vendor on payment. This is the authoritative per-vendor view
    // (isolation + earnings/payout source of truth); the parent items/finance
    // stay as the aggregate for admin reconciliation and reporting.
    // =========================
    vendorOrders: { type: [vendorOrderSchema], default: [] },

    store: { type: mongoose.Schema.Types.ObjectId, ref: "Store" },

    // =========================
    // ORDER STATUS
    // =========================
    status: {
      type: String,
      enum: [
        "pending",
        "paid",
        "processing",
        "shipped",
        "delivered",
        "cancelled",
        "refunded",
      ],
      default: "pending",
      index: true,
    },

    // =========================
    // FINANCE
    // =========================
    commissionPercent: { type: Number, default: null, min: 0, max: 100 },
    commissionAmount: { type: Number, default: 0, min: 0 },
    payfastFee: { type: Number, default: 0, min: 0 },
    vendorPayout: { type: Number, default: 0, min: 0 },
    provisionalVendorPayout: { type: Number, default: null, min: 0 },
    platformProfit: { type: Number, default: 0, min: 0 },
    platformNetCents: { type: Number, default: null },

    // Settlement policy. `blocked`/`provisional` means these figures are NOT
    // amounts owed: the provider fee and/or fee bearer are unresolved.
    settlementStatus: {
      type: String,
      enum: ["pending", "blocked", "provisional", "ready", "settled", "refunded"],
      default: "pending",
      index: true,
    },
    feeStatus: {
      type: String,
      enum: ["unknown", "estimated", "actual"],
      default: "unknown",
    },
    feeBearer: {
      type: String,
      enum: ["unresolved", "marketplace", "vendor"],
      default: "unresolved",
    },
    feeAllocationStatus: {
      type: String,
      enum: ["not_required", "unresolved", "allocated"],
      default: "unresolved",
    },
    providerFeeCents: { type: Number, default: null, min: 0 },

    // =========================
    // PAYMENT INFO
    // =========================
    paymentMethod: { type: String, default: "payfast" },
    paymentReference: { type: String, index: true },
    paymentStatus: {
      type: String,
      enum: ["pending", "processing", "complete", "failed", "refunded"],
      default: "pending",
      index: true,
    },
    paidAt: { type: Date },

    // =========================
    // REFUND SYSTEM
    // =========================
    refundStatus: {
      type: String,
      enum: ["none", "requested", "approved", "rejected", "refunded"],
      default: "none",
      index: true,
    },
    refundAmount: { type: Number, default: 0, min: 0 },
    refundReason: { type: String, default: "", trim: true },
    refundedAt: { type: Date },

    // =========================
    // PAYOUT TRACKING
    // =========================
    payoutStatus: {
      type: String,
      enum: ["unpaid", "processing", "paid"],
      default: "unpaid",
      index: true,
    },
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
orderSchema.index({ "vendorOrders.vendor": 1 });
orderSchema.index({ payoutStatus: 1, paymentStatus: 1 });
// ❌ REMOVED duplicate trackingNumber index

/* =========================
   HOOKS
   ========================= */

/**
 * Payout safeguards applied before every save. Exported as a pure helper so
 * it can be unit-tested without a database.
 * - Clamps financials to non-negative values.
 * - Approved/refunded orders are payout-locked (vendor payout and platform
 *   profit zeroed, payout stays unpaid).
 */
export const applyRefundLocks = (order) => {
  if (order.platformProfit < 0) order.platformProfit = 0;
  if (order.vendorPayout < 0) order.vendorPayout = 0;

  if (["approved", "refunded"].includes(order.refundStatus)) {
    order.vendorPayout = 0;
    order.platformProfit = 0;
    order.payoutLocked = true;
    order.payoutStatus = "unpaid";
  }

  // Keep the per-vendor split consistent with the parent: refunded orders
  // zero and lock every vendor's payout so none can be released.
  if (Array.isArray(order.vendorOrders)) {
    for (const vo of order.vendorOrders) {
      if (vo.platformProfit < 0) vo.platformProfit = 0;
      if (vo.vendorPayout < 0) vo.vendorPayout = 0;
      if (["approved", "refunded"].includes(vo.refundStatus) || ["approved", "refunded"].includes(order.refundStatus)) {
        vo.vendorPayout = 0;
        vo.platformProfit = 0;
        vo.payoutLocked = true;
        vo.payoutStatus = "unpaid";
      }
    }
  }
};

orderSchema.pre("save", function () {
  applyRefundLocks(this);
});

/* =========================
   HELPER METHODS
========================= */
orderSchema.methods.canBeRefunded = function () {
  return (
    this.paymentStatus === "complete" &&
    ["paid", "processing", "shipped"].includes(this.status)
  );
};

orderSchema.methods.canBePaidOut = function () {
  return (
    this.paymentStatus === "complete" &&
    this.payoutStatus === "unpaid" &&
    !this.payoutLocked &&
    this.refundStatus === "none"
  );
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