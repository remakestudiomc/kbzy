/* ============================================================
   КБЖУ Дневник 2.0 — логика
   ============================================================ */

const $ = (id) => document.getElementById(id);
const num = (v) => {
  const n = parseFloat(String(v == null ? '' : v).replace(',', '.'));
  return isNaN(n) ? 0 : n;
};
const r1 = (n) => Math.round(n * 10) / 10;
// num() внутри — иначе старая запись без поля даёт «NaN» в интерфейсе
const fmtInt = (n) => String(Math.round(num(n))).replace(/\B(?=(\d{3})+(?!\d))/g, '\u2009');
const fmt1 = (n) => {
  const v = r1(num(n));
  return Number.isInteger(v) ? String(v) : v.toFixed(1).replace('.', ',');
};

/* ---------- Состояние ---------- */

const state = {
  settings: loadSettings(),
  currentDate: todayStr(),
  allEntries: [],
  entries: [],
  favorites: [],
  weights: [],
  statsRange: 7,
  editingId: null,
  draft: null,
  per100: null,
  lastKcal: 0,
  syncing: false,
  analyzing: false,
  favToggle: false,
  quick: [],
};

let toastTimer = null;
let loadingTimer = null;

/* ---------- DOM ---------- */

const els = {
  screens: document.querySelectorAll('.screen'),
  tabs: document.querySelectorAll('.tab'),

  dateTitle: $('date-title'),
  dateSub: $('date-sub'),
  datePicker: $('date-picker'),
  btnNextDay: $('btn-next-day'),

  kcalNow: $('kcal-now'),
  kcalGoal: $('kcal-goal'),
  kcalBar: $('kcal-bar'),
  kcalRemain: $('kcal-remain'),
  kcalPct: $('kcal-pct'),
  proteinNow: $('protein-now'),
  proteinGoal: $('protein-goal'),
  proteinBar: $('protein-bar'),
  fatsNow: $('fats-now'),
  fatsGoal: $('fats-goal'),
  fatsBar: $('fats-bar'),
  carbsNow: $('carbs-now'),
  carbsGoal: $('carbs-goal'),
  carbsBar: $('carbs-bar'),

  quickList: $('quick-list'),
  entriesList: $('entries-list'),
  entriesCount: $('entries-count'),

  overlay: $('overlay-add'),
  paneCapture: $('pane-capture'),
  paneLoading: $('pane-loading'),
  paneResult: $('pane-result'),
  captureTitle: $('capture-title'),
  photoArea: $('photo-area'),
  photoPreview: $('photo-preview'),
  photoEmpty: $('photo-empty'),
  btnRetake: $('btn-retake-photo'),
  fileInput: $('file-input'),
  cameraInput: $('camera-input'),
  addDescription: $('add-description'),
  descCount: $('desc-count'),
  btnAnalyze: $('btn-analyze'),
  loadingHint: $('loading-hint'),

  resultTitle: $('result-title'),
  resultPhoto: $('result-photo'),
  resultConfidence: $('result-confidence'),
  resultDateNote: $('result-date-note'),
  resName: $('res-name'),
  resWeight: $('res-weight'),
  resKcal: $('res-kcal'),
  resProtein: $('res-protein'),
  resFats: $('res-fats'),
  resCarbs: $('res-carbs'),
  resComponents: $('res-components'),
  resRefine: $('res-refine'),
  resDesc: $('res-desc'),
  btnFavToggle: $('btn-fav-toggle'),
  saveResultLabel: $('save-result-label'),

  sheetBackdrop: $('sheet-backdrop'),
  sheetBody: $('sheet-body'),

  toast: $('toast'),
  toastText: $('toast-text'),
  toastAction: $('toast-action'),

  // настройки
  setCal: $('set-cal'),
  setProtein: $('set-protein'),
  setFats: $('set-fats'),
  setCarbs: $('set-carbs'),
  setApiKey: $('set-api-key'),
  setModel: $('set-model'),
  modelCustomField: $('model-custom-field'),
  setModelCustom: $('set-model-custom'),
  weightInput: $('weight-input'),
  weightList: $('weight-list'),
  keyStatus: $('key-status'),
  importFile: $('import-file'),
};

/* ============================================================
   Старт
   ============================================================ */

document.addEventListener('DOMContentLoaded', init);

async function init() {
  renderIcons();
  bindEvents();
  applyTheme(state.settings.theme);
  fillSettingsForm();

  await Promise.all([loadFavorites(), loadWeights()]);
  await refreshDiary();
}

async function loadFavorites() {
  try {
    state.favorites = (await DBGetFavorites()) || [];
  } catch (e) {
    state.favorites = [];
  }
}

async function loadWeights() {
  try {
    state.weights = ((await DBGetWeights()) || []).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  } catch (e) {
    state.weights = [];
  }
}

/* ============================================================
   События
   ============================================================ */

function bindEvents() {
  document.addEventListener('click', onActionClick);

  els.datePicker.addEventListener('change', () => {
    if (els.datePicker.value) {
      state.currentDate = els.datePicker.value;
      refreshDiary();
    }
  });

  els.cameraInput.addEventListener('change', (e) => handleFile(e.target.files[0], e.target));
  els.fileInput.addEventListener('change', (e) => handleFile(e.target.files[0], e.target));

  els.addDescription.addEventListener('input', () => {
    els.descCount.textContent = els.addDescription.value.length + ' / 300';
    updateAnalyzeButton();
  });

  // Авто-пересчёт нутриентов
  els.resWeight.addEventListener('input', onWeightInput);
  els.resKcal.addEventListener('input', onKcalInput);
  [els.resProtein, els.resFats, els.resCarbs].forEach((el) => el.addEventListener('input', onMacroInput));

  els.sheetBackdrop.addEventListener('click', (e) => {
    if (e.target === els.sheetBackdrop) closeSheet();
  });

  els.importFile.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) importData(file);
    e.target.value = '';
  });

  // Модель: показываем поле для своего названия, если выбрано «Другая»
  els.setModel.addEventListener('change', () => {
    els.modelCustomField.hidden = els.setModel.value !== '__custom';
    if (els.setModel.value === '__custom') els.setModelCustom.focus();
  });

  // Вес: Enter в поле = «Записать»
  els.weightInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addWeightHandler();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!els.sheetBackdrop.hidden) closeSheet();
      else if (!els.overlay.hidden) closeFlow();
      return;
    }
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    if (!els.overlay.hidden || !els.sheetBackdrop.hidden) return;
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag)) return;
    if (!$('screen-diary').classList.contains('active')) return;
    changeDay(e.key === 'ArrowLeft' ? -1 : 1);
  });

  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const onScheme = () => {
    if (state.settings.theme === 'system') applyTheme('system');
  };
  if (mq.addEventListener) mq.addEventListener('change', onScheme);
  else if (mq.addListener) mq.addListener(onScheme);

  bindSwipe();
}

