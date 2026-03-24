import { createPayfastPayment, verifyPayfastWebhook } from "../services/payments/payfastService.js";
import Order from "../models/Order.js";

/* ---------- START PAYMENT ---------- */

export const startPayfastPayment = async (req, res) => {

  try {

    const order = await Order.findById(req.body.orderId);

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    const payment = createPayfastPayment(order);

    res.json(payment);

  } catch (error) {

    res.status(500).json({ message: error.message });

  }
};


/* ---------- PAYFAST WEBHOOK ---------- */

export const payfastWebhook = async (req, res) => {

  try {

    const isValid = await verifyPayfastWebhook(req.body);

    if (!isValid) {
      return res.status(400).send("Invalid payment");
    }

    const orderId = req.body.m_payment_id;

    await Order.findByIdAndUpdate(orderId, {
      paymentStatus: "paid",
      orderStatus: "processing"
    });

    res.sendStatus(200);

  } catch (error) {

    console.error("PayFast webhook error:", error.message);
    res.sendStatus(500);

  }
};