// AO3: работа целиком на одной странице (режим «Entire Work»), поэтому нужен один запрос.
(function () {
  const FBS = (globalThis.FBS = globalThis.FBS || {});
  FBS.sites = FBS.sites || {};
  if (FBS.sites.ao3) return;
  const { line } = FBS.clean;

  class SiteError extends Error {}

  /** Значение поля шапки: теги через запятую, статистика парами «подпись значение». */
  function metaValue(dd) {
    const stats = dd.querySelector('dl');
    if (stats) {
      return [...stats.querySelectorAll('dt')]
        .map((dt) => `${line(dt)} ${line(dt.nextElementSibling)}`)
        .join(' ');
    }
    const items = dd.querySelectorAll('li');
    if (items.length) return [...items].map(line).filter(Boolean).join(', ');
    return line(dd);
  }

  function readMeta(doc) {
    const dl = doc.querySelector('dl.work.meta');
    if (!dl) return [];
    return [...dl.querySelectorAll(':scope > dt')]
      .map((dt) => ({ label: line(dt), value: metaValue(dt.nextElementSibling) }))
      .filter((m) => m.label && m.value);
  }

  /** Блок «Summary» / «Notes» / «End Notes»: подпись и текст автора. */
  function readModules(root, selector) {
    if (!root) return [];
    return [...root.querySelectorAll(selector)]
      .map((module) => {
        const el = module.querySelector('blockquote.userstuff, .userstuff');
        if (!el) return null;
        el.querySelectorAll('p.jump').forEach((p) => p.remove());
        return { heading: line(module.querySelector(':scope > h3, :scope > .heading')), el };
      })
      .filter((s) => s && s.el.textContent.trim());
  }

  function chapterBody(root) {
    const body = root.querySelector('.userstuff.module, :scope > .userstuff');
    if (!body) return null;
    // «Chapter Text» — служебная подпись AO3 для экранных дикторов, не текст работы.
    body.querySelectorAll('h3.landmark').forEach((h) => h.remove());
    return body;
  }

  function readChapters(doc) {
    const box = doc.querySelector('#chapters');
    if (!box) return [];
    const chapters = [...box.querySelectorAll(':scope > div.chapter')];
    if (!chapters.length) {
      const body = chapterBody(box);
      return body ? [{ title: '', preface: [], body, endNotes: [] }] : [];
    }
    return chapters
      .map((chapter) => {
        const body = chapterBody(chapter);
        if (!body) return null;
        const head = chapter.querySelector(':scope > .chapter.preface');
        return {
          title: line(head?.querySelector('h3.title')),
          preface: readModules(head, ':scope > .summary, :scope > .notes'),
          body,
          endNotes: readModules(chapter, ':scope > .preface .end.notes, :scope > .end.notes'),
        };
      })
      .filter(Boolean);
  }

  function parse(doc, url) {
    const title = line(doc.querySelector('h2.title.heading'));
    const chapters = readChapters(doc);
    if (!title || !chapters.length) {
      throw new SiteError('Сайт не показывает текст этой работы.');
    }
    const byline = doc.querySelector('h3.byline');
    const authorLinks = byline ? [...byline.querySelectorAll('a[rel="author"]')] : [];
    const authors = authorLinks.length ? authorLinks.map(line) : byline ? [line(byline)] : [];
    const preface = doc.querySelector('#workskin > .preface');
    return {
      site: 'AO3',
      url,
      title,
      authors: authors.filter(Boolean),
      meta: readMeta(doc),
      preface: readModules(preface, ':scope > .summary, :scope > .notes'),
      chapters,
      endNotes: readModules(doc, '#work_endnotes'),
    };
  }

  async function fetchWork(workId, onStage) {
    const origin = location.origin;
    const url = `${origin}/works/${workId}`;
    onStage('Загружаю работу целиком…');
    // view_adult=true — та же ссылка, что кнопка «Proceed» в предупреждении о взрослом содержании.
    let response;
    try {
      response = await fetch(`${url}?view_full_work=true&view_adult=true`, { credentials: 'include' });
    } catch {
      response = null;
    }
    // На время техработ AO3 отвечает 418, при перегрузке — 502/503: тогда ищем сохранённую копию.
    if (!response || [418, 502, 503].includes(response.status)) {
      const copy = await FBS.ao3Archives.fetchCopy(workId, { parse, onStage });
      if (copy) return copy;
      throw new SiteError(
        'AO3 сейчас недоступен, а сохранённой копии этой работы не нашлось ни на ao3saver, ни в Wayback Machine. ' +
          'Попробуйте позже — статус: status.archiveofourown.org.',
      );
    }
    if (response.url.includes('/users/login')) {
      throw new SiteError('Работа доступна только после входа на AO3.');
    }
    if (response.status === 429) throw new SiteError('AO3 просит подождать: слишком много запросов. Попробуйте через пару минут.');
    if (response.status === 404) throw new SiteError('Работа не найдена: возможно, её удалили или скрыли.');
    if (!response.ok) throw new SiteError(`AO3 ответил ошибкой ${response.status}.`);
    onStage('Разбираю страницу…');
    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
    return parse(doc, url);
  }

  FBS.sites.ao3 = { fetchWork, SiteError };
})();