/** Один обработчик на все кнопки с data-action */
function onActionClick(e) {
  const target = e.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;
  const id = target.dataset.id ? Number(target.dataset.id) : null;

  switch (action) {
    case 'nav':
      switchScreen(target.dataset.screen);
      break;

    case 'day-prev':
      changeDay(-1);
      break;
    case 'day-next':
      changeDay(1);
      break;
    case 'pick-date':
      openDatePicker();
      break;
    case 'goal':
      goToGoal();
      break;

    case 'add':
      openAddFlow();
      break;

    case 'entry':
      openEntryMenu(id);
      break;
    case 'quick':
      openQuickAdd(Number(target.dataset.idx));
      break;

    case 'fav-manage':
      openFavManage();
      break;
    case 'fav-edit':
      openFavEditor(id);
      break;
    case 'fav-save':
      saveFavoriteEdit(id);
      break;
    case 'fav-del':
      deleteFavorite(id);
      break;

    case 'entry-edit':
      closeSheet();
      openEditEntry(id);
      break;
    case 'entry-star':
      closeSheet();
      entryToFavorites(id);
      break;
    case 'entry-copy':
      closeSheet();
      copyEntryToToday(id);
      break;
    case 'entry-dup':
      closeSheet();
      duplicateEntry(id);
      break;
    case 'entry-del':
      closeSheet();
      deleteEntry(id);
      break;

    case 'quick-add':
      closeSheet();
      quickAdd();
      break;
    case 'portion':
      setPortion(Number(target.dataset.mult));
      break;

    case 'add-weight':
      addWeightHandler();
      break;
    case 'weight-del':
      deleteWeight(id);
      break;

    case 'stats-range':
      state.statsRange = Number(target.dataset.range) || 7;
      document.querySelectorAll('#stats-range .seg').forEach((b) => {
        b.classList.toggle('active', Number(b.dataset.range) === state.statsRange);
      });
      renderStats();
      break;

    case 'theme':
      setTheme(target.dataset.val);
      break;
    case 'save-settings':
      saveSettingsHandler();
      break;
    case 'toggle-key':
      toggleKeyVisibility();
      break;
    case 'check-key':
      checkKey();
      break;
    case 'export':
      exportData();
      break;
    case 'import':
      els.importFile.click();
      break;
    case 'clear-data':
      clearDataHandler();
      break;

    case 'take-photo':
      els.cameraInput.click();
      break;
    case 'choose-photo':
      els.fileInput.click();
      break;
    case 'retake':
      els.cameraInput.value = '';
      els.fileInput.value = '';
      els.cameraInput.click();
      break;
    case 'close-flow':
      closeFlow();
      break;
    case 'analyze':
      analyze();
      break;
    case 'refine':
      refine();
      break;
    case 'save-result':
      saveResult();
      break;
    case 'result-favorite':
      if (!els.sheetBackdrop.hidden) closeSheet();
      toggleResultFavorite();
      break;
    case 'result-menu':
      openResultMenu();
      break;
    case 'reset-result':
      closeSheet();
      startOver();
      break;

    case 'sheet-close':
      closeSheet();
      break;

    default:
      break;
  }
}

/* ============================================================
   Тема
   ============================================================ */

function applyTheme(mode) {
  const dark = mode === 'dark' ||
    (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#0a0b0d' : '#f5f6f8');
}

function setTheme(mode) {
  state.settings.theme = mode;
  saveSettings(state.settings);
  applyTheme(mode);
  document.querySelectorAll('#seg-theme .seg').forEach((b) => {
    b.classList.toggle('active', b.dataset.val === mode);
  });
}

/* ============================================================
   Навигация
   ============================================================ */

function switchScreen(screenId) {
  if (!screenId) return;
  els.screens.forEach((s) => s.classList.toggle('active', s.id === screenId));
  els.tabs.forEach((t) => t.classList.toggle('active', t.dataset.screen === screenId));

  if (screenId === 'screen-diary') refreshDiary();
  if (screenId === 'screen-stats') renderStats();
  if (screenId === 'screen-settings') fillSettingsForm();

  window.scrollTo({ top: 0, behavior: 'auto' });
}

function changeDay(delta) {
  const next = addDays(state.currentDate, delta);
  if (next > todayStr()) {
    showToast('Записи в будущем не ведутся');
    return;
  }
  state.currentDate = next;
  refreshDiary();
}

function openDatePicker() {
  const picker = els.datePicker;
  if (typeof picker.showPicker === 'function') {
    try {
      picker.showPicker();
      return;
    } catch (e) { /* fallback ниже */ }
  }
  picker.focus();
  picker.click();
}

function goToGoal() {
  switchScreen('screen-settings');
  setTimeout(() => {
    els.setCal.focus();
    els.setCal.select();
    els.setCal.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, 140);
}

function bindSwipe() {
  const screen = $('screen-diary');
  let startX = 0;
  let startY = 0;
  let tracking = false;

  screen.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) { tracking = false; return; }
    if (e.target.closest('.chips, input, textarea, select')) { tracking = false; return; }
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    tracking = true;
  }, { passive: true });

  screen.addEventListener('touchcancel', () => { tracking = false; }, { passive: true });

  screen.addEventListener('touchend', (e) => {
    if (!tracking) return;
    tracking = false;
    const t = e.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.6) return;
    changeDay(dx < 0 ? 1 : -1);
  }, { passive: true });
}

/* ============================================================
   Дневник
   ============================================================ */

async function refreshDiary() {
  const dateStr = state.currentDate;
  const isToday = dateStr === todayStr();

  els.dateTitle.textContent = isToday ? 'Сегодня' : formatDateShort(dateStr);
  els.dateSub.textContent = formatDateRu(dateStr).replace(/^\d+\s\w+,\s/, '');
  els.datePicker.value = dateStr;
  els.btnNextDay.disabled = dateStr >= todayStr();

  try {
    state.allEntries = await DBGetAllEntries();
  } catch (e) {
    state.allEntries = [];
    showToast('Не удалось прочитать записи');
  }

  state.entries = state.allEntries
    .filter((e) => e.date === dateStr)
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

  renderHero(state.entries);
  renderQuick();
  renderEntries(state.entries);
}

function sumEntries(entries) {
  return entries.reduce((acc, e) => {
    acc.kcal += num(e.kcal);
    acc.protein += num(e.protein);
    acc.fats += num(e.fats);
    acc.carbs += num(e.carbs);
    return acc;
  }, { kcal: 0, protein: 0, fats: 0, carbs: 0 });
}

