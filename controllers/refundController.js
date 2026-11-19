// src/controllers/refundController.js
import mongoose from "mongoose";
import Order from "../models/Order.js";
import Refund from "../models/Refund.js";
import { sendEmail } from "../utils/emailService.js";
import { buildRefundEntriesForOrder, postLedgerEntries } from "../services/ledgerService.js";
import { withOptionalTransaction } from "../services/transactionService.js";
import { recordAudit } from "../services/auditService.js";
import { toCents, fromCents } from "../utils/finance.js";

const escapeHtml = (value) =>
  String(value || "").replace(/[<>&"']/g, (char) => {
    return { "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[char];
  });

const refundKeyFor = (orderId) => `order:${String(orderId)}:full`;

const normalizeAllocations = (order, body = {}) => {
  const raw = body.allocations || body.allocation;
  if (!raw || typeof raw !== "object") return null;

  const vendorOrders = Array.isArray(order.vendorOrders) ? order.vendorOrders : [];
  const byId = new Map(vendorOrders.map((vo) => [String(vo._id), vo]));
  const allocation = {};

  for (const [vendorOrderId, value] of Object.entries(raw)) {
    const vo = byId.get(String(vendorOrderId));
    if (!vo) {
      throw Object.assign(new Error(`Unknown vendor order in allocation: ${vendorOrderId}`), {
        status: 400,
      });
    }

    const cents =
      value && typeof value === "object"
        ? value.amountCents !== undefined
          ? Math.round(Number(value.amountCents))
          : toCents(value.amount)
        : toCents(value);

    if (!Number.isInteger(cents) || cents < 0) {
      throw Object.assign(new Error(`Invalid refund allocation for ${vendorOrderId}`), {
        status: 400,
      });
    }

    const subtotalCents = toCents(vo.subTotal) || 0;
    if (cents > subtotalCents) {
      throw Object.assign(
        new Error(`Refund allocation for ${vendorOrderId} exceeds its subtotal`),
        { status: 400 }
      );
    }
    allocation[String(vendorOrderId)] = cents;
  }

  return allocation;
};

/* =========================================
   CUSTOMER: REQUEST REFUND
   ========================================= */
export const requestRefund = async (req, res) => {
  try {
    const { orderId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ success: false, message: "Invalid order id" });
    }

    const reason = String(req.body?.reason || "").trim().slice(0, 1000);

    // Atomic: only the owning customer can move a paid order to `requested`,
    // and only once.
    const order = await Order.findOneAndUpdate(
      {
        _id: orderId,
        customer: req.user._id,
        paymentStatus: "complete",
        refundStatus: "none",
        payoutStatus: { $ne: "paid" },
      },
      { $set: { refundStatus: "requested", refundReason: reason } },
      { new: true }
    );

    if (!order) {
      const existing = await Order.findById(orderId).select(
        "customer paymentStatus refundStatus payoutStatus"
      );
      if (!existing) {
        return res.status(404).json({ success: false, message: "Order not found" });
      }
      if (String(existing.customer) !== String(req.user._id)) {
        return res.status(403).json({ success: false, message: "Not authorized" });
      }
      if (existing.paymentStatus !== "complete") {
        return res
          .status(400)
          .json({ success: false, message: "Order not paid - cannot request refund" });
      }
      if (existing.payoutStatus === "paid") {
        return res.status(400).json({
          success: false,
          message: "Order already paid out - contact support",
        });
      }
      return res.status(400).json({
        success: false,
        message: "Refund already requested or processed",
      });
    }

    try {
      await sendEmail({
        to: process.env.ADMIN_EMAIL,
        subject: `Refund Requested: Order #${order._id}`,
        html: `<p>Customer <b>${escapeHtml(order.customerName || "N/A")}</b> requested a refund for order <b>#${escapeHtml(
          order._id
        )}</b>.</p><p>Reason: ${escapeHtml(order.refundReason || "Not specified")}</p>`,
      });
    } catch (emailErr) {
      console.warn("Refund request email failed:", emailErr.message);
    }

    await recordAudit({
      req,
      action: "refund.requested",
      resourceType: "order",
      resourceId: String(order._id),
      metadata: { reason: order.refundReason },
    });

    res.json({
      success: true,
      message: "Refund request submitted",
      order,
    });
  } catch (err) {
    console.error("Refund request error:", err);
    res.status(500).json({ success: false, message: "Refund request failed" });
  }
};

