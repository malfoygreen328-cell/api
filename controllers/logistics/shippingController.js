// src/controllers/logistics/shippingController.js
import ShippingRateService from '../../services/logistics/ShippingRateService.js';
import PickupPointService from '../../services/logistics/PickupPointService.js';
import LogisticsService from '../../services/logistics/LogisticsService.js';

export const getRates = async (req, res, next) => {
  try {
    const params = req.body || {};
    const rates = await ShippingRateService.getRates(params);
    res.json({ success: true, rates });
  } catch (err) {
    next(err);
  }
};

export const getPickupPoints = async (req, res, next) => {
  try {
    const params = req.query || req.body || {};
    const points = await PickupPointService.discoverPickupPoints(params);
    res.json({ success: true, pickupPoints: points });
  } catch (err) {
    next(err);
  }
};

import Order from '../../models/Order.js';

export const getOrderShipments = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    const user = req.user;
    const isOwner = order.user?.toString() === user?._id?.toString();
    const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';
    let isVendor = false;
    if (user?.role === 'vendor_owner') {
      // Best-effort ownership check against vendorOrders/items
      if (Array.isArray(order.vendorOrders) && order.vendorOrders.length) {
        isVendor = order.vendorOrders.some((vo) => vo?.vendor?.toString() === user?.vendor?.toString() || vo?.vendor?.toString() === user?._id?.toString());
      }
      if (!isVendor && Array.isArray(order.items)) {
        isVendor = order.items.some((it) => it?.vendor?.toString() === user?.vendor?.toString() || it?.vendor?.toString() === user?._id?.toString());
      }
    }
    if (!isOwner && !isAdmin && !isVendor) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }
    const shipments = await LogisticsService.getOrderShipments(orderId);
    res.json({ success: true, shipments });
  } catch (err) {
    next(err);
  }
};

export const createShipment = async (req, res, next) => {
  try {
    const { orderId, shippingMethod, parcelDetails, originAddress, destinationAddress, pickupPoint, customerShippingCharge } = req.body;

    if (!orderId) {
      return res.status(400).json({ success: false, message: 'orderId is required' });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    const user = req.user;
    let vendorId = user?.vendor?.toString() || user?.vendorId?.toString() || user?._id?.toString();
    if (user?.role === 'vendor_owner') {
      // enforce ownership
      let owns = false;
      if (Array.isArray(order.vendorOrders) && order.vendorOrders.length) {
        owns = order.vendorOrders.some((vo) => vo?.vendor?.toString() === vendorId);
      }
      if (!owns && Array.isArray(order.items)) {
        owns = order.items.some((it) => it?.vendor?.toString() === vendorId);
      }
      if (!owns) {
        return res.status(403).json({ success: false, message: 'Not authorized to ship this order' });
      }
    } else if (user?.role !== 'admin' && user?.role !== 'superadmin') {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    const shipment = await LogisticsService.createShipmentForOrder({
      orderId,
      vendorId,
      shippingMethod,
      parcelDetails,
      originAddress,
      destinationAddress,
      pickupPoint,
      customerShippingCharge,
      customerId: order.user,
      userId: user?._id,
    });

    res.status(201).json({ success: true, shipment });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export default { getRates, getPickupPoints, getOrderShipments, createShipment };

