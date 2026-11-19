// src/services/brandStatsService.js
//
// Real engagement metrics only. There are no synthetic or estimated numbers:
// every value is aggregated from BrandFollow, Product and Review collections.

import BrandFollow from "../models/BrandFollow.js";
import Product from "../models/Product.js";
import Review from "../models/Review.js";

export const statsForStores = async (storeIds = []) => {
  if (!storeIds.length) return {};
  const [followers, products, reviews] = await Promise.all([
    BrandFollow.aggregate([
      { $match: { store: { $in: storeIds } } },
      { $group: { _id: "$store", count: { $sum: 1 } } },
    ]),
    Product.aggregate([
      { $match: { store: { $in: storeIds } } },
      {
        $group: {
          _id: "$store",
          count: { $sum: 1 },
          activeCount: { $sum: { $cond: ["$isActive", 1, 0] } },
          views: { $sum: "$views" },
          sold: { $sum: "$soldCount" },
        },
      },
    ]),
    Review.aggregate([
      { $lookup: { from: "products", localField: "product", foreignField: "_id", as: "p" } },
      { $unwind: "$p" },
      { $match: { "p.store": { $in: storeIds } } },
      { $group: { _id: "$p.store", count: { $sum: 1 }, rating: { $avg: "$rating" } } },
    ]),
  ]);

  const map = {};
  for (const id of storeIds) {
    map[String(id)] = {
      followersCount: 0,
      productCount: 0,
      activeProductCount: 0,
      rating: 0,
      reviewCount: 0,
      views: 0,
      sold: 0,
    };
  }
  for (const row of followers) map[String(row._id)].followersCount = row.count;
  for (const row of products) {
    map[String(row._id)].productCount = row.count;
    map[String(row._id)].activeProductCount = row.activeCount || 0;
    map[String(row._id)].views = row.views || 0;
    map[String(row._id)].sold = row.sold || 0;
  }
  for (const row of reviews) {
    map[String(row._id)].reviewCount = row.count;
    map[String(row._id)].rating = row.rating || 0;
  }
  return map;
};

export default { statsForStores };
