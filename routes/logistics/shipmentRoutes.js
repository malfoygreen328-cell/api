// src/routes/logistics/shipmentRoutes.js
import express from 'express';
import { protect, restrictTo } from '../../middleware/authMiddleware.js';
import { getShipment, updateShipmentStatus, trackShipment } from '../../controllers/logistics/shipmentController.js';

const router = express.Router();

router.get('/:id', protect, getShipment);
router.get('/:id/tracking', protect, trackShipment);
router.patch('/:id/status', protect, restrictTo('admin', 'superadmin'), updateShipmentStatus);

export default router;

