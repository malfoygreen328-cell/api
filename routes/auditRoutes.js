// src/routes/auditRoutes.js
import express from "express";
import AuditLog from "../models/AuditLog.js";
import { protect, requireRole } from "../middleware/authMiddleware.js";

const router = express.Router();

// Only authorised admins may read the append-only audit log
router.get("/", protect, requireRole("admin", "superadmin"), async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const skip = (page - 1) * limit;

    const filter = {};
    if (req.query.action) filter.action = String(req.query.action);
    if (req.query.resourceType) filter.resourceType = String(req.query.resourceType);
    if (req.query.resourceId) filter.resourceId = String(req.query.resourceId);
    if (req.query.actorType) filter.actorType = String(req.query.actorType);
    if (req.query.status) filter.status = String(req.query.status);
    if (req.query.from || req.query.to) {
      filter.createdAt = {};
      if (req.query.from) filter.createdAt.$gte = new Date(req.query.from);
      if (req.query.to) filter.createdAt.$lte = new Date(req.query.to);
    }

    const [logs, total] = await Promise.all([
      AuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      AuditLog.countDocuments(filter),
    ]);

    res.json({
      success: true,
      logs,
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error("Audit log fetch error:", err.message);
    res.status(500).json({ success: false, message: "Failed to fetch audit logs" });
  }
});

export default router;
