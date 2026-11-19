import CollectionService from "../services/CollectionService.js";
import Collection from "../models/Collection.js";

export const getCollections = async (req, res, next) => {
  try {
    const collections = await CollectionService.getActiveCollections();
    res.json({ success: true, data: collections });
  } catch (error) {
    next(error);
  }
};

export const getCollectionBySlug = async (req, res, next) => {
  try {
    const { slug } = req.params;
    const collection = await CollectionService.getCollectionBySlug(slug);

    if (!collection) {
      return res.status(404).json({
        success: false,
        message: "Collection not found",
      });
    }

    res.json({ success: true, data: collection });
  } catch (error) {
    next(error);
  }
};

export const createCollection = async (req, res, next) => {
  try {
    const collection = await CollectionService.createCollection(
      req.body,
      req.user?._id
    );
    res.status(201).json({ success: true, data: collection });
  } catch (error) {
    next(error);
  }
};

export const updateCollection = async (req, res, next) => {
  try {
    const { id } = req.params;
    const collection = await Collection.findByIdAndUpdate(id, req.body, {
      new: true,
    });
    if (!collection) {
      return res.status(404).json({ success: false, message: "Collection not found" });
    }
    res.json({ success: true, data: collection });
  } catch (error) {
    next(error);
  }
};
