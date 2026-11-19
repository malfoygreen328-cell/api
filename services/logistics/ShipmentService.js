// src/services/logistics/ShipmentService.js
import Shipment from '../../models/logistics/Shipment.js';
import ShipmentEvent from '../../models/logistics/ShipmentEvent.js';

class ShipmentService {
  generateReference() {
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `AZ-SHP-${random}`;
  }

  async createShipment(data = {}) {
    const shipmentReference = data.shipmentReference || this.generateReference();
    const idempotencyKey =
      data.idempotencyKey ||
      `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    const existing = await Shipment.findOne({ idempotencyKey });
    if (existing) {
      return existing;
    }

    const shipment = await Shipment.create({
      ...data,
      shipmentReference,
      idempotencyKey,
    });

    await this.recordEvent({
      shipmentId: shipment._id,
      eventType: 'SHIPMENT_CREATED',
      status: shipment.status,
      description: 'Shipment created',
    });

    return shipment;
  }

  async recordEvent({ shipmentId, eventType, provider, providerEventCode, status, description, timestamp, location, rawEventReference, metadata = {} }) {
    return ShipmentEvent.create({
      shipmentId,
      eventType,
      provider,
      providerEventCode,
      status,
      description,
      timestamp: timestamp || new Date(),
      location,
      rawEventReference,
      metadata,
    });
  }

  async updateShipmentStatus(shipmentId, status, updates = {}) {
    const shipment = await Shipment.findById(shipmentId);
    if (!shipment) return null;

    shipment.previousStatus = shipment.status;
    shipment.status = status;

    if (status === 'BOOKED' && !shipment.bookedAt) shipment.bookedAt = new Date();
    if (status === 'COLLECTED' && !shipment.collectedAt) shipment.collectedAt = new Date();
    if ((status === 'DELIVERED' || status === 'PICKED_UP') && !shipment.deliveredAt) {
      shipment.deliveredAt = new Date();
      shipment.actualDeliveryAt = shipment.actualDeliveryAt || new Date();
    }

    Object.assign(shipment, updates);
    await shipment.save();

    await this.recordEvent({
      shipmentId: shipment._id,
      eventType: 'STATUS_UPDATED',
      status: shipment.status,
      description: `Status changed from ${shipment.previousStatus} to ${shipment.status}`,
    });

    return shipment;
  }

  async getShipmentsByOrder(orderId) {
    return Shipment.find({ orderId }).sort({ createdAt: 1 });
  }

  async getShipmentsByVendor(vendorId) {
    return Shipment.find({ vendorId }).sort({ createdAt: -1 });
  }

  async getShipmentsByCustomer(customerId) {
    return Shipment.find({ customerId }).sort({ createdAt: -1 });
  }
}

export default new ShipmentService();

