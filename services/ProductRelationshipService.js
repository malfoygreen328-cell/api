import ProductRelationship from "../models/ProductRelationship.js";

class ProductRelationshipService {
  async getCompleteTheLook(productId) {
    try {
      const relationships = await ProductRelationship.find({
        sourceProduct: productId,
        relationshipType: "complete_the_look",
        isActive: true,
      })
        .populate("relatedProduct")
        .limit(10);

      return relationships.filter(r => r.relatedProduct && r.relatedProduct.isActive);
    } catch (error) {
      console.error("Error getting complete the look relationships:", error);
      return [];
    }
  }

  async addCompleteTheLook(sourceProductId, relatedProductId, curatedBy) {
    try {
      const relationship = await ProductRelationship.findOneAndUpdate(
        {
          sourceProduct: sourceProductId,
          relatedProduct: relatedProductId,
          relationshipType: "complete_the_look",
        },
        {
          strength: 1.0,
          isActive: true,
          curatedBy,
        },
        { upsert: true, new: true }
      );

      return relationship;
    } catch (error) {
      console.error("Error adding complete the look:", error);
      throw error;
    }
  }

  async getSimilarRelationships(productId) {
    try {
      const relationships = await ProductRelationship.find({
        sourceProduct: productId,
        relationshipType: "similar",
        isActive: true,
      })
        .populate("relatedProduct")
        .limit(10);

      return relationships.filter(r => r.relatedProduct && r.relatedProduct.isActive);
    } catch (error) {
      console.error("Error getting similar relationships:", error);
      return [];
    }
  }
}

export default new ProductRelationshipService();
