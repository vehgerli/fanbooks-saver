// Текст автора со страницы → чистый HTML (только оформление текста) или простой текст для TXT.
(function () {
  const FBS = (globalThis.FBS = globalThis.FBS || {});
  if (FBS.clean) return;

  // Теги, которые сохраняем в HTML как есть. Остальные «разворачиваем»: оставляем только содержимое.
  const KEEP = new Set([
    'p', 'br', 'hr', 'em', 'i', 'strong', 'b', 'u', 's', 'strike', 'del', 'ins', 'sup', 'sub', 'small',
    'big', 'blockquote', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'img', 'div', 'pre',
    'code', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'dl', 'dt', 'dd',
  ]);
  // Выбрасываем вместе с содержимым.
  const DROP = new Set(['script', 'style', 'noscript', 'iframe', 'form', 'input', 'button', 'select', 'textarea', 'svg']);
  const BLOCK = new Set([
    'p', 'div', 'blockquote', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'table', 'tr',
    'center', 'dl', 'dt', 'dd', 'figure', 'figcaption', 'caption', 'section', 'article', 'header', 'footer',
  ]);
  const ALIGN = { center: 'center', right: 'right', justify: 'justify' };

  function alignOf(el) {
    if (el.localName === 'center') return 'center';
    const value = (el.getAttribute('align') || el.style?.textAlign || '').toLowerCase();
    return ALIGN[value] ?? null;
  }

  function absolute(value, base) {
    try {
      const url = new URL(value, base);
      return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:' ? url.href : null;
    } catch {
      return null;
    }
  }

  /** Копия узла только с разрешёнными тегами и атрибутами. */
  function cleanNode(node, doc, base) {
    if (node.nodeType === Node.TEXT_NODE) return doc.createTextNode(node.data);
    if (node.nodeType !== Node.ELEMENT_NODE) return null;
    const tag = node.localName;
    if (DROP.has(tag)) return null;

    const children = () => {
      const fragment = doc.createDocumentFragment();
      for (const child of node.childNodes) {
        const copy = cleanNode(child, doc, base);
        if (copy) fragment.appendChild(copy);
      }
      return fragment;
    };

    const align = alignOf(node);
    if (!KEEP.has(tag)) {
      // <center> и выровненные <span> не теряют выравнивание.
      if (align && BLOCK.has(tag)) {
        const p = doc.createElement('p');
        p.className = align;
        p.appendChild(children());
        return p;
      }
      return children();
    }

    const el = doc.createElement(tag);
    if (align) el.className = align;
    if (tag === 'a') {
      const href = absolute(node.getAttribute('href') || '', base);
      if (href) el.setAttribute('href', href);
    } else if (tag === 'img') {
      const src = absolute(node.getAttribute('src') || '', base);
      if (!src) return null;
      el.setAttribute('src', src);
      const alt = node.getAttribute('alt');
      if (alt) el.setAttribute('alt', alt);
    } else if (tag === 'td' || tag === 'th') {
      for (const name of ['colspan', 'rowspan']) {
        const value = node.getAttribute(name);
        if (value) el.setAttribute(name, value);
      }
    }
    el.appendChild(children());
    return el;
  }

  /** Чистый HTML содержимого элемента (без самого элемента). */
  function toHtml(root, base) {
    const doc = document.implementation.createHTMLDocument('');
    const box = doc.createElement('div');
    for (const child of root.childNodes) {
      const copy = cleanNode(child, doc, base);
      if (copy) box.appendChild(copy);
    }
    return box.innerHTML.trim();
  }

  /**
   * Простой текст: абзацы через пустую строку, <br> — перенос, <hr> — «* * *».
   * lines: абзацы на сайте — переносы строк в самом тексте (так у Книги Фанфиков), их сохраняем.
   */
  function toText(root, { lines = false } = {}) {
    const out = [];
    const breakBlock = () => out.push('\n\n');
    function walk(node, pre) {
      if (node.nodeType === Node.TEXT_NODE) {
        out.push(pre ? node.data : lines ? node.data.replace(/[ \t\r\f\v ]+/g, ' ') : node.data.replace(/\s+/g, ' '));
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const tag = node.localName;
      if (DROP.has(tag)) return;
      if (tag === 'br') return void out.push('\n');
      if (tag === 'hr') return void out.push('\n\n* * *\n\n');
      if (tag === 'img') {
        const alt = (node.getAttribute('alt') || '').trim();
        return void out.push(alt ? `[${FBS.t('image')}: ${alt}]` : `[${FBS.t('image')}]`);
      }
      const block = BLOCK.has(tag);
      if (block) breakBlock();
      if (tag === 'li') out.push('• ');
      if (tag === 'td' || tag === 'th') out.push(' | ');
      for (const child of node.childNodes) walk(child, pre || tag === 'pre');
      if (block) breakBlock();
    }
    for (const child of root.childNodes) walk(child, false);
    return out
      .join('')
      .split('\n')
      .map((line) => line.replace(/[ \t ]+$/g, '').replace(/^[ \t]+/g, ''))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /** Строка без лишних пробелов: для названий, тегов, подписей. */
  function line(el) {
    return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  FBS.clean = { toHtml, toText, line };
})();
