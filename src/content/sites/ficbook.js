// Книга Фанфиков: шапка — на странице работы, текст — на странице каждой части.
// Сайт быстро ограничивает частые запросы (ответ 429), поэтому части грузим по одной с паузой,
// а при ограничении ждём и повторяем.
(function () {
  const FBS = (globalThis.FBS = globalThis.FBS || {});
  FBS.sites = FBS.sites || {};
  if (FBS.sites.ficbook) return;
  const { line } = FBS.clean;

  class SiteError extends Error {}

  const PAUSE_MS = 1500;
  const RETRY_WAITS_S = [20, 40, 60];
  // Эти поля шапки — текст автора, они идут отдельными разделами, а не строкой в шапке.
  const SECTION_LABELS = new Set(['Описание:', 'Примечания:', 'Посвящение:']);
  const AUTHOR_ROLES = /^(автор|соавтор)/i;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function load(path, onStage, stage) {
    for (let attempt = 0; ; attempt++) {
      onStage(stage);
      const response = await fetch(path, { credentials: 'include' });
      if (response.url.includes('/login')) {
        throw new SiteError('Работа доступна только после входа на Книгу Фанфиков.');
      }
      if (response.status === 429 && attempt < RETRY_WAITS_S.length) {
        for (let left = RETRY_WAITS_S[attempt]; left > 0; left--) {
          onStage(stage, `Сайт просит подождать — продолжу через ${left} с`);
          await sleep(1000);
        }
        continue;
      }
      if (response.status === 429) throw new SiteError('Сайт временно ограничил доступ. Попробуйте через несколько минут.');
      if (response.status === 404) throw new SiteError('Работа не найдена: возможно, её удалили или скрыли.');
      if (!response.ok) throw new SiteError(`Книга Фанфиков ответила ошибкой ${response.status}.`);
      return new DOMParser().parseFromString(await response.text(), 'text/html');
    }
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

  /** Участники из шапки: авторы — в подпись, беты и гаммы — строками шапки. */
  function readCreators(doc) {
    const authors = [];
    const others = [];
    const links = doc.querySelectorAll('.fanfic-hat a.word-break[href^="/authors/"]');
    for (const link of links.length ? links : doc.querySelectorAll('[itemprop="author"]')) {
      const name = line(link);
      const role = line(link.closest('.flex-column')?.querySelector('.ds-badge'));
      if (!name) continue;
      if (!role || AUTHOR_ROLES.test(role)) authors.push(name);
      else others.push({ label: role[0].toUpperCase() + role.slice(1) + ':', value: name });
    }
    return { authors, others };
  }

  function readBadges(doc) {
    const badges = doc.querySelector('.fanfic-badges');
    if (!badges) return [];
    const direction = line(badges.querySelector('.direction .hidden-xs') ?? badges.querySelector('.direction'));
    const rating = line(badges.querySelector('[class*="ds-label-rating"]'));
    const status = line(badges.querySelector('[class*="ds-label-status"]'));
    return [
      { label: 'Направленность:', value: direction },
      { label: 'Рейтинг:', value: rating },
      { label: 'Статус:', value: status },
    ].filter((m) => m.value);
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
    const doc = await load(`/readfic/${workId}`, onStage, 'Загружаю шапку работы…');
    // У работ из одной части заголовок стоит вне шапки и помечен headline, у остальных — name.
    const title = line(doc.querySelector('h1[itemprop="headline"], h1[itemprop="name"], .fanfic-hat h1, h1.heading'));
    if (!title) {
      throw new SiteError('Не узнала страницу работы: возможно, сайт поменял оформление.');
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
      const partDoc = await load(path, onStage, `Часть ${index + 1} из ${links.length}`);
      const part = readPart(partDoc, line(link.querySelector('h3')));
      if (!part) throw new SiteError(`Сайт не показывает текст части ${index + 1}.`);
      chapters.push(part);
    }
    if (!chapters.length) throw new SiteError('Сайт не показывает текст этой работы.');

    const { meta, preface } = readHat(doc);
    const { authors, others } = readCreators(doc);
    return {
      site: 'Книга Фанфиков',
      url,
      title,
      authors,
      meta: [...readBadges(doc), ...others, ...meta],
      preface,
      chapters,
      endNotes: [],
    };
  }

  FBS.sites.ficbook = { fetchWork, SiteError };
})();
