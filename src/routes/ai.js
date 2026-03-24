// src/routes/ai.js
import express from "express";
import OpenAI from "openai";

const router = express.Router();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

router.post("/", async (req, res) => {
  try {
    const { message, language = "en", products = [] } = req.body;
    if (!message) return res.status(400).json({ error: "Message is required" });

    // Build system prompt for multilingual support and product context
    const systemPrompt = `
You are a helpful AI assistant for Azania Shop.
- Respond in ${language}.
- Use the product list to answer questions if relevant.
- Products: ${JSON.stringify(products)}
- Keep answers concise and friendly.
`;

    const response = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message }
      ],
      temperature: 0.7,
      max_tokens: 300
    });

    const reply = response.choices[0].message.content;
    res.json({ reply });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "AI service failed" });
  }
});

export default router;