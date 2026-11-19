// src/controllers/payfastController.js
import crypto from "crypto";
import Order from "../models/Order.js";
import {
  createPayfastPayment as buildPayfastPayment,
  verifyIpnSignature,
  validateIpnOnline,
} from "../services/payments/payfastService.js";
import {
  settleVerifiedPayment,
  PaymentSettlementError,
} from "../services/paymentSettlementService.js";
import { resolveSettlementCommissionPercent } from "../config/platformConfig.js";
import { getProviderFeeCentsFromIpn } from "../utils/finance.js";

/* ------------------------------------------
   CREATE PAYFAST PAYMENT
   Generates secure payment URL for frontend.
   Customers may only initiate payments for
   orders they own, and only while unpaid.
------------------------------------------- */
export const createPayfastPayment = async (req, res, next) => {
  try {
    const { orderId } = req.body;
    if (!orderId) {
      return res.status(400).json({ success: false, message: "orderId is required" });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    // Object-level authorization: only the order's customer may start payment
    if (order.customer?.toString() !== req.user?._id?.toString()) {
      return res.status(403).json({ success: false, message: "Not authorized for this order" });
    }

    if (["complete", "processing"].includes(order.paymentStatus)) {
      return res.status(400).json({ success: false, message: "Order is already paid or processing" });
    }

    const payment = buildPayfastPayment(order);

    const queryString = Object.entries(payment.data)
      .map(([key, val]) => `${key}=${encodeURIComponent(val)}`)
      .join("&");

    res.json({
      success: true,
      payfastUrl: `${payment.url}?${queryString}`,
      orderId: order._id,
    });
  } catch (err) {
    console.error("Create PayFast payment error:", err);
    next(err);
  }
};

// Tests inject a deterministic validator via app.locals. Outside NODE_ENV=test
// the real PayFast online check is always used, so no staging/production
// environment variable can disable server-side IPN validation.
export const resolveIpnValidator = (req) => {
  const injected = req.app?.locals?.payfastIpnValidator;
  if (process.env.NODE_ENV === "test" && typeof injected === "function") {
    return injected;
  }
  return validateIpnOnline;
};

/* ------------------------------------------
   PAYFAST IPN (Instant Payment Notification)
   Updates order status and financials after payment.
   Anyone may POST here - that is why the signature, merchant
   identity and PayFast online validation are all enforced
   before any state mutation. Settlement is idempotent.
------------------------------------------- */
export const handlePayfastIPN = async (req, res) => {
  try {
    const ipn = req.body || {};
    const rawBody = typeof req.rawBody === "string" ? req.rawBody : null;

    // Only accept signed IPNs carrying a valid merchant id and payment id
    if (
      !ipn.signature ||
      String(ipn.merchant_id) !== String(process.env.PAYFAST_MERCHANT_ID) ||
      !ipn.m_payment_id ||
      !ipn.pf_payment_id
    ) {
      console.warn("IPN rejected: missing/invalid identifiers", {
        m_payment_id: ipn.m_payment_id,
        merchant_id: ipn.merchant_id,
      });
      return res.status(400).send("Invalid IPN");
    }

    if (!rawBody) {
      console.warn("IPN rejected: raw body unavailable for signature check");
      return res.status(400).send("Invalid IPN");
    }

    let expectedSignature;
    try {
      expectedSignature = verifyIpnSignature(rawBody, process.env.PAYFAST_PASS_PHRASE);
    } catch (configErr) {
      console.error("IPN rejected: PayFast signature configuration missing", configErr.message);
      return res.status(503).send("Configuration unavailable");
    }
    const receivedSignature = String(ipn.signature).toLowerCase();

    const a = Buffer.from(expectedSignature, "utf8");
    const b = Buffer.from(receivedSignature, "utf8");
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      console.warn("IPN rejected: invalid signature", {
        m_payment_id: ipn.m_payment_id,
        pf_payment_id: ipn.pf_payment_id,
      });
      return res.status(400).send("Invalid signature");
    }

    // Online validation with PayFast. Fail closed: if PayFast cannot confirm
    // the notification, no state is changed (PayFast retries IPNs).
    let onlineValid = false;
    try {
      const validateIpn = resolveIpnValidator(req);
      onlineValid = await validateIpn(ipn);
    } catch (err) {
      console.warn("IPN rejected: online validation error", {
        error: err.message,
        m_payment_id: ipn.m_payment_id,
      });
      return res.status(503).send("Validation unavailable");
    }
    if (!onlineValid) {
      console.warn("IPN rejected: PayFast validation failed", {
        m_payment_id: ipn.m_payment_id,
      });
      return res.status(400).send("Validation failed");
    }

    const order = await Order.findById(ipn.m_payment_id);
    if (!order) return res.status(404).send("Order not found");

    if (order.paymentStatus === "complete") {
      return res.status(200).send("Order already processed");
    }

    const status = String(ipn.payment_status || "").toUpperCase();
    if (status !== "COMPLETE") {
      // Nothing to settle. Acknowledge so PayFast does not retry a failed or
      // cancelled payment forever; reconciliation can still inspect the record.
      console.warn(`Order ${order._id} payment status is ${status} - not marking as paid`);
      return res.status(200).send("OK");
    }

    const feeCents = getProviderFeeCentsFromIpn(ipn);
    console.log(
      `PayFast IPN order ${order._id}: fee=${feeCents === null ? "UNKNOWN" : `${feeCents}c`}`
    );

    try {
      const result = await settleVerifiedPayment({
        orderId: order._id,
        ipn,
        source: "payfast_ipn",
        pfPaymentId: ipn.pf_payment_id,
        commissionPercent: resolveSettlementCommissionPercent(order),
      });
      if (!result.alreadyProcessed) {
        console.log(`Order ${order._id} marked as PAID via IPN`);
        try {
          const { sendEmail } = await import("../utils/emailService.js");
          await sendEmail({
            to: result.order.customerEmail,
            subject: "Payment Confirmed",
            html: `<p>Your payment for order <b>${result.order._id}</b> has been successfully processed.</p>`,
          });
        } catch (emailErr) {
          console.warn("Payment email failed to send", emailErr.message);
        }
      }
    } catch (settleErr) {
      if (settleErr instanceof PaymentSettlementError) {
        console.warn("IPN settlement rejected:", settleErr.code, settleErr.message);
        return res.status(settleErr.status || 400).send(settleErr.code);
      }
      // Transient/internal failure: non-2xx so PayFast retries; ledger keys make
      // the retry safe.
      console.error("IPN settlement error:", settleErr);
      return res.status(500).send("Server error");
    }

    return res.status(200).send("OK");
  } catch (err) {
    console.error("PayFast IPN error:", err);
    return res.status(500).send("Server error");
  }
};
