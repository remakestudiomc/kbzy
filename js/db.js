/* ============================================================
   Модуль хранения данных
   - localStorage:  настройки (КБЖУ, API-ключ, модель)
   - IndexedDB:     записи дневника с фото (для больших картинок)
   ============================================================ */

const DB_NAME = 'kbzy-diary';
const DB_VERSION = 1;
const STORE_ENTRIES = 'entries';
const STORE_SETTINGS = 'settings';

const SETTINGS_KEY = 'kbzy-settings';

let dbPromise = null;

/* ---------- IndexedDB ---------- */

function openDB() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_ENTRIES)) {
        const store = db.createObjectStore(STORE_ENTRIES, { keyPath: 'id', autoIncrement: true });
        store.createIndex('date', 'date', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
        db.createObjectStore(STORE_SETTINGS, { keyPath: 'key' });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  return dbPromise;
}

function tx(storeName, mode, fn) {
  return openDB().then((db) => {
    return new Promise((resolve, reject) => {
      const t = db.transaction(storeName, mode);
      const store = t.objectStore(storeName);
      const result = fn(store);
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
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

async function DBGetEntriesByDate(dateStr) {
  const all = await tx(STORE_ENTRIES, 'readonly', (store) => store.getAll());
  return all
    .filter((e) => e.date === dateStr)
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

async function DBGetAllEntries() {
  return tx(STORE_ENTRIES, 'readonly', (store) => store.getAll());
}

async function DBClearEntries() {
  return tx(STORE_ENTRIES, 'readwrite', (store) => store.clear());
}

/* ---------- Настройки ---------- */

const DEFAULT_SETTINGS = {
  kcal: 2000,
  protein: 100,
  fats: 70,
  carbs: 250,
  apiKey: '',
  model: 'auto',
};

// Актуальные модели (синхронизировано с js/api.js)
const SUPPORTED_MODELS = [
  'auto',
  'gemini-flash-latest',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash-preview',
];

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    const merged = { ...DEFAULT_SETTINGS, ...parsed };

    // Если сохранена устаревшая модель (например gemini-2.0-flash) — заменяем на авто
    if (!SUPPORTED_MODELS.includes(merged.model)) {
      merged.model = 'auto';
    }

    // Если значение пустое — тоже авто
    if (!merged.model) {
      merged.model = 'auto';
    }

    return merged;
  } catch (e) {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function clearAllData() {
  localStorage.removeItem(SETTINGS_KEY);
  return DBClearEntries();
}

/* ---------- Утилиты ---------- */

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function todayStr() {
  return formatDate(new Date());
}

function formatDateRu(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const months = [
    'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
  ];
  const days = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
  return `${d} ${months[m - 1]}, ${days[date.getDay()]}`;
}

function addDays(dateStr, delta) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d + delta);
  return formatDate(date);
}

function formatTime(ts) {
  const d = new Date(ts);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}