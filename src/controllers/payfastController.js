// src/controllers/payfastController.js
import crypto from "crypto";
import Order from "../models/Order.js";
import { calculateOrderBreakdown } from "../utils/finance.js";

/* ---------------------------
   PAYFAST BASE URL
---------------------------- */
const PAYFAST_URL =
  process.env.PAYFAST_MODE === "sandbox"
    ? "https://sandbox.payfast.co.za/eng/process"
    : "https://www.payfast.co.za/eng/process";

/* ------------------------------------------
   CREATE PAYFAST PAYMENT
   Generates secure payment URL for frontend
------------------------------------------- */
export const createPayfastPayment = async (req, res, next) => {
  try {
    const { orderId } = req.body;
    const order = await Order.findById(orderId);

    if (!order) {
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    }

    if (order.status === "paid") {
      return res
        .status(400)
        .json({ success: false, message: "Order is already paid" });
    }

    const data = {
      merchant_id: process.env.PAYFAST_MERCHANT_ID,
      merchant_key: process.env.PAYFAST_MERCHANT_KEY,
      return_url: process.env.PAYFAST_RETURN_URL,
      cancel_url: process.env.PAYFAST_CANCEL_URL,
      notify_url: process.env.PAYFAST_NOTIFY_URL,
      m_payment_id: order._id.toString(),
      amount: order.totalAmount.toFixed(2),
      item_name: `Order #${order._id}`,
    };

    // 🔐 HMAC-MD5 signature (with optional passphrase)
    const signatureString = Object.keys(data)
      .sort()
      .map((key) => `${key}=${encodeURIComponent(data[key])}`)
      .join("&");

    data.signature = crypto
      .createHmac("md5", process.env.PAYFAST_PASS_PHRASE || "")
      .update(signatureString)
      .digest("hex");

    const queryString = Object.entries(data)
      .map(([key, val]) => `${key}=${encodeURIComponent(val)}`)
      .join("&");

    res.json({
      success: true,
      payfastUrl: `${PAYFAST_URL}?${queryString}`,
      orderId: order._id,
    });
  } catch (err) {
    console.error("🔥 Create PayFast payment error:", err);
    next(err);
  }
};

/* ------------------------------------------
   PAYFAST IPN (Instant Payment Notification)
   Updates order status and financials after payment
------------------------------------------- */
export const handlePayfastIPN = async (req, res, next) => {
  try {
    const ipn = req.body;

    // 🔐 Verify HMAC-MD5 signature
    const signatureString = Object.keys(ipn)
      .filter((k) => k !== "signature")
      .sort()
      .map((key) => `${key}=${encodeURIComponent(ipn[key])}`)
      .join("&");

    const calculatedSignature = crypto
      .createHmac("md5", process.env.PAYFAST_PASS_PHRASE || "")
      .update(signatureString)
      .digest("hex");

    if (calculatedSignature !== ipn.signature) {
      console.warn("❌ Invalid PayFast signature", ipn);
      return res.status(400).send("Invalid signature");
    }

    // 🔎 Find the corresponding order
    const order = await Order.findById(ipn.m_payment_id);
    if (!order) return res.status(404).send("Order not found");

    // ✅ Idempotency: prevent double-processing
    if (order.status === "paid") {
      console.log(`Order ${order._id} already marked as paid`);
      return res.status(200).send("Order already processed");
    }

    // 🔑 Only mark as paid if status is COMPLETE
    if (ipn.payment_status === "COMPLETE") {
      // Recalculate financials to ensure integrity
      const breakdown = calculateOrderBreakdown({
        amount: order.totalAmount,
        commissionPercent: Number(process.env.PLATFORM_COMMISSION_PERCENT) || 5,
      });

      order.status = "paid";
      order.paymentReference = ipn.pf_payment_id || "PayFast";
      order.paidAt = new Date();

      order.commissionAmount = breakdown.commission;
      order.payfastFee = breakdown.payfastFee;
      order.vendorPayout = breakdown.vendorPayout;
      order.platformProfit = breakdown.platformProfit;

      await order.save();

      console.log(`💰 Order ${order._id} marked as PAID`);
    } else {
      console.warn(
        `Order ${order._id} payment status is ${ipn.payment_status} — not marking as paid`
      );
    }

    res.status(200).send("OK");
  } catch (err) {
    console.error("🔥 PayFast IPN error:", err);
    res.status(500).send("Server error");
  }
};