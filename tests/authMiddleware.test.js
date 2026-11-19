// tests/authMiddleware.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { protect, requireRole } from "../src/middleware/authMiddleware.js";
import jwt from "jsonwebtoken";

const mockRes = () => {
  const res = {
    statusCode: 200,
    sent: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.sent = body;
      return this;
    },
  };
  return res;
};

const mockNext = () => {
  let called = false;
  const fn = (...args) => {
    called = true;
    fn.calls = args;
  };
  fn.wasCalled = () => called;
  return fn;
};

test("requireRole forbids non-admin roles", () => {
  const req = { user: { role: "vendor_owner" } };
  const res = mockRes();
  const next = mockNext();
  requireRole("admin", "superadmin")(req, res, next);
  assert.equal(res.statusCode, 403);
  assert.equal(next.wasCalled(), false);
});

test("requireRole lets admin/superadmin through", () => {
  for (const role of ["admin", "superadmin"]) {
    const req = { user: { role } };
    const res = mockRes();
    const next = mockNext();
    requireRole("admin", "superadmin")(req, res, next);
    assert.equal(res.statusCode, 200, role);
    assert.equal(next.wasCalled(), true, role);
  }
});

test("requireRole rejects an unauthenticated request", () => {
  const req = {};
  const res = mockRes();
  const next = mockNext();
  requireRole("admin")(req, res, next);
  assert.equal(res.statusCode, 401);
  assert.equal(next.wasCalled(), false);
});

test("protect returns 401 when no token is provided (no DB hit)", async () => {
  const req = { headers: {}, cookies: {} };
  const res = mockRes();
  const next = mockNext();
  await protect(req, res, next);
  assert.equal(res.statusCode, 401);
  assert.equal(next.wasCalled(), false);
});

test("protect returns 401 for an invalid token (no DB hit)", async () => {
  process.env.JWT_SECRET = "test-secret";
  const req = { headers: { authorization: "Bearer not-a-valid-token" }, cookies: {} };
  const res = mockRes();
  const next = mockNext();
  await protect(req, res, next);
  assert.equal(res.statusCode, 401);
  assert.equal(next.wasCalled(), false);
  delete process.env.JWT_SECRET;
});

test("protect returns 401 for JWT that exists but has no DB record yet would need DB — skipped: only police the role path here", async () => {
  // Creating a signed token would flow into a DB lookup (Admin/Vendor/User).
  // We assert only that unknown roles are rejected before any DB query.
  process.env.JWT_SECRET = "test-secret";
  const bad = jwt.sign({ id: "507f1f77bcf86cd799439011", role: "root" }, process.env.JWT_SECRET);
  const req = { headers: { authorization: `Bearer ${bad}` }, cookies: {} };
  const res = mockRes();
  const next = mockNext();
  await protect(req, res, next);
  assert.equal(res.statusCode, 401);
  delete process.env.JWT_SECRET;
});