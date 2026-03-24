import express from "express";
import Stripe from "stripe";
import Cart from "../models/Cart.js";
import Product from "../models/Product.js";
import Order from "../models/Order.js";

const router = express.Router();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

/**
 * POST /api/checkout
 * Multi-vendor checkout with Stripe
 */
router.post("/", async (req, res) => {
  try {
    const { customerId, shippingAddress } = req.body;
    if (!customerId || !shippingAddress)
      return res.status(400).json({ message: "Missing parameters" });

    const cart = await Cart.findOne({ customer: customerId }).populate("items.product");
    if (!cart || cart.items.length === 0)
      return res.status(400).json({ message: "Cart is empty" });

    let totalAmount = 0;
    let commissionAmount = 0;

    // Create order items
    const orderItems = cart.items.map((item) => {
      const price = item.product.price * item.quantity;
      const commission = (price * process.env.PLATFORM_COMMISSION_PERCENT) / 100;
      totalAmount += price;
      commissionAmount += commission;

      return {
        product: item.product._id,
        vendor: item.product.vendor, // assuming Product has vendor ref
        name: item.product.name,
        price: item.product.price,
        quantity: item.quantity,
      };
    });

    // Create Stripe PaymentIntent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(totalAmount * 100), // in cents
      currency: "usd",
      metadata: { customerId },
    });

    // Create Order in DB (status Pending)
    const order = new Order({
      customer: customerId,
      items: orderItems,
      totalAmount,
      shippingAddress,
      commissionAmount,
    });
    await order.save();

    // Clear cart
    cart.items = [];
    await cart.save();

    res.json({
      message: "Checkout initiated",
      orderId: order._id,
      clientSecret: paymentIntent.client_secret, // for front-end Stripe
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Checkout failed", error: error.message });
  }
});

export default router;