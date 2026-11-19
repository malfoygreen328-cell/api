// src/services/logistics/PickupPointService.js
import PickupPoint from '../../models/logistics/PickupPoint.js';
import BobGoProvider from './providers/BobGoProvider.js';

class PickupPointService {
  constructor() {
    this.provider = new BobGoProvider();
  }

  async discoverPickupPoints(params = {}) {
    const points = await this.provider.getPickupPoints(params);
    return points;
  }

  async upsertPickupPoints(points = []) {
    for (const point of points) {
      await PickupPoint.findOneAndUpdate(
        { provider: point.provider, externalId: point.externalId },
        point,
        { upsert: true, new: true }
      );
    }
    return points;
  }
}

export default new PickupPointService();

