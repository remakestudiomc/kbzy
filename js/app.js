/* ============================================================
   Основная логика приложения «КБЖУ Дневник»
   ============================================================ */

/* ---------- Состояние ---------- */

const state = {
  settings: loadSettings(),
  currentDate: todayStr(),
  pendingImage: null,
  pendingDescription: '',
  analyzing: false,
  favorites: [],
};

let toastTimer = null;

/* ---------- DOM-элементы ---------- */

const $ = (id) => document.getElementById(id);

const els = {
  // Экраны
  screens: document.querySelectorAll('.screen'),
  navBtns: document.querySelectorAll('.nav-btn'),

  // Бренд / шапка

  // Дневник
  dateTitle: $('date-title'),
  dateSub: $('date-sub'),
  datePicker: $('date-picker'),
  btnPrevDay: $('btn-prev-day'),
  btnNextDay: $('btn-next-day'),
  btnDate: $('btn-date'),
  kcalNow: $('kcal-now'),
  kcalGoal: $('kcal-goal'),
  kcalBar: $('kcal-bar'),
  kcalRing: $('kcal-ring'),
  kcalRemain: $('kcal-remain'),
  proteinNow: $('protein-now'),
  proteinGoal: $('protein-goal'),
  proteinBar: $('protein-bar'),
  fatsNow: $('fats-now'),
  fatsGoal: $('fats-goal'),
  fatsBar: $('fats-bar'),
  carbsNow: $('carbs-now'),
  carbsGoal: $('carbs-goal'),
  carbsBar: $('carbs-bar'),
  entriesList: $('entries-list'),

  // Избранное
  favoritesSection: $('favorites-section'),
  favoritesList: $('favorites-list'),
  favCount: $('fav-count'),

  // Настройки
  setCal: $('set-cal'),
  setProtein: $('set-protein'),
  setFats: $('set-fats'),
  setCarbs: $('set-carbs'),
  setModel: $('set-model'),
  btnSaveSettings: $('btn-save-settings'),
  btnClearData: $('btn-clear-data'),

  // Навигация
  navAdd: $('nav-add'),
  btnAddSimple: $('btn-add-simple'),

  // Оверлей добавления
  overlayAdd: $('overlay-add'),
  flowCapture: $('flow-capture'),
  flowLoading: $('flow-loading'),
  flowResult: $('flow-result'),

  btnCloseFlow: $('btn-close-flow'),
  btnCloseResult: $('btn-close-result'),
  fileInput: $('file-input'),
  cameraInput: $('camera-input'),
  photoArea: $('photo-area'),
  photoPreview: $('photo-preview'),
  photoEmpty: $('photo-empty'),
  btnRetakePhoto: $('btn-retake-photo'),
  btnTakePhoto: $('btn-take-photo'),
  btnChoosePhoto: $('btn-choose-photo'),
  addDescription: $('add-description'),
  descCount: $('desc-count'),
  btnAnalyze: $('btn-analyze'),

  // Результат
  resultPhoto: $('result-photo'),
  resultDateNote: $('result-date-note'),
  resultName: $('result-name'),
  resultWeight: $('result-weight'),
  resultCal: $('result-cal'),
  resultProtein: $('result-protein'),
  resultFats: $('result-fats'),
  resultCarbs: $('result-carbs'),
  resultDesc: $('result-desc'),
  btnSaveResult: $('btn-save-result'),
  btnSaveFavorite: $('btn-save-favorite'),
  btnBackCapture: $('btn-back-capture'),
  btnDeleteResult: $('btn-delete-result'),

  // Тост
  toast: $('toast'),
};

/* ============================================================
   Инициализация
   ============================================================ */

async function init() {
  bindEvents();
  loadSettingsIntoForm();
  applySettingsToUI();
  openDB().catch(() => {
    showToast('⚠️ Не удалось открыть базу данных');
  });
  try {
    const all = await DBGetFavorites();
    state.favorites = all || [];
  } catch (e) {
    state.favorites = [];
  }
  renderFavorites();
  await refreshDiary();
}

/* ============================================================
   Обработчики событий
   ============================================================ */

