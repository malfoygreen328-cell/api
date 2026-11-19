// src/services/logistics/adapters/bobGo/bobGoMapper.js
class BobGoMapper {
  toAzaniaRate(bobGoRate = {}) {
    return {
      provider: "bobgo",
      service: bobGoRate.service || bobGoRate.serviceCode,
      serviceLevel: bobGoRate.serviceLevel || bobGoRate.serviceName,
      carrier: bobGoRate.carrier || bobGoRate.courier,
      price: Number(bobGoRate.price || bobGoRate.amount || bobGoRate.total || 0),
      currency: bobGoRate.currency || "ZAR",
      estimatedDeliveryDays: bobGoRate.deliveryDays || bobGoRate.estimatedDays,
      estimatedDeliveryAt: bobGoRate.estimatedDeliveryAt,
      available: bobGoRate.available !== false,
      raw: bobGoRate,
    };
  }

  toAzaniaPickupPoint(bobGoPoint = {}) {
    return {
      provider: "bobgo",
      externalId: bobGoPoint.id || bobGoPoint.code || bobGoPoint.locationId,
      name: bobGoPoint.name || bobGoPoint.locationName,
      address: {
        street: bobGoPoint.address?.street || bobGoPoint.street,
        city: bobGoPoint.address?.city || bobGoPoint.city,
        province: bobGoPoint.address?.province || bobGoPoint.province,
        postalCode: bobGoPoint.address?.postalCode || bobGoPoint.postalCode,
        country: "South Africa",
      },
      latitude: bobGoPoint.latitude || bobGoPoint.lat,
      longitude: bobGoPoint.longitude || bobGoPoint.lng || bobGoPoint.long,
      distance: bobGoPoint.distance,
      openingHours: bobGoPoint.openingHours || bobGoPoint.hours,
      availability: bobGoPoint.available !== false,
      services: bobGoPoint.services || [],
      raw: bobGoPoint,
    };
  }

  toAzaniaShipment(bobGoShipment = {}) {
    return {
      providerShipmentId: bobGoShipment.shipmentId || bobGoShipment.id || bobGoShipment.reference,
      providerOrderId: bobGoShipment.orderId || bobGoShipment.externalOrderId,
      trackingNumber: bobGoShipment.trackingNumber || bobGoShipment.waybill || bobGoShipment.trackingNo,
      trackingUrl: bobGoShipment.trackingUrl || bobGoShipment.trackingLink,
      labelUrl: bobGoShipment.labelUrl || bobGoShipment.label,
      status: this.mapStatus(bobGoShipment.status),
      estimatedDeliveryAt: bobGoShipment.estimatedDeliveryDate || bobGoShipment.eta,
      raw: bobGoShipment,
    };
  }

  mapStatus(bobGoStatus = "") {
    const status = String(bobGoStatus).toLowerCase();
    const map = {
      created: "CREATED",
      awaiting_vendor: "AWAITING_VENDOR",
      packed: "PACKED",
      pending: "BOOKING_PENDING",
      booked: "BOOKED",
      label_ready: "LABEL_READY",
      ready_for_collection: "COLLECTION_PENDING",
      collected: "COLLECTED",
      in_transit: "IN_TRANSIT",
      out_for_delivery: "OUT_FOR_DELIVERY",
      ready_for_pickup: "READY_FOR_PICKUP",
      delivered: "DELIVERED",
      picked_up: "PICKED_UP",
      failed_delivery: "FAILED_DELIVERY",
      exception: "DELIVERY_EXCEPTION",
      cancelled: "CANCELLED",
      canceled: "CANCELLED",
      return_pending: "RETURN_PENDING",
      return_in_transit: "RETURN_IN_TRANSIT",
      returned: "RETURNED",
    };
    return map[status] || status.toUpperCase();
  }
}

export default BobGoMapper;
