// src/services/brandEligibilityService.js
//
// Shared eligibility rules for public brand discovery. A brand is eligible
// only when an admin has approved it, its public profile is complete, and the
// linked vendor account is approved.

import Store from "../models/Store.js";
import Vendor from "../models/Vendor.js";

const textLength = (value) => String(value || "").trim().length;

export const hasCompletePublicProfile = (store) => {
  const source = typeof store?.toObject === "function" ? store.toObject() : store || {};
  return Boolean(
    String(source.storeName || "").trim() &&
      String(source.logo || "").trim() &&
      String(source.banner || "").trim() &&
      textLength(source.description) >= 80 &&
      textLength(source.story) >= 150 &&
      String(source.province || "").trim() &&
      String(source.city || "").trim() &&
      Array.isArray(source.fashionCategories) &&
      source.fashionCategories.length > 0
  );
};

export const isBrandDiscoverable = ({ store, vendorStatus }) =>
  store?.approvalStatus === "APPROVED" &&
  vendorStatus === "APPROVED" &&
  hasCompletePublicProfile(store);

// Recompute discoveryEligible after vendor account state changes so a brand
// approved while the vendor was pending can become discoverable without a
// second moderation pass. Brands that are not APPROVED stay hidden.
export const syncBrandDiscoveryEligibility = async (vendorId) => {
  const [store, vendor] = await Promise.all([
    Store.findOne({ vendor: vendorId }),
    Vendor.findById(vendorId).select("status").lean(),
  ]);
  if (!store || !vendor) return null;

  const eligible = store.approvalStatus === "APPROVED" && isBrandDiscoverable({
    store,
    vendorStatus: vendor.status,
  });
  if (store.discoveryEligible !== eligible) {
    store.discoveryEligible = eligible;
    await store.save();
  }
  return store;
};

export default {
  hasCompletePublicProfile,
  isBrandDiscoverable,
  syncBrandDiscoveryEligibility,
};
