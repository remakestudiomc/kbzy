/* ============================================================
   Модуль интеграции с Google Gemini API (бесплатно)
   - Автоматический перебор актуальных моделей
   - Отправляет фото + описание в нейросеть
   - Получает JSON с КБЖУ блюда
   ============================================================ */

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/';

// Актуальные модели в порядке приоритета (устаревшие убраны)
const GEMINI_MODELS = [
  'gemini-flash-latest',      // Всегда указывает на актуальный Flash
  'gemini-2.5-flash',         // Стабильная модель с поддержкой изображений
  'gemini-2.5-flash-lite',    // Быстрая и лёгкая
];

/**
 * Анализ фото блюда через Gemini с автоматическим выбором модели.
 * Пробует каждую модель по очереди, пока одна не сработает.
 *
 * @param {string} imageBase64 - data URL или чистый base64 изображения
 * @param {string} description - пользовательское описание (может быть пустым)
 * @param {string} apiKey - ключ API Gemini
 * @param {string|string[]} modelOrList - модель или список моделей для перебора
 * @returns {Promise<{name: string, weight: number, kcal: number, protein: number, fats: number, carbs: number, description: string}>}
 */
async function geminiAnalyzeFood(imageBase64, description, apiKey, modelOrList) {
  // Проверка: нужно фото или описание
  const hasImage = !!(imageBase64 && String(imageBase64).startsWith('data:image'));
  if (!hasImage && !description) {
    throw new Error('Добавьте фото блюда или введите описание');
  }

  // Строим список моделей для перебора
  let models = [];
  if (Array.isArray(modelOrList)) {
    models = modelOrList.length > 0 ? modelOrList : [...GEMINI_MODELS];
  } else if (typeof modelOrList === 'string' && modelOrList && modelOrList !== 'auto') {
    // Пользователь выбрал конкретную модель — она первая, затем запасные
    models = [modelOrList, ...GEMINI_MODELS.filter((m) => m !== modelOrList)];
  } else {
    models = [...GEMINI_MODELS];
  }

  // Убираем дубликаты
  models = [...new Set(models)];

  let lastError = null;

  for (const model of models) {
    try {
      return await geminiAnalyzeWithModel(imageBase64, description, apiKey, model);
    } catch (err) {
      lastError = err;

      // Если проблема с ключом/квотой/сетью — не перебираем, сразу ошибка
      if (isFatalError(err)) {
        throw err;
      }

      // Модель недоступна или дала плохой ответ — пробуем следующую
      console.warn(`Модель ${model} не сработала:`, err.message);
    }
  }

  throw lastError || new Error('Все модели недоступны. Попробуйте позже.');
}

/**
 * Анализ через конкретную модель.
 * Поддерживает анализ по фото, по описанию, или по обоим.
 */