function bindEvents() {
  // Навигация — нижние и верхние кнопки
  document.querySelectorAll('[data-screen]').forEach((btn) => {
    btn.addEventListener('click', () => switchScreen(btn.dataset.screen));
  });
  els.navAdd.addEventListener('click', openAddFlow);
  els.btnAddSimple.addEventListener('click', openAddFlow);

  // Даты
  els.btnPrevDay.addEventListener('click', () => { state.currentDate = addDays(state.currentDate, -1); refreshDiary(); });
  els.btnNextDay.addEventListener('click', () => { state.currentDate = addDays(state.currentDate, 1); refreshDiary(); });
  els.btnDate.addEventListener('click', () => els.datePicker.showPicker());
  els.datePicker.addEventListener('change', () => {
    if (els.datePicker.value) {
      state.currentDate = els.datePicker.value;
      refreshDiary();
    }
  });

  // Ввод фото
  els.btnTakePhoto.addEventListener('click', () => els.cameraInput.click());
  els.btnChoosePhoto.addEventListener('click', () => els.fileInput.click());
  els.btnRetakePhoto.addEventListener('click', () => {
    resetPhoto();
    els.cameraInput.value = '';
    els.fileInput.value = '';
    els.cameraInput.click();
  });

  els.cameraInput.addEventListener('change', (e) => handleFileSelect(e.target.files[0]));
  els.fileInput.addEventListener('change', (e) => handleFileSelect(e.target.files[0]));

  // Описание и анализ
  els.addDescription.addEventListener('input', () => {
    state.pendingDescription = els.addDescription.value.trim();
    updateDescCount();
    updateAnalyzeButton();
  });
  els.btnAnalyze.addEventListener('click', analyzePhoto);

  // Результат
  els.btnSaveResult.addEventListener('click', saveResult);
  els.btnSaveFavorite.addEventListener('click', saveFavorite);
  els.btnDeleteResult.addEventListener('click', resetFlow);
  els.btnBackCapture.addEventListener('click', goBackToCapture);
  els.btnCloseFlow.addEventListener('click', closeFlow);
  els.btnCloseResult.addEventListener('click', closeFlow);

  // Закрытие оверлея по клику на фон
  els.overlayAdd.addEventListener('click', (e) => {
    if (e.target === els.overlayAdd) closeFlow();
  });

  // Закрытие по Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeFlow();
  });
  window.addEventListener('popstate', (e) => {
    if (!els.overlayAdd.classList.contains('hidden')) {
      closeFlow();
      e.preventDefault();
    }
  });

  // Настройки
  els.btnSaveSettings.addEventListener('click', saveSettingsHandler);
  els.btnClearData.addEventListener('click', clearDataHandler);
}

/* ============================================================
   Экраны
   ============================================================ */

function switchScreen(screenId) {
  els.screens.forEach((s) => s.classList.remove('active'));
  const target = document.getElementById(screenId);
  if (target) target.classList.add('active');

  els.navBtns.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.screen === screenId);
  });

  if (screenId === 'screen-diary') {
    refreshDiary();
  }
}

/* ============================================================
   Дневник
   ============================================================ */

async function refreshDiary() {
  const dateStr = state.currentDate;
  const isToday = dateStr === todayStr();

  els.dateTitle.textContent = isToday ? 'Сегодня' : formatDateRu(dateStr).split(',')[0];
  els.dateSub.textContent = formatDateRu(dateStr);
  els.datePicker.value = dateStr;

  applySettingsToUI();

  let entries = [];
  try {
    entries = await DBGetEntriesByDate(dateStr);
  } catch (e) {
    showToast('⚠️ Ошибка загрузки записей');
  }

  renderEntries(entries);
  renderTotals(entries);
}

