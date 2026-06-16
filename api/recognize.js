export const config = { api: { bodyParser: { sizeLimit: '4mb' } } };

const SYSTEM_PROMPT = `Ты эксперт по распознаванию товаров и мусора. Верни ТОЛЬКО валидный JSON без markdown и пояснений.
Формат:
{
  "product_name": "полное название",
  "manufacturer": "производитель или null",
  "brand": "бренд или null",
  "country": "страна или null",
  "category": "категория продукта или мусора",
  "description": "краткое описание на русском (1-2 предложения)",
  "barcode": "штрихкод или null",
  "weight": "указанный на упаковке вес/объём (например '500 мл', '1 л') или null",
  "ingredients": "состав или материалы или null",
  "recyclable": true/false,
  "material_type": "plastic"|"glass"|"aluminum"|"paper"|"metal"|"cardboard"|"other",
  "size": "small"|"medium"|"large"|"xlarge",
  "confidence": "high"|"medium"|"low"
}
material_type — основной материал упаковки.
size — размер: small (банка 0.33л), medium (1л), large (1.5-2л), xlarge (5л+).
Используй null, если поле неизвестно.`;

const MODEL_LIST = [
  "nex-agi/nex-n2-pro:free",
  "google/gemini-2.0-flash-exp:free",
  "meta-llama/llama-3.2-90b-vision-instruct:free",
  "qwen/qwen2.5-vl-72b-instruct:free",
  "mistralai/pixtral-12b:free",
];

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
          (m.id || '').toLowerCase().includes('vl');        return isFree && hasVision;
      })
      .map(m => m.id)
      .slice(0, 50);
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
      messages: [{
        role: 'user',
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
    const skip =
      msg.includes('unavailable for free') ||
      msg.includes('not a valid model') ||
      msg.includes('not available') ||
      msg.includes('model_not_found') ||
      msg.includes('rate limit');

    if (skip) return { success: false, skip: true, error: msg.slice(0, 80) };
    return { success: false, skip: false, error: msg };
  }

  const text = data.choices?.[0]?.message?.content;
  if (!text) return { success: false, skip: true, error: 'Пустой ответ' };

  const clean = text.replace(/```json\n?|\n?```/g, '').trim();  const parsed = JSON.parse(clean);
  return { success: true, result: parsed };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { image, mediaType, preferredModels, useSpecificModel } = req.body;
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) return res.status(500).json({ error: 'OPENROUTER_API_KEY не настроен' });
  if (!image || !mediaType) return res.status(400).json({ error: 'Нет изображения' });

  let modelsToTry = [];

  if (useSpecificModel) {
    modelsToTry = [useSpecificModel];
  } else {
    const allModels = await getFreeModels(apiKey);
    if (allModels.length === 0) {
      return res.status(503).json({ error: 'Не удалось получить список бесплатных моделей' });
    }

    const defaultModel = "nex-agi/nex-n2-pro:free";
    const preferred = (preferredModels || []).filter(m => allModels.includes(m) && m !== defaultModel);
    const modelListFiltered = MODEL_LIST.filter(m => allModels.includes(m) && m !== defaultModel && !preferred.includes(m));
    const rest = allModels.filter(m => 
      m !== defaultModel && 
      !preferred.includes(m) && 
      !modelListFiltered.includes(m)
    );
    
    modelsToTry = [defaultModel, ...preferred, ...modelListFiltered, ...rest];
  }

  const tried = [];
  const skipped = [];

  for (const model of modelsToTry) {
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
          _skipped_models: skipped        });
      }
      if (result.skip) {
        skipped.push(model);
      } else {
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
    error: `Все ${tried.length} моделей недоступны`,
    _tried_models: tried,
    _skipped_models: skipped
  });
}
