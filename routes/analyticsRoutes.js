import express from "express";
import {
  trackEvent,
  getEvents,
} from "../controllers/analyticsController.js";
import { optionalAuth, protect } from "../middleware/authMiddleware.js";
import { eventLimiter } from "../middleware/rateLimitMiddleware.js";

const router = express.Router();

router.use(eventLimiter);
router.post("/events", optionalAuth, trackEvent);
router.get("/events", protect, getEvents);

export default router;
