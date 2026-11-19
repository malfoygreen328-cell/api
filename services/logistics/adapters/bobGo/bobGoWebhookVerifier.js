// src/services/logistics/adapters/bobGo/bobGoWebhookVerifier.js
import crypto from "crypto";

class BobGoWebhookVerifier {
  verifySignature(payload, signature, secret) {
    if (!secret) {
      return false;
    }
    try {
      const computed = crypto
        .createHmac("sha256", secret)
        .update(payload)
        .digest("hex");
      const provided = String(signature || "");
      if (provided.length !== computed.length) {
        return false;
      }
      return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(provided));
    } catch (err) {
      return false;
    }
  }
}

export default BobGoWebhookVerifier;
