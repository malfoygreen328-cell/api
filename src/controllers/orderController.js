// src/controllers/orderController.js
import Order from "../models/Order.js";
import Product from "../models/Product.js";
import { calculateOrderBreakdown } from "../utils/finance.js";
import { sendEmail } from "../utils/emailService.js";

/* =========================================
   CREATE ORDER
========================================= */
export const createOrder = async (req, res, next) => {
  try {
    const { products, shippingAddress } = req.body;
    if (!products || products.length === 0) {
      return res.status(400).json({ message: "No products provided" });
    }

    // Fetch product details from DB
    const productIds = products.map((p) => p.productId);
    const dbProducts = await Product.find({ _id: { $in: productIds } });

    let items = [];
    let totalAmount = 0;

    for (const item of products) {
      const product = dbProducts.find((p) => p._id.toString() === item.productId);
      if (!product) {
        return res.status(404).json({ message: `Product not found: ${item.productId}` });
      }

      const quantity = item.quantity || 1;
      const itemTotal = product.price * quantity;
      totalAmount += itemTotal;

      items.push({
        product: product._id,
        vendor: product.vendor,
        name: product.name,
        quantity,
        price: product.price,
      });
    }

    // Calculate commission, vendor payout, platform profit
    const breakdown = calculateOrderBreakdown({
      amount: totalAmount,
      commissionPercent: Number(process.env.PLATFORM_COMMISSION_PERCENT) || 5,
    });

    const order = await Order.create({
      customer: req.user._id,
      customerName: req.user.name,
      customerEmail: req.user.email,
      items,
      totalAmount,
      shippingAddress,
      commissionAmount: breakdown.commission,
      payfastFee: breakdown.payfastFee,
      vendorPayout: breakdown.vendorPayout,
      platformProfit: breakdown.platformProfit,
      paymentStatus: "pending",
      status: "pending",
    });

    res.status(201).json({
      success: true,
      message: "Order created successfully",
      order,
    });
  } catch (err) {
    next(err);
  }
};

/* =========================================
   GET CUSTOMER ORDERS
========================================= */
export const getCustomerOrders = async (req, res, next) => {
  try {
    const orders = await Order.find({ customer: req.user._id })
      .populate("items.product", "name price")
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      count: orders.length,
      orders,
    });
  } catch (err) {
    next(err);
  }
};

/* =========================================
   GET VENDOR ORDERS
========================================= */
export const getVendorOrders = async (req, res, next) => {
  try {
    const orders = await Order.find({ "items.vendor": req.user._id })
      .populate("customer", "name email")
      .populate("items.product", "name price")
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      count: orders.length,
      orders,
    });
  } catch (err) {
    next(err);
  }
};

/* =========================================
   GET ORDER DETAILS
========================================= */
export const getOrderDetails = async (req, res, next) => {
  try {
    const { id } = req.params;

    const order = await Order.findById(id)
      .populate("customer", "name email")
      .populate("items.product", "name price");

    if (!order) return res.status(404).json({ message: "Order not found" });

    if (req.user.role === "customer" && order.customer._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Not authorized" });
    }

    res.json({ success: true, order });
  } catch (err) {
    next(err);
  }
};

/* =========================================
   UPDATE ORDER STATUS
========================================= */
export const updateOrderStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const order = await Order.findById(id);
    if (!order) return res.status(404).json({ message: "Order not found" });

    if (order.paymentStatus !== "complete") {
      return res.status(400).json({ message: "Cannot update order before payment is complete" });
    }

    // Vendor authorization check
    if (req.user.role === "vendor_owner") {
      const hasAccess = order.items.some((item) => item.vendor?.toString() === req.user._id.toString());
      if (!hasAccess) return res.status(403).json({ message: "Not authorized" });
    }

    // Valid status transitions
    const validTransitions = {
      paid: ["processing"],
      processing: ["shipped"],
      shipped: ["delivered"],
    };
    if (validTransitions[order.status] && !validTransitions[order.status].includes(status)) {
      return res.status(400).json({
        message: `Invalid status transition from ${order.status} to ${status}`,
      });
    }

    order.status = status || order.status;
    await order.save();

    // Notify customer via email
    await sendEmail({
      to: order.customerEmail,
      subject: "Order Status Updated",
      html: `<p>Your order <b>${order._id}</b> status has been updated to <b>${order.status}</b>.</p>`,
    });

    res.json({ success: true, message: "Order updated", order });
  } catch (err) {
    next(err);
  }
};

/* =========================================
   CONFIRM PAYMENT
========================================= */
export const confirmPayment = async (req, res, next) => {
  try {
    const { orderId, paymentReference } = req.body;

    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ message: "Order not found" });

    if (order.paymentStatus === "complete") {
      return res.json({ success: true, message: "Payment already confirmed", order });
    }

    order.status = "paid";
    order.paymentStatus = "complete";
    order.paymentReference = paymentReference;
    order.paidAt = new Date();
    await order.save();

    // Notify customer
    await sendEmail({
      to: order.customerEmail,
      subject: "Payment Confirmed",
      html: `<p>Your payment for order <b>${order._id}</b> has been successfully processed.</p>`,
    });

    res.json({ success: true, message: "Payment confirmed", order });
  } catch (err) {
    console.error("Payment confirm error:", err);
    res.status(500).json({ message: "Payment confirmation failed" });
  }
};

/* =========================================
   TRACK ORDER BY REFERENCE
========================================= */
export const trackOrder = async (req, res, next) => {
  try {
    const { reference } = req.params;

    const order = await Order.findOne({
      $or: [{ paymentReference: reference }, { _id: reference }],
    }).populate("items.product", "name price");

    if (!order) return res.status(404).json({ message: "Order not found" });

    res.json({
      success: true,
      tracking: {
        status: order.status,
        paymentStatus: order.paymentStatus,
        shippingAddress: order.shippingAddress,
        refundStatus: order.refundStatus,
        totalAmount: order.totalAmount,
        items: order.items.map((i) => ({
          name: i.name,
          quantity: i.quantity,
          price: i.price,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
};