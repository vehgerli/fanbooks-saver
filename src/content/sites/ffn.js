// FanFiction.net: шапка — на странице первой главы, каждая глава — отдельной страницей.
// Сайт стоит за Cloudflare и не любит частые запросы, поэтому главы грузим по одной с паузой,
// а при ограничении (ответ 429) ждём и повторяем (см. net.js).
(function () {
  const FBS = (globalThis.FBS = globalThis.FBS || {});
  FBS.sites = FBS.sites || {};
  if (FBS.sites.ffn) return;
  const { line } = FBS.clean;
  const { t } = FBS;
  const { fetchRetry, SiteError, sleep } = FBS.net;

  const PAUSE_MS = 1500;
  // Поля строки статистики, которые в файле не нужны.
  const SKIP_LABELS = new Set(['id', 'Reviews']);

  async function load(path, onStage, stage) {
    const response = await fetchRetry(path, { onStage, stage });
    if (response.status === 429) throw new SiteError(t('errRateLimited'));
    if (response.status === 403) throw new SiteError(t('errCloudflare'));
    if (!response.ok) throw new SiteError(t('errSiteStatus', 'FanFiction.net', response.status));
    return new DOMParser().parseFromString(response.text, 'text/html');
  }

  /**
   * Строка «Rated: M - Spanish - Humor/Adventure - Jon S. - Chapters: 2 - Words: …».
   * Поля с подписью идут как есть; без подписи — язык, затем жанр и персонажи.
   */
  function readStats(top) {
    const stats = top.querySelector('span.xgray');
    if (!stats) return [];
    const meta = [];
    const unlabeled = [];
    for (const part of line(stats).split(' - ')) {
      const match = part.match(/^([\w ]+):\s*(.+)$/);
      if (!match) {
        if (part) unlabeled.push(part);
      } else if (!SKIP_LABELS.has(match[1])) {
        meta.push({ label: match[1] + ':', value: match[2].replace(/^Fiction\s+/, '') });
      }
    }
    const [language, ...rest] = unlabeled;
    if (rest.length) meta.splice(1, 0, { label: 'Genre / Characters:', value: rest.join(' · ') });
    if (language) meta.splice(1, 0, { label: 'Language:', value: language });
    return meta;
  }

  function readBody(doc) {
    const body = doc.querySelector('#storytext');
    return body && body.textContent.trim() ? body : null;
  }

  async function fetchWork(workId, onStage) {
    const url = `${location.origin}/s/${workId}/1/`;
    const doc = await load(`/s/${workId}/1/`, onStage, t('stageFirstChapter'));
    const top = doc.querySelector('#profile_top');
    const title = line(top?.querySelector('b.xcontrast_txt'));
    if (!title) {
      // Удалённая работа отдаёт страницу с сообщением вместо шапки.
      if (doc.querySelector('.panel_warning, #content_wrapper_inner .gui_warning')) {
        throw new SiteError(t('errNotFound'));
      }
      throw new SiteError(t('errLayout'));
    }

    const authors = [...top.querySelectorAll('a.xcontrast_txt[href^="/u/"]')].map(line).filter(Boolean);
    const fandom = line([...doc.querySelectorAll('#pre_story_links a')].pop());
    const summary = top.querySelector(':scope > div.xcontrast_txt');
    const meta = [...(fandom ? [{ label: 'Fandom:', value: fandom }] : []), ...readStats(top)];

    // Список глав есть, только если их больше одной; он стоит дважды — над текстом и под ним.
    // «1. Chapter 1» → «Chapter 1».
    const options = [...(doc.querySelector('#chap_select')?.options ?? [])];
    const titles = options.length ? options.map((o) => line(o).replace(/^\d+\.\s*/, '')) : [''];
    const unique = options.length ? options.map((o) => o.value) : ['1'];

    const chapters = [];
    for (const [index, number] of unique.entries()) {
      let chapterDoc = doc;
      if (index > 0) {
        await sleep(PAUSE_MS);
        chapterDoc = await load(`/s/${workId}/${number}/`, onStage, t('stageChapter', index + 1, unique.length));
      }
      const body = readBody(chapterDoc);
      if (!body) throw new SiteError(t('errNoChapterText', index + 1));
      chapters.push({ title: titles[index], preface: [], body, endNotes: [] });
    }

    return {
      site: 'FanFiction.net',
      url,
      title,
      authors,
      meta,
      preface: summary && summary.textContent.trim() ? [{ heading: 'Summary:', el: summary }] : [],
      chapters,
      endNotes: [],
    };
  }

  FBS.sites.ffn = { fetchWork, SiteError };
})();
