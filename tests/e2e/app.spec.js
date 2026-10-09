'use strict';
const { test, expect } = require('@playwright/test');
const { seed, install } = require('./fake-backend');

let db;

test.beforeEach(async ({ page }) => {
  db = seed();
  await install(page, db);
  await page.addInitScript(() => { window.QB_PDF_PLAIN = true; });
  page.on('pageerror', (e) => { throw e; });
});

async function signIn(page) {
  await page.goto('/');
  await page.fill('#email', 'hugo@secureworkswa.com.au');
  await page.fill('#password', 'right-password');
  await page.click('button[type=submit]');
  await expect(page.locator('.job-list')).toBeVisible();
}

function calls(action) { return db.calls.filter((c) => c.action === action); }

async function typeLine(row, values) {
  const desc = row.locator('textarea.desc');
  await desc.fill(values.description);
  const nums = row.locator('input.num');
  await nums.nth(0).fill(String(values.qty));
  await row.locator('input.unit').fill(values.unit);
  await nums.nth(1).fill(String(values.price));
  if (values.supplier) await row.locator('input.supplier').fill(values.supplier);
}

test('wrong password shows a plain message; right one lands on the repair list grouped by builder', async ({ page }) => {
  await page.goto('/');
  await page.fill('#email', 'hugo@secureworkswa.com.au');
  await page.fill('#password', 'nope');
  await page.click('button[type=submit]');
  await expect(page.locator('.form-error')).toHaveText('Email or password is not right.');
  await page.fill('#password', 'right-password');
  await page.click('button[type=submit]');
  await expect(page.locator('.group-title')).toHaveText([/Builderwest/, /ML Builders/]);
  await expect(page.locator('.job-card')).toHaveCount(3);
  // Every ops-api call carries the staff session and the public anon key, nothing else.
  const c = calls('quote_builder_list_jobs')[0];
  expect(c.auth).toBe('Bearer test-access-token');
  expect(c.apikey).toMatch(/^eyJ/);
  await page.fill('.search', 'lee inglewood');
  await expect(page.locator('.job-card')).toHaveCount(1);
  await expect(page.locator('.job-card .job-no')).toHaveText('SWR-26103');
  await page.fill('.search', '');
  await page.click('.chip:has-text("Approved and on")');
  await expect(page.locator('.job-card .job-no')).toHaveText(['SWR-26104']);
});

test('scope a repair job: costs on top, client charge below, autosave, issue a PDF with no internal costs', async ({ page }) => {
  await signIn(page);
  await page.click('.job-card:has-text("SWR-26101")');
  await expect(page.locator('.job-head')).toContainText('MLB-27093');

  const costRows = page.locator('.line.cost');
  await typeLine(costRows.nth(0), { description: 'Remove and dispose damaged fascia', qty: 12.5, unit: 'm', price: 18, supplier: 'Bunnings' });
  await page.click('button:has-text("+ Add cost line")');
  await typeLine(costRows.nth(1), { description: 'Carpenter labour', qty: 4, unit: 'hr', price: 65, supplier: 'Dave the chippy' });
  await expect(page.locator('.running strong')).toHaveText('$485.00');

  await page.fill('.title-input', 'Storm damage repairs');
  await page.fill('textarea.narrative', 'Replace damaged fascia to the rear eave and make good.');
  const chargeRows = page.locator('.line.charge');
  await typeLine(chargeRows.nth(0), { description: 'Replace fascia, 12.5 m, supply and install', qty: 1, unit: 'item', price: 650 });
  await page.click('button:has-text("+ Add charge line")');
  await typeLine(chargeRows.nth(1), { description: 'Council fee (passed on)', qty: 1, unit: 'item', price: 100 });
  await chargeRows.nth(1).locator('input[type=checkbox]').uncheck();
  await expect(page.locator('.tot-row.grand strong')).toHaveText('$815.00');
  await expect(page.locator('.margin-strip')).toContainText('$265.00');

  await expect(page.locator('.save-state')).toContainText('Saved as version 1', { timeout: 10000 });
  const saved = calls('quote_builder_save').pop().body;
  expect(saved.kind).toBe('scope');
  expect(saved.cost_lines).toHaveLength(2);
  expect(saved.cost_lines[0]).toMatchObject({ description: 'Remove and dispose damaged fascia', qty: 12.5, unit: 'm', unit_cost_ex_gst: 18, supplier_or_trade: 'Bunnings' });
  expect(saved.charge_lines[1].gst_applies).toBe(false);
  expect(saved).not.toHaveProperty('cost_total_ex_gst');

  await page.click('button:has-text("Issue client quote")');
  await page.click('.modal button:has-text("Issue")');
  await expect(page.locator('.modal h2')).toHaveText('Issued SWR-26101-Q1', { timeout: 20000 });
  await expect(page.locator('.modal')).toContainText('moved from Scoping to Quoted');
  await page.click('.modal button:has-text("OK")');

  const pdfKey = Object.keys(db.files).find((k) => k.startsWith('job-pdfs/'));
  const pdf = db.files[pdfKey].body.toString('latin1');
  require('fs').mkdirSync('test-results/shots', { recursive: true });
  require('fs').writeFileSync(`test-results/shots/${test.info().project.name}-quote.pdf`, db.files[pdfKey].body);
  expect(pdf.startsWith('%PDF')).toBe(true);
  expect(db.files[pdfKey].type).toBe('application/pdf');
  expect(pdf).toContain('SWR-26101-Q1');
  expect(pdf).toContain('Replace fascia, 12.5 m, supply and install');
  expect(pdf).toContain('$815.00');
  expect(pdf).toContain('ML Builders');
  expect(pdf).toContain('Prepared by Hugo Tester');
  // Internal costs never reach the client PDF.
  for (const secret of ['Remove and dispose damaged fascia', 'Carpenter labour', 'Bunnings', 'Dave the chippy', '$485.00']) expect(pdf).not.toContain(secret);

  // Issued version is frozen; a revision becomes version 2 and keeps version 1 intact.
  await expect(page.locator('.version-bar')).toContainText('version 1 issued');
  await expect(page.locator('.line.cost textarea.desc').first()).toBeDisabled();
  await page.click('button:has-text("Start a revision")');
  await page.locator('.line.charge input.num').nth(1).fill('700');
  await expect(page.locator('.save-state')).toContainText('Saved as version 2', { timeout: 10000 });
  expect(db.versions.filter((v) => v.kind === 'scope').map((v) => [v.version, v.status, v.charge_total_ex_gst])).toEqual([[1, 'issued', 750], [2, 'draft', 800]]);

  await page.click('.tab:has-text("History")');
  await expect(page.locator('table.hist tbody tr')).toHaveCount(2);
  await page.click('table.hist a:has-text("Scope v1")');
  await expect(page.locator('.compare')).toContainText('Allowed: what it costs us');
  await expect(page.locator('.compare .internal')).toContainText('Carpenter labour');
  await expect(page.locator('.compare .client')).toContainText('Replace fascia');
  await expect(page.locator('.margin-strip')).toContainText('$485.00');
});

