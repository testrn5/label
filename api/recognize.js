export const config = { api: { bodyParser: { sizeLimit: '4mb' } } };

// Актуальные бесплатные vision-модели (OpenRouter часто их меняет)
const FREE_VISION_MODELS = [
  "google/gemini-2.0-flash-exp:free",
  "meta-llama/llama-3.2-90b-vision-instruct:free",
  "qwen/qwen2.5-vl-72b-instruct:free",
  "mistralai/pixtral-12b:free",
  "meta-llama/llama-3.2-11b-vision-instruct:free" // На случай, если free вернут
];

const SYSTEM_PROMPT = `Ты эксперт по распознаванию товаров и мусора. Верни ТОЛЬКО валидный JSON без markdown и пояснений.
Формат: {"product_name":"","manufacturer":"","brand":"","country":"","category":"","description":"кратко на русском","barcode":null,"weight":null,"ingredients":null,"recyclable":true,"confidence":"high"|"medium"|"low"}.
Используй null, если поле неизвестно.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { image, mediaType } = req.body;
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) return res.status(500).json({ error: "OPENROUTER_API_KEY не настроен" });
  if (!image || !mediaType) return res.status(400).json({ error: "Нет изображения" });

  const errors = [];

  for (const model of FREE_VISION_MODELS) {
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
          model,
          messages: [{
            role: "user",
            content: [
              { type: "text", text: SYSTEM_PROMPT },
              { type: "image_url", image_url: { url: `data:${mediaType};base64,${image}` } }
            ]
          }],
          temperature: 0.2
        })
      });

      const data = await response.json();

      if (data.error) {
        const msg = data.error.message || "";
        // Если модель недоступна бесплатно или не найдена — пробуем следующую
        if (msg.includes("unavailable for free") || msg.includes("not a valid model") || msg.includes("not available")) {
          continue; 
        }
        throw new Error(`${model}: ${msg}`);
      }

      const text = data.choices?.[0]?.message?.content;
      if (!text) continue;

      const clean = text.replace(/```json\n?|\n?```/g, "").trim();
      return res.status(200).json({ ...JSON.parse(clean), _used_model: model });

    } catch (err) {
      errors.push(`${model}: ${err.message}`);
      continue;
    }
  }

  return res.status(503).json({ error: "Все бесплатные модели недоступны", details: errors });
}
