// Страница «Статусы AO3»: сохранить все статусы в файл и загрузить их обратно.
// Открывается из окошка расширения отдельной вкладкой: выбор файла из самого окошка
// в некоторых системах закрывает окошко раньше, чем файл выбран.
//
// Файл — JSON: { app: 'FanBooks Saver', type: 'ao3-statuses', version: 1, exported, works: { <номер>: { s, title, at, upd? } } }.
// При загрузке у работы, отмеченной и тут, и в файле, остаётся более новый статус (по at).
const { t, loadLanguage } = globalThis.FBS;

const STATUSES = new Set(['read', 'reading', 'readDl', 'readingDl', 'dl']);
const PREFIX = 'ao3:';

const countEl = document.getElementById('count');
const resultEl = document.getElementById('result');
const fileInput = document.getElementById('file');

function setResult(text, isError = false) {
  resultEl.textContent = text;
  resultEl.classList.toggle('error', isError);
}

/** Все статусы из хранилища: { номер: { s, title, at } }. */
async function readAll() {
  const all = await chrome.storage.local.get(null);
  const works = {};
  for (const [key, value] of Object.entries(all)) {
    if (key.startsWith(PREFIX) && STATUSES.has(value?.s)) works[key.slice(PREFIX.length)] = value;
  }
  return works;
}

async function showCount() {
  countEl.textContent = t('statusesCount', Object.keys(await readAll()).length);
}

document.getElementById('export').addEventListener('click', async () => {
  const works = await readAll();
  const count = Object.keys(works).length;
  if (!count) return setResult(t('statusesEmpty'), true);
  const data = { app: 'FanBooks Saver', type: 'ao3-statuses', version: 1, exported: new Date().toISOString(), works };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = `fanbooks-ao3-statuses-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(href), 60000);
  setResult(t('statusesExported', count));
});

document.getElementById('import').addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', async () => {
  const file = fileInput.files[0];
  fileInput.value = ''; // Чтобы тот же файл можно было выбрать ещё раз.
  if (!file) return;
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    data = null;
  }
  if (data?.type !== 'ao3-statuses' || typeof data.works !== 'object' || !data.works) {
    return setResult(t('statusesBadFile'), true);
  }
  const current = await readAll();
  const updates = {};
  for (const [id, item] of Object.entries(data.works)) {
    if (!/^\d+$/.test(id) || !STATUSES.has(item?.s)) continue;
    const at = Number(item.at) || 0;
    if (current[id] && (Number(current[id].at) || 0) >= at) continue; // Здесь статус новее или тот же.
    updates[PREFIX + id] = { s: item.s, title: String(item.title ?? '').slice(0, 500), at };
    if (/^\d{4}-\d{2}-\d{2}$/.test(item.upd)) updates[PREFIX + id].upd = item.upd;
  }
  await chrome.storage.local.set(updates);
  setResult(t('statusesImported', Object.keys(updates).length));
  await showCount();
});

(async () => {
  const lang = await loadLanguage();
  document.documentElement.lang = lang;
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  document.title = `FanBooks Saver — ${t('statusesTitle')}`;
  await showCount();
})();
