// Какие сайты знает расширение и как по адресу понять, что это страница работы.
// Файл общий: его подключают окошко расширения, фоновый скрипт и скрипт страницы.
(function () {
  const FBS = (globalThis.FBS = globalThis.FBS || {});
  if (FBS.platforms) return;

  // Языки интерфейса. Выбор в окошке хранится в storage («lang»); без выбора — английский.
  // chrome.i18n язык менять не умеет, поэтому выбранный файл _locales читаем сами.
  FBS.languages = [
    ['en', 'English'],
    ['ru', 'Русский'],
    ['uk', 'Українська'],
    ['kk', 'Қазақша'],
    ['es', 'Español'],
    ['de', 'Deutsch'],
    ['fr', 'Français'],
    ['it', 'Italiano'],
  ];
  let messages = null;

  /** Строка на выбранном языке; подстановки $1, $2… */
  FBS.t = (key, ...subs) => {
    const message = messages?.[key]?.message;
    if (message == null) return chrome.i18n.getMessage(key, subs.map(String)) || key;
    return message.replace(/\$(\d)/g, (_, n) => String(subs[n - 1] ?? ''));
  };

  /** Подгружает язык, выбранный в окошке (по умолчанию английский); возвращает его код. */
  FBS.loadLanguage = async () => {
    const { lang: saved } = await chrome.storage.local.get('lang');
    const lang = FBS.languages.some(([code]) => code === saved) ? saved : 'en';
    messages = await fetch(chrome.runtime.getURL(`_locales/${lang}/messages.json`))
      .then((r) => r.json())
      .catch(() => null);
    return lang;
  };

  const PLATFORMS = [
    {
      id: 'ao3',
      name: 'AO3',
      hosts: ['archiveofourown.org', 'ao3.org'],
      ready: true,
      workId: (url) => url.pathname.match(/\/works\/(\d+)/)?.[1] ?? null,
    },
    {
      id: 'ficbook',
      get name() {
        return FBS.t('siteFicbook');
      },
      hosts: ['ficbook.net'],
      ready: true,
      workId: (url) => url.pathname.match(/^\/readfic\/([\w-]+)/)?.[1] ?? null,
    },
    {
      id: 'ffn',
      name: 'FanFiction.net',
      hosts: ['fanfiction.net'],
      ready: true,
      workId: (url) => url.pathname.match(/^\/s\/(\d+)/)?.[1] ?? null,
    },
    {
      id: 'fanficsme',
      name: 'Fanfics.me',
      hosts: ['fanfics.me'],
      ready: false,
      workId: (url) =>
        url.pathname.match(/^\/fic(\d+)/)?.[1] ??
        (url.pathname === '/read.php' ? url.searchParams.get('id') : null),
    },
    {
      id: 'wattpad',
      name: 'Wattpad',
      hosts: ['wattpad.com'],
      ready: false,
      workId: (url) =>
        url.pathname.match(/^\/story\/(\d+)/)?.[1] ?? url.pathname.match(/^\/(\d+)-/)?.[1] ?? null,
    },
  ];

  function hostMatches(hostname, host) {
    return hostname === host || hostname.endsWith('.' + host);
  }

  /** Сайт и номер работы по адресу; null, если адрес не с поддерживаемого сайта. */
  function detect(href) {
    let url;
    try {
      url = new URL(href);
    } catch {
      return null;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    const platform = PLATFORMS.find((p) => p.hosts.some((h) => hostMatches(url.hostname, h)));
    if (!platform) return null;
    return { platform, workId: platform.workId(url) };
  }

  /** Шаблоны адресов для меню правой кнопки: только готовые сайты — к остальным нет доступа. */
  function urlPatterns() {
    return PLATFORMS.filter((p) => p.ready).flatMap((p) =>
      p.hosts.flatMap((h) => [`https://${h}/*`, `https://*.${h}/*`]),
    );
  }

  FBS.platforms = { list: PLATFORMS, detect, urlPatterns };
})();
