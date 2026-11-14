// Сохранение с переводом браузера (только HTML).
// Работу целиком на одной странице показывает только AO3, а браузер переводит лишь то, что видно.
// Поэтому расширение собирает всю работу, как обычный HTML-файл, и показывает её прямо в этой
// вкладке вместо содержимого страницы: адрес остаётся адресом сайта, и браузер предлагает «Перевести».
// Когда перевод начался — прокручивает до конца (перевод идёт по мере прокрутки), вшивает
// картинки, сохраняет файл и возвращает страницу сайта.
//
// Подменяется только содержимое <body>, а <html> и сам <body> остаются прежними: переводчик
// браузера следит за ними. Если страница уже переведена (автоперевод), он переводит и
// появившуюся работу сам; если подменить <html> целиком — он её не видит, а «Перевести»
// уже не нажать («Переведено»).
(function () {
  const FBS = (globalThis.FBS = globalThis.FBS || {});
  if (FBS.translated) return;

  const WAIT_LIMIT = 15 * 60 * 1000; // Столько ждём нажатия «Перевести».
  const MAX_IMAGE = 20 * 1024 * 1024;

  /** Сохранение отменили: крестиком на плашке или новым «Скачать» в этой вкладке. */
  class Cancelled extends Error {}

  let active = null; // Состояние идущего сохранения: { cancelled }.

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // Chrome помечает переведённую страницу классом translated-ltr / translated-rtl у <html>.
  const isTranslated = () => /\btranslated-(ltr|rtl)\b/.test(document.documentElement.className);

  /**
   * Перевод начался — значит, текст работы начал меняться. Пометку ставит только Chrome
   * (Яндекс Браузер и другие — нет). Следим только за узлами самой работы: что скрипты сайта
   * допишут рядом (реклама, баннеры), к переводу отношения не имеет.
   */
  function watchText(nodes) {
    let changed = false;
    const observer = new MutationObserver((records) => {
      if (records.some((r) => r.type === 'characterData' || [...r.addedNodes].some((n) => n.textContent?.trim()))) {
        changed = true;
      }
    });
    for (const node of nodes) observer.observe(node, { subtree: true, childList: true, characterData: true });
    return {
      changed: () => changed,
      stop: () => observer.disconnect(),
    };
  }

  /**
   * Собранная работа вместо содержимого страницы. Стили сайта на это время выключены, у <html>
   * и <body> снимаются их собственные style/class сайта (кроме пометок переводчика у <html>).
   * Возвращает { nodes — узлы работы, restore — вернуть страницу как было }.
   */
  function show(html, lang) {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const root = document.documentElement;
    const body = document.body;
    const scroll = window.scrollY;

    const sheets = [...document.querySelectorAll('link[rel~="stylesheet"], style')].filter((el) => !el.disabled);
    sheets.forEach((el) => (el.disabled = true));
    const style = document.createElement('style');
    style.textContent = [...parsed.querySelectorAll('style')].map((el) => el.textContent).join('\n');
    (document.head || root).appendChild(style);

    const rootStyle = root.getAttribute('style');
    const rootLang = root.getAttribute('lang');
    root.removeAttribute('style');
    // Язык по тексту работы: по нему браузер решает, предлагать ли перевод.
    root.setAttribute('lang', lang);

    const bodyAttrs = [...body.attributes].map((a) => [a.name, a.value]);
    bodyAttrs.forEach(([name]) => body.removeAttribute(name));
    const siteNodes = [...body.childNodes];
    const nodes = [...parsed.body.childNodes].map((n) => document.importNode(n, true));
    body.replaceChildren(...nodes);
    window.scrollTo(0, 0);

    const restore = () => {
      body.replaceChildren(...siteNodes);
      [...body.attributes].forEach((a) => body.removeAttribute(a.name));
      bodyAttrs.forEach(([name, value]) => body.setAttribute(name, value));
      if (rootStyle == null) root.removeAttribute('style');
      else root.setAttribute('style', rootStyle);
      if (rootLang == null) root.removeAttribute('lang');
      else root.setAttribute('lang', rootLang);
      style.remove();
      sheets.forEach((el) => (el.disabled = false));
      window.scrollTo(0, scroll);
    };
    return { nodes: nodes.filter((n) => n.nodeType === Node.ELEMENT_NODE), head: parsed.head.innerHTML, restore };
  }

  async function waitForTranslation(state, text) {
    const until = Date.now() + WAIT_LIMIT;
    while (!isTranslated() && !text.changed()) {
      if (state.cancelled) throw new Cancelled();
      if (Date.now() > until) throw new Error(FBS.t('trTimeout'));
      await sleep(300);
    }
  }

  /** Ждёт, пока переводчик перестанет менять страницу: тишина quietMs, но не дольше maxMs. */
  function settle(quietMs, maxMs) {
    return new Promise((resolve) => {
      let timer = setTimeout(done, quietMs);
      const limit = setTimeout(done, maxMs);
      const observer = new MutationObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(done, quietMs);
      });
      observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
      function done() {
        observer.disconnect();
        clearTimeout(timer);
        clearTimeout(limit);
        resolve();
      }
    });
  }

  /** Прокрутка до конца шагами по 80 % экрана; после каждого шага ждём, пока кусок переведётся. */
  async function scrollThrough(state, progress) {
    const page = document.scrollingElement || document.documentElement;
    let y = 0;
    window.scrollTo(0, 0);
    for (;;) {
      if (state.cancelled) throw new Cancelled();
      const max = Math.max(0, page.scrollHeight - window.innerHeight);
      progress(max ? Math.min(100, Math.round((y / max) * 100)) : 100);
      await settle(500, 4000);
      if (y >= max) break;
      y = Math.min(max, y + Math.round(window.innerHeight * 0.8));
      window.scrollTo(0, y);
    }
  }

  function readAsDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  /** Картинка → data:-адрес. Сначала со страницы; чужой сервер не отдал — через фоновый скрипт. */
  async function imageData(src) {
    try {
      const response = await fetch(src);
      const blob = response.ok ? await response.blob() : null;
      if (blob?.type.startsWith('image/') && blob.size <= MAX_IMAGE) return await readAsDataUrl(blob);
    } catch {
      // Чужой сервер без разрешения на чтение — пробуем ниже.
    }
    const answer = await chrome.runtime.sendMessage({ type: 'fetch-image', url: src }).catch(() => null);
    return answer?.ok ? answer.dataUrl : null;
  }

  /**
   * Файл: шапка собранной работы (её стиль и название) + переведённые узлы работы, картинки внутри.
   * Стили и скрипты сайта в файл не попадают. Видео и аудио — плеером по ссылке.
   */
  async function snapshot(nodes, head, progress) {
    const box = document.createElement('body');
    for (const node of nodes) box.appendChild(node.cloneNode(true));
    box.querySelectorAll('script, fanbooks-saver').forEach((el) => el.remove());
    const images = [...box.querySelectorAll('img[src]')].filter((img) => /^https?:/i.test(img.getAttribute('src')));
    const cache = new Map();
    for (const [index, img] of images.entries()) {
      progress(index + 1, images.length);
      const src = img.getAttribute('src');
      if (!cache.has(src)) cache.set(src, await imageData(src));
      // Не скачалась — остаётся ссылкой: покажется, пока есть сеть.
      if (cache.get(src)) img.setAttribute('src', cache.get(src));
    }
    return `<!DOCTYPE html>\n<html>\n<head>${head}</head>\n${box.outerHTML}\n</html>\n`;
  }

  /**
   * file — собранный HTML (output.build). working(text, detail, onClose) — плашка.
   * Возвращает имя сохранённого файла; Cancelled — сохранение отменили.
   */
  async function run(work, file, working) {
    const { t } = FBS;
    const state = { cancelled: false };
    active = state;
    const cancelByUser = () => (state.cancelled = true);
    const shown = show(await file.blob.text(), FBS.epub.language(work));
    try {
      // Уже переведено в Chrome (автоперевод) — работу он переведёт сам, ждать нажатия не нужно.
      // В других браузерах пометки нет: там ждём, пока начнёт меняться текст работы.
      if (!isTranslated()) {
        working(t('trPressTranslate'), t('trPressTranslateDetail'), cancelByUser);
        const text = watchText(shown.nodes);
        try {
          await waitForTranslation(state, text);
        } finally {
          text.stop();
        }
      }
      await scrollThrough(state, (percent) => working(t('trScrolling'), t('trPercent', percent), cancelByUser));
      window.scrollTo(0, 0);
      const html = await snapshot(shown.nodes, shown.head, (done, total) => working(t('trImages', done, total), work.title));
      if (state.cancelled) throw new Cancelled();
      const name = file.name.replace(/\.html$/, ` (${t('trFileSuffix')}).html`);
      FBS.output.save({ name, blob: new Blob([html], { type: 'text/html;charset=utf-8' }) });
      return name;
    } finally {
      shown.restore();
      if (active === state) active = null;
    }
  }

  /** Новое «Скачать» в этой вкладке: отменить идущее сохранение с переводом. true — было что отменять. */
  function cancel() {
    if (!active) return false;
    active.cancelled = true;
    return true;
  }

  FBS.translated = { run, cancel, Cancelled };
})();