function renderHero(entries) {
  const s = state.settings;
  const t = sumEntries(entries);

  els.kcalNow.textContent = fmtInt(t.kcal);
  els.kcalGoal.textContent = fmtInt(s.kcal);
  els.proteinNow.textContent = fmtInt(t.protein);
  els.proteinGoal.textContent = fmtInt(s.protein);
  els.fatsNow.textContent = fmtInt(t.fats);
  els.fatsGoal.textContent = fmtInt(s.fats);
  els.carbsNow.textContent = fmtInt(t.carbs);
  els.carbsGoal.textContent = fmtInt(s.carbs);

  setProgress(els.kcalBar, t.kcal, s.kcal);
  setProgress(els.proteinBar, t.protein, s.protein);
  setProgress(els.fatsBar, t.fats, s.fats);
  setProgress(els.carbsBar, t.carbs, s.carbs);

  const remain = s.kcal - t.kcal;
  els.kcalRemain.textContent = remain >= 0
    ? 'осталось ' + fmtInt(remain) + ' ккал'
    : 'перебор ' + fmtInt(Math.abs(remain)) + ' ккал';
  els.kcalRemain.classList.toggle('over', remain < 0);

  els.kcalPct.textContent = s.kcal > 0 ? Math.round((t.kcal / s.kcal) * 100) + '%' : '—';
}

function setProgress(el, value, goal) {
  if (!el) return;
  const pct = goal > 0 ? (value / goal) * 100 : 0;
  el.style.width = Math.min(pct, 100).toFixed(1) + '%';
  el.classList.toggle('over', goal > 0 && value > goal);
}

/* ---------- Быстрое добавление ---------- */

function renderQuick() {
  const favs = state.favorites.slice(0, 10);
  const favNames = new Set(favs.map((f) => String(f.name).toLowerCase()));

  const seen = new Set();
  const recent = [];
  const sorted = state.allEntries.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  for (const e of sorted) {
    const key = String(e.name || '').toLowerCase().trim();
    if (!key || seen.has(key) || favNames.has(key)) continue;
    seen.add(key);
    recent.push(e);
    if (recent.length >= 6) break;
  }

  state.quick = [
    ...favs.map((f) => ({ kind: 'fav', id: f.id, name: f.name, weight: f.weight, kcal: f.kcal, protein: f.protein, fats: f.fats, carbs: f.carbs, description: f.description })),
    ...recent.map((e) => ({ kind: 'recent', id: e.id, name: e.name, weight: e.weight, kcal: e.kcal, protein: e.protein, fats: e.fats, carbs: e.carbs, description: e.description })),
  ];

  const section = $('quick-section');

  if (!state.quick.length) {
    // Нечего показывать — не занимаем пол-экрана пустым блоком
    if (section) section.hidden = true;
    els.quickList.innerHTML = '';
    return;
  }
  if (section) section.hidden = false;

  els.quickList.innerHTML = state.quick.map((item, i) => `
    <button class="chip" data-action="quick" data-idx="${i}">
      <span class="chip-name">
        ${item.kind === 'fav' ? icon('star', 13, true) : icon('clock', 13)}
        <span>${escapeHtml(item.name)}</span>
      </span>
      <span class="chip-sub">${fmtInt(item.kcal)} ккал${item.weight ? ' · ' + Math.round(item.weight) + ' г' : ''}</span>
    </button>
  `).join('');
}

/* ---------- Список еды за день ---------- */

function renderEntries(entries) {
  const count = els.entriesCount;
  if (count) {
    count.textContent = entries.length
      ? entries.length + ' ' + plural(entries.length, 'запись', 'записи', 'записей')
      : '';
  }

  if (!entries.length) {
    els.entriesList.innerHTML = `
      <div class="empty">
        ${icon('bowl', 30)}
        <p>На этот день записей нет.<br>Добавьте еду или возьмите блюдо из быстрого добавления.</p>
      </div>`;
    return;
  }

  els.entriesList.innerHTML = entries.map(entryHtml).join('');
}

function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function entryHtml(e) {
  const hasPhoto = typeof e.image === 'string' && e.image.length > 40;
  const thumb = hasPhoto
    ? `<img src="${e.image}" alt="">`
    : icon('bowl', 20);

  const macros = [
    'Б ' + fmt1(e.protein),
    'Ж ' + fmt1(e.fats),
    'У ' + fmt1(e.carbs),
  ].join(' · ');
  const meta = (e.weight ? Math.round(e.weight) + ' г · ' : '') + macros;

  return `
    <button class="entry" data-action="entry" data-id="${e.id}">
      <span class="entry-thumb">${thumb}</span>
      <span class="entry-info">
        <span class="entry-name">${escapeHtml(e.name)}</span>
        <span class="entry-meta">${meta}</span>
      </span>
      <span class="entry-kcal">${fmtInt(e.kcal)}<em>ккал</em></span>
    </button>`;
}

/* ---------- Меню записи ---------- */

function openEntryMenu(id) {
  const entry = state.allEntries.find((e) => e.id === id);
  if (!entry) return;

  const isToday = entry.date === todayStr();
  const inFav = state.favorites.some((f) => String(f.name).toLowerCase() === String(entry.name).toLowerCase());

  openSheet(`
    <div class="sheet-title">${escapeHtml(entry.name)}</div>
    <div class="sheet-sub">${Math.round(entry.weight || 0)} г · ${fmtInt(entry.kcal)} ккал · Б ${fmt1(entry.protein)} · Ж ${fmt1(entry.fats)} · У ${fmt1(entry.carbs)}</div>
    <div class="sheet-actions">
      <button class="sheet-item" data-action="entry-edit" data-id="${entry.id}">${icon('pencil', 19)}<span>Изменить</span></button>
      ${inFav
        ? `<button class="sheet-item" data-action="fav-manage">${icon('star', 19, true)}<span>Уже в избранном</span></button>`
        : `<button class="sheet-item" data-action="entry-star" data-id="${entry.id}">${icon('star', 19)}<span>В избранное</span></button>`}
      ${isToday
        ? `<button class="sheet-item" data-action="entry-dup" data-id="${entry.id}">${icon('copy', 19)}<span>Дублировать</span></button>`
        : `<button class="sheet-item" data-action="entry-copy" data-id="${entry.id}">${icon('copy', 19)}<span>Скопировать на сегодня</span></button>`}
      <button class="sheet-item danger" data-action="entry-del" data-id="${entry.id}">${icon('trash', 19)}<span>Удалить</span></button>
    </div>
  `);
}

function entryToFavorites(id) {
  const entry = state.allEntries.find((e) => e.id === id);
  if (!entry) return;
  addToFavorites({
    name: entry.name,
    description: entry.description || '',
    weight: entry.weight || 0,
    kcal: entry.kcal || 0,
    protein: entry.protein || 0,
    fats: entry.fats || 0,
    carbs: entry.carbs || 0,
  });
}

