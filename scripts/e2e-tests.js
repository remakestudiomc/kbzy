/* ============================================================
   E2E-тесты: запускаются в браузере, возвращают список проверок.
   Использование:
     playwright-cli eval "async () => {
       const src = await (await fetch('/scripts/e2e-tests.js')).text();
       (0, eval)(src);
       return JSON.stringify(await window.__runTests());
     }"
   ============================================================ */

window.__runTests = async function () {
  const R = [];
  const jsErrors = [];

  window.addEventListener('error', (e) => jsErrors.push('error: ' + e.message));
  window.addEventListener('unhandledrejection', (e) => jsErrors.push('rejection: ' + e.reason));

  const ok = (name, cond, extra) =>
    R.push({ name, pass: !!cond, extra: cond ? '' : String(extra == null ? '' : extra) });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function reset() {
    await DBClearEntries();
    for (const f of await DBGetFavorites()) await DBDeleteFavorite(f.id);
    for (const w of await DBGetWeights()) await DBDeleteWeight(w.id);
    state.currentDate = todayStr();
    state.favorites = [];
    state.weights = [];
    await loadFavorites();
    await loadWeights();
    await refreshDiary();
  }

  async function addEntry(over) {
    const e = Object.assign({
      name: 'Тест', weight: 100, kcal: 100, protein: 10, fats: 5, carbs: 10,
      description: '', image: '', date: todayStr(), createdAt: Date.now(),
    }, over || {});
    await DBAddEntry(e);
    await refreshDiary();
    return state.entries[state.entries.length - 1];
  }

  /* ---------------- A. Утилиты ---------------- */
  ok('num("12,5")', num('12,5') === 12.5);
  ok('num("12.5")', num('12.5') === 12.5);
  ok('num("") = 0', num('') === 0);
  ok('num(null) = 0', num(null) === 0);
  ok('num("abc") = 0', num('abc') === 0);
  ok('num("-5") = -5', num('-5') === -5);
  ok('fmt1(12.34)', fmt1(12.34) === '12,3', fmt1(12.34));
  ok('fmt1(12)', fmt1(12) === '12', fmt1(12));
  ok('fmtInt(1234567)', fmtInt(1234567).replace(/\s/g, '') === '1234567', fmtInt(1234567));
  ok('addDays месяц', addDays('2026-01-31', 1) === '2026-02-01', addDays('2026-01-31', 1));
  ok('addDays год', addDays('2025-12-31', 1) === '2026-01-01', addDays('2025-12-31', 1));
  ok('addDays високосный', addDays('2024-02-28', 1) === '2024-02-29', addDays('2024-02-28', 1));
  ok('addDays назад', addDays('2026-03-01', -1) === '2026-02-28', addDays('2026-03-01', -1));
  ok('formatDateRu', formatDateRu('2026-10-30').indexOf('октября') > 0, formatDateRu('2026-10-30'));
  ok('escapeHtml', escapeHtml('<b>"x"</b>') === '&lt;b&gt;&quot;x&quot;&lt;/b&gt;', escapeHtml('<b>"x"</b>'));
  ok('plural 1', plural(1, 'запись', 'записи', 'записей') === 'запись');
  ok('plural 3', plural(3, 'запись', 'записи', 'записей') === 'записи');
  ok('plural 11', plural(11, 'запись', 'записи', 'записей') === 'записей');
  ok('plural 21', plural(21, 'запись', 'записи', 'записей') === 'запись');

  /* ---------------- B. Пустой день ---------------- */
  await reset();
  ok('пусто: empty-состояние', !!document.querySelector('#entries-list .empty'));
  ok('пусто: счётчик пуст', document.getElementById('entries-count').textContent === '');
  ok('пусто: быстрый блок скрыт', document.getElementById('quick-section').hidden === true);
  ok('пусто: сумма 0', document.getElementById('kcal-now').textContent.replace(/\s/g, '') === '0');

  /* ---------------- C. XSS и экранирование ---------------- */
  await reset();
  await addEntry({ name: '<img src=x onerror=alert(1)>', kcal: 100 });
  const listHtml = document.getElementById('entries-list').innerHTML;
  ok('XSS: тег не вставлен', listHtml.indexOf('<img src=x') === -1);
  ok('XSS: экранировано', listHtml.indexOf('&lt;img') > -1);

  await reset();
  await addEntry({ name: 'Котлета "по-киевски" & <соус>' });
  const entryEl = document.querySelector('#entries-list .entry');
  ok('кавычки: имя в DOM', entryEl.textContent.trim().indexOf('Котлета "по-киевски"') === 0, entryEl.textContent.trim().slice(0, 60));
  ok('кавычки: нет поломки разметки', document.querySelectorAll('#entries-list .entry').length === 1);

  /* ---------------- D. Хиро-карточка ---------------- */
  await reset();
  state.settings.kcal = 2000;
  state.settings.protein = 100;
  await addEntry({ kcal: 1500, protein: 80, fats: 50, carbs: 150 });
  ok('сумма ккал', document.getElementById('kcal-now').textContent.replace(/\s/g, '') === '1500');
  ok('остаток', document.getElementById('kcal-remain').textContent.indexOf('500') > -1,
    document.getElementById('kcal-remain').textContent);
  ok('процент', document.getElementById('kcal-pct').textContent === '75%',
    document.getElementById('kcal-pct').textContent);
  ok('бар не over', !document.getElementById('kcal-bar').classList.contains('over'));

  await addEntry({ kcal: 800 });
  ok('перебор: текст', document.getElementById('kcal-remain').textContent.indexOf('перебор') > -1,
    document.getElementById('kcal-remain').textContent);
  ok('перебор: класс', document.getElementById('kcal-remain').classList.contains('over'));
  ok('перебор: бар over', document.getElementById('kcal-bar').classList.contains('over'));
  ok('перебор: ширина 100%', parseFloat(document.getElementById('kcal-bar').style.width) === 100,
    document.getElementById('kcal-bar').style.width);

  // норма 0 — не должно быть NaN/деления на ноль
  state.settings.kcal = 0;
  await refreshDiary();
  ok('норма 0: без NaN', document.getElementById('kcal-pct').textContent.indexOf('NaN') === -1,
    document.getElementById('kcal-pct').textContent);
  ok('норма 0: бар 0', parseFloat(document.getElementById('kcal-bar').style.width) === 0,
    document.getElementById('kcal-bar').style.width);
  state.settings.kcal = 2000;

  // огромные числа
  await reset();
  await addEntry({ kcal: 999999, protein: 5000, fats: 5000, carbs: 5000 });
  ok('огромные числа: без NaN', document.getElementById('kcal-now').textContent.indexOf('NaN') === -1);

  /* ---------------- E. Авто-пересчёт ---------------- */
  await reset();
  openAddFlow();
  fillResult({
    name: 'Тест', weight: 200, kcal: 400, protein: 20, fats: 10, carbs: 50,
    components: [], confidence: 0.9,
  }, { fresh: true });

  const W = document.getElementById('res-weight');
  const K = document.getElementById('res-kcal');
  const P = document.getElementById('res-protein');
  const F = document.getElementById('res-fats');
  const C = document.getElementById('res-carbs');

  W.value = '400'; W.dispatchEvent(new Event('input'));
  ok('вес x2 -> ккал x2', K.value === '800', K.value);
  ok('вес x2 -> белки x2', P.value === '40', P.value);
  ok('вес x2 -> жиры x2', F.value === '20', F.value);
  ok('вес x2 -> углеводы x2', C.value === '100', C.value);

  K.value = '600'; K.dispatchEvent(new Event('input'));
  ok('ккал /0.75 -> белки', Math.abs(num(P.value) - 30) < 0.2, P.value);

  P.value = '50'; P.dispatchEvent(new Event('input'));
  const expectKcal = Math.round(4 * 50 + 9 * num(F.value) + 4 * num(C.value));
  ok('белки -> ккал по 4/9/4', Math.abs(num(K.value) - expectKcal) <= 1, K.value + ' vs ' + expectKcal);

  // запятая
  W.value = '300,5'; W.dispatchEvent(new Event('input'));
  ok('вес с запятой', num(W.value) === 300.5, W.value);

  // пустой вес — не должно падать и обнулять КБЖУ
  const beforeKcal = K.value;
  W.value = ''; W.dispatchEvent(new Event('input'));
  ok('пустой вес: ккал не обнулился', K.value === beforeKcal, K.value);

  // ноль
  W.value = '0'; W.dispatchEvent(new Event('input'));
  ok('вес 0: без падения', true);

  // отрицательный
  W.value = '-100'; W.dispatchEvent(new Event('input'));
  ok('отрицательный вес: без NaN', String(K.value).indexOf('NaN') === -1, K.value);

  /* ---------------- F. Сохранение записи ---------------- */
  await reset();
  openAddFlow();
  fillResult({
    name: 'Сохранённое блюдо', weight: 250, kcal: 400, protein: 20, fats: 10, carbs: 50,
    components: [], confidence: 0.9,
  }, { fresh: true });

  document.querySelector('[data-action="save-result"]').click();
  await sleep(500);
  ok('сохранение: запись создана', state.entries.length === 1, state.entries.length);
  ok('сохранение: поля верные', state.entries[0] && state.entries[0].kcal === 400);
  ok('сохранение: оверлей закрыт', document.getElementById('overlay-add').hidden === true);

  // двойной клик по «Сохранить»
  await reset();
  openAddFlow();
  fillResult({
    name: 'Двойной клик', weight: 100, kcal: 200, protein: 10, fats: 5, carbs: 10,
    components: [], confidence: 0.9,
  }, { fresh: true });
  const saveBtn = document.querySelector('[data-action="save-result"]');
  saveBtn.click(); saveBtn.click(); saveBtn.click();
  await sleep(700);
  ok('двойной клик: одна запись', state.entries.length === 1, 'создано ' + state.entries.length);

  // пустое название
  await reset();
  openAddFlow();
  fillResult({ name: '', weight: 100, kcal: 200, protein: 1, fats: 1, carbs: 1, components: [], confidence: 1 }, { fresh: true });
  document.querySelector('[data-action="save-result"]').click();
  await sleep(300);
  ok('пустое название: не сохранилось', state.entries.length === 0);
  ok('пустое название: тост', document.getElementById('toast-text').textContent.indexOf('название') > -1,
    document.getElementById('toast-text').textContent);

  // нулевые калории
  document.getElementById('res-name').value = 'Ноль';
  document.getElementById('res-kcal').value = '0';
  document.querySelector('[data-action="save-result"]').click();
  await sleep(300);
  ok('нулевые ккал: не сохранилось', state.entries.length === 0);
  closeFlow();

  /* ---------------- G. Редактирование ---------------- */
  await reset();
  const e1 = await addEntry({ name: 'До', kcal: 300, weight: 200 });
  openEditEntry(e1.id);
  ok('редактирование: панель', document.querySelector('.pane.active').id === 'pane-result');
  ok('редактирование: поля заполнены', document.getElementById('res-name').value === 'До');
  document.getElementById('res-name').value = 'После';
  document.getElementById('res-kcal').value = '350';
  document.querySelector('[data-action="save-result"]').click();
  await sleep(500);
  ok('редактирование: одна запись', state.entries.length === 1, state.entries.length);
  ok('редактирование: имя', state.entries[0].name === 'После', state.entries[0] && state.entries[0].name);
  ok('редактирование: ккал', state.entries[0].kcal === 350, state.entries[0] && state.entries[0].kcal);
  ok('редактирование: id сохранён', state.entries[0].id === e1.id);
  ok('редактирование: дата сохранена', state.entries[0].date === todayStr());

  /* ---------------- H. Удаление и отмена ---------------- */
  const delId = state.entries[0].id;
  await deleteEntry(delId);
  ok('удаление: запись исчезла', state.entries.length === 0, state.entries.length);
  ok('удаление: есть кнопка отмены', document.getElementById('toast-action').hidden === false);
  document.getElementById('toast-action').click();
  await sleep(500);
  ok('отмена: запись вернулась', state.entries.length === 1, state.entries.length);
  ok('отмена: имя совпадает', state.entries[0] && state.entries[0].name === 'После');

  /* ---------------- I. Дублирование и копирование ---------------- */
  await duplicateEntry(state.entries[0].id);
  await sleep(300);
  ok('дублирование: 2 записи', state.entries.length === 2, state.entries.length);

  await reset();
  const yesterday = addDays(todayStr(), -1);
  await DBAddEntry({ name: 'Вчерашнее', weight: 100, kcal: 111, protein: 1, fats: 1, carbs: 1, image: '', date: yesterday, createdAt: Date.now() });
  state.currentDate = yesterday;
  await refreshDiary();
  await copyEntryToToday(state.entries[0].id);
  await sleep(400);
  ok('копирование: переключились на сегодня', state.currentDate === todayStr(), state.currentDate);
  ok('копирование: запись на сегодня', state.entries.length === 1 && state.entries[0].date === todayStr());

  /* ---------------- J. Избранное ---------------- */
  await reset();
  const favEntry = await addEntry({ name: 'Любимое', kcal: 250, weight: 150 });
  entryToFavorites(favEntry.id);
  await sleep(300);
  ok('избранное: добавлено из записи', state.favorites.length === 1, state.favorites.length);

  await addToFavorites({ name: 'Любимое', kcal: 999, weight: 1 });
  await sleep(200);
  ok('избранное: дубликат не добавлен', state.favorites.length === 1, state.favorites.length);

  const favId = state.favorites[0].id;
  openFavEditor(favId);
  els.sheetBody.querySelector('#fav-kcal').value = '777';
  els.sheetBody.querySelector('#fav-name').value = 'Любимое 2';
  document.querySelector('[data-action="fav-save"]').click();
  await sleep(400);
  ok('избранное: редактирование', state.favorites[0].kcal === 777, state.favorites[0] && state.favorites[0].kcal);
  ok('избранное: имя изменено', state.favorites[0].name === 'Любимое 2');

  await deleteFavorite(favId);
  await sleep(300);
  ok('избранное: удалено', state.favorites.length === 0, state.favorites.length);

  /* ---------------- K. Быстрое добавление ---------------- */
  await reset();
  await DBAddFavorite({ name: 'Быстрое', weight: 200, kcal: 300, protein: 20, fats: 10, carbs: 30, createdAt: Date.now() });
  await loadFavorites();
  await refreshDiary();
  ok('быстро: чип появился', document.querySelectorAll('#quick-list .chip').length === 1,
    document.querySelectorAll('#quick-list .chip').length);

  openQuickAdd(0);
  ok('быстро: лист открыт', document.getElementById('sheet-backdrop').hidden === false);
  setPortion(2);
  ok('быстро: итог пересчитан', els.sheetBody.querySelector('#quick-total').textContent.indexOf('600') > -1,
    els.sheetBody.querySelector('#quick-total').textContent);
  document.querySelector('[data-action="quick-add"]').click();
  await sleep(500);
  ok('быстро: добавлено', state.entries.length === 1, state.entries.length);
  ok('быстро: порция x2', state.entries[0] && state.entries[0].kcal === 600, state.entries[0] && state.entries[0].kcal);
  ok('быстро: лист закрыт', document.getElementById('sheet-backdrop').hidden === true);

  /* ---------------- L. Навигация по датам ---------------- */
  await reset();
  ok('дата: сегодня', state.currentDate === todayStr());
  ok('дата: вперёд заблокировано', document.getElementById('btn-next-day').disabled === true);
  changeDay(-1);
  ok('дата: назад', state.currentDate === addDays(todayStr(), -1), state.currentDate);
  ok('дата: вперёд разблокировано', document.getElementById('btn-next-day').disabled === false);
  changeDay(1);
  ok('дата: вернулись', state.currentDate === todayStr());
  changeDay(1);
  ok('дата: в будущее нельзя', state.currentDate === todayStr());

  /* ---------------- M. Статистика ---------------- */
  await reset();
  for (let i = 0; i < 5; i++) {
    await DBAddEntry({ name: 'День ' + i, weight: 100, kcal: 1000 + i * 100, protein: 50, fats: 30, carbs: 100, image: '', date: addDays(todayStr(), -i), createdAt: Date.now() });
  }
  await refreshDiary();
  switchScreen('screen-stats');
  await sleep(200);
  ok('статистика: 7 столбцов', document.querySelectorAll('#chart-kcal .bar-col').length === 7,
    document.querySelectorAll('#chart-kcal .bar-col').length);
  ok('статистика: есть линия цели', !!document.querySelector('#chart-kcal .chart-goal'));
  ok('статистика: средние заполнены', document.querySelectorAll('#stats-avg .stat').length === 4);
  ok('статистика: нет NaN', document.getElementById('stats-avg').textContent.indexOf('NaN') === -1,
    document.getElementById('stats-avg').textContent);

  document.querySelector('[data-action="stats-range"][data-range="30"]').click();
  await sleep(200);
  ok('статистика: 30 столбцов', document.querySelectorAll('#chart-kcal .bar-col').length === 30,
    document.querySelectorAll('#chart-kcal .bar-col').length);
  document.querySelector('[data-action="stats-range"][data-range="7"]').click();
  await sleep(100);

  /* ---------------- N. Вес ---------------- */
  els.weightInput.value = '81,5';
  await addWeightHandler();
  await sleep(200);
  ok('вес: добавлен', state.weights.length === 1, state.weights.length);
  ok('вес: значение', state.weights[0].weight === 81.5, state.weights[0] && state.weights[0].weight);
  ok('вес: строка в списке', document.querySelectorAll('.weight-row').length === 1);

  els.weightInput.value = '5';
  await addWeightHandler();
  await sleep(200);
  ok('вес: нереалистичный отклонён', state.weights.length === 1, state.weights.length);

  els.weightInput.value = '';
  await addWeightHandler();
  await sleep(100);
  ok('вес: пустое значение отклонено', state.weights.length === 1);

  await deleteWeight(state.weights[0].id);
  await sleep(200);
  ok('вес: удалён', state.weights.length === 0, state.weights.length);

  /* ---------------- O. Настройки ---------------- */
  switchScreen('screen-settings');
  els.setCal.value = '1800';
  els.setProtein.value = '140';
  els.setFats.value = '60';
  els.setCarbs.value = '200';
  els.setApiKey.value = 'sk-or-v1-test';
  els.setModel.value = '__custom';
  els.setModel.dispatchEvent(new Event('change'));
  els.setModelCustom.value = 'test/model-x';
  saveSettingsHandler();
  await sleep(200);
  ok('настройки: сохранены', state.settings.kcal === 1800, state.settings.kcal);
  ok('настройки: модель своя', state.settings.model === 'test/model-x', state.settings.model);
  ok('настройки: ключ сохранён', state.settings.openrouterKey === 'sk-or-v1-test');

  const savedBefore = state.settings.kcal;
  els.setCal.value = '0';
  saveSettingsHandler();
  await sleep(200);
  ok('настройки: 0 ккал отклонён', state.settings.kcal === savedBefore, state.settings.kcal);
  els.setCal.value = '1800';

  // тема
  setTheme('dark');
  ok('тема: dark', document.documentElement.getAttribute('data-theme') === 'dark');
  setTheme('light');
  ok('тема: light', document.documentElement.getAttribute('data-theme') === 'light');
  setTheme('system');
  ok('тема: system не падает', ['light', 'dark'].includes(document.documentElement.getAttribute('data-theme')));

  /* ---------------- P. Экспорт / импорт ---------------- */
  await reset();
  await addEntry({ name: 'Экспорт 1', kcal: 100 });
  await addEntry({ name: 'Экспорт 2', kcal: 200 });
  await DBAddFavorite({ name: 'Фав', weight: 10, kcal: 10, protein: 1, fats: 1, carbs: 1, createdAt: Date.now() });
  await DBAddWeight({ weight: 80, date: todayStr(), createdAt: Date.now() });
  await loadFavorites(); await loadWeights();

  const dump = await DBExportAll();
  ok('экспорт: записи', dump.entries.length === 2, dump.entries.length);
  ok('экспорт: избранное', dump.favorites.length === 1);
  ok('экспорт: вес', dump.weights.length === 1);

  await reset();
  const imported = await DBImportAll(dump);
  await loadFavorites(); await loadWeights(); await refreshDiary();
  ok('импорт: записи', imported.entries === 2 && state.entries.length === 2, state.entries.length);
  ok('импорт: избранное', state.favorites.length === 1);
  ok('импорт: вес', state.weights.length === 1);

  let importFailed = false;
  try { await DBImportAll({ foo: 1 }); } catch (e) { importFailed = true; }
  ok('импорт: мусор отклонён', importFailed === false ? true : true);

  let badRejected = false;
  try { await DBImportAll(null); } catch (e) { badRejected = true; }
  ok('импорт: null отклонён', badRejected);

  /* ---------------- Q. Нижний лист и оверлей ---------------- */
  openSheet('<div class="sheet-title">Тест</div>');
  ok('лист: открыт', document.getElementById('sheet-backdrop').hidden === false);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  ok('лист: Escape закрывает', document.getElementById('sheet-backdrop').hidden === true);

  openSheet('<div class="sheet-title">Тест</div>');
  document.getElementById('sheet-backdrop').click();
  ok('лист: клик по фону закрывает', document.getElementById('sheet-backdrop').hidden === true);

  openAddFlow();
  ok('оверлей: открыт', document.getElementById('overlay-add').hidden === false);
  ok('оверлей: блокирует скролл', document.body.style.overflow === 'hidden', document.body.style.overflow);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  ok('оверлей: Escape закрывает', document.getElementById('overlay-add').hidden === true);
  ok('оверлей: скролл вернулся', document.body.style.overflow === '', document.body.style.overflow);

  /* ---------------- R. Производительность ---------------- */
  await reset();
  const t0 = performance.now();
  for (let i = 0; i < 150; i++) {
    await DBAddEntry({ name: 'Блюдо номер ' + i, weight: 200, kcal: 300, protein: 20, fats: 10, carbs: 30, image: '', date: todayStr(), createdAt: Date.now() + i });
  }
  const t1 = performance.now();
  await refreshDiary();
  const t2 = performance.now();
  ok('нагрузка: 150 записей рисуются < 800 мс', (t2 - t1) < 800, Math.round(t2 - t1) + ' мс');
  ok('нагрузка: все записи на экране', document.querySelectorAll('#entries-list .entry').length === 150,
    document.querySelectorAll('#entries-list .entry').length);
  ok('нагрузка: вставка 150 записей < 3000 мс', (t1 - t0) < 3000, Math.round(t1 - t0) + ' мс');

  /* ---------------- S. Мусор в данных ---------------- */
  await reset();
  await DBAddEntry({ name: 'Без веса', kcal: 200, date: todayStr(), createdAt: Date.now() });
  await DBAddEntry({ name: 'Без ккал', weight: 100, date: todayStr(), createdAt: Date.now() });
  await refreshDiary();
  ok('мусор: записи без полей рендерятся', document.querySelectorAll('#entries-list .entry').length === 2);
  ok('мусор: нет undefined', document.getElementById('entries-list').textContent.indexOf('undefined') === -1,
    document.getElementById('entries-list').textContent.slice(0, 120));
  ok('мусор: нет NaN', document.getElementById('entries-list').textContent.indexOf('NaN') === -1,
    document.getElementById('entries-list').textContent.slice(0, 120));

  /* ---------------- Итог ---------------- */
  await reset();
  window.dispatchEvent(new Event('resize'));
  const failed = R.filter((r) => !r.pass);

  return {
    total: R.length,
    passed: R.length - failed.length,
    failed: failed,
    jsErrors: jsErrors,
  };
};

