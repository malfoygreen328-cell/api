import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export const chatWithAI = async (req, res) => {
  try {
    const { message, language = "en", products = [] } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

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
    console.error("AI Controller Error:", err);
    res.status(500).json({ error: "AI service failed" });
  }
};