async function geminiAnalyzeWithModel(imageBase64, description, apiKey, model) {
  const hasImage = !!(imageBase64 && String(imageBase64).startsWith('data:image'));

  let parts = [];

  // Промпт адаптируется под наличие фото
  const prompt = buildPrompt(description, hasImage);
  parts.push({ text: prompt });

  // Если есть фото — добавляем изображение
  if (hasImage) {
    // Если передали data URL вида  data:image/jpeg;base64,XXXX  — извлекаем чистый base64
    let base64 = imageBase64;
    const mimeMatch = base64.match(/^data:([^;]+);base64,(.+)$/);
    let mime = 'image/jpeg';
    if (mimeMatch) {
      mime = mimeMatch[1];
      base64 = mimeMatch[2];
    }

    // Сжимаем изображение, чтобы уменьшить размер запроса
    const optimizedBase64 = await optimizeImage(base64, mime);
    const imageMime = mimeMatch ? mimeMatch[1] : 'image/jpeg';

    parts.push({
      inline_data: {
        mime_type: imageMime,
        data: optimizedBase64,
      },
    });
  }

  const url = `${GEMINI_ENDPOINT}${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const body = {
    contents: [
      {
        parts,
      },
    ],
    generationConfig: {
      temperature: 0.2,
      topP: 0.8,
      topK: 20,
      maxOutputTokens: 2048,
      responseMimeType: 'application/json',
    },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
    ],
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    let message = `Ошибка API (${resp.status}) для модели ${model}`;
    let rawMessage = message;
    try {
      const errJson = JSON.parse(errText);
      if (errJson.error && errJson.error.message) {
        rawMessage = errJson.error.message;
        message = `${rawMessage} (модель: ${model})`;
      }
    } catch (e) { /* ignore */ }

    const err = new Error(message);
    err.rawStatus = resp.status;
    err.rawMessage = rawMessage;
    err.model = model;
    throw err;
  }

  const data = await resp.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text || !text.trim()) {
    const err = new Error(`Модель ${model} не вернула результат`);
    err.model = model;
    throw err;
  }

  return parseResult(text, description, model);
}

/* ---------- Определение фатальных ошибок ---------- */

function isFatalError(err) {
  const msg = String(err.message || '').toLowerCase();
  const status = err.rawStatus || 0;

  // Проблемы с ключом — перебор не поможет
  if (status === 403 || status === 401 || msg.includes('api key')) return true;
  if (msg.includes('permission') || msg.includes('forbidden') || msg.includes('unauthorized')) return true;

  // Квота/лимиты
  if (status === 429 || msg.includes('quota') || msg.includes('rate limit') || msg.includes('resource exhausted')) return true;

  // Нет модели НЕ является фатальным — перебираем дальше
  // if (status === 404 || msg.includes('not found')) return false;

  return false;
}

/* ---------- Формирование промпта ---------- */

function buildPrompt(description, hasImage) {
  // Описание от пользователя
  const descPart = description
    ? `\nДополнительная информация от пользователя, используйте её для точного расчёта: "${description}".`
    : '';

  // Адаптируем промпт под источник данных
  let sourcePart = '';
  if (hasImage && description) {
    sourcePart = `У тебя есть фото блюда и описание от пользователя. Внимательно изучи фото и используй описание для уточнения.\n\nПосмотри внимательно на фото еды. Определи:
1. Что за блюдо/продукты на фото (название).
2. Примерный вес порции в граммах (оцени по размеру на фото относительно типичных размеров порций, тарелок, ложек, столовых приборов).
3. Калорийность в килокалориях на эту порцию.
4. Белки, жиры, углеводы в граммах на эту порцию.`;
  } else if (hasImage) {
    sourcePart = `У тебя есть фото блюда.\n\nПосмотри внимательно на фото еды. Определи:
1. Что за блюдо/продукты на фото (название).
2. Примерный вес порции в граммах (оцени по размеру на фото относительно типичных размеров порций, тарелок, ложек, столовых приборов).
3. Калорийность в килокалориях на эту порцию.
4. Белки, жиры, углеводы в граммах на эту порцию.`;
  } else {
    sourcePart = `У тебя нет фото — только текстовое описание блюда от пользователя.\n\nПроанализируй описание и определи:
1. Полное название блюда или приёма пищи.
2. Оцени типичный вес порции: для горячего блюда ~200-300 г, для завтрака (каша/яичница) ~150-250 г, для перекуса ~50-100 г, для напитка ~200-250 мл.
3. Калорийность в килокалориях на эту порцию.
4. Белки, жиры, углеводы в граммах на эту порцию.`;
  }

  return `Ты — профессиональный диетолог и нутрициолог с 20-летним опытом. Твоя задача — максимально точно оценить КБЖУ блюда.

${sourcePart}

Правила расчёта:
- Учитывай все ингредиенты, которые видишь или которые названы в описании, и их примерные пропорции.
- Используй таблицы калорийности: мясо ~150-250 ккал/100г, овощи ~20-60 ккал/100г, каши ~80-120 ккал/100г, масло ~890 ккал/100г и т.д.
- Честно оценивай порции. Если порция небольшая — ставь маленький вес.
- Если это напиток — оценивай его калорийность отдельно.
- Не переоценивай и не занижай калории.${descPart}

${hasImage ? 'ВАЖНО: Если на фото нет еды (например, пустая тарелка, стол, или вообще не еда) — верни result со значением false.' : ''}

Верни ТОЛЬКО валидный JSON (без markdown-разметки и комментариев) в таком формате:
{
  "result": true,
  "name": "Название блюда на русском",
  "weight": 250,
  "kcal": 350,
  "protein": 15.5,
  "fats": 12,
  "carbs": 40.2
}`;
}

/* ---------- Парсинг результата ---------- */

function parseResult(text, userDescription, model) {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();

  let json;
  try {
    json = JSON.parse(cleaned);
  } catch (e) {
    // Пытаемся найти JSON в тексте (модель могла добавить пояснения)
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error(`Модель ${model} вернула некорректный ответ. Пробуем другую...`);
    }
    try {
      json = JSON.parse(match[0]);
    } catch (e2) {
      throw new Error(`Модель ${model} вернула некорректный ответ. Пробуем другую...`);
    }
  }

  if (json.result === false) {
    const err = new Error('На фото не обнаружена еда. Сделайте фото блюда и попробуйте снова.');
    err.noFood = true;
    throw err;
  }

  const num = (v, def = 0) => {
    if (typeof v === 'number') return v;
    const n = parseFloat(String(v).replace(',', '.'));
    return isNaN(n) ? def : n;
  };

  const result = {
    name: String(json.name || 'Блюдо').trim() || 'Блюдо',
    weight: Math.round(num(json.weight)),
    kcal: Math.round(num(json.kcal, 0) * 10) / 10,
    protein: Math.round(num(json.protein) * 10) / 10,
    fats: Math.round(num(json.fats) * 10) / 10,
    carbs: Math.round(num(json.carbs) * 10) / 10,
    description: userDescription || '',
    model: model,
  };

  // Защита: если нейросеть дала 0 калорий, но назвала блюдо — пробуем другую модель
  if (result.kcal <= 0) {
    throw new Error(`Модель ${model} не смогла определить калорийность. Пробуем другую...`);
  }

  return result;
}

/* ---------- Сжатие изображения ---------- */

/**
 * Сжимает изображение до разумного размера (макс. 1280px, качество 0.8)
 * @returns {Promise<string>} чистый base64 без префикса
 */
function optimizeImage(base64, mime) {
  return new Promise((resolve, reject) => {
    const img = new Image();

    img.onload = () => {
      try {
        const MAX_DIM = 1280;
        let { width, height } = img;

        if (width > MAX_DIM || height > MAX_DIM) {
          const scale = MAX_DIM / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }

        // Ограничиваем размер canvas: если изображение гигантское — уменьшаем принудительно
        if (width * height > 2000000) { // ~2 мегапикселя
          const scale2 = Math.sqrt(2000000 / (width * height));
          width = Math.round(width * scale2);
          height = Math.round(height * scale2);
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');

        // Белый фон вместо прозрачного (чтобы не было чёрных областей у PNG)
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        const outMime = mime && mime !== 'image/gif' ? mime : 'image/jpeg';
        resolve(canvas.toDataURL(outMime, 0.8).split(',')[1]);
      } catch (err) {
        reject(err);
      }
    };

    img.onerror = () => reject(new Error('Не удалось обработать изображение. Попробуйте другое фото.'));

    img.src = `data:${mime};base64,${base64}`;
  });
}