import Customer from "../models/Customer.js";
import bcrypt from "bcryptjs";
import { generateToken, setAuthCookie } from "../utils/jwt.js";

// REGISTER CUSTOMER
export const registerCustomer = async (req, res) => {
  try {
    const { fullName, email, password } = req.body;

    if (!fullName || !email || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const existingCustomer = await Customer.findOne({ email });
    if (existingCustomer) {
      return res.status(400).json({ message: "Customer already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const customer = await Customer.create({
      fullName,
      email,
      password: hashedPassword
    });

    res.status(201).json({
      message: "Customer registered successfully ✅",
      customer: {
        id: customer._id,
        fullName: customer.fullName,
        email: customer.email
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// LOGIN CUSTOMER
export const loginCustomer = async (req, res) => {
  try {
    const { email, password } = req.body;

    const customer = await Customer.findOne({ email });
    if (!customer) {
      return res.status(400).json({ message: "Invalid email or password" });
    }

    const isMatch = await bcrypt.compare(password, customer.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid email or password" });
    }

    const token = generateToken(customer._id, "customer");
    setAuthCookie(res, token);

    res.json({
      message: "Login successful ✅",
      token,
      customer: {
        id: customer._id,
        fullName: customer.fullName,
        email: customer.email
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

