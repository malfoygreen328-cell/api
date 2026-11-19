// src/services/refundService.js
import Order from "../models/Order.js";
import Refund from "../models/Refund.js";

export const processRefund = async ({
  orderId,
  adminId,
  reason,
}) => {
  const order = await Order.findById(orderId);

  if (!order) throw new Error("Order not found");

  if (!order.canBeRefunded()) {
    throw new Error("Order not eligible for refund");
  }

  // Create refund record
  const refund = await Refund.create({
    order: order._id,
    amount: order.totalAmount,
    reason,
    admin: adminId,
  });

  // 🔥 CRITICAL: Update order
  order.refundStatus = "refunded";
  order.refundAmount = order.totalAmount;
  order.refundedAt = new Date();

  // Lock money
  order.vendorPayout = 0;
  order.platformProfit = 0;
  order.payoutLocked = true;
  order.status = "cancelled";

  await order.save();

  return { order, refund };
};