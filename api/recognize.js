export const config = { api: { bodyParser: { sizeLimit: '4mb' } } };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  
  const { image, mediaType } = req.body;
  const apiKey = process.env.OPENROUTER_API_KEY;
  
  if (!apiKey) {
    return res.status(500).json({ error: "API ключ не найден" });
  }

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://vercel.app",
        "X-Title": "Waste Recognizer"
      },
      body: JSON.stringify({
        model: "meta-llama/llama-3.2-11b-vision-instruct:free", // ✅ Исправленная модель
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Ты эксперт по распознаванию товаров и мусора. Верни ТОЛЬКО валидный JSON без markdown: {\"product_name\":\"\",\"manufacturer\":\"\",\"brand\":\"\",\"country\":\"\",\"category\":\"\",\"description\":\"кратко на русском\",\"barcode\":null,\"weight\":null,\"ingredients\":null,\"recyclable\":true,\"confidence\":\"high\"|\"medium\"|\"low\"}. Используй null, если неизвестно." },
              { type: "image_url", image_url: { url: `data:${mediaType};base64,${image}` } }
            ]
          }
        ]
      })
    });

    const data = await response.json();
    
    if (data.error) {
      return res.status(500).json({ error: data.error.message || "Ошибка OpenRouter" });
    }
    
    const text = data.choices[0].message.content;
    const clean = text.replace(/```json\n?|\n?```/g, "").trim();
    res.status(200).json(JSON.parse(clean));
  } catch (err) {
    res.status(500).json({ error: "Ошибка сервера: " + err.message });
  }
}
