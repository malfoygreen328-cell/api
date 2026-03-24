// src/routes/payoutRoutes.js
import express from "express";
import Order from "../models/Order.js";
import { protect, requireRole } from "../middleware/authMiddleware.js";

const router = express.Router();

/* =============================
   GET VENDOR PENDING PAYOUTS
   GET /api/payouts/vendor
============================= */
router.get("/vendor", protect, requireRole("vendor_owner"), async (req, res) => {
  try {
    // Fetch all paid orders for this vendor that haven't been paid out yet
    const orders = await Order.find({
      "items.vendor": req.user._id,
      status: "paid",
      payoutSent: { $ne: true }, // flag to track payout
    });

    // Sum up the vendor payout amounts
    const totalPayout = orders.reduce((sum, order) => {
      // Only sum the vendor's items
      const vendorItemsTotal = order.items
        .filter(item => item.vendor.toString() === req.user._id.toString())
        .reduce((s, i) => s + i.price * i.quantity, 0);

      const breakdown = {
        amount: vendorItemsTotal,
        commission: order.commissionAmount,
        payfastFee: order.payfastFee,
      };

      // Vendor payout = vendorItemsTotal - proportional commission & fees
      const vendorPayout = breakdown.amount - (breakdown.commission + breakdown.payfastFee);
      return sum + vendorPayout;
    }, 0);

    res.json({
      success: true,
      totalPayout,
      orders,
    });
  } catch (err) {
    console.error("Vendor payout fetch error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch payouts" });
  }
});

/* =============================
   MARK PAYOUT AS SENT
   POST /api/payouts/vendor/send
============================= */
router.post("/vendor/send", protect, requireRole("vendor_owner"), async (req, res) => {
  try {
    const orders = await Order.find({
      "items.vendor": req.user._id,
      status: "paid",
      payoutSent: { $ne: true },
    });

    // Mark all as paid out
    for (const order of orders) {
      order.payoutSent = true;
      await order.save();
    }

    res.json({ success: true, message: "Vendor payouts marked as sent", ordersCount: orders.length });
  } catch (err) {
    console.error("Mark payout sent error:", err);
    res.status(500).json({ success: false, message: "Failed to mark payouts" });
  }
});

export default router;