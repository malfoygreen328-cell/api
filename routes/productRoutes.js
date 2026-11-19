import express from "express";
import {
  searchProducts,
  listProducts,
  listProductsByStore,
  listProductsByCategory,
  listVendorProducts,
  getLowStockProducts,
  getProductById,
  createProduct,
  bulkCreateProducts,
  updateProduct,
  updateProductStock,
  updateProductPrice,
  toggleProductStatus,
  uploadProductImage,
  deleteProduct,
} from "../controllers/productController.js";
import { protect, optionalAuth, requireRole } from "../middleware/authMiddleware.js";
import { upload } from "../middleware/uploadMiddleware.js";

const router = express.Router();
const vendorRoles = ["vendor_owner", "vendor_staff", "admin", "superadmin"];
const writerRoles = ["vendor_owner", "admin", "superadmin"];

/* =====================================================
   SEARCH PRODUCTS (Public)
===================================================== */
router.get("/search", searchProducts);

/* =====================================================
   VENDOR-SCOPED LISTS (must precede /:id)
===================================================== */
router.get("/low-stock", protect, requireRole(...vendorRoles), getLowStockProducts);
router.get("/vendor", protect, requireRole(...vendorRoles), listVendorProducts);
router.get("/store/:storeId", optionalAuth, listProductsByStore);
router.get("/category/:category", listProductsByCategory);

/* =====================================================
   BULK CREATE (vendor_owner | admin)
===================================================== */
router.post("/bulk", protect, requireRole(...writerRoles), bulkCreateProducts);

/* =====================================================
   GET ALL PRODUCTS (Public, active only)
===================================================== */
router.get("/", listProducts);

/* =====================================================
   CREATE PRODUCT (vendor_owner only, own store)
===================================================== */
router.post("/", protect, requireRole(...writerRoles), createProduct);

/* =====================================================
   PARTIAL UPDATES
===================================================== */
router.patch("/:id/stock", protect, requireRole(...writerRoles), updateProductStock);
router.patch("/:id/price", protect, requireRole(...writerRoles), updateProductPrice);
router.patch("/:id/status", protect, requireRole(...writerRoles), toggleProductStatus);
router.post(
  "/:id/upload-image",
  protect,
  requireRole(...writerRoles),
  upload.single("image"),
  uploadProductImage
);

/* =====================================================
   UPDATE / DELETE PRODUCT
===================================================== */
router.put("/:id", protect, requireRole(...writerRoles), updateProduct);
router.delete("/:id", protect, requireRole(...writerRoles), deleteProduct);

/* =====================================================
   SINGLE PRODUCT (public; owners see inactive)
===================================================== */
router.get("/:id", optionalAuth, getProductById);

export default router;
