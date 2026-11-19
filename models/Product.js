import mongoose from "mongoose";

const productSchema = new mongoose.Schema(
  {
    store: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Store",
      required: true,
    },

    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vendor",
      default: null,
      index: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
    },

    description: {
      type: String,
      default: "",
    },

    price: {
      type: Number,
      required: true,
    },

    stock: {
      type: Number,
      default: 0,
    },

    createdAt: {
      type: Date,
      default: Date.now,
    },

    images: [String],

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    category: {
      type: String,
      trim: true,
      index: true,
    },
    subcategory: {
      type: String,
      trim: true,
      index: true,
    },
    tags: {
      type: [String],
      default: [],
      index: true,
    },
    attributes: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    gender: {
      type: String,
      enum: ["men", "women", "unisex", "kids"],
      index: true,
    },
    productType: {
      type: String,
      trim: true,
      index: true,
    },
    color: {
      type: String,
      trim: true,
    },
    colors: {
      type: [String],
      default: [],
    },
    sizes: {
      type: [String],
      default: [],
    },
    size: {
      type: String,
      trim: true,
    },
    brand: {
      type: String,
      trim: true,
    },
    featured: {
      type: Boolean,
      default: false,
      index: true,
    },
    trending: {
      type: Boolean,
      default: false,
      index: true,
    },
    salePrice: {
      type: Number,
    },
    rating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },
    reviewCount: {
      type: Number,
      default: 0,
    },
    soldCount: {
      type: Number,
      default: 0,
      index: true,
    },
    views: {
      type: Number,
      default: 0,
      index: true,
    },
    isOutOfStock: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  { timestamps: true }
);

// Text index to power /api/products/search ( query)
productSchema.index({ name: "text", description: "text", tags: "text" });
productSchema.index({ vendor: 1, isActive: 1 });
productSchema.index({ category: 1, subcategory: 1, isActive: 1 });
productSchema.index({ price: 1, isActive: 1 });
productSchema.index({ soldCount: 1, isActive: 1 });
productSchema.index({ createdAt: -1, isActive: 1 });
productSchema.index({ views: 1, isActive: 1 });

export default mongoose.model("Product", productSchema);
