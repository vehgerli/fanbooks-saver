// AO3 недоступен (техработы, перегрузка) — берём сохранённую копию работы из архивов:
//   ao3saver.com — копии файла «Download → HTML» самого AO3, обычно со всеми главами;
//   Wayback Machine — сохранённые страницы AO3, часто старые или только с первой главой.
// Архивы читает фоновый скрипт: со страницы сайта чужие адреса браузер не отдаёт.
(function () {
  const FBS = (globalThis.FBS = globalThis.FBS || {});
  if (FBS.ao3Archives) return;
  const { line, toHtml } = FBS.clean;
  const { t } = FBS;

  async function get(url) {
    const response = await chrome.runtime.sendMessage({ type: 'fetch-archive', url });
    if (!response?.ok) throw new Error(response?.error || t('errArchiveNoAnswer'));
    return response;
  }

  const parseHtml = (text) => new DOMParser().parseFromString(text, 'text/html');

  /** Пары «<p>Summary</p><blockquote class="userstuff">» внутри блока выгрузки. */
  function readNotes(root) {
    if (!root) return [];
    return [...root.querySelectorAll(':scope > blockquote.userstuff, :scope > div > blockquote.userstuff')]
      .map((el) => {
        const label = line(el.previousElementSibling?.localName === 'p' ? el.previousElementSibling : null);
        // Подпись как в самой выгрузке: «Summary», «Chapter Notes», «End Notes».
        return { heading: label, el };
      })
      .filter((s) => s.el.textContent.trim());
  }

  /** Файл «Download → HTML» AO3: шапка в #preface, главы в #chapters, конец в #afterword. */
  function parseDownload(doc, url) {
    const preface = doc.querySelector('#preface .meta');
    const title = line(preface?.querySelector('h1'));
    const box = doc.querySelector('#chapters');
    if (!title || !box) return null;

    const meta = [...preface.querySelectorAll('dl.tags > dt')]
      .map((dt) => {
        const dd = dt.nextElementSibling;
        // У тегов — ссылки, как в выгрузке; статистику и язык хватит текстом.
        return { label: line(dt), value: line(dd), html: dd?.querySelector('a') ? toHtml(dd, url) : undefined };
      })
      .filter((m) => m.label && m.value);
    const byline = preface.querySelector('.byline');
    const links = byline ? [...byline.querySelectorAll('a[rel="author"]')] : [];
    const authorLinks = links.length
      ? links.map((a) => ({ name: line(a), url: new URL(a.getAttribute('href'), url).href }))
      : [{ name: line(byline).replace(/^by\s+/, '') }];

    // Глава: заголовок и примечания в .meta.group, текст в следующем .userstuff,
    // примечания в конце — в .meta с id endnotesN.
    const chapters = [];
    for (const el of box.children) {
      if (el.matches('.meta.group')) {
        chapters.push({ title: line(el.querySelector('h2.heading')), preface: readNotes(el), body: null, endNotes: [] });
      } else if (el.matches('.userstuff') && chapters.length && !chapters.at(-1).body) {
        chapters.at(-1).body = el;
      } else if (el.matches('.meta[id^="endnotes"]') && chapters.length) {
        chapters.at(-1).endNotes = readNotes(el);
      }
    }
    // Работа из одной главы: текст лежит прямо в #chapters (рядом — скрытый заголовок для оглавления).
    if (!chapters.length && box.textContent.trim()) {
      chapters.push({ title: '', preface: [], body: box.querySelector(':scope > .userstuff') ?? box, endNotes: [] });
    }
    const full = chapters.filter((c) => c.body);
    if (!full.length) return null;

    return {
      site: 'AO3',
      layout: 'ao3',
      url,
      title,
      authors: authorLinks.map((a) => a.name).filter(Boolean),
      authorLinks,
      meta,
      preface: readNotes(preface),
      chapters: full,
      endNotes: readNotes(doc.querySelector('#afterword #endnotes')),
    };
  }

  async function fromAo3saver(workId) {
    const response = await get(`https://ao3saver.com/works/${workId}`);
    if (response.status !== 200) return null;
    const work = parseDownload(parseHtml(response.text), `https://archiveofourown.org/works/${workId}`);
    if (!work) return null;
    work.copy = t('copyAo3saver');
    work.meta.unshift({ label: t('copyLabel'), value: `${work.copy} — ${response.url}` });
    return work;
  }

  /** «20240825192112» → «25.08.2024». */
  const waybackDate = (ts) => `${ts.slice(6, 8)}.${ts.slice(4, 6)}.${ts.slice(0, 4)}`;

  async function fromWayback(workId, parse) {
    // Сначала адреса, где работа целиком и без предупреждения о взрослом содержании.
    const candidates = [
      `archiveofourown.org/works/${workId}?view_adult=true&view_full_work=true`,
      `archiveofourown.org/works/${workId}?view_full_work=true&view_adult=true`,
      `archiveofourown.org/works/${workId}?view_full_work=true`,
      `archiveofourown.org/works/${workId}?view_adult=true`,
      `archiveofourown.org/works/${workId}`,
    ];
    for (const candidate of candidates) {
      const found = await get(`https://archive.org/wayback/available?url=${encodeURIComponent(candidate)}`);
      const snapshot = JSON.parse(found.text || '{}').archived_snapshots?.closest;
      if (!snapshot?.available) continue;
      // id_ — страница как её сохранили, без панели Wayback Machine.
      const original = snapshot.url.replace(/^https?:\/\/web\.archive\.org\/web\/\d+\//, '');
      const page = await get(`https://web.archive.org/web/${snapshot.timestamp}id_/${original}`);
      if (page.status !== 200) continue;
      let work;
      try {
        // Вместо работы мог сохраниться вход на сайт или предупреждение — тогда пробуем дальше.
        work = parse(parseHtml(page.text), `https://archiveofourown.org/works/${workId}`);
      } catch {
        continue;
      }
      const date = waybackDate(snapshot.timestamp);
      work.copy = candidate.includes('view_full_work') ? t('copyWayback', date) : t('copyWaybackPartial', date);
      work.meta.unshift({
        label: t('copyLabel'),
        value: `${work.copy} — https://web.archive.org/web/${snapshot.timestamp}/${original}`,
      });
      return work;
    }
    return null;
  }

  /** Копия работы из архивов или null, если её нигде нет. */
  async function fetchCopy(workId, { parse, onStage }) {
    onStage(t('stageAo3saver'));
    const saved = await fromAo3saver(workId).catch(() => null);
    if (saved) return saved;
    onStage(t('stageWayback'));
    return fromWayback(workId, parse).catch(() => null);
  }

  FBS.ao3Archives = { fetchCopy };
})();
