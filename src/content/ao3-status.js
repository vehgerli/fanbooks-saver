// AO3: «Мой статус» у каждой работы — в списках (поиск, теги, закладки, страницы авторов)
// и на странице самой работы: Прочитано / Читаю / Прочитано, скачано / Читаю, скачано.
// Вид — маленькая плашка справа («+ Статус», если статуса нет); по нажатию — меню с вариантами.
// Ставится только вручную. Хранится в браузере (storage.local) под ключом «ao3:<номер работы>»:
//   { s: статус, title: название, at: когда поставлен }; «Без статуса» — ключ удаляется.
// Подключается сам на страницах AO3 (content_scripts в манифесте) и ничего не отправляет.
(function () {
  const FBS = (globalThis.FBS = globalThis.FBS || {});
  if (FBS.ao3Status) return;
  FBS.ao3Status = true;

  // Порядок в меню — как в списке у пользователя. read/reading — цвет плашки, dl — «скачано».
  const STATUSES = {
    read: { label: 'statusRead', kind: 'read', dl: false },
    reading: { label: 'statusReading', kind: 'reading', dl: false },
    readDl: { label: 'statusReadDl', kind: 'read', dl: true },
    readingDl: { label: 'statusReadingDl', kind: 'reading', dl: true },
  };
  const key = (id) => `ao3:${id}`;
  const boxes = []; // { id, title, el, badge, menu, status }

  const CSS = `
    .fbs-st { position: relative; float: right; clear: right; margin: 0 0 .3em .6em; z-index: 5;
      font: 12px/1.4 'Lucida Grande', 'Lucida Sans Unicode', Verdana, Helvetica, sans-serif; }
    .fbs-st-badge { display: inline-block; padding: 1px 8px; border: 1px solid #c8c8c8; border-radius: 3px;
      background: #fff; color: #777; cursor: pointer; white-space: nowrap; user-select: none; }
    .fbs-st-badge:hover, .fbs-st-badge:focus { border-color: #900; color: #900; outline: none; }
    .fbs-st[data-kind="reading"] .fbs-st-badge { background: #e6f0fa; border-color: #2f6fb5; color: #1f4f85; }
    .fbs-st[data-kind="read"] .fbs-st-badge { background: #e9f4e6; border-color: #3b8a3b; color: #2b6a2b; }
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
  `;

  /** Номер работы по ссылке: /works/123, /works/123/chapters/456. */
  function workIdOf(href) {
    try {
      return new URL(href, location.href).pathname.match(/^\/works\/(\d+)/)?.[1] ?? null;
    } catch {
      return null;
    }
  }

  /** Текст плашки: «✓ Прочитано», «▸ Читаю», с «· ↓», если скачано; без статуса — «+ Статус». */
  function badgeText(status) {
    const info = STATUSES[status];
    if (!info) return FBS.t('statusAdd');
    const word = FBS.t(info.kind === 'read' ? 'statusRead' : 'statusReading');
    return `${info.kind === 'read' ? '✓' : '▸'} ${word}${info.dl ? ' · ↓' : ''}`;
  }

  function render(box) {
    const info = STATUSES[box.status];
    box.el.dataset.kind = info?.kind ?? '';
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

  function makeBox(id, title, extraClass) {
    const el = document.createElement('div');
    el.className = `fbs-st${extraClass ? ` ${extraClass}` : ''}`;
    el.setAttribute('translate', 'no'); // Переводчик браузера подписи не трогает.
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
    el.append(badge, menu);
    const box = { id, title, el, badge, menu, status: null };

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

  function show(box, status) {
    box.status = STATUSES[status] ? status : null;
    render(box);
  }

  async function save(box, value) {
    show(box, value);
    try {
      if (value) await chrome.storage.local.set({ [key(box.id)]: { s: value, title: box.title, at: Date.now() } });
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
      const box = makeBox(id, link.textContent.trim(), 'fbs-st-blurb');
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
    heading.before(makeBox(id, heading.textContent.trim(), 'fbs-st-work'));
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
      for (const box of boxes) show(box, saved[key(box.id)]?.s);
    } catch {
      return;
    }
    // Статус поменяли в другой вкладке (или в соседней карточке той же работы) — показываем сразу.
    chrome.storage.onChanged.addListener(async (changes, area) => {
      if (area !== 'local') return;
      if (changes.lang) await FBS.loadLanguage();
      for (const box of boxes) {
        const change = changes[key(box.id)];
        if (change) show(box, change.newValue?.s);
        else if (changes.lang) render(box);
      }
    });
  }

  init();
})();