async function addToFavorites(item, silent) {
  const exists = state.favorites.some(
    (f) => String(f.name).toLowerCase() === String(item.name).toLowerCase()
  );
  if (exists) {
    if (!silent) showToast('Такое блюдо уже в избранном');
    return;
  }
  try {
    await DBAddFavorite({ ...item, createdAt: Date.now() });
    await loadFavorites();
    renderQuick();
    if (!silent) showToast('Добавлено в избранное');
  } catch (e) {
    if (!silent) showToast('Не удалось сохранить в избранное');
  }
}

async function copyEntryToToday(id) {
  const entry = state.allEntries.find((e) => e.id === id);
  if (!entry) return;
  const copy = { ...entry };
  delete copy.id;
  copy.date = todayStr();
  copy.createdAt = Date.now();
  try {
    await DBAddEntry(copy);
    state.currentDate = copy.date;
    await refreshDiary();
    showToast('Скопировано на сегодня');
  } catch (e) {
    showToast('Не удалось скопировать');
  }
}

async function duplicateEntry(id) {
  const entry = state.allEntries.find((e) => e.id === id);
  if (!entry) return;
  const copy = { ...entry };
  delete copy.id;
  copy.createdAt = Date.now();
  try {
    await DBAddEntry(copy);
    await refreshDiary();
    showToast('Запись продублирована');
  } catch (e) {
    showToast('Не удалось продублировать');
  }
}

async function deleteEntry(id) {
  const entry = state.allEntries.find((e) => e.id === id);
  try {
    await DBDeleteEntry(id);
    await refreshDiary();
    if (!entry) {
      showToast('Запись удалена');
      return;
    }
    showToast('Запись удалена', {
      actionLabel: 'Отменить',
      duration: 6000,
      onAction: () => restoreEntry(entry),
    });
  } catch (e) {
    showToast('Не удалось удалить');
  }
}

async function restoreEntry(entry) {
  const copy = { ...entry };
  delete copy.id;
  try {
    await DBAddEntry(copy);
    state.currentDate = copy.date || state.currentDate;
    await refreshDiary();
    showToast('Запись восстановлена');
  } catch (e) {
    showToast('Не удалось восстановить');
  }
}

/* ---------- Избранное: управление ---------- */

function openFavManage() {
  if (!state.favorites.length) {
    openSheet(`
      <div class="sheet-title">Избранное</div>
      <div class="sheet-sub">Пока пусто. Откройте запись и нажмите «В избранное» — блюдо появится здесь и в быстром добавлении.</div>
      <button class="btn secondary block" data-action="sheet-close">Понятно</button>
    `);
    return;
  }

  openSheet(`
    <div class="sheet-title">Избранное</div>
    <div class="sheet-sub">Нажмите на блюдо, чтобы изменить порцию или КБЖУ</div>
    <div class="sheet-actions">
      ${state.favorites.map((f) => `
        <button class="sheet-item" data-action="fav-edit" data-id="${f.id}">
          ${icon('star', 18, true)}
          <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(f.name)}</span>
          <span style="color:var(--text-3);font-weight:600;font-size:.82rem;">${fmtInt(f.kcal)}</span>
        </button>`).join('')}
    </div>
  `);
}

function openFavEditor(id) {
  const fav = state.favorites.find((f) => f.id === id);
  if (!fav) return;

  openSheet(`
    <div class="sheet-title">Изменить блюдо</div>
    <div class="sheet-sub">Правки применятся к избранному, записи в дневнике не меняются</div>
    <label class="field"><span>Название</span>
      <input type="text" id="fav-name" maxlength="120" value="${escapeAttr(fav.name)}">
    </label>
    <div class="grid-2">
      <label class="field"><span>Вес, г</span>
        <input type="text" id="fav-weight" inputmode="decimal" value="${fav.weight || ''}">
      </label>
      <label class="field"><span>Калории</span>
        <input type="text" id="fav-kcal" inputmode="decimal" value="${fav.kcal || ''}">
      </label>
    </div>
    <div class="grid-3">
      <label class="field"><span>Белки</span><input type="text" id="fav-protein" inputmode="decimal" value="${fav.protein || ''}"></label>
      <label class="field"><span>Жиры</span><input type="text" id="fav-fats" inputmode="decimal" value="${fav.fats || ''}"></label>
      <label class="field"><span>Углеводы</span><input type="text" id="fav-carbs" inputmode="decimal" value="${fav.carbs || ''}"></label>
    </div>
    <button class="btn primary block" data-action="fav-save" data-id="${fav.id}">Сохранить</button>
    <button class="btn danger block" style="margin-top:8px" data-action="fav-del" data-id="${fav.id}">Удалить из избранного</button>
  `);
}

async function saveFavoriteEdit(id) {
  const fav = state.favorites.find((f) => f.id === id);
  if (!fav) return;
  const name = (sheetValue('#fav-name') || '').trim();
  if (!name) {
    showToast('Введите название');
    return;
  }
  const updated = {
    ...fav,
    name,
    weight: Math.round(num(sheetValue('#fav-weight'))),
    kcal: Math.round(num(sheetValue('#fav-kcal'))),
    protein: r1(num(sheetValue('#fav-protein'))),
    fats: r1(num(sheetValue('#fav-fats'))),
    carbs: r1(num(sheetValue('#fav-carbs'))),
  };
  try {
    await DBUpdateFavorite(updated);
    await loadFavorites();
    renderQuick();
    closeSheet();
    showToast('Избранное обновлено');
  } catch (e) {
    showToast('Не удалось сохранить');
  }
}

async function deleteFavorite(id) {
  try {
    await DBDeleteFavorite(id);
    await loadFavorites();
    renderQuick();
    closeSheet();
    showToast('Удалено из избранного');
  } catch (e) {
    showToast('Не удалось удалить');
  }
}

/* ---------- Быстрое добавление: лист ---------- */

let quickCtx = null;

function openQuickAdd(idx) {
  const item = state.quick[idx];
  if (!item) return;

  quickCtx = { item, mult: 1 };

  openSheet(`
    <div class="sheet-title">${escapeHtml(item.name)}</div>
    <div class="sheet-sub">${Math.round(item.weight || 0)} г · ${fmtInt(item.kcal)} ккал · Б ${fmt1(item.protein)} · Ж ${fmt1(item.fats)} · У ${fmt1(item.carbs)}</div>

    <div class="field">
      <span>Порция</span>
      <div class="chips chips-tight" id="quick-portions">
        ${[0.5, 1, 1.5, 2].map((m) => `
          <button class="meal-chip ${m === 1 ? 'active' : ''}" data-action="portion" data-mult="${m}">${m === 1 ? 'Обычная' : String(m).replace('.', ',') + '×'}</button>
        `).join('')}
      </div>
    </div>

    <div class="card" style="margin:4px 0 14px;padding:14px">
      <div class="hero-foot" style="margin:0">
        <span>Итого</span>
        <span id="quick-total" style="color:var(--text);font-weight:750">${fmtInt(item.kcal)} ккал</span>
      </div>
    </div>

    <button class="btn primary block big" data-action="quick-add">Добавить в дневник</button>
  `);
}

