// Окошко расширения: формат, галочка перевода (только HTML) и одно поле ссылки на работу —
// открытая во вкладке работа скачивается прямо из неё, любая другая — в фоновой вкладке.
const { platforms, t, languages, loadLanguage, formats, reviewsUrl } = globalThis.FBS;

/** Язык окошка: подписи из выбранного языка и список языков в шапке. */
async function applyLanguage() {
  const lang = await loadLanguage();
  document.documentElement.lang = lang;
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  const select = document.getElementById('lang');
  select.title = t('langTitle');
  select.setAttribute('aria-label', t('langTitle'));
  select.replaceChildren(...languages.map(([code, name]) => new Option(name, code)));
  select.value = lang;
}

document.getElementById('lang').addEventListener('change', async (event) => {
  await chrome.storage.local.set({ lang: event.target.value });
  location.reload(); // Проще всего перерисовать окошко заново на новом языке.
});

const form = document.getElementById('work-form');
const linkInput = document.getElementById('link');
const status = document.getElementById('status');
const button = document.getElementById('download');
const translateBox = document.getElementById('translate-box');
const translateInput = document.getElementById('translate');
const ghost = document.getElementById('ghost');
const tabKey = document.getElementById('tab-key');

let tab = null; // Активная вкладка.
let action = null; // Что сделает кнопка сейчас (см. refresh).
let busy = false; // Скачивание по ссылке идёт в фоне — ждём его итога.

function setStatus(text, isError = false) {
  status.textContent = text;
  status.classList.toggle('error', isError);
}

function currentFormat() {
  return document.querySelector('input[name="format"]:checked').value;
}

async function loadSettings() {
  const { format, translate } = await chrome.storage.local.get(['format', 'translate']);
  const input = document.querySelector(`input[name="format"][value="${formats.includes(format) ? format : 'txt'}"]`);
  input.checked = true;
  translateInput.checked = translate === true;
}

/** Та же работа, что открыта во вкладке? Тогда скачиваем прямо из неё. */
function isOpenHere(found) {
  const here = tab?.url ? platforms.detect(tab.url) : null;
  return Boolean(here?.workId && here.platform.id === found.platform.id && here.workId === found.workId);
}

/** Подпись под полем и действие кнопки — по ссылке в поле, формату и галочке перевода. */
function refresh() {
  const html = currentFormat() === 'html';
  translateBox.hidden = !html;
  const translate = html && translateInput.checked;

  const value = linkInput.value.trim();
  const completion = platforms.complete(value);
  ghost.hidden = tabKey.hidden = !completion;
  if (completion) {
    document.getElementById('ghost-typed').textContent = linkInput.value;
    document.getElementById('ghost-rest').textContent = `  →  ${completion.replace(/^https:\/\/(www\.)?/, '')}`;
  }

  action = null;
  const found = value ? platforms.detect(value) : null;
  if (!value) {
    setStatus(t('popupTypeSite', globalThis.FBS.shortcutNames.join(', ')));
  } else if (!found) {
    setStatus(completion ? t('popupPressTab') : t('popupUnsupported'));
  } else if (!found.platform.ready) {
    setStatus(t('popupPlatformSoon', found.platform.name));
  } else if (!found.workId) {
    // Только что подставили адрес по Tab — осталось дописать номер.
    const template = value === found.platform.workUrl;
    setStatus(t(template ? 'popupAddWorkId' : 'popupNotWork', found.platform.name));
  } else if (isOpenHere(found)) {
    setStatus(t('popupWorkHere', found.platform.name, found.workId));
    action = { type: 'download-tab', tabId: tab.id };
  } else {
    setStatus(t(translate ? 'popupWorkOpen' : 'popupWorkOther', found.platform.name, found.workId));
    action = { type: 'download-url', url: value };
  }
  button.textContent = t(action?.type === 'download-url' && translate ? 'popupOpenWork' : 'popupDownloadLink');
  button.disabled = busy || !action;
}

for (const input of document.querySelectorAll('input[name="format"]')) {
  input.addEventListener('change', () => {
    chrome.storage.local.set({ format: currentFormat() });
    refresh();
  });
}

translateInput.addEventListener('change', () => {
  chrome.storage.local.set({ translate: translateInput.checked });
  refresh();
});

linkInput.addEventListener('input', refresh);

// Tab подставляет адрес сайта по набранному началу его имени: «ao3» → https://archiveofourown.org/works/.
linkInput.addEventListener('keydown', (event) => {
  if (event.key !== 'Tab' || event.shiftKey) return;
  const completion = platforms.complete(linkInput.value);
  if (!completion) return;
  event.preventDefault();
  linkInput.value = completion;
  linkInput.setSelectionRange(completion.length, completion.length);
  refresh();
});

async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || t('popupStartFailed'));
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!action) return;
  const format = currentFormat();
  const translate = format === 'html' && translateInput.checked;
  const message = { ...action, format, translate };
  button.disabled = true;
  try {
    if (message.type === 'download-url' && !translate) {
      // Работа скачивается в фоновой вкладке; пользователь остаётся на своей странице.
      busy = true;
      setStatus(t('popupBackground'));
      await send(message);
    } else {
      await send(message);
      window.close(); // Дальше ход показывает плашка на странице.
    }
  } catch (error) {
    busy = false;
    setStatus(error.message, true);
    button.disabled = false;
  }
});

async function init() {
  await applyLanguage();
  await loadSettings();
  document.getElementById('sites').textContent =
    t('popupSites', platforms.list.map((p) => (p.ready ? p.name : t('popupSoon', p.name))).join(', '));

  document.getElementById('statuses').addEventListener('click', async (event) => {
    event.preventDefault();
    await chrome.tabs.create({ url: chrome.runtime.getURL('popup/statuses.html') });
    window.close();
  });

  const rateLink = document.getElementById('rate');
  rateLink.textContent = t('popupRate');
  rateLink.addEventListener('click', async (event) => {
    event.preventDefault();
    // Оценили по ссылке — плашка больше не просит.
    await chrome.storage.local.set({ rateDone: true });
    await chrome.tabs.create({ url: reviewsUrl() });
    window.close();
  });

  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  // Открыта работа — её ссылка уже в поле.
  const here = tab?.url ? platforms.detect(tab.url) : null;
  if (here?.workId && here.platform.ready) linkInput.value = tab.url;
  refresh();
  linkInput.focus();
}

// Ход скачивания по ссылке — из фоновой вкладки, пока окошко открыто.
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'bg-progress') {
    setStatus([message.text, message.detail].filter(Boolean).join(' — '));
  } else if (message.type === 'bg-done') {
    busy = false;
    if (message.ok) linkInput.value = '';
    refresh();
    setStatus([message.text, message.detail].filter(Boolean).join(' '), !message.ok);
  }
});

init();
