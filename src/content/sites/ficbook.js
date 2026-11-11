// Книга Фанфиков: шапка — на странице работы, текст — на странице каждой части.
// Сайт быстро ограничивает частые запросы (ответ 429), поэтому части грузим по одной с паузой,
// а при ограничении ждём и повторяем (см. net.js).
(function () {
  const FBS = (globalThis.FBS = globalThis.FBS || {});
  FBS.sites = FBS.sites || {};
  if (FBS.sites.ficbook) return;
  const { line } = FBS.clean;
  const { t } = FBS;
  const { fetchRetry, SiteError, sleep } = FBS.net;

  const PAUSE_MS = 1500;
  // Эти поля шапки — текст автора, они идут отдельными разделами, а не строкой в шапке.
  const SECTION_LABELS = new Set(['Описание:', 'Примечания:', 'Посвящение:']);
  const AUTHOR_ROLES = /^(автор|соавтор)/i;

  async function load(path, onStage, stage) {
    const response = await fetchRetry(path, { onStage, stage });
    if (response.url.includes('/login')) {
      throw new SiteError(t('errLogin', t('siteFicbook')));
    }
    if (response.status === 429) throw new SiteError(t('errRateLimited'));
    if (response.status === 404) throw new SiteError(t('errNotFound'));
    if (!response.ok) throw new SiteError(t('errSiteStatus', t('siteFicbook'), response.status));
    return new DOMParser().parseFromString(response.text, 'text/html');
  }

  /** Значение поля шапки: метки и пейринги через запятую, остальное — текстом как на сайте. */
  function metaValue(box) {
    const links = box.querySelectorAll('a.tag, a.pairing-link');
    if (links.length) return [...links].map(line).filter(Boolean).join(', ');
    return line(box).replace(/\s+,/g, ',');
  }

  function readHat(doc) {
    const meta = [];
    const preface = [];
    for (const block of doc.querySelectorAll('.fanfic-hat .mb-10, .description .mb-10')) {
      const label = line(block.querySelector(':scope > strong'));
      const box = block.querySelector(':scope > div');
      if (!label || !box) continue;
      if (SECTION_LABELS.has(label)) {
        if (box.textContent.trim()) preface.push({ heading: label, el: box, lines: true });
      } else {
        const value = metaValue(box);
        if (value) meta.push({ label, value });
      }
    }
    return { meta, preface };
  }

  /**
   * Участники из шапки: авторы — в подпись, беты и гаммы — строками шапки.
   * creators — все по порядку, с ролью и ссылкой на профиль (для раскладки как у сайта).
   */
  function readCreators(doc, base) {
    const authors = [];
    const others = [];
    const creators = [];
    const links = doc.querySelectorAll('.fanfic-hat a.word-break[href^="/authors/"]');
    for (const link of links.length ? links : doc.querySelectorAll('[itemprop="author"]')) {
      const name = line(link);
      const badge = line(link.closest('.flex-column')?.querySelector('.ds-badge'));
      if (!name) continue;
      const role = badge ? badge[0].toUpperCase() + badge.slice(1) : 'Автор';
      const href = link.getAttribute('href');
      creators.push({ role, name, url: href ? new URL(href, base).href : undefined });
      if (!badge || AUTHOR_ROLES.test(badge)) authors.push(name);
      else others.push({ label: role + ':', value: name });
    }
    return { authors, others, creators };
  }

  function readBadges(doc) {
    const badges = doc.querySelector('.fanfic-badges');
    if (!badges) return {};
    return {
      direction: line(badges.querySelector('.direction .hidden-xs') ?? badges.querySelector('.direction')),
      rating: line(badges.querySelector('[class*="ds-label-rating"]')),
      status: line(badges.querySelector('[class*="ds-label-status"]')),
    };
  }

  /** Текст части и её примечания до и после. */
  function readPart(doc, fallbackTitle) {
    const body = doc.querySelector('#content.part_text, #content');
    if (!body || !body.textContent.trim()) return null;
    const note = (selector) => {
      const box = doc.querySelector(selector);
      const el = box?.querySelector('[class*="js-public-beta-comment"]') ?? box?.querySelector(':scope > div');
      return el && el.textContent.trim()
        ? [{ heading: line(box.querySelector('strong')) || 'Примечания:', el, lines: true }]
        : [];
    };
    return {
      title: line(doc.querySelector('#part_content .title-area h2')) || fallbackTitle,
      preface: note('.part-comment-top'),
      body,
      lines: true,
      endNotes: note('.part-comment-bottom'),
    };
  }

  async function fetchWork(workId, onStage) {
    const url = `${location.origin}/readfic/${workId}`;
    const doc = await load(`/readfic/${workId}`, onStage, t('stageHeader'));
    // У работ из одной части заголовок стоит вне шапки и помечен headline, у остальных — name.
    const title = line(doc.querySelector('h1[itemprop="headline"], h1[itemprop="name"], .fanfic-hat h1, h1.heading'));
    if (!title) {
      throw new SiteError(t('errLayout'));
    }

    const links = [...doc.querySelectorAll('.list-of-fanfic-parts a.part-link[href]')];
    const chapters = [];
    if (!links.length) {
      // Работа из одной части: текст прямо на странице работы.
      const part = readPart(doc, '');
      if (part) chapters.push({ ...part, title: '' });
    }
    for (const [index, link] of links.entries()) {
      await sleep(PAUSE_MS);
      const path = new URL(link.getAttribute('href'), url).pathname;
      const partDoc = await load(path, onStage, t('stagePart', index + 1, links.length));
      const part = readPart(partDoc, line(link.querySelector('h3')));
      if (!part) throw new SiteError(t('errNoPartText', index + 1));
      chapters.push(part);
    }
    if (!chapters.length) throw new SiteError(t('errNoText'));

    const { meta, preface } = readHat(doc);
    const { authors, others, creators } = readCreators(doc, url);
    const { direction, rating, status } = readBadges(doc);
    const badges = [
      { label: 'Направленность:', value: direction },
      { label: 'Рейтинг:', value: rating },
      { label: 'Статус:', value: status },
    ].filter((m) => m.value);
    return {
      site: t('siteFicbook'),
      layout: 'ficbook',
      // Шапка по полям — для раскладки как в выгрузке сайта (layouts.js).
      hat: { direction, rating, status, creators, fields: meta },
      url,
      title,
      authors,
      meta: [...badges, ...others, ...meta],
      preface,
      chapters,
      endNotes: [],
    };
  }

  FBS.sites.ficbook = { fetchWork, SiteError };
})();
