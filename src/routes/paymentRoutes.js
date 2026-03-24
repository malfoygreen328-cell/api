import express from "express";
import { startPayfastPayment, payfastWebhook } from "../controllers/paymentController.js";

const router = express.Router();

router.post("/payfast", startPayfastPayment);

router.post("/payfast/webhook", payfastWebhook);

export default router;