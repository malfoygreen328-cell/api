import crypto from "crypto";
import axios from "axios";
import querystring from "querystring";

export const getPayfastHost = () => {
  const mode = String(process.env.PAYFAST_MODE || "").trim().toLowerCase();

  // Defence in depth: startup validation already enforces this, but no staging
  // request may ever reach the live PayFast host even if it is bypassed.
  if (String(process.env.NODE_ENV || "").toLowerCase() === "staging" && mode !== "sandbox") {
    const err = new Error("PAYFAST_MODE must be 'sandbox' in staging");
    err.code = "PAYFAST_STAGING_MODE";
    throw err;
  }

  return mode === "sandbox"
    ? "https://sandbox.payfast.co.za"
    : "https://www.payfast.co.za";
};

/* ---------------- GENERATE SIGNATURE ---------------- */

const requirePassphrase = (passphrase) => {
  const value = String(passphrase || "").trim();
  if (!value) {
    const err = new Error("PAYFAST_PASS_PHRASE is not configured");
    err.code = "PAYFAST_CONFIG_MISSING";
    throw err;
  }
  return value;
};

// PayFast uses a PLAIN MD5 of the sorted "key=value" list with the passphrase
// appended (`...&passphrase=xxx`). Values are urlencoded with space as "+".
export const generateSignature = (data, passphrase) => {
  const secret = requirePassphrase(passphrase);
  const pfOutput = Object.keys(data)
    .sort()
    .map((key) => `${key}=${encodeURIComponent(data[key]).replace(/%20/g, "+")}`)
    .join("&");

  return crypto
    .createHash("md5")
    .update(`${pfOutput}&passphrase=${secret}`)
    .digest("hex");
};

/* ---------------- VERIFY IPN SIGNATURE ---------------- */

// IPN signatures are computed over the exact raw body (signature field
// excluded) with the passphrase appended. Reconstructing from regenerated
// objects is lossy (duplicate keys, decoding), so we operate on rawBody.
// Fails closed if the passphrase is missing - never hashes "undefined".
export const verifyIpnSignature = (rawBody, passphrase) => {
  const secret = requirePassphrase(passphrase);
  const bodyWithoutSignature = String(rawBody || "")
    .replace(/(^|&)signature=[^&]*/i, "$1")
    .replace(/^&+/, "")
    .replace(/&+$/, "");

  return crypto
    .createHash("md5")
    .update(`${bodyWithoutSignature}&passphrase=${secret}`)
    .digest("hex");
};

/* ---------------- VALIDATE IPN WITH PAYFAST ---------------- */

// Online validation: POST the full (unsigned) IPN back to PayFast. Returns true
// only when PayFast replies "VALID". Tests must inject a validator explicitly
// through app.locals rather than relying on an environment-based bypass.
export const validateIpnOnline = async (body) => {
  const unsigned = { ...body };
  delete unsigned.signature;

  const timeout = Number(process.env.PAYFAST_VALIDATION_TIMEOUT_MS) || 15000;
  const validationResponse = await axios.post(
    `${getPayfastHost()}/eng/query/validate`,
    new URLSearchParams(unsigned).toString(),
    {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout,
    }
  );

  return validationResponse.data === "VALID";
};

/* ---------------- CREATE PAYMENT ---------------- */

const withOrderId = (url, orderId) => {
  if (!url) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}orderId=${encodeURIComponent(orderId)}`;
};

export const createPayfastPayment = (order) => {
  const merchantId = String(process.env.PAYFAST_MERCHANT_ID || "").trim();
  const merchantKey = String(process.env.PAYFAST_MERCHANT_KEY || "").trim();
  if (!merchantId || !merchantKey) {
    const err = new Error("PayFast merchant credentials are not configured");
    err.code = "PAYFAST_CONFIG_MISSING";
    err.status = 503;
    throw err;
  }

  const frontend = String(process.env.FRONTEND_URL || "").replace(/\/$/, "");
  const data = {
    merchant_id: merchantId,
    merchant_key: merchantKey,

    return_url: withOrderId(
      process.env.PAYFAST_RETURN_URL ||
        (frontend ? `${frontend}/order-success.html` : ""),
      order._id
    ),
    cancel_url: withOrderId(
      process.env.PAYFAST_CANCEL_URL ||
        (frontend ? `${frontend}/Checkout.html` : ""),
      order._id
    ),
    notify_url:
      process.env.PAYFAST_NOTIFY_URL || `${process.env.API_URL}/api/payfast/notify`,

    name_first: order.customerName,
    email_address: order.customerEmail,

    m_payment_id: order._id,
    amount: order.totalAmount.toFixed(2),

    item_name: "Azania Order"
  };

  const signature = generateSignature(data, process.env.PAYFAST_PASS_PHRASE);

  return {
    url: `${getPayfastHost()}/eng/process`,
    data: {
      ...data,
      signature
    }
  };
};

/* ---------------- VERIFY PAYMENT (Query API) ---------------- */

// Server-side query used by /orders/confirm when the IPN has not yet reached
// us. Queries PayFast for the authoritative payment status for an order.
// NOTE: the PayFast Query API is billed per call - confirmPayment should only
// call it for orders still marked pending.
export const verifyPayment = async ({ mPaymentId, amount }) => {
  // Test hook: no external network in tests; the harness controls the outcome
  // via MOCK_PAYFAST_STATUS (e.g. "COMPLETE" to exercise the happy path).
  if (process.env.NODE_ENV === "test" && process.env.MOCK_PAYFAST_STATUS) {
    return {
      status: String(process.env.MOCK_PAYFAST_STATUS).toUpperCase(),
      valid: String(process.env.MOCK_PAYFAST_STATUS).toUpperCase() === "COMPLETE",
      raw: { pf_payment_id: "mock-pf-1234" },
    };
  }

  const data = {
    merchant_id: process.env.PAYFAST_MERCHANT_ID,
    merchant_key: process.env.PAYFAST_MERCHANT_KEY,
    m_payment_id: String(mPaymentId),
  };

  const signature = generateSignature(data, process.env.PAYFAST_PASS_PHRASE);

  const response = await axios.post(
    `${getPayfastHost()}/eng/query/process`,
    querystring.stringify({ ...data, signature }),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );

  const parsed = querystring.parse(response.data);

  const status = String(parsed.payment_status || "").toUpperCase();
  const queriedAmount = parsed.amount !== undefined ? Number(parsed.amount) : null;

  return {
    status,
    valid: status === "COMPLETE" && (queriedAmount === null || Math.abs(queriedAmount - Number(amount)) < 0.01),
    raw: parsed,
  };
};