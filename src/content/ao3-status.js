// AO3: «Мой статус» у каждой работы — в списках (поиск, теги, закладки, страницы авторов)
// и на странице самой работы: Прочитано / Читаю / Прочитано, скачано / Читаю, скачано / Скачана.
// Вид — маленькая плашка справа («+ Статус», если статуса нет); по нажатию — меню с вариантами.
// Ставится вручную; после скачивания через расширение к статусу добавляется «скачано» (run.js).
// Хранится в браузере (storage.local) под ключом «ao3:<номер работы>»:
//   { s: статус, title: название, at: когда поставлен, upd: дата обновления работы на тот момент };
//   «Без статуса» — ключ удаляется. Если работа с тех пор обновилась — рядом надпись «Есть обновление!».
// Подключается сам на страницах AO3 (content_scripts в манифесте) и ничего не отправляет.
(function () {
  const FBS = (globalThis.FBS = globalThis.FBS || {});
  if (FBS.ao3Status) return;
  FBS.ao3Status = true;

  // Порядок в меню — как в списке у пользователя. kind — цвет и значок плашки, dl — «· ↓» после слова.
  const STATUSES = {
    read: { label: 'statusRead', kind: 'read', dl: false },
    reading: { label: 'statusReading', kind: 'reading', dl: false },
    readDl: { label: 'statusReadDl', kind: 'read', dl: true },
    readingDl: { label: 'statusReadingDl', kind: 'reading', dl: true },
    dl: { label: 'statusDl', kind: 'dl', dl: false },
  };
  const key = (id) => `ao3:${id}`;
  const boxes = []; // { id, title, upd, el, flag, badge, menu, status, saved }
  const MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };

  const CSS = `
    .fbs-st { position: relative; float: right; clear: right; margin: 0 0 .3em .6em; z-index: 5;
      font: 12px/1.4 'Lucida Grande', 'Lucida Sans Unicode', Verdana, Helvetica, sans-serif; }
    .fbs-st-badge { display: inline-block; padding: 1px 8px; border: 1px solid #c8c8c8; border-radius: 3px;
      background: #fff; color: #777; cursor: pointer; white-space: nowrap; user-select: none; }
    .fbs-st-badge:hover, .fbs-st-badge:focus { border-color: #900; color: #900; outline: none; }
    .fbs-st[data-kind="reading"] .fbs-st-badge { background: #e6f0fa; border-color: #2f6fb5; color: #1f4f85; }
    .fbs-st[data-kind="read"] .fbs-st-badge { background: #e9f4e6; border-color: #3b8a3b; color: #2b6a2b; }
    .fbs-st[data-kind="dl"] .fbs-st-badge { background: #f1ebf7; border-color: #7a4fa3; color: #5a3480; }
    /* Меню — столбиком. !important: в карточках AO3 списки выкладываются в строку, как теги через запятую. */
    .fbs-st-menu { display: block !important; position: absolute !important; right: 0; left: auto; top: calc(100% + 3px);
      width: auto !important; min-width: 12em; padding: 3px 0 !important; margin: 0 !important;
      list-style: none !important; background: #fff !important; border: 1px solid #c8c8c8; border-radius: 3px;
      box-shadow: 0 4px 12px rgba(0,0,0,.15); text-align: left; }
    .fbs-st-menu[hidden] { display: none !important; }
    .fbs-st-menu li { display: block !important; float: none !important; margin: 0 !important; padding: 3px 12px !important;
      background: none; border: 0; color: #2a2a2a; cursor: pointer; white-space: nowrap; text-indent: 0; }
    .fbs-st-menu li::before, .fbs-st-menu li::after { content: none !important; display: none !important; }
    .fbs-st-menu li:hover, .fbs-st-menu li:focus { background: #f2f2f2; outline: none; }
    .fbs-st-menu li[aria-checked="true"] { color: #900; font-weight: bold; }
    .fbs-st-menu li.fbs-st-none { color: #888; border-bottom: 1px solid #eee; margin-bottom: 2px; }
    .fbs-st-work { margin-top: .2em; }
    .fbs-st-blurb { margin-top: .4em; }
    .fbs-st-new { margin-right: .5em; color: #900; font-weight: bold; white-space: nowrap; cursor: help; }
    .fbs-st-new[hidden] { display: none !important; }
  `;

  /** Номер работы по ссылке: /works/123, /works/123/chapters/456. */
  function workIdOf(href) {
    try {
      return new URL(href, location.href).pathname.match(/^\/works\/(\d+)/)?.[1] ?? null;
    } catch {
      return null;
    }
  }

  /** Дата в виде 2021-01-23 — из «23 Jan 2021» (карточки) или «2021-01-23» (страница работы). */
  function isoDate(text) {
    const iso = text?.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
    if (iso) return iso[0];
    const m = text?.match(/\b(\d{1,2})\s+([A-Z][a-z]{2})\s+(\d{4})\b/);
    if (!m || !MONTHS[m[2]]) return null;
    return `${m[3]}-${String(MONTHS[m[2]]).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }

  /** Местная дата из отметки времени — для старых статусов, где даты обновления ещё нет. */
  function dayOf(at) {
    const d = new Date(Number(at) || 0);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  /** Работа обновилась после того, как поставлен статус? */
  function isUpdated(box) {
    if (!box.status || !box.upd || !box.saved) return false;
    return box.upd > (box.saved.upd || dayOf(box.saved.at));
  }

  /** Текст плашки: «✓ Прочитано», «▸ Читаю», с «· ↓», если скачано; без статуса — «+ Статус». */
  function badgeText(status) {
    const info = STATUSES[status];
    if (!info) return FBS.t('statusAdd');
    if (info.kind === 'dl') return `↓ ${FBS.t('statusDl')}`;
    const word = FBS.t(info.kind === 'read' ? 'statusRead' : 'statusReading');
    return `${info.kind === 'read' ? '✓' : '▸'} ${word}${info.dl ? ' · ↓' : ''}`;
  }

  function render(box) {
    const info = STATUSES[box.status];
    box.el.dataset.kind = info?.kind ?? '';
    box.flag.hidden = !isUpdated(box);
    box.flag.textContent = FBS.t('statusUpdated');
    box.flag.title = FBS.t('statusUpdatedHint');
    box.badge.textContent = badgeText(box.status);
    box.badge.title = info ? `${FBS.t('statusLabel')} ${FBS.t(info.label)}` : FBS.t('statusLabel');
    const items = [['', 'statusNone'], ...Object.entries(STATUSES).map(([value, s]) => [value, s.label])];
    box.menu.replaceChildren(
      ...items.map(([value, label]) => {
        const li = document.createElement('li');
        li.textContent = FBS.t(label);
        li.dataset.value = value;
        li.tabIndex = -1;
        li.setAttribute('role', 'menuitemradio');
        li.setAttribute('aria-checked', String(value === (box.status ?? '')));
        if (!value) li.className = 'fbs-st-none';
        return li;
      }),
    );
  }

  let openBox = null;

  function closeMenu() {
    if (!openBox) return;
    openBox.menu.hidden = true;
    openBox.badge.setAttribute('aria-expanded', 'false');
    openBox = null;
  }

  function toggleMenu(box) {
    if (openBox === box) return closeMenu();
    closeMenu();
    box.menu.hidden = false;
    box.badge.setAttribute('aria-expanded', 'true');
    openBox = box;
    box.menu.querySelector('[aria-checked="true"]')?.focus();
  }

  function makeBox(id, title, upd, extraClass) {
    const el = document.createElement('div');
    el.className = `fbs-st${extraClass ? ` ${extraClass}` : ''}`;
    el.setAttribute('translate', 'no'); // Переводчик браузера подписи не трогает.
    const flag = document.createElement('span');
    flag.className = 'fbs-st-new';
    flag.hidden = true;
    const badge = document.createElement('span');
    badge.className = 'fbs-st-badge';
    badge.tabIndex = 0;
    badge.setAttribute('role', 'button');
    badge.setAttribute('aria-haspopup', 'menu');
    badge.setAttribute('aria-expanded', 'false');
    const menu = document.createElement('ul');
    menu.className = 'fbs-st-menu';
    menu.setAttribute('role', 'menu');
    menu.hidden = true;
    el.append(flag, badge, menu);
    const box = { id, title, upd, el, flag, badge, menu, status: null, saved: null };

    badge.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleMenu(box);
    });
    badge.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggleMenu(box);
      }
    });
    menu.addEventListener('click', (event) => {
      event.stopPropagation();
      const li = event.target.closest('li');
      if (!li) return;
      closeMenu();
      save(box, li.dataset.value);
      badge.focus();
    });
    menu.addEventListener('keydown', (event) => {
      const items = [...menu.children];
      const index = items.indexOf(document.activeElement);
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        items[(index + step + items.length) % items.length].focus();
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        document.activeElement?.click();
      }
    });

    render(box);
    boxes.push(box);
    return el;
  }

  /** Показать сохранённую запись { s, at, upd } (или её отсутствие). */
  function show(box, saved) {
    box.status = STATUSES[saved?.s] ? saved.s : null;
    box.saved = box.status ? saved : null;
    render(box);
  }

  // Выбор статуса — даже того же самого — запоминает текущую дату обновления и убирает «Есть обновление!».
  async function save(box, value) {
    const saved = value ? { s: value, title: box.title, at: Date.now(), ...(box.upd && { upd: box.upd }) } : null;
    show(box, saved);
    try {
      if (saved) await chrome.storage.local.set({ [key(box.id)]: saved });
      else await chrome.storage.local.remove(key(box.id));
    } catch {
      // Расширение обновили, а страницу нет: связь со storage потеряна — после F5 всё заработает.
    }
  }

  /** Карточки работ в списках: li.blurb со ссылкой на работу в заголовке. Плашка — справа, сразу под
   *  шапкой карточки: внутри шапки дата и значки стоят абсолютно и на узком окне наезжают на плашку. */
  function addToBlurbs() {
    for (const blurb of document.querySelectorAll('li.blurb')) {
      const link = blurb.querySelector('.header h4.heading a[href*="/works/"]');
      const id = link && workIdOf(link.getAttribute('href'));
      if (!id || blurb.querySelector('.fbs-st')) continue;
      const upd = isoDate(blurb.querySelector(':scope > .header p.datetime')?.textContent);
      const box = makeBox(id, link.textContent.trim(), upd, 'fbs-st-blurb');
      const header = blurb.querySelector(':scope > .header');
      if (header) header.after(box);
      else link.closest('h4').after(box);
    }
  }

  /** Страница самой работы (и любой её главы): справа от названия. */
  function addToWorkPage() {
    const id = workIdOf(location.href);
    const heading = document.querySelector('#workskin .preface h2.title');
    if (!id || !heading) return;
    // «Обновлено» у недописанной работы, «Завершено» у дописанной; у работы из одной главы — только «Опубликовано».
    const stats = document.querySelector('dl.stats');
    const upd = isoDate((stats?.querySelector('dd.status') ?? stats?.querySelector('dd.published'))?.textContent);
    heading.before(makeBox(id, heading.textContent.trim(), upd, 'fbs-st-work'));
  }

  async function init() {
    addToBlurbs();
    addToWorkPage();
    if (!boxes.length) return;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.append(style);
    document.addEventListener('click', closeMenu);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && openBox) {
        const { badge } = openBox;
        closeMenu();
        badge.focus();
      }
    });
    try {
      await FBS.loadLanguage();
      const saved = await chrome.storage.local.get([...new Set(boxes.map((b) => key(b.id)))]);
      for (const box of boxes) show(box, saved[key(box.id)]);
    } catch {
      return;
    }
    // Статус поменяли в другой вкладке (или в соседней карточке той же работы) — показываем сразу.
    chrome.storage.onChanged.addListener(async (changes, area) => {
      if (area !== 'local') return;
      if (changes.lang) await FBS.loadLanguage();
      for (const box of boxes) {
        const change = changes[key(box.id)];
        if (change) show(box, change.newValue);
        else if (changes.lang) render(box);
      }
    });
  }

  init();
})();