function setPortion(mult) {
  if (!quickCtx) return;
  quickCtx.mult = mult;
  document.querySelectorAll('#quick-portions .meal-chip').forEach((b) => {
    b.classList.toggle('active', Number(b.dataset.mult) === mult);
  });
  const total = els.sheetBody.querySelector('#quick-total');
  if (total) total.textContent = fmtInt(quickCtx.item.kcal * mult) + ' ккал';
}

async function quickAdd() {
  if (!quickCtx) return;
  const { item, mult } = quickCtx;
  const entry = {
    name: item.name,
    description: item.description || '',
    weight: Math.round(num(item.weight) * mult),
    kcal: Math.round(num(item.kcal) * mult),
    protein: r1(num(item.protein) * mult),
    fats: r1(num(item.fats) * mult),
    carbs: r1(num(item.carbs) * mult),
    image: '',
    date: state.currentDate,
    createdAt: Date.now(),
  };
  quickCtx = null;

  try {
    await DBAddEntry(entry);
    await refreshDiary();
    showToast('Добавлено в дневник');
  } catch (e) {
    showToast('Не удалось добавить');
  }
}

/* ============================================================
   Добавление / редактирование записи
   ============================================================ */

function openAddFlow() {
  state.editingId = null;
  state.draft = { image: '', description: '' };
  state.per100 = null;
  state.lastKcal = 0;
  state.favToggle = false;

  els.captureTitle.textContent = 'Новая запись';
  els.resultTitle.textContent = 'Результат';
  els.saveResultLabel.textContent = 'Сохранить в дневник';

  resetPhoto();
  els.addDescription.value = '';
  els.descCount.textContent = '0 / 300';
  updateAnalyzeButton();

  els.overlay.hidden = false;
  document.body.style.overflow = 'hidden';
  showPane('pane-capture');
}

function closeFlow() {
  els.overlay.hidden = true;
  document.body.style.overflow = '';
  stopLoadingHints();
  state.analyzing = false;
}

function showPane(id) {
  [els.paneCapture, els.paneLoading, els.paneResult].forEach((p) => {
    p.classList.toggle('active', p.id === id);
  });
}

function resetPhoto() {
  state.draft = state.draft || {};
  state.draft.image = '';
  els.photoPreview.hidden = true;
  els.photoPreview.removeAttribute('src');
  els.photoEmpty.hidden = false;
  els.btnRetake.hidden = true;
  els.photoArea.classList.remove('has-photo');
  updateAnalyzeButton();
}

function handleFile(file, input) {
  if (!file) return;
  if (!file.type || !file.type.startsWith('image/')) {
    showToast('Это не изображение');
    return;
  }
  if (input) input.value = '';

  const reader = new FileReader();
  reader.onload = (e) => {
    const dataUrl = String(e.target.result || '');
    state.draft = state.draft || {};
    state.draft.image = dataUrl;
    els.photoPreview.src = dataUrl;
    els.photoPreview.hidden = false;
    els.photoEmpty.hidden = true;
    els.btnRetake.hidden = false;
    els.photoArea.classList.add('has-photo');
    updateAnalyzeButton();
  };
  reader.onerror = () => showToast('Не удалось прочитать файл');
  reader.readAsDataURL(file);
}

function updateAnalyzeButton() {
  const hasImage = !!(state.draft && state.draft.image);
  const hasText = !!(els.addDescription.value || '').trim();
  els.btnAnalyze.disabled = !hasImage && !hasText;
}

/* ---------- Анализ ---------- */

const LOADING_HINTS = [
  'Разбираю блюдо на компоненты…',
  'Оцениваю вес порции…',
  'Сверяюсь с таблицами калорийности…',
  'Считаю белки, жиры и углеводы…',
];

function startLoadingHints() {
  let i = 0;
  els.loadingHint.textContent = LOADING_HINTS[0];
  stopLoadingHints();
  loadingTimer = setInterval(() => {
    i = (i + 1) % LOADING_HINTS.length;
    els.loadingHint.textContent = LOADING_HINTS[i];
  }, 2600);
}

function stopLoadingHints() {
  if (loadingTimer) {
    clearInterval(loadingTimer);
    loadingTimer = null;
  }
}

async function analyze() {
  if (state.analyzing) return;
  const description = (els.addDescription.value || '').trim();
  const image = (state.draft && state.draft.image) || '';

  if (!image && !description) {
    showToast('Добавьте фото или описание');
    return;
  }

  state.analyzing = true;
  state.draft = { image, description };
  showPane('pane-loading');
  startLoadingHints();

  try {
    const result = await analyzeFood({
      image,
      description,
      apiKey: state.settings.openrouterKey,
      model: state.settings.model,
    });

    state.draft.result = result;
    fillResult(result, { fresh: true });
    showPane('pane-result');
  } catch (err) {
    showPane('pane-capture');
    showToast(friendlyError(err));
  } finally {
    stopLoadingHints();
    state.analyzing = false;
  }
}

function friendlyError(err) {
  if (err && err.needKey) return 'Вставьте API-ключ в настройках';
  if (err && err.noFood) return 'На фото не видно еды — попробуйте другой кадр';
  return (err && err.message) || 'Ошибка анализа';
}

async function refine() {
  if (state.analyzing) return;
  const correction = (els.resRefine.value || '').trim();
  if (!correction) {
    showToast('Напишите, что поправить');
    return;
  }
  if (!state.draft || !state.draft.result) return;

  state.analyzing = true;
  showPane('pane-loading');
  startLoadingHints();

  try {
    const result = await analyzeFood({
      image: state.draft.image,
      description: state.draft.description,
      apiKey: state.settings.openrouterKey,
      model: state.settings.model,
      previous: state.draft.result,
      correction,
    });
    state.draft.result = result;
    fillResult(result, { fresh: true });
    els.resRefine.value = '';
    showPane('pane-result');
    showToast('Пересчитано с учётом поправки');
  } catch (err) {
    showPane('pane-result');
    showToast(friendlyError(err));
  } finally {
    stopLoadingHints();
    state.analyzing = false;
  }
}

/* ---------- Заполнение результата ---------- */

