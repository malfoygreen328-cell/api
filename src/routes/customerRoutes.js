import express from "express";
import Customer from "../models/Customer.js";
import Cart from "../models/Cart.js";
import Product from "../models/Product.js";
import Order from "../models/Order.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const router = express.Router();

/* REGISTER CUSTOMER */
router.post("/register", async (req, res) => {
  try {
    const { fullName, email, password, phone } = req.body;
    if (!fullName || !email || !password) return res.status(400).json({ message: "All fields required" });

    const existing = await Customer.findOne({ email });
    if (existing) return res.status(400).json({ message: "Email already registered" });

    const customer = new Customer({ fullName, email, password, phone });
    await customer.save();

    res.status(201).json({ message: "Customer registered successfully" });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

/* LOGIN CUSTOMER */
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const customer = await Customer.findOne({ email }).select("+password");
    if (!customer) return res.status(400).json({ message: "Invalid credentials" });

    const isMatch = await customer.comparePassword(password);
    if (!isMatch) return res.status(400).json({ message: "Invalid credentials" });

    const token = jwt.sign({ id: customer._id }, process.env.JWT_SECRET, { expiresIn: "7d" });

    res.json({ message: "Login successful", token, customer });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

/* ADD TO CART */
router.post("/cart", async (req, res) => {
  try {
    const { customerId, productId, quantity } = req.body;
    if (!customerId || !productId) return res.status(400).json({ message: "Missing parameters" });

    const product = await Product.findById(productId);
    if (!product) return res.status(404).json({ message: "Product not found" });

    let cart = await Cart.findOne({ customer: customerId });
    if (!cart) {
      cart = new Cart({ customer: customerId, items: [] });
    }

    const existingIndex = cart.items.findIndex((item) => item.product.toString() === productId);
    if (existingIndex > -1) {
      cart.items[existingIndex].quantity += quantity || 1;
    } else {
      cart.items.push({ product: productId, quantity: quantity || 1 });
    }

    await cart.save();
    res.json({ message: "Added to cart", cart });
  } catch (error) {
    res.status(500).json({ message: "Failed to add to cart", error: error.message });
  }
});

/* GET CART */
router.get("/cart/:customerId", async (req, res) => {
  try {
    const cart = await Cart.findOne({ customer: req.params.customerId }).populate("items.product");
    if (!cart) return res.status(404).json({ message: "Cart is empty" });
    res.json(cart);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch cart", error: error.message });
  }
});

/* CHECKOUT */
router.post("/checkout", async (req, res) => {
  try {
    const { customerId, shippingAddress } = req.body;
    if (!customerId || !shippingAddress) return res.status(400).json({ message: "Missing parameters" });

    const cart = await Cart.findOne({ customer: customerId }).populate("items.product");
    if (!cart || cart.items.length === 0) return res.status(400).json({ message: "Cart is empty" });

    const totalAmount = cart.items.reduce((sum, item) => sum + item.product.price * item.quantity, 0);

    const order = new Order({
      userId: customerId,
      items: cart.items.map((i) => ({
        product: i.product._id,
        name: i.product.name,
        price: i.product.price,
        quantity: i.quantity,
      })),
      totalAmount,
      shippingAddress,
      status: "Pending",
    });

    await order.save();

    // Clear cart
    cart.items = [];
    await cart.save();

    res.json({ message: "Order placed successfully", order });
  } catch (error) {
    res.status(500).json({ message: "Checkout failed", error: error.message });
  }
});

export default router;