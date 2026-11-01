// Точка входа во вкладке: узнать сайт → собрать работу → сохранить файл, всё с плашкой прогресса.
(function () {
  const FBS = (globalThis.FBS = globalThis.FBS || {});
  if (FBS.start) return;
  let busy = false;

  async function start(format) {
    const { overlay, platforms, output, sites } = FBS;
    if (busy) return overlay.working('Работа уже скачивается…');
    const found = platforms.detect(location.href);
    if (!found) return overlay.error('Этот сайт не поддерживается.');
    const { platform, workId } = found;
    if (!workId) return overlay.error('Откройте страницу самой работы.', platform.name);
    const site = sites[platform.id];
    if (!platform.ready || !site) return overlay.error(`${platform.name} пока не поддерживается — скоро будет.`);

    busy = true;
    try {
      const work = await site.fetchWork(workId, (stage, detail) =>
        overlay.working(stage, detail ?? platform.name),
      );
      overlay.working(`Собираю ${format.toUpperCase()}…`, work.title);
      const file = output.build(work, format);
      output.save(file);
      const chapters = work.chapters.length;
      overlay.done('Файл сохранён в «Загрузки».', `${file.name} · глав: ${chapters}`);
    } catch (error) {
      const known = error instanceof site.SiteError;
      overlay.error(known ? error.message : 'Не получилось скачать работу.', known ? platform.name : String(error));
      if (!known) console.error('[FanBooks Saver]', error);
    } finally {
      busy = false;
    }
  }

  FBS.start = start;
})();
