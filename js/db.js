/* ============================================================
   Хранилище
   - localStorage: настройки (нормы, профиль, тема, ключ, модель)
   - IndexedDB:    записи дневника, избранное, вес
   Имена баз и версия НЕ меняются — данные пользователя остаются.
   ============================================================ */

const DB_NAME = 'kbzy-diary';
const DB_VERSION = 3;
const STORE_ENTRIES = 'entries';
const STORE_SETTINGS = 'settings';
const STORE_FAVORITES = 'favorites';
const STORE_WEIGHTS = 'weights';

const SETTINGS_KEY = 'kbzy-settings';

let dbPromise = null;

/* ---------- IndexedDB ---------- */

function openDB() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      reject(err);
      return;
    }

    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_ENTRIES)) {
        const store = db.createObjectStore(STORE_ENTRIES, { keyPath: 'id', autoIncrement: true });
        store.createIndex('date', 'date', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
        db.createObjectStore(STORE_SETTINGS, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORE_FAVORITES)) {
        db.createObjectStore(STORE_FAVORITES, { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(STORE_WEIGHTS)) {
        db.createObjectStore(STORE_WEIGHTS, { keyPath: 'id', autoIncrement: true });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('База занята другой вкладкой'));
  });

  return dbPromise;
}

/**
 * Обёртка над транзакцией. Ничего не удаляет при ошибках —
 * раньше любая ошибка приводила к deleteDatabase и потере данных.
 */
function tx(storeName, mode, fn) {
  return openDB().then((db) => {
    return new Promise((resolve, reject) => {
      let t;
      let request;
      try {
        t = db.transaction(storeName, mode);
        request = fn(t.objectStore(storeName));
      } catch (err) {
        reject(err);
        return;
      }

      let result;
      if (request && typeof request.addEventListener === 'function') {
        request.addEventListener('success', () => { result = request.result; });
      }

      t.addEventListener('complete', () => resolve(result));
      t.addEventListener('error', () => reject(t.error));
      t.addEventListener('abort', () => reject(t.error));
    });
  });
}

/* ---------- Записи дневника ---------- */

async function DBAddEntry(entry) {
  return tx(STORE_ENTRIES, 'readwrite', (store) => store.add(entry));
}

async function DBUpdateEntry(entry) {
  return tx(STORE_ENTRIES, 'readwrite', (store) => store.put(entry));
}

async function DBDeleteEntry(id) {
  return tx(STORE_ENTRIES, 'readwrite', (store) => store.delete(id));
}

async function DBGetAllEntries() {
  return (await tx(STORE_ENTRIES, 'readonly', (store) => store.getAll())) || [];
}

async function DBGetEntriesByDate(dateStr) {
  const all = await DBGetAllEntries();
  return all
    .filter((e) => e.date === dateStr)
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

/** Записи за диапазон дат включительно: 'YYYY-MM-DD' */
async function DBGetEntriesRange(fromDate, toDate) {
  const all = await DBGetAllEntries();
  return all.filter((e) => e.date >= fromDate && e.date <= toDate);
}

async function DBClearEntries() {
  return tx(STORE_ENTRIES, 'readwrite', (store) => store.clear());
}

/* ---------- Избранное ---------- */

async function DBAddFavorite(fav) {
  return tx(STORE_FAVORITES, 'readwrite', (store) => store.add(fav));
}

async function DBUpdateFavorite(fav) {
  return tx(STORE_FAVORITES, 'readwrite', (store) => store.put(fav));
}

async function DBGetFavorites() {
  return (await tx(STORE_FAVORITES, 'readonly', (store) => store.getAll())) || [];
}

async function DBDeleteFavorite(id) {
  return tx(STORE_FAVORITES, 'readwrite', (store) => store.delete(id));
}

/* ---------- Вес ---------- */

async function DBAddWeight(weight) {
  return tx(STORE_WEIGHTS, 'readwrite', (store) => store.add(weight));
}

async function DBGetWeights() {
  return (await tx(STORE_WEIGHTS, 'readonly', (store) => store.getAll())) || [];
}

async function DBDeleteWeight(id) {
  return tx(STORE_WEIGHTS, 'readwrite', (store) => store.delete(id));
}

/* ---------- Настройки ---------- */

const DEFAULT_SETTINGS = {
  kcal: 2400,
  protein: 160,
  fats: 75,
  carbs: 280,
  openrouterKey: '',
  model: 'google/gemini-2.5-flash',
  theme: 'system', // system | light | dark
};

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) || {};
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch (e) {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(settings) {
  // В приватном режиме Safari и при переполнении setItem бросает исключение —
  // настройки просто не сохранятся, но приложение не должно падать
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (e) {
    console.warn('Не удалось сохранить настройки:', e);
  }
}

async function clearAllData() {
  localStorage.removeItem(SETTINGS_KEY);
  await Promise.all([
    DBClearEntries(),
    tx(STORE_FAVORITES, 'readwrite', (store) => store.clear()),
    tx(STORE_WEIGHTS, 'readwrite', (store) => store.clear()),
  ]);
}

/* ---------- Резервная копия ---------- */

async function DBExportAll() {
  const [entries, favorites, weights] = await Promise.all([
    DBGetAllEntries(),
    DBGetFavorites(),
    DBGetWeights(),
  ]);
  return {
    app: 'kbzy',
    version: DB_VERSION,
    exportedAt: new Date().toISOString(),
    settings: loadSettings(),
    entries,
    favorites,
    weights,
  };
}

async function DBImportAll(data) {
  if (!data || typeof data !== 'object') throw new Error('Файл не похож на резервную копию');

  const entries = Array.isArray(data.entries) ? data.entries : [];
  const favorites = Array.isArray(data.favorites) ? data.favorites : [];
  const weights = Array.isArray(data.weights) ? data.weights : [];

  await clearAllData();

  for (const e of entries) {
    const copy = { ...e };
    delete copy.id;
    await DBAddEntry(copy);
  }
  for (const f of favorites) {
    const copy = { ...f };
    delete copy.id;
    await DBAddFavorite(copy);
  }
  for (const w of weights) {
    const copy = { ...w };
    delete copy.id;
    await DBAddWeight(copy);
  }

  if (data.settings && typeof data.settings === 'object') {
    saveSettings({ ...DEFAULT_SETTINGS, ...data.settings });
  }

  return { entries: entries.length, favorites: favorites.length, weights: weights.length };
}

/* ---------- Даты и числа ---------- */

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function todayStr() {
  return formatDate(new Date());
}

const RU_MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const RU_MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const RU_DAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const RU_DAYS_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

function parseDate(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatDateRu(dateStr) {
  const date = parseDate(dateStr);
  return `${date.getDate()} ${RU_MONTHS[date.getMonth()]}, ${RU_DAYS[date.getDay()]}`;
}

function formatDateShort(dateStr) {
  const date = parseDate(dateStr);
  return `${date.getDate()} ${RU_MONTHS_SHORT[date.getMonth()]}`;
}

function addDays(dateStr, delta) {
  const date = parseDate(dateStr);
  date.setDate(date.getDate() + delta);
  return formatDate(date);
}

function daysBetween(fromStr, toStr) {
  const a = parseDate(fromStr).getTime();
  const b = parseDate(toStr).getTime();
  return Math.round((b - a) / 86400000);
}

function formatTime(ts) {
  const d = new Date(ts);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
