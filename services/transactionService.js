// src/services/transactionService.js
//
// MongoDB transactions require a replica set (Atlas provides one; a local
// standalone mongod does not). Financial writes should use a transaction when
// the deployment supports it. If the driver reports that transactions are
// unavailable, the callback is executed without a session and every write in
// it must still be idempotent (ledger eventKey uniqueness, conditional order
// state updates). There is no partially-committed "pretend" transaction.

import mongoose from "mongoose";

const UNSUPPORTED = /Transaction numbers are only allowed|does not support transactions|Transaction support is not available|replica set/i;

export const withOptionalTransaction = async (fn) => {
  let session;
  try {
    session = await mongoose.startSession();
  } catch {
    return fn(null);
  }

  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } catch (err) {
    if (err && UNSUPPORTED.test(String(err.message || ""))) {
      return fn(null);
    }
    throw err;
  } finally {
    try {
      await session.endSession();
    } catch {
      // ignore shutdown races
    }
  }
};

export default { withOptionalTransaction };
