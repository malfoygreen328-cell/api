// src/routes/user.js
// LEGACY file. This previously declared a SECOND mongoose "User" model with a
// PLAINTEXT password (no hashing, select:false, verification, or role fields).
// It was dead code but dangerous if ever imported. Re-exporting the canonical
// model instead keeps any stray import resolving to the secured model.
import User from "../models/User.js";

export default User;