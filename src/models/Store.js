import mongoose from "mongoose";
import slugify from "slugify";

const storeSchema = new mongoose.Schema({
  vendor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Vendor",
    required: true,
    unique: true,
  },

  storeName: {
    type: String,
    required: true,
    trim: true,
  },

  storeSlug: {
    type: String,
    unique: true,
    lowercase: true,
    index: true,
  },

  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  },

  logo: { type: String, default: "" },
  banner: { type: String, default: "" },

  themeColor: {
    type: String,
    default: "#004225",
    match: [/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, "Invalid hex color"],
  },

  createdAt: {
    type: Date,
    default: Date.now
  },

  description: {
    type: String,
    trim: true,
    default: "",
  },

  socialLinks: {
    instagram: { type: String, default: "" },
    facebook: { type: String, default: "" },
    website: { type: String, default: "" },
  },
}, { timestamps: true });

storeSchema.pre("save", async function (next) {
  if (this.isModified("storeName")) {
    const baseSlug = slugify(this.storeName, {
      lower: true,
      strict: true,
    });

    let slug = baseSlug;
    let counter = 1;

    while (await mongoose.models.Store.findOne({ storeSlug: slug })) {
      slug = `${baseSlug}-${counter++}`;
    }

    this.storeSlug = slug;
  }
  next();
});

storeSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.__v;
  return obj;
};

export default mongoose.model("Store", storeSchema);