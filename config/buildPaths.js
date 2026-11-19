// src/config/buildPaths.js
//
// Selects which frontend build directory the backend serves.
//
// Production keeps the existing `build/` convention. Staging defaults to a
// separate `build-staging/` directory and refuses to serve `build/`, so stale
// production artifacts can never be presented as a staging build.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { isStaging } from "./environment.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "../../..");
export const STAGING_BUILD_MARKER = "staging-build.json";

const productionBuildDir = (appDir) =>
  path.resolve(REPO_ROOT, appDir, "build");

export const resolveAppBuildDir = ({
  envName,
  appDir,
  env = process.env,
}) => {
  const staging = isStaging(env);
  const configured = String(env[envName] || "").trim();

  let resolved;
  if (configured) {
    resolved = path.isAbsolute(configured)
      ? path.normalize(configured)
      : path.resolve(REPO_ROOT, configured);
  } else {
    resolved = path.resolve(
      REPO_ROOT,
      appDir,
      staging ? "build-staging" : "build"
    );
  }

  if (staging && resolved === productionBuildDir(appDir)) {
    throw new Error(
      `${envName} must not point at the production build directory while NODE_ENV=staging.`
    );
  }

  return resolved;
};

export const getAdminBuildDir = (env = process.env) =>
  resolveAppBuildDir({ envName: "ADMIN_BUILD_DIR", appDir: "azania-admin", env });

export const getVendorBuildDir = (env = process.env) =>
  resolveAppBuildDir({ envName: "VENDOR_BUILD_DIR", appDir: "azania-vendor", env });

/**
 * Reads the staging marker that `deploy/build-staging.mjs` writes after a
 * successful staging compile. Returns null when the marker is missing or
 * unreadable so callers can fail closed.
 */
export const readStagingBuildMarker = (dir) => {
  if (!dir) return null;
  try {
    const markerPath = path.join(dir, STAGING_BUILD_MARKER);
    if (!fs.existsSync(markerPath)) return null;
    return JSON.parse(fs.readFileSync(markerPath, "utf8"));
  } catch {
    return null;
  }
};

export const isStagingBuildDir = (dir) => {
  const marker = readStagingBuildMarker(dir);
  return Boolean(marker && marker.environment === "staging");
};

/**
 * Fails closed unless `dir` is a directory produced by the staging build
 * script. This stops a production `build/` (which has no staging marker) from
 * being copied into place and served as if it were a staging build.
 */
export const assertStagingBuildDir = ({ envName, appDir, dir }) => {
  if (!isStagingBuildDir(dir)) {
    throw new Error(
      `${envName} (${dir}) is not a verified staging build: ` +
        `${STAGING_BUILD_MARKER} is missing or does not declare environment "staging". ` +
        `Run "npm run build:staging" in ${appDir} before starting staging.`
    );
  }
  return dir;
};

export default {
  REPO_ROOT,
  STAGING_BUILD_MARKER,
  resolveAppBuildDir,
  getAdminBuildDir,
  getVendorBuildDir,
  readStagingBuildMarker,
  isStagingBuildDir,
  assertStagingBuildDir,
};
