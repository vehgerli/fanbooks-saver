// Сборка EPUB 3 из работы (того же вида, что для output.js).
// EPUB — zip-архив с XHTML-страницами: титульная (шапка работы), по файлу на главу, примечания в конце.
// Оглавление — и в nav.xhtml (EPUB 3), и в toc.ncx (для старых ридеров).
// Zip собираем сами, без сжатия: так проще, а ридерам всё равно.
(function () {
  const FBS = (globalThis.FBS = globalThis.FBS || {});
  if (FBS.epub) return;
  const { toXhtml } = FBS.clean;

  const CSS =
    'body{margin:0 .4em;line-height:1.5}' +
    'h1,h2{font-family:serif;text-align:center}h1{margin:1.5em 0 .4em}h2.chapter{margin:1em 0 1.2em}' +
    '.byline{text-align:center;font-style:italic;margin:0 0 1em}' +
    '.source{text-align:center;font-size:.85em;margin:0 0 1.5em}' +
    '.meta{margin:0 0 1.5em}.meta p{margin:.2em 0}' +
    '.section{margin:0 0 1.5em}.section h3{font-size:1em;margin:0 0 .4em}' +
    '.text p{margin:0 0 .8em}.lines p{margin:0}' +
    '.center{text-align:center}.right{text-align:right}.justify{text-align:justify}' +
    'blockquote{margin:0 0 1em 1.5em}table{border-collapse:collapse}td,th{border:1px solid #888;padding:.2em .4em}';

  // Символы, которых не может быть в XML: с ними ридер не откроет страницу.
  const XML_BAD = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

  function escape(value) {
    return String(value)
      .replace(XML_BAD, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ---------- zip (метод «без сжатия») ----------

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  /** files: [{ name, text }] → Blob. Первым должен идти mimetype — так требует EPUB. */
  function zip(files, type) {
    const encoder = new TextEncoder();
    const now = new Date();
    const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const local = [];
    const central = [];
    let offset = 0;
    let centralSize = 0;
    for (const file of files) {
      const name = encoder.encode(file.name);
      const data = encoder.encode(file.text);
      const crc = crc32(data);

      const head = new DataView(new ArrayBuffer(30));
      head.setUint32(0, 0x04034b50, true); // подпись записи
      head.setUint16(4, 20, true); // нужна версия 2.0
      head.setUint16(10, time, true);
      head.setUint16(12, date, true);
      head.setUint32(14, crc, true);
      head.setUint32(18, data.length, true); // сжатый размер = исходный
      head.setUint32(22, data.length, true);
      head.setUint16(26, name.length, true);
      local.push(head, name, data);

      const entry = new DataView(new ArrayBuffer(46));
      entry.setUint32(0, 0x02014b50, true);
      entry.setUint16(4, 20, true);
      entry.setUint16(6, 20, true);
      entry.setUint16(12, time, true);
      entry.setUint16(14, date, true);
      entry.setUint32(16, crc, true);
      entry.setUint32(20, data.length, true);
      entry.setUint32(24, data.length, true);
      entry.setUint16(28, name.length, true);
      entry.setUint32(42, offset, true);
      central.push(entry, name);

      offset += 30 + name.length + data.length;
      centralSize += 46 + name.length;
    }
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);
    return new Blob([...local, ...central, end], { type });
  }

  // ---------- страницы ----------

  function page(title, body, lang) {
    return (
      '<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n' +
      `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${lang}" xml:lang="${lang}">` +
      `<head><meta charset="utf-8"/><title>${escape(title)}</title>` +
      '<link rel="stylesheet" type="text/css" href="style.css"/></head>' +
      `<body>${body}</body></html>`
    );
  }

  function text(el, lines, base) {
    return `<div class="text${lines ? ' lines' : ''}">${toXhtml(el, base, { lines }).replace(XML_BAD, '')}</div>`;
  }

  function sections(list, base) {
    return list
      .map(
        (s) =>
          `<div class="section">${s.heading ? `<h3>${escape(s.heading)}</h3>` : ''}${text(s.el, s.lines, base)}</div>`,
      )
      .join('');
  }

  function titlePage(work) {
    const parts = [`<h1>${escape(work.title)}</h1>`];
    if (work.authors.length) parts.push(`<p class="byline">${escape(work.authors.join(', '))}</p>`);
    parts.push(`<p class="source">${escape(work.site)}: <a href="${escape(work.url)}">${escape(work.url)}</a></p>`);
    if (work.meta.length) {
      parts.push('<div class="meta">');
      for (const m of work.meta) parts.push(`<p><b>${escape(m.label)}</b> ${escape(m.value)}</p>`);
      parts.push('</div>');
    }
    parts.push(sections(work.preface, work.url));
    return parts.join('');
  }

  function chapterPage(chapter, label, base) {
    return (
      `<h2 class="chapter">${escape(label)}</h2>` +
      sections(chapter.preface, base) +
      text(chapter.body, chapter.lines, base) +
      sections(chapter.endNotes, base)
    );
  }

  /** Язык книги — по буквам названия и начала текста: кириллица → ru, иначе en. Ридеру он нужен для переносов. */
  function language(work) {
    const sample = `${work.title} ${work.chapters[0]?.body.textContent.slice(0, 3000) ?? ''}`;
    const cyrillic = sample.match(/[а-яёіїєґқңғүұһә]/gi)?.length ?? 0;
    const latin = sample.match(/[a-z]/gi)?.length ?? 0;
    return cyrillic > latin ? 'ru' : 'en';
  }

  function build(work) {
    const lang = language(work);
    const id = work.url;
    // Без названия главы в оглавлении было бы пусто: «Глава 1» или, у работы из одной главы, её название.
    const label = (chapter, index) =>
      chapter.title || (work.chapters.length === 1 ? work.title : FBS.t('epubChapter', index + 1));

    const pages = [{ file: 'title.xhtml', label: work.title, html: page(work.title, titlePage(work), lang) }];
    work.chapters.forEach((chapter, index) => {
      const name = label(chapter, index);
      pages.push({
        file: `chapter${String(index + 1).padStart(4, '0')}.xhtml`,
        label: name,
        html: page(name, chapterPage(chapter, name, work.url), lang),
      });
    });
    if (work.endNotes.length) {
      const name = work.endNotes[0].heading?.replace(/:$/, '') || FBS.t('epubNotes');
      pages.push({ file: 'notes.xhtml', label: name, html: page(name, sections(work.endNotes, work.url), lang) });
    }

    const nav = page(
      work.title,
      '<nav epub:type="toc" id="toc"><ol>' +
        pages.map((p) => `<li><a href="${p.file}">${escape(p.label)}</a></li>`).join('') +
        '</ol></nav>',
      lang,
    );

    const ncx =
      '<?xml version="1.0" encoding="utf-8"?>\n' +
      '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">' +
      `<head><meta name="dtb:uid" content="${escape(id)}"/></head>` +
      `<docTitle><text>${escape(work.title)}</text></docTitle><navMap>` +
      pages
        .map(
          (p, i) =>
            `<navPoint id="np${i + 1}" playOrder="${i + 1}"><navLabel><text>${escape(p.label)}</text></navLabel>` +
            `<content src="${p.file}"/></navPoint>`,
        )
        .join('') +
      '</navMap></ncx>';

    const modified = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    const opf =
      '<?xml version="1.0" encoding="utf-8"?>\n' +
      `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="${lang}">` +
      '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">' +
      `<dc:identifier id="uid">${escape(id)}</dc:identifier>` +
      `<dc:title>${escape(work.title)}</dc:title>` +
      `<dc:language>${lang}</dc:language>` +
      work.authors.map((a) => `<dc:creator>${escape(a)}</dc:creator>`).join('') +
      `<dc:publisher>${escape(work.site)}</dc:publisher>` +
      `<dc:source>${escape(work.url)}</dc:source>` +
      `<meta property="dcterms:modified">${modified}</meta>` +
      '</metadata><manifest>' +
      '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>' +
      '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>' +
      '<item id="css" href="style.css" media-type="text/css"/>' +
      pages.map((p, i) => `<item id="p${i + 1}" href="${p.file}" media-type="application/xhtml+xml"/>`).join('') +
      '</manifest><spine toc="ncx">' +
      pages.map((_, i) => `<itemref idref="p${i + 1}"/>`).join('') +
      '</spine></package>';

    const container =
      '<?xml version="1.0" encoding="utf-8"?>\n' +
      '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles>' +
      '<rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>' +
      '</rootfiles></container>';

    return zip(
      [
        { name: 'mimetype', text: 'application/epub+zip' },
        { name: 'META-INF/container.xml', text: container },
        { name: 'OEBPS/content.opf', text: opf },
        { name: 'OEBPS/nav.xhtml', text: nav },
        { name: 'OEBPS/toc.ncx', text: ncx },
        { name: 'OEBPS/style.css', text: CSS },
        ...pages.map((p) => ({ name: `OEBPS/${p.file}`, text: p.html })),
      ],
      'application/epub+zip',
    );
  }

  FBS.epub = { build };
})();
