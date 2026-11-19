import Return from "../models/Return.js";

/* -------------------------
CREATE RETURN
--------------------------*/
export const createReturn = async (req, res) => {
  try {

    const { orderId, reason } = req.body;

    const newReturn = new Return({
      userId: req.user.id, // comes from auth middleware
      orderId,
      reason
    });

    await newReturn.save();

    res.status(201).json(newReturn);

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/* -------------------------
GET USER RETURNS
--------------------------*/
export const getUserReturns = async (req, res) => {
  try {

    const returns = await Return.find({
      userId: req.params.userId
    }).sort({ createdAt: -1 });

    res.json(returns);

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};