function fillResult(result, opts) {
  els.resName.value = result.name || '';
  els.resWeight.value = result.weight || '';
  els.resKcal.value = result.kcal || '';
  els.resProtein.value = r1(result.protein || 0);
  els.resFats.value = r1(result.fats || 0);
  els.resCarbs.value = r1(result.carbs || 0);

  state.lastKcal = num(result.kcal);
  recomputePer100();

  if (state.draft.image) {
    els.resultPhoto.src = state.draft.image;
    els.resultPhoto.hidden = false;
  } else {
    els.resultPhoto.removeAttribute('src');
    els.resultPhoto.hidden = true;
  }

  renderComponents(result.components || [], result.notes);
  renderConfidence(result.confidence);

  const isToday = state.currentDate === todayStr();
  els.resultDateNote.textContent = state.editingId
    ? 'Редактируем запись за ' + formatDateShort(state.currentDate)
    : (isToday ? 'Будет добавлено: сегодня' : 'Будет добавлено: ' + formatDateShort(state.currentDate));

  updateFavToggle();

  if (opts && opts.fresh) {
    els.resRefine.value = '';
    els.resDesc.value = state.draft.description || '';
  }
}

function renderComponents(list, notes) {
  if ((!list || !list.length) && !notes) {
    els.resComponents.innerHTML = '';
    return;
  }
  const total = (list || []).reduce((s, c) => s + num(c.kcal), 0);
  els.resComponents.innerHTML = `
    ${list && list.length ? `
      <div class="components-title">Из чего сложилось · ${fmtInt(total)} ккал</div>
      ${list.map((c) => `
        <div class="comp">
          <div class="comp-top">
            <span class="comp-name">${escapeHtml(c.name)}</span>
            <span class="comp-kcal">${fmtInt(c.kcal)} ккал</span>
          </div>
          <div class="comp-macros">
            <span>${Math.round(c.grams)} г</span>
            <span><i class="dot dot-protein"></i>Б ${fmt1(c.protein)}</span>
            <span><i class="dot dot-fats"></i>Ж ${fmt1(c.fats)}</span>
            <span><i class="dot dot-carbs"></i>У ${fmt1(c.carbs)}</span>
          </div>
        </div>`).join('')}` : ''}
    ${notes ? `<p class="comp-note">${escapeHtml(notes)}</p>` : ''}
  `;
}

function renderConfidence(value) {
  const c = typeof value === 'number' ? value : null;
  if (c === null) {
    els.resultConfidence.hidden = true;
    return;
  }
  els.resultConfidence.hidden = false;
  const pct = Math.round(c * 100);
  els.resultConfidence.textContent = 'Уверенность ' + pct + '%';
  els.resultConfidence.className = 'badge' + (pct >= 70 ? ' high' : pct >= 45 ? '' : ' low');
}

/* ---------- Авто-пересчёт ---------- */

function recomputePer100() {
  const w = num(els.resWeight.value);
  if (w <= 0) {
    state.per100 = null;
    return;
  }
  state.per100 = {
    kcal: (num(els.resKcal.value) / w) * 100,
    protein: (num(els.resProtein.value) / w) * 100,
    fats: (num(els.resFats.value) / w) * 100,
    carbs: (num(els.resCarbs.value) / w) * 100,
  };
}

function onWeightInput() {
  if (state.syncing) return;
  const w = num(els.resWeight.value);
  if (w <= 0 || !state.per100) return;

  state.syncing = true;
  const k = w / 100;
  els.resKcal.value = Math.round(state.per100.kcal * k);
  els.resProtein.value = r1(state.per100.protein * k);
  els.resFats.value = r1(state.per100.fats * k);
  els.resCarbs.value = r1(state.per100.carbs * k);
  state.lastKcal = num(els.resKcal.value);
  state.syncing = false;
}

function onKcalInput() {
  if (state.syncing) return;
  const kcal = num(els.resKcal.value);
  const prev = state.lastKcal;

  state.syncing = true;
  if (prev > 0 && kcal > 0 && Math.abs(kcal - prev) > 0.5) {
    const k = kcal / prev;
    els.resProtein.value = r1(num(els.resProtein.value) * k);
    els.resFats.value = r1(num(els.resFats.value) * k);
    els.resCarbs.value = r1(num(els.resCarbs.value) * k);
  }
  state.lastKcal = kcal;
  state.syncing = false;
  recomputePer100();
}

function onMacroInput() {
  if (state.syncing) return;
  const kcal = 4 * num(els.resProtein.value) + 9 * num(els.resFats.value) + 4 * num(els.resCarbs.value);
  state.syncing = true;
  els.resKcal.value = Math.round(kcal);
  state.lastKcal = Math.round(kcal);
  state.syncing = false;
  recomputePer100();
}

/* ---------- Избранное в результате ---------- */

function toggleResultFavorite() {
  state.favToggle = !state.favToggle;
  updateFavToggle();
}

function updateFavToggle() {
  const on = state.favToggle;
  els.btnFavToggle.classList.toggle('primary', on);
  els.btnFavToggle.classList.toggle('ghost', !on);
  els.btnFavToggle.innerHTML = on
    ? icon('star', 16, true) + '<span>Будет сохранено в избранное</span>'
    : icon('star', 16) + '<span>В избранное</span>';
}

/* ---------- Сохранение ---------- */

