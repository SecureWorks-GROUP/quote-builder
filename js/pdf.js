// Client quote PDF, built in the browser with jsPDF. Follows the SecureWorks PDF brand
// template (patio repo SecureWorks_PDF_Brand_Template_Spec.md): orange header band, dark
// dusty blue section bars, tinted alternating rows, dark price block, orange footer rule.
// Three documents come from one scope: the client quote (charge lines only; internal cost
// lines never reach it), the scope of works (the client lines with their quantities and
// units, no dollar amount, no Labour allowed section and no figure from the internal cost
// table) and the material order list (our costs by supplier, internal, never for the client).
(function () {
  'use strict';
  var L = window.QBLib;

  var ORANGE = [241, 90, 41];
  var DARK = [41, 60, 70];
  var MID = [76, 106, 124];
  var TINT = [240, 244, 247];
  var RULE = [220, 220, 220];
  var BODY = [50, 50, 50];

  var PAGE_W = 210, PAGE_H = 297, MARGIN = 20, BAND_H = 30, FOOT_Y = PAGE_H - 22, CONTENT_BOTTOM = PAGE_H - 27;
  var CONTENT_W = PAGE_W - MARGIN * 2;

  var logoCache = null;

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

  function header(doc, logo, quoteNumber, dateText) {
    doc.setFillColor.apply(doc, ORANGE);
    doc.rect(0, 0, PAGE_W, BAND_H, 'F');
    // assets/logo-white.png is 1600 x 319 (the old "WA" mark is cropped off; "Group" is drawn as text).
    var logoH = 10, logoW = logoH * (1600 / 319);
    var logoY = (BAND_H - logoH) / 2;
    if (logo) {
      doc.addImage(logo, 'PNG', MARGIN, logoY, logoW, logoH);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(12);
      doc.setTextColor(255, 255, 255);
      doc.text('Group', MARGIN + logoW + 1.5, logoY + logoH - 2);
    } else {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(20);
      doc.setTextColor(255, 255, 255);
      doc.text('SecureWorks Group', MARGIN, logoY + 8);
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(quoteNumber, PAGE_W - MARGIN, 14, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(dateText, PAGE_W - MARGIN, 20.5, { align: 'right' });
  }

  function footer(doc, page, pages, quoteNumber, preparedBy) {
    var co = window.QB_CONFIG.company;
    doc.setDrawColor.apply(doc, ORANGE);
    doc.setLineWidth(0.5 * 0.3528);
    doc.line(MARGIN, FOOT_Y, PAGE_W - MARGIN, FOOT_Y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor.apply(doc, MID);
    var parts = [co.name, 'ABN ' + co.abn, 'Phone ' + co.phone];
    if (preparedBy) parts.push('Prepared by ' + preparedBy);
    doc.text(parts.join('  |  '), PAGE_W / 2, FOOT_Y + 5, { align: 'center' });
    doc.setFontSize(7);
    doc.text('Page ' + page + ' of ' + pages + '  |  ' + quoteNumber, PAGE_W / 2, FOOT_Y + 9.5, { align: 'center' });
  }

  function pageTitle(doc, text, y) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(17);
    doc.setTextColor.apply(doc, DARK);
    doc.text(text, MARGIN, y);
    doc.setDrawColor.apply(doc, ORANGE);
    doc.setLineWidth(0.8 * 0.3528 * 2);
    doc.line(MARGIN, y + 2.5, MARGIN + 60, y + 2.5);
    return y + 9;
  }

  function sectionBar(doc, text, y) {
    y += 4;
    doc.setFillColor.apply(doc, DARK);
    doc.rect(MARGIN, y, CONTENT_W, 8.5, 'F');
    doc.setFillColor.apply(doc, ORANGE);
    doc.rect(MARGIN, y, 1.1, 8.5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(255, 255, 255);
    doc.text(text, MARGIN + 1.1 + 4, y + 5.8);
    return y + 8.5 + 3;
  }

  // Label/value pairs in a tinted panel, two columns.
  function detailPanel(doc, y, left, right) {
    doc.setFontSize(9);
    var colW = (CONTENT_W - 12 - 6) / 2;
    function measure(rows) {
      var h = 0;
      rows.forEach(function (r) {
        doc.setFont('helvetica', 'bold');
        var lines = doc.splitTextToSize(String(r[1]), colW);
        h += 4 + lines.length * 4.4 + 1.6;
      });
      return h;
    }
    var h = Math.max(measure(left), measure(right)) + 10;
    doc.setFillColor.apply(doc, TINT);
    doc.roundedRect(MARGIN, y, CONTENT_W, h, 2, 2, 'F');
    function draw(rows, x) {
      var yy = y + 6 + 2;
      rows.forEach(function (r) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.5);
        doc.setTextColor.apply(doc, MID);
        doc.text(r[0], x, yy);
        yy += 4.4;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9.5);
        doc.setTextColor.apply(doc, DARK);
        var lines = doc.splitTextToSize(String(r[1]), colW);
        doc.text(lines, x, yy);
        yy += lines.length * 4.4 + 1.6;
      });
    }
    draw(left, MARGIN + 6);
    draw(right, MARGIN + 6 + colW + 6);
    return y + h + 2;
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

  // Columns: description | qty | unit | unit price | amount (ex GST)
  var COLS = [
    { key: 'desc', w: CONTENT_W - 16 - 16 - 27 - 29, align: 'left', title: 'Description' },
    { key: 'qty', w: 16, align: 'right', title: 'Qty' },
    { key: 'unit', w: 16, align: 'left', title: 'Unit' },
    { key: 'price', w: 27, align: 'right', title: 'Unit price' },
    { key: 'amount', w: 29, align: 'right', title: 'Amount' }
  ];

  function tableHeader(doc, y, cols) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor.apply(doc, MID);
    var x = MARGIN;
    (cols || COLS).forEach(function (c) {
      var tx = c.align === 'right' ? x + c.w - 3 : x + 3;
      doc.text(c.title, tx, y + 5, { align: c.align });
      x += c.w;
    });
    doc.setDrawColor.apply(doc, MID);
    doc.setLineWidth(0.5 * 0.3528);
    doc.line(MARGIN, y + 7.5, MARGIN + CONTENT_W, y + 7.5);
    return y + 8;
  }

  function build(opts) {
    var jsPDF = window.jspdf.jsPDF;
    // Tests set QB_PDF_PLAIN to read the PDF text back and prove no cost line leaks into it.
    var doc = new jsPDF({ unit: 'mm', format: 'a4', compress: !window.QB_PDF_PLAIN });
    var job = opts.job, v = opts.version;
    var quoteNumber = opts.quoteNumber || 'DRAFT';
    var dateText = L.fmtDate(opts.date || new Date().toISOString());
    var logo = opts.logo;
    var newPage = function () {
      doc.addPage();
      header(doc, logo, quoteNumber, dateText);
      return BAND_H + 10;
    };

    header(doc, logo, quoteNumber, dateText);
    var y = BAND_H + 12;
    var heading = opts.kind === 'variation' ? 'Variation quote' : 'Quote';
    y = pageTitle(doc, heading, y);
    if (v.title) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor.apply(doc, DARK);
      var tl = doc.splitTextToSize(v.title, CONTENT_W);
      doc.text(tl, MARGIN, y);
      y += tl.length * 5 + 2;
    }
    if (opts.kind === 'variation' && opts.variationNumber) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor.apply(doc, MID);
      doc.text('Variation ' + opts.variationNumber + ' to the works on job ' + (job.job_number || ''), MARGIN, y);
      y += 6;
    }

    var p = partyRows(job);
    y = detailPanel(doc, y, p.left, p.right);

    var narrative = String(v.narrative || '').trim();
    if (narrative) {
      y = sectionBar(doc, 'Scope of works', y);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      doc.setTextColor.apply(doc, BODY);
      var nl = doc.splitTextToSize(narrative, CONTENT_W - 2);
      for (var i = 0; i < nl.length; i++) {
        if (y + 4.6 > CONTENT_BOTTOM) y = newPage();
        doc.text(nl[i], MARGIN + 1, y + 3.5);
        y += 4.6;
      }
      y += 2;
    }

    if (y + 30 > CONTENT_BOTTOM) y = newPage();
    y = sectionBar(doc, opts.kind === 'variation' ? 'Variation pricing' : 'Pricing', y);
    y = tableHeader(doc, y);

    var lines = L.cleanChargeLines(v.charge_lines);
    var anyGstFree = false;
    lines.forEach(function (l, idx) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      var dl = doc.splitTextToSize(l.description, COLS[0].w - 5);
      var rowH = Math.max(7.5, dl.length * 4.2 + 3.3);
      if (y + rowH > CONTENT_BOTTOM) { y = newPage(); y = tableHeader(doc, y); }
      if (idx % 2 === 1) {
        doc.setFillColor.apply(doc, TINT);
        doc.rect(MARGIN, y, CONTENT_W, rowH, 'F');
      }
      doc.setTextColor.apply(doc, BODY);
      var gstFree = l.gst_applies === false;
      if (gstFree) anyGstFree = true;
      var cells = {
        desc: dl,
        qty: L.qtyText(l.qty),
        unit: l.unit,
        price: L.money(l.unit_price_ex_gst),
        amount: L.money(L.chargeLineTotal(l)) + (gstFree ? '*' : '')
      };
      var x = MARGIN;
      COLS.forEach(function (c) {
        var tx = c.align === 'right' ? x + c.w - 3 : x + 3;
        doc.text(cells[c.key], tx, y + 5, { align: c.align });
        x += c.w;
      });
      y += rowH;
    });
    doc.setDrawColor.apply(doc, RULE);
    doc.setLineWidth(0.3 * 0.3528);
    doc.line(MARGIN, y, MARGIN + CONTENT_W, y);
    y += 3;

    var t = L.totals([], lines);
    if (y + 46 > CONTENT_BOTTOM) y = newPage();
    var tx = PAGE_W - MARGIN - 3;
    doc.setFontSize(9.5);
    [['Subtotal (ex GST)', L.money(t.charge_total_ex_gst)], ['GST', L.money(t.charge_gst)]].forEach(function (r) {
      doc.setFont('helvetica', 'normal');
      doc.setTextColor.apply(doc, MID);
      doc.text(r[0], tx - 38, y + 4.5, { align: 'right' });
      doc.setFont('helvetica', 'bold');
      doc.setTextColor.apply(doc, DARK);
      doc.text(r[1], tx, y + 4.5, { align: 'right' });
      y += 6;
    });
    if (anyGstFree) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor.apply(doc, MID);
      doc.text('* GST free', MARGIN + 1, y - 2);
    }
    y += 3;
    var blockW = 92, blockH = 26, bx = PAGE_W - MARGIN - blockW;
    doc.setFillColor.apply(doc, DARK);
    doc.roundedRect(bx, y, blockW, blockH, 2, 2, 'F');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(255, 255, 255);
    doc.text(opts.kind === 'variation' ? 'Variation total' : 'Total price', bx + 6, y + 8);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(22);
    doc.setTextColor.apply(doc, ORANGE);
    doc.text(L.money(t.charge_total_inc_gst), bx + blockW - 6, y + 16, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(190, 199, 204);
    doc.text('Includes GST of ' + L.money(t.charge_gst), bx + blockW - 6, y + 22, { align: 'right' });
    y += blockH + 6;

    var terms = [
      'This quote is valid for 30 days from the date above.',
      'It is based on the scope of works described here. Additional works, site conditions not visible at the time of quoting, or requested changes will be quoted separately as a variation.',
      'All prices are in Australian dollars. GST is shown separately.'
    ];
    doc.setFontSize(7.5);
    var termLines = [];
    terms.forEach(function (s) { termLines = termLines.concat(doc.splitTextToSize('•  ' + s, CONTENT_W - 2)); });
    if (y + 8 + termLines.length * 3.4 > CONTENT_BOTTOM) y = newPage();
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor.apply(doc, DARK);
    doc.text('Terms', MARGIN, y + 3);
    y += 6.5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor.apply(doc, MID);
    termLines.forEach(function (ln) { doc.text(ln, MARGIN + 1, y); y += 3.4; });

    photoPages(doc, opts.photos, newPage);

    return finish(doc, quoteNumber, opts.preparedBy);
  }

  // Site photos, two to a row, starting on a fresh page.
  function photoPages(doc, list, newPage) {
    var photos = (list || []).filter(function (ph) { return ph && ph.img; });
    if (!photos.length) return;
    var y = newPage();
    y = pageTitle(doc, 'Site photos', y + 2);
    var gap = 6, cardW = (CONTENT_W - gap) / 2, pad = 4, imgMaxH = 62;
    var col = 0, rowTop = y, rowH = 0;
    photos.forEach(function (ph) {
      doc.setFontSize(8.5);
      var cap = ph.caption ? doc.splitTextToSize(ph.caption, cardW - pad * 2) : [];
      var iw = cardW - pad * 2, ih = iw * (ph.img.h / ph.img.w);
      if (ih > imgMaxH) { ih = imgMaxH; iw = ih * (ph.img.w / ph.img.h); }
      var h = pad + imgMaxH + (cap.length ? 3 + cap.length * 3.8 : 0) + pad;
      if (col === 0 && rowTop + h > CONTENT_BOTTOM) { rowTop = newPage(); rowH = 0; }
      var cx = MARGIN + col * (cardW + gap);
      doc.setFillColor.apply(doc, TINT);
      doc.roundedRect(cx, rowTop, cardW, h, 2, 2, 'F');
      doc.addImage(ph.img.data, 'JPEG', cx + (cardW - iw) / 2, rowTop + pad + (imgMaxH - ih) / 2, iw, ih);
      if (cap.length) {
        doc.setFont('helvetica', 'normal');
        doc.setTextColor.apply(doc, BODY);
        doc.text(cap, cx + pad, rowTop + pad + imgMaxH + 5);
      }
      rowH = Math.max(rowH, h);
      col++;
      if (col === 2) { col = 0; rowTop += rowH + gap; rowH = 0; }
    });
  }

  function finish(doc, ref, preparedBy) {
    var pages = doc.internal.getNumberOfPages();
    for (var pg = 1; pg <= pages; pg++) {
      doc.setPage(pg);
      footer(doc, pg, pages, ref, preparedBy);
    }
    return doc.output('blob');
  }

  // A plain table for the internal documents: the first column wraps, the others are one line.
  function drawTable(doc, y, cols, rows, newPage) {
    y = tableHeader(doc, y, cols);
    rows.forEach(function (cells, idx) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      var dl = doc.splitTextToSize(String(cells[cols[0].key] || ''), cols[0].w - 5);
      var rowH = Math.max(7.5, dl.length * 4.2 + 3.3);
      if (y + rowH > CONTENT_BOTTOM) { y = newPage(); y = tableHeader(doc, y, cols); }
      if (idx % 2 === 1) {
        doc.setFillColor.apply(doc, TINT);
        doc.rect(MARGIN, y, CONTENT_W, rowH, 'F');
      }
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor.apply(doc, BODY);
      var x = MARGIN;
      cols.forEach(function (c, ci) {
        var tx = c.align === 'right' ? x + c.w - 3 : x + 3;
        var value = cells[c.key] == null ? '' : String(cells[c.key]);
        doc.text(ci === 0 ? dl : value, tx, y + 5, { align: c.align });
        x += c.w;
      });
      y += rowH;
    });
    doc.setDrawColor.apply(doc, RULE);
    doc.setLineWidth(0.3 * 0.3528);
    doc.line(MARGIN, y, MARGIN + CONTENT_W, y);
    return y + 3;
  }

  function jobRows(job) {
    var left = [['Job number', job.job_number || '']], right = [['Site address', L.addressLine(job) || 'To be confirmed']];
    if (job.builder_name) left.push(['Builder', job.builder_name]);
    if (job.builder_work_order) left.push(['Builder work order', job.builder_work_order]);
    if (job.client_name) right.push([job.builder_name ? 'Property owner' : 'Client', job.client_name]);
    return { left: left, right: right };
  }

  // The opening every internal document shares: band, title, what it is for, the job panel.
  function startDoc(opts, title, note) {
    var jsPDF = window.jspdf.jsPDF;
    var doc = new jsPDF({ unit: 'mm', format: 'a4', compress: !window.QB_PDF_PLAIN });
    var ref = opts.quoteNumber || 'DRAFT';
    var dateText = L.fmtDate(opts.date || new Date().toISOString());
    var newPage = function () {
      doc.addPage();
      header(doc, opts.logo, ref, dateText);
      return BAND_H + 10;
    };
    header(doc, opts.logo, ref, dateText);
    var y = pageTitle(doc, title, BAND_H + 12);
    if (opts.version.title) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor.apply(doc, DARK);
      var tl = doc.splitTextToSize(opts.version.title, CONTENT_W);
      doc.text(tl, MARGIN, y);
      y += tl.length * 5 + 2;
    }
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor.apply(doc, MID);
    doc.text(note, MARGIN, y);
    y += 6;
    var p = jobRows(opts.job);
    y = detailPanel(doc, y, p.left, p.right);
    return { doc: doc, y: y, newPage: newPage, ref: ref };
  }

  function plainLine(doc, text, y) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor.apply(doc, BODY);
    doc.text(text, MARGIN + 1, y + 3.5);
    return y + 6;
  }

  var WORK_COLS = [
    { key: 'desc', w: CONTENT_W - 20 - 22, align: 'left', title: 'Work' },
    { key: 'qty', w: 20, align: 'right', title: 'Qty' },
    { key: 'unit', w: 22, align: 'left', title: 'Unit' }
  ];
  var ORDER_COLS = [
    { key: 'desc', w: CONTENT_W - 16 - 16 - 27 - 29, align: 'left', title: 'Item' },
    { key: 'qty', w: 16, align: 'right', title: 'Qty' },
    { key: 'unit', w: 16, align: 'left', title: 'Unit' },
    { key: 'cost', w: 27, align: 'right', title: 'Unit cost' },
    { key: 'total', w: 29, align: 'right', title: 'Cost' }
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
      y = sectionBar(doc, 'What we will do', y);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      doc.setTextColor.apply(doc, BODY);
      doc.splitTextToSize(narrative, CONTENT_W - 2).forEach(function (ln) {
        if (y + 4.6 > CONTENT_BOTTOM) y = d.newPage();
        doc.text(ln, MARGIN + 1, y + 3.5);
        y += 4.6;
      });
      y += 2;
    }

    var work = L.cleanChargeLines(v.charge_lines);
    if (work.length) {
      if (y + 30 > CONTENT_BOTTOM) y = d.newPage();
      y = sectionBar(doc, 'Work items', y);
      y = drawTable(doc, y, WORK_COLS, work.map(function (l) { return { desc: l.description, qty: L.qtyText(l.qty), unit: l.unit }; }), d.newPage);
    }

    photoPages(doc, opts.photos, d.newPage);
    return finish(doc, d.ref, opts.preparedBy);
  }

  // Material order list: what to order from each supplier and what it costs us. Material
  // lines only; labour and Other lines are not on it.
  function buildMaterials(opts) {
    var d = startDoc(opts, 'Material order list', 'Internal: our costs, ex GST. Not for the client.');
    var doc = d.doc, y = d.y;
    var list = L.materialsBySupplier(opts.costLines);
    if (!list.line_count) y = plainLine(doc, 'No Material lines on this scope yet.', y + 4);
    list.groups.forEach(function (g) {
      if (y + 34 > CONTENT_BOTTOM) y = d.newPage();
      y = sectionBar(doc, g.supplier, y);
      y = drawTable(doc, y, ORDER_COLS, g.lines.map(function (l) {
        return { desc: l.description, qty: L.qtyText(l.qty), unit: l.unit, cost: L.money(l.unit_cost_ex_gst), total: L.money(l.line_total_ex_gst) };
      }), d.newPage);
      if (y + 8 > CONTENT_BOTTOM) y = d.newPage();
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.setTextColor.apply(doc, DARK);
      doc.text(g.supplier + ' total  ' + L.money(g.total_ex_gst), PAGE_W - MARGIN - 3, y + 3.5, { align: 'right' });
      y += 7;
    });
    if (list.line_count) {
      if (y + 16 > CONTENT_BOTTOM) y = d.newPage();
      y += 3;
      doc.setFillColor.apply(doc, DARK);
      doc.roundedRect(MARGIN, y, CONTENT_W, 11, 2, 2, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(255, 255, 255);
      doc.text('Materials total (ex GST)', MARGIN + 6, y + 7.2);
      doc.text(L.money(list.total_ex_gst), PAGE_W - MARGIN - 6, y + 7.2, { align: 'right' });
      y += 14;
    }
    if (list.not_listed) {
      if (y + 8 > CONTENT_BOTTOM) y = d.newPage();
      plainLine(doc, notListedText(list.not_listed), y + 2);
    }
    return finish(doc, d.ref, opts.preparedBy);
  }

  function notListedText(n) {
    return n + ' cost line' + (n > 1 ? 's are' : ' is') + ' not marked Material, so ' + (n > 1 ? 'they are' : 'it is') + ' not on this list.';
  }

  window.QBPdf = {
    // photos: [{ url, caption }]; loads the logo and photos, then builds the PDF. Returns
    // { blob, missingPhotos }: a photo that will not load is left out and counted, and the
    // caller decides whether a PDF with photos missing is acceptable.
    async render(opts) {
      var logo = await loadLogo();
      var loaded = [], missing = 0;
      for (var i = 0; i < (opts.photos || []).length; i++) {
        var ph = opts.photos[i];
        try { loaded.push({ caption: ph.caption, img: await loadPhoto(ph.url, 1400) }); }
        catch (e) { missing++; }
      }
      return { blob: build(Object.assign({}, opts, { logo: logo, photos: loaded })), missingPhotos: missing };
    },
    // The scope of works takes the same photos as the quote and never the cost lines.
    async renderScope(opts) {
      var logo = await loadLogo();
      var loaded = [], missing = 0;
      for (var i = 0; i < (opts.photos || []).length; i++) {
        var ph = opts.photos[i];
        try { loaded.push({ caption: ph.caption, img: await loadPhoto(ph.url, 1400) }); }
        catch (e) { missing++; }
      }
      var v = opts.version || {};
      var clientSide = { title: v.title, narrative: v.narrative, charge_lines: v.charge_lines };
      return { blob: buildScope(Object.assign({}, opts, { version: clientSide, logo: logo, photos: loaded })), missingPhotos: missing };
    },
    // opts.costLines are the internal cost lines: this one is internal, with no photos.
    async renderMaterials(opts) {
      return { blob: buildMaterials(Object.assign({}, opts, { logo: await loadLogo() })), missingPhotos: 0 };
    },
    notListedText: notListedText
  };
})();
