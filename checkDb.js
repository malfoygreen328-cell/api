// checkDb.js
import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

// Import models correctly
import Admin from "./src/models/Admin.js";
import User from "./src/models/User.js";
import Vendor from "./src/models/Vendor.js";

// MongoDB connection URI
const MONGO_URI =
  process.env.MONGO_URI || "mongodb://127.0.0.1:27017/azania";

async function checkDb() {
  try {
    // ✅ FIXED: No deprecated options
    await mongoose.connect(MONGO_URI);

    console.log("✅ MongoDB connected successfully");

    // Check Admins
    const admins = await Admin.find().select("-password");
    console.log("🧑‍💼 Admins:", admins);

    // Check Users
    const users = await User.find().select("-password");
    console.log("👤 Users:", users);

    // Check Vendors
    const vendors = await Vendor.find().select("-password");
    console.log("🏪 Vendors:", vendors);

    console.log("✅ Database check complete");
    process.exit(0);
  } catch (err) {
    console.error("❌ Database check failed:", err.message);
    process.exit(1);
  }
}

checkDb();