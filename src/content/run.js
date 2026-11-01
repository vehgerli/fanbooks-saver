// Точка входа во вкладке: узнать сайт → собрать работу → сохранить файл, всё с плашкой прогресса.
(function () {
  const FBS = (globalThis.FBS = globalThis.FBS || {});
  if (FBS.start) return;
  let busy = false;

  async function start(format) {
    await FBS.loadLanguage();
    const { overlay, platforms, output, sites, t } = FBS;
    if (busy) return overlay.working(t('runBusy'));
    const found = platforms.detect(location.href);
    if (!found) return overlay.error(t('runUnsupportedSite'));
    const { platform, workId } = found;
    if (!workId) return overlay.error(t('runOpenWorkPage'), platform.name);
    const site = sites[platform.id];
    if (!platform.ready || !site) return overlay.error(t('runPlatformSoon', platform.name));

    busy = true;
    try {
      const work = await site.fetchWork(workId, (stage, detail) =>
        overlay.working(stage, detail ?? platform.name),
      );
      overlay.working(t('runBuilding', format.toUpperCase()), work.title);
      const file = output.build(work, format);
      output.save(file);
      const chapters = work.chapters.length;
      overlay.done(work.copy ? t('runSavedCopy', work.copy) : t('runSaved'), t('runSavedDetail', file.name, chapters));
    } catch (error) {
      const known = error instanceof site.SiteError;
      overlay.error(known ? error.message : t('runFailed'), known ? platform.name : String(error));
      if (!known) console.error('[FanBooks Saver]', error);
    } finally {
      busy = false;
    }
  }

  FBS.start = start;
})();
