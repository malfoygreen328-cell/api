// src/services/logistics/ShippingRateService.js
import BobGoProvider from './providers/BobGoProvider.js';

class ShippingRateService {
  constructor() {
    this.provider = new BobGoProvider();
  }

  async getRates(params = {}) {
    return this.provider.getRates(params);
  }

  async getPickupPoints(params = {}) {
    return this.provider.getPickupPoints(params);
  }
}

export default new ShippingRateService();

