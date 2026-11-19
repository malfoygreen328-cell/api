import ProductRelationshipService from "../services/ProductRelationshipService.js";
import ProductRelationship from "../models/ProductRelationship.js";

export const getCompleteTheLook = async (req, res, next) => {
  try {
    const { productId } = req.params;
    const relationships = await ProductRelationshipService.getCompleteTheLook(productId);
    res.json({ success: true, data: relationships });
  } catch (error) {
    next(error);
  }
};

export const addCompleteTheLook = async (req, res, next) => {
  try {
    const { sourceProductId, relatedProductId } = req.body;
    const relationship = await ProductRelationshipService.addCompleteTheLook(
      sourceProductId,
      relatedProductId,
      req.user?._id
    );
    res.status(201).json({ success: true, data: relationship });
  } catch (error) {
    next(error);
  }
};

export const getProductRelationships = async (req, res, next) => {
  try {
    const { productId } = req.params;
    const relationships = await ProductRelationship.find({
      sourceProduct: productId,
      isActive: true,
    }).populate("relatedProduct");
    res.json({ success: true, data: relationships });
  } catch (error) {
    next(error);
  }
};
