import EventService from "../services/EventService.js";

export const trackEvent = async (req, res, next) => {
  try {
    const {
      eventType,
      productId,
      vendorId,
      brandId,
      searchQuery,
      category,
      subcategory,
      recommendationId,
      metadata,
    } = req.body;

    const ipAddress = req.ip || req.connection?.remoteAddress;
    const userAgent = req.headers["user-agent"];

    const clip = (v) => (v ? String(v).slice(0, 128) : null);

    const event = await EventService.trackEvent({
      userId: req.user?._id,
      sessionId: clip(req.body.sessionId || req.headers["x-session-id"]),
      anonymousId: clip(req.body.anonymousId || req.headers["x-anonymous-id"]),
      eventType,
      productId,
      vendorId,
      brandId,
      searchQuery,
      category,
      subcategory,
      recommendationId,
      metadata,
      ipAddress,
      userAgent,
    });

    res.json({
      success: true,
      data: event,
    });
  } catch (error) {
    next(error);
  }
};

export const getEvents = async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const UserBehaviourEvent = (await import("../models/UserBehaviourEvent.js")).default;
    const events = await UserBehaviourEvent.find({ user: req.user?._id })
      .sort({ createdAt: -1 })
      .limit(limit);
    res.json({ success: true, data: events });
  } catch (error) {
    next(error);
  }
};
