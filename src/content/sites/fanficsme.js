// Fanfics.me: шапка — на странице работы (/fic<id>), а страница чтения без номера главы
// (/read.php?id=<id>) отдаёт сразу все главы. Поэтому нужно всего два запроса.
(function () {
  const FBS = (globalThis.FBS = globalThis.FBS || {});
  FBS.sites = FBS.sites || {};
  if (FBS.sites.fanficsme) return;
  const { line } = FBS.clean;
  const { t } = FBS;

  class SiteError extends Error {}

  const RETRY_WAITS_S = [20, 40, 60];
  // Эти поля шапки — текст автора, они идут отдельными разделами, а не строкой в шапке.
  const SECTION_LABELS = new Set(['От автора:']);
  const AUTHOR_LABELS = new Set(['Автор:', 'Авторы:', 'Соавтор:', 'Соавторы:']);

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function load(path, onStage, stage) {
    for (let attempt = 0; ; attempt++) {
      onStage(stage);
      const response = await fetch(path, { credentials: 'include' });
      if (response.status === 429 && attempt < RETRY_WAITS_S.length) {
        for (let left = RETRY_WAITS_S[attempt]; left > 0; left--) {
          onStage(stage, t('stageWait', left));
          await sleep(1000);
        }
        continue;
      }
      if (response.status === 429) throw new SiteError(t('errRateLimited'));
      if (response.status === 404) throw new SiteError(t('errNotFound'));
      if (!response.ok) throw new SiteError(t('errSiteStatus', 'Fanfics.me', response.status));
      return new DOMParser().parseFromString(await response.text(), 'text/html');
    }
  }

  /** Значение строки шапки: ссылки через запятую, иначе текст. */
  function rowValue(content) {
    const size = content.querySelector('.ModalLink_value');
    if (size) return line(size); // «Макси | 2 135 764 знака» без всплывающего меню других единиц.
    content.querySelectorAll('.AjaxToModal').forEach((a) => a.remove()); // «Показать подробно»
    const links = [...content.querySelectorAll('a')].filter((a) => line(a));
    if (links.length > 1) return links.map(line).join(', ');
    return line(content);
  }

  function readHead(doc) {
    const meta = [];
    const preface = [];
    const authors = [];
    for (const row of doc.querySelectorAll('.FicHead .tr')) {
      const label = line(row.querySelector(':scope > .title'));
      const content = row.querySelector(':scope > .content');
      if (!content) continue;
      if (!label) {
        // Подписи нет у даты публикации и у отметок сайта («Проверено на грамотность») — берём только дату.
        const dates = line(content.querySelector('.DateUpdate'));
        if (dates) meta.push({ label: 'Опубликовано:', value: dates });
        continue;
      }
      if (AUTHOR_LABELS.has(label)) {
        const names = [...content.querySelectorAll('a.user')].map(line).filter(Boolean);
        authors.push(...(names.length ? names : [line(content)]));
      } else if (SECTION_LABELS.has(label)) {
        if (content.textContent.trim()) preface.push({ heading: label, el: content });
      } else {
        const value = rowValue(content);
        if (value) meta.push({ label, value });
      }
    }
    return { meta, preface, authors: authors.filter(Boolean) };
  }

  /** Все главы со страницы чтения: заголовок <h2>, за ним текст в .chapter. */
  function readChapters(doc) {
    return [...doc.querySelectorAll('.ReadContent > .chapter')]
      .map((body) => {
        const head = body.previousElementSibling;
        return { title: head?.localName === 'h2' ? line(head) : '', preface: [], body, endNotes: [] };
      })
      .filter((c) => c.body.textContent.trim());
  }

  async function fetchWork(workId, onStage) {
    const url = `${location.origin}/fic${workId}`;
    const doc = await load(`/fic${workId}`, onStage, t('stageHeader'));
    const h1 = doc.querySelector('.FicHead h1');
    if (!h1) throw new SiteError(t('errLayout'));
    // В заголовке рядом с названием — направленность: «Название (гет)».
    const direction = line(h1.querySelector('span')).replace(/^\((.*)\)$/, '$1');
    h1.querySelector('span')?.remove();
    const title = line(h1);
    if (!title) throw new SiteError(t('errLayout'));

    const { meta, preface, authors } = readHead(doc);
    if (direction) meta.unshift({ label: 'Направленность:', value: direction });
    const summary = doc.querySelector(`#summary_${workId}, .summary_text_fic3`);
    if (summary?.textContent.trim()) preface.unshift({ heading: 'Описание:', el: summary });

    const readDoc = await load(`/read.php?id=${workId}`, onStage, t('stageParsing'));
    const chapters = readChapters(readDoc);
    if (!chapters.length) throw new SiteError(t('errNoText'));
    // У работы из одной главы заголовок главы обычно повторяет название — он не нужен.
    if (chapters.length === 1 && chapters[0].title === title) chapters[0].title = '';

    return {
      site: 'Fanfics.me',
      url,
      title,
      authors,
      meta,
      preface,
      chapters,
      endNotes: [],
    };
  }

  FBS.sites.fanficsme = { fetchWork, SiteError };
})();
