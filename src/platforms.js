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

  // Форматы файла; первый — по умолчанию. Выбор в окошке хранится в storage («format»).
  FBS.formats = ['txt', 'html', 'epub'];

  // Страница отзывов в Chrome Web Store. У установленного из магазина расширения id совпадает
  // с магазинным; у загруженного из папки он другой, и страница не найдётся — это нормально.
  FBS.reviewsUrl = () => `https://chromewebstore.google.com/detail/${chrome.runtime.id}/reviews`;

  /** Строка на выбранном языке; подстановки $1, $2… */
  FBS.t = (key, ...subs) => {
    const message = messages?.[key]?.message;
    if (message == null) {
      // Расширение обновили, а вкладку нет: у старого скрипта страницы chrome.* уже не работает.
      try {
        return chrome.i18n.getMessage(key, subs.map(String)) || key;
      } catch {
        return key;
      }
    }
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
      workUrl: 'https://archiveofourown.org/works/',
      workId: (url) => url.pathname.match(/\/works\/(\d+)/)?.[1] ?? null,
    },
    {
      id: 'ficbook',
      get name() {
        return FBS.t('siteFicbook');
      },
      hosts: ['ficbook.net'],
      ready: true,
      workUrl: 'https://ficbook.net/readfic/',
      workId: (url) => url.pathname.match(/^\/readfic\/([\w-]+)/)?.[1] ?? null,
    },
    {
      id: 'ffn',
      name: 'FanFiction.net',
      hosts: ['fanfiction.net'],
      ready: true,
      workUrl: 'https://www.fanfiction.net/s/',
      workId: (url) => url.pathname.match(/^\/s\/(\d+)/)?.[1] ?? null,
    },
    {
      id: 'fanficsme',
      name: 'Fanfics.me',
      hosts: ['fanfics.me'],
      ready: true,
      workUrl: 'https://fanfics.me/fic',
      workId: (url) =>
        url.pathname.match(/^\/fic(\d+)/)?.[1] ??
        (url.pathname === '/read.php' ? url.searchParams.get('id') : null),
    },
    {
      id: 'wattpad',
      name: 'Wattpad',
      hosts: ['wattpad.com'],
      ready: true,
      workUrl: 'https://www.wattpad.com/story/',
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

  // Что набрать в поле ссылки перед Tab: начало любого из слов → адрес работы на этом сайте.
  // Порядок важен: «f» — Книга Фанфиков, «fanfic» — Fanfics.me, «fanfict» — FanFiction.net.
  const SHORTCUTS = [
    ['ao3', 'ao3'],
    ['ao3', 'archiveofourown'],
    ['ficbook', 'ficbook'],
    ['ficbook', 'книга'],
    ['ffn', 'ffn'],
    ['fanficsme', 'fanfics'],
    ['ffn', 'fanfiction'],
    ['wattpad', 'wattpad'],
  ];
  FBS.shortcutNames = ['ao3', 'ficbook', 'ffn', 'fanfics', 'wattpad'];

  /** Адрес, который подставит Tab для набранного текста; null — подставлять нечего. */
  function complete(typed) {
    const text = typed.trim().toLowerCase();
    if (!text || /[/:.]/.test(text)) return null;
    const hit = SHORTCUTS.find(([, word]) => word.startsWith(text));
    return hit ? PLATFORMS.find((p) => p.id === hit[0]).workUrl : null;
  }

  FBS.platforms = { list: PLATFORMS, detect, urlPatterns, complete };
})();