/* =========================================
   ADMIN: APPROVE + PROCESS REFUND
   ========================================= */
export const approveRefund = async (req, res) => {
  try {
    const { orderId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ success: false, message: "Invalid order id" });
    }

    const reason = String(req.body?.reason || "").trim().slice(0, 1000);

    // Atomically claim the request so two admins cannot process it twice.
    const order = await Order.findOneAndUpdate(
      {
        _id: orderId,
        refundStatus: "requested",
        paymentStatus: "complete",
        payoutStatus: { $ne: "paid" },
      },
      { $set: { refundStatus: "approved" } },
      { new: true }
    );

    if (!order) {
      const existing = await Order.findById(orderId);
      if (!existing) {
        return res.status(404).json({ success: false, message: "Order not found" });
      }
      if (existing.refundStatus === "refunded") {
        const refund = await Refund.findOne({ refundKey: refundKeyFor(orderId) });
        return res.json({
          success: true,
          message: "Refund already processed",
          order: existing,
          refund,
        });
      }
      if (existing.payoutStatus === "paid") {
        return res.status(400).json({
          success: false,
          message: "Order already paid out - cannot refund",
        });
      }
      if (existing.paymentStatus !== "complete") {
        return res.status(400).json({
          success: false,
          message: "Order not paid; cannot refund",
        });
      }
      return res.status(400).json({
        success: false,
        message:
          existing.refundStatus === "approved"
            ? "Refund is already being processed; retry shortly"
            : "No pending refund request",
      });
    }

    let allocation;
    try {
      allocation = normalizeAllocations(order, req.body || {});
    } catch (err) {
      await Order.updateOne(
        { _id: order._id, refundStatus: "approved" },
        { $set: { refundStatus: "requested" } }
      );
      return res.status(err.status || 400).json({ success: false, message: err.message });
    }

    // Full refund only (the provider flow does not support partial refunds yet).
    const vendorOrders = Array.isArray(order.vendorOrders) ? order.vendorOrders : [];
    if (allocation && vendorOrders.length > 0) {
      const allocatedCents = Object.values(allocation).reduce((a, b) => a + b, 0);
      const orderCents = toCents(order.totalAmount) || 0;
      if (allocatedCents !== orderCents) {
        await Order.updateOne(
          { _id: order._id, refundStatus: "approved" },
          { $set: { refundStatus: "requested" } }
        );
        return res.status(400).json({
          success: false,
          message: "Partial refunds are not supported; allocation must equal the order total",
        });
      }
    }

    const refundId = new mongoose.Types.ObjectId();
    const refundKey = refundKeyFor(order._id);
    const amountCents =
      vendorOrders.length > 0
        ? vendorOrders.reduce((sum, vo) => sum + (toCents(vo.subTotal) || 0), 0)
        : toCents(order.totalAmount) || 0;

    let result;
    try {
      result = await withOptionalTransaction(async (session) => {
        let refund = await Refund.findOne({ refundKey }).session(session || null);
        const refundDocId = refund?._id || refundId;

        const ledgerEntries = buildRefundEntriesForOrder(
          order,
          { _id: refundDocId },
          {
            allocation: allocation || null,
            source: "refund",
            description: `Refund approved ${refundDocId}`,
          }
        );

        if (!refund) {
          const rows = await Refund.create(
            [
              {
                _id: refundId,
                order: order._id,
                refundKey,
                amount: fromCents(amountCents),
                amountCents,
                reason: reason || order.refundReason || "",
                status: "processed",
                // No automatic provider refund until PayFast marketplace /
                // refund access is approved. The ledger reversal is internal.
                providerStatus: "pending_manual",
                allocations: vendorOrders.map((vo) => ({
                  vendorOrderId: vo._id,
                  vendor: vo.vendor,
                  amountCents: allocation
                    ? allocation[String(vo._id)] || 0
                    : toCents(vo.subTotal) || 0,
                })),
                admin: req.user._id,
                processedBy: req.user._id,
                processedAt: new Date(),
              },
            ],
            { session: session || undefined }
          );
          refund = rows[0];
        }

        await postLedgerEntries(ledgerEntries, { session });

        order.refundStatus = "refunded";
        order.refundAmount = fromCents(amountCents);
        order.refundReason = reason || order.refundReason || "";
        order.refundedAt = new Date();
        order.paymentStatus = "refunded";
        order.status = "refunded";
        order.vendorPayout = 0;
        order.provisionalVendorPayout = null;
        order.platformProfit = 0;
        order.platformNetCents = null;
        order.settlementStatus = "refunded";
        order.payoutLocked = true;
        order.payoutStatus = "unpaid";
        for (const vo of order.vendorOrders || []) {
          vo.refundStatus = "refunded";
          vo.refundAmount = fromCents(
            allocation ? allocation[String(vo._id)] || 0 : toCents(vo.subTotal) || 0
          );
          vo.vendorPayout = 0;
          vo.provisionalVendorPayout = null;
          vo.platformProfit = 0;
          vo.platformNetCents = null;
          vo.status = "refunded";
          vo.settlementStatus = "refunded";
          vo.payoutLocked = true;
          vo.payoutStatus = "unpaid";
        }
        await order.save({ session: session || undefined });

        return { order, refund };
      });
    } catch (err) {
      // If the ledger/refund step failed, put the request back in the queue so
      // an operator can retry. Already-posted ledger keys make retry safe.
      if (!("alreadyProcessed" in (result || {}))) {
        await Order.updateOne(
          { _id: order._id, refundStatus: "approved" },
          { $set: { refundStatus: "requested" } }
        ).catch(() => {});
      }
      throw err;
    }

    const finalOrder = await Order.findById(order._id).lean();
    const finalRefund = await Refund.findOne({ refundKey }).lean();

    try {
      await sendEmail({
        to: finalOrder?.customerEmail || order.customerEmail,
        subject: `Refund Approved: Order #${order._id}`,
        html: `<p>Your refund for order <b>${escapeHtml(order._id)}</b> has been approved.</p>
               <p>Amount: R${Number(finalOrder?.refundAmount || 0).toFixed(2)}</p>
               <p>Reason: ${escapeHtml(finalRefund?.reason || "Not specified")}</p>`,
      });
    } catch (emailErr) {
      console.warn("Refund email failed:", emailErr.message);
    }

    try {
      await recordAudit({
        req,
        action: "refund.approved",
        resourceType: "order",
        resourceId: String(order._id),
        metadata: {
          refundId: String(finalRefund?._id || refundId),
          amountCents,
          providerStatus: finalRefund?.providerStatus || "pending_manual",
        },
      });
    } catch (auditErr) {
      console.warn("Refund audit failed:", auditErr.message);
    }

    res.json({
      success: true,
      message: "Refund processed. Provider refund must be completed manually.",
      providerStatus: finalRefund?.providerStatus || "pending_manual",
      order: finalOrder,
      refund: finalRefund,
    });
  } catch (err) {
    console.error("Refund approval error:", err);
    res.status(500).json({ success: false, message: "Refund processing failed" });
  }
};

