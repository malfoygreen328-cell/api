// src/controllers/logistics/shipmentController.js
import ShipmentService from '../../services/logistics/ShipmentService.js';
import TrackingService from '../../services/logistics/TrackingService.js';
import Shipment from '../../models/logistics/Shipment.js';

export const getShipment = async (req, res, next) => {
  try {
    const { id } = req.params;
    const shipment = await Shipment.findById(id).populate('orderId vendorId customerId');
    if (!shipment) {
      return res.status(404).json({ success: false, message: 'Shipment not found' });
    }
    res.json({ success: true, shipment });
  } catch (err) {
    next(err);
  }
};

export const updateShipmentStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, updates } = req.body;
    const shipment = await ShipmentService.updateShipmentStatus(id, status, updates || {});
    if (!shipment) {
      return res.status(404).json({ success: false, message: 'Shipment not found' });
    }
    res.json({ success: true, shipment });
  } catch (err) {
    next(err);
  }
};

export const trackShipment = async (req, res, next) => {
  try {
    const { id } = req.params;
    const tracking = await TrackingService.trackShipment(id);
    res.json({ success: true, tracking });
  } catch (err) {
    next(err);
  }
};

export default { getShipment, updateShipmentStatus, trackShipment };

