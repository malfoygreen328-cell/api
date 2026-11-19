// src/config/loadEnv.js
//
// MUST be the first import in server.js. Static ESM imports are evaluated
// before the importing module's body, so this file has to load the environment
// itself before app.js is evaluated (CORS origins, host mapping, etc. read
// process.env at module load time).
//
// Load order:
//   1. .env                    (existing local/production file - unchanged)
//   2. .env.<NODE_ENV>         (optional override, e.g. .env.staging)
//
// Staging is validated BEFORE staging values are applied. If validation fails
// the process exits without ever adopting a production fallback.

import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import {
  applyStagingEnvironment,
  isStaging,
  validateEnvironment,
} from "./environment.js";

const envPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

const nodeEnv = String(process.env.NODE_ENV || "development").trim().toLowerCase();
const envSpecificPath = path.resolve(process.cwd(), `.env.${nodeEnv}`);
if (fs.existsSync(envSpecificPath)) {
  dotenv.config({ path: envSpecificPath, override: true });
}

if (isStaging(process.env)) {
  const result = validateEnvironment(process.env);
  if (!result.ok) {
    for (const error of result.errors) {
      console.error(`[startup] ${error}`);
    }
    console.error(
      "[startup] Refusing to start in staging with an unsafe configuration."
    );
    process.exit(1);
  }
  applyStagingEnvironment(process.env);
}

export default process.env.NODE_ENV;