/* =========================================
   ADMIN: REJECT REFUND
   ========================================= */
export const rejectRefund = async (req, res) => {
  try {
    const { orderId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ success: false, message: "Invalid order id" });
    }

    const order = await Order.findOneAndUpdate(
      { _id: orderId, refundStatus: "requested" },
      { $set: { refundStatus: "rejected" } },
      { new: true }
    );

    if (!order) {
      const existing = await Order.findById(orderId).select("refundStatus");
      if (!existing) {
        return res.status(404).json({ success: false, message: "Order not found" });
      }
      return res.status(400).json({
        success: false,
        message:
          existing.refundStatus === "rejected"
            ? "Refund already rejected"
            : "No pending refund request",
      });
    }

    try {
      await sendEmail({
        to: order.customerEmail,
        subject: `Refund Rejected: Order #${order._id}`,
        html: `<p>Your refund request for order <b>#${escapeHtml(order._id)}</b> has been rejected.</p>
               <p>Reason: ${escapeHtml(order.refundReason || "Not specified")}</p>`,
      });
    } catch (emailErr) {
      console.warn("Refund rejection email failed:", emailErr.message);
    }

    await recordAudit({
      req,
      action: "refund.rejected",
      resourceType: "order",
      resourceId: String(order._id),
      metadata: { reason: order.refundReason },
    });

    res.json({
      success: true,
      message: "Refund rejected",
      order,
    });
  } catch (err) {
    console.error("Refund rejection error:", err);
    res.status(500).json({ success: false, message: "Refund rejection failed" });
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
    res.status(500).json({ success: false, message: "Failed to fetch refunds" });
  }
};
