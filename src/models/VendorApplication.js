import mongoose from "mongoose";

const vendorApplicationSchema = new mongoose.Schema({

  name: String,
  email: String,
  password: String,
  phone: String,

  businessName: String,
  businessType: String,
  registrationNumber: String,
  taxNumber: String,
  address: String,

  documents: [String],

  status: {
    type: String,
    enum: ["pending", "approved", "rejected"],
    default: "pending"
  }

}, { timestamps: true });

export default mongoose.model("VendorApplication", vendorApplicationSchema);