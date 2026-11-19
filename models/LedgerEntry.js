import mongoose from "mongoose";

/*
 * Append-only vendor earnings ledger.
 *
 * Money is stored as signed integer minor units (cents), never floats.
 * Sign convention from the vendor's perspective:
 *   SALE_CREDIT               +  (gross sale value attributed to vendor)
 *   COMMISSION                -  (marketplace commission)
 *   PAYMENT_FEE               -  (vendor share of PayFast processing fee)
 *   REFUND_REVERSAL           -  (reverses a previous sale credit)
 *   COMMISSION_REVERSAL       +  (reverses a previous commission debit)
 *   PAYMENT_FEE_REVERSAL      +  (reverses a previous fee debit)
 *   PAYOUT_SETTLEMENT         -  (money paid out to the vendor)
 *   SUBSCRIPTION_CHARGE       -  (plan charge debited from vendor)
 *   ADJUSTMENT                +/- (documented manual correction)
 *
 * Entries are immutable. Corrections and refunds are new compensating rows;
 * nothing is ever edited or deleted.
 */

const NON_NEGATIVE_TYPES = new Set([
  "SALE_CREDIT",
  "COMMISSION_REVERSAL",
  "PAYMENT_FEE_REVERSAL",
]);

const NON_POSITIVE_TYPES = new Set([
  "COMMISSION",
  "PAYMENT_FEE",
  "REFUND_REVERSAL",
  "PAYOUT_SETTLEMENT",
  "SUBSCRIPTION_CHARGE",
]);

const ledgerEntrySchema = new mongoose.Schema(
  {
    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vendor",
      required: true,
      index: true,
    },
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      default: null,
      index: true,
    },
    vendorOrderId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true,
    },
    type: {
      type: String,
      required: true,
      enum: [
        "SALE_CREDIT",
        "COMMISSION",
        "PAYMENT_FEE",
        "REFUND_REVERSAL",
        "COMMISSION_REVERSAL",
        "PAYMENT_FEE_REVERSAL",
        "PAYOUT_SETTLEMENT",
        "SUBSCRIPTION_CHARGE",
        "ADJUSTMENT",
      ],
      index: true,
    },
    amountCents: {
      type: Number,
      required: true,
      validate: {
        validator: Number.isInteger,
        message: "amountCents must be an integer (minor units)",
      },
    },
    currency: {
      type: String,
      default: "ZAR",
      enum: ["ZAR"],
      uppercase: true,
      trim: true,
    },
    eventKey: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
      maxlength: 200,
    },
    source: {
      type: String,
      required: true,
      enum: [
        "payfast_ipn",
        "order_confirmation",
        "refund",
        "admin_adjustment",
        "subscription",
        "payout",
        "migration",
        "reconciliation",
      ],
      default: "payfast_ipn",
    },
    description: { type: String, default: "", trim: true, maxlength: 500 },
    actorType: {
      type: String,
      enum: ["system", "admin", "vendor", "customer"],
      default: "system",
    },
    actorId: { type: mongoose.Schema.Types.ObjectId, default: null },
    reversalOf: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LedgerEntry",
      default: null,
    },
    // Set once a settlement/payout record exists for this entry. Payout
    // execution is disabled until PayFast marketplace approval is in place.
    payoutReference: { type: String, default: "", trim: true, maxlength: 200 },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false }
);

ledgerEntrySchema.index({ vendor: 1, createdAt: -1 });
ledgerEntrySchema.index({ vendor: 1, type: 1, createdAt: -1 });
ledgerEntrySchema.index({ order: 1, vendor: 1 });

ledgerEntrySchema.pre("validate", function () {
  if (Number.isFinite(this.amountCents) && !Number.isInteger(this.amountCents)) {
    this.invalidate("amountCents", "amountCents must be an integer (minor units)");
  }
  if (NON_NEGATIVE_TYPES.has(this.type) && this.amountCents < 0) {
    this.invalidate("amountCents", `${this.type} must not be negative`);
  }
  if (NON_POSITIVE_TYPES.has(this.type) && this.amountCents > 0) {
    // Debit types are stored as negative numbers; a positive value would flip
    // the accounting direction and corrupt balances.
    this.invalidate("amountCents", `${this.type} must be zero or negative`);
  }
});

const immutableError = () =>
  new Error("LedgerEntry is append-only; create a compensating entry instead.");

// Mongoose 9 no longer passes a `next` callback to document save hooks.
ledgerEntrySchema.pre("save", async function () {
  if (!this.isNew) throw immutableError();
});

for (const hook of [
  "findOneAndUpdate",
  "updateOne",
  "updateMany",
  "findOneAndDelete",
  "findOneAndReplace",
  "replaceOne",
  "deleteOne",
  "deleteMany",
]) {
  ledgerEntrySchema.pre(hook, async function () {
    throw immutableError();
  });
}

ledgerEntrySchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.__v;
  return obj;
};

export default mongoose.model("LedgerEntry", ledgerEntrySchema);