async function saveResult() {
  const name = (els.resName.value || '').trim();
  const kcal = num(els.resKcal.value);

  if (!name) {
    showToast('Введите название блюда');
    els.resName.focus();
    return;
  }
  if (kcal <= 0) {
    showToast('Укажите калорийность');
    els.resKcal.focus();
    return;
  }

  const btn = document.querySelector('[data-action="save-result"]');
  if (btn) btn.disabled = true;

  try {
    const image = state.draft && state.draft.image ? await makeThumb(state.draft.image) : '';

    const entry = {
      name,
      description: (els.resDesc.value || '').trim(),
      weight: Math.round(num(els.resWeight.value)),
      kcal: Math.round(kcal),
      protein: r1(num(els.resProtein.value)),
      fats: r1(num(els.resFats.value)),
      carbs: r1(num(els.resCarbs.value)),
      image,
      date: state.currentDate,
      createdAt: Date.now(),
    };

    if (state.editingId) {
      const old = state.allEntries.find((e) => e.id === state.editingId);
      entry.id = state.editingId;
      entry.createdAt = old ? old.createdAt : Date.now();
      entry.date = old ? old.date : state.currentDate;
      await DBUpdateEntry(entry);
      showToast('Запись обновлена');
    } else {
      await DBAddEntry(entry);
      showToast('Добавлено в дневник');
    }

    if (state.favToggle) {
      await addToFavorites({
        name: entry.name,
        description: entry.description,
        weight: entry.weight,
        kcal: entry.kcal,
        protein: entry.protein,
        fats: entry.fats,
        carbs: entry.carbs,
      }, true);
    }

    closeFlow();
    await refreshDiary();
  } catch (e) {
    showToast('Не удалось сохранить запись');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function openResultMenu() {
  openSheet(`
    <div class="sheet-title">Ещё</div>
    <div class="sheet-actions">
      <button class="sheet-item" data-action="reset-result">${icon('refresh', 19)}<span>Начать заново</span></button>
      <button class="sheet-item" data-action="result-favorite">${icon('star', 19)}<span>${state.favToggle ? 'Убрать из избранного' : 'В избранное'}</span></button>
    </div>
  `);
}

function startOver() {
  resetPhoto();
  els.addDescription.value = '';
  els.descCount.textContent = '0 / 300';
  els.resRefine.value = '';
  state.draft = { image: '', description: '' };
  updateAnalyzeButton();
  showPane('pane-capture');
}

async function openEditEntry(id) {
  const entry = state.allEntries.find((e) => e.id === id);
  if (!entry) return;

  state.editingId = id;
  state.draft = {
    image: entry.image || '',
    description: entry.description || '',
    result: {
      name: entry.name,
      weight: entry.weight,
      kcal: entry.kcal,
      protein: entry.protein,
      fats: entry.fats,
      carbs: entry.carbs,
      components: [],
      confidence: null,
    },
  };
  state.favToggle = false;

  els.captureTitle.textContent = 'Редактирование';
  els.resultTitle.textContent = 'Изменить запись';
  els.saveResultLabel.textContent = 'Сохранить изменения';

  els.overlay.hidden = false;
  document.body.style.overflow = 'hidden';
  showPane('pane-result');

  fillResult(state.draft.result, { fresh: false });
  els.resDesc.value = entry.description || '';
  els.resRefine.value = '';
  els.resultDateNote.textContent = 'Запись за ' + formatDateShort(entry.date);
  els.resultConfidence.hidden = true;
}

/* ============================================================
   Статистика
   ============================================================ */

async function renderStats() {
  const days = [];
  for (let i = state.statsRange - 1; i >= 0; i--) days.push(addDays(todayStr(), -i));

  const byDate = {};
  for (const e of state.allEntries) {
    if (!byDate[e.date]) byDate[e.date] = { kcal: 0, protein: 0, fats: 0, carbs: 0, count: 0 };
    byDate[e.date].kcal += num(e.kcal);
    byDate[e.date].protein += num(e.protein);
    byDate[e.date].fats += num(e.fats);
    byDate[e.date].carbs += num(e.carbs);
    byDate[e.date].count += 1;
  }

  const goal = state.settings.kcal || 0;
  const values = days.map((d) => (byDate[d] ? byDate[d].kcal : 0));
  // Небольшой запас сверху, чтобы линия цели не липла к краю
  const max = Math.max(goal, ...values, 1) * 1.06;

  $('chart-kcal').innerHTML = `
    <div class="chart-goal" style="bottom: calc(18px + (100% - 18px) * ${goal > 0 ? (goal / max).toFixed(3) : 0})">
      <span>${fmtInt(goal)}</span>
    </div>
    ${days.map((d, i) => {
      const v = values[i];
      const pct = Math.max(v > 0 ? 2 : 0, (v / max) * 100);
      const isToday = d === todayStr();
      const cls = v > goal && goal > 0 ? 'over' : v > 0 ? 'filled' : '';
      const showLabel = state.statsRange === 7 || i % 5 === 0 || isToday;
      const label = state.statsRange === 7
        ? RU_DAYS_SHORT[parseDate(d).getDay()]
        : (i % 5 === 0 || isToday ? String(parseDate(d).getDate()) : '');
      return `
        <div class="bar-col">
          <div class="bar-track">
            <div class="bar ${cls} ${isToday ? 'today' : ''}" style="height:${pct.toFixed(1)}%"></div>
          </div>
          ${showLabel ? `<span class="bar-label ${isToday ? 'strong' : ''}">${label}</span>` : '<span class="bar-label">&nbsp;</span>'}
        </div>`;
    }).join('')}
  `;

  const filledDays = days.filter((d) => byDate[d] && byDate[d].count > 0);
  const avg = filledDays.length
    ? filledDays.reduce((acc, d) => {
        acc.kcal += byDate[d].kcal;
        acc.protein += byDate[d].protein;
        acc.fats += byDate[d].fats;
        acc.carbs += byDate[d].carbs;
        return acc;
      }, { kcal: 0, protein: 0, fats: 0, carbs: 0 })
    : null;

  const n = filledDays.length || 1;
  $('stats-kcal-sub').textContent = filledDays.length
    ? 'среднее ' + fmtInt(avg.kcal / n) + ' ккал'
    : 'нет данных';

  $('stats-avg').innerHTML = `
    <div class="stat"><div class="stat-label">Калории</div><div class="stat-value">${avg ? fmtInt(avg.kcal / n) : '—'} <small>ккал</small></div></div>
    <div class="stat"><div class="stat-label">Белки</div><div class="stat-value">${avg ? fmt1(avg.protein / n) : '—'} <small>г</small></div></div>
    <div class="stat"><div class="stat-label">Жиры</div><div class="stat-value">${avg ? fmt1(avg.fats / n) : '—'} <small>г</small></div></div>
    <div class="stat"><div class="stat-label">Углеводы</div><div class="stat-value">${avg ? fmt1(avg.carbs / n) : '—'} <small>г</small></div></div>
  `;

  renderWeightStats();
}

function renderWeightStats() {
  const list = state.weights.slice(0, 14).reverse();
  const sub = $('stats-weight-sub');
  const box = $('stats-spark');

  if (!list.length) {
    sub.textContent = 'нет данных';
    box.innerHTML = '<p class="hint" style="margin:0">Запишите вес ниже — появится график.</p>';
    renderWeightList();
    return;
  }

  const first = num(list[0].weight);
  const last = num(list[list.length - 1].weight);
  const diff = last - first;
  sub.textContent = fmt1(last) + ' кг' + (list.length > 1 ? ' · ' + (diff > 0 ? '+' : '') + fmt1(diff) + ' кг' : '');

  if (list.length < 2) {
    box.innerHTML = '<p class="hint" style="margin:0">Добавьте ещё одну запись, чтобы увидеть динамику.</p>';
    renderWeightList();
    return;
  }

  const values = list.map((w) => num(w.weight));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const w = 300;
  const h = 60;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - 6 - ((v - min) / span) * (h - 12);
    return x.toFixed(1) + ',' + y.toFixed(1);
  }).join(' ');

  box.innerHTML = `
    <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
      <polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2.5"
        stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
    </svg>`;

  renderWeightList();
}

