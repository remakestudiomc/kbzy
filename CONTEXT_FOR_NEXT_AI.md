# КБЖУ Дневник (KBZY) — контекст для передачи другой нейросети

**Репозиторий:** https://github.com/remakestudiomc/kbzy  
**GitHub Pages:** https://remakestudiomc.github.io/kbzy/  
**Последний коммит:** `51837c5` — Fix OpenRouter requests: X-Title header must be ASCII-only  
**Ветка:** master  
**Язык:** русский (все сообщения пользователю — на русском)

## 1. О чём проект

PWA «КБЖУ дневник» — учёт питания с анализом фото блюд через нейросеть.  
Пользователь фотографирует еду (или пишет описание) → запрос в **OpenRouter** (модель `google/gemini-2.5-flash`) → JSON с названием, весом, калориями, БЖУ.

**Архитектура:** чистый HTML/JS, без сборщика. Хостинг — GitHub Pages.  
Service Worker с network-first (кеш только при отсутствии сети).  
API-ключ OpenRouter **только в localStorage** пользователя, никогда не в коде/гите.

## 2. Что уже сделано (история изменений)

| Коммит | Что |
|---|---|
| `51837c5` | **Исправлена главная ошибка:** `X-Title: 'КБЖУ Дневник'` → `'KBJU Dnevnik'` (кириллица в HTTP-заголовке вызывала `TypeError: String contains non ISO-8859-1 code point` в браузере, запрос не уходил из браузера). |
| `71ac11a` | Страница диагностики `diagnostic.html` (4 шага проверки соединения/ключа/POST-запросов). Улучшены сообщения об ошибках. |
| `db2e20b` | `.env` добавлен в `.gitignore` и закоммичен. |
| `2ed5338` | Кнопка проверки ключа, сетевая диагностика, таймауты, cache v19. |

**Текущее состояние:** всё в гите, изменения пушнуты в `origin/master`, GitHub Pages обновлён.


## 3. Ключевые файлы

```
js/api.js          — логика запросов к OpenRouter (анализ фото, проверка ключа, сжатие картинки)
js/app.js          — основной UI, IndexedDB, отрисовка записей
js/db.js           — IndexedDB wrapper (записи, избранное, вес, настройки)
sw.js              — Service Worker, офлайн, PWA-кеширование
index.html         — главная страница
manifest.webmanifest — манифест PWA
diagnostic.html    — автономная страница диагностики OpenRouter
.env               — локально: API-ключ OpenRouter (НЕ в гите, в .gitignore)
scripts/verify.py  — скрипт проверки структуры проекта
```

**Модель:** `google/gemini-2.5-flash`  
**API:** `https://openrouter.ai/api/v1/chat/completions`  
**Заголовки:** `Content-Type`, `Authorization: Bearer <key>`, `HTTP-Referer`, `X-Title: KBJU Dnevnik` (только ASCII!)  
**Сжатие картинки:** ~1024 px по длинной стороне, ~1.2 Мп, качество 0.75 JPEG  
**Таймаут:** 90 секунд


## 4. Баг, который был исправлен (важно!)

**Симптом:** пользователь нажимал «Анализировать», в консоли браузера `TypeError: Failed to execute 'fetch' ... String contains non ISO-8859-1 code point`. Запрос не уходил из браузера. GET-запросы (проверка ключа) работали, POST — нет.

**Причина:** в заголовке `X-Title` была кириллица `'КБЖУ Дневник'`. Стандарт Fetch запрещает не-ASCII символы в HTTP-заголовках. Браузер кидает TypeError до отправки запроса.

**Фикс:** `'X-Title': 'KBJU Dnevnik'` (только латиница).

> ⚠️ Если другая нейросеть будет править `js/api.js` — не возвращай кириллицу в `X-Title` и другие HTTP-заголовки. Кириллица разрешена только в теле запроса (промпт, описание) — там используется JSON с UTF-8.


## 5. Как подключить эту нейросеть к GitHub (чтобы она могла вносить изменения напрямую)

### Способ А — через Composio (рекомендуется)

1. Выполни `composio_search_tools` с запросом `"connect GitHub toolkit"`.
2. Выполни `composio_manage_connections` с `toolkits: ["github"]` — получишь ссылку на авторизацию.
3. Пройди авторизацию на сайте GitHub, подтверди доступ.
4. Выполни `composio_wait_for_connections` с `toolkits: ["github"]`, `mode: "all"` — дождись состояния `ACTIVE`.
5. Используй `composio_multi_execute_tool` с GitHub-инструментами:
   - `GITHUB_GET_CONTENTS` — прочитать файл из репозитория
   - `GITHUB_CREATE_A_FILE` — создать файл
   - `GITHUB_UPDATE_A_FILE` — обновить существующий файл
   - `GITHUB_CREATE_A_PULL_REQUEST` — создать PR
   - `GITHUB_LIST_COMMITS` — история коммитов

Пример вызова:
```json
{"tools": [{"tool_slug": "GITHUB_GET_CONTENTS", "arguments": {"owner": "remakestudiomc", "repo": "kbzy", "path": "js/api.js"}}], "sync_response_to_workbench": false}
```

### Способ Б — через Git REST API (PAT)

1. Создай токен на `github.com/settings/tokens` с правами `repo`.
2. `GET https://api.github.com/repos/remakestudiomc/kbzy/contents/js/api.js` — получить файл
3. `PUT https://api.github.com/repos/remakestudiomc/kbzy/contents/js/api.js` — обновить (base64-содержимое, message, sha, branch)
4. Заголовок: `Authorization: Bearer <TOKEN>`

### Способ В — локальный git

```bash
git clone https://github.com/remakestudiomc/kbzy.git
# вносишь изменения
git add . && git commit -m "описание"
git push origin master
# GitHub Pages автоматически пересоберёт сайт (1–2 минуты)
```

## 6. Как проверять изменения перед пушем

```bash
cd /путь/к/kbzy
node --check js/api.js          # проверка синтаксиса JS
python scripts/verify.py         # полная проверка структуры проекта
```

`verify.py` проверяет: наличие файлов, валидность манифеста и размеров иконок, отсутствие API-ключа в коде, соответствие id в HTML и JS.

## 7. Безопасность (критично)

- `.env` содержит `KEY=sk-or-v1-...` — **никогда не коммить его**. Он в `.gitignore`.
- Ключ пользователя в `localStorage['kbzy-settings']` → `openrouterKey`.
- В коде не должно быть строк `sk-or-v1-...` или `AIza...`.
- `diagnostic.html` не печатает ключ в результаты.

## 8. Шпаргалка для следующей нейросети

```
Репозиторий: remakestudiomc/kbzy (master).
Сайт: remakestudiomc.github.io/kbzy.
Не трогай: .env, X-Title заголовок (только ASCII).
Проверка: python scripts/verify.py.
Деплой: git push origin master → GitHub Pages автоматически.
Язык с пользователем: русский.
```

Статус: проект работает, баг с кириллицей в заголовке исправлен и задеплоен.
