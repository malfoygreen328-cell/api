import express from "express";
import {
  listStores,
  getStoreDetails,
  listStoreProducts,
} from "../controllers/publicStoreController.js";

const router = express.Router();

/* =========================================
   LIST PRODUCTS FOR A STORE
   GET /api/public/stores/:slug/products?page=1&limit=20
   Must come BEFORE /:slug to avoid route conflict
========================================= */
router.get("/:slug/products", listStoreProducts);

/* =========================================
   GET STORE DETAILS BY SLUG
   GET /api/public/stores/:slug
========================================= */
router.get("/:slug", getStoreDetails);

/* =========================================
   LIST ALL STORES
   GET /api/public/stores?search=xyz&page=1&limit=20
========================================= */
router.get("/", listStores);

export default router;