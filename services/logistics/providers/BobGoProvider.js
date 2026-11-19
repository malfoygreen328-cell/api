// src/services/logistics/providers/BobGoProvider.js
import LogisticsProvider from './LogisticsProvider.js';
import BobGoClient from '../adapters/bobGo/bobGoClient.js';
import BobGoMapper from '../adapters/bobGo/bobGoMapper.js';
import BobGoWebhookVerifier from '../adapters/bobGo/bobGoWebhookVerifier.js';

class BobGoProvider extends LogisticsProvider {
  constructor() {
    super();
    this.client = new BobGoClient();
    this.mapper = new BobGoMapper();
    this.verifier = new BobGoWebhookVerifier();
    this.name = 'bobgo';
  }

  isConfigured() {
    return Boolean(process.env.BOBGO_API_KEY);
  }

  async getRates(params = {}) {
    if (process.env.LOGISTICS_MODE === 'mock') {
      return this.getMockRates(params);
    }
    try {
      const data = await this.client.post('/rates', params);
      const results = data?.rates || data?.data || data || [];
      if (Array.isArray(results)) {
        return results.map((r) => this.mapper.toAzaniaRate(r));
      }
      return [this.mapper.toAzaniaRate(results)];
    } catch (err) {
      throw err;
    }
  }

  async getPickupPoints(params = {}) {
    if (process.env.LOGISTICS_MODE === 'mock') {
      return this.getMockPickupPoints(params);
    }
    try {
      const data = await this.client.post('/pickup-points', params);
      const results = data?.pickupPoints || data?.points || data?.data || [];
      if (Array.isArray(results)) {
        return results.map((p) => this.mapper.toAzaniaPickupPoint(p));
      }
      return [];
    } catch (err) {
      throw err;
    }
  }

  async createShipment(params = {}) {
    if (process.env.LOGISTICS_MODE === 'mock') {
      return this.getMockShipment(params);
    }
    try {
      const data = await this.client.post('/shipments', params);
      const shipmentData = data?.shipment || data?.data || data;
      return this.mapper.toAzaniaShipment(shipmentData);
    } catch (err) {
      throw err;
    }
  }

  async getShipment(id) {
    if (process.env.LOGISTICS_MODE === 'mock') {
      return { providerShipmentId: id, status: 'BOOKED' };
    }
    try {
      const data = await this.client.get(`/shipments/${id}`);
      return this.mapper.toAzaniaShipment(data?.shipment || data?.data || data);
    } catch (err) {
      throw err;
    }
  }

  async cancelShipment(id, params = {}) {
    if (process.env.LOGISTICS_MODE === 'mock') {
      return { providerShipmentId: id, cancelled: true };
    }
    try {
      const data = await this.client.post(`/shipments/${id}/cancel`, params);
      return data;
    } catch (err) {
      throw err;
    }
  }

  async getLabel(id) {
    if (process.env.LOGISTICS_MODE === 'mock') {
      return { labelUrl: `https://mock.bobgo.co.za/labels/${id}.pdf` };
    }
    try {
      const data = await this.client.get(`/shipments/${id}/label`);
      return { labelUrl: data?.labelUrl || data?.url || data };
    } catch (err) {
      throw err;
    }
  }

  async getTracking(id) {
    if (process.env.LOGISTICS_MODE === 'mock') {
      return { trackingNumber: id, events: [] };
    }
    try {
      const data = await this.client.get(`/shipments/${id}/tracking`);
      return data;
    } catch (err) {
      throw err;
    }
  }

  verifyWebhook(rawBody, signature) {
    const secret = process.env.BOBGO_WEBHOOK_SECRET;
    if (!secret) return false;
    return this.verifier.verifySignature(rawBody, signature, secret);
  }

  parseWebhookEvent(payload = {}) {
    return {
      eventType: payload.event || payload.type || payload.eventType,
      providerEventCode: payload.code || payload.eventCode,
      status: this.mapper.mapStatus(payload.status),
      shipmentId: payload.shipmentId || payload.id || payload.providerShipmentId,
      trackingNumber: payload.trackingNumber || payload.waybill,
      timestamp: payload.timestamp || payload.createdAt || new Date(),
      location: payload.location,
      metadata: payload,
    };
  }

  getMockRates() {
    return [
      { provider: 'bobgo', service: 'standard', serviceLevel: 'Standard Delivery', carrier: 'Mock Courier', price: 79, currency: 'ZAR', estimatedDeliveryDays: 2, available: true },
      { provider: 'bobgo', service: 'express', serviceLevel: 'Express Delivery', carrier: 'Mock Courier', price: 129, currency: 'ZAR', estimatedDeliveryDays: 1, available: true },
    ];
  }

  getMockPickupPoints() {
    return [
      { provider: 'bobgo', externalId: 'mock-pp-1', name: 'Bob Box - Mock Store', address: { street: '123 Mock Street', city: 'Cape Town', province: 'Western Cape', postalCode: '8000', country: 'South Africa' }, latitude: -33.9249, longitude: 18.4241, distance: 1.2, openingHours: 'Mon-Sat 08:00-18:00', availability: true, services: ['PICKUP_POINT'] },
    ];
  }

  getMockShipment(params = {}) {
    const ref = Math.random().toString(36).substring(2, 10).toUpperCase();
    return {
      providerShipmentId: `MOCK-${ref}`,
      trackingNumber: `TRK-${ref}`,
      trackingUrl: `https://mock.tracking.co.za/${ref}`,
      labelUrl: `https://mock.labels.co.za/${ref}.pdf`,
      status: 'BOOKED',
    };
  }
}

export default BobGoProvider;

