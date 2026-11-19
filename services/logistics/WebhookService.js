// src/services/logistics/WebhookService.js
import Shipment from '../../models/logistics/Shipment.js';
import ShipmentService from './ShipmentService.js';
import BobGoProvider from './providers/BobGoProvider.js';
import { logisticsLogger } from '../../utils/logistics/logisticsLogger.js';

class WebhookService {
  constructor() {
    this.provider = new BobGoProvider();
    this.shipmentService = ShipmentService;
  }

  async handleBobGoWebhook(rawBody, signature, payload) {
    try {
      if (!this.provider.verifyWebhook(rawBody, signature)) {
        return { success: false, error: 'WEBHOOK_REJECTED', status: 401 };
      }

      const event = this.provider.parseWebhookEvent(payload);
      const providerShipmentId = event.shipmentId || payload.shipmentId;

      if (!providerShipmentId) {
        return { success: false, error: 'INVALID_PROVIDER_RESPONSE', status: 400 };
      }

      const shipment = await Shipment.findOne({ providerShipmentId });
      if (!shipment) {
        logisticsLogger.warn('Webhook for unknown shipment', { providerShipmentId });
        return { success: true, status: 200, message: 'Unknown shipment ignored' };
      }

      if (event.status) {
        await this.shipmentService.updateShipmentStatus(shipment._id, event.status, {
          trackingNumber: event.trackingNumber || shipment.trackingNumber,
        });
      }

      await this.shipmentService.recordEvent({
        shipmentId: shipment._id,
        eventType: event.eventType || 'WEBHOOK_EVENT',
        provider: 'bobgo',
        providerEventCode: event.providerEventCode,
        status: event.status,
        description: 'Webhook event received',
        timestamp: event.timestamp,
        location: event.location,
        rawEventReference: providerShipmentId,
        metadata: { payload },
      });

      return { success: true, status: 200 };
    } catch (err) {
      logisticsLogger.error('Webhook handling failed', { error: err.message });
      return { success: false, error: 'PROVIDER_ERROR', status: 500 };
    }
  }
}

export default new WebhookService();