test('a dropped connection keeps the draft on the iPad and it uploads when signal is back', async ({ page }) => {
  await signIn(page);
  await page.click('.job-card:has-text("SWR-26103")');
  await expect(page.locator('.line.cost')).toHaveCount(1);
  db.offline = true;
  await typeLine(page.locator('.line.cost').nth(0), { description: 'Replace 3 roof sheets', qty: 3, unit: 'sheet', price: 80, supplier: 'Stratco' });
  await expect(page.locator('.save-state')).toContainText('No signal', { timeout: 10000 });
  expect(db.versions).toHaveLength(0);

  // iPad reloads the page while still offline: the work is still there.
  await page.reload();
  await expect(page.locator('.line.cost textarea.desc').first()).toHaveValue('Replace 3 roof sheets');
  await expect(page.locator('.banner-warn')).toContainText('Offline');

  db.offline = false;
  await page.reload();
  await expect(page.locator('.line.cost textarea.desc').first()).toHaveValue('Replace 3 roof sheets');
  await expect(page.locator('.save-state')).toContainText('Saved as version 1', { timeout: 10000 });
  expect(db.versions[0].cost_lines[0]).toMatchObject({ description: 'Replace 3 roof sheets', line_total_ex_gst: 240 });
});

test('stale save from another device asks which version to keep and never overwrites silently', async ({ page }) => {
  await signIn(page);
  await page.click('.job-card:has-text("SWR-26103")');
  await typeLine(page.locator('.line.cost').nth(0), { description: 'Gutter repair', qty: 1, unit: 'item', price: 120 });
  await expect(page.locator('.save-state')).toContainText('Saved as version 1', { timeout: 10000 });
  db.failNext = { quote_builder_save: { status: 409, code: 'stale_version' } };
  await page.locator('.line.cost input.num').nth(1).fill('150');
  await expect(page.locator('.modal h2')).toHaveText('This quote changed on another device', { timeout: 10000 });
  await page.click('.modal button:has-text("OK")');
  await expect(page.locator('.conflict')).toBeVisible();
  await page.click('button:has-text("Keep my iPad edits")');
  await expect(page.locator('.save-state')).toContainText('Saved as version 1', { timeout: 10000 });
  expect(db.versions[0].cost_lines[0].unit_cost_ex_gst).toBe(150);
});

