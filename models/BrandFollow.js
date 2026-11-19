import mongoose from "mongoose";

const brandFollowSchema = new mongoose.Schema(
  {
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    store: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Store",
      required: true,
    },
    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vendor",
    },
  },
  { timestamps: true }
);

brandFollowSchema.index({ customer: 1, store: 1 }, { unique: true });
brandFollowSchema.index({ customer: 1 });
brandFollowSchema.index({ store: 1 });
brandFollowSchema.index({ vendor: 1 });

export default mongoose.model("BrandFollow", brandFollowSchema);
