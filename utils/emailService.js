import nodemailer from "nodemailer";

const parseList = (value) =>
  String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

/**
 * Staging must never deliver mail to real customers. A recipient is allowed
 * only when it appears in STAGING_EMAIL_ALLOWLIST. Otherwise mail is redirected
 * to STAGING_EMAIL_REDIRECT_TO, or suppressed entirely. No addresses or
 * credentials are logged.
 */
export function resolveEmailRecipient(to, env = process.env) {
  if (String(env.NODE_ENV || "").toLowerCase() !== "staging") return to;

  const allowlist = parseList(env.STAGING_EMAIL_ALLOWLIST).map((item) =>
    item.toLowerCase()
  );
  const recipients = parseList(to);
  const allAllowed =
    recipients.length > 0 &&
    recipients.every((recipient) => allowlist.includes(recipient.toLowerCase()));
  if (allAllowed) return to;

  const redirect = String(env.STAGING_EMAIL_REDIRECT_TO || "").trim();
  return redirect || null;
}

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: Number(process.env.EMAIL_PORT) || 587,
  secure: process.env.EMAIL_SECURE === "true", // true for 465
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

export const sendEmail = async ({ to, subject, html, replyTo }) => {
  try {
    const recipient = resolveEmailRecipient(to);
    if (!recipient) {
      // Suppressed: do not log the address or any message content.
      console.warn("[email] Suppressed non-allowlisted recipient in staging.");
      return false;
    }

    await transporter.sendMail({
      from:
        process.env.EMAIL_FROM ||
        `"Azania Marketplace" <${process.env.EMAIL_USER}>`,
      replyTo: replyTo || process.env.EMAIL_REPLY_TO,
      to: recipient,
      subject,
      html,
    });
    return true;
  } catch (err) {
    console.error("Email send error:", err);
    return false;
  }
};