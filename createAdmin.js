// createAdmin.js
// Creates a single admin account from environment variables.
// NOTE: previously this file hardcoded a live Atlas URI + admin password.
// They are removed; set MONGO_URI / ADMIN_* in .env instead (rotate the
// old credentials - they were exposed in source).
import mongoose from "mongoose";
import dotenv from "dotenv";
import Admin from "./src/models/Admin.js";

dotenv.config(); // loads .env with MONGO_URI

const mongoURI = process.env.MONGO_URI;
if (!mongoURI) {
  console.error("MONGO_URI is not set. Add it to your .env file.");
  process.exit(1);
}

const createAdmin = async () => {
  try {
    await mongoose.connect(mongoURI);
    console.log("MongoDB connected successfully");

    const adminEmail = (process.env.ADMIN_EMAIL || "admin@azaniashop.co.za").toLowerCase();
    const adminPassword = process.env.ADMIN_PASSWORD;
    if (!adminPassword || adminPassword.length < 8) {
      console.error("ADMIN_PASSWORD must be set (min 8 chars) in .env.");
      process.exit(1);
    }

    const existing = await Admin.findOne({ email: adminEmail });
    if (existing) {
      console.log("Admin already exists:", existing.email);
      process.exit(0);
    }

    const admin = new Admin({
      fullName: "Azania Admin",
      email: adminEmail,
      password: adminPassword,
      role: "admin",
    });

    await admin.save(); // triggers pre('save') password hashing
    console.log("Admin created successfully:", admin.email);

    process.exit(0);
  } catch (err) {
    console.error("Error creating admin:", err);
    process.exit(1);
  }
};

createAdmin();