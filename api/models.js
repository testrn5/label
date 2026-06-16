// Кеш списка моделей (обновляется раз в час)
let cachedModels = null;
let cacheTime = 0;
const CACHE_TTL = 60 * 60 * 1000; // 1 час

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  // Возвращаем кеш, если он свежий
  if (cachedModels && Date.now() - cacheTime < CACHE_TTL) {
    return res.status(200).json({ models: cachedModels, cached: true });
  }

  try {
    const response = await fetch('https://openrouter.ai/api/v1/models');
    const data = await response.json();

    // Фильтруем: price=0 и поддержка vision (image_url)
    const freeVisionModels = (data.data || [])
      .filter(m => {
        const pricing = m.pricing || {};
        const promptPrice = parseFloat(pricing.prompt || '1');
        const completionPrice = parseFloat(pricing.completion || '1');
        // Бесплатная модель
        const isFree = promptPrice === 0 && completionPrice === 0;
        // Поддерживает изображения (есть модальность vision или архитектура с vision)
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
      .map(m => ({
        id: m.id,
        name: m.name,
        context_length: m.context_length,
        description: (m.description || '').slice(0, 100)
      }))
      .slice(0, 50); // Лимит 50 моделей

    cachedModels = freeVisionModels;
    cacheTime = Date.now();

    res.status(200).json({ models: freeVisionModels, cached: false, total: freeVisionModels.length });
  } catch (err) {
    res.status(500).json({ error: 'Не удалось получить список моделей: ' + err.message });
  }
}