function renderTotals(entries) {
  const s = state.settings;

  const totals = entries.reduce(
    (acc, e) => {
      acc.kcal += e.kcal || 0;
      acc.protein += e.protein || 0;
      acc.fats += e.fats || 0;
      acc.carbs += e.carbs || 0;
      return acc;
    },
    { kcal: 0, protein: 0, fats: 0, carbs: 0 }
  );

  totals.kcal = Math.round(totals.kcal * 10) / 10;
  totals.protein = Math.round(totals.protein * 10) / 10;
  totals.fats = Math.round(totals.fats * 10) / 10;
  totals.carbs = Math.round(totals.carbs * 10) / 10;

  // Плавная анимация чисел
  animateNumber(els.kcalNow, Math.round(totals.kcal));
  els.kcalGoal.textContent = s.kcal;
  animateNumber(els.proteinNow, Math.round(totals.protein));
  els.proteinGoal.textContent = s.protein;
  animateNumber(els.fatsNow, Math.round(totals.fats));
  els.fatsGoal.textContent = s.fats;
  animateNumber(els.carbsNow, Math.round(totals.carbs));
  els.carbsGoal.textContent = s.carbs;

  const remain = s.kcal - totals.kcal;
  els.kcalRemain.textContent = remain >= 0 ? `осталось ${Math.round(remain)} ккал` : `превышение на ${Math.round(Math.abs(remain))} ккал`;

  setBar(els.kcalBar, totals.kcal, s.kcal);
  setBar(els.proteinBar, totals.protein, s.protein);
  setBar(els.fatsBar, totals.fats, s.fats);
  setBar(els.carbsBar, totals.carbs, s.carbs);

  // Кольцевой прогресс калорий
  const pct = s.kcal > 0 ? Math.min(totals.kcal / s.kcal, 1) : 0;
  const CIRC = 326.7;
  els.kcalRing.style.strokeDashoffset = CIRC - CIRC * pct;
  els.kcalRing.style.stroke = pct > 1 ? '#ef4444' : '#d4a017';
}

function animateNumber(el, target) {
  if (!el) return;
  const current = parseFloat(el.textContent.replace(/\s/g, '')) || 0;
  if (current === target) return;

  const start = performance.now();
  const duration = 500;
  const from = current;

  function step(now) {
    const t = Math.min((now - start) / duration, 1);
    // easeOutCubic
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = Math.round(from + (target - from) * eased);
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function setBar(bar, value, goal) {
  const pct = goal > 0 ? (value / goal) * 100 : 0;
  bar.style.width = Math.min(pct, 100) + '%';
  bar.classList.toggle('over', pct > 100);
}

function renderEntries(entries) {
  els.entriesList.innerHTML = '';

  if (entries.length === 0) {
    els.entriesList.innerHTML = `
      <div class="empty-state">
        <span class="emoji">🍽️</span>
        <p>Пока нет записей на этот день.<br>Нажмите <b>＋ Добавить</b>, чтобы записать приём пищи</p>
      </div>`;
    return;
  }

  const frag = document.createDocumentFragment();

  entries.forEach((entry) => {
    const card = document.createElement('div');
    card.className = 'entry-card';
    card.dataset.id = entry.id;

    const time = entry.createdAt ? formatTime(entry.createdAt) : '';
    const hasPhoto = !!(entry.image && entry.image.length > 100);

    const photoHtml = hasPhoto
      ? `<img src="${entry.image}" alt="${escapeHtml(entry.name)}">`
      : `<span class="entry-emoji">🍽️</span>`;

    card.innerHTML = `
      <div class="entry-main">
        <div class="entry-photo-wrap">${photoHtml}</div>
        <div class="entry-info">
          <div class="entry-name">${escapeHtml(entry.name)}</div>
          ${entry.description ? `<div class="entry-desc">${escapeHtml(entry.description)}</div>` : ''}
        </div>
        <div class="entry-kcal">${Math.round(entry.kcal || 0)} ккал</div>
        <button class="entry-del" data-action="del" aria-label="Удалить">✕</button>
      </div>
      <div class="entry-macros">
        <span><b>${fmt(entry.protein)}</b> г белков</span>
        <span><b>${fmt(entry.fats)}</b> г жиров</span>
        <span><b>${fmt(entry.carbs)}</b> г углеводов</span>
        ${entry.weight ? `<span><b>${Math.round(entry.weight)}</b> г</span>` : ''}
      </div>
      <div class="entry-other-row">
        <button class="entry-del-btn" data-action="del">Удалить</button>
        ${time ? `<span class="entry-time">🕐 ${time}</span>` : ''}
      </div>
    `;

    card.querySelectorAll('[data-action="del"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteEntry(entry.id);
      });
    });

    frag.appendChild(card);
  });

  els.entriesList.appendChild(frag);
}

function fmt(v) {
  const n = parseFloat(v) || 0;
  return (Math.round(n * 10) / 10).toLocaleString('ru-RU');
}

