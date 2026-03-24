import Product from "../models/Product.js";

export const createProduct = async (req, res) => {

  try {

    const product = new Product(req.body);

    await product.save();

    res.json(product);

  } catch (error) {

    res.status(500).json(error);

  }

};