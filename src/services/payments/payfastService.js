import crypto from "crypto";
import axios from "axios";

const PAYFAST_HOST = "https://sandbox.payfast.co.za";

/* ---------------- GENERATE SIGNATURE ---------------- */

export const generateSignature = (data, passphrase) => {

  const pfOutput = Object.keys(data)
    .sort()
    .map(key => `${key}=${encodeURIComponent(data[key]).replace(/%20/g, "+")}`)
    .join("&");

  return crypto
    .createHash("md5")
    .update(pfOutput + `&passphrase=${passphrase}`)
    .digest("hex");
};


/* ---------------- CREATE PAYMENT ---------------- */

export const createPayfastPayment = (order) => {

  const data = {

    merchant_id: process.env.PAYFAST_MERCHANT_ID,
    merchant_key: process.env.PAYFAST_MERCHANT_KEY,

    return_url: `${process.env.FRONTEND_URL}/payment/success`,
    cancel_url: `${process.env.FRONTEND_URL}/payment/cancel`,
    notify_url: `${process.env.API_URL}/api/payments/payfast/webhook`,

    name_first: order.customerName,
    email_address: order.customerEmail,

    m_payment_id: order._id,
    amount: order.totalAmount.toFixed(2),

    item_name: "Azania Order"
  };

  const signature = generateSignature(data, process.env.PAYFAST_PASSPHRASE);

  return {
    url: `${PAYFAST_HOST}/eng/process`,
    data: {
      ...data,
      signature
    }
  };
};


/* ---------------- VALIDATE WEBHOOK ---------------- */

export const verifyPayfastWebhook = async (body) => {

  const receivedSignature = body.signature;
  delete body.signature;

  const generatedSignature = generateSignature(
    body,
    process.env.PAYFAST_PASSPHRASE
  );

  if (receivedSignature !== generatedSignature) {
    throw new Error("Invalid PayFast signature");
  }

  const validationResponse = await axios.post(
    `${PAYFAST_HOST}/eng/query/validate`,
    new URLSearchParams(body).toString(),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );

  return validationResponse.data === "VALID";
};