function escapeHtml(str) {
  // Используем String.fromCharCode, чтобы форматтеры не ломали HTML-сущности
  const AMP = String.fromCharCode(38);   // &
  const LT = String.fromCharCode(60);    // <
  const GT = String.fromCharCode(62);    // >
  const QUOT = String.fromCharCode(34);  // "
  return String(str)
    .replace(new RegExp(AMP, 'g'), AMP + 'amp;')
    .replace(new RegExp(LT, 'g'), AMP + 'lt;')
    .replace(new RegExp(GT, 'g'), AMP + 'gt;')
    .replace(new RegExp(QUOT, 'g'), AMP + 'quot;')
    .replace(/'/g, AMP + '#039;');
}

async function deleteEntry(id) {
  if (!confirm('Удалить запись?')) return;
  try {
    await DBDeleteEntry(id);
    showToast('🗑 Запись удалена');
    refreshDiary();
  } catch (e) {
    showToast('⚠️ Не удалось удалить');
  }
}

/* ============================================================
   Избранное
   ============================================================ */

function renderFavorites() {
  const list = state.favorites;

  if (!list || list.length === 0) {
    els.favoritesSection.classList.add('hidden-section');
    return;
  }

  els.favoritesSection.classList.remove('hidden-section');
  els.favCount.textContent = `${list.length} сохранено`;
  els.favoritesList.innerHTML = '';

  const frag = document.createDocumentFragment();

  list.forEach((fav) => {
    const chip = document.createElement('button');
    chip.className = 'fav-chip';
    chip.innerHTML = `
      <span class="fav-chip-del" data-fav-del="${fav.id}" aria-label="Удалить из избранного">✕</span>
      <div class="fav-chip-name">${escapeHtml(fav.name)}</div>
      <div class="fav-chip-kcal">${Math.round(fav.kcal || 0)} ккал</div>
      <div class="fav-chip-macros">
        <span>Б ${fmt(fav.protein)}</span>
        <span>Ж ${fmt(fav.fats)}</span>
        <span>У ${fmt(fav.carbs)}</span>
      </div>
    `;

    // Клик по чипу — добавить в дневник
    chip.addEventListener('click', (e) => {
      if (e.target.closest('[data-fav-del]')) return;
      addFavoriteToDiary(fav);
    });

    // Удалить из избранного
    chip.querySelector('[data-fav-del]').addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await DBDeleteFavorite(fav.id);
        state.favorites = state.favorites.filter((f) => f.id !== fav.id);
        renderFavorites();
        showToast('Удалено из избранного');
      } catch (err) {
        showToast('⚠️ Не удалось удалить');
      }
    });

    frag.appendChild(chip);
  });

  els.favoritesList.appendChild(frag);
}

async function addFavoriteToDiary(fav) {
  const entry = {
    name: fav.name,
    description: fav.description || '',
    weight: fav.weight || 0,
    kcal: fav.kcal || 0,
    protein: fav.protein || 0,
    fats: fav.fats || 0,
    carbs: fav.carbs || 0,
    image: fav.image || '',
    date: state.currentDate,
    createdAt: Date.now(),
  };

  try {
    await DBAddEntry(entry);
    showToast('⭐ Добавлено из избранного');
    refreshDiary();
  } catch (e) {
    showToast('⚠️ Не удалось добавить');
  }
}

async function saveFavorite() {
  const name = els.resultName.value.trim();
  const kcal = parseFloat(els.resultCal.value);

  if (!name) {
    showToast('Введите название блюда');
    return;
  }
  if (isNaN(kcal) || kcal < 0) {
    showToast('Укажите калорийность');
    return;
  }

  // Проверяем, есть ли уже такое блюдо в избранном
  const exists = state.favorites.some((f) => f.name.toLowerCase() === name.toLowerCase());
  if (exists) {
    showToast('Это блюдо уже в избранном');
    return;
  }

  const weight = parseFloat(els.resultWeight.value);
  const fav = {
    name,
    description: els.resultDesc.value.trim() || '',
    weight: isNaN(weight) ? 0 : Math.round(weight),
    kcal: isNaN(kcal) ? 0 : Math.round(kcal * 10) / 10,
    protein: isNaN(parseFloat(els.resultProtein.value)) ? 0 : Math.round(parseFloat(els.resultProtein.value) * 10) / 10,
    fats: isNaN(parseFloat(els.resultFats.value)) ? 0 : Math.round(parseFloat(els.resultFats.value) * 10) / 10,
    carbs: isNaN(parseFloat(els.resultCarbs.value)) ? 0 : Math.round(parseFloat(els.resultCarbs.value) * 10) / 10,
    image: state.pendingImage || '',
    createdAt: Date.now(),
  };

  try {
    await DBAddFavorite(fav);
    const all = await DBGetFavorites();
    state.favorites = all || [];
    renderFavorites();
    showToast('⭐ Сохранено в избранное');
  } catch (e) {
    if (String(e).includes('ConstraintError')) {
      showToast('Это блюдо уже в избранном');
    } else {
      showToast('⚠️ Не удалось сохранить');
    }
  }
}

