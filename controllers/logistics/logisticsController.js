// src/controllers/logistics/logisticsController.js
import LogisticsService from '../../services/logistics/LogisticsService.js';

export const health = (req, res) => {
  res.json({ success: true, message: 'Logistics API is running' });
};

export const getRates = async (req, res, next) => {
  try {
    const params = req.body || {};
    const rates = await LogisticsService.getRates(params);
    res.json({ success: true, rates });
  } catch (err) {
    next(err);
  }
};

export const getPickupPoints = async (req, res, next) => {
  try {
    const params = req.query || req.body || {};
    const points = await LogisticsService.getPickupPoints(params);
    res.json({ success: true, pickupPoints: points });
  } catch (err) {
    next(err);
  }
};

export default { health, getRates, getPickupPoints };

