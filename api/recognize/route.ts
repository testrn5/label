import { NextRequest, NextResponse } from 'next/server';

const SYSTEM_PROMPT = `Ты эксперт по распознаванию товаров и мусора. Верни ТОЛЬКО валидный JSON без markdown и пояснений.
Формат: {"product_name":"","manufacturer":"","brand":"","country":"","category":"","description":"кратко на русском","barcode":null,"weight":null,"ingredients":null,"recyclable":true,"confidence":"high"|"medium"|"low"}.
Используй null, если поле неизвестно.`;

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
          (m.description || '').toLowerCase().includes('vision') ||
          (m.name || '').toLowerCase().includes('vision') ||
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

export async function POST(req: NextRequest) {
  const { image, mediaType, preferredModels } = await req.json();
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) return NextResponse.json({ error: 'OPENROUTER_API_KEY не настроен' }, { status: 500 });
  if (!image || !mediaType) return NextResponse.json({ error: 'Нет изображения' }, { status: 400 });

  // Получаем все бесплатные модели
  const allModels = await getFreeModels(apiKey);
  if (allModels.length === 0) {
    return NextResponse.json({ error: 'Не удалось получить список бесплатных моделей' }, { status: 503 });
  }
  // Формируем порядок: сначала preferredModels (из localStorage), потом остальные
  const preferred = (preferredModels || []).filter((m: string) => allModels.includes(m));
  const rest = allModels.filter((m: string) => !preferred.includes(m));
  const orderedModels = [...preferred, ...rest];

  const tried: string[] = [];
  const skipped: string[] = [];
  const preferredUsed: string[] = [];

  for (const model of orderedModels) {
    tried.push(model);
    try {
      const result = await tryModel(model, image, mediaType, apiKey);
      if (result.success) {
        // Если модель из preferred — помечаем
        const fromPreferred = preferred.includes(model);
        if (fromPreferred) preferredUsed.push(model);
        
        return NextResponse.json({
          ...result.result,
          _used_model: model,
          _from_preferred: fromPreferred,
          _total_tried: tried.length,
          _total_skipped: skipped.length,
          _preferred_count: preferred.length,
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
    error: `Все ${tried.length} бесплатных моделей недоступны`,
    _tried_models: tried,
    _skipped_models: skipped
  }, { status: 503 });
}
