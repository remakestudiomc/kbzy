/* ============================================================
   OpenRouter — распознавание еды
   Запросы идут напрямую из браузера, ключ только в localStorage.

   Главное отличие от первой версии: модель не «угадывает одно
   число», а разбирает кадр на компоненты, оценивает каждый в
   граммах и суммирует. Итог можно уточнить словами
   («это было на гриле») — модель пересчитывает с учётом поправки.
   ============================================================ */

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_AUTH_URL = 'https://openrouter.ai/api/v1/auth/key';
const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
const OPENROUTER_SITE = 'https://github.com/remakestudiomc/kbzy';

const DEFAULT_MODEL = 'google/gemini-2.5-flash';
const REQUEST_TIMEOUT = 90000;

/* ============================================================
   Основной вызов
   ============================================================ */

/**
 * @param {Object} opts
 * @param {string} [opts.image]        data URL фото
 * @param {string} [opts.description]  описание словами
 * @param {string} opts.apiKey
 * @param {string} [opts.model]
 * @param {Object} [opts.profile]      профиль пользователя (пол, возраст, рост, вес, цель)
 * @param {Object} [opts.previous]     предыдущий результат (для уточнения)
 * @param {string} [opts.correction]   поправка пользователя
 * @param {number} [opts.normKcal]     дневная норма — контекст для модели
 * @returns {Promise<Object>}
 */
async function analyzeFood(opts) {
  const image = opts.image || '';
  const description = String(opts.description || '').trim();
  const apiKey = String(opts.apiKey || '').trim();
  const hasImage = image.startsWith('data:image');

  if (!hasImage && !description) {
    throw new Error('Добавьте фото блюда или опишите его словами');
  }
  if (!apiKey) {
    const err = new Error('Вставьте API-ключ OpenRouter в настройках');
    err.needKey = true;
    throw err;
  }

  let optimized = image;
  if (hasImage) {
    try {
      optimized = await compressImage(image, 1024, 0.78);
    } catch (e) {
      console.warn('Не удалось сжать фото:', e);
    }
  }

  const model = String(opts.model || '').trim() || DEFAULT_MODEL;
  const prompt = buildPrompt({
    description,
    hasImage,
    profile: opts.profile,
    normKcal: opts.normKcal,
    previous: opts.previous,
    correction: opts.correction,
  });

  let text;
  try {
    text = await requestCompletion({ prompt, image: hasImage ? optimized : '', apiKey, model });
  } catch (err) {
    // Ошибки сети/ключа/лимитов повторять бессмысленно
    if (err.httpStatus || err.needKey) throw err;
    // Возможен кривой JSON — пробуем ещё раз с коротким промптом
    text = await requestCompletion({ prompt: SIMPLE_PROMPT, image: hasImage ? optimized : '', apiKey, model });
  }

  return parseResult(text, model);
}

async function requestCompletion({ prompt, image, apiKey, model }) {
  const content = [{ type: 'text', text: prompt }];
  if (image) content.push({ type: 'image_url', image_url: { url: image } });

  let resp;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    resp = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
        'HTTP-Referer': OPENROUTER_SITE,
        // ВАЖНО: только ASCII — браузер не пропустит кириллицу в заголовке
        'X-Title': 'KBJU Dnevnik',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content }],
        response_format: { type: 'json_object' },
        temperature: 0.15,
        max_tokens: 1400,
      }),
      signal: controller.signal,
    });
  } catch (e) {
    if (e && e.name === 'AbortError') {
      throw new Error('OpenRouter не отвечает (таймаут 90 с). Проверьте интернет и повторите.');
    }
    const reachable = await checkOpenRouterConnection();
    if (!reachable) {
      throw new Error('openrouter.ai недоступен из вашей сети. Отключите VPN, блокировщик рекламы или антивирус.');
    }
    throw new Error('Запрос не ушёл в OpenRouter (' + (e.name || 'сеть') + '). Сайт доступен, но запрос блокируется — проверьте VPN/блокировщик.');
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) throw await buildHttpError(resp);

  const data = await resp.json();
  const text = data && data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content
    : '';
  if (!String(text).trim()) throw new Error('Нейросеть вернула пустой ответ');
  return text;
}

/* ============================================================
   Промпт
   ============================================================ */

const GOAL_RU = { cut: 'похудение (дефицит)', maintain: 'поддержание веса', bulk: 'набор массы (профицит)' };

function describeProfile(profile, normKcal) {
  if (!profile) return '';
  const parts = [];
  if (profile.sex) parts.push(profile.sex === 'f' ? 'женщина' : 'мужчина');
  if (profile.age) parts.push(profile.age + ' лет');
  if (profile.height) parts.push('рост ' + profile.height + ' см');
  if (profile.weight) parts.push('вес ' + profile.weight + ' кг');
  if (profile.goal) parts.push('цель — ' + (GOAL_RU[profile.goal] || profile.goal));
  if (!parts.length) return '';

  let line = 'ПРОФИЛЬ ПОЛЬЗОВАТЕЛЯ: ' + parts.join(', ') + '.';
  if (normKcal) line += ' Дневная норма ~' + Math.round(normKcal) + ' ккал.';
  line += ' Порции оценивай как для взрослого человека такого телосложения, если на фото нет явных признаков другого.';
  return line;
}

