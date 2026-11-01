// Сборка файла из работы, одинаковая для всех сайтов.
//
// Работа (её отдаёт разборщик сайта):
//   { site, url, title, authors: [строка], meta: [{ label, value }],
//     preface: [Раздел], chapters: [{ title, preface: [Раздел], body: Element, endNotes: [Раздел] }],
//     endNotes: [Раздел] }
//   Раздел: { heading, el, lines? } — подпись («Summary:», «Notes:») и элемент с текстом автора.
//   lines (у раздела и главы): абзацы на сайте — переносы строк в тексте, а не теги.
(function () {
  const FBS = (globalThis.FBS = globalThis.FBS || {});
  if (FBS.output) return;
  const { toHtml, toText } = FBS.clean;

  // Стиль как у HTML-выгрузки ридера Read FanBooks, плюс шапка работы и главы.
  const CSS =
    'body{margin:0;background:#f7f7f7;color:#2a2a2a;font:16px/1.55 Arial,sans-serif}' +
    '.work{box-sizing:border-box;max-width:860px;margin:2rem auto;padding:3rem 4rem;background:#fff;border:1px solid #ddd}' +
    'h1{font:700 2rem Georgia,serif;text-align:center;color:#900;margin:0 0 .4rem}' +
    '.byline{text-align:center;margin:0 0 1.5rem;font-style:italic}' +
    '.source{text-align:center;font-size:.85em;color:#777;margin:0 0 1.5rem}' +
    '.meta{margin:0 0 1.5rem;padding:1rem 1.25rem;background:#faf6f0;border:1px solid #eadfcf}' +
    '.meta p{margin:.2rem 0}.meta b{color:#600}' +
    '.section{margin:0 0 1.5rem}.section h3{font:700 1.05rem Georgia,serif;color:#600;margin:0 0 .5rem}' +
    '.section .text{border-left:.25rem solid #e2cfcf;padding-left:1rem}' +
    'h2.chapter{font:700 1.5rem Georgia,serif;color:#900;text-align:center;margin:0 0 1.5rem}' +
    '.page-break{break-before:page;border:0;border-top:1px solid #ddd;margin:2.5rem 0}' +
    '.text p{margin:0 0 1em}.lines{white-space:pre-wrap}.lines p{margin:0}.center{text-align:center}.right{text-align:right}.justify{text-align:justify}' +
    'a{color:#900}table{border-collapse:collapse;max-width:100%}td,th{border:1px solid #aaa;padding:.35rem .5rem;vertical-align:top}' +
    'img{max-width:100%;height:auto}blockquote{margin:0 0 1em 1.5rem}' +
    '@media(max-width:700px){.work{margin:0;padding:1.5rem;border:0}}' +
    '@media print{body{background:#fff}.work{border:0;margin:0;max-width:none}}';

  function escape(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function textHtml(el, lines, base) {
    return `<div class="text${lines ? ' lines' : ''}">${toHtml(el, base)}</div>`;
  }

  function sectionsHtml(sections, base) {
    return sections
      .map(
        (s) =>
          `<section class="section">${s.heading ? `<h3>${escape(s.heading)}</h3>` : ''}` +
          `${textHtml(s.el, s.lines, base)}</section>`,
      )
      .join('');
  }

  function html(work) {
    const base = work.url;
    const parts = [
      `<!doctype html><html><head><meta charset="utf-8">`,
      `<meta name="viewport" content="width=device-width,initial-scale=1">`,
      `<title>${escape(work.title)}</title><style>${CSS}</style></head><body><main class="work">`,
      `<h1>${escape(work.title)}</h1>`,
    ];
    if (work.authors.length) parts.push(`<p class="byline">${escape(work.authors.join(', '))}</p>`);
    parts.push(`<p class="source">${escape(work.site)}: <a href="${escape(work.url)}">${escape(work.url)}</a></p>`);
    if (work.meta.length) {
      parts.push('<div class="meta">');
      for (const m of work.meta) parts.push(`<p><b>${escape(m.label)}</b> ${escape(m.value)}</p>`);
      parts.push('</div>');
    }
    parts.push(sectionsHtml(work.preface, base));
    work.chapters.forEach((chapter, index) => {
      if (index > 0 || work.preface.length || work.meta.length) parts.push('<hr class="page-break">');
      if (chapter.title) parts.push(`<h2 class="chapter">${escape(chapter.title)}</h2>`);
      parts.push(sectionsHtml(chapter.preface, base));
      parts.push(textHtml(chapter.body, chapter.lines, base));
      parts.push(sectionsHtml(chapter.endNotes, base));
    });
    if (work.endNotes.length) parts.push('<hr class="page-break">' + sectionsHtml(work.endNotes, base));
    parts.push('</main></body></html>');
    return parts.join('');
  }

  function sectionsText(sections) {
    return sections.map((s) => [s.heading, toText(s.el, { lines: s.lines })].filter(Boolean).join('\n\n'));
  }

  function txt(work) {
    const blocks = [work.title];
    if (work.authors.length) blocks.push(work.authors.join(', '));
    blocks.push(`${work.site}: ${work.url}`);
    if (work.meta.length) blocks.push(work.meta.map((m) => `${m.label} ${m.value}`).join('\n'));
    blocks.push(...sectionsText(work.preface));
    for (const chapter of work.chapters) {
      blocks.push('');
      if (chapter.title) blocks.push(chapter.title);
      blocks.push(...sectionsText(chapter.preface));
      blocks.push(toText(chapter.body, { lines: chapter.lines }));
      blocks.push(...sectionsText(chapter.endNotes));
    }
    if (work.endNotes.length) blocks.push('', ...sectionsText(work.endNotes));
    // Пустой блок даёт лишнюю пустую строку перед главой.
    return blocks.join('\n\n').replace(/\n{4,}/g, '\n\n\n').trim() + '\n';
  }

  /** Имя файла «Название — Автор», без символов, запрещённых в Windows. */
  function fileName(work, format) {
    const author = work.authors.slice(0, 2).join(', ');
    const raw = author ? `${work.title} — ${author}` : work.title;
    const safe = raw
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[. ]+$/, '')
      .slice(0, 150);
    return `${safe || 'work'}.${format}`;
  }

  function build(work, format) {
    const content = format === 'html' ? html(work) : txt(work);
    const type = format === 'html' ? 'text/html;charset=utf-8' : 'text/plain;charset=utf-8';
    return { name: fileName(work, format), blob: new Blob([content], { type }) };
  }

  /** Обычное скачивание браузера: файл попадает в «Загрузки». */
  function save({ name, blob }) {
    const href = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = href;
    link.download = name;
    link.style.display = 'none';
    document.documentElement.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(href), 60000);
  }

  FBS.output = { build, save };
})();
