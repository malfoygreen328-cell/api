// src/routes/logisticsRoutes.js
import express from 'express';
import logisticsRoutes from './logistics/logisticsRoutes.js';
import shipmentRoutes from './logistics/shipmentRoutes.js';
import webhookRoutes from './logistics/webhookRoutes.js';

const router = express.Router();

router.use('/', logisticsRoutes);
router.use('/shipments', shipmentRoutes);
router.use('/webhooks', webhookRoutes);

export default router;

