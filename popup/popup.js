// Окошко расширения: выбор формата, скачивание с текущей вкладки или по ссылке.
const { platforms } = globalThis.FBS;

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
  const input = document.querySelector(`input[name="format"][value="${format === 'html' ? 'html' : 'txt'}"]`);
  input.checked = true;
}

for (const input of document.querySelectorAll('input[name="format"]')) {
  input.addEventListener('change', () => chrome.storage.local.set({ format: currentFormat() }));
}

/** Что можно сделать с открытой вкладкой. */
function describe(found) {
  if (!found) return { text: 'Откройте работу на одном из сайтов ниже.' };
  const { platform, workId } = found;
  if (!platform.ready) return { text: `${platform.name} — поддержка скоро будет.` };
  if (!workId) return { text: `${platform.name}: откройте страницу самой работы.` };
  return { text: `${platform.name}, работа ${workId}.`, canDownload: true };
}

async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || 'Не получилось запустить скачивание');
}

async function init() {
  await loadFormat();
  document.getElementById('sites').textContent =
    'Сайты: ' + platforms.list.map((p) => (p.ready ? p.name : `${p.name} (скоро)`)).join(', ');

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
  setStatus(linkStatus, 'Открываю работу во вкладке…');
  try {
    // Окошко закроется, когда откроется вкладка; скачивание продолжит фоновый скрипт.
    await send({ type: 'download-url', url, format: currentFormat() });
  } catch (error) {
    setStatus(linkStatus, error.message, true);
  }
});

init();
