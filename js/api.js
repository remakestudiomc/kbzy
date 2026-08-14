/* ============================================================
   Модуль интеграции с Gemini через Cloudflare Worker
   - Ключ хранится только на Cloudflare (секрет)
   - Приложение отправляет фото/описание на Worker
   - Worker вызывает Gemini и возвращает JSON с КБЖУ
   ============================================================ */

/**
 * Анализ блюда через Cloudflare Worker (безопасно)
 * @param {string} imageBase64 - data URL изображения (или null)
 * @param {string} description - текстовое описание (или пусто)
 * @param {string} workerUrl - URL Cloudflare Worker
 * @param {string} model - выбранная модель ('auto' или конкретная)
 * @returns {Promise<{name, weight, kcal, protein, fats, carbs, description}>}
 */
async function geminiAnalyzeFood(imageBase64, description, workerUrl, model) {
  const hasImage = !!(imageBase64 && String(imageBase64).startsWith('data:image'));
  if (!hasImage && !description) {
    throw new Error('Добавьте фото блюда или введите описание');
  }

  if (!workerUrl) {
    throw new Error('Не указан URL облачного Worker. Откройте ⚙️ Настройки и укажите его.');
  }

  // Проверяем, что workerUrl похож на адрес Cloudflare
  if (!/^https:\/\/.+\.workers\.dev/.test(workerUrl) && !/^https:\/\/.+\/.+/.test(workerUrl)) {
    throw new Error('URL Worker выглядит некорректно. Проверьте в настройках.');
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

  const body = {
    image: optimizedImage || '',
    description: description || '',
    model: model || 'gemini-flash-latest',
  };

  let resp;
  try {
    resp = await fetch(workerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new Error('Не удалось подключиться к облачному Worker. Проверьте интернет и URL в настройках.');
  }

  if (!resp.ok) {
    let message = `Ошибка Worker (${resp.status})`;
    try {
      const errJson = await resp.json();
      if (errJson.error) {
        message = 'Ошибка Worker: ' + errJson.error;
        // Понятные сообщения
        if (errJson.error.includes('GEMINI_API_KEY')) {
          message = '❌ На Cloudflare не задан ключ GEMINI_API_KEY. Добавьте переменную в настройках Worker.';
        }
        if (errJson.error.includes('на фото не обнаружена еда')) {
          message = 'На фото не обнаружена еда. Сделайте фото блюда и попробуйте снова.';
          const err = new Error(message);
          err.noFood = true;
          throw err;
        }
      }
    } catch (err) {
      if (err.noFood) throw err;
    }

    // Ошибки Google API, переданные через Worker
    if (message.includes('403') || message.includes('API key') || message.includes('permission')) {
      message = '❌ Ключ на Cloudflare неверный или отозван. Обновите GEMINI_API_KEY на Cloudflare.';
    }
    if (message.includes('429') || message.includes('quota') || message.includes('rate limit')) {
      message = '⏳ Бесплатный лимит исчерпан. Попробуйте позже.';
    }

    throw new Error(message);
  }

  const result = await resp.json();
  if (result.error) {
    throw new Error(result.error);
  }

  if (!result || typeof result.kcal !== 'number' || isNaN(result.kcal)) {
    throw new Error('Worker вернул некорректный ответ');
  }

  return {
    name: result.name || 'Блюдо',
    weight: result.weight || 0,
    kcal: result.kcal || 0,
    protein: result.protein || 0,
    fats: result.fats || 0,
    carbs: result.carbs || 0,
    description: description || '',
    model: result.model || '',
  };
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