import express from "express";
import {
  listBrands,
  getBrand,
  approveBrand,
  rejectBrand,
  featureBrand,
  unfeatureBrand,
  setEligibility,
  setCategories,
  getBrandMetrics,
  listStories,
  createStory,
  updateStory,
  deleteStory,
  listCampaigns,
  createCampaign,
  updateCampaign,
  deleteCampaign,
  getOptions,
} from "../controllers/adminDiscoveryController.js";
import { protect, requireRole } from "../middleware/authMiddleware.js";

const router = express.Router();

// Defense in depth: even if this router were mounted above the global admin
// protect-wall, every handler still requires an admin/superadmin principal.
router.use(protect, requireRole("admin", "superadmin"));

router.get("/options", getOptions);

router.get("/brands", listBrands);
router.get("/brands/:id", getBrand);
router.get("/brands/:id/metrics", getBrandMetrics);
router.patch("/brands/:id/approve", approveBrand);
router.patch("/brands/:id/reject", rejectBrand);
router.patch("/brands/:id/feature", featureBrand);
router.patch("/brands/:id/unfeature", unfeatureBrand);
router.patch("/brands/:id/eligibility", setEligibility);
router.patch("/brands/:id/categories", setCategories);

router.get("/metrics", getBrandMetrics);

router.get("/stories", listStories);
router.post("/stories", createStory);
router.put("/stories/:id", updateStory);
router.delete("/stories/:id", deleteStory);

router.get("/campaigns", listCampaigns);
router.post("/campaigns", createCampaign);
// Support both verb styles used by the admin portal and API clients.
router.patch("/campaigns/:id", updateCampaign);
router.put("/campaigns/:id", updateCampaign);
router.delete("/campaigns/:id", deleteCampaign);

export default router;
