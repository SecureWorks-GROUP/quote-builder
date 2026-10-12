// Client quote PDF, built in the browser with jsPDF. Follows the SecureWorks PDF brand
// template (patio repo SecureWorks_PDF_Brand_Template_Spec.md): orange header band, dark
// dusty blue section bars, tinted alternating rows, dark price block, orange footer rule.
// It prints charge lines only. Internal cost lines never reach this file.
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

  function tableHeader(doc, y) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor.apply(doc, MID);
    var x = MARGIN;
    COLS.forEach(function (c) {
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

    var photos = (opts.photos || []).filter(function (ph) { return ph && ph.img; });
    if (photos.length) {
      y = newPage();
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

    var pages = doc.internal.getNumberOfPages();
    for (var pg = 1; pg <= pages; pg++) {
      doc.setPage(pg);
      footer(doc, pg, pages, quoteNumber, opts.preparedBy);
    }
    return doc.output('blob');
  }

  window.QBPdf = {
    // photos: [{ url, caption }]; loads the logo and photos, then builds the PDF Blob.
    async render(opts) {
      var logo = await loadLogo();
      var loaded = [];
      for (var i = 0; i < (opts.photos || []).length; i++) {
        var ph = opts.photos[i];
        try { loaded.push({ caption: ph.caption, img: await loadPhoto(ph.url, 1400) }); }
        catch (e) { console.warn('[qb] photo skipped from PDF', ph.url, e); }
      }
      return build(Object.assign({}, opts, { logo: logo, photos: loaded }));
    }
  };
})();
