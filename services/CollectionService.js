import Collection from "../models/Collection.js";

class CollectionService {
  async getActiveCollections() {
    try {
      const now = new Date();
      // NOTE: a single object literal cannot carry two `$or` keys (the second
      // silently overwrites the first) - the window bounds are combined with
      // $and so BOTH the start and end conditions are enforced.
      const collections = await Collection.find({
        isActive: true,
        $and: [
          {
            $or: [
              { startDate: { $exists: false } },
              { startDate: null },
              { startDate: { $lte: now } },
            ],
          },
          {
            $or: [
              { endDate: { $exists: false } },
              { endDate: null },
              { endDate: { $gte: now } },
            ],
          },
        ],
      })
        .populate("products.product")
        .sort({ sortOrder: 1, createdAt: -1 });

      return collections;
    } catch (error) {
      console.error("Error getting collections:", error);
      return [];
    }
  }

  async getCollectionBySlug(slug) {
    try {
      const collection = await Collection.findOne({
        slug,
        isActive: true,
      }).populate("products.product vendors");

      if (!collection) {
        return null;
      }

      const now = new Date();
      if (collection.startDate && collection.startDate > now) {
        return null;
      }
      if (collection.endDate && collection.endDate < now) {
        return null;
      }

      return collection;
    } catch (error) {
      console.error("Error getting collection by slug:", error);
      return null;
    }
  }

  async createCollection(collectionData, curatedBy) {
    try {
      const collection = await Collection.create({
        ...collectionData,
        curatedBy,
      });
      return collection;
    } catch (error) {
      console.error("Error creating collection:", error);
      throw error;
    }
  }
}

export default new CollectionService();
