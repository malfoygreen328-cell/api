// src/controllers/shippingController.js
import shippingController from './logistics/shippingController.js';
export default shippingController;
export const getRates = shippingController.getRates;
export const getPickupPoints = shippingController.getPickupPoints;
export const getOrderShipments = shippingController.getOrderShipments;
export const createShipment = shippingController.createShipment;