function buildPrompt({ description, hasImage, profile, normKcal, previous, correction }) {
  const profileLine = describeProfile(profile, normKcal);

  const descBlock = description
    ? '\nОПИСАНИЕ ОТ ПОЛЬЗОВАТЕЛЯ (доверяй ему больше, чем догадкам по фото): «' + description + '»'
    : '';

  const source = hasImage
    ? 'У тебя есть фото приёма пищи.' + (description ? ' И описание.' : '')
    : 'Фото нет — только текстовое описание блюда.';

  const correctionBlock = correction
    ? '\n\nПОПРАВКА ПОЛЬЗОВАТЕЛЯ: «' + correction + '»\n' +
      (previous
        ? 'Предыдущий расчёт (JSON): ' + JSON.stringify({
            name: previous.name,
            weight: previous.weight,
            kcal: previous.kcal,
            protein: previous.protein,
            fats: previous.fats,
            carbs: previous.carbs,
            components: previous.components || [],
          }) + '\n' +
          'Пересчитай с учётом поправки. Если она касается одного компонента — меняй только его и пересчитай итог, остальные оставь как были.'
        : 'Учти поправку в расчёте.')
    : '';

  return `Ты — спортивный нутрициолог. Считаешь КБЖУ приёма пищи для дневника питания. Отвечай по-русски.

${profileLine}

${source}${descBlock}

КАК СЧИТАТЬ:
1. Разбери кадр на отдельные компоненты: гарнир, мясо/рыба, соус, напиток, добавки. Не сваливай всё в одно «блюдо», если видно составные части.
2. Оцени вес каждого компонента в граммах. Масштаб: обеденная тарелка 24–27 см, вилка 19 см, стакан 250 мл, ладонь ≈ 100–120 г мяса, столовая ложка ≈ 15 г.
3. Учитывай приготовление: жарка — плюс 7–10 г масла на порцию; панировка или кляр — плюс мука и масло; сливочный соус — 20–30% жира; сладкий напиток — около 10 г сахара на 100 мл.
4. Считай по справочным значениям на 100 г продукта, затем пересчитывай на вес. Итог = сумма компонентов.
5. Не занижай «на всякий случай» и не завышай. Сомневаешься между двумя вариантами — бери среднее.
6. В notes одной короткой строкой перечисли главные допущения (что не видно: масло, соус, сахар).
7. confidence — твоя уверенность от 0 до 1.

Верни ТОЛЬКО JSON без markdown и пояснений:
{"result":true,"name":"Название блюда","weight":250,"kcal":350,"protein":15.5,"fats":12,"carbs":40.2,"confidence":0.8,"components":[{"name":"Куриная грудка","grams":150,"kcal":248,"protein":46,"fats":5,"carbs":0}],"notes":"Масло не видно, учтено 8 г"}

Если на фото нет еды — верни {"result":false}.${correctionBlock}`;
}

const SIMPLE_PROMPT = 'Определи КБЖУ этого приёма пищи по фото и/или описанию. Верни строго валидный JSON без markdown: {"result": true, "name": "Название", "weight": 250, "kcal": 350, "protein": 15.5, "fats": 12, "carbs": 40.2, "confidence": 0.7, "components": [], "notes": ""}. Если еды нет — {"result": false}.';

/* ============================================================
   Разбор ответа
   ============================================================ */

