const express = require("express");
const {
  registerVendor,
  loginVendor
} = require("../controllers/vendorAuthController");

const router = express.Router();

router.post("/register", registerVendor);
router.post("/login", loginVendor);

export default router;

