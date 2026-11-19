// src/controllers/vendorPayoutController.js
import Order from "../models/Order.js";
import VendorPayout from "../models/VendorPayout.js";

/* CREATE PENDING VENDOR PAYOUT */
export const createVendorPayouts = async (req, res) => {
  try {
    // ✅ Get all paid orders not yet paid to vendor
    const orders = await Order.find({
      status: "paid",
      payoutStatus: "unpaid",
    });

    if (!orders.length) return res.json({ success: true, message: "No orders to payout" });

    // Group orders by vendor
    const payoutsMap = {};

    for (const order of orders) {
      for (const item of order.items) {
        const vendorId = item.vendor.toString();
        if (!payoutsMap[vendorId]) {
          payoutsMap[vendorId] = { orders: [], totalAmount: 0, commission: 0, payfastFee: 0, vendorPayout: 0 };
        }
        payoutsMap[vendorId].orders.push(order._id);
        payoutsMap[vendorId].totalAmount += item.price * item.quantity;
        payoutsMap[vendorId].commission += order.commissionAmount;
        payoutsMap[vendorId].payfastFee += order.payfastFee;
        payoutsMap[vendorId].vendorPayout += order.vendorPayout;
      }
    }

    // Save payouts to DB
    const createdPayouts = [];
    for (const vendorId in payoutsMap) {
      const payout = await VendorPayout.create({
        vendor: vendorId,
        ...payoutsMap[vendorId],
        payoutStatus: "processing",
      });

      // Mark orders as processing payout
      await Order.updateMany(
        { _id: { $in: payoutsMap[vendorId].orders } },
        { payoutStatus: "processing" }
      );

      createdPayouts.push(payout);
    }

    res.json({ success: true, payouts: createdPayouts });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to create payouts" });
  }
};

/* MARK PAYOUT AS PAID */
export const markPayoutPaid = async (req, res) => {
  try {
    const { payoutId } = req.params;

    const payout = await VendorPayout.findById(payoutId);
    if (!payout) return res.status(404).json({ success: false, message: "Payout not found" });

    payout.payoutStatus = "paid";
    payout.payoutDate = new Date();
    await payout.save();

    // Update orders as paid
    await Order.updateMany(
      { _id: { $in: payout.orders } },
      { payoutStatus: "paid" }
    );

    res.json({ success: true, message: "Payout completed", payout });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to mark payout as paid" });
  }
};

/* GET ALL PAYOUTS */
export const getVendorPayouts = async (req, res) => {
  try {
    const payouts = await VendorPayout.find()
      .populate("vendor", "name email")
      .sort({ createdAt: -1 });

    res.json({ success: true, count: payouts.length, payouts });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to fetch payouts" });
  }
};