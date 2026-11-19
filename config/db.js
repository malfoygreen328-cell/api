import mongoose from "mongoose";

const connectDB = async () => {
  try {
    if (!process.env.MONGO_URI) {
      throw new Error("MONGO_URI is not defined in environment variables");
    }

    // Debug: show masked URI
    const safeURI = process.env.MONGO_URI.replace(/:(.*)@/, ":*****@");
    console.log("🔌 Connecting to MongoDB:", safeURI);

    const conn = await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 5000, // fail fast if can't connect
    });

    console.log(`✅ MongoDB connected: ${conn.connection.host}`);
  } catch (error) {
    console.error("❌ DB connection error:");
    console.error(error.message);

    // Extra debug info
    if (error.name === "MongoNetworkError") {
      console.error("👉 Likely causes:");
      console.error("- IP not whitelisted in MongoDB Atlas");
      console.error("- Network/firewall blocking connection");
    }

    if (error.name === "MongoServerError") {
      console.error("👉 Likely causes:");
      console.error("- Wrong username/password");
      console.error("- Database user not created properly");
    }

    process.exit(1);
  }
};

export default connectDB;