function toNum(v, def) {
  const n = typeof v === 'number' ? v : parseFloat(String(v == null ? '' : v).replace(',', '.'));
  return isNaN(n) ? (def || 0) : n;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function parseResult(text, model) {
  const cleaned = String(text).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();

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
    const err = new Error('На фото не видно еды');
    err.noFood = true;
    throw err;
  }

  const components = Array.isArray(json.components)
    ? json.components
        .filter((c) => c && c.name)
        .map((c) => ({
          name: String(c.name).slice(0, 80),
          grams: Math.round(toNum(c.grams)),
          kcal: Math.round(toNum(c.kcal)),
          protein: round1(toNum(c.protein)),
          fats: round1(toNum(c.fats)),
          carbs: round1(toNum(c.carbs)),
        }))
    : [];

  let kcal = toNum(json.kcal);
  let protein = toNum(json.protein);
  let fats = toNum(json.fats);
  let carbs = toNum(json.carbs);

  // Если модель дала компоненты, но забыла итог — суммируем сами
  if ((!kcal || kcal <= 0) && components.length) {
    kcal = components.reduce((s, c) => s + c.kcal, 0);
    protein = components.reduce((s, c) => s + c.protein, 0);
    fats = components.reduce((s, c) => s + c.fats, 0);
    carbs = components.reduce((s, c) => s + c.carbs, 0);
  }

  // Итог и разбивка должны сходиться: если расходятся сильно, верим разбивке
  if (components.length >= 2 && kcal > 0) {
    const sumKcal = components.reduce((s, c) => s + c.kcal, 0);
    if (sumKcal > 0 && Math.abs(sumKcal - kcal) / kcal > 0.12) {
      kcal = sumKcal;
      protein = components.reduce((s, c) => s + c.protein, 0);
      fats = components.reduce((s, c) => s + c.fats, 0);
      carbs = components.reduce((s, c) => s + c.carbs, 0);
    }
  }

  if (!kcal || kcal <= 0) {
    throw new Error('Не получилось определить калорийность — попробуйте другое фото или уточните описание');
  }

  return {
    name: String(json.name || 'Блюдо').trim().slice(0, 120) || 'Блюдо',
    weight: Math.max(0, Math.round(toNum(json.weight))),
    kcal: Math.round(kcal),
    protein: round1(protein),
    fats: round1(fats),
    carbs: round1(carbs),
    confidence: Math.min(1, Math.max(0, toNum(json.confidence, 0.6))),
    components,
    notes: String(json.notes || '').slice(0, 200),
    model,
  };
}

/* ============================================================
   Ошибки и диагностика
   ============================================================ */

async function buildHttpError(resp) {
  let detail = '';
  try {
    const errJson = await resp.json();
    if (errJson && errJson.error && errJson.error.message) detail = String(errJson.error.message);
  } catch (e) { /* тело не JSON */ }

  const err = new Error(detail || ('Ошибка API (' + resp.status + ')'));
  err.httpStatus = resp.status;

  if (resp.status === 401) err.message = 'Неверный API-ключ. Проверьте ключ OpenRouter в настройках.';
  else if (resp.status === 402) err.message = 'Недостаточно средств на балансе OpenRouter.';
  else if (resp.status === 403) err.message = 'Доступ запрещён (403). Проверьте ключ и настройки модели.';
  else if (resp.status === 404) err.message = 'Модель не найдена. Проверьте название модели в настройках.';
  else if (resp.status === 429) err.message = 'Слишком много запросов. Подождите минуту.';
  else if (/invalid.*api|unauthorized|incorrect api key/i.test(detail)) err.message = 'Неверный API-ключ.';
  else if (/insufficient|credits|balance/i.test(detail)) err.message = 'Недостаточно средств на балансе OpenRouter.';

  return err;
}

async function checkOpenRouterConnection() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const resp = await fetch(OPENROUTER_MODELS_URL, {
      headers: { 'Accept': 'application/json' },
      signal: controller.signal,
    });
    return resp.ok;
  } catch (e) {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function checkOpenRouterKey(apiKey) {
  const key = String(apiKey || '').trim();
  if (!key) return { ok: false, message: 'Вставьте ключ в поле выше' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const resp = await fetch(OPENROUTER_AUTH_URL, {
      headers: { 'Authorization': 'Bearer ' + key, 'Accept': 'application/json' },
      signal: controller.signal,
    });
    if (resp.ok) {
      const data = await resp.json().catch(() => null);
      const label = data && data.label ? ' «' + data.label + '»' : '';
      const limit = data && typeof data.limit_remaining === 'number' ? ' · осталось $' + data.limit_remaining.toFixed(2) : '';
      return { ok: true, message: 'Ключ рабочий' + label + limit };
    }
    if (resp.status === 401) return { ok: false, message: 'Неверный ключ — скопируйте заново' };
    return { ok: false, message: 'OpenRouter ответил ' + resp.status };
  } catch (e) {
    if (e && e.name === 'AbortError') return { ok: false, message: 'OpenRouter не отвечает' };
    const reachable = await checkOpenRouterConnection();
    return {
      ok: false,
      message: reachable ? 'Запрос блокируется — проверьте VPN/блокировщик' : 'openrouter.ai недоступен из вашей сети',
    };
  } finally {
    clearTimeout(timer);
  }
}

/* ============================================================
   Изображения
   ============================================================ */

/**
 * Сжимает картинку под нужный размер.
 * @returns {Promise<string>} JPEG data URL
 */
function compressImage(dataUrl, maxDim, quality) {
  const limit = maxDim || 1024;
  const q = quality || 0.78;

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        let { width, height } = img;
        const scale = Math.min(1, limit / Math.max(width, height));
        width = Math.max(1, Math.round(width * scale));
        height = Math.max(1, Math.round(height * scale));

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', q));
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error('Не удалось прочитать изображение'));
    img.src = dataUrl;
  });
}

/** Маленькое превью для хранения в дневнике (чтобы база не пухла) */
function makeThumb(dataUrl) {
  return compressImage(dataUrl, 400, 0.62).catch(() => dataUrl);
}
