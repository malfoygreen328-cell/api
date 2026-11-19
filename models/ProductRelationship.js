import mongoose from "mongoose";

const productRelationshipSchema = new mongoose.Schema(
  {
    sourceProduct: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
      index: true,
    },
    relatedProduct: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
      index: true,
    },
    relationshipType: {
      type: String,
      enum: [
        "complete_the_look",
        "shop_the_look",
        "similar",
        "frequently_bought_together",
        "complementary",
        "curated",
      ],
      required: true,
      index: true,
    },
    strength: {
      type: Number,
      default: 1.0,
      min: 0,
      max: 1.0,
    },
    curatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

productRelationshipSchema.index({ sourceProduct: 1, relationshipType: 1, isActive: 1 });
productRelationshipSchema.index({ sourceProduct: 1, relatedProduct: 1, relationshipType: 1 }, { unique: true });

export default mongoose.model("ProductRelationship", productRelationshipSchema);
