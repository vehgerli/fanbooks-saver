// Окошко расширения: выбор формата, скачивание с текущей вкладки или по ссылке.
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

const pageStatus = document.getElementById('page-status');
const pageButton = document.getElementById('download-page');
const linkForm = document.getElementById('link-form');
const linkInput = document.getElementById('link');
const linkStatus = document.getElementById('link-status');

function setStatus(el, text, isError = false) {
  el.textContent = text;
  el.classList.toggle('error', isError);
}

function currentFormat() {
  return document.querySelector('input[name="format"]:checked').value;
}

async function loadFormat() {
  const { format } = await chrome.storage.local.get('format');
  const input = document.querySelector(`input[name="format"][value="${formats.includes(format) ? format : 'txt'}"]`);
  input.checked = true;
}

for (const input of document.querySelectorAll('input[name="format"]')) {
  input.addEventListener('change', () => chrome.storage.local.set({ format: currentFormat() }));
}

/** Что можно сделать с открытой вкладкой. */
function describe(found) {
  if (!found) return { text: t('popupOpenSupported') };
  const { platform, workId } = found;
  if (!platform.ready) return { text: t('popupPlatformSoon', platform.name) };
  if (!workId) return { text: t('popupOpenWorkPage', platform.name) };
  return { text: t('popupWorkFound', platform.name, workId), canDownload: true };
}

async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || t('popupStartFailed'));
}

async function init() {
  await applyLanguage();
  await loadFormat();
  document.getElementById('sites').textContent =
    t('popupSites', platforms.list.map((p) => (p.ready ? p.name : t('popupSoon', p.name))).join(', '));

  const rateLink = document.getElementById('rate');
  rateLink.textContent = t('popupRate');
  rateLink.addEventListener('click', async (event) => {
    event.preventDefault();
    // Оценили по ссылке — плашка больше не просит.
    await chrome.storage.local.set({ rateDone: true });
    await chrome.tabs.create({ url: reviewsUrl() });
    window.close();
  });

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const state = describe(tab?.url ? platforms.detect(tab.url) : null);
  setStatus(pageStatus, state.text);
  pageButton.hidden = !state.canDownload;

  pageButton.addEventListener('click', async () => {
    pageButton.disabled = true;
    try {
      await send({ type: 'download-tab', tabId: tab.id, format: currentFormat() });
      window.close(); // Дальше прогресс показывает плашка на странице.
    } catch (error) {
      setStatus(pageStatus, error.message, true);
      pageButton.disabled = false;
    }
  });
}

linkForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const url = linkInput.value.trim();
  const state = describe(platforms.detect(url));
  if (!state.canDownload) return setStatus(linkStatus, state.text, true);
  setStatus(linkStatus, t('popupOpening'));
  try {
    // Окошко закроется, когда откроется вкладка; скачивание продолжит фоновый скрипт.
    await send({ type: 'download-url', url, format: currentFormat() });
  } catch (error) {
    setStatus(linkStatus, error.message, true);
  }
});

init();
