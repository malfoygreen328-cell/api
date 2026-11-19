// scripts/ledger-dry-run.js
// READ-ONLY. Reports orders that would need ledger entries. Does not write.
// Usage: node scripts/ledger-dry-run.js
import mongoose from "mongoose";
import dotenv from "dotenv";
import { dryRunMigration } from "../src/services/reconciliationService.js";

dotenv.config();

const run = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    const report = await dryRunMigration();
    console.log(JSON.stringify(report, null, 2));
  } catch (err) {
    console.error("Dry run failed:", err.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect().catch(() => {});
  }
};

run();
