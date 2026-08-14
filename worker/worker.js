// ============================================================
// Cloudflare Worker — безопасный прокси для Gemini API
// Ключ Gemini хранится ТОЛЬКО здесь, в секрете Cloudflare.
// Приложение на GitHub Pages обращается к этому Worker,
// а Worker вызывает Gemini со спрятанным ключом.
//
// КАК РАЗВЕРНУТЬ (1 раз, 5 минут, бесплатно):
// 1. Зайдите на https://dash.cloudflare.com → Sign up (бесплатно)
// 2. Слева: Workers & Pages → Create → Create Worker
// 3. Дайте имя: kbzy-proxy → Deploy
// 4. Нажмите Edit Code → удалите код по умолчанию → вставьте ЭТОТ код
// 5. Справа (Settings → Variables) добавьте переменную: GEMINI_API_KEY = ваш ключ
// 6. Нажмите Deploy
// 7. Скопируйте URL вида https://kbzy-proxy.ВАШ_ПОД_ДОМЕН.workers.dev
// 8. Этот URL вставьте в приложении: ⚙️ Настройки → URL облачного ключа
// ============================================================

export default {
  async fetch(request, env) {
    // Только POST
    if (request.method !== 'POST') {
      return json({ error: 'Метод не поддерживается' }, 405);
    }

    // Простой способ разрешить запросы с любых сайтов (CORS)
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Предварительный запрос браузера
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const apiKey = env.GEMINI_API_KEY;
    if (!apiKey) {
      return json({ error: 'На сервере не задан ключ GEMINI_API_KEY' }, 500, corsHeaders);
    }

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return json({ error: 'Некорректный JSON' }, 400, corsHeaders);
    }

    const { image, description, model } = body;
    if (!image && !description) {
      return json({ error: 'Нет фото и описания' }, 400, corsHeaders);
    }

    // Список моделей для перебора
    const models = [model, 'gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.5-flash-lite']
      .filter(Boolean)
      .filter((v, i, a) => a.indexOf(v) === i);

    let lastError = null;

    for (const m of models) {
      try {
        const result = await analyzeWithModel(m, image, description, apiKey);
        if (result) {
          return json(result, 200, corsHeaders);
        }
      } catch (err) {
        lastError = err.message || String(err);
      }
    }

    return json({ error: 'Не удалось проанализировать: ' + lastError }, 502, corsHeaders);
  }
};

// ---------- Анализ через конкретную модель ----------
async function analyzeWithModel(model, image, description, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const parts = [{ text: buildPrompt(description, !!image) }];

  if (image) {
    // image приходит как data URL: data:image/jpeg;base64,XXXX
    const match = String(image).match(/^data:([^;]+);base64,(.+)$/);
    let mime = 'image/jpeg';
    let base64 = image;
    if (match) {
      mime = match[1];
      base64 = match[2];
    }
    parts.push({
      inline_data: { mime_type: mime, data: base64 }
    });
  }

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        temperature: 0.2,
        topP: 0.8,
        topK: 20,
        maxOutputTokens: 2048,
        responseMimeType: 'application/json'
      },
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
      ]
    })
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Модель ${model}: ${resp.status} ${text.slice(0, 200)}`);
  }

  const data = await resp.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  if (!text.trim()) {
    throw new Error(`Модель ${model} не вернула результат`);
  }

  return parseResult(text, description || '', model);
}

// ---------- Промпт ----------
function buildPrompt(description, hasImage) {
  const descPart = description
    ? `\nДополнительная информация от пользователя, используйте её для точного расчёта: "${description}".`
    : '';

  let sourcePart;
  if (hasImage && description) {
    sourcePart = `У тебя есть фото блюда и описание от пользователя. Внимательно изучи фото и используй описание для уточнения.\n\nПосмотри внимательно на фото еды. Определи:\n1. Что за блюдо/продукты на фото (название).\n2. Примерный вес порции в граммах.\n3. Калорийность в килокалориях на эту порцию.\n4. Белки, жиры, углеводы в граммах на эту порцию.`;
  } else if (hasImage) {
    sourcePart = `У тебя есть фото блюда.\n\nПосмотри внимательно на фото еды. Определи:\n1. Что за блюдо/продукты на фото (название).\n2. Примерный вес порции в граммах.\n3. Калорийность в килокалориях на эту порцию.\n4. Белки, жиры, углеводы в граммах на эту порцию.`;
  } else {
    sourcePart = `У тебя нет фото — только текстовое описание блюда от пользователя.\n\nПроанализируй описание и определи:\n1. Полное название блюда или приёма пищи.\n2. Оцени типичный вес порции: горячее ~200-300 г, завтрак ~150-250 г, перекус ~50-100 г, напиток ~200-250 мл.\n3. Калорийность в килокалориях на эту порцию.\n4. Белки, жиры, углеводы в граммах на эту порцию.`;
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

Верни ТОЛЬКО валидный JSON в формате:
{"result": true, "name": "Название блюда на русском", "weight": 250, "kcal": 350, "protein": 15.5, "fats": 12, "carbs": 40.2}`;
}

// ---------- Парсинг ----------
function parseResult(text, userDescription, model) {
  const cleaned = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();

  let json;
  try {
    json = JSON.parse(cleaned);
  } catch (e) {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error(`Модель ${model} вернула некорректный ответ`);
    json = JSON.parse(match[0]);
  }

  if (json.result === false) {
    throw new Error('На фото не обнаружена еда');
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
    model
  };

  if (result.kcal <= 0) {
    throw new Error(`Модель ${model} не смогла определить калорийность`);
  }

  return result;
}

// ---------- Утилиты ----------
function json(data, status, corsHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders
    }
  });
}