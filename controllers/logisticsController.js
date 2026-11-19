// src/controllers/logisticsController.js
import shippingController from './logistics/shippingController.js';
import logisticsController from './logistics/logisticsController.js';
import shipmentController from './logistics/shipmentController.js';
import webhookController from './logistics/webhookController.js';

export const getRates = shippingController.getRates;
export const getPickupPoints = shippingController.getPickupPoints;
export const getOrderShipments = shippingController.getOrderShipments;
export const createShipment = shippingController.createShipment;
export const health = logisticsController.health;
export const getShipment = shipmentController.getShipment;
export const updateShipmentStatus = shipmentController.updateShipmentStatus;
export const trackShipment = shipmentController.trackShipment;
export const handleBobGoWebhook = webhookController.handleBobGoWebhook;

export default { getRates, getPickupPoints, getOrderShipments, createShipment, health, getShipment, updateShipmentStatus, trackShipment, handleBobGoWebhook };

