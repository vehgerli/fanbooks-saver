// Точка входа во вкладке: узнать сайт → собрать работу → сохранить файл, всё с плашкой прогресса.
(function () {
  const FBS = (globalThis.FBS = globalThis.FBS || {});
  if (FBS.start) return;
  let busy = false;

  /**
   * background — скачивание по ссылке в фоновой вкладке: ход и итог ещё и сообщениями —
   * окошку расширения (показать) и фоновому скрипту (закрыть вкладку или показать её с ошибкой).
   */
  async function start(format, { background = false } = {}) {
    await FBS.loadLanguage();
    const { overlay, platforms, output, sites, t } = FBS;
    const tell = (message) => background && chrome.runtime.sendMessage(message).catch(() => {});
    const working = (text, detail) => {
      overlay.working(text, detail);
      tell({ type: 'bg-progress', text, detail });
    };
    const fail = (text, detail) => {
      overlay.error(text, detail);
      tell({ type: 'bg-done', ok: false, text, detail });
    };
    if (busy) return overlay.working(t('runBusy'));
    const found = platforms.detect(location.href);
    if (!found) return fail(t('runUnsupportedSite'));
    const { platform, workId } = found;
    if (!workId) return fail(t('runOpenWorkPage'), platform.name);
    const site = sites[platform.id];
    if (!platform.ready || !site) return fail(t('runPlatformSoon', platform.name));

    busy = true;
    try {
      const work = await site.fetchWork(workId, (stage, detail) => working(stage, detail ?? platform.name));
      working(t('runBuilding', format.toUpperCase()), work.title);
      const file = output.build(work, format);
      output.save(file);
      const chapters = work.chapters.length;
      // Счётчик для просьбы об оценке; если хранилище недоступно — просто не просим.
      const askRating = await FBS.rating.countDownload().catch(() => false);
      const text = work.copy ? t('runSavedCopy', work.copy) : t('runSaved');
      const detail = t('runSavedDetail', file.name, chapters);
      // Фоновую вкладку никто не видит — оценку попросим при следующем скачивании на виду.
      overlay.done(text, detail, askRating && !background ? { onRate: FBS.rating.rate, onLater: FBS.rating.later } : undefined);
      tell({ type: 'bg-done', ok: true, text, detail });
    } catch (error) {
      const known = error instanceof site.SiteError;
      fail(known ? error.message : t('runFailed'), known ? platform.name : String(error));
      if (!known) console.error('[FanBooks Saver]', error);
    } finally {
      busy = false;
    }
  }

  FBS.start = start;
})();
