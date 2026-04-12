import express from "express";
import OpenAI from "openai";

const router = express.Router();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Optional: check if API key exists at startup
if (!process.env.OPENAI_API_KEY) {
  console.warn("⚠️ OPENAI_API_KEY is not set!");
}

router.post("/", async (req, res) => {
  try {
    const { message, language = "en", products = [] } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    // Build smarter system prompt
    const systemPrompt = `
You are a helpful AI assistant for Azania Shop (an e-commerce marketplace).

Rules:
- Respond in ${language}
- Be concise, friendly, and helpful
- If relevant, recommend products from the list below
- If no relevant product exists, answer normally

Products:
${JSON.stringify(products).slice(0, 2000)}
`;

    // ✅ FIXED: use supported model
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message }
      ],
      temperature: 0.7,
      max_tokens: 300
    });

    // Safe extraction
    const reply =
      response?.choices?.[0]?.message?.content ||
      "Sorry, I couldn't generate a response.";

    res.json({ reply });

  } catch (err) {
    // ✅ BETTER ERROR LOGGING
    console.error("🔥 OPENAI ERROR:");
    console.error(err.response?.data || err.message || err);

    res.status(500).json({
      error: "AI service failed",
      details: err.message
    });
  }
});

export default router;
