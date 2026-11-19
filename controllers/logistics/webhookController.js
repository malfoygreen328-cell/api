// src/controllers/logistics/webhookController.js
import WebhookService from '../../services/logistics/WebhookService.js';

export const handleBobGoWebhook = async (req, res, next) => {
  try {
    const signature = req.headers['x-bobgo-signature'] || req.headers['x-signature'] || req.headers['signature'];
    const rawBody = req.rawBody || JSON.stringify(req.body);
    const result = await WebhookService.handleBobGoWebhook(rawBody, signature, req.body);
    return res.status(result.status || 200).json({ success: result.success, message: result.message });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export default { handleBobGoWebhook };

