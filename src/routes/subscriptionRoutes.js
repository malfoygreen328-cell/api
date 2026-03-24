import express from "express";
import Stripe from "stripe";
import { verifyToken, requireRole } from "../middleware/authMiddleware.js";
import Vendor from "../models/Vendor.js";

const router = express.Router();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// Protect routes for vendors
router.use(verifyToken, requireRole("vendor_owner"));

/* ---------------- GET CURRENT SUBSCRIPTION ---------------- */
router.get("/", async (req, res) => {
  try {
    const { subscriptionPlan, subscriptionLimit } = req.user;
    res.json({ subscriptionPlan, subscriptionLimit });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch subscription", error: error.message });
  }
});

/* ---------------- UPGRADE TO PREMIUM ---------------- */
router.post("/upgrade", async (req, res) => {
  try {
    if (req.user.subscriptionPlan === "Premium") {
      return res.status(400).json({ message: "Already on Premium plan" });
    }

    const amount = parseInt(process.env.PREMIUM_PLAN_PRICE) * 100; // cents

    // Create Stripe PaymentIntent
    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency: "usd",
      metadata: { vendorId: req.user._id.toString(), plan: "Premium" },
    });

    res.json({
      message: "Payment initiated",
      clientSecret: paymentIntent.client_secret,
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to initiate upgrade", error: error.message });
  }
});

/* ---------------- CONFIRM PAYMENT WEBHOOK ---------------- */
// In production, you should implement Stripe webhooks to confirm successful payment
// For simplicity, here we simulate a confirmation endpoint
router.post("/confirm", async (req, res) => {
  try {
    const { vendorId } = req.body; // in real world, use Stripe webhook event
    const vendor = await Vendor.findById(vendorId);
    if (!vendor) return res.status(404).json({ message: "Vendor not found" });

    vendor.subscriptionPlan = "Premium";
    vendor.subscriptionLimit = 0; // unlimited
    await vendor.save();

    res.json({ message: "Subscription upgraded to Premium", vendor });
  } catch (error) {
    res.status(500).json({ message: "Failed to confirm subscription", error: error.message });
  }
});

export default router;