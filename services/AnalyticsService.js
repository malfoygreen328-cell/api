import Order from "../models/Order.js";
import User from "../models/User.js";
import Vendor from "../models/Vendor.js";
import CustomerAnalytics from "../models/CustomerAnalytics.js";
import VendorAnalytics from "../models/VendorAnalytics.js";
import MarketplaceAnalytics from "../models/MarketplaceAnalytics.js";
import RecommendationAttribution from "../models/RecommendationAttribution.js";

class AnalyticsService {
  async calculateCrossVendorCustomerRate() {
    try {
      const totalCustomers = await User.countDocuments({
        $or: [{ role: "customer" }, { role: "user" }],
      });

      if (totalCustomers === 0) {
        return {
          totalCustomers: 0,
          crossVendorCustomers: 0,
          crossVendorCustomerRate: 0,
          customersWithOneVendor: 0,
          customersWithTwoVendors: 0,
          customersWithThreePlusVendors: 0,
          customersWithFivePlusVendors: 0,
        };
      }

      const customersWithVendorCounts = await Order.aggregate([
        {
          $match: {
            customer: { $exists: true },
            paymentStatus: "complete",
          },
        },
        {
          $unwind: "$items",
        },
        {
          $group: {
            _id: "$customer",
            vendors: { $addToSet: "$items.vendor" },
          },
        },
        {
          $project: {
            vendorCount: { $size: "$vendors" },
          },
        },
      ]);

      let customersWithOneVendor = 0;
      let customersWithTwoVendors = 0;
      let customersWithThreePlusVendors = 0;
      let customersWithFivePlusVendors = 0;

      customersWithVendorCounts.forEach((c) => {
        if (c.vendorCount >= 5) customersWithFivePlusVendors++;
        if (c.vendorCount >= 3) customersWithThreePlusVendors++;
        if (c.vendorCount >= 2) customersWithTwoVendors++;
        if (c.vendorCount === 1) customersWithOneVendor++;
      });

      const crossVendorCustomers = customersWithTwoVendors;
      const crossVendorCustomerRate = (crossVendorCustomers / totalCustomers) * 100;

      return {
        totalCustomers,
        crossVendorCustomers,
        crossVendorCustomerRate: parseFloat(crossVendorCustomerRate.toFixed(2)),
        customersWithOneVendor,
        customersWithTwoVendors,
        customersWithThreePlusVendors,
        customersWithFivePlusVendors,
      };
    } catch (error) {
      console.error("Error calculating cross-vendor customer rate:", error);
      return {
        totalCustomers: 0,
        crossVendorCustomers: 0,
        crossVendorCustomerRate: 0,
      };
    }
  }

  async getRecommendationMetrics() {
    try {
      const [impressions, clicks, purchases] = await Promise.all([
        RecommendationAttribution.countDocuments({}),
        RecommendationAttribution.countDocuments({ clicked: true }),
        RecommendationAttribution.countDocuments({ purchased: true }),
      ]);

      const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
      const conversion = clicks > 0 ? (purchases / clicks) * 100 : 0;

      const attributedPurchases = await RecommendationAttribution.find({
        purchased: true,
        order: { $exists: true },
      }).populate({
        path: "order",
        select: "totalAmount",
      });

      const attributedGMV = attributedPurchases.reduce((sum, attr) => {
        return sum + (attr.order?.totalAmount || 0);
      }, 0);

      return {
        recommendationImpressions: impressions,
        recommendationClicks: clicks,
        recommendationCTR: parseFloat(ctr.toFixed(2)),
        recommendationPurchases: purchases,
        recommendationConversion: parseFloat(conversion.toFixed(2)),
        recommendationAttributedGMV: attributedGMV,
      };
    } catch (error) {
      console.error("Error getting recommendation metrics:", error);
      return {};
    }
  }

  async generateMarketplaceAnalytics() {
    try {
      const date = new Date();
      date.setHours(0, 0, 0, 0);

      const crossVendorMetrics = await this.calculateCrossVendorCustomerRate();
      const recommendationMetrics = await this.getRecommendationMetrics();

      const totalCustomers = await User.countDocuments({ role: "customer" });
      const totalOrders = await Order.countDocuments({ paymentStatus: "complete" });
      const totalVendors = await Vendor.countDocuments({ status: "APPROVED" });

      const gmvs = await Order.aggregate([
        { $match: { paymentStatus: "complete" } },
        { $group: { _id: null, totalGMV: { $sum: "$totalAmount" } } },
      ]);

      const totalGMV = gmvs.length > 0 ? gmvs[0].totalGMV : 0;
      const averageOrderValue = totalOrders > 0 ? totalGMV / totalOrders : 0;
      const averageOrdersPerCustomer = totalCustomers > 0 ? totalOrders / totalCustomers : 0;

      const analytics = {
        date,
        totalCustomers,
        totalOrders,
        totalGMV,
        averageOrderValue: parseFloat(averageOrderValue.toFixed(2)),
        averageOrdersPerCustomer: parseFloat(averageOrdersPerCustomer.toFixed(2)),
        totalVendors,
        ...crossVendorMetrics,
        ...recommendationMetrics,
      };

      await MarketplaceAnalytics.findOneAndUpdate({ date }, analytics, { upsert: true });
      return analytics;
    } catch (error) {
      console.error("Error generating marketplace analytics:", error);
      throw error;
    }
  }
}

export default new AnalyticsService();