/* ============================================================
   Поток добавления
   ============================================================ */

function openAddFlow() {
  resetFlow();
  els.overlayAdd.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeFlow() {
  els.overlayAdd.classList.add('hidden');
  document.body.style.overflow = '';
  resetFlow();
}

function resetFlow() {
  state.pendingImage = null;
  state.pendingDescription = '';
  els.addDescription.value = '';
  els.cameraInput.value = '';
  els.fileInput.value = '';
  resetPhoto();
  updateDescCount();
  showFlow('flow-capture');
}

function resetPhoto() {
  els.photoPreview.classList.add('hidden');
  els.photoPreview.removeAttribute('src');
  els.photoEmpty.classList.remove('hidden');
  els.btnRetakePhoto.classList.add('hidden');
  els.photoArea.classList.remove('has-photo');
  updateAnalyzeButton();
}

function showFlow(flowId) {
  [els.flowCapture, els.flowLoading, els.flowResult].forEach((f) => f.classList.remove('visible'));
  document.getElementById(flowId).classList.add('visible');
}

function handleFileSelect(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    showToast('⚠️ Выберите изображение');
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => setPhoto(e.target.result);
  reader.onerror = () => showToast('⚠️ Не удалось прочитать файл');
  reader.readAsDataURL(file);
}

function setPhoto(dataUrl) {
  state.pendingImage = dataUrl;
  els.photoPreview.src = dataUrl;
  els.photoPreview.classList.remove('hidden');
  els.photoEmpty.classList.add('hidden');
  els.btnRetakePhoto.classList.remove('hidden');
  els.photoArea.classList.add('has-photo');
  updateAnalyzeButton();
}

function updateDescCount() {
  const len = els.addDescription.value.length;
  els.descCount.textContent = `${len} / 300`;
}

function updateAnalyzeButton() {
  const hasImage = !!state.pendingImage;
  const hasDesc = !!els.addDescription.value.trim();
  els.btnAnalyze.disabled = !hasImage && !hasDesc;
}

async function analyzePhoto() {
  if (state.analyzing) return;

  const hasImage = !!state.pendingImage;
  const hasDesc = !!els.addDescription.value.trim();
  if (!hasImage && !hasDesc) return;

  const { model } = state.settings;
  state.analyzing = true;
  showFlow('flow-loading');

  try {
    const result = await geminiAnalyzeFood(
      state.pendingImage,
      state.pendingDescription,
      model
    );

    els.resultName.value = result.name || '';
    els.resultWeight.value = result.weight || '';
    els.resultCal.value = result.kcal || '';
    els.resultProtein.value = result.protein || '';
    els.resultFats.value = result.fats || '';
    els.resultCarbs.value = result.carbs || '';
    els.resultDesc.value = state.pendingDescription || '';

    if (state.pendingImage) {
      els.resultPhoto.src = state.pendingImage;
      els.resultPhoto.classList.remove('hidden');
    } else {
      els.resultPhoto.removeAttribute('src');
      els.resultPhoto.classList.add('hidden');
    }

    const today = todayStr();
    els.resultDateNote.textContent = state.currentDate === today
      ? `Будет добавлено: сегодня, ${formatTime(Date.now())}`
      : `Будет добавлено: ${formatDateRu(state.currentDate)}`;

    showFlow('flow-result');
  } catch (err) {
    let msg = err.message || 'Ошибка анализа';

    if (err.noFood) {
      msg = 'На фото не видно еды. Попробуйте сфотографировать блюдо ещё раз.';
    } else if (err.rawStatus === 403 || err.rawStatus === 401 || /API key|permission|forbidden/i.test(msg)) {
      msg = '❌ Неверный API-ключ. Проверьте в настройках.';
    } else if (err.rawStatus === 429 || /quota|rate limit|resource exhausted/i.test(msg)) {
      msg = '⏳ Бесплатный лимит исчерпан. Попробуйте позже.';
    } else if (/network|fetch failed|failed to fetch|ERR_INTERNET/i.test(msg)) {
      msg = '🌐 Нет соединения с интернетом. Проверьте сеть.';
    }

    showToast(msg);
    goBackToCapture();
  } finally {
    state.analyzing = false;
  }
}

function goBackToCapture() {
  showFlow('flow-capture');
  updateAnalyzeButton();
}

async function saveResult() {
  const name = els.resultName.value.trim();
  const weight = parseFloat(els.resultWeight.value);
  const kcal = parseFloat(els.resultCal.value);
  const protein = parseFloat(els.resultProtein.value);
  const fats = parseFloat(els.resultFats.value);
  const carbs = parseFloat(els.resultCarbs.value);
  const description = els.resultDesc.value.trim();

  if (!name) { showToast('Введите название блюда'); return; }
  if (isNaN(kcal) || kcal < 0) { showToast('Укажите калорийность'); return; }

  const entry = {
    name,
    description: description || '',
    weight: isNaN(weight) ? 0 : Math.round(weight),
    kcal: isNaN(kcal) ? 0 : Math.round(kcal * 10) / 10,
    protein: isNaN(protein) ? 0 : Math.round(protein * 10) / 10,
    fats: isNaN(fats) ? 0 : Math.round(fats * 10) / 10,
    carbs: isNaN(carbs) ? 0 : Math.round(carbs * 10) / 10,
    image: state.pendingImage || '',
    date: state.currentDate,
    createdAt: Date.now(),
  };

  try {
    await DBAddEntry(entry);
    showToast('✓ Добавлено в дневник');
    closeFlow();
    refreshDiary();
  } catch (e) {
    showToast('⚠️ Не удалось сохранить запись');
  }
}

/* ============================================================
   Настройки
   ============================================================ */

function loadSettingsIntoForm() {
  const s = state.settings;
  els.setCal.value = s.kcal;
  els.setProtein.value = s.protein;
  els.setFats.value = s.fats;
  els.setCarbs.value = s.carbs;
  els.setModel.value = s.model;
}

function applySettingsToUI() {
  const s = state.settings;
  els.kcalGoal.textContent = s.kcal;
  els.proteinGoal.textContent = s.protein;
  els.fatsGoal.textContent = s.fats;
  els.carbsGoal.textContent = s.carbs;
}

function saveSettingsHandler() {
  const kcal = parseInt(els.setCal.value, 10);
  const protein = parseInt(els.setProtein.value, 10);
  const fats = parseInt(els.setFats.value, 10);
  const carbs = parseInt(els.setCarbs.value, 10);

  if (isNaN(kcal) || kcal <= 0) {
    showToast('Укажите калорийность больше 0');
    els.setCal.focus();
    return;
  }

  state.settings = {
    ...state.settings,
    kcal: kcal || 0,
    protein: protein || 0,
    fats: fats || 0,
    carbs: carbs || 0,
    model: els.setModel.value,
  };

  saveSettings(state.settings);
  applySettingsToUI();
  refreshDiary();
  showToast('✓ Настройки сохранены');
}

async function clearDataHandler() {
  if (!confirm('Удалить ВСЕ записи, избранное и настройки? Это действие нельзя отменить.')) return;
  try {
    await clearAllData();
    state.settings = { ...DEFAULT_SETTINGS };
    state.favorites = [];
    loadSettingsIntoForm();
    applySettingsToUI();
    renderFavorites();
    showToast('Все данные стёрты');
    refreshDiary();
  } catch (e) {
    showToast('⚠️ Не удалось стереть данные');
  }
}

/* ============================================================
   Тост
   ============================================================ */

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2800);
}

/* ============================================================
   Запуск
   ============================================================ */

document.addEventListener('DOMContentLoaded', init);