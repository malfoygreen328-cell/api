// src/services/logistics/TrackingService.js
import Shipment from '../../models/logistics/Shipment.js';
import ShipmentService from './ShipmentService.js';
import BobGoProvider from './providers/BobGoProvider.js';

class TrackingService {
  constructor() {
    this.provider = new BobGoProvider();
    this.shipmentService = ShipmentService;
  }

  async trackShipment(shipmentId) {
    const shipment = await Shipment.findById(shipmentId);
    if (!shipment) return null;

    if (shipment.provider && shipment.providerShipmentId) {
      try {
        const tracking = await this.provider.getTracking(shipment.providerShipmentId);
        return tracking;
      } catch (err) {
        return { error: 'TRACKING_TEMPORARILY_UNAVAILABLE', details: err.message };
      }
    }
    return { trackingNumber: shipment.trackingNumber, trackingUrl: shipment.trackingUrl, events: [] };
  }
}

export default new TrackingService();

