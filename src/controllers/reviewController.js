import Review from "../models/Review.js";

// POST /api/reviews
export const createReview = async (req, res, next) => {
  try {
    const { product, rating, comment } = req.body;
    const userId = req.user._id;

    // Check if user already reviewed product
    const existingReview = await Review.findOne({ product, user: userId });
    if (existingReview) {
      return res.status(400).json({
        message: "You have already reviewed this product",
      });
    }

    // Create and save new review
    const review = await Review.create({
      product,
      user: userId,
      rating,
      comment,
    });

    res.status(201).json({ success: true, review });
  } catch (err) {
    next(err);
  }
};

// GET /api/reviews/product/:id
export const getProductReviews = async (req, res, next) => {
  try {
    const reviews = await Review.find({ product: req.params.id })
      .populate("user", "fullName email")
      .sort({ createdAt: -1 });

    // Calculate average rating
    const avgRating =
      reviews.reduce((acc, r) => acc + r.rating, 0) /
      (reviews.length || 1);

    res.json({
      success: true,
      reviews,
      avgRating: avgRating.toFixed(1),
      count: reviews.length,
    });
  } catch (err) {
    next(err);
  }
};

// PUT /api/reviews/:id
export const updateReview = async (req, res, next) => {
  try {
    const review = await Review.findById(req.params.id);

    if (!review) {
      return res.status(404).json({ message: "Review not found" });
    }

    // Only owner or admin can update (assuming req.user.role available)
    if (
      review.user.toString() !== req.user._id.toString() &&
      req.user.role !== "admin"
    ) {
      return res.status(403).json({ message: "Not authorized" });
    }

    const { rating, comment } = req.body;

    if (rating) review.rating = rating;
    if (comment) review.comment = comment;

    await review.save();

    res.json({ success: true, review });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/reviews/:id
export const deleteReview = async (req, res, next) => {
  try {
    const review = await Review.findById(req.params.id);

    if (!review) {
      return res.status(404).json({ message: "Review not found" });
    }

    if (
      review.user.toString() !== req.user._id.toString() &&
      req.user.role !== "admin"
    ) {
      return res.status(403).json({ message: "Not authorized" });
    }

    await review.remove();

    res.json({ success: true, message: "Review deleted" });
  } catch (err) {
    next(err);
  }
};