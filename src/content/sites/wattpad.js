// Wattpad: страницы сайта собираются скриптами, поэтому берём данные из его же API:
//   /api/v3/stories/<id>      — шапка и список глав;
//   /api/v3/story_parts/<id>  — к какой работе относится глава (если открыта страница главы);
//   /apiv2/?m=storytext       — текст главы готовым HTML, длинные главы — несколькими страницами.
// Запросы идут с сайта, со входом пользователя, поэтому видны и работы 18+, и его собственные.
(function () {
  const FBS = (globalThis.FBS = globalThis.FBS || {});
  FBS.sites = FBS.sites || {};
  if (FBS.sites.wattpad) return;
  const { t } = FBS;
  const { fetchRetry, SiteError, sleep } = FBS.net;

  const PAUSE_MS = 500;
  const STORY_FIELDS =
    'id,title,url,description,completed,mature,tags,numParts,language(name),user(name,username),' +
    'parts(id,title,pages,draft,deleted)';

  function parseJson(text) {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  async function load(path, onStage, stage, { json = false } = {}) {
    const response = await fetchRetry(path, { onStage, stage });
    if (response.status === 429) throw new SiteError(t('errRateLimited'));
    if (response.status === 404) throw new SiteError(t('errNotFound'));
    if (!response.ok) {
      // Удалённая или скрытая работа (глава): API отвечает 400 и error_type «NotFound».
      if (parseJson(response.text)?.error_type === 'NotFound') throw new SiteError(t('errNotFound'));
      throw new SiteError(t('errSiteStatus', 'Wattpad', response.status));
    }
    if (!json) return response.text;
    const data = parseJson(response.text);
    if (!data) throw new SiteError(t('errLayout'));
    return data;
  }

  /** Текст главы: склеиваем все её страницы в один элемент. */
  async function loadPartText(part, onStage, stage) {
    const box = document.createElement('div');
    const pages = Math.max(1, part.pages || 1);
    for (let page = 1; page <= pages; page++) {
      if (page > 1) await sleep(PAUSE_MS);
      const html = await load(`/apiv2/?m=storytext&id=${part.id}&page=${page}`, onStage, stage);
      const doc = new DOMParser().parseFromString(html, 'text/html');
      box.append(...doc.body.childNodes);
    }
    return box.textContent.trim() ? box : null;
  }

  /** Описание — простой текст с переносами строк. */
  function textBlock(text) {
    const el = document.createElement('div');
    el.textContent = text;
    return el;
  }

  function readMeta(story) {
    return [
      { label: 'Language:', value: story.language?.name },
      { label: 'Rating:', value: story.mature ? 'Mature' : '' },
      { label: 'Status:', value: story.completed ? 'Completed' : 'Ongoing' },
      { label: 'Parts:', value: String(story.numParts ?? story.parts.length) },
      { label: 'Tags:', value: (story.tags ?? []).join(', ') },
    ].filter((m) => m.value);
  }

  async function fetchWork(workId, onStage) {
    // У главы и работы адреса разные (/story/<id>-… и /<id>-…), а номер — просто число,
    // поэтому, что именно открыто, смотрим по адресу вкладки: скачивание всегда идёт из неё.
    let storyId = workId;
    if (!location.pathname.startsWith('/story/')) {
      const part = await load(`/api/v3/story_parts/${workId}?fields=groupId`, onStage, t('stageHeader'), {
        json: true,
      });
      storyId = part.groupId;
      if (!storyId) throw new SiteError(t('errLayout'));
    }

    const story = await load(`/api/v3/stories/${storyId}?fields=${STORY_FIELDS}`, onStage, t('stageHeader'), {
      json: true,
    });
    if (!story?.title || !Array.isArray(story.parts)) throw new SiteError(t('errLayout'));
    const parts = story.parts.filter((p) => !p.draft && !p.deleted);
    if (!parts.length) throw new SiteError(t('errNoText'));

    const chapters = [];
    for (const [index, part] of parts.entries()) {
      if (index > 0) await sleep(PAUSE_MS);
      const body = await loadPartText(part, onStage, t('stageChapter', index + 1, parts.length));
      if (!body) throw new SiteError(t('errNoChapterText', index + 1));
      chapters.push({ title: part.title || '', preface: [], body, endNotes: [] });
    }

    const description = (story.description ?? '').trim();
    return {
      site: 'Wattpad',
      url: story.url || `${location.origin}/story/${storyId}`,
      title: story.title,
      // Логин, как его показывает сам сайт. user.name у работы бывает устаревшим: автор сменил
      // или стёр имя в профиле, а в работе осталось старое (было «ren !!» вместо justrenwilldo).
      authors: [story.user?.username || story.user?.name].filter(Boolean),
      meta: readMeta(story),
      preface: description ? [{ heading: 'Summary:', el: textBlock(description), lines: true }] : [],
      chapters,
      endNotes: [],
    };
  }

  FBS.sites.wattpad = { fetchWork, SiteError };
})();