test('site photo from the iPad uploads, gets a caption and goes on the quote', async ({ page }) => {
  await signIn(page);
  await page.click('.job-card:has-text("SWR-26102")');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAIAAABxZ0isAAAAGElEQVR4nGP4z8DwHw0zDCQXGgEA9fNfoexZgD8AAAAASUVORK5CYII=', 'base64');
  await page.locator('input[type=file]:not([capture])').setInputFiles({ name: 'IMG_0042.png', mimeType: 'image/png', buffer: png });
  await expect(page.locator('.photo:not(.pending)')).toHaveCount(1, { timeout: 10000 });
  expect(calls('quote_builder_photo_register')).toHaveLength(1);
  await expect(page.locator('.photo input[type=checkbox]')).toBeChecked();
  await page.fill('.photo .caption', 'Water damage, rear eave');
  await page.locator('.photo .caption').blur();
  await expect.poll(() => db.photos[0].caption).toBe('Water damage, rear eave');
  await typeLine(page.locator('.line.cost').nth(0), { description: 'Patch', qty: 1, unit: 'item', price: 10 });
  await expect(page.locator('.save-state')).toContainText('Saved as version 1', { timeout: 10000 });
  expect(db.versions[0].photo_media_ids).toEqual([db.photos[0].id]);
});

test('new private quote makes a miscellaneous job once, even when the reply is lost', async ({ page }) => {
  await signIn(page);
  await page.click('a:has-text("+ New private quote")');
  await page.fill('#np-client_name', 'Jane Citizen');
  await page.fill('#np-client_phone', '0400 000 000');
  await page.fill('#np-site_address', '5 Sample Rd');
  await page.fill('#np-site_suburb', 'Bayswater');
  db.offline = true;
  await page.click('button:has-text("Create job and start quote")');
  await expect(page.locator('.form-error')).toContainText('No connection');
  db.offline = false;
  await page.click('button:has-text("Create job and start quote")');
  await expect(page.locator('.job-head')).toContainText('SWM-26001');
  await expect(page.locator('.job-head')).toContainText('Jane Citizen');
  const reqIds = calls('quote_builder_create_private_job').map((c) => c.body.request_id);
  expect(new Set(reqIds).size).toBe(1);
  expect(db.jobs.filter((j) => j.type === 'miscellaneous')).toHaveLength(1);

  await page.click('a:has-text("Jobs")');
  await page.click('.seg-btn:has-text("Private quotes")');
  await expect(page.locator('.job-card .job-no')).toHaveText(['SWM-26001']);
});

test('variation: same two-part layout, issue moves the card to Variation, approval to Approved', async ({ page }) => {
  await signIn(page);
  await page.click('.job-card:has-text("SWR-26101")');
  await page.click('.tab:has-text("Variations")');
  await page.click('a:has-text("+ New variation")');
  await expect(page.locator('.card.internal')).toBeVisible();
  await expect(page.locator('.card.client')).toBeVisible();
  await page.fill('.title-input', 'Extra rotten fascia found');
  await typeLine(page.locator('.line.cost').nth(0), { description: 'Extra fascia board', qty: 2, unit: 'm', price: 18 });
  await typeLine(page.locator('.line.charge').nth(0), { description: 'Additional fascia replacement', qty: 2, unit: 'm', price: 60 });
  await expect(page.locator('.save-state')).toContainText('Saved as version 1', { timeout: 10000 });
  await expect(page).toHaveURL(/\/var\/[0-9a-f-]{36}$/);
  expect(calls('quote_builder_save').filter((c) => c.body.kind === 'variation' && !c.body.chain_id)).toHaveLength(1);

  await page.click('button:has-text("Issue variation quote")');
  await page.click('.modal button:has-text("Issue")');
  await expect(page.locator('.modal h2')).toHaveText('Issued SWR-26101-V1.1', { timeout: 20000 });
  await expect(page.locator('.modal')).toContainText('to Variation');
  await page.click('.modal button:has-text("OK")');

  await page.click('.tab:has-text("Variations")');
  await expect(page.locator('.var-row')).toContainText('Waiting on approval');
  await page.click('button:has-text("Record approved")');
  await page.fill('.modal textarea', 'Builder approved by email');
  await page.click('.modal button:has-text("Approved")');
  await expect(page.locator('.var-row')).toContainText('Approved');
  expect(db.jobs[0].repair_stage).toBe('approved');
  expect(calls('quote_builder_decide_variation')[0].body).toMatchObject({ approved: true, notes: 'Builder approved by email' });
});

test('screens render at iPad size (screenshots for review)', async ({ page }, info) => {
  await signIn(page);
  await page.screenshot({ path: `test-results/shots/${info.project.name}-list.png`, fullPage: true });
  await page.click('.job-card:has-text("SWR-26101")');
  await typeLine(page.locator('.line.cost').nth(0), { description: 'Remove and dispose damaged fascia', qty: 12.5, unit: 'm', price: 18, supplier: 'Bunnings' });
  await typeLine(page.locator('.line.charge').nth(0), { description: 'Replace fascia, 12.5 m, supply and install', qty: 1, unit: 'item', price: 650 });
  await page.screenshot({ path: `test-results/shots/${info.project.name}-scope.png`, fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
