// AO3: работа целиком на одной странице (режим «Entire Work»), поэтому нужен один запрос.
(function () {
  const FBS = (globalThis.FBS = globalThis.FBS || {});
  FBS.sites = FBS.sites || {};
  if (FBS.sites.ao3) return;
  const { line, toHtml } = FBS.clean;
  const { t } = FBS;
  const { fetchRetry, SiteError } = FBS.net;

  // Из статистики в файл идёт то же, что в выгрузке самого AO3: без комментариев, кудосов и просмотров.
  const FILE_STATS = new Set(['Published:', 'Updated:', 'Completed:', 'Words:', 'Chapters:']);

  /**
   * Значение поля шапки: { value } — текстом (теги через запятую, статистика парами «подпись значение»),
   * html — как в выгрузке AO3: теги ссылками через запятую.
   */
  function metaValue(dd, base) {
    const stats = dd.querySelector('dl');
    if (stats) {
      const value = [...stats.querySelectorAll('dt')]
        .filter((dt) => FILE_STATS.has(line(dt)))
        .map((dt) => `${line(dt)} ${line(dt.nextElementSibling)}`)
        .join(' ');
      return { value };
    }
    const items = [...dd.querySelectorAll('li')].filter((li) => line(li));
    if (items.length) {
      return { value: items.map(line).join(', '), html: items.map((li) => toHtml(li, base)).join(', ') };
    }
    return { value: line(dd), html: toHtml(dd, base) };
  }

  function readMeta(doc, base) {
    const dl = doc.querySelector('dl.work.meta');
    if (!dl) return [];
    return [...dl.querySelectorAll(':scope > dt')]
      .map((dt) => ({ label: line(dt), ...metaValue(dt.nextElementSibling, base) }))
      .filter((m) => m.label && m.value);
  }

  /**
   * Блоки «Summary» / «Notes» / «End Notes»: подпись и текст автора.
   * Подписи — как в выгрузке AO3: «Summary», «Notes», «End Notes», у глав — с «Chapter» впереди.
   */
  function readModules(root, selector, prefix = '') {
    if (!root) return [];
    return [...root.querySelectorAll(selector)]
      .map((module) => {
        const el = module.querySelector('blockquote.userstuff, .userstuff');
        if (!el) return null;
        el.querySelectorAll('p.jump').forEach((p) => p.remove());
        const kind = module.matches('.summary') ? 'Summary' : module.matches('.end, #work_endnotes') ? 'End Notes' : 'Notes';
        return { heading: prefix + kind, el };
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
          preface: readModules(head, ':scope > .summary, :scope > .notes:not(.end)', 'Chapter '),
          body,
          endNotes: readModules(chapter, ':scope > .preface .end.notes, :scope > .end.notes', 'Chapter '),
        };
      })
      .filter(Boolean);
  }

  function parse(doc, url) {
    const title = line(doc.querySelector('h2.title.heading'));
    const chapters = readChapters(doc);
    if (!title || !chapters.length) {
      throw new SiteError(t('errNoText'));
    }
    const byline = doc.querySelector('h3.byline');
    const links = byline ? [...byline.querySelectorAll('a[rel="author"]')] : [];
    const authorLinks = links.length
      ? links.map((a) => ({ name: line(a), url: new URL(a.getAttribute('href'), url).href }))
      : byline && line(byline)
        ? [{ name: line(byline) }]
        : [];
    const preface = doc.querySelector('#workskin > .preface');
    return {
      site: 'AO3',
      layout: 'ao3',
      url,
      title,
      authors: authorLinks.map((a) => a.name).filter(Boolean),
      authorLinks,
      meta: readMeta(doc, url),
      preface: readModules(preface, ':scope > .summary, :scope > .notes:not(.end)'),
      chapters,
      endNotes: readModules(doc, '#work_endnotes'),
    };
  }

  async function fetchWork(workId, onStage) {
    const origin = location.origin;
    const url = `${origin}/works/${workId}`;
    // view_adult=true — та же ссылка, что кнопка «Proceed» в предупреждении о взрослом содержании.
    // При 429 подождём, при обрыве и 5xx повторим (net.js); не помогло — ищем копию в архивах.
    let response;
    try {
      response = await fetchRetry(`${url}?view_full_work=true&view_adult=true`, {
        onStage,
        stage: t('stageAo3Full'),
      });
    } catch {
      response = null;
    }
    // На время техработ AO3 отвечает 418, при перегрузке — 502/503: тогда ищем сохранённую копию.
    if (!response || [418, 502, 503].includes(response.status)) {
      const copy = await FBS.ao3Archives.fetchCopy(workId, { parse, onStage });
      if (copy) return copy;
      throw new SiteError(t('errAo3Down'));
    }
    if (response.url.includes('/users/login')) {
      throw new SiteError(t('errLogin', 'AO3'));
    }
    if (response.status === 429) throw new SiteError(t('errRateLimited'));
    if (response.status === 404) throw new SiteError(t('errNotFound'));
    if (!response.ok) throw new SiteError(t('errSiteStatus', 'AO3', response.status));
    onStage(t('stageParsing'));
    const doc = new DOMParser().parseFromString(response.text, 'text/html');
    return parse(doc, url);
  }

  FBS.sites.ao3 = { fetchWork, SiteError };
})();
