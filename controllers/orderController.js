// src/controllers/orderController.js
import Order from "../models/Order.js";
import Product from "../models/Product.js";
import Vendor from "../models/Vendor.js";
import {
  calculateOrderBreakdown,
  calculateCommissionCents,
  fromCents,
  toCents,
  getPaymentFeePolicy,
} from "../utils/finance.js";
import {
  getCommissionRateForVendor,
  resolveSettlementCommissionPercent,
} from "../config/platformConfig.js";
import { sendEmail } from "../utils/emailService.js";
import { verifyPayment } from "../services/payments/payfastService.js";
import {
  settleVerifiedPayment,
  PaymentSettlementError,
} from "../services/paymentSettlementService.js";
import mongoose from "mongoose";

const VENDOR_ID = (user) => String(user?.vendorId || user?.vendor || user?._id || "");

const normalizeShippingAddress = (value) => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length >= 5 ? trimmed.slice(0, 500) : "";
  }
  if (!value || typeof value !== "object") return "";
  const required = ["fullName", "address", "city", "postal", "country"];
  for (const field of required) {
    if (!String(value[field] || "").trim()) return "";
  }
  return required
    .map((field) => String(value[field]).trim())
    .concat(value.email ? [String(value.email).trim()] : [])
    .join(", ")
    .slice(0, 500);
};

