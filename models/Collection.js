import mongoose from "mongoose";
import slugify from "slugify";

const collectionSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    slug: {
      type: String,
      unique: true,
      lowercase: true,
      index: true,
    },
    description: {
      type: String,
      default: "",
      trim: true,
    },
    image: {
      type: String,
      default: "",
    },
    products: [
      {
        product: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Product",
        },
        order: {
          type: Number,
          default: 0,
        },
      },
    ],
    categories: [String],
    vendors: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Vendor",
      },
    ],
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    startDate: {
      type: Date,
    },
    endDate: {
      type: Date,
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
    curatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
    },
  },
  { timestamps: true }
);

collectionSchema.pre("save", function () {
  if (this.isModified("title")) {
    this.slug = slugify(this.title, {
      lower: true,
      strict: true,
    });
  }
});

collectionSchema.index({ isActive: 1, startDate: 1, endDate: 1 });
collectionSchema.index({ isActive: 1, sortOrder: 1 });

export default mongoose.model("Collection", collectionSchema);
