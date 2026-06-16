export const config = { api: { bodyParser: { sizeLimit: '4mb' } } };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  
  const { image, mediaType } = req.body;
  const apiKey = process.env.OPENROUTER_API_KEY;
  
  if (!apiKey) return res.status(500).json({ error: "API key missing" });

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://vercel.app", // Требуется OpenRouter
        "X-Title": "Waste Recognizer"
      },
      body: JSON.stringify({
        model: "qwen/qwen2-vl-7b-instruct:free", // Бесплатная модель с поддержкой зрения
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Ты эксперт по распознаванию товаров и мусора. Проанализируй изображение и верни ТОЛЬКО валидный JSON без markdown и пояснений в таком формате: {\"product_name\":\"\",\"manufacturer\":\"\",\"brand\":\"\",\"country\":\"\",\"category\":\"\",\"description\":\"краткое описание на русском\",\"barcode\":null,\"weight\":null,\"ingredients\":null,\"recyclable\":true,\"confidence\":\"high\"|\"medium\"|\"low\"}. Если поле неизвестно, используй null." },
              { type: "image_url", image_url: { url: `data:${mediaType};base64,${image}` } }
            ]
          }
        ]
      })
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    
    const text = data.choices[0].message.content;
    const clean = text.replace(/```json\n?|\n?```/g, "").trim();
    res.status(200).json(JSON.parse(clean));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "AI error: " + err.message });
  }
}
