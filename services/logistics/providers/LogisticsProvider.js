// src/services/logistics/providers/LogisticsProvider.js
class LogisticsProvider {
  constructor(config = {}) {
    this.config = config;
  }

  async getRates() {
    throw new Error('getRates not implemented');
  }

  async getPickupPoints() {
    throw new Error('getPickupPoints not implemented');
  }

  async createShipment() {
    throw new Error('createShipment not implemented');
  }

  async getShipment() {
    throw new Error('getShipment not implemented');
  }

  async cancelShipment() {
    throw new Error('cancelShipment not implemented');
  }

  async getLabel() {
    throw new Error('getLabel not implemented');
  }

  async getTracking() {
    throw new Error('getTracking not implemented');
  }

  async verifyWebhook() {
    throw new Error('verifyWebhook not implemented');
  }

  async parseWebhookEvent() {
    throw new Error('parseWebhookEvent not implemented');
  }
}

export default LogisticsProvider;

