import mongoose from "mongoose";

/*
 * Append-only administrative audit trail. Every entry records who did what,
 * to which resource, from where, and why. Metadata is sanitised before it is
 * persisted so passwords, tokens, keys and bank/card details can never leak
 * into the audit log. Entries are never updated or deleted.
 */

const SENSITIVE_KEY = /pass(word)?|token|secret|authorization|api[_-]?key|card|cvv|cvc|bank|account[_-]?number|routing|iban|signature/i;

export function sanitizeAuditValue(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (depth > 6) return "[MAX_DEPTH]";
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeAuditValue(item, depth + 1));
  if (value instanceof Date) return value;
  if (typeof value === "object") {
    if (typeof value.toHexString === "function") return value.toString();
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY.test(key) ? "[REDACTED]" : sanitizeAuditValue(item, depth + 1);
    }
    return out;
  }
  if (typeof value === "string") return value.length > 2000 ? `${value.slice(0, 2000)}...` : value;
  return value;
}

const auditLogSchema = new mongoose.Schema(
  {
    actor: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
    actorType: {
      type: String,
      enum: ["admin", "superadmin", "vendor", "customer", "system"],
      required: true,
      default: "system",
      index: true,
    },
    actorEmail: { type: String, default: "", trim: true, lowercase: true },
    actorRole: { type: String, default: "", trim: true },
    action: { type: String, required: true, trim: true, index: true, maxlength: 100 },
    resourceType: { type: String, required: true, trim: true, index: true, maxlength: 80 },
    resourceId: { type: String, default: "", trim: true, index: true, maxlength: 120 },
    status: {
      type: String,
      enum: ["success", "failure"],
      default: "success",
      index: true,
    },
    reason: { type: String, default: "", trim: true, maxlength: 1000 },
    ip: { type: String, default: "", trim: true, maxlength: 100 },
    userAgent: { type: String, default: "", trim: true, maxlength: 500 },
    requestId: { type: String, default: "", trim: true, maxlength: 120 },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false }
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ resourceType: 1, resourceId: 1, createdAt: -1 });
auditLogSchema.index({ actor: 1, createdAt: -1 });

auditLogSchema.pre("validate", function () {
  this.metadata = sanitizeAuditValue(this.metadata || {});
});

const immutableError = () =>
  new Error("AuditLog is append-only; audit entries cannot be modified or deleted.");

auditLogSchema.pre("save", async function () {
  if (!this.isNew) throw immutableError();
});

for (const hook of [
  "findOneAndUpdate",
  "findOneAndReplace",
  "updateOne",
  "updateMany",
  "replaceOne",
  "findOneAndDelete",
  "deleteOne",
  "deleteMany",
]) {
  auditLogSchema.pre(hook, async function () {
    throw immutableError();
  });
}

auditLogSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.__v;
  return obj;
};

export default mongoose.model("AuditLog", auditLogSchema);
