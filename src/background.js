// Фоновый скрипт: запускает скачивание во вкладке сайта.
// Сама работа собирается внутри вкладки — со входом пользователя на сайт, как он её видит.
importScripts('platforms.js');

const CONTENT_FILES = [
  'src/platforms.js',
  'src/content/overlay.js',
  'src/content/clean.js',
  'src/content/output.js',
  'src/content/sites/ao3.js',
  'src/content/sites/ficbook.js',
  'src/content/sites/ffn.js',
  'src/content/run.js',
];

async function savedFormat() {
  const { format } = await chrome.storage.local.get('format');
  return format === 'html' ? 'html' : 'txt';
}

async function startInTab(tabId, format) {
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
      reject(new Error('Вкладку закрыли до загрузки'));
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
  await waitForTabLoaded(tab.id);
  await startInTab(tab.id, format);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
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

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'fbs-link',
      title: 'Скачать работу по ссылке',
      contexts: ['link'],
      targetUrlPatterns: FBS.platforms.urlPatterns(),
    });
    chrome.contextMenus.create({
      id: 'fbs-page',
      title: 'Скачать эту работу',
      contexts: ['page'],
      documentUrlPatterns: FBS.platforms.urlPatterns(),
    });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const format = await savedFormat();
  if (info.menuItemId === 'fbs-link' && info.linkUrl) startFromUrl(info.linkUrl, format);
  if (info.menuItemId === 'fbs-page' && tab?.id != null) startInTab(tab.id, format);
});
