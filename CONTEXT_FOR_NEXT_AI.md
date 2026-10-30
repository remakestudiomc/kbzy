# КБЖУ Дневник (KBZY) — контекст для передачи другой нейросети

**Репозиторий:** https://github.com/remakestudiomc/kbzy
**GitHub Pages:** https://remakestudiomc.github.io/kbzy/
**Ветка:** master
**Язык:** русский (все сообщения пользователю — на русском)

## 1. Что это

PWA для учёта питания: фото или описание блюда → OpenRouter (`google/gemini-2.5-flash`) → JSON с КБЖУ.
Чистый HTML/JS без сборщика, хостинг — GitHub Pages. API-ключ только в localStorage пользователя.

Проект личный, один пользователь. Дневная норма вводится вручную — профиль (пол/возраст/рост/цель) из
приложения убран по просьбе пользователя, в промпт он тоже не передаётся.

## 2. Версия 2.0 — что изменилось

| Коммит | Что |
|---|---|
| 2.0 | Полный редизайн (тёмная/светлая тема, Lucide-иконки инлайн), авто-пересчёт КБЖУ, редактирование избранного, копирование записей между днями, статистика, экспорт/импорт, уточнение расчёта словами |
| 2.1 | Убраны приёмы пищи (плоский список еды), полный КБЖУ по компонентам, убран профиль, выбор модели из списка, ввод веса в статистике |

До этого: `f7e5321` (календарь/кольцо/свайп/undo), `51837c5` (кириллица в `X-Title`), `71ac11a` (диагностика).

## 3. Архитектура

```
index.html          — разметка всех экранов (дневник, статистика, настройки, оверлей добавления, нижний лист)
css/style.css       — дизайн-система на CSS-переменных, темы через [data-theme]
js/icons.js         — пути Lucide в объекте ICON_PATHS + icon()/renderIcons()
js/db.js            — IndexedDB + настройки + экспорт/импорт + утилиты дат
js/api.js           — запрос в OpenRouter, промпт, парсинг, сжатие фото
js/app.js           — вся логика UI
sw.js               — network-first кеш (CACHE_NAME = kbzy-cache-v22)
```

### Важные соглашения

- **Все файлы — обычные `<script>`, общая глобальная область.** Любое совпадающее имя на верхнем уровне
  (например `const round1` в `app.js` и `function round1` в `api.js`) роняет **весь** файл с
  `Identifier 'round1' has already been declared`, причём молча — интерфейс просто не оживает.
  Проверять `node --check` недостаточно, смотреть консоль браузера.
- **Один делегированный обработчик** `onActionClick` на `document`, все кнопки — `data-action="..."`.
  `verify.py` проверяет, что у каждого `data-action` из HTML есть `case` в `app.js`.
- **`[hidden] { display: none !important; }`** — иначе классы с `display:block/flex` перебивают атрибут
  (было с битым `<img>` и кнопкой «Другое фото»).
- **Никаких CDN.** Иконки — инлайн SVG, шрифты системные. Приложение должно работать офлайн.
- **`X-Title` в заголовке запроса — только ASCII.** Кириллица ломает `fetch` в браузере.
- **Дата-пикер**: `input[type=date]` скрыт классом `.visually-hidden` (1×1, opacity 0), а не `display:none`,
  иначе `showPicker()` бросает исключение.

## 4. Модель данных

```js
entry  = { id, name, weight, kcal, protein, fats, carbs, description, image, date, createdAt }
fav    = { id, name, weight, kcal, protein, fats, carbs, description, createdAt }
weight = { id, weight, date, createdAt }
```

- `meal` — **больше не используется**. У записей версии 2.0 поле осталось, приложение его игнорирует.
- `date` — строка `YYYY-MM-DD`
- `image` — уменьшенное превью (400 px, JPEG 0.62), в API уходит отдельно сжатое 1024 px
- База: `kbzy-diary`, версия **3**, сторы `entries`/`settings`/`favorites`/`weights` — **не менять**,
  иначе потеряются данные пользователя
- Настройки в `localStorage['kbzy-settings']`: нормы, `openrouterKey`, `model`, `theme`

## 5. Как проверять

```bash
node --check js/app.js
python scripts/verify.py        # нужен Pillow
```

Визуальная проверка — headless Chromium:

```bash
python -m http.server 8099 --bind 127.0.0.1   # в фоне
playwright-cli open "http://127.0.0.1:8099/index.html"
playwright-cli resize 390 844
playwright-cli eval "async () => { await DBAddEntry({...}); await refreshDiary(); return 'ok'; }"
playwright-cli screenshot
```

Сессия `playwright-cli` живёт только внутри одной bash-команды — open/resize/eval/screenshot
надо объединять в одну цепочку. Контекст браузера каждый раз чистый, IndexedDB пустая: данные
засевать в том же вызове. Все функции из `app.js` доступны глобально, поэтому тестировать
логику можно напрямую (`fillResult(...)`, `openEntryMenu(id)`, `deleteEntry(id)`).

Ключ для проверки API можно взять из локального `.env` (он в `.gitignore`, сервер его раздаёт):
`const env = await (await fetch('/.env')).text()`.

## 6. Деплой

```bash
git add -A && git commit -m "..." && git push origin master
```

GitHub Pages пересобирает сайт за 1–2 минуты. Service worker network-first, поэтому новая
версия подтягивается сама; при изменении списка файлов в `CORE_ASSETS` поднимать `CACHE_NAME`.

## 7. Безопасность

- `.env` с `KEY=sk-or-v1-...` — никогда не коммитить
- В коде не должно быть `sk-or-v1-...` и `AIza...` (проверяется `verify.py`)
- `verify.py` не даёт вернуть кириллицу в `X-Title`
