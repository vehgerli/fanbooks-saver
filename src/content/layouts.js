// Раскладка файла «как у самого сайта» — для AO3 и Книги Фанфиков. Так файлы читает Read FanBooks.
//   AO3: HTML повторяет файл «Download → HTML» самого AO3 (#preface, dl.tags, #chapters, #afterword),
//        TXT — тот же порядок: название, «Posted originally…», шапка, название, by, Summary, Notes, главы.
//   Книга Фанфиков: TXT повторяет выгрузку сайта (звёздочки, название, ссылка, шапка,
//        «========== Часть ==========»), HTML — тот же порядок.
// Остальные сайты и EPUB собираются общей раскладкой в output.js.
(function () {
  const FBS = (globalThis.FBS = globalThis.FBS || {});
  if (FBS.layouts) return;
  const { toHtml, toText } = FBS.clean;

  function escape(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ---------------------------------------------------------------- AO3

  // Стиль файла «Download → HTML» AO3, плюс выравнивание абзацев, которое сохраняет чистка текста.
  const AO3_CSS = `
    p.message { text-align: center; }
    .meta h1 { font-size: 1.5em; text-align: center; }
    .meta h2 { font-size: 1.25em; text-align: center; }
    .meta h2 { page-break-before: always; }
    .meta .byline { text-align: center; }
    .meta dl.tags { border: 1px solid; padding: 1em; }
    .meta dd { margin: -1em 0 0 10em; }
    .meta .endnote-link { font-size: .8em; }
    #afterword .meta dd { margin: 1em 0 0 1em; }
    #chapters { font-family: "Nimbus Roman No9 L", "Times New Roman", serif; padding: 1em; }
    .userstuff { font-family: "Nimbus Roman No9 L", "Times New Roman", serif; padding: 1em; }
    .toc-heading { display: none; }
    .center { text-align: center; } .right { text-align: right; } .justify { text-align: justify; }
  `;

  function ao3Byline(work) {
    const links = work.authorLinks?.length
      ? work.authorLinks.map((a) => (a.url ? `<a rel="author" href="${escape(a.url)}">${escape(a.name)}</a>` : escape(a.name)))
      : work.authors.map(escape);
    return links.join(', ');
  }

  /** «<p>Summary</p><blockquote class="userstuff">…</blockquote>» — как подписи разделов у AO3. */
  function ao3Sections(sections, base, indent = '      ') {
    return sections
      .map((s) => `${indent}<p>${escape(s.heading)}</p>\n${indent}<blockquote class="userstuff">${toHtml(s.el, base)}</blockquote>\n`)
      .join('\n');
  }

  function ao3Html(work) {
    const base = work.url;
    const fandom = work.meta.find((m) => /^Fandoms?:$/.test(m.label))?.value;
    const pageTitle = [work.title, work.authors.join(', '), fandom].filter(Boolean).join(' - ');
    const out = [
      '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">',
      '<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en" lang="en">',
      '<head>',
      '  <meta charset="utf-8" />',
      `  <title>${escape(pageTitle)}</title>`,
      `  <style type="text/css">${AO3_CSS}  </style>`,
      '</head>',
      '<body>',
      '',
      '<div id="preface">',
      '  <h2 class="toc-heading">Preface</h2>',
      '',
      '  <p class="message">',
      `    <b>${escape(work.title)}</b><br />`,
      '    Posted originally on the <a href="https://archiveofourown.org/">Archive of Our Own</a> at ' +
        `<a href="${escape(work.url)}">${escape(work.url)}</a>.`,
      '  </p>',
      '',
      '  <div class="meta">',
      '    <dl class="tags">',
    ];
    for (const m of work.meta) {
      out.push(`      <dt>${escape(m.label)}</dt>`, `      <dd>${m.html ?? escape(m.value)}</dd>`);
    }
    out.push(
      '    </dl>',
      `    <h1>${escape(work.title)}</h1>`,
      `    <div class="byline">by ${ao3Byline(work)}</div>`,
      ao3Sections(work.preface, base),
      '  </div>',
      '</div>',
      '',
      '',
      '<div id="chapters" class="userstuff">',
    );
    work.chapters.forEach((chapter, index) => {
      const n = index + 1;
      if (!chapter.title) {
        // Работа из одной главы: у AO3 текст идёт сразу, без заголовка главы.
        out.push(`    <h2 class="toc-heading">${escape(work.title)}</h2>`);
        out.push(`    <div class="userstuff">${toHtml(chapter.body, base)}</div>`);
        return;
      }
      out.push('', '<div class="meta group">', `  <h2 class="heading">${escape(chapter.title)}</h2>`);
      if (chapter.preface.length) out.push(ao3Sections(chapter.preface, base, '    '));
      if (chapter.endNotes.length) {
        out.push(`    <div class="endnote-link">See the end of the chapter for <a href="#endnotes${n}">more notes</a></div>`);
      }
      out.push('</div>', '', '<!--chapter content-->');
      out.push(`<div class="userstuff">${toHtml(chapter.body, base)}</div>`, '<!--/chapter content-->');
      if (chapter.endNotes.length) {
        out.push(`  <div class="meta" id="endnotes${n}">`, ao3Sections(chapter.endNotes, base, '    '), '  </div>');
      }
    });
    out.push('</div>', '', '<div id="afterword">', '  <h2 class="toc-heading">Afterword</h2>');
    if (work.endNotes.length) {
      out.push('    <div class="meta">', '        <div id="endnotes">');
      out.push(ao3Sections(work.endNotes, base, '          '));
      out.push('        </div>', '    </div>');
    }
    out.push(
      `  <p class="message">Please <a href="${escape(work.url)}/comments/new">drop by the Archive and comment</a> ` +
        'to let the creator know if you enjoyed their work!</p>',
      '</div>',
      '',
      '</body>',
      '</html>',
      '',
    );
    return out.join('\n');
  }

  /** Подписи шапки выровнены в столбик, как в выгрузке AO3. */
  const AO3_LABEL_WIDTH = 22;

  function textSections(sections) {
    return sections.flatMap((s) => [s.heading, '', toText(s.el, { lines: s.lines }), '']);
  }

  function ao3Txt(work) {
    const out = [
      work.title,
      `Posted originally on the Archive of Our Own at ${work.url}.`,
      '',
      ...work.meta.map((m) => `${m.label.padEnd(AO3_LABEL_WIDTH - 1)} ${m.value}`),
      '',
      work.title,
      `by ${work.authors.join(', ')}`,
      '',
      ...textSections(work.preface),
    ];
    for (const chapter of work.chapters) {
      out.push('');
      if (chapter.title) out.push(chapter.title, '');
      out.push(...textSections(chapter.preface));
      out.push(toText(chapter.body), '');
      out.push(...textSections(chapter.endNotes));
    }
    if (work.endNotes.length) out.push('', ...textSections(work.endNotes));
    return out.join('\n').replace(/\n{4,}/g, '\n\n\n').trim() + '\n';
  }

  // ---------------------------------------------------------------- Книга Фанфиков

  const STARS = '*'.repeat(95);
  // Порядок строк шапки как в выгрузке сайта; что не в списке — после «Метки», перед описанием.
  const FICBOOK_ORDER_TOP = ['Фэндом:', 'Пэйринг и персонажи:'];
  const FICBOOK_INDENT = new Set(['Пэйринг и персонажи:']);
  const PUBLICATION = 'Публикация на других ресурсах:';

  /**
   * Шапка работы в порядке сайта: строки { label, value, url?, indent?, pad? }, пустые строки { gap: сколько }
   * и разделы текста автора { section }. Общая для TXT и HTML.
   */
  function ficbookHead(work) {
    const hat = work.hat;
    const field = (label) => hat.fields.find((f) => f.label === label)?.value;
    const items = [];
    if (hat.direction) items.push({ label: 'Направленность:', value: hat.direction });
    for (const c of hat.creators) items.push({ label: `${c.role}:`, value: c.name, url: c.url, indent: true });
    // После участников у сайта — три пустые строки, перед размером — одна.
    items.push({ gap: 3 });
    for (const label of FICBOOK_ORDER_TOP) {
      const value = field(label);
      if (value) items.push({ label, value, indent: FICBOOK_INDENT.has(label) });
    }
    if (hat.rating) items.push({ label: 'Рейтинг:', value: hat.rating });
    items.push({ gap: 1 });
    // «…, написано 678 страниц, 309 607 слов, 32 части» — число частей у сайта отдельной строкой.
    const size = field('Размер:')?.replace(/,\s*[\d\s]+\s+част(ь|и|ей)\s*$/i, '');
    if (size) items.push({ label: 'Размер:', value: size });
    items.push({ label: 'Кол-во частей:', value: String(work.chapters.length) });
    if (hat.status) items.push({ label: 'Статус:', pad: '    ', value: hat.status[0].toLowerCase() + hat.status.slice(1) });
    const tags = field('Метки:');
    if (tags) items.push({ label: 'Метки:', value: tags });
    const known = new Set([...FICBOOK_ORDER_TOP, 'Размер:', 'Метки:', PUBLICATION]);
    for (const f of hat.fields) if (!known.has(f.label)) items.push(f);
    for (const s of work.preface) items.push({ section: s });
    const publication = field(PUBLICATION);
    if (publication) items.push({ gap: 3 }, { label: PUBLICATION, value: publication });
    return items;
  }

  function ficbookTxt(work) {
    const out = [STARS, work.title, work.url, STARS, ''];
    for (const item of ficbookHead(work)) {
      if (item.gap) out.push(...Array(item.gap).fill(''));
      else if (item.section) out.push(item.section.heading, toText(item.section.el, { lines: item.section.lines }), '');
      else out.push(`${item.indent ? '    ' : ''}${item.label}${item.pad ?? ''} ${item.value}${item.url ? ` (${item.url})` : ''}`);
    }
    for (const chapter of work.chapters) {
      out.push('', `========== ${chapter.title || work.title} ==========`, '');
      for (const s of chapter.preface) out.push(s.heading, toText(s.el, { lines: s.lines }), '');
      out.push(toText(chapter.body, { lines: chapter.lines }), '');
      for (const s of chapter.endNotes) out.push(s.heading, toText(s.el, { lines: s.lines }), '');
    }
    // Не больше трёх пустых строк подряд; переносы строк Windows — как в выгрузке сайта.
    return (out.join('\n').replace(/\n{5,}/g, '\n\n\n\n').trim() + '\n').replace(/\n/g, '\r\n');
  }

  function ficbookHtml(work) {
    const base = work.url;
    const text = (el, lines) => `<div class="text${lines ? ' lines' : ''}">${toHtml(el, base)}</div>`;
    const section = (s) =>
      `<section class="section"><h3>${escape(s.heading)}</h3>${text(s.el, s.lines)}</section>`;
    const out = [
      '<!doctype html><html lang="ru"><head><meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width,initial-scale=1">',
      `<title>${escape(work.title)}</title><style>${FBS.output.CSS}.meta p.indent{padding-left:2em}</style></head>`,
      '<body><main class="work">',
      `<h1>${escape(work.title)}</h1>`,
      `<p class="source"><a href="${escape(work.url)}">${escape(work.url)}</a></p>`,
    ];
    let metaOpen = false;
    const openMeta = () => !metaOpen && (out.push('<div class="meta">'), (metaOpen = true));
    const closeMeta = () => metaOpen && (out.push('</div>'), (metaOpen = false));
    for (const item of ficbookHead(work)) {
      if (item.gap) continue;
      if (item.section) {
        closeMeta();
        out.push(section(item.section));
        continue;
      }
      openMeta();
      const value = item.url ? `<a href="${escape(item.url)}">${escape(item.value)}</a>` : escape(item.value);
      out.push(`<p${item.indent ? ' class="indent"' : ''}><b>${escape(item.label)}</b> ${value}</p>`);
    }
    closeMeta();
    for (const chapter of work.chapters) {
      out.push('<hr class="page-break">', `<h2 class="chapter">${escape(chapter.title || work.title)}</h2>`);
      out.push(...chapter.preface.map(section), text(chapter.body, chapter.lines), ...chapter.endNotes.map(section));
    }
    out.push('</main></body></html>');
    return out.join('\n');
  }

  FBS.layouts = {
    ao3: { html: ao3Html, txt: ao3Txt },
    ficbook: { html: ficbookHtml, txt: ficbookTxt },
  };
})();
