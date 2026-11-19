// src/routes/logistics/webhookRoutes.js
import express from 'express';
import { handleBobGoWebhook } from '../../controllers/logistics/webhookController.js';

const router = express.Router();

router.post('/bobgo', handleBobGoWebhook);

export default router;

