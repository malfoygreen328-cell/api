// src/models/VendorPayout.js
import mongoose from "mongoose";

const vendorPayoutSchema = new mongoose.Schema(
  {
    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vendor",
      required: true,
    },
    orders: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Order",
        required: true,
      },
    ],
    totalAmount: { type: Number, required: true },
    commission: { type: Number, required: true },
    payfastFee: { type: Number, required: true },
    vendorPayout: { type: Number, required: true },
    payoutStatus: {
      type: String,
      enum: ["unpaid", "processing", "paid"],
      default: "unpaid",
    },
    payoutDate: { type: Date },
  },
  { timestamps: true }
);

export default mongoose.model("VendorPayout", vendorPayoutSchema);