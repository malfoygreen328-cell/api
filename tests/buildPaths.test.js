// tests/buildPaths.test.js
//
// Guards the frontend build-directory isolation rules used by src/app.js.

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  REPO_ROOT,
  STAGING_BUILD_MARKER,
  assertStagingBuildDir,
  getAdminBuildDir,
  getVendorBuildDir,
  isStagingBuildDir,
  readStagingBuildMarker,
  resolveAppBuildDir,
} from "../src/config/buildPaths.js";

const read = (relativePath) =>
  readFileSync(path.resolve(REPO_ROOT, relativePath), "utf8");

const productionBuild = (appDir) => path.resolve(REPO_ROOT, appDir, "build");
const stagingBuild = (appDir) => path.resolve(REPO_ROOT, appDir, "build-staging");

test("production serves the existing build/ directories", () => {
  const env = { NODE_ENV: "production" };
  assert.equal(getAdminBuildDir(env), productionBuild("azania-admin"));
  assert.equal(getVendorBuildDir(env), productionBuild("azania-vendor"));
});

test("staging defaults to separate build-staging/ directories", () => {
  const env = { NODE_ENV: "staging" };
  assert.equal(getAdminBuildDir(env), stagingBuild("azania-admin"));
  assert.equal(getVendorBuildDir(env), stagingBuild("azania-vendor"));
});

test("staging accepts an explicit staging-only build directory", () => {
  const env = {
    NODE_ENV: "staging",
    ADMIN_BUILD_DIR: "azania-admin/build-qa",
    VENDOR_BUILD_DIR: "azania-vendor/build-qa",
  };
  assert.equal(
    getAdminBuildDir(env),
    path.resolve(REPO_ROOT, "azania-admin/build-qa")
  );
  assert.equal(
    getVendorBuildDir(env),
    path.resolve(REPO_ROOT, "azania-vendor/build-qa")
  );
});

test("staging refuses to serve the production build directory", () => {
  assert.throws(
    () =>
      getAdminBuildDir({
        NODE_ENV: "staging",
        ADMIN_BUILD_DIR: "azania-admin/build",
      }),
    /must not point at the production build directory/
  );
  assert.throws(
    () =>
      getVendorBuildDir({
        NODE_ENV: "staging",
        VENDOR_BUILD_DIR: path.join(REPO_ROOT, "azania-vendor", "build"),
      }),
    /must not point at the production build directory/
  );
});

test("production still honours an explicit build directory override", () => {
  const env = { NODE_ENV: "production", ADMIN_BUILD_DIR: "custom/admin-build" };
  assert.equal(
    getAdminBuildDir(env),
    path.resolve(REPO_ROOT, "custom/admin-build")
  );
});

test("app.js resolves frontend build directories through buildPaths", () => {
  const appSource = read("azania-backend/src/app.js");
  assert.match(appSource, /getAdminBuildDir\(\)/);
  assert.match(appSource, /getVendorBuildDir\(\)/);
  assert.doesNotMatch(appSource, /azania-admin", "build"/);
  assert.doesNotMatch(appSource, /azania-vendor", "build"/);
});

test("staging build tooling never writes to production build/", () => {
  const script = read("deploy/build-staging.mjs");
  assert.match(script, /BUILD_PATH: "build-staging"/);
  assert.match(script, /output=build-staging/);
  assert.match(script, /REACT_APP_API_URL: ""/);
  assert.match(script, /must not point at a production host/);

  const adminPackage = read("azania-admin/package.json");
  assert.match(adminPackage, /"build:staging": "node \.\.\/deploy\/build-staging\.mjs admin"/);

  const vendorPackage = read("azania-vendor/package.json");
  assert.match(vendorPackage, /"build:staging": "node \.\.\/deploy\/build-staging\.mjs vendor"/);
});

test("a directory without the staging marker is not a staging build", (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "azania-build-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  // Simulate a copied production build: index.html exists, no marker.
  writeFileSync(path.join(dir, "index.html"), "<!doctype html>");
  assert.equal(readStagingBuildMarker(dir), null);
  assert.equal(isStagingBuildDir(dir), false);
  assert.throws(
    () =>
      assertStagingBuildDir({
        envName: "ADMIN_BUILD_DIR",
        appDir: "azania-admin",
        dir,
      }),
    /not a verified staging build/
  );
});

test("a staging marker is required and must declare the staging environment", (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "azania-build-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const markerPath = path.join(dir, STAGING_BUILD_MARKER);

  writeFileSync(markerPath, JSON.stringify({ environment: "production" }));
  assert.equal(isStagingBuildDir(dir), false);
  assert.throws(
    () =>
      assertStagingBuildDir({
        envName: "VENDOR_BUILD_DIR",
        appDir: "azania-vendor",
        dir,
      }),
    /does not declare environment "staging"/
  );

  writeFileSync(markerPath, JSON.stringify({ environment: "staging" }));
  assert.equal(isStagingBuildDir(dir), true);
  assert.equal(
    assertStagingBuildDir({
      envName: "VENDOR_BUILD_DIR",
      appDir: "azania-vendor",
      dir,
    }),
    dir
  );
});

test("app.js verifies staging build markers before serving assets", () => {
  const appSource = read("azania-backend/src/app.js");
  assert.match(appSource, /isStaging\(process\.env\)/);
  assert.match(appSource, /assertStagingBuildDir\(\{/);
  assert.match(appSource, /ADMIN_BUILD_DIR/);
  assert.match(appSource, /VENDOR_BUILD_DIR/);
});
