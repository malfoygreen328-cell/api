// tests/indexDefinitions.test.js
//
// Guards against duplicate index definitions that make Mongoose emit
// "Duplicate schema index" warnings and create redundant MongoDB indexes.

import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";

import Order from "../src/models/Order.js";
import Shipment from "../src/models/logistics/Shipment.js";
import VendorAnalytics from "../src/models/VendorAnalytics.js";

const indexKeys = (model) =>
  model.schema.indexes().map(([keys]) => JSON.stringify(keys));

const assertNoDuplicateKeys = (model, label) => {
  const keys = indexKeys(model);
  const seen = new Set();
  for (const key of keys) {
    assert.equal(seen.has(key), false, `${label} defines duplicate index ${key}`);
    seen.add(key);
  }
};

test("models do not define duplicate schema indexes", () => {
  assertNoDuplicateKeys(Order, "Order");
  assertNoDuplicateKeys(Shipment, "Shipment");
  assertNoDuplicateKeys(VendorAnalytics, "VendorAnalytics");
});

const DB_NAME = `azania_index_definitions_${Date.now()}_${Math.random()
  .toString(36)
  .slice(2, 8)}`;
const MONGO_URI = `mongodb://127.0.0.1:27017/${DB_NAME}`;

test("declared indexes build without duplicate key patterns in MongoDB", async (t) => {
  try {
    await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 1500 });
  } catch {
    return t.skip("Local MongoDB not available");
  }

  const models = [
    ["Order", Order],
    ["Shipment", Shipment],
    ["VendorAnalytics", VendorAnalytics],
  ];

  try {
    for (const [label, model] of models) {
      await model.createIndexes();
      const indexes = await model.collection.indexes();

      const seen = new Set();
      for (const index of indexes) {
        if (index.name === "_id_") continue;
        const key = JSON.stringify(index.key);
        assert.equal(
          seen.has(key),
          false,
          `${label} has duplicate MongoDB index key ${key}`
        );
        seen.add(key);
      }

      for (const [keys] of model.schema.indexes()) {
        assert.equal(
          seen.has(JSON.stringify(keys)),
          true,
          `${label} is missing declared index ${JSON.stringify(keys)}`
        );
      }
    }
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});

test("one index remains for each previously duplicated path", () => {
  const orderVendorIndexes = Order.schema
    .indexes()
    .filter(([keys]) => JSON.stringify(keys) === JSON.stringify({ "vendorOrders.vendor": 1 }));
  assert.equal(orderVendorIndexes.length, 1);

  const shipmentIdempotencyIndexes = Shipment.schema
    .indexes()
    .filter(([keys]) => JSON.stringify(keys) === JSON.stringify({ idempotencyKey: 1 }));
  assert.equal(shipmentIdempotencyIndexes.length, 1);
  assert.equal(shipmentIdempotencyIndexes[0][1].sparse, true);

  const vendorAnalyticsVendorIndexes = VendorAnalytics.schema
    .indexes()
    .filter(([keys]) => JSON.stringify(keys) === JSON.stringify({ vendor: 1 }));
  assert.equal(vendorAnalyticsVendorIndexes.length, 1);
  assert.equal(vendorAnalyticsVendorIndexes[0][1].unique, true);
});