function renderWeightList() {
  if (!els.weightList) return;
  const list = state.weights.slice(0, 6);

  if (!list.length) {
    els.weightList.innerHTML = '<p class="weight-empty">Записей пока нет</p>';
    return;
  }

  els.weightList.innerHTML = list.map((w) => `
    <div class="weight-row">
      <span class="weight-row-date">${formatDateShort(w.date || todayStr())}</span>
      <span class="weight-row-val">${fmt1(w.weight)}<em>кг</em></span>
      <button class="weight-row-del" data-action="weight-del" data-id="${w.id}" aria-label="Удалить запись">
        ${icon('x', 14)}
      </button>
    </div>`).join('');
}

async function addWeightHandler() {
  const value = num(els.weightInput.value);
  if (!value) {
    showToast('Введите вес в килограммах');
    els.weightInput.focus();
    return;
  }
  if (value < 20 || value > 400) {
    showToast('Вес должен быть в диапазоне 20–400 кг');
    els.weightInput.focus();
    return;
  }

  try {
    await DBAddWeight({ weight: r1(value), date: todayStr(), createdAt: Date.now() });
    els.weightInput.value = '';
    await loadWeights();
    renderWeightStats();
    showToast('Вес записан');
  } catch (e) {
    showToast('Не удалось сохранить вес');
  }
}

async function deleteWeight(id) {
  try {
    await DBDeleteWeight(id);
    await loadWeights();
    renderWeightStats();
    showToast('Запись веса удалена');
  } catch (e) {
    showToast('Не удалось удалить');
  }
}

/* ============================================================
   Настройки
   ============================================================ */

function fillSettingsForm() {
  const s = state.settings;

  els.setCal.value = s.kcal || '';
  els.setProtein.value = s.protein || '';
  els.setFats.value = s.fats || '';
  els.setCarbs.value = s.carbs || '';
  els.setApiKey.value = s.openrouterKey || '';

  fillModelSelect(s.model || '');
  markSegments('#seg-theme', s.theme || 'system');
}

/** Селект моделей: известные варианты + «другая» */
function fillModelSelect(model) {
  const known = Array.from(els.setModel.options).map((o) => o.value).filter((v) => v !== '__custom');
  const isKnown = known.includes(model);
  els.setModel.value = isKnown ? model : '__custom';
  els.setModelCustom.value = isKnown ? '' : model;
  els.modelCustomField.hidden = isKnown;
}

function markSegments(selector, value) {
  document.querySelectorAll(selector + ' .seg').forEach((b) => {
    b.classList.toggle('active', b.dataset.val === value);
  });
}

/** Что реально сохранено в настройках: модель из селекта или своё название */
function readModelValue() {
  const v = els.setModel.value;
  if (v === '__custom') return (els.setModelCustom.value || '').trim() || 'google/gemini-2.5-flash';
  return v || 'google/gemini-2.5-flash';
}

function saveSettingsHandler() {
  const kcal = num(els.setCal.value);
  if (kcal <= 0) {
    showToast('Калорийность должна быть больше нуля');
    els.setCal.focus();
    return;
  }

  state.settings = {
    ...state.settings,
    kcal: Math.round(kcal),
    protein: Math.round(num(els.setProtein.value)),
    fats: Math.round(num(els.setFats.value)),
    carbs: Math.round(num(els.setCarbs.value)),
    openrouterKey: (els.setApiKey.value || '').trim(),
    model: readModelValue(),
  };

  saveSettings(state.settings);
  applyTheme(state.settings.theme);
  refreshDiary();
  showToast('Настройки сохранены');
}

function toggleKeyVisibility() {
  const input = els.setApiKey;
  const hidden = input.type === 'password';
  input.type = hidden ? 'text' : 'password';
  const btn = $('btn-toggle-key');
  if (btn) btn.innerHTML = icon(hidden ? 'eye-off' : 'eye', 18);
}

async function checkKey() {
  const key = (els.setApiKey.value || '').trim();
  if (!key) {
    els.keyStatus.textContent = 'Сначала вставьте ключ';
    return;
  }
  const btn = $('btn-check-key');
  btn.disabled = true;
  els.keyStatus.textContent = 'Проверяем…';
  try {
    const res = await checkOpenRouterKey(key);
    els.keyStatus.textContent = res.message;
  } catch (e) {
    els.keyStatus.textContent = 'Не удалось проверить';
  } finally {
    btn.disabled = false;
  }
}

/* ---------- Данные ---------- */

async function exportData() {
  try {
    const data = await DBExportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'kbzy-backup-' + todayStr() + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    showToast('Копия скачана');
  } catch (e) {
    showToast('Не удалось создать копию');
  }
}

async function importData(file) {
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data || !Array.isArray(data.entries)) throw new Error('Нет записей в файле');
    if (!confirm('Заменить текущие данные содержимым файла?')) return;

    await DBImportAll(data);
    state.settings = loadSettings();
    applyTheme(state.settings.theme);
    fillSettingsForm();
    await Promise.all([loadFavorites(), loadWeights()]);
    await refreshDiary();
    showToast('Данные загружены');
  } catch (e) {
    showToast('Не удалось прочитать файл');
  }
}

async function clearDataHandler() {
  if (!confirm('Удалить все записи, избранное, вес и настройки? Отменить это будет нельзя.')) return;
  try {
    await clearAllData();
    state.settings = loadSettings();
    state.favorites = [];
    state.weights = [];
    state.allEntries = [];
    fillSettingsForm();
    applyTheme(state.settings.theme);
    await refreshDiary();
    showToast('Все данные стёрты');
  } catch (e) {
    showToast('Не удалось стереть данные');
  }
}

/* ============================================================
   Нижний лист и тост
   ============================================================ */

function openSheet(html) {
  els.sheetBody.innerHTML = html;
  renderIcons(els.sheetBody);
  els.sheetBackdrop.hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeSheet() {
  els.sheetBackdrop.hidden = true;
  els.sheetBody.innerHTML = '';
  if (els.overlay.hidden) document.body.style.overflow = '';
}

function showToast(message, options) {
  const opts = options || {};
  els.toastText.textContent = message;

  if (opts.actionLabel && typeof opts.onAction === 'function') {
    els.toastAction.textContent = opts.actionLabel;
    els.toastAction.hidden = false;
    els.toastAction.onclick = () => {
      hideToast();
      opts.onAction();
    };
  } else {
    els.toastAction.hidden = true;
    els.toastAction.onclick = null;
  }

  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, opts.duration || (opts.actionLabel ? 6000 : 2600));
}

function hideToast() {
  clearTimeout(toastTimer);
  els.toast.classList.remove('show');
}

/* ============================================================
   Утилиты
   ============================================================ */

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/`/g, '&#96;');
}

/** Значение поля внутри нижнего листа */
function sheetValue(selector) {
  const el = els.sheetBody.querySelector(selector);
  return el ? el.value : '';
}
