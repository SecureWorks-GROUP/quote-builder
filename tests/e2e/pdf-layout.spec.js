'use strict';
// The client quote wears the fence and patio quote template. These tests hold the two things
// a restyle can break: every piece of the quote still prints, and a quote that runs over the
// page breaks cleanly. They build the PDF straight from a made-up quote (pdf-fixture.js).
const { test, expect } = require('@playwright/test');
const { seed, install } = require('./fake-backend');
const { pdfPages, flow, squash } = require('./pdf-text');
const fx = require('./pdf-fixture');

test.beforeEach(async ({ page }) => {
  await install(page, seed());
  page.on('pageerror', (e) => { throw e; });
  await page.goto('/');
  await page.waitForFunction(() => window.QBPdf && window.jspdf);
});

// Build one of the three documents in the page and hand its bytes back. `photos` made-up
// pictures are drawn in the page, so no real photograph is needed.
async function render(page, method, opts, photos) {
  const b64 = await page.evaluate(async ({ method, opts, photos }) => {
    const list = [];
    for (let i = 0; i < photos; i++) {
      const c = document.createElement('canvas');
      c.width = 400; c.height = i % 2 ? 500 : 300;
      const g = c.getContext('2d');
      g.fillStyle = '#8FA4B2';
      g.fillRect(0, 0, c.width, c.height);
      list.push({ url: c.toDataURL('image/jpeg', 0.7), caption: 'Made-up photo caption ' + (i + 1) });
    }
    const made = await window.QBPdf[method](Object.assign({}, opts, { photos: list }));
    if (made.missingPhotos) throw new Error('photos missing: ' + made.missingPhotos);
    const bytes = new Uint8Array(await made.blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }, { method, opts, photos: photos || 0 });
  return Buffer.from(b64, 'base64');
}

function save(name, bytes) {
  require('fs').mkdirSync('test-results/shots', { recursive: true });
  require('fs').writeFileSync(`test-results/shots/${test.info().project.name}-${name}.pdf`, bytes);
}

const money = (n) => '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const cells = (page) => page.items.map((i) => i.str);
const TERMS = [
  'This quote is valid for 30 days from the date above.',
  'It is based on the scope of works described here. Additional works, site conditions not visible at the time of quoting, or requested changes will be quoted separately as a variation.',
  'All prices are in Australian dollars. GST is shown separately.'
];

test('the client quote still prints every piece of the quote, in the same order, and nothing new', async ({ page }) => {
  const bytes = await render(page, 'render', fx.quote(), 2);
  save('template-quote', bytes);
  // The template's typeface is in the file: a quote that fell back to Helvetica would not have it.
  expect(bytes.toString('latin1')).toContain('PlusJakartaSans');

  const pages = await pdfPages(bytes);
  const co = await page.evaluate(() => window.QB_CONFIG.company);
  const all = pages.map(flow).join(' ');
  const pieces = pages.flatMap(cells);
  const labels = squash(all);

  // What was typed prints as typed: the title, who it is for, the job, the write-up.
  for (const want of ['Storm damage repair to patio roof and gutter', 'Example Builders', 'EB-0001', 'PO-0001', 'Alex Sample',
    '10 Example Street, Sample Suburb', 'SWR-99001', 'SWR-99001-Q1', '13 Oct 2026']) expect(pieces).toContain(want);
  for (const para of fx.NARRATIVE.split('\n\n')) expect(all).toContain(para);

  // Every charge line: its description whole, then quantity, unit, unit price and amount.
  for (const l of fx.LINES) {
    expect(all).toContain(l.description);
    for (const cell of [String(l.qty), l.unit, money(l.unit_price_ex_gst)]) expect(pieces).toContain(cell);
    expect(pieces).toContain(money(l.qty * l.unit_price_ex_gst) + (l.gst_applies === false ? '*' : ''));
  }
  // The sums: 2,290.00 ex GST, GST on all but the GST free line, and the total.
  for (const want of ['Subtotal (ex GST)', '$2,290.00', 'GST', '$224.00', '$2,514.00', 'Includes GST of $224.00', '* GST free']) expect(pieces).toContain(want);
  for (const term of TERMS) expect(all).toContain(term);
  for (const want of ['Made-up photo caption 1', 'Made-up photo caption 2', 'Site photos']) expect(pieces).toContain(want);

  // The labels the quote has always carried (now in small capitals).
  for (const want of ['Quote', 'Prepared for', 'Work order', 'Purchase order', 'Property owner', 'Site address', 'Job number',
    'Scope of works', 'Pricing', 'Description', 'Qty', 'Unit', 'Unit price', 'Amount', 'Total price', 'Terms']) expect(labels).toContain(squash(want));

  // Same order of meaning as before.
  const order = ['Storm damage repair to patio roof', 'Example Builders', 'Storm damage to the rear patio roof', fx.LINES[0].description,
    'Subtotal (ex GST)', '$2,514.00', TERMS[0], 'Site photos'].map((s) => all.indexOf(s));
  expect(order.every((at) => at >= 0)).toBe(true);
  expect(order).toEqual(order.slice().sort((a, b) => a - b));

  // Every page carries the band (quote number and date) and the footer.
  pages.forEach((p, i) => {
    for (const want of ['SWR-99001-Q1', '13 Oct 2026']) expect(cells(p)).toContain(want);
    for (const want of [co.name, 'ABN ' + co.abn, 'Phone ' + co.phone, 'Prepared by Sam Example', `Page ${i + 1} of ${pages.length}`]) expect(flow(p)).toContain(want);
  });

  // The fence and patio quotes carry blocks this tool has no data for. None of them is made up here.
  expect(all).not.toMatch(/deposit|payment|accept|warrant|licen[cs]ed|insured|balance|bank|holds until/i);
});

test('a variation quote for a private client keeps its own headings and contact lines', async ({ page }) => {
  const job = Object.assign({}, fx.JOB, { type: 'miscellaneous', builder_name: null, builder_work_order: null, builder_purchase_order: null,
    client_phone: '0400 000 000', client_email: 'alex@example.com' });
  const pages = await pdfPages(await render(page, 'render', fx.quote({ kind: 'variation', variationNumber: 2, quoteNumber: 'SWR-99001-V2.1', job })));
  const all = pages.map(flow).join(' ');
  const labels = squash(all);
  for (const want of ['Variation 2 to the works on job SWR-99001', 'Alex Sample', '0400 000 000', 'alex@example.com', 'SWR-99001-V2.1']) expect(pages.flatMap(cells)).toContain(want);
  for (const want of ['Variation quote', 'Variation pricing', 'Variation total', 'Prepared for', 'Phone', 'Email']) expect(labels).toContain(squash(want));
  for (const not of ['Property owner', 'Work order', 'Total price']) expect(labels).not.toContain(squash(not));
});

test('a quote with no title or write-up still says what it is', async ({ page }) => {
  const pages = await pdfPages(await render(page, 'render', fx.quote({ quoteNumber: '', version: { title: '', narrative: '', charge_lines: fx.LINES } })));
  expect(pages).toHaveLength(1);
  expect(cells(pages[0])).toContain('Quote');
  expect(cells(pages[0])).toContain('DRAFT');
  expect(cells(pages[0]).map(squash)).not.toContain('scopeofworks');
});

test('a two-page quote breaks cleanly: whole rows, the table head again, the total block in one piece', async ({ page }) => {
  const lines = fx.manyLines(24);
  const bytes = await render(page, 'render', fx.quote({ version: { title: 'Storm damage repair, full schedule', narrative: fx.NARRATIVE, charge_lines: lines } }));
  save('template-two-page', bytes);
  const pages = await pdfPages(bytes);
  const at = await page.evaluate(() => window.QBPdf.LAYOUT);
  expect(pages).toHaveLength(2);

  pages.forEach((p, i) => {
    // Nothing prints in the gap above the footer or runs off the page: every piece sits in
    // the band, in the body, or in the footer.
    for (const it of p.items) {
      const where = it.y < at.bandBottom ? 'band' : it.y <= at.contentBottom ? 'body' : it.y > at.footTop && it.y < 297 ? 'footer' : 'outside';
      expect(where, `"${it.str}" on page ${i + 1} at ${it.y.toFixed(1)} mm`).not.toBe('outside');
      expect(it.x).toBeGreaterThan(0);
      expect(it.x).toBeLessThan(210);
    }
    const band = p.items.filter((it) => it.y < at.bandBottom).map((it) => it.str);
    for (const want of ['SWR-99001-Q1', '13 Oct 2026']) expect(band).toContain(want);
    const foot = p.items.filter((it) => it.y > at.footTop).map((it) => it.str).join(' ');
    expect(foot).toContain(`Page ${i + 1} of 2`);
    // The table head is on both pages, above that page's first row.
    const head = p.items.find((it) => squash(it.str) === 'unitprice');
    const firstRow = p.items.find((it) => /^Made-up repair item \d+/.test(it.str));
    expect(head, `table head on page ${i + 1}`).toBeTruthy();
    expect(head.y).toBeLessThan(firstRow.y);
  });

  // Every row prints once, whole, on one page: its wrapped description, and its quantity and
  // amount on the description's first line. The rows stay in order.
  let last = { page: 0, y: 0 };
  lines.forEach((l, n) => {
    const on = pages.filter((p) => flow(p).includes(l.description + ' '));
    expect(on, `row ${n + 1} is whole on exactly one page`).toHaveLength(1);
    const first = on[0].items.find((it) => new RegExp('^Made-up repair item ' + (n + 1) + '(,|$)').test(it.str));
    const sameLine = on[0].items.filter((it) => Math.abs(it.y - first.y) < 0.2).map((it) => it.str);
    for (const cell of [String(l.qty), l.unit, money(l.unit_price_ex_gst), money(l.qty * l.unit_price_ex_gst)]) expect(sameLine).toContain(cell);
    const here = { page: on[0].number, y: first.y };
    expect(here.page > last.page || (here.page === last.page && here.y > last.y)).toBe(true);
    last = here;
  });
  expect(pages[0].items.some((it) => /^Made-up repair item/.test(it.str))).toBe(true);
  expect(pages[1].items.some((it) => /^Made-up repair item/.test(it.str))).toBe(true);

  // The two sums, the total block and the terms are not split over the break.
  const total = lines.reduce((a, l) => a + l.qty * l.unit_price_ex_gst, 0);
  const closing = pages[1];
  for (const want of ['Subtotal (ex GST)', money(total), 'GST', money(total * 0.1), money(total * 1.1), 'Includes GST of ' + money(total * 0.1)]) expect(cells(closing)).toContain(want);
  expect(squash(flow(closing))).toContain('totalprice');
  for (const term of TERMS) expect(flow(closing)).toContain(term);
  for (const want of ['Subtotal (ex GST)', 'Includes GST of ' + money(total * 0.1), TERMS[0]]) expect(cells(pages[0])).not.toContain(want);
});

test('a long write-up carries on over the page, and the scope of works and order list break the same way', async ({ page }) => {
  const at = await page.evaluate(() => window.QBPdf.LAYOUT);
  const paras = [];
  for (let i = 1; i <= 30; i++) paras.push('Made-up paragraph ' + i + ' of the write-up, long enough to wrap onto a second line when it is set across the full width of the page in the body size.');
  const version = { title: 'Storm damage repair, full schedule', narrative: paras.join('\n\n'), charge_lines: fx.manyLines(40) };
  const costLines = fx.manyLines(60).map((l, i) => ({ line_id: 'c' + i, line_type: 'material', description: l.description, qty: l.qty, unit: l.unit, unit_cost_ex_gst: l.unit_price_ex_gst, supplier_or_trade: 'Made-up Supplier ' + (i % 3) }));
  for (const method of ['render', 'renderScope', 'renderMaterials']) {
    const pages = await pdfPages(await render(page, method, fx.quote({ version, costLines }), method === 'renderMaterials' ? 0 : 5));
    expect(pages.length, method).toBeGreaterThan(2);
    pages.forEach((p, i) => {
      for (const it of p.items) expect(it.y < at.bandBottom || it.y <= at.contentBottom || it.y > at.footTop, `${method}: "${it.str}" on page ${i + 1} at ${it.y.toFixed(1)} mm`).toBe(true);
      expect(flow(p)).toContain(`Page ${i + 1} of ${pages.length}`);
    });
    // The body alone, band and footer left out, so a paragraph that crosses the break reads whole.
    const all = flow({ items: pages.flatMap((p) => p.items.filter((it) => it.y >= at.bandBottom && it.y <= at.contentBottom)) });
    if (method !== 'renderMaterials') for (const para of paras) expect(all).toContain(para);
    // The scope of works never prints a dollar amount; the order list never prints the write-up.
    if (method === 'renderScope') expect(all).not.toContain('$');
    if (method === 'renderMaterials') expect(all).not.toContain('Made-up paragraph');
  }
});
