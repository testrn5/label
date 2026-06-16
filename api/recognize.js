export const config = { api: { bodyParser: { sizeLimit: '4mb' } } };

// Бесплатные vision-модели OpenRouter (актуально на июнь 2026)
const OPENROUTER_MODELS = [
  "google/gemini-2.0-flash-exp:free",
  "meta-llama/llama-3.2-90b-vision-instruct:free",
  "qwen/qwen2.5-vl-72b-instruct:free",
  "mistralai/pixtral-12b:free"
];

const SYSTEM_PROMPT = `Ты эксперт по распознаванию товаров и мусора. Верни ТОЛЬКО валидный JSON без markdown и пояснений.
Формат: {"product_name":"","manufacturer":"","brand":"","country":"","category":"","description":"кратко на русском","barcode":null,"weight":null,"ingredients":null,"recyclable":true,"confidence":"high"|"medium"|"low"}.
Используй null, если поле неизвестно.`;

async function tryOpenRouter(image, mediaType, apiKey) {
  const errors = [];
  
  for (const model of OPENROUTER_MODELS) {
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
        if (msg.includes("unavailable for free") || msg.includes("not a valid model") || msg.includes("not available")) {
          continue;
        }
        throw new Error(`${model}: ${msg}`);
      }
      const text = data.choices?.[0]?.message?.content;
      if (!text) continue;

      const clean = text.replace(/```json\n?|\n?```/g, "").trim();
      return { result: JSON.parse(clean), source: `OpenRouter (${model})` };

    } catch (err) {
      errors.push(`${model}: ${err.message}`);
      continue;
    }
  }
  
  throw new Error("OpenRouter: " + errors.join("; "));
}

async function tryGemini(image, mediaType, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
  
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{
        parts: [
          { inline_data: { mime_type: mediaType, data: image } },
          { text: SYSTEM_PROMPT }
        ]
      }],
      generationConfig: { temperature: 0.2, responseMimeType: "application/json" }
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini: ${err}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
  const clean = text.replace(/```json\n?|\n?```/g, "").trim();
  return { result: JSON.parse(clean), source: "Google Gemini (direct)" };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { image, mediaType } = req.body;
  
  if (!image || !mediaType) {
    return res.status(400).json({ error: "Нет изображения" });  }

  const openrouterKey = process.env.OPENROUTER_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

  // Пробуем OpenRouter
  if (openrouterKey) {
    try {
      const { result, source } = await tryOpenRouter(image, mediaType, openrouterKey);
      return res.status(200).json({ ...result, _source: source });
    } catch (err) {
      console.warn("OpenRouter failed:", err.message);
    }
  }

  // Fallback на Gemini
  if (geminiKey) {
    try {
      const { result, source } = await tryGemini(image, mediaType, geminiKey);
      return res.status(200).json({ ...result, _source: source });
    } catch (err) {
      console.error("Gemini failed:", err.message);
    }
  }

  return res.status(503).json({ 
    error: "Все AI-сервисы недоступны. Добавьте OPENROUTER_API_KEY или GEMINI_API_KEY в настройках Vercel." 
  });
}