/* =========================================
   CREATE ORDER
========================================= */
export const createOrder = async (req, res, next) => {
  try {
    const { products, shippingAddress } = req.body || {};

    if (!Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ message: "No products provided" });
    }

    const normalizedAddress = normalizeShippingAddress(shippingAddress);
    if (!normalizedAddress) {
      return res.status(400).json({ message: "A complete shipping address is required" });
    }

    // Validate client-supplied quantities before any DB work
    for (const item of products) {
      if (!mongoose.Types.ObjectId.isValid(item?.productId)) {
        return res.status(400).json({ message: `Invalid product id: ${item?.productId}` });
      }
      const qty = Number(item.quantity);
      if (!item.quantity || !Number.isInteger(qty) || qty < 1 || qty > 99) {
        return res.status(400).json({ message: `Quantity must be a whole number between 1 and 99 for ${item.productId}` });
      }
    }

    const productIds = [...new Set(products.map((p) => String(p.productId)))];
    const dbProducts = await Product.find({ _id: { $in: productIds } }).populate("store", "vendor");

    if (dbProducts.length !== productIds.length) {
      return res.status(404).json({ message: "One or more products could not be found" });
    }

    const productsById = new Map(dbProducts.map((p) => [p._id.toString(), p]));

    const items = [];
    let totalCents = 0;

    for (const requested of products) {
      const product = productsById.get(String(requested.productId));
      if (!product) {
        return res.status(404).json({ message: `Product not found: ${requested.productId}` });
      }

      if (product.isActive === false) {
        return res.status(400).json({ message: `Product is not available: ${product.name}` });
      }

      const quantity = Number(requested.quantity);
      const priceCents = toCents(product.price);
      if (priceCents === null || priceCents <= 0) {
        return res.status(400).json({ message: `Product has an invalid price: ${product.name}` });
      }

      // Stock is validated at order creation. Stock is decremented only once
      // the payment is verified and settled.
      if (Number.isFinite(Number(product.stock)) && Number(product.stock) < quantity) {
        return res.status(400).json({
          message: `Only ${Math.max(0, Number(product.stock))} left of ${product.name}`,
        });
      }

      const vendor = product.vendor || product.store?.vendor || null;
      if (!vendor) {
        return res.status(400).json({ message: `Product has no vendor: ${product.name}` });
      }

      const itemCents = priceCents * quantity;
      totalCents += itemCents;

      // Prices are always fetched from the DB - never from the client.
      items.push({
        product: product._id,
        vendor,
        name: product.name,
        quantity,
        price: fromCents(priceCents),
      });
    }

    if (totalCents <= 0) {
      return res.status(400).json({ message: "Invalid order total" });
    }

    // Effective commission percent: each vendor can carry a founding/locked
    // rate, so the order percent is the amount-weighted blend of per-vendor
    // rates. Clients can never influence it - rates come from the Vendor docs
    // and platform config only.
    const vendorIds = [...new Set(items.map((i) => String(i.vendor)))];
    const vendorDocs = await Vendor.find({ _id: { $in: vendorIds } }).select(
      "foundingVendor foundingVendorSince commissionRateLocked lockedCommissionRate"
    );
    const vendorById = new Map(vendorDocs.map((v) => [v._id.toString(), v]));

    let weightedRate = 0;
    for (const item of items) {
      const vendorDoc = vendorById.get(String(item.vendor));
      const rate = getCommissionRateForVendor(vendorDoc);
      const itemCents = toCents(item.price) * item.quantity;
      weightedRate += (rate * itemCents) / totalCents;
    }
    const commissionPercent = Math.round(weightedRate * 100 * 1e6) / 1e6;

    // The provider fee is NOT known at order creation. The breakdown is
    // therefore provisional/blocked and no vendor payout is finalised here.
    const feePolicy = getPaymentFeePolicy("card");
    const breakdown = calculateOrderBreakdown({
      customerTransactionAmount: fromCents(totalCents),
      eligibleVendorSubtotal: fromCents(totalCents),
      commissionPercent,
      paymentMethod: "card",
    });

    const creationSettlementStatus =
      breakdown.feeStatus === "estimated" ? "provisional" : "blocked";

    // Build one vendorOrder per vendor. The single provider fee is applied at
    // transaction level on settlement - never duplicated across vendors.
    const vendorOrderMap = new Map();
    for (const item of items) {
      const vId = String(item.vendor);
      if (!vendorOrderMap.has(vId)) {
        vendorOrderMap.set(vId, { vendor: item.vendor, items: [] });
      }
      vendorOrderMap.get(vId).items.push({
        product: item.product,
        name: item.name,
        quantity: item.quantity,
        price: item.price,
      });
    }

    const vendorOrders = [];
    let provisionalPayoutCents = 0;
    let commissionCentsTotal = 0;

    for (const [vId, vo] of vendorOrderMap.entries()) {
      const vendorDoc = vendorById.get(vId);
      const ratePercent = getCommissionRateForVendor(vendorDoc) * 100;
      const subTotalCents = vo.items.reduce(
        (sum, it) => sum + toCents(it.price) * it.quantity,
        0
      );
      const commissionCents = calculateCommissionCents(subTotalCents, ratePercent);
      const provisionalPayout = subTotalCents - commissionCents;
      provisionalPayoutCents += provisionalPayout;
      commissionCentsTotal += commissionCents;

      vendorOrders.push({
        vendor: vo.vendor,
        items: vo.items,
        subTotal: fromCents(subTotalCents),
        commissionPercent: Math.round(ratePercent * 1e6) / 1e6,
        commissionAmount: fromCents(commissionCents),
        payfastFee: 0,
        vendorPayout: 0,
        provisionalVendorPayout: fromCents(provisionalPayout),
        platformProfit: 0,
        platformNetCents: null,
        settlementStatus: creationSettlementStatus,
        feeStatus: breakdown.feeStatus,
        feeBearer: breakdown.feeBearer,
        providerFeeCents: null,
        status: "pending",
        payoutStatus: "unpaid",
        payoutLocked: true,
      });
    }

    const order = await Order.create({
      customer: req.user._id,
      customerName: req.user.name || req.user.fullName || "Customer",
      customerEmail: req.user.email,
      items,
      totalAmount: fromCents(totalCents),
      shippingAddress: normalizedAddress,
      commissionPercent: breakdown.commissionPercent,
      commissionAmount: fromCents(commissionCentsTotal),
      payfastFee: 0,
      vendorPayout: 0,
      provisionalVendorPayout: fromCents(provisionalPayoutCents),
      platformProfit: 0,
      platformNetCents: null,
      settlementStatus: creationSettlementStatus,
      feeStatus: breakdown.feeStatus,
      feeBearer: breakdown.feeBearer,
      feeAllocationStatus:
        feePolicy.feeBearer === "marketplace" ? "not_required" : "unresolved",
      providerFeeCents: null,
      payoutLocked: true,
      vendorOrders,
      paymentStatus: "pending",
      status: "pending",
    });

    res.status(201).json({
      success: true,
      message: "Order created successfully",
      order: customerOrderView(order),
    });
  } catch (err) {
    next(err);
  }
};

/* =========================================
   GET CUSTOMER ORDERS
========================================= */

// Customer-facing orders must never expose marketplace financial internals
// (commission rate/amount, provider fee, platform profit, vendor payout).
const customerVendorOrderView = (vo = {}) => ({
  _id: vo._id,
  vendor: vo.vendor,
  items: vo.items,
  subTotal: vo.subTotal,
  status: vo.status,
  trackingNumber: vo.trackingNumber,
  shippingCarrier: vo.shippingCarrier,
  payoutStatus: vo.payoutStatus,
});

