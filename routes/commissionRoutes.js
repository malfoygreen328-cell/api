// src/routes/commissionRoutes.js
import express from "express";
import {
  getMarketplaceCommissionRate,
  getMarketplaceCommissionPercent,
  getFoundingConfig,
} from "../config/platformConfig.js";

const router = express.Router();

/**
 * GET /api/commission
 * Public, read-only: exposes the standard marketplace commission so vendor
 * webshops can render accurate "what we earn" info without hardcoding.
 * Clients can never change the rate via this or any HTTP endpoint - it is
 * server config only.
 */
router.get("/", (req, res) => {
  const founding = getFoundingConfig();
  res.json({
    success: true,
    currency: "ZAR",
    commission: {
      rate: getMarketplaceCommissionRate(),
      percent: getMarketplaceCommissionPercent(),
      description: "standard marketplace commission per sale",
    },
    foundingVendor: {
      enabled: founding.enabled,
      startDate: founding.startDate,
      endDate: founding.endDate,
      commissionRate: founding.commissionRate,
      commissionPercent: Math.round(founding.commissionRate * 100 * 1e6) / 1e6,
      rateLocked: founding.rateLocked,
    },
  });
});

export default router;