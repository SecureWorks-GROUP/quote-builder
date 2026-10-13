// Client quote PDF, built in the browser with jsPDF. It follows the premium quote template
// the fence and patio tools share (fence-designer index.html `_swFenceQuoteCSS`, itself a
// port of the patio quote): navy top band with the white logo and an orange edge tick, Plus
// Jakarta Sans, warm paper ground, small tracked orange labels, sharp corners, a navy table
// head and a navy total block with an orange stripe. Those tools draw the page as HTML and
// paste it in as a picture; here it is drawn as real text, so the PDF stays small enough to
// upload on a phone signal and its words can be read back and checked.
// Three documents come from one scope: the client quote (charge lines only; internal cost
// lines never reach it), the scope of works (the client lines with their quantities and
// units, no dollar amount, no Labour allowed section and no figure from the internal cost
// table) and the material order list (our costs by supplier, internal, never for the client).
(function () {
  'use strict';
  var L = window.QBLib;

  // The template's palette, by its CSS variable names.
  var ORANGE = [241, 90, 41];       // --orange-700
  var ORANGE_SOFT = [244, 132, 95]; // --orange-500
  var NAVY = [26, 39, 46];          // --blue-950
  var DARK = [41, 60, 70];          // --blue-800
  var MID = [76, 106, 124];         // --blue-600
  var SOFT = [143, 164, 178];       // --blue-400
  var LINE = [212, 222, 228];       // --blue-200
  var PALE = [237, 241, 244];       // --blue-100
  var WARM = [248, 246, 243];       // --warm-100
  var GROUND = [252, 251, 250];     // --warm-50
  var HERO_NOTE = [190, 199, 204];
  var BODY = [50, 50, 50];
  var WHITE = [255, 255, 255];

  // The template is drawn 794 px wide on A4, so its px sizes convert straight to mm.
  var PX = 210 / 794, PT = 0.3528;
  var PAGE_W = 210, PAGE_H = 297, MARGIN = 52 * PX, CONTENT_W = PAGE_W - MARGIN * 2;
  var BAND_H = 22, EDGE_H = 4 * PX, TICK_W = 120 * PX, PAGE_TOP = BAND_H + 11;
  var FOOT_Y = PAGE_H - 13, CONTENT_BOTTOM = FOOT_Y - 5;
  var PAD = 3.5;

  var FONT = 'PlusJakartaSans';
  var FONT_FILES = { normal: 'PlusJakartaSans-Regular.ttf', bold: 'PlusJakartaSans-Bold.ttf', extrabold: 'PlusJakartaSans-ExtraBold.ttf' };

  var logoCache = null, fontCache = null;
  // The typeface of the document being built: the template's, or Helvetica when it did not load.
  var face = 'helvetica';

  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
      r.readAsDataURL(blob);
    });
  }

  async function loadLogo() {
    if (logoCache) return logoCache;
    try {
      var res = await fetch('assets/logo-white.png');
      if (!res.ok) return null;
      logoCache = await blobToDataUrl(await res.blob());
      return logoCache;
    } catch (e) { return null; }
  }

  // Plus Jakarta Sans ships in assets/fonts (SIL Open Font License) so the PDF never waits
  // on a font from another site. If a file will not load, the PDF is still made, in Helvetica.
  async function loadFonts() {
    if (fontCache) return fontCache;
    try {
      var out = {};
      for (var style in FONT_FILES) {
        var res = await fetch('assets/fonts/' + FONT_FILES[style]);
        if (!res.ok) return null;
        out[style] = (await blobToDataUrl(await res.blob())).split(',')[1];
      }
      fontCache = out;
      return fontCache;
    } catch (e) { return null; }
  }

  // Load a photo and shrink it so the PDF stays small enough to upload from a phone signal.
  async function loadPhoto(url, maxPx) {
    var res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error('photo ' + res.status);
    var blob = await res.blob();
    var src = await blobToDataUrl(blob);
    var img = await new Promise(function (resolve, reject) {
      var i = new Image();
      i.onload = function () { resolve(i); };
      i.onerror = function () { reject(new Error('photo decode')); };
      i.src = src;
    });
    var scale = Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight));
    var w = Math.max(1, Math.round(img.naturalWidth * scale));
    var h = Math.max(1, Math.round(img.naturalHeight * scale));
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    return { data: c.toDataURL('image/jpeg', 0.8), w: w, h: h };
  }

  function newDoc(fonts) {
    var doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', compress: true });
    face = 'helvetica';
    if (fonts) {
      Object.keys(FONT_FILES).forEach(function (style) {
        doc.addFileToVFS(FONT_FILES[style], fonts[style]);
        doc.addFont(FONT_FILES[style], FONT, style);
      });
      face = FONT;
    }
    return doc;
  }

  // weight is 'normal', 'bold' or 'extrabold'; Helvetica has no extra bold, so it gets bold.
  function type(doc, weight, size, color) {
    doc.setFont(face, face === FONT || weight === 'normal' ? weight : 'bold');
    doc.setFontSize(size);
    if (color) doc.setTextColor.apply(doc, color);
  }

  function box(doc, color, x, y, w, h) {
    doc.setFillColor.apply(doc, color);
    doc.rect(x, y, w, h, 'F');
  }

  function rule(doc, y, color) {
    doc.setDrawColor.apply(doc, color || LINE);
    doc.setLineWidth(0.2);
    doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  }

  // The template's small label: capitals, bold, letter-spaced. Only the document's own fixed
  // words go through here. Nothing a person typed is ever put in capitals.
  function label(doc, text, x, y, color, size, align) {
    size = size || 7.5;
    type(doc, 'bold', size, color || ORANGE);
    var t = String(text).toUpperCase(), gap = 0.2 * size * PT;
    if (align === 'right') x -= doc.getTextWidth(t) + gap * (t.length - 1);
    doc.text(t, x, y, { charSpace: gap });
  }

  // Paper ground and the top band, on every page: logo left, reference and date right.
  function band(doc, logo, ref, dateText) {
    box(doc, GROUND, 0, 0, PAGE_W, PAGE_H);
    box(doc, NAVY, 0, 0, PAGE_W, BAND_H);
    box(doc, DARK, 0, BAND_H - EDGE_H, PAGE_W, EDGE_H);
    box(doc, ORANGE, 0, BAND_H - EDGE_H, TICK_W, EDGE_H);
    var mid = (BAND_H - EDGE_H) / 2;
    // assets/logo-white.png is 1600 x 319 (the old "WA" mark is cropped off; "Group" is drawn as text).
    var logoH = 9, logoW = logoH * (1600 / 319);
    if (logo) {
      doc.addImage(logo, 'PNG', MARGIN - 1, mid - logoH / 2, logoW, logoH);
      type(doc, 'normal', 6.5, SOFT);
      doc.text('Group', MARGIN - 1 + logoW + 0.4, mid + 2.1);
    } else {
      type(doc, 'extrabold', 15, WHITE);
      doc.text('SecureWorks Group', MARGIN, mid + 1.9);
    }
    type(doc, 'bold', 8.25, WHITE);
    doc.text(ref, PAGE_W - MARGIN, mid - 0.7, { align: 'right' });
    type(doc, 'normal', 8.25, SOFT);
    doc.text(dateText, PAGE_W - MARGIN, mid + 4, { align: 'right' });
  }

  // The slate block under the band on page 1 that says what the document is. The fence and
  // patio quotes lay a job photograph behind it; this tool has no such photograph, so it is plain.
  // o: { eyebrow, title, strong, note }; returns the y where the content starts.
  function hero(doc, o) {
    var parts = [];
    if (o.eyebrow) parts.push({ h: 6.4, draw: function (y) { label(doc, o.eyebrow, MARGIN, y + 2.6, ORANGE_SOFT); } });
    function block(text, weight, size, color, lh, gapAfter) {
      type(doc, weight, size);
      var lines = doc.splitTextToSize(String(text), CONTENT_W - 4);
      parts.push({ h: lines.length * lh + gapAfter, draw: function (y) {
        type(doc, weight, size, color);
        lines.forEach(function (ln, i) { doc.text(ln, MARGIN, y + lh * 0.74 + i * lh); });
      } });
    }
    block(o.title, 'extrabold', 19, WHITE, 8, 1.2);
    if (o.strong) block(o.strong, 'bold', 10.5, WHITE, 5, 0.8);
    if (o.note) block(o.note, 'normal', 8.25, HERO_NOTE, 4.4, 0);
    var h = 7.5 + parts.reduce(function (a, p) { return a + p.h; }, 0) + 6;
    box(doc, DARK, 0, BAND_H, PAGE_W, h);
    var y = BAND_H + 7.5;
    parts.forEach(function (p) { p.draw(y); y += p.h; });
    return BAND_H + h + 7.5;
  }

  // A heading inside the page, with the template's short orange bar under it.
  function heading(doc, text, y) {
    type(doc, 'extrabold', 16, DARK);
    doc.text(text, MARGIN, y + 5.6);
    box(doc, ORANGE, MARGIN, y + 8.8, 44 * PX, 3 * PX);
    return y + 8.8 + 3 * PX + 6;
  }

  function section(doc, text, y) {
    label(doc, text, MARGIN, y + 2.7, ORANGE);
    return y + 6.6;
  }

  // One label over its value, wrapped to the width. Returns the y under it.
  function pair(doc, r, x, y, w, big) {
    label(doc, r[0], x, y + 2.4, big ? ORANGE : MID, big ? 7.5 : 6.2);
    y += big ? 5.4 : 4;
    type(doc, big ? 'extrabold' : 'bold', big ? 17 : 9, DARK);
    var lh = big ? 7.2 : 4.4;
    doc.splitTextToSize(String(r[1]), w).forEach(function (ln) {
      doc.text(ln, x, y + lh * 0.74);
      y += lh;
    });
    return y + 2.2;
  }

  // Label and value pairs under the hero, closed by a hairline: the left ones two across,
  // the right ones stacked. `lead` prints the first left pair large, on a line of its own,
  // as the template does with who the quote is for.
  function details(doc, y, left, right, lead) {
    var leftW = CONTENT_W * 0.56, gap = 8, half = (leftW - gap) / 2;
    var ly = y, ry = y;
    if (lead) ly = pair(doc, left[0], MARGIN, ly, leftW, true) + 0.6;
    var rest = lead ? left.slice(1) : left;
    for (var i = 0; i < rest.length; i += 2) {
      var a = pair(doc, rest[i], MARGIN, ly, half);
      var b = rest[i + 1] ? pair(doc, rest[i + 1], MARGIN + half + gap, ly, half) : a;
      ly = Math.max(a, b);
    }
    right.forEach(function (r) { ry = pair(doc, r, MARGIN + leftW + gap, ry, CONTENT_W - leftW - gap); });
    var bottom = Math.max(ly, ry) + 1.2;
    rule(doc, bottom);
    return bottom + 5.6;
  }

  function partyRows(job) {
    var addr = L.addressLine(job);
    var left = [], right = [];
    if (job.type === 'miscellaneous') {
      left.push(['Prepared for', job.client_name || 'Client']);
      if (job.client_phone) left.push(['Phone', job.client_phone]);
      if (job.client_email) left.push(['Email', job.client_email]);
      right.push(['Site address', addr || 'To be confirmed']);
      right.push(['Job number', job.job_number || '']);
    } else {
      left.push(['Prepared for', job.builder_name || job.client_name || 'Client']);
      if (job.builder_work_order) left.push(['Work order', job.builder_work_order]);
      if (job.builder_purchase_order) left.push(['Purchase order', job.builder_purchase_order]);
      if (job.builder_name && job.client_name) right.push(['Property owner', job.client_name]);
      right.push(['Site address', addr || 'To be confirmed']);
      right.push(['Job number', job.job_number || '']);
    }
    return { left: left, right: right };
  }

  // Running text that carries on over the page. A blank line never opens a page.
  function paragraphs(doc, text, y, newPage) {
    var lh = 4.9;
    type(doc, 'normal', 9.4, BODY);
    doc.splitTextToSize(text, CONTENT_W).forEach(function (ln) {
      if (y + lh > CONTENT_BOTTOM) {
        y = newPage();
        type(doc, 'normal', 9.4, BODY);
        if (!ln.trim()) return;
      }
      doc.text(ln, MARGIN, y + 3.5);
      y += lh;
    });
    return y + 6;
  }

  // Columns: description | qty | unit | unit price | amount (ex GST)
  var COLS = [
    { key: 'desc', w: CONTENT_W - 17 - 18 - 27 - 30, align: 'left', title: 'Description' },
    { key: 'qty', w: 17, align: 'right', title: 'Qty' },
    { key: 'unit', w: 18, align: 'left', title: 'Unit' },
    { key: 'price', w: 27, align: 'right', title: 'Unit price' },
    { key: 'amount', w: 30, align: 'right', title: 'Amount', bold: true }
  ];

  function tableHead(doc, y, cols) {
    box(doc, NAVY, MARGIN, y, CONTENT_W, 7.4);
    var x = MARGIN;
    cols.forEach(function (c) {
      label(doc, c.title, c.align === 'right' ? x + c.w - PAD : x + PAD, y + 4.8, WHITE, 6.2, c.align);
      x += c.w;
    });
    return y + 7.4;
  }

  // The one table all three documents use: the first column wraps, the others are one line.
  // A row is never split over a page, and the head is drawn again on the page it moves to.
  function drawTable(doc, y, cols, rows, newPage) {
    y = tableHead(doc, y, cols);
    rows.forEach(function (cells, idx) {
      type(doc, 'normal', 9, BODY);
      var dl = doc.splitTextToSize(String(cells[cols[0].key] || ''), cols[0].w - PAD * 2);
      var rowH = Math.max(8, dl.length * 4.3 + 3.7);
      if (y + rowH > CONTENT_BOTTOM) y = tableHead(doc, newPage(), cols);
      box(doc, idx % 2 === 1 ? WARM : WHITE, MARGIN, y, CONTENT_W, rowH);
      doc.setDrawColor.apply(doc, PALE);
      doc.setLineWidth(0.2);
      doc.line(MARGIN, y + rowH, MARGIN + CONTENT_W, y + rowH);
      var x = MARGIN;
      cols.forEach(function (c, ci) {
        type(doc, c.bold ? 'bold' : 'normal', 9, ci === 0 ? BODY : DARK);
        var tx = c.align === 'right' ? x + c.w - PAD : x + PAD;
        var value = cells[c.key] == null ? '' : String(cells[c.key]);
        doc.text(ci === 0 ? dl : value, tx, y + 5.2, { align: c.align, lineHeightFactor: 4.3 / (9 * PT) });
        x += c.w;
      });
      y += rowH;
    });
    return y;
  }

  // The navy block the total sits in: label and note left, the figure large on the right.
  function totalBlock(doc, y, title, amount, note) {
    var h = 23;
    box(doc, NAVY, MARGIN, y, CONTENT_W, h);
    box(doc, ORANGE, MARGIN, y, 1.3, h);
    label(doc, title, MARGIN + 7.5, y + 9.4, ORANGE_SOFT);
    type(doc, 'normal', 8, SOFT);
    doc.text(note, MARGIN + 7.5, y + 15.2);
    type(doc, 'extrabold', 26, WHITE);
    doc.text(amount, PAGE_W - MARGIN - 7.5, y + 15.3, { align: 'right' });
    return y + h;
  }

  function build(opts) {
    var doc = newDoc(opts.fonts);
    var job = opts.job, v = opts.version;
    var quoteNumber = opts.quoteNumber || 'DRAFT';
    var dateText = L.fmtDate(opts.date || new Date().toISOString());
    var logo = opts.logo;
    var variation = opts.kind === 'variation';
    var newPage = function () {
      doc.addPage();
      band(doc, logo, quoteNumber, dateText);
      return PAGE_TOP;
    };

    band(doc, logo, quoteNumber, dateText);
    var heading = variation ? 'Variation quote' : 'Quote';
    var y = hero(doc, {
      eyebrow: v.title ? heading : '',
      title: v.title || heading,
      note: variation && opts.variationNumber ? 'Variation ' + opts.variationNumber + ' to the works on job ' + (job.job_number || '') : ''
    });

    var p = partyRows(job);
    y = details(doc, y, p.left, p.right, true);

    var narrative = String(v.narrative || '').trim();
    if (narrative) {
      y = section(doc, 'Scope of works', y);
      y = paragraphs(doc, narrative, y, newPage);
    }

    if (y + 30 > CONTENT_BOTTOM) y = newPage();
    y = section(doc, variation ? 'Variation pricing' : 'Pricing', y);

    var lines = L.cleanChargeLines(v.charge_lines);
    var anyGstFree = false;
    y = drawTable(doc, y, COLS, lines.map(function (l) {
      var gstFree = l.gst_applies === false;
      if (gstFree) anyGstFree = true;
      return {
        desc: l.description,
        qty: L.qtyText(l.qty),
        unit: l.unit,
        price: L.money(l.unit_price_ex_gst),
        amount: L.money(L.chargeLineTotal(l)) + (gstFree ? '*' : '')
      };
    }), newPage);

    // The two sums and the total block stay together on one page.
    var t = L.totals([], lines);
    if (y + 42 > CONTENT_BOTTOM) y = newPage();
    y += 3;
    var right = PAGE_W - MARGIN - PAD;
    [['Subtotal (ex GST)', L.money(t.charge_total_ex_gst)], ['GST', L.money(t.charge_gst)]].forEach(function (r) {
      type(doc, 'normal', 8.6, MID);
      doc.text(r[0], right - 36, y + 3.7, { align: 'right' });
      type(doc, 'bold', 9, DARK);
      doc.text(r[1], right, y + 3.7, { align: 'right' });
      y += 5.4;
    });
    if (anyGstFree) {
      type(doc, 'normal', 7.5, MID);
      doc.text('* GST free', MARGIN + PAD, y - 1.7);
    }
    y += 3;
    y = totalBlock(doc, y, variation ? 'Variation total' : 'Total price', L.money(t.charge_total_inc_gst), 'Includes GST of ' + L.money(t.charge_gst));
    y += 6.5;

    var terms = [
      'This quote is valid for 30 days from the date above.',
      'It is based on the scope of works described here. Additional works, site conditions not visible at the time of quoting, or requested changes will be quoted separately as a variation.',
      'All prices are in Australian dollars. GST is shown separately.'
    ];
    type(doc, 'normal', 6.9);
    var termLines = terms.map(function (s) { return doc.splitTextToSize(s, CONTENT_W - 3.4); });
    var termsH = 6.6 + termLines.reduce(function (a, ls) { return a + ls.length * 3.5 + 1; }, 0);
    if (y + termsH > CONTENT_BOTTOM) y = newPage();
    y = section(doc, 'Terms', y);
    termLines.forEach(function (ls) {
      box(doc, SOFT, MARGIN, y + 1.1, 0.9, 0.9);
      type(doc, 'normal', 6.9, MID);
      ls.forEach(function (ln) { doc.text(ln, MARGIN + 3.4, y + 2.5); y += 3.5; });
      y += 1;
    });

    photoPages(doc, opts.photos, newPage);

    return finish(doc, quoteNumber, opts.preparedBy);
  }

  // Site photos, two to a row, starting on a fresh page.
  function photoPages(doc, list, newPage) {
    var photos = (list || []).filter(function (ph) { return ph && ph.img; });
    if (!photos.length) return;
    var y = heading(doc, 'Site photos', newPage());
    var gap = 6, cardW = (CONTENT_W - gap) / 2, pad = 4, imgMaxH = 62;
    var col = 0, rowTop = y, rowH = 0;
    photos.forEach(function (ph) {
      type(doc, 'normal', 8, BODY);
      var cap = ph.caption ? doc.splitTextToSize(ph.caption, cardW - pad * 2) : [];
      var iw = cardW - pad * 2, ih = iw * (ph.img.h / ph.img.w);
      if (ih > imgMaxH) { ih = imgMaxH; iw = ih * (ph.img.w / ph.img.h); }
      var h = pad + imgMaxH + (cap.length ? 3 + cap.length * 3.8 : 0) + pad;
      if (col === 0 && rowTop + h > CONTENT_BOTTOM) { rowTop = newPage(); rowH = 0; }
      var cx = MARGIN + col * (cardW + gap);
      doc.setFillColor.apply(doc, WHITE);
      doc.setDrawColor.apply(doc, LINE);
      doc.setLineWidth(0.2);
      doc.rect(cx, rowTop, cardW, h, 'FD');
      doc.addImage(ph.img.data, 'JPEG', cx + (cardW - iw) / 2, rowTop + pad + (imgMaxH - ih) / 2, iw, ih);
      if (cap.length) {
        type(doc, 'normal', 8, BODY);
        doc.text(cap, cx + pad, rowTop + pad + imgMaxH + 5.2, { lineHeightFactor: 3.8 / (8 * PT) });
      }
      rowH = Math.max(rowH, h);
      col++;
      if (col === 2) { col = 0; rowTop += rowH + gap; rowH = 0; }
    });
  }

  // One line under a hairline: who we are on the left, the page and reference on the right.
  // "Prepared by" drops to a second line when the name is too long to share the first.
  function footer(doc, page, pages, ref, preparedBy) {
    var co = window.QB_CONFIG.company, sep = '  ·  ', y = FOOT_Y + 4.6;
    rule(doc, FOOT_Y);
    type(doc, 'bold', 6.6, DARK);
    doc.text(co.name, MARGIN, y);
    var x = MARGIN + doc.getTextWidth(co.name);
    type(doc, 'normal', 6.6, MID);
    var rest = sep + 'ABN ' + co.abn + sep + 'Phone ' + co.phone;
    var by = preparedBy ? 'Prepared by ' + preparedBy : '';
    var pageText = 'Page ' + page + ' of ' + pages + sep + ref;
    if (by && x + doc.getTextWidth(rest + sep + by) <= PAGE_W - MARGIN - doc.getTextWidth(pageText) - 6) {
      rest += sep + by;
      by = '';
    }
    doc.text(rest, x, y);
    doc.text(pageText, PAGE_W - MARGIN, y, { align: 'right' });
    if (by) doc.text(by, MARGIN, y + 3.6);
  }

  function finish(doc, ref, preparedBy) {
    var pages = doc.internal.getNumberOfPages();
    for (var pg = 1; pg <= pages; pg++) {
      doc.setPage(pg);
      footer(doc, pg, pages, ref, preparedBy);
    }
    return doc.output('blob');
  }

  function jobRows(job) {
    var left = [['Job number', job.job_number || '']], right = [['Site address', L.addressLine(job) || 'To be confirmed']];
    if (job.builder_name) left.push(['Builder', job.builder_name]);
    if (job.builder_work_order) left.push(['Builder work order', job.builder_work_order]);
    if (job.client_name) right.push([job.builder_name ? 'Property owner' : 'Client', job.client_name]);
    return { left: left, right: right };
  }

  // The opening the scope of works and the material order list share: band, what the
  // document is and what it is for, the job details.
  function startDoc(opts, title, note) {
    var doc = newDoc(opts.fonts);
    var ref = opts.quoteNumber || 'DRAFT';
    var dateText = L.fmtDate(opts.date || new Date().toISOString());
    var newPage = function () {
      doc.addPage();
      band(doc, opts.logo, ref, dateText);
      return PAGE_TOP;
    };
    band(doc, opts.logo, ref, dateText);
    var y = hero(doc, { title: title, strong: opts.version.title, note: note });
    var p = jobRows(opts.job);
    y = details(doc, y, p.left, p.right, false);
    return { doc: doc, y: y, newPage: newPage, ref: ref };
  }

  function plainLine(doc, text, y) {
    type(doc, 'normal', 9.4, BODY);
    doc.text(text, MARGIN, y + 3.5);
    return y + 6;
  }

  var WORK_COLS = [
    { key: 'desc', w: CONTENT_W - 22 - 26, align: 'left', title: 'Work' },
    { key: 'qty', w: 22, align: 'right', title: 'Qty' },
    { key: 'unit', w: 26, align: 'left', title: 'Unit' }
  ];
  var ORDER_COLS = [
    { key: 'desc', w: CONTENT_W - 17 - 18 - 27 - 30, align: 'left', title: 'Item' },
    { key: 'qty', w: 17, align: 'right', title: 'Qty' },
    { key: 'unit', w: 18, align: 'left', title: 'Unit' },
    { key: 'cost', w: 27, align: 'right', title: 'Unit cost' },
    { key: 'total', w: 30, align: 'right', title: 'Cost', bold: true }
  ];

  // Scope of works: the write-up, the client lines as description, quantity and unit (as
  // they print on the client quote) and the ticked photos. It is never given the cost
  // lines, so it has no Labour allowed section and no figure from the internal cost table,
  // and it prints no dollar amount of any kind. A client line in hours prints its hours like
  // any other quantity: Hugo edits the client line if he does not want them shown.
  function buildScope(opts) {
    var d = startDoc(opts, 'Scope of works', 'Scope of works for the job. No prices.');
    var doc = d.doc, y = d.y, v = opts.version;

    var narrative = String(v.narrative || '').trim();
    if (narrative) {
      y = section(doc, 'What we will do', y);
      y = paragraphs(doc, narrative, y, d.newPage);
    }

    var work = L.cleanChargeLines(v.charge_lines);
    if (work.length) {
      if (y + 30 > CONTENT_BOTTOM) y = d.newPage();
      y = section(doc, 'Work items', y);
      drawTable(doc, y, WORK_COLS, work.map(function (l) { return { desc: l.description, qty: L.qtyText(l.qty), unit: l.unit }; }), d.newPage);
    }

    photoPages(doc, opts.photos, d.newPage);
    return finish(doc, d.ref, opts.preparedBy);
  }

  // A supplier's name over its table. The name is printed as it was typed.
  function supplierHead(doc, text, y) {
    box(doc, ORANGE, MARGIN, y + 5.2, 14 * PX, 2 * PX);
    type(doc, 'bold', 10.5, DARK);
    doc.text(text, MARGIN + 14 * PX + 2.4, y + 6.8);
    return y + 10.5;
  }

  // Material order list: what to order from each supplier and what it costs us. Material
  // lines only; labour and Other lines are not on it.
  function buildMaterials(opts) {
    var d = startDoc(opts, 'Material order list', 'Internal: our costs, ex GST. Not for the client.');
    var doc = d.doc, y = d.y;
    var list = L.materialsBySupplier(opts.costLines);
    if (!list.line_count) y = plainLine(doc, 'No Material lines on this scope yet.', y);
    list.groups.forEach(function (g) {
      if (y + 36 > CONTENT_BOTTOM) y = d.newPage();
      y = supplierHead(doc, g.supplier, y);
      y = drawTable(doc, y, ORDER_COLS, g.lines.map(function (l) {
        return { desc: l.description, qty: L.qtyText(l.qty), unit: l.unit, cost: L.money(l.unit_cost_ex_gst), total: L.money(l.line_total_ex_gst) };
      }), d.newPage);
      if (y + 9 > CONTENT_BOTTOM) y = d.newPage();
      type(doc, 'bold', 9, DARK);
      doc.text(g.supplier + ' total  ' + L.money(g.total_ex_gst), PAGE_W - MARGIN - PAD, y + 5.6, { align: 'right' });
      y += 9;
    });
    if (list.line_count) {
      if (y + 18 > CONTENT_BOTTOM) y = d.newPage();
      y += 4;
      box(doc, NAVY, MARGIN, y, CONTENT_W, 12);
      box(doc, ORANGE, MARGIN, y, 1.3, 12);
      type(doc, 'bold', 10, WHITE);
      doc.text('Materials total (ex GST)', MARGIN + 7.5, y + 7.6);
      type(doc, 'extrabold', 12, WHITE);
      doc.text(L.money(list.total_ex_gst), PAGE_W - MARGIN - 7.5, y + 7.8, { align: 'right' });
      y += 16;
    }
    if (list.not_listed) {
      if (y + 8 > CONTENT_BOTTOM) y = d.newPage();
      plainLine(doc, notListedText(list.not_listed), y);
    }
    return finish(doc, d.ref, opts.preparedBy);
  }

  function notListedText(n) {
    return n + ' cost line' + (n > 1 ? 's are' : ' is') + ' not marked Material, so ' + (n > 1 ? 'they are' : 'it is') + ' not on this list.';
  }

  // photos: [{ url, caption }]. A photo that will not load is left out and counted.
  async function loadPhotos(list) {
    var loaded = [], missing = 0;
    for (var i = 0; i < (list || []).length; i++) {
      try { loaded.push({ caption: list[i].caption, img: await loadPhoto(list[i].url, 1400) }); }
      catch (e) { missing++; }
    }
    return { loaded: loaded, missing: missing };
  }

  window.QBPdf = {
    // Loads the logo, the typeface and the photos, then builds the PDF. Returns
    // { blob, missingPhotos }: the caller decides whether a PDF with photos missing is acceptable.
    async render(opts) {
      var logo = await loadLogo(), fonts = await loadFonts(), ph = await loadPhotos(opts.photos);
      return { blob: build(Object.assign({}, opts, { logo: logo, fonts: fonts, photos: ph.loaded })), missingPhotos: ph.missing };
    },
    // The scope of works takes the same photos as the quote and never the cost lines.
    async renderScope(opts) {
      var logo = await loadLogo(), fonts = await loadFonts(), ph = await loadPhotos(opts.photos);
      var v = opts.version || {};
      var clientSide = { title: v.title, narrative: v.narrative, charge_lines: v.charge_lines };
      return { blob: buildScope(Object.assign({}, opts, { version: clientSide, logo: logo, fonts: fonts, photos: ph.loaded })), missingPhotos: ph.missing };
    },
    // opts.costLines are the internal cost lines: this one is internal, with no photos.
    async renderMaterials(opts) {
      return { blob: buildMaterials(Object.assign({}, opts, { logo: await loadLogo(), fonts: await loadFonts() })), missingPhotos: 0 };
    },
    notListedText: notListedText,
    // Where the page furniture sits, in mm from the top, for the layout tests.
    LAYOUT: { bandBottom: BAND_H, contentBottom: CONTENT_BOTTOM, footTop: FOOT_Y }
  };
})();
