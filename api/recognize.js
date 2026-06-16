export const config = { api: { bodyParser: { sizeLimit: '4mb' } } };

const SYSTEM_PROMPT = `Ты эксперт по распознаванию товаров и мусора. Верни ТОЛЬКО валидный JSON без markdown и пояснений.
Формат: {"product_name":"","manufacturer":"","brand":"","country":"","category":"","description":"кратко на русском","barcode":null,"weight":null,"ingredients":null,"recyclable":true,"confidence":"high"|"medium"|"low"}.
Используй null, если поле неизвестно.`;

const MAX_MODELS = 50;

async function getFreeModels(apiKey) {
  try {
    const response = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    const data = await response.json();
    return (data.data || [])
      .filter(m => {
        const pricing = m.pricing || {};
        const promptPrice = parseFloat(pricing.prompt || '1');
        const completionPrice = parseFloat(pricing.completion || '1');
        const isFree = promptPrice === 0 && completionPrice === 0;
        const hasVision = 
          (m.architecture?.modality || '').includes('image') ||
          (m.architecture?.modality || '').includes('vision') ||
          (m.description || '').toLowerCase().includes('vision') ||
          (m.name || '').toLowerCase().includes('vision') ||
          (m.id || '').toLowerCase().includes('vision') ||
          (m.id || '').toLowerCase().includes('vl') ||
          (m.id || '').toLowerCase().includes('pixtral') ||
          (m.id || '').toLowerCase().includes('gemini');
        return isFree && hasVision;
      })
      .map(m => m.id)
      .slice(0, MAX_MODELS);
  } catch {
    return [];
  }
}

async function tryModel(model, image, mediaType, apiKey) {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://vercel.app',
      'X-Title': 'Waste Recognizer'
    },
    body: JSON.stringify({
      model,
      messages: [{        role: 'user',
        content: [
          { type: 'text', text: SYSTEM_PROMPT },
          { type: 'image_url', image_url: { url: `data:${mediaType};base64,${image}` } }
        ]
      }],
      temperature: 0.2
    })
  });

  const data = await response.json();

  if (data.error) {
    const msg = data.error.message || '';
    const code = data.error.code || '';
    // Пропускаем модели, которые недоступны
    const skip = 
      msg.includes('unavailable for free') ||
      msg.includes('not a valid model') ||
      msg.includes('not available') ||
      msg.includes('model_not_found') ||
      code === 'model_not_found' ||
      code === 'model_unavailable' ||
      msg.includes('rate limit');
    
    if (skip) {
      return { success: false, skip: true, error: msg.slice(0, 80) };
    }
    return { success: false, skip: false, error: msg };
  }

  const text = data.choices?.[0]?.message?.content;
  if (!text) return { success: false, skip: true, error: 'Пустой ответ' };

  const clean = text.replace(/```json\n?|\n?```/g, '').trim();
  const parsed = JSON.parse(clean);
  return { success: true, result: parsed };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { image, mediaType } = req.body;
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) return res.status(500).json({ error: 'OPENROUTER_API_KEY не настроен' });
  if (!image || !mediaType) return res.status(400).json({ error: 'Нет изображения' });

  // Получаем список бесплатных моделей
  const models = await getFreeModels(apiKey);  if (models.length === 0) {
    return res.status(503).json({ error: 'Не удалось получить список бесплатных моделей' });
  }

  const tried = [];
  const skipped = [];

  // Перебираем модели (до 50)
  for (const model of models) {
    tried.push(model);
    try {
      const result = await tryModel(model, image, mediaType, apiKey);
      if (result.success) {
        return res.status(200).json({
          ...result.result,
          _used_model: model,
          _total_tried: tried.length,
          _total_skipped: skipped.length,
          _tried_models: tried,
          _skipped_models: skipped
        });
      }
      if (result.skip) {
        skipped.push(model);
      } else {
        // Критическая ошибка — останавливаемся
        return res.status(500).json({ 
          error: `Критическая ошибка на модели ${model}: ${result.error}`,
          _tried_models: tried
        });
      }
    } catch (err) {
      skipped.push(model);
      continue;
    }
  }

  return res.status(503).json({ 
    error: `Все ${tried.length} бесплатных моделей недоступны`,
    _tried_models: tried,
    _skipped_models: skipped
  });
}
