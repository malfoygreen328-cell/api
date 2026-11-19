// src/routes/logistics/logisticsRoutes.js
import express from 'express';
import { protect } from '../../middleware/authMiddleware.js';
import { getRates, getPickupPoints, getOrderShipments, createShipment } from '../../controllers/logistics/shippingController.js';

const router = express.Router();

router.get('/health', (req, res) => res.json({ success: true, message: 'Logistics API healthy' }));
router.post('/rates', protect, getRates);
router.get('/pickup-points', protect, getPickupPoints);
router.post('/pickup-points', protect, getPickupPoints);
router.get('/orders/:orderId/shipments', protect, getOrderShipments);
router.post('/shipments', protect, createShipment);

export default router;