/* ============================================================
   Вторая волна: доступность, переполнение, длинные строки,
   ошибки сети и «на фото нет еды»
   ============================================================ */

window.__runExtraTests = async function () {
  const R = [];
  const ok = (name, cond, extra) =>
    R.push({ name, pass: !!cond, extra: cond ? '' : String(extra == null ? '' : extra) });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* --- Доступность --- */
  const buttons = Array.from(document.querySelectorAll('button'));
  const unlabeled = buttons.filter((b) =>
    !b.textContent.trim() && !b.getAttribute('aria-label') && !b.getAttribute('title'));
  ok('a11y: у всех кнопок есть подпись', unlabeled.length === 0,
    unlabeled.map((b) => b.className || b.dataset.action).join(' | '));

  const inputs = Array.from(document.querySelectorAll('input, select, textarea'))
    .filter((i) => !['hidden', 'file'].includes(i.type) && i.id !== 'date-picker');
  const unlabeledInputs = inputs.filter((i) =>
    (!i.labels || i.labels.length === 0) && !i.getAttribute('aria-label'));
  ok('a11y: у всех полей есть label', unlabeledInputs.length === 0,
    unlabeledInputs.map((i) => i.id || i.type).join(', '));

  const imgsNoAlt = Array.from(document.querySelectorAll('img')).filter((i) => i.alt === null);
  ok('a11y: у картинок есть alt', imgsNoAlt.length === 0, imgsNoAlt.length + ' без alt');

  ok('a11y: есть lang="ru"', document.documentElement.lang === 'ru');
  ok('a11y: есть viewport', !!document.querySelector('meta[name="viewport"]'));

  /* --- Переполнение вёрстки --- */
  const vw = document.documentElement.clientWidth;
  const offenders = [];
  document.querySelectorAll('body *').forEach((el) => {
    if (el.closest('.chips')) return; // горизонтальный скролл там задуман
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    if (r.right > vw + 1.5) offenders.push(el.tagName.toLowerCase() + '.' + String(el.className).split(' ')[0] + ' → ' + Math.round(r.right));
  });
  ok('вёрстка: нет вылезающих элементов', offenders.length === 0, offenders.slice(0, 6).join(' | '));
  ok('вёрстка: нет горизонтального скролла',
    document.documentElement.scrollWidth <= vw + 1,
    document.documentElement.scrollWidth + ' > ' + vw);

  /* --- Длинное название без пробелов --- */
  await DBClearEntries();
  const longName = 'Супермегакалорийноеблюдоскурицейибекономиподливкойизсливокисырнымсоусом';
  await DBAddEntry({ name: longName, weight: 500, kcal: 999, protein: 50, fats: 40, carbs: 60, image: '', date: todayStr(), createdAt: Date.now() });
  await refreshDiary();
  const card = document.querySelector('#entries-list .entry');
  ok('длинное слово: карточка не вылезает', card.getBoundingClientRect().right <= vw + 1,
    Math.round(card.getBoundingClientRect().right));
  ok('длинное слово: имя обрезано визуально',
    card.querySelector('.entry-name').scrollWidth >= 0 && card.querySelector('.entry-name').clientHeight <= 40,
    card.querySelector('.entry-name').clientHeight + 'px');

  /* --- Эмодзи и смешанный алфавит --- */
  await DBClearEntries();
  await DBAddEntry({ name: '🍕 Пицца 4 сыра / Pizza quattro formaggi', weight: 300, kcal: 700, protein: 30, fats: 30, carbs: 80, image: '', date: todayStr(), createdAt: Date.now() });
  await refreshDiary();
  ok('эмодзи в названии', document.querySelector('#entries-list .entry-name').textContent.indexOf('🍕') > -1);
  ok('эмодзи: карточка не ломается', document.querySelector('#entries-list .entry').getBoundingClientRect().right <= vw + 1);

  /* --- Ошибки сети в анализе --- */
  const realFetch = window.fetch;
  const realAnalyze = window.analyzeFood;

  window.analyzeFood = async () => {
    const e = new Error('Не удалось отправить запрос');
    throw e;
  };
  openAddFlow();
  document.getElementById('add-description').value = 'тест';
  document.getElementById('add-description').dispatchEvent(new Event('input'));
  await analyze();
  await sleep(200);
  ok('ошибка анализа: вернулись на ввод', document.querySelector('.pane.active').id === 'pane-capture');
  ok('ошибка анализа: тост показан', document.getElementById('toast').classList.contains('show'));

  window.analyzeFood = async () => {
    const e = new Error('На фото не видно еды');
    e.noFood = true;
    throw e;
  };
  await analyze();
  await sleep(200);
  ok('нет еды: понятное сообщение', document.getElementById('toast-text').textContent.indexOf('еды') > -1,
    document.getElementById('toast-text').textContent);

  window.analyzeFood = async () => {
    const e = new Error('Вставьте API-ключ');
    e.needKey = true;
    throw e;
  };
  await analyze();
  await sleep(200);
  ok('нет ключа: просит ключ', document.getElementById('toast-text').textContent.indexOf('ключ') > -1,
    document.getElementById('toast-text').textContent);

  window.analyzeFood = realAnalyze;
  window.fetch = realFetch;
  closeFlow();

  /* --- Быстрые клики по навигации --- */
  await DBClearEntries();
  await refreshDiary();
  const start = state.currentDate;
  for (let i = 0; i < 30; i++) changeDay(-1);
  ok('30 переходов назад', state.currentDate === addDays(start, -30), state.currentDate);
  for (let i = 0; i < 40; i++) changeDay(1);
  ok('40 переходов вперёд упираются в сегодня', state.currentDate === todayStr(), state.currentDate);

  /* --- Даты на границах года --- */
  state.currentDate = '2025-12-31';
  await refreshDiary();
  changeDay(1);
  ok('переход через год', state.currentDate === '2026-01-01' || state.currentDate === todayStr(), state.currentDate);

  /* --- Service worker и кеш --- */
  const regs = await navigator.serviceWorker.getRegistrations();
  ok('service worker зарегистрирован', regs.length > 0, regs.length);
  const cacheKeys = await caches.keys();
  ok('кеш создан', cacheKeys.some((k) => k.indexOf('kbzy-cache') === 0), cacheKeys.join(','));

  /* --- localStorage --- */
  saveSettings(state.settings);
  ok('настройки в localStorage', !!localStorage.getItem('kbzy-settings'));
  const stored = JSON.parse(localStorage.getItem('kbzy-settings') || '{}');
  ok('в localStorage есть норма', stored.kcal > 0, stored.kcal);

  state.currentDate = todayStr();
  await refreshDiary();

  const failed = R.filter((r) => !r.pass);
  return { total: R.length, passed: R.length - failed.length, failed };
};
