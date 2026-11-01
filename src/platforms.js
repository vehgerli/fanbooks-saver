// Какие сайты знает расширение и как по адресу понять, что это страница работы.
// Файл общий: его подключают окошко расширения, фоновый скрипт и скрипт страницы.
(function () {
  const FBS = (globalThis.FBS = globalThis.FBS || {});
  if (FBS.platforms) return;

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
      name: 'Книга Фанфиков',
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

  /** Шаблоны адресов для меню правой кнопки. */
  function urlPatterns() {
    return PLATFORMS.flatMap((p) => p.hosts.flatMap((h) => [`https://${h}/*`, `https://*.${h}/*`]));
  }

  FBS.platforms = { list: PLATFORMS, detect, urlPatterns };
})();
