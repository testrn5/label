import { NextRequest, NextResponse } from 'next/server';

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
size — размер упаковки: small (банка 0.33л, маленькая бутылка), medium (1л бутылка, пакет молока), large (1.5-2л бутылка, большая коробка), xlarge (канистра 5л+, большая коробка).
Используй null, если поле неизвестно.`;

// Список моделей для перебора (nex-n2-pro первая как основная)
const MODEL_LIST = [
  "nex-agi/nex-n2-pro:free",  // Основная рабочая модель
  "google/gemini-2.0-flash-exp:free",
  "meta-llama/llama-3.2-90b-vision-instruct:free",
  "qwen/qwen2.5-vl-72b-instruct:free",
  "mistralai/pixtral-12b:free",
];

const MAX_MODELS = 50;

async function getFreeModels(apiKey: string) {
  try {
    const response = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    const data = await response.json();
    return (data.data || [])
      .filter((m: any) => {
        const pricing = m.pricing || {};
        const promptPrice = parseFloat(pricing.prompt || '1');
        const completionPrice = parseFloat(pricing.completion || '1');
        const isFree = promptPrice === 0 && completionPrice === 0;
        const hasVision =
          (m.architecture?.modality || '').includes('image') ||
          (m.architecture?.modality || '').includes('vision') ||
          (m.description || '').toLowerCase().includes('vision') ||          (m.name || '').toLowerCase().includes('vision') ||
          (m.id || '').toLowerCase().includes('vision') ||
          (m.id || '').toLowerCase().includes('vl') ||
          (m.id || '').toLowerCase().includes('pixtral') ||
          (m.id || '').toLowerCase().includes('gemini');
        return isFree && hasVision;
      })
      .map((m: any) => m.id)
      .slice(0, MAX_MODELS);
  } catch {
    return [];
  }
}

async function tryModel(model: string, image: string, mediaType: string, apiKey: string) {
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
    const code = data.error.code || '';
    const skip =
      msg.includes('unavailable for free') ||
      msg.includes('not a valid model') ||
      msg.includes('not available') ||
      msg.includes('model_not_found') ||
      code === 'model_not_found' ||
      code === 'model_unavailable' ||
      msg.includes('rate limit');
    if (skip) return { success: false, skip: true, error: msg.slice(0, 80) };
    return { success: false, skip: false, error: msg };
  }

  const text = data.choices?.[0]?.message?.content;
  if (!text) return { success: false, skip: true, error: 'Пустой ответ' };

  const clean = text.replace(/```json\n?|\n?```/g, '').trim();
  const parsed = JSON.parse(clean);
  return { success: true, result: parsed };
}

export async function POST(req: NextRequest) {
  const { image, mediaType, preferredModels, useSpecificModel } = await req.json();
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) return NextResponse.json({ error: 'OPENROUTER_API_KEY не настроен' }, { status: 500 });
  if (!image || !mediaType) return NextResponse.json({ error: 'Нет изображения' }, { status: 400 });

  let modelsToTry: string[] = [];

  // Если указана конкретная модель для теста — используем только её
  if (useSpecificModel) {
    modelsToTry = [useSpecificModel];
  } else {
    // Получаем все бесплатные модели
    const allModels = await getFreeModels(apiKey);
    if (allModels.length === 0) {
      return NextResponse.json({ error: 'Не удалось получить список бесплатных моделей' }, { status: 503 });
    }

    // Формируем порядок: 
    // 1. Сначала конкретная модель из списка (nex-n2-pro)
    // 2. Затем preferredModels (из localStorage)
    // 3. Затем остальные из MODEL_LIST
    // 4. Затем все остальные
    const defaultModel = "nex-agi/nex-n2-pro:free";
    const preferred = (preferredModels || []).filter((m: string) => allModels.includes(m) && m !== defaultModel);
    const modelListFiltered = MODEL_LIST.filter(m => allModels.includes(m) && m !== defaultModel && !preferred.includes(m));
    const rest = allModels.filter((m: string) => 
      m !== defaultModel && 
      !preferred.includes(m) && 
      !modelListFiltered.includes(m)
    );
    
    modelsToTry = [defaultModel, ...preferred, ...modelListFiltered, ...rest];
  }

  const tried: string[] = [];
  const skipped: string[] = [];
  for (const model of modelsToTry) {
    tried.push(model);
    try {
      const result = await tryModel(model, image, mediaType, apiKey);
      if (result.success) {
        return NextResponse.json({
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
        return NextResponse.json({
          error: `Критическая ошибка на модели ${model}: ${result.error}`,
          _tried_models: tried
        }, { status: 500 });
      }
    } catch (err) {
      skipped.push(model);
      continue;
    }
  }

  return NextResponse.json({
    error: `Все ${tried.length} моделей недоступны`,
    _tried_models: tried,
    _skipped_models: skipped
  }, { status: 503 });
}
