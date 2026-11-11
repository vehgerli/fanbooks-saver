// Просьба оценить расширение в магазине: после 3-го удачного скачивания, в плашке.
// «Не сейчас» — спросим ещё раз через 20 скачиваний; после второго «Не сейчас» или «Оценить» — больше никогда.
// Всё хранится только в браузере (storage): счётчик скачиваний и ответ на просьбу.
(function () {
  const FBS = (globalThis.FBS = globalThis.FBS || {});
  if (FBS.rating) return;

  const FIRST_ASK = 3;
  const ASK_AGAIN_AFTER = 20;
  const MAX_LATER = 2;
  const DEFAULTS = { rateDownloads: 0, rateNextAt: FIRST_ASK, rateLater: 0, rateDone: false };

  const read = () => chrome.storage.local.get(DEFAULTS);

  /** Учитывает удачное скачивание; true — пора попросить оценку. */
  async function countDownload() {
    const state = await read();
    const downloads = state.rateDownloads + 1;
    await chrome.storage.local.set({ rateDownloads: downloads });
    return !state.rateDone && downloads >= state.rateNextAt;
  }

  /** Открывает страницу отзывов; больше не просим. */
  async function rate() {
    window.open(FBS.reviewsUrl(), '_blank', 'noopener');
    await chrome.storage.local.set({ rateDone: true });
  }

  async function later() {
    const state = await read();
    const times = state.rateLater + 1;
    await chrome.storage.local.set({
      rateLater: times,
      rateNextAt: state.rateDownloads + ASK_AGAIN_AFTER,
      rateDone: times >= MAX_LATER,
    });
  }

  FBS.rating = { countDownload, rate, later };
})();
