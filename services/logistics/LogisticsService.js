// src/services/logistics/LogisticsService.js
import Order from '../../models/Order.js';
import ShipmentService from './ShipmentService.js';
import ShippingRateService from './ShippingRateService.js';
import TrackingService from './TrackingService.js';
import BobGoProvider from './providers/BobGoProvider.js';

class LogisticsService {
  constructor() {
    this.shipmentService = ShipmentService;
    this.rateService = ShippingRateService;
    this.trackingService = TrackingService;
    this.provider = new BobGoProvider();
  }

  async getRates(params = {}) {
    return this.rateService.getRates(params);
  }

  async getPickupPoints(params = {}) {
    return this.rateService.getPickupPoints(params);
  }

  async createShipmentForOrder({ orderId, vendorId, shippingMethod = 'HOME_DELIVERY', customerId, userId, parcelDetails, originAddress, destinationAddress, pickupPoint, customerShippingCharge = 0 }) {
    const order = await Order.findById(orderId);
    if (!order) {
      throw new Error('Order not found');
    }

    if (order.paymentStatus !== 'complete') {
      throw new Error('Payment not confirmed for this order');
    }

    const shipment = await this.shipmentService.createShipment({
      orderId,
      vendorId,
      customerId: customerId || order.customer,
      userId: userId || order.customer,
      shippingMethod,
      fulfillmentMethod: 'VENDOR_FULFILLED',
      parcelDetails,
      originAddress,
      destinationAddress,
      pickupPoint,
      customerShippingCharge,
      status: 'CREATED',
    });

    try {
      if (this.provider.isConfigured() || process.env.LOGISTICS_MODE === 'mock') {
        const providerShipment = await this.provider.createShipment({
          orderId: orderId.toString(),
          shipmentReference: shipment.shipmentReference,
          parcelDetails,
          destinationAddress,
          pickupPoint,
          shippingMethod,
        });

        shipment.provider = 'bobgo';
        shipment.providerShipmentId = providerShipment.providerShipmentId;
        shipment.trackingNumber = providerShipment.trackingNumber || shipment.trackingNumber;
        shipment.trackingUrl = providerShipment.trackingUrl || shipment.trackingUrl;
        shipment.labelUrl = providerShipment.labelUrl || shipment.labelUrl;
        shipment.status = 'BOOKED';
        shipment.bookedAt = new Date();
        await shipment.save();

        await this.shipmentService.recordEvent({
          shipmentId: shipment._id,
          eventType: 'SHIPMENT_BOOKED',
          provider: 'bobgo',
          status: shipment.status,
          description: 'Shipment booked with provider',
        });
      } else {
        shipment.status = 'BOOKING_PENDING';
        await shipment.save();
      }
    } catch (err) {
      shipment.status = 'BOOKING_PENDING';
      await shipment.save();
      await this.shipmentService.recordEvent({
        shipmentId: shipment._id,
        eventType: 'SHIPMENT_BOOKING_FAILED',
        status: 'BOOKING_PENDING',
        description: err.message,
        metadata: { error: err.message },
      });
    }

    return shipment;
  }

  async getOrderShipments(orderId) {
    return this.shipmentService.getShipmentsByOrder(orderId);
  }
}

export default new LogisticsService();

