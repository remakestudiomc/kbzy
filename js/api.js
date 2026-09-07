/* ============================================================
   Модуль интеграции с OpenRouter (нейросеть)
   - Вызовы идут напрямую из браузера (OpenRouter поддерживает CORS)
   - API-ключ хранится только в localStorage пользователя и
     никогда не попадает в публичный код сайта
   - Используется ОДНА модель с поддержкой изображений
   ============================================================ */

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Единственная модель: умная, недорогая, отлично видит изображения.
// При желании модель можно заменить на другую из каталога openrouter.ai/models.
const OPENROUTER_MODEL = 'google/gemini-2.5-flash';

// URL сайта для статистики OpenRouter (никак не влияет на работу)
const OPENROUTER_SITE = 'https://github.com/remakestudiomc/kbzy';

/**
 * Анализ блюда через OpenRouter (безопасно — ключ в запросе, не в коде)
 * @param {string} imageBase64 - data URL изображения (или null)
 * @param {string} description - текстовое описание (или пусто)
 * @param {string} apiKey - API-ключ OpenRouter из настроек
 * @returns {Promise<{name, weight, kcal, protein, fats, carbs, description, model}>}
 */
async function openrouterAnalyzeFood(imageBase64, description, apiKey) {
  const hasImage = !!(imageBase64 && String(imageBase64).startsWith('data:image'));
  if (!hasImage && !description) {
    throw new Error('Добавьте фото блюда или введите описание');
  }

  const key = String(apiKey || '').trim();
  if (!key) {
    const err = new Error('Вставьте API-ключ OpenRouter в настройках');
    err.needKey = true;
    throw err;
  }

  // Если есть фото — сжимаем перед отправкой
  let optimizedImage = imageBase64;
  if (hasImage) {
    try {
      optimizedImage = await compressImage(imageBase64);
    } catch (e) {
      // Если сжать не удалось — отправляем как есть
      console.warn('Не удалось сжать фото:', e);
    }
  }

  // Первая попытка обычным промптом; при ошибке парсинга —
  // повтор с упрощённым промптом (чтобы нейросеть отвечала на любой запрос)
  try {
    return await analyzeOnce(optimizedImage, description, key, false);
  } catch (err) {
    if (err.httpStatus || err.needKey || err.noFood) throw err;
    try {
      return await analyzeOnce(optimizedImage, description, key, true);
    } catch (err2) {
      if (err2.httpStatus || err2.needKey || err2.noFood) throw err2;
      throw err;
    }
  }
}

async function analyzeOnce(image, description, apiKey, simple) {
  const content = [{ type: 'text', text: simple ? SIMPLE_PROMPT : buildPrompt(description, !!image) }];
  if (image) {
    content.push({ type: 'image_url', image_url: { url: image } });
  }

  let resp;
  try {
    resp = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
        'HTTP-Referer': OPENROUTER_SITE,
        'X-Title': 'КБЖУ Дневник',
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        messages: [{ role: 'user', content }],
        response_format: { type: 'json_object' },
        temperature: 0.2,
        max_tokens: 800,
      }),
    });
  } catch (e) {
    throw new Error('Не удалось подключиться к OpenRouter. Проверьте интернет.');
  }

  if (!resp.ok) {
    throw await buildHttpError(resp);
  }

  const data = await resp.json();
  const text = data?.choices?.[0]?.message?.content || '';
  if (!String(text).trim()) {
    throw new Error('Нейросеть не вернула результат');
  }

  return parseResult(text, description || '');
}

/* ---------- Разбор ошибок OpenRouter ---------- */

async function buildHttpError(resp) {
  let message = `Ошибка API (${resp.status})`;
  let detail = '';
  try {
    const errJson = await resp.json();
    if (errJson?.error?.message) {
      detail = String(errJson.error.message);
      message = detail;
    }
  } catch (e) { /* тело не JSON — оставляем общее сообщение */ }

  const err = new Error(message);
  err.httpStatus = resp.status;

  if (resp.status === 401) {
    err.message = '❌ Неверный API-ключ. Проверьте ключ OpenRouter в настройках.';
  } else if (resp.status === 402) {
    err.message = '💳 Недостаточно средств на балансе OpenRouter.';
  } else if (resp.status === 403) {
    err.message = '🚫 Доступ запрещён (403). Проверьте ключ OpenRouter.';
  } else if (resp.status === 429) {
    err.message = '⏳ Слишком много запросов. Попробуйте через минуту.';
  } else if (/invalid.*api|unauthorized|incorrect api key/i.test(detail)) {
    err.message = '❌ Неверный API-ключ. Проверьте ключ OpenRouter в настройках.';
  } else if (/insufficient|credits|balance/i.test(detail)) {
    err.message = '💳 Недостаточно средств на балансе OpenRouter.';
  } else if (/rate|limit|429/i.test(detail)) {
    err.message = '⏳ Слишком много запросов. Попробуйте через минуту.';
  }

  return err;
}

