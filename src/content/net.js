// Запросы к сайту с повторами — общие для всех разборщиков.
//   • Сайт ограничил запросы (429) — ждём 20, 40, 60 с и повторяем.
//   • Нет связи, обрыв посреди ответа или ошибка сервера (5xx) — повторяем через 3 и 10 с.
// Повторяется только этот один запрос: уже загруженные главы не теряются.
// Если повторы не помогли, отдаём последний ответ — что с ним делать, решает разборщик сайта.
(function () {
  const FBS = (globalThis.FBS = globalThis.FBS || {});
  if (FBS.net) return;
  const { t } = FBS;

  /** Ошибка, понятная пользователю: её текст показывается в плашке как есть. */
  class SiteError extends Error {}

  const RATE_LIMIT_WAITS_S = [20, 40, 60];
  const FAILURE_WAITS_S = [3, 10];
  const SERVER_ERRORS = new Set([500, 502, 503, 504]);

  const timer = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  // В скрытой вкладке (скачивание по ссылке) Chrome через 5 минут будит таймеры страницы раз в минуту —
  // паузы между главами растянулись бы на часы. Поэтому там ждём в фоновом скрипте, его таймеры не тормозят.
  const sleep = (ms) =>
    document.hidden ? chrome.runtime.sendMessage({ type: 'sleep', ms }).catch(() => timer(ms)) : timer(ms);

  async function countdown(seconds, onStage, stage, message) {
    for (let left = seconds; left > 0; left--) {
      onStage(stage, t(message, left));
      await sleep(1000);
    }
  }

  /**
   * Загружает адрес со входом пользователя; ответ — { status, ok, url, text } с уже прочитанным текстом,
   * чтобы обрыв посреди ответа тоже повторялся. Без связи после всех повторов — SiteError «Нет связи».
   */
  async function fetchRetry(path, { onStage = () => {}, stage = '' } = {}) {
    let rateLimited = 0;
    let failed = 0;
    for (;;) {
      onStage(stage);
      let result;
      try {
        const response = await fetch(path, { credentials: 'include' });
        result = { status: response.status, ok: response.ok, url: response.url, text: await response.text() };
      } catch {
        if (failed < FAILURE_WAITS_S.length) {
          await countdown(FAILURE_WAITS_S[failed++], onStage, stage, 'stageRetry');
          continue;
        }
        throw new SiteError(t('errNetwork'));
      }
      if (result.status === 429 && rateLimited < RATE_LIMIT_WAITS_S.length) {
        await countdown(RATE_LIMIT_WAITS_S[rateLimited++], onStage, stage, 'stageWait');
        continue;
      }
      if (SERVER_ERRORS.has(result.status) && failed < FAILURE_WAITS_S.length) {
        await countdown(FAILURE_WAITS_S[failed++], onStage, stage, 'stageRetry');
        continue;
      }
      return result;
    }
  }

  FBS.net = { fetchRetry, SiteError, sleep };
})();
