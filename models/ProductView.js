import mongoose from "mongoose";

const productViewSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    sessionId: {
      type: String,
      index: true,
    },
    ipAddress: {
      type: String,
    },
    userAgent: {
      type: String,
    },
  },
  { timestamps: true }
);

productViewSchema.index({ product: 1, createdAt: -1 });
productViewSchema.index({ createdAt: -1 });

export default mongoose.model("ProductView", productViewSchema);
