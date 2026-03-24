// src/controllers/adController.js
import Ad from "../models/Ad.js";

/* ---------------- CREATE AD ---------------- */
export const createAd = async (req, res) => {
  try {
    const { title, description, link, imageUrl, isActive, order } = req.body;

    // Validate required fields
    if (!title || !imageUrl) {
      return res.status(400).json({
        success: false,
        message: "Title and imageUrl are required",
      });
    }

    const newAd = await Ad.create({
      title,
      description: description || "",
      link: link || "#",
      imageUrl,
      isActive: isActive ?? true,
      order: order ?? 0,
    });

    res.status(201).json({
      success: true,
      message: "Ad created successfully",
      data: newAd,
    });
  } catch (err) {
    console.error("Create Ad Error:", err);
    res.status(500).json({
      success: false,
      message: "Failed to create ad",
      error: err.message,
    });
  }
};

/* ---------------- GET ALL ADS ---------------- */
export const getAds = async (req, res) => {
  try {
    const ads = await Ad.find().sort({ order: 1, createdAt: -1 });
    res.status(200).json({ success: true, data: ads });
  } catch (err) {
    console.error("Get Ads Error:", err);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve ads",
      error: err.message,
    });
  }
};

/* ---------------- UPDATE AD ---------------- */
export const updateAd = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, link, imageUrl, isActive, order } = req.body;

    const ad = await Ad.findById(id);
    if (!ad) {
      return res.status(404).json({ success: false, message: "Ad not found" });
    }

    ad.title = title ?? ad.title;
    ad.description = description ?? ad.description;
    ad.link = link ?? ad.link;
    ad.imageUrl = imageUrl ?? ad.imageUrl;
    ad.isActive = isActive ?? ad.isActive;
    ad.order = order ?? ad.order;

    await ad.save();

    res.status(200).json({
      success: true,
      message: "Ad updated successfully",
      data: ad,
    });
  } catch (err) {
    console.error("Update Ad Error:", err);
    res.status(500).json({
      success: false,
      message: "Failed to update ad",
      error: err.message,
    });
  }
};

/* ---------------- DELETE AD ---------------- */
export const deleteAd = async (req, res) => {
  try {
    const { id } = req.params;

    const ad = await Ad.findByIdAndDelete(id);
    if (!ad) {
      return res.status(404).json({ success: false, message: "Ad not found" });
    }

    res.status(200).json({
      success: true,
      message: "Ad deleted successfully",
    });
  } catch (err) {
    console.error("Delete Ad Error:", err);
    res.status(500).json({
      success: false,
      message: "Failed to delete ad",
      error: err.message,
    });
  }
};