/* ---------- Промпты ---------- */

const SIMPLE_PROMPT = 'Определи КБЖУ этого блюда по фото и/или описанию. Верни СТРОГО валидный JSON без пояснений и без markdown в формате: {"result": true, "name": "Название блюда", "weight": 250, "kcal": 350, "protein": 15.5, "fats": 12, "carbs": 40.2}. Если на фото нет еды — верни {"result": false}.';

function buildPrompt(description, hasImage) {
  const descPart = description
    ? `\nДополнительная информация от пользователя, используйте её для точного расчёта: "${description}".`
    : '';

  let sourcePart;
  if (hasImage && description) {
    sourcePart = 'У тебя есть фото блюда и описание от пользователя. Внимательно изучи фото и используй описание для уточнения.\n\nПосмотри внимательно на фото еды. Определи:\n1. Что за блюдо/продукты на фото (название).\n2. Примерный вес порции в граммах.\n3. Калорийность в килокалориях на эту порцию.\n4. Белки, жиры, углеводы в граммах на эту порцию.';
  } else if (hasImage) {
    sourcePart = 'У тебя есть фото блюда.\n\nПосмотри внимательно на фото еды. Определи:\n1. Что за блюдо/продукты на фото (название).\n2. Примерный вес порции в граммах.\n3. Калорийность в килокалориях на эту порцию.\n4. Белки, жиры, углеводы в граммах на эту порцию.';
  } else {
    sourcePart = 'У тебя нет фото — только текстовое описание блюда от пользователя.\n\nПроанализируй описание и определи:\n1. Полное название блюда или приёма пищи.\n2. Оцени типичный вес порции: горячее ~200-300 г, завтрак ~150-250 г, перекус ~50-100 г, напиток ~200-250 мл.\n3. Калорийность в килокалориях на эту порцию.\n4. Белки, жиры, углеводы в граммах на эту порцию.';
  }

  return `Ты — профессиональный диетолог и нутрициолог с 20-летним опытом. Твоя задача — максимально точно оценить КБЖУ блюда.

${sourcePart}

Правила расчёта:
- Учитывай все ингредиенты и их примерные пропорции.
- Используй таблицы калорийности: мясо ~150-250 ккал/100г, овощи ~20-60 ккал/100г, каши ~80-120 ккал/100г, масло ~890 ккал/100г и т.д.
- Честно оценивай порции. Если порция небольшая — ставь маленький вес.
- Если это напиток — оценивай его калорийность отдельно.
- Не переоценивай и не занижай калории.${descPart}

${hasImage ? 'ВАЖНО: Если на фото нет еды — верни result со значением false.' : ''}

Верни ТОЛЬКО валидный JSON в формате (без пояснений и без markdown):
{"result": true, "name": "Название блюда на русском", "weight": 250, "kcal": 350, "protein": 15.5, "fats": 12, "carbs": 40.2}`;
}

/* ---------- Парсинг ---------- */

function parseResult(text, userDescription) {
  const cleaned = String(text).trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();

  let json;
  try {
    json = JSON.parse(cleaned);
  } catch (e) {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Нейросеть вернула некорректный ответ');
    try {
      json = JSON.parse(match[0]);
    } catch (e2) {
      throw new Error('Нейросеть вернула некорректный ответ');
    }
  }

  if (json.result === false) {
    const err = new Error('На фото не обнаружена еда');
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
    kcal: Math.round(num(json.kcal) * 10) / 10,
    protein: Math.round(num(json.protein) * 10) / 10,
    fats: Math.round(num(json.fats) * 10) / 10,
    carbs: Math.round(num(json.carbs) * 10) / 10,
    description: userDescription || '',
    model: OPENROUTER_MODEL,
  };

  if (result.kcal <= 0) {
    throw new Error('Нейросеть не смогла определить калорийность');
  }

  return result;
}

/* ---------- Сжатие изображения ---------- */

/**
 * Сжимает изображение до ~1МП, качество 0.75
 * @returns {Promise<string>} сжатый data URL
 */
function compressImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const MAX_DIM = 1024;
        let { width, height } = img;

        if (width > MAX_DIM || height > MAX_DIM) {
          const scale = MAX_DIM / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }

        // Ограничиваем до ~1.2 мегапикселя
        if (width * height > 1200000) {
          const scale2 = Math.sqrt(1200000 / (width * height));
          width = Math.round(width * scale2);
          height = Math.round(height * scale2);
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        resolve(canvas.toDataURL('image/jpeg', 0.75));
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error('Не удалось обработать изображение'));
    img.src = dataUrl;
  });
}