const customerOrderView = (order = {}) => {
  const source = typeof order.toObject === "function" ? order.toObject() : order;
  return {
    _id: source._id,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
    items: source.items,
    totalAmount: source.totalAmount,
    status: source.status,
    paymentStatus: source.paymentStatus,
    refundStatus: source.refundStatus,
    shippingAddress: source.shippingAddress,
    trackingNumber: source.trackingNumber,
    shippingCarrier: source.shippingCarrier,
    customerName: source.customerName,
    vendorOrders: (source.vendorOrders || []).map(customerVendorOrderView),
  };
};

export const getCustomerOrders = async (req, res, next) => {
  try {
    const orders = await Order.find({ customer: req.user._id })
      .populate("items.product", "name price")
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      count: orders.length,
      orders: orders.map(customerOrderView),
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
    const vendorId = VENDOR_ID(req.user);
    if (!vendorId) {
      return res.status(403).json({ success: false, message: "Vendor context missing" });
    }

    // Only the requesting vendor's suborders are returned. Other vendors'
    // items, financials and full customer records are never exposed.
    const orders = await Order.find({ "vendorOrders.vendor": vendorId })
      .select(
        "customerName customerEmail shippingAddress trackingNumber shippingCarrier createdAt paymentStatus refundStatus status vendorOrders"
      )
      .sort({ createdAt: -1 })
      .lean();

    const data = orders
      .map((order) => {
        const vo = (order.vendorOrders || []).find(
          (row) => String(row.vendor) === vendorId
        );
        if (!vo) return null;
        return {
          _id: order._id,
          createdAt: order.createdAt,
          paymentStatus: order.paymentStatus,
          refundStatus: order.refundStatus,
          orderStatus: order.status,
          status: vo.status,
          shippingAddress: order.shippingAddress,
          trackingNumber: vo.trackingNumber || order.trackingNumber,
          shippingCarrier: vo.shippingCarrier || order.shippingCarrier,
          customer: {
            name: order.customerName,
            email: order.customerEmail,
          },
          items: vo.items,
          subTotal: vo.subTotal,
          commissionPercent: vo.commissionPercent,
          commissionAmount: vo.commissionAmount,
          payfastFee: vo.payfastFee,
          vendorPayout: vo.vendorPayout,
          provisionalVendorPayout: vo.provisionalVendorPayout,
          settlementStatus: vo.settlementStatus,
          payoutStatus: vo.payoutStatus,
          payoutLocked: vo.payoutLocked,
        };
      })
      .filter(Boolean);

    res.json({
      success: true,
      count: data.length,
      orders: data,
    });
  } catch (err) {
    next(err);
  }
};

/* =========================================
   GET ORDER DETAILS
   Authorization:
   - customer: own orders only
   - vendor_owner/staff: orders containing their items
   - admin/superadmin: any order
========================================= */
export const getOrderDetails = async (req, res, next) => {
  try {
    const { id } = req.params;

    const order = await Order.findById(id)
      .populate("customer", "name email")
      .populate("items.product", "name price");

    if (!order) return res.status(404).json({ message: "Order not found" });

    const isAdmin = ["admin", "superadmin"].includes(req.user.role);
    const isCustomerOwner =
      order.customer && order.customer._id?.toString() === req.user._id?.toString();
    const vendorId = VENDOR_ID(req.user);
    const vendorOrder = (order.vendorOrders || []).find(
      (vo) => String(vo.vendor) === vendorId
    );
    const isVendorInOrder = Boolean(vendorOrder);

    if (!isAdmin && !isCustomerOwner && !isVendorInOrder) {
      return res.status(403).json({ message: "Not authorized" });
    }

    if (!isAdmin && !isCustomerOwner) {
      return res.json({
        success: true,
        order: {
          _id: order._id,
          createdAt: order.createdAt,
          status: vendorOrder.status,
          orderStatus: order.status,
          paymentStatus: order.paymentStatus,
          refundStatus: order.refundStatus,
          shippingAddress: order.shippingAddress,
          trackingNumber: vendorOrder.trackingNumber || order.trackingNumber,
          shippingCarrier: vendorOrder.shippingCarrier || order.shippingCarrier,
          customer: {
            name: order.customerName,
            email: order.customerEmail,
          },
          items: vendorOrder.items,
          subTotal: vendorOrder.subTotal,
          commissionPercent: vendorOrder.commissionPercent,
          commissionAmount: vendorOrder.commissionAmount,
          vendorPayout: vendorOrder.vendorPayout,
          provisionalVendorPayout: vendorOrder.provisionalVendorPayout,
          settlementStatus: vendorOrder.settlementStatus,
          payoutStatus: vendorOrder.payoutStatus,
        },
      });
    }

    if (isCustomerOwner && !isAdmin) {
      return res.json({ success: true, order: customerOrderView(order) });
    }

    res.json({ success: true, order });
  } catch (err) {
    next(err);
  }
};

