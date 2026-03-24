// src/controllers/refundController.js
import Order from "../models/Order.js";
import Refund from "../models/Refund.js";
import { sendEmail } from "../utils/emailService.js";

/* =========================================
   CUSTOMER: REQUEST REFUND
========================================= */
export const requestRefund = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { reason } = req.body;

    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });

    // 🔐 Ownership check
    if (order.customer.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }

    // 🔒 Must be paid
    if (order.paymentStatus !== "complete") {
      return res.status(400).json({
        success: false,
        message: "Order not paid — cannot request refund",
      });
    }

    // 🚫 Prevent duplicate requests
    if (order.refundStatus !== "none") {
      return res.status(400).json({
        success: false,
        message: "Refund already requested or processed",
      });
    }

    // Update order refund status
    order.refundStatus = "requested";
    order.refundReason = reason || "";
    await order.save();

    // ✅ Notify Admin(s)
    await sendEmail({
      to: process.env.ADMIN_EMAIL,
      subject: `Refund Requested: Order #${order._id}`,
      html: `<p>Customer <b>${order.customerName || "N/A"}</b> requested a refund for order <b>#${order._id}</b>.</p>
             <p>Reason: ${order.refundReason}</p>`,
    });

    res.json({
      success: true,
      message: "Refund request submitted",
      order,
    });
  } catch (err) {
    console.error("Refund request error:", err);
    res.status(500).json({ success: false, message: "Refund request failed", error: err.message });
  }
};

/* =========================================
   ADMIN: APPROVE + PROCESS REFUND
========================================= */
export const approveRefund = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { reason } = req.body;

    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });

    if (order.refundStatus !== "requested") {
      return res.status(400).json({ success: false, message: "No pending refund request" });
    }

    // 🚨 Prevent payout if already processed
    if (order.payoutStatus === "paid") {
      return res.status(400).json({
        success: false,
        message: "Order already paid out — cannot refund",
      });
    }

    // 🧾 Create refund record
    const refund = await Refund.create({
      order: order._id,
      amount: order.totalAmount,
      reason: reason || order.refundReason,
      admin: req.user._id,
      status: "processed",
      processedAt: new Date(),
    });

    // 💰 Update order
    order.refundStatus = "refunded";
    order.refundAmount = order.totalAmount;
    order.refundedAt = new Date();
    order.vendorPayout = 0;
    order.platformProfit = 0;
    order.payoutLocked = true;
    order.payoutStatus = "unpaid";
    order.status = "cancelled";

    await order.save();

    // ✅ Notify Customer
    await sendEmail({
      to: order.customerEmail,
      subject: `Refund Approved: Order #${order._id}`,
      html: `<p>Your refund for order <b>#${order._id}</b> has been approved.</p>
             <p>Amount: R${order.refundAmount}</p>
             <p>Reason: ${refund.reason}</p>`,
    });

    res.json({
      success: true,
      message: "Refund processed successfully",
      order,
      refund,
    });
  } catch (err) {
    console.error("Refund approval error:", err);
    res.status(500).json({ success: false, message: "Refund processing failed", error: err.message });
  }
};

/* =========================================
   ADMIN: REJECT REFUND
========================================= */
export const rejectRefund = async (req, res) => {
  try {
    const { orderId } = req.params;

    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });

    if (order.refundStatus !== "requested") {
      return res.status(400).json({
        success: false,
        message: "No pending refund request",
      });
    }

    order.refundStatus = "rejected";
    await order.save();

    // ✅ Notify Customer
    await sendEmail({
      to: order.customerEmail,
      subject: `Refund Rejected: Order #${order._id}`,
      html: `<p>Your refund request for order <b>#${order._id}</b> has been rejected.</p>
             <p>Reason: ${order.refundReason || "Not specified"}</p>`,
    });

    res.json({
      success: true,
      message: "Refund rejected",
      order,
    });
  } catch (err) {
    console.error("Refund rejection error:", err);
    res.status(500).json({ success: false, message: "Refund rejection failed", error: err.message });
  }
};

/* =========================================
   ADMIN: GET ALL REFUNDS
========================================= */
export const getRefunds = async (req, res) => {
  try {
    const refunds = await Refund.find()
      .populate("order")
      .populate("admin", "fullName email")
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      count: refunds.length,
      refunds,
    });
  } catch (err) {
    console.error("Fetch refunds error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch refunds", error: err.message });
  }
};