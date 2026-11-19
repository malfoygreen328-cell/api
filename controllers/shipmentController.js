// src/controllers/shipmentController.js
import shipmentController from './logistics/shipmentController.js';
export default shipmentController;
export const getShipment = shipmentController.getShipment;
export const updateShipmentStatus = shipmentController.updateShipmentStatus;
export const trackShipment = shipmentController.trackShipment;

