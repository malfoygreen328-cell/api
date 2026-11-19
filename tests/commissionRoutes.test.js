// tests/commissionRoutes.test.js
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import commissionRoutes from "../src/routes/commissionRoutes.js";

let server;
let base;

before(async () => {
  const app = express();
  app.use(commissionRoutes);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
});

test("GET /api/commission is public and returns the configured 5% rate", async () => {
  process.env.MARKETPLACE_COMMISSION_RATE = "0.05";
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.currency, "ZAR");
  assert.equal(body.commission.rate, 0.05);
  assert.equal(body.commission.percent, 5);
  delete process.env.MARKETPLACE_COMMISSION_RATE;
});

test("GET /api/commission falls back to 5% without env", async () => {
  delete process.env.MARKETPLACE_COMMISSION_RATE;
  const res = await fetch(`${base}/`);
  const body = await res.json();
  assert.equal(body.commission.percent, 5);
});