/* =========================================
   UPDATE ORDER STATUS (controller used by PATCH)
   Vendor: may only advance status of their own orders
           (paid → processing → shipped → delivered,
           or cancel a pending order).
   Admin:  same transition set, any order, plus explicit
           paid/cancelled control.
========================================= */
const VALID_ORDER_STATUSES = ["pending", "paid", "processing", "shipped", "delivered", "cancelled"];

const VALID_TRANSITIONS = {
  pending: ["paid", "cancelled"],
  paid: ["processing", "cancelled"],
  processing: ["shipped", "cancelled"],
  shipped: ["delivered"],
  delivered: [],
  cancelled: [],
};

const aggregateVendorStatus = (vendorOrders = []) => {
  if (!vendorOrders.length) return "pending";
  const statuses = vendorOrders.map((vo) => vo.status);
  if (statuses.every((s) => s === "cancelled")) return "cancelled";
  if (statuses.every((s) => s === "delivered")) return "delivered";
  if (statuses.every((s) => ["shipped", "delivered"].includes(s))) return "shipped";
  if (statuses.every((s) => ["processing", "shipped", "delivered"].includes(s))) {
    return "processing";
  }
  if (statuses.every((s) => s === "paid")) return "paid";
  return "pending";
};

export const updateOrderStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body || {};

    if (!status) {
      return res.status(400).json({ message: "Status is required" });
    }
    if (!VALID_ORDER_STATUSES.includes(status)) {
      return res.status(400).json({ message: "Invalid order status" });
    }

    const order = await Order.findById(id);
    if (!order) return res.status(404).json({ message: "Order not found" });

    const isAdmin = ["admin", "superadmin"].includes(req.user.role);
    const vendorId = VENDOR_ID(req.user);
    const vendorOrder = (order.vendorOrders || []).find(
      (vo) => String(vo.vendor) === vendorId
    );

    if (!isAdmin && !vendorOrder) {
      return res.status(403).json({ message: "Not authorized" });
    }

    // Vendors cannot mark orders paid or flip them back to pending
    if (!isAdmin && ["pending", "paid"].includes(status)) {
      return res.status(403).json({ message: "Only admins may set the paid/pending status" });
    }

    const currentStatus = isAdmin ? order.status : vendorOrder.status;

    if (currentStatus === status) {
      return res.json({ success: true, message: "Order is already in that status", order });
    }

    if (!(VALID_TRANSITIONS[currentStatus] || []).includes(status)) {
      return res.status(400).json({
        message: `Invalid status transition from ${currentStatus} to ${status}`,
      });
    }

    // Cancels only apply to unpaid orders; paid orders must go through refunds.
    if (status === "cancelled" && order.paymentStatus === "complete") {
      return res.status(400).json({ message: "A paid order cannot be cancelled; submit a refund instead" });
    }

    // "paid" is set exclusively by the verified IPN/settlement path.
    if (status === "paid" && order.paymentStatus !== "complete") {
      return res.status(400).json({ message: "An order can only be marked paid after a verified payment" });
    }

    if (isAdmin) {
      order.status = status;
      for (const vo of order.vendorOrders || []) {
        vo.status = status;
      }
    } else {
      vendorOrder.status = status;
      order.status = aggregateVendorStatus(order.vendorOrders);
    }

    await order.save();

    try {
      await sendEmail({
        to: order.customerEmail,
        subject: "Order Status Updated",
        html: `<p>Your order <b>${order._id}</b> status has been updated to <b>${order.status}</b>.</p>`,
      });
    } catch (emailErr) {
      console.warn("Status email failed to send", emailErr.message);
    }

    res.json({ success: true, message: "Order updated", order });
  } catch (err) {
    next(err);
  }
};

