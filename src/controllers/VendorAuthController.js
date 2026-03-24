const Vendor = require("../models/Vendor");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

// REGISTER VENDOR
exports.registerVendor = async (req, res) => {
  try {
    const { storeName, email, password } = req.body;

    if (!storeName || !email || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const existingVendor = await Vendor.findOne({ email });
    if (existingVendor) {
      return res.status(400).json({ message: "Vendor already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const vendor = await Vendor.create({
      storeName,
      email,
      password: hashedPassword
    });

    res.status(201).json({
      message: "Vendor registered successfully 🚀",
      vendor: {
        id: vendor._id,
        storeName: vendor.storeName,
        email: vendor.email
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// LOGIN VENDOR
exports.loginVendor = async (req, res) => {
  try {
    const { email, password } = req.body;

    const vendor = await Vendor.findOne({ email });
    if (!vendor) {
      return res.status(400).json({ message: "Invalid email or password" });
    }

    const isMatch = await bcrypt.compare(password, vendor.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid email or password" });
    }

    const token = jwt.sign(
      { id: vendor._id },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      message: "Login successful ✅",
      token,
      vendor: {
        id: vendor._id,
        storeName: vendor.storeName,
        email: vendor.email
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
