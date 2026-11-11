// Фоновый скрипт: запускает скачивание во вкладке сайта.
// Сама работа собирается внутри вкладки — со входом пользователя на сайт, как он её видит.
importScripts('platforms.js');

const CONTENT_FILES = [
  'src/platforms.js',
  'src/content/overlay.js',
  'src/content/clean.js',
  'src/content/output.js',
  'src/content/sites/ao3-archives.js',
  'src/content/sites/ao3.js',
  'src/content/sites/ficbook.js',
  'src/content/sites/ffn.js',
  'src/content/sites/fanficsme.js',
  'src/content/sites/wattpad.js',
  'src/content/run.js',
];

async function savedFormat() {
  const { format } = await chrome.storage.local.get('format');
  return format === 'html' ? 'html' : 'txt';
}

async function startInTab(tabId, format) {
  // Убираем «!» от прошлой неудачной попытки (см. reportError).
  chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
  chrome.action.setTitle({ tabId, title: 'FanBooks Saver' }).catch(() => {});
  await chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_FILES });
  // Не ждём окончания: скачивание идёт во вкладке и показывает свой прогресс там же.
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (f) => {
      globalThis.FBS.start(f);
    },
    args: [format],
  });
}

function waitForTabLoaded(tabId) {
  return new Promise((resolve, reject) => {
    function onUpdated(id, info) {
      if (id !== tabId || info.status !== 'complete') return;
      cleanup();
      resolve();
    }
    function onRemoved(id) {
      if (id !== tabId) return;
      cleanup();
      reject(new Error(FBS.t('errTabClosed')));
    }
    function cleanup() {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
    }
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
  });
}

/** По ссылке: открываем работу в новой вкладке и скачиваем оттуда. */
async function startFromUrl(url, format) {
  const tab = await chrome.tabs.create({ url, active: true });
  try {
    await waitForTabLoaded(tab.id);
    await startInTab(tab.id, format);
  } catch (error) {
    error.tabId = tab.id; // Чтобы показать ошибку на значке именно этой вкладки.
    throw error;
  }
}

/**
 * Скачивание из меню не стартовало (например, скрипт не внедрился) — плашки во вкладке нет,
 * поэтому показываем «!» на значке расширения и текст ошибки в подсказке к нему.
 * Значок вкладки сбрасывается сам, когда она переходит на другую страницу.
 */
function reportError(error, tabId) {
  console.error('[FanBooks Saver]', error);
  if (tabId == null) return;
  const message = String(error?.message ?? error);
  const ignore = () => {}; // Вкладку могли уже закрыть.
  chrome.action.setBadgeBackgroundColor({ tabId, color: '#900' }).catch(ignore);
  chrome.action.setBadgeText({ tabId, text: '!' }).catch(ignore);
  chrome.action.setTitle({ tabId, title: `FanBooks Saver: ${message}` }).catch(ignore);
}

// Архивы, откуда берём копии, когда сам сайт лежит. Со страницы сайта браузер их читать
// не даёт (чужой адрес), а фоновому скрипту можно — адреса есть в host_permissions.
const ARCHIVE_HOSTS = ['ao3saver.com', 'archive.org', 'web.archive.org'];

async function fetchArchive(href) {
  const url = new URL(href);
  if (url.protocol !== 'https:' || !ARCHIVE_HOSTS.includes(url.hostname)) {
    throw new Error(FBS.t('errNotArchive'));
  }
  const response = await fetch(url.href);
  return { status: response.status, url: response.url, text: response.ok ? await response.text() : '' };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'fetch-archive') {
    fetchArchive(message.url).then(
      (result) => sendResponse({ ok: true, ...result }),
      (error) => sendResponse({ ok: false, error: String(error?.message ?? error) }),
    );
    return true;
  }
  const run =
    message.type === 'download-tab'
      ? startInTab(message.tabId, message.format)
      : message.type === 'download-url'
        ? startFromUrl(message.url, message.format)
        : null;
  if (!run) return false;
  run.then(
    () => sendResponse({ ok: true }),
    (error) => sendResponse({ ok: false, error: String(error?.message ?? error) }),
  );
  return true;
});

async function buildMenus() {
  await FBS.loadLanguage();
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'fbs-link',
      title: FBS.t('menuLink'),
      contexts: ['link'],
      targetUrlPatterns: FBS.platforms.urlPatterns(),
    });
    chrome.contextMenus.create({
      id: 'fbs-page',
      title: FBS.t('menuPage'),
      contexts: ['page'],
      documentUrlPatterns: FBS.platforms.urlPatterns(),
    });
  });
}

chrome.runtime.onInstalled.addListener(buildMenus);
// Язык сменили в окошке — подписи меню тоже.
chrome.storage.onChanged.addListener((changes) => {
  if (changes.lang) buildMenus();
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const format = await savedFormat();
  if (info.menuItemId === 'fbs-link' && info.linkUrl) {
    startFromUrl(info.linkUrl, format).catch((error) => reportError(error, error?.tabId));
  }
  if (info.menuItemId === 'fbs-page' && tab?.id != null) {
    startInTab(tab.id, format).catch((error) => reportError(error, tab.id));
  }
});