/* =========================================
   CONFIRM PAYMENT (POST /api/orders/confirm)
   The IPN marks orders paid asynchronously. This endpoint is a safe
   poll for the frontend: it NEVER marks an order paid purely on client
   assertion. It re-verifies with PayFast (Query API) when the IPN has
   not arrived yet, and only then settles the order.
========================================= */
export const confirmPayment = async (req, res, next) => {
  try {
    const { orderId } = req.body;

    if (!orderId) {
      return res.status(400).json({ message: "orderId is required" });
    }

    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ message: "Order not found" });

    // Object-level authorization: customers may only confirm their own orders
    if (order.customer?.toString() !== req.user?._id?.toString()) {
      return res.status(403).json({ message: "Not authorized for this order" });
    }

    if (order.paymentStatus === "complete") {
      return res.json({ success: true, message: "Payment already confirmed", order });
    }

    // Never trust the client: verify against PayFast unless the IPN already
    // settled this order. Verification failure or unavailable gateway = stay pending.
    let verification;
    try {
      verification = await verifyPayment({
        mPaymentId: order._id,
        amount: order.totalAmount,
      });
    } catch (err) {
      console.warn("PayFast verification error", { error: err.message, orderId: order._id });
      return res.status(502).json({
        success: false,
        message: "Payment could not be verified right now. Try again shortly.",
      });
    }

    if (!verification || !verification.valid) {
      return res.status(400).json({
        success: false,
        message: "Payment has not been completed yet.",
      });
    }

    const pfPaymentId = verification.raw?.pf_payment_id;
    if (!pfPaymentId) {
      return res.status(502).json({
        success: false,
        message: "PayFast did not return a payment reference. Please try again shortly.",
      });
    }

    // Settlement always uses the persisted order rate (or the current platform
    // rate for legacy orders) - never a caller-supplied value.
    const settlementCommissionPercent = resolveSettlementCommissionPercent(order);

    let settled;
    try {
      settled = await settleVerifiedPayment({
        orderId: order._id,
        ipn: {
          ...verification.raw,
          payment_status: "COMPLETE",
          amount_gross:
            verification.raw?.amount_gross ?? verification.raw?.amount ?? order.totalAmount,
        },
        source: "order_confirmation",
        pfPaymentId,
        commissionPercent: settlementCommissionPercent,
      });
    } catch (settleErr) {
      if (settleErr instanceof PaymentSettlementError) {
        return res.status(settleErr.status || 400).json({
          success: false,
          code: settleErr.code,
          message: settleErr.message,
        });
      }
      throw settleErr;
    }

    try {
      await sendEmail({
        to: settled.order.customerEmail,
        subject: "Payment Confirmed",
        html: `<p>Your payment for order <b>${settled.order._id}</b> has been successfully processed.</p>`,
      });
    } catch (emailErr) {
      console.warn("Payment email failed to send", emailErr.message);
    }

    res.json({
      success: true,
      message: settled.alreadyProcessed ? "Payment already confirmed" : "Payment confirmed",
      order: settled.order,
    });
  } catch (err) {
    console.error("Payment confirm error:", err);
    next(err);
  }
};

/* =========================================
   VERIFY ORDER (GET /api/orders/:id/verify)
   Used by the storefront tracking widget. Returns the same public
   tracking shape as before, but now requires authorization: only
   the owning customer, a vendor included in the order, or an admin.
========================================= */
export const verifyOrder = async (req, res, next) => {
  try {
    const { id } = req.params;

    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    const isAdmin = ["admin", "superadmin"].includes(req.user?.role);
    const isOwner = order.customer?.toString() === req.user?._id?.toString();
    const vendorId = VENDOR_ID(req.user);
    const isVendorInOrder = (order.vendorOrders || []).some(
      (vo) => String(vo.vendor) === vendorId
    );

    if (!isAdmin && !isOwner && !isVendorInOrder) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }

    res.json({
      success: true,
      status: order.status,
      paymentStatus: order.paymentStatus,
      trackingNumber: order.trackingNumber,
      shippingCarrier: order.shippingCarrier,
      shippingAddress: order.shippingAddress,
    });
  } catch (err) {
    next(err);
  }
};

/* =========================================
   TRACK ORDER BY REFERENCE (unused by mounted routes; kept for safety)
========================================= */
export const trackOrder = async (req, res, next) => {
  try {
    const { reference } = req.params;

    const order = await Order.findOne({
      $or: [{ paymentReference: reference }, { _id: reference }],
    }).populate("items.product", "name price");

    if (!order) return res.status(404).json({ message: "Order not found" });

    // Do not hand out full order data to arbitrary id lookups - restrict to
    // owner/admin in callers that mount this handler.
    const isAdmin = ["admin", "superadmin"].includes(req.user?.role);
    const isOwner = req.user && order.customer?.toString() === req.user._id?.toString();
    if (!isAdmin && !isOwner) {
      return res.status(403).json({ message: "Not authorized" });
    }

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