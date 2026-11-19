// src/services/auditService.js
//
// Append-only administrative audit trail. Callers should await this for
// privileged mutations so successes/failures are recorded, but an audit write
// failure must not roll back the business transaction unless explicitly
// requested (AUDIT_FAIL_CLOSED=true).

import AuditLog, { sanitizeAuditValue } from "../models/AuditLog.js";

const adminRoles = new Set(["admin", "superadmin"]);

export const actorTypeFor = (user) => {
  const role = user?.role;
  if (role === "superadmin") return "superadmin";
  if (role === "admin") return "admin";
  if (role === "vendor_owner" || role === "vendor_staff") return "vendor";
  if (role === "customer" || role === "user") return "customer";
  return "system";
};

export const recordAudit = async ({
  req = null,
  actor = null,
  action,
  resourceType,
  resourceId = "",
  status = "success",
  reason = "",
  metadata = {},
  failClosed = process.env.AUDIT_FAIL_CLOSED === "true",
} = {}) => {
  if (!action || !resourceType) {
    throw new Error("Audit action and resourceType are required");
  }

  const user = actor || req?.user || null;
  const actorType = user ? actorTypeFor(user) : "system";

  const entry = {
    actor: user?._id || null,
    actorType,
    actorEmail: String(user?.email || "").toLowerCase(),
    actorRole: String(user?.role || ""),
    action: String(action).trim(),
    resourceType: String(resourceType).trim(),
    resourceId: String(resourceId || ""),
    status,
    reason: String(reason || "").slice(0, 1000),
    ip: String(req?.ip || req?.headers?.["cf-connecting-ip"] || "").slice(0, 100),
    userAgent: String(req?.headers?.["user-agent"] || "").slice(0, 500),
    requestId: String(req?.headers?.["x-request-id"] || req?.id || "").slice(0, 120),
    metadata: sanitizeAuditValue(metadata || {}),
  };

  try {
    return await AuditLog.create(entry);
  } catch (err) {
    console.error("Audit log write failed:", err.message);
    if (failClosed) throw err;
    return null;
  }
};

/**
 * Express helper for the common "record success/failure around an action"
 * pattern. Not used by every controller, but available where appropriate.
 */
export const auditAction = async (req, { action, resourceType, resourceId, metadata, reason } = {}) => {
  return recordAudit({
    req,
    action,
    resourceType,
    resourceId,
    metadata,
    reason,
  });
};

export const isAdminRole = (role) => adminRoles.has(role);

export default { recordAudit, auditAction, sanitizeAuditValue };
