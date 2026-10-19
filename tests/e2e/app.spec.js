'use strict';
const { test, expect } = require('@playwright/test');
const { seed, install } = require('./fake-backend');
const { pdfWords, squash } = require('./pdf-text');

let db;

test.beforeEach(async ({ page }) => {
  db = seed();
  await install(page, db);
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
  // Every ops-api call carries the staff session and no apikey header: ops-api's CORS does not allow one.
  const c = calls('quote_builder_list_jobs')[0];
  expect(c.auth).toBe('Bearer test-access-token');
  expect(c.apikey).toBeUndefined();
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

  const pdfKey = Object.keys(db.files).find((k) => k.startsWith('job-pdfs/') && !k.includes('/sow-'));
  const pdf = await pdfWords(db.files[pdfKey].body);
  // Stage 9: the scope of works is filed on the repair job beside the quote, with no prices.
  const issued = calls('quote_builder_issue').pop().body;
  expect(issued.extra_documents).toEqual([{ document: 'scope_of_works', pdf_path: expect.stringContaining('/sow-') }]);
  expect(db.extraDocuments.filter((d) => !d.superseded_at).map((d) => d.document)).toEqual(['scope_of_works']);
  const sowKey = Object.keys(db.files).find((k) => k.startsWith('job-pdfs/') && k.includes('/sow-'));
  const sow = await pdfWords(db.files[sowKey].body);
  expect(sow).toContain('Scope of works');
  expect(sow).toContain('SWR-26101-Q1');
  expect(sow).not.toContain('$');
  for (const secret of ['Bunnings', 'Dave the chippy']) expect(sow).not.toContain(secret);
  require('fs').mkdirSync('test-results/shots', { recursive: true });
  require('fs').writeFileSync(`test-results/shots/${test.info().project.name}-quote.pdf`, db.files[pdfKey].body);
  expect(db.files[pdfKey].body.subarray(0, 4).toString('latin1')).toBe('%PDF');
  expect(db.files[pdfKey].type).toBe('application/pdf');
  expect(pdf).toContain('SWR-26101-Q1');
  expect(pdf).toContain('Replace fascia, 12.5 m, supply and install');
  expect(pdf).toContain('$815.00');
  expect(pdf).toContain('ML Builders');
  expect(pdf).toContain('Prepared by Hugo Tester');
  expect(pdf).toContain('This quote is valid for 30 days');
  // No licence or insurance claim prints until the owner supplies the wording.
  // The labels are letter-spaced, so the squashed text is checked as well.
  expect(pdf).not.toMatch(/licen[cs]ed|insured/i);
  expect(squash(pdf)).not.toMatch(/licen[cs]ed|insured/);
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

test('signing out with no signal still removes the login from this iPad', async ({ page }) => {
  await signIn(page);
  // The list is on screen before its job request lands; wait for it, or going offline can beat it.
  await expect.poll(() => calls('quote_builder_list_jobs').length).toBe(1);
  db.offline = true;
  await page.click('button:has-text("Sign out")');
  await page.click('.modal button:has-text("Sign out")');
  await expect(page.locator('#email')).toBeVisible();

  // Still no signal: signing back in says so in plain words.
  await page.fill('#email', 'hugo@secureworkswa.com.au');
  await page.fill('#password', 'right-password');
  await page.click('button[type=submit]');
  await expect(page.locator('.form-error')).toHaveText('No connection. Check your signal and try again.');

  db.offline = false;
  await page.reload();
  await expect(page.locator('#email')).toBeVisible();
  await expect(page.locator('.job-list')).toHaveCount(0);
  expect(calls('quote_builder_list_jobs')).toHaveLength(1);
});

test('signing out ends this device\'s login only, not every device on the shared login', async ({ page }) => {
  await signIn(page);
  await page.click('button:has-text("Sign out")');
  await page.click('.modal button:has-text("Sign out")');
  await expect(page.locator('#email')).toBeVisible();
  expect(db.logouts).toEqual(['local']);
  await page.reload();
  await expect(page.locator('#email')).toBeVisible();
});

test('a unit price typed past cents shows the same total on screen as the issued quote carries', async ({ page }) => {
  await signIn(page);
  await page.click('.job-card:has-text("SWR-26103")');
  await typeLine(page.locator('.line.charge').nth(0), { description: 'Supply sheeting', qty: 1000, unit: 'm', price: 1.005 });
  await expect(page.locator('.line.charge .line-total')).toHaveText('$1,010.00');
  await expect(page.locator('.tot-row.grand strong')).toHaveText('$1,111.00');
  await expect(page.locator('.save-state')).toContainText('Saved as version 1', { timeout: 10000 });
  expect(db.versions[0].charge_total_inc_gst).toBe(1111);
  await page.click('button:has-text("Issue client quote")');
  await expect(page.locator('.modal')).toContainText('Total to the client: $1,111.00 inc GST');
});

test('a quantity with 3 decimals prints as typed, so the row multiplies out on the PDF and in History', async ({ page }) => {
  await signIn(page);
  await page.click('.job-card:has-text("SWR-26103")');
  await typeLine(page.locator('.line.cost').nth(0), { description: 'Fascia board', qty: 2.375, unit: 'm', price: 4 });
  await typeLine(page.locator('.line.charge').nth(0), { description: 'Replace fascia', qty: 2.375, unit: 'm', price: 10 });
  await expect(page.locator('.save-state')).toContainText('Saved as version 1', { timeout: 10000 });
  await page.click('button:has-text("Issue client quote")');
  await page.click('.modal button:has-text("Issue")');
  await expect(page.locator('.modal h2')).toHaveText('Issued SWR-26103-Q1', { timeout: 20000 });
  await page.click('.modal button:has-text("OK")');

  const pdf = await pdfWords(db.files[Object.keys(db.files).find((k) => k.startsWith('job-pdfs/'))].body);
  expect(pdf).toContain('(2.375)');
  expect(pdf).not.toContain('(2.38)');
  expect(pdf).toContain('$23.75');

  await page.click('.tab:has-text("History")');
  await page.click('table.hist a:has-text("Scope v1")');
  await expect(page.locator('.compare .client')).toContainText('2.375 m');
  await expect(page.locator('.compare .client')).toContainText('$23.75');
  await expect(page.locator('.compare .internal')).toContainText('2.375 m');
});

test('a failed save keeps the draft on the iPad, says so, and saves when signal is back', async ({ page }) => {
  await signIn(page);
  await page.click('.job-card:has-text("SWR-26103")');
  await expect(page.locator('.line.cost')).toHaveCount(1);
  db.offline = true;
  await typeLine(page.locator('.line.cost').nth(0), { description: 'Replace 3 roof sheets', qty: 3, unit: 'sheet', price: 80, supplier: 'Stratco' });
  await expect(page.locator('.save-state')).toContainText('Not saved to the office: no connection. Your work is kept on this iPad', { timeout: 10000 });
  expect(db.versions).toHaveLength(0);

  // No signal: the job cannot be opened, and the screen says why.
  await page.reload();
  await expect(page.locator('.banner-error')).toContainText('No connection');
  await expect(page.locator('.editor')).toHaveCount(0);

  db.offline = false;
  await page.click('button:has-text("Try again")');
  await expect(page.locator('.line.cost textarea.desc').first()).toHaveValue('Replace 3 roof sheets');
  await expect(page.locator('.save-state')).toContainText('Saved as version 1', { timeout: 10000 });
  expect(db.versions[0].cost_lines[0]).toMatchObject({ description: 'Replace 3 roof sheets', line_total_ex_gst: 240 });
});

test('sign-in token due for renewal with no signal: the editor stays open, says no connection, and saves when signal is back', async ({ page }) => {
  test.setTimeout(150000);
  await signIn(page);
  await page.click('.job-card:has-text("SWR-26103")');
  await expect(page.locator('.editor')).toBeVisible();
  // The stored session (supabase-js persisted state under the app's storage key) is past its expiry.
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('qb-auth'));
    s.expires_at = Math.floor(Date.now() / 1000) - 60;
    localStorage.setItem('qb-auth', JSON.stringify(s));
  });
  db.offline = true;
  await typeLine(page.locator('.line.cost').nth(0), { description: 'Replace 3 roof sheets', qty: 3, unit: 'sheet', price: 80 });
  await expect(page.locator('.save-state')).toContainText('Not saved to the office: no connection', { timeout: 60000 });
  await expect(page.locator('.editor')).toBeVisible();
  await expect(page.locator('#email')).toHaveCount(0);
  await expect(page.locator('.line.cost textarea.desc').first()).toHaveValue('Replace 3 roof sheets');

  db.offline = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.locator('.save-state')).toContainText('Saved as version 1', { timeout: 60000 });
  expect(db.versions[0].cost_lines[0].description).toBe('Replace 3 roof sheets');
});

test('a save whose reply is lost: the iPad edits go on top of the saved copy, one version, nothing lost', async ({ page }) => {
  await signIn(page);
  await page.click('.job-card:has-text("SWR-26103")');
  db.loseReply.quote_builder_save = true;
  await typeLine(page.locator('.line.cost').nth(0), { description: 'Gutter repair', qty: 1, unit: 'item', price: 120 });
  await expect(page.locator('.save-state')).toContainText('Not saved to the office', { timeout: 10000 });
  expect(db.versions).toHaveLength(1);
  await page.locator('.line.cost input.num').nth(1).fill('150');
  await expect(page.locator('.editor .banner-warn')).toContainText('have been put on top of the saved quote', { timeout: 10000 });
  await expect(page.locator('.save-state')).toContainText('Saved as version 1', { timeout: 10000 });
  await expect(page.locator('.line.cost textarea.desc').first()).toHaveValue('Gutter repair');
  expect(db.versions).toHaveLength(1);
  expect(db.versions[0].cost_lines[0].unit_cost_ex_gst).toBe(150);
});

test('opening a job and switching apps without typing saves nothing to the office', async ({ page }) => {
  const switchApps = () => page.evaluate(() => {
    for (const s of ['hidden', 'visible']) {
      Object.defineProperty(document, 'visibilityState', { value: s, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    }
    window.dispatchEvent(new Event('online'));
  });
  await signIn(page);
  await page.click('.job-card:has-text("SWR-26103")');
  await expect(page.locator('.editor')).toBeVisible();
  await switchApps();
  await page.click('.tab:has-text("Variations")');
  await page.click('a:has-text("+ New variation")');
  await expect(page.locator('.editor')).toBeVisible();
  await switchApps();

  await page.click('.tab:has-text("Variations")');
  await expect(page.getByText('No variations on this job yet.')).toBeVisible();
  await page.click('a:has-text("Jobs")');
  await expect(page.locator('.job-card:has-text("SWR-26103") .job-scope')).toHaveText('Not scoped yet');
  expect(calls('quote_builder_save')).toHaveLength(0);
  expect(db.versions).toHaveLength(0);
});

test('issue whose reply is lost: the next try shows it as already issued and locked, not a second quote', async ({ page }) => {
  await signIn(page);
  await page.click('.job-card:has-text("SWR-26103")');
  await typeLine(page.locator('.line.cost').nth(0), { description: 'Gutter repair', qty: 1, unit: 'item', price: 120 });
  await typeLine(page.locator('.line.charge').nth(0), { description: 'Repair gutter', qty: 1, unit: 'item', price: 200 });
  await expect(page.locator('.save-state')).toContainText('Saved as version 1', { timeout: 10000 });

  db.loseReply.quote_builder_issue = true;
  await page.click('button:has-text("Issue client quote")');
  await page.click('.modal button:has-text("Issue")');
  await expect(page.locator('.modal h2')).toHaveText('Not issued', { timeout: 20000 });
  await page.click('.modal button:has-text("OK")');
  expect(db.versions[0].status).toBe('issued');

  await page.click('button:has-text("Issue client quote")');
  await page.click('.modal button:has-text("Issue")');
  await expect(page.locator('.modal h2')).toHaveText('Already issued', { timeout: 20000 });
  await page.click('.modal button:has-text("OK")');
  await expect(page.locator('.version-bar')).toContainText(/version 1 issued .* as SWR-26103-Q1/);
  await expect(page.locator('.version-bar a:has-text("Open issued PDF")')).toBeVisible();
  await expect(page.locator('.line.cost textarea.desc').first()).toBeDisabled();
  expect(db.versions).toHaveLength(1);
  expect(db.documents).toHaveLength(1);
});

test('the list says when it cannot load and loads on Try again', async ({ page }) => {
  await signIn(page);
  db.offline = true;
  await page.click('.chip:has-text("Approved and on")');
  await expect(page.locator('.job-list .banner-warn')).toContainText('No connection');
  await expect(page.locator('.job-card')).toHaveCount(0);
  await expect(page.locator('.job-list .empty')).toHaveCount(0);
  db.offline = false;
  await page.click('button:has-text("Try again")');
  await expect(page.locator('.job-card .job-no')).toHaveText(['SWR-26104']);
});

test('a photo or caption that cannot upload is reported, not left waiting', async ({ page }) => {
  await signIn(page);
  await page.click('.job-card:has-text("SWR-26102")');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAIAAABxZ0isAAAAGElEQVR4nGP4z8DwHw0zDCQXGgEA9fNfoexZgD8AAAAASUVORK5CYII=', 'base64');
  const file = { name: 'IMG_0042.png', mimeType: 'image/png', buffer: png };
  await expect(page.locator('.editor')).toBeVisible();
  db.offline = true;
  await page.locator('input[type=file]:not([capture])').setInputFiles(file);
  await expect(page.locator('.toast.error')).toContainText('Photo not uploaded: no connection. Add it again when you have signal.');
  await expect(page.locator('.photo-grid')).toHaveText('No photos yet.');

  db.offline = false;
  await page.locator('input[type=file]:not([capture])').setInputFiles(file);
  await expect(page.locator('.photo')).toHaveCount(1, { timeout: 10000 });
  expect(db.photos).toHaveLength(1);

  db.offline = true;
  await page.fill('.photo .caption', 'Rear eave');
  await page.locator('.photo .caption').blur();
  await expect(page.locator('.toast.error').last()).toContainText('Caption not saved: no connection');
  await expect(page.locator('.photo .caption')).toHaveValue('');
  expect(db.photos[0].caption).toBe('');
});

test('site photo from the iPad uploads, gets a caption and goes on the quote', async ({ page }) => {
  await signIn(page);
  await page.click('.job-card:has-text("SWR-26102")');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAIAAABxZ0isAAAAGElEQVR4nGP4z8DwHw0zDCQXGgEA9fNfoexZgD8AAAAASUVORK5CYII=', 'base64');
  await page.locator('input[type=file]:not([capture])').setInputFiles({ name: 'IMG_0042.png', mimeType: 'image/png', buffer: png });
  await expect(page.locator('.photo')).toHaveCount(1, { timeout: 10000 });
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
  db.loseReply.quote_builder_create_private_job = true;
  await page.click('button:has-text("Create job and start quote")');
  await expect(page.locator('.form-error')).toContainText('No connection');
  expect(db.jobs.filter((j) => j.type === 'miscellaneous')).toHaveLength(1);
  await page.click('button:has-text("Create job and start quote")');
  await expect(page.locator('.job-head')).toContainText('SWM-26001');
  await expect(page.locator('.job-head')).toContainText('Jane Citizen');
  const reqIds = calls('quote_builder_create_private_job').map((c) => c.body.request_id);
  expect(reqIds).toHaveLength(2);
  expect(new Set(reqIds).size).toBe(1);
  expect(db.jobs.filter((j) => j.type === 'miscellaneous')).toHaveLength(1);

  await page.click('a:has-text("Jobs")');
  await page.click('.seg-btn:has-text("Private quotes")');
  await expect(page.locator('.job-card .job-no')).toHaveText(['SWM-26001']);
});

test('new private quote: details changed after a lost reply make a new job, not the first client\'s', async ({ page }) => {
  await signIn(page);
  await page.click('a:has-text("+ New private quote")');
  await page.fill('#np-client_name', 'Jane Citizen');
  await page.fill('#np-site_address', '5 Sample Rd');
  db.loseReply.quote_builder_create_private_job = true;
  await page.click('button:has-text("Create job and start quote")');
  await expect(page.locator('.form-error')).toContainText('No connection');

  await page.fill('#np-client_name', 'Bob Other');
  await page.fill('#np-site_address', '9 Different St');
  await page.click('button:has-text("Create job and start quote")');
  await expect(page.locator('.job-head')).toContainText('SWM-26002');
  await expect(page.locator('.job-head')).toContainText('Bob Other');
  await expect(page.locator('.job-head')).toContainText('9 Different St');
  const reqIds = calls('quote_builder_create_private_job').map((c) => c.body.request_id);
  expect(new Set(reqIds).size).toBe(2);
  expect(db.jobs.filter((j) => j.type === 'miscellaneous').map((j) => j.client_name)).toEqual(['Jane Citizen', 'Bob Other']);
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

  // Back to the list and into the same variation again: the tap opens it.
  await page.click('.tab:has-text("Variations")');
  await expect(page.locator('.var-row')).toHaveCount(1);
  await page.click('.var-row .var-main');
  await expect(page.locator('.title-input')).toHaveValue('Extra rotten fascia found');

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

test('new variation whose first save reply is lost: the retry saves into it, exactly one variation', async ({ page }) => {
  await signIn(page);
  await page.click('.job-card:has-text("SWR-26101")');
  await page.click('.tab:has-text("Variations")');
  await page.click('a:has-text("+ New variation")');
  db.loseReply.quote_builder_save = true;
  await page.fill('.title-input', 'Extra rotten fascia found');
  await expect(page.locator('.save-state')).toContainText('Not saved to the office', { timeout: 10000 });
  expect(Object.keys(db.chains)).toHaveLength(1);

  await typeLine(page.locator('.line.cost').nth(0), { description: 'Extra fascia board', qty: 2, unit: 'm', price: 18 });
  await expect(page.locator('.save-state')).toContainText('Saved as version 1', { timeout: 10000 });
  await expect(page).toHaveURL(/\/var\/[0-9a-f-]{36}$/);
  expect(Object.keys(db.chains)).toHaveLength(1);
  expect(db.versions).toHaveLength(1);
  expect(db.versions[0]).toMatchObject({ kind: 'variation', title: 'Extra rotten fascia found' });
  expect(db.versions[0].cost_lines[0].description).toBe('Extra fascia board');

  await page.click('.tab:has-text("Variations")');
  await expect(page.locator('.var-row')).toHaveCount(1);
  await expect(page.locator('.var-row')).toContainText('Extra rotten fascia found');
});

test('new variation whose first save reply is lost, then the iPad reloads: still exactly one variation', async ({ page }) => {
  await signIn(page);
  await page.click('.job-card:has-text("SWR-26101")');
  await page.click('.tab:has-text("Variations")');
  await page.click('a:has-text("+ New variation")');
  db.loseReply.quote_builder_save = true;
  await page.fill('.title-input', 'Extra rotten fascia found');
  await expect(page.locator('.save-state')).toContainText('Not saved to the office', { timeout: 10000 });
  db.offline = true;
  await page.reload();
  await expect(page.locator('.banner-error')).toContainText('No connection');

  db.offline = false;
  await page.click('button:has-text("Try again")');
  await expect(page.locator('.title-input')).toHaveValue('Extra rotten fascia found');
  await expect(page.locator('.save-state')).toContainText('Saved as version 1', { timeout: 10000 });
  expect(Object.keys(db.chains)).toHaveLength(1);
  expect(db.versions).toHaveLength(1);
  await page.click('.tab:has-text("Variations")');
  await expect(page.locator('.var-row')).toHaveCount(1);
});

test('a retried new variation never takes over a draft variation it did not make', async ({ page }) => {
  await signIn(page);
  await page.click('.job-card:has-text("SWR-26101")');
  await page.click('.tab:has-text("Variations")');
  await page.click('a:has-text("+ New variation")');
  await expect(page.locator('.editor')).toBeVisible();
  db.offline = true;
  await page.fill('.title-input', 'Extra rotten fascia found');
  await expect(page.locator('.save-state')).toContainText('Not saved to the office', { timeout: 10000 });
  expect(db.versions).toHaveLength(0);

  // Meanwhile the office adds its own draft variation to the job, with no staff login on it.
  const theirs = '99999999-9999-4999-8999-999999999999';
  db.chains[theirs] = { job_id: db.jobs[0].id, kind: 'variation' };
  db.versions.push({ id: '88888888-8888-4888-8888-888888888888', job_id: db.jobs[0].id, kind: 'variation', chain_id: theirs, version: 1, status: 'draft', created_by: null,
    title: 'Office variation', narrative: '', cost_lines: [], charge_lines: [], photo_media_ids: [], cost_total_ex_gst: 0, charge_total_ex_gst: 0, charge_gst: 0, charge_total_inc_gst: 0, margin_ex_gst: 0, margin_pct: null });
  db.offline = false;
  await typeLine(page.locator('.line.cost').nth(0), { description: 'Extra fascia board', qty: 2, unit: 'm', price: 18 });
  await expect(page.locator('.save-state')).toContainText('Saved as version 1', { timeout: 10000 });

  expect(Object.keys(db.chains)).toHaveLength(2);
  expect(db.versions.map((v) => v.title).sort()).toEqual(['Extra rotten fascia found', 'Office variation']);
  expect(db.versions.find((v) => v.chain_id === theirs).cost_lines).toEqual([]);
});

test('issue stops when a ticked photo cannot be loaded: nothing uploaded or frozen; preview says a photo is missing', async ({ page }) => {
  await signIn(page);
  await page.click('.job-card:has-text("SWR-26102")');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAIAAABxZ0isAAAAGElEQVR4nGP4z8DwHw0zDCQXGgEA9fNfoexZgD8AAAAASUVORK5CYII=', 'base64');
  await page.locator('input[type=file]:not([capture])').setInputFiles({ name: 'IMG_0042.png', mimeType: 'image/png', buffer: png });
  await expect(page.locator('.photo input[type=checkbox]')).toBeChecked({ timeout: 10000 });
  await typeLine(page.locator('.line.charge').nth(0), { description: 'Replace fascia', qty: 1, unit: 'item', price: 650 });
  await expect(page.locator('.save-state')).toContainText('Saved as version 1', { timeout: 10000 });

  const photoKey = Object.keys(db.files).find((k) => k.startsWith('job-photos/'));
  const photoFile = db.files[photoKey];
  delete db.files[photoKey];

  await page.evaluate(() => { window.open = () => null; });
  await page.click('button:has-text("Preview client PDF")');
  await expect(page.locator('.modal h2')).toHaveText('Photos missing from the preview', { timeout: 20000 });
  await expect(page.locator('.modal')).toContainText('1 photo could not be loaded');
  await page.click('.modal button:has-text("OK")');

  await page.click('button:has-text("Issue client quote")');
  await page.click('.modal button:has-text("Issue")');
  await expect(page.locator('.modal h2')).toHaveText('Not issued', { timeout: 20000 });
  await expect(page.locator('.modal')).toContainText('1 photo could not be loaded, so the quote was not issued');
  await page.click('.modal button:has-text("OK")');
  expect(Object.keys(db.files).filter((k) => k.startsWith('job-pdfs/'))).toHaveLength(0);
  expect(calls('quote_builder_issue')).toHaveLength(0);
  expect(db.versions[0].status).toBe('draft');
  expect(db.documents).toHaveLength(0);

  db.files[photoKey] = photoFile;
  await page.click('button:has-text("Issue client quote")');
  await page.click('.modal button:has-text("Issue")');
  await expect(page.locator('.modal h2')).toHaveText('Issued SWR-26102-Q1', { timeout: 20000 });
  expect(db.versions[0].status).toBe('issued');
  expect(db.documents).toHaveLength(1);
});

test('a job that loads after Hugo has opened another one does not take over the open editor', async ({ page }) => {
  await signIn(page);
  const slowJob = db.jobs[0].id;
  let release;
  const held = new Promise((r) => { release = r; });
  await page.route((url) => url.searchParams.get('action') === 'quote_builder_get_job' && url.searchParams.get('job_id') === slowJob,
    async (route) => { await held; await route.fallback(); });

  await page.click('.job-card:has-text("SWR-26101")');
  await expect(page.getByText('Loading job…')).toBeVisible();
  await page.click('a:has-text("Jobs")');
  await page.click('.job-card:has-text("SWR-26103")');
  await expect(page.locator('.editor')).toBeVisible();

  const landed = page.waitForResponse((r) => r.request().method() === 'GET' && r.url().includes('job_id=' + slowJob));
  release();
  await landed;
  await page.evaluate(() => new Promise((r) => setTimeout(r, 100)));
  await expect(page.locator('.job-head')).toContainText('SWR-26103');

  // The open editor is still the live one: when signal comes back, its failed save goes up.
  db.offline = true;
  await typeLine(page.locator('.line.cost').nth(0), { description: 'Replace 3 roof sheets', qty: 3, unit: 'sheet', price: 80 });
  await expect(page.locator('.save-state')).toContainText('Not saved to the office', { timeout: 10000 });
  db.offline = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.locator('.save-state')).toContainText('Saved as version 1', { timeout: 10000 });
  expect(db.versions).toHaveLength(1);
  expect(db.versions[0].job_id).toBe(db.jobs[2].id);
});

test('a late load of the same job does not replace the open editor\'s job data: a photo added after still prints on the issued PDF', async ({ page }) => {
  await signIn(page);
  const jobId = db.jobs[1].id;
  let seen = 0, release;
  const held = new Promise((r) => { release = r; });
  await page.route((url) => url.searchParams.get('action') === 'quote_builder_get_job' && url.searchParams.get('job_id') === jobId,
    async (route) => { if (route.request().method() === 'GET' && seen++ === 0) await held; await route.fallback(); });

  await page.click('.job-card:has-text("SWR-26102")');
  await expect(page.getByText('Loading job…')).toBeVisible();
  await page.click('a:has-text("Jobs")');
  await page.click('.job-card:has-text("SWR-26102")');
  await expect(page.locator('.editor')).toBeVisible();

  const landed = page.waitForResponse((r) => r.request().method() === 'GET' && r.url().includes('job_id=' + jobId));
  release();
  await landed;
  await page.evaluate(() => new Promise((r) => setTimeout(r, 100)));

  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAIAAABxZ0isAAAAGElEQVR4nGP4z8DwHw0zDCQXGgEA9fNfoexZgD8AAAAASUVORK5CYII=', 'base64');
  await page.locator('input[type=file]:not([capture])').setInputFiles({ name: 'IMG_0042.png', mimeType: 'image/png', buffer: png });
  await expect(page.locator('.photo input[type=checkbox]')).toBeChecked({ timeout: 10000 });
  await typeLine(page.locator('.line.charge').nth(0), { description: 'Replace fascia', qty: 1, unit: 'item', price: 650 });
  await expect(page.locator('.save-state')).toContainText('Saved as version 1', { timeout: 10000 });
  await page.click('button:has-text("Issue client quote")');
  await page.click('.modal button:has-text("Issue")');
  await expect(page.locator('.modal h2')).toHaveText('Issued SWR-26102-Q1', { timeout: 20000 });

  expect(db.versions[0].photo_media_ids).toEqual([db.photos[0].id]);
  const pdf = await pdfWords(db.files[Object.keys(db.files).find((k) => k.startsWith('job-pdfs/'))].body);
  expect(pdf).toContain('Site photos');
});

test('a quote font that will not load stops the preview and the issue: no PDF is made, uploaded or frozen', async ({ page }) => {
  await capturePdfs(page);
  await signIn(page);
  await page.click('.job-card:has-text("SWR-26103")');
  await typeLine(page.locator('.line.charge').nth(0), { description: 'Replace fascia', qty: 1, unit: 'item', price: 650 });
  await expect(page.locator('.save-state')).toContainText('Saved as version 1', { timeout: 10000 });

  let fontDown = true;
  await page.route('**/assets/fonts/PlusJakartaSans-ExtraBold.ttf', (route) => fontDown ? route.fulfill({ status: 404 }) : route.fallback());
  await page.evaluate(() => { window.open = () => null; });

  await page.click('button:has-text("Preview client PDF")');
  await expect(page.locator('.toast')).toHaveText('Could not make the PDF: The quote font could not be loaded. Check your signal and try again.', { timeout: 20000 });
  expect(await page.evaluate(() => window.__pdfs.length)).toBe(0);

  await page.click('button:has-text("Issue client quote")');
  await page.click('.modal button:has-text("Issue")');
  await expect(page.locator('.modal h2')).toHaveText('Not issued', { timeout: 20000 });
  await expect(page.locator('.modal')).toContainText('The quote font could not be loaded. Check your signal and try again.');
  await page.click('.modal button:has-text("OK")');
  expect(await page.evaluate(() => window.__pdfs.length)).toBe(0);
  expect(Object.keys(db.files).filter((k) => k.startsWith('job-pdfs/'))).toHaveLength(0);
  expect(calls('quote_builder_issue')).toHaveLength(0);
  expect(db.versions[0].status).toBe('draft');
  expect(db.documents).toHaveLength(0);

  // The font loads again: trying again issues the quote, in the template's typeface.
  fontDown = false;
  await page.click('button:has-text("Issue client quote")');
  await page.click('.modal button:has-text("Issue")');
  await expect(page.locator('.modal h2')).toHaveText('Issued SWR-26103-Q1', { timeout: 20000 });
  const issued = db.files[Object.keys(db.files).find((k) => k.startsWith('job-pdfs/'))].body;
  expect(issued.toString('latin1')).toContain('PlusJakartaSans');
});

test('a line with a supplier but no description is flagged on screen and blocks issuing', async ({ page }) => {
  await signIn(page);
  await page.click('.job-card:has-text("SWR-26103")');
  await page.locator('.line.cost input.supplier').fill('Bunnings');
  await expect(page.locator('.line.cost')).toHaveClass(/unnamed/);
  await typeLine(page.locator('.line.charge').nth(0), { description: 'Replace fascia', qty: 1, unit: 'item', price: 650 });
  await page.click('button:has-text("Issue client quote")');
  await expect(page.locator('.modal h2')).toHaveText('Some lines have no description');
  await expect(page.locator('.modal')).toContainText('1 line has a price or supplier but no description');
});

// ---------- Line types, pricing settings, labour, margin target, the two other documents ----------
// The rate, multiplier and target used here are the fake server's test values.

async function pickType(row, label) { await row.locator('select.type').selectOption({ label }); }

async function capturePdfs(page) {
  await page.addInitScript(() => {
    window.__pdfs = [];
    const make = URL.createObjectURL;
    URL.createObjectURL = (b) => { if (b && b.type === 'application/pdf') window.__pdfs.push(b); return make.call(URL, b); };
  });
}

// The words a PDF actually prints, each piece as "(text)" on its own line, so image bytes cannot match.
async function lastPdfWords(page, count, saveAs) {
  await expect.poll(() => page.evaluate(() => window.__pdfs.length), { timeout: 20000 }).toBe(count);
  const b64 = await page.evaluate(async () => {
    const buf = new Uint8Array(await window.__pdfs[window.__pdfs.length - 1].arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
    return btoa(s);
  });
  const bytes = Buffer.from(b64, 'base64');
  expect(bytes.subarray(0, 4).toString('latin1')).toBe('%PDF');
  if (saveAs) {
    require('fs').mkdirSync('test-results/shots', { recursive: true });
    require('fs').writeFileSync(`test-results/shots/${test.info().project.name}-${saveAs}.pdf`, bytes);
  }
  return pdfWords(bytes);
}

async function scopeThreeTypes(page) {
  const cost = page.locator('.line.cost');
  await typeLine(cost.nth(0), { description: 'Fascia board', qty: 10, unit: 'm', price: 20, supplier: 'Bunnings' });
  await page.click('button:has-text("+ Add cost line")');
  await pickType(cost.nth(1), 'Labour');
  await cost.nth(1).locator('textarea.desc').fill('Carpenter on site');
  await cost.nth(1).locator('input.num').nth(0).fill('8');
  await cost.nth(1).locator('input.num').nth(1).fill('50');
  await cost.nth(1).locator('input.supplier').fill('Dave the chippy');
  await page.click('button:has-text("+ Add cost line")');
  await pickType(cost.nth(2), 'Other');
  await typeLine(cost.nth(2), { description: 'Skip bin hire', qty: 1, unit: 'item', price: 200, supplier: 'Skip hire co' });
}

test('insurance repair: line types, labour allowed, and Fill from costs priced from the server settings', async ({ page }) => {
  await signIn(page);
  await page.click('.job-card:has-text("SWR-26103")');
  await expect(page.locator('.pricing-bar')).toContainText('A goal, not a rule');
  await expect(page.locator('.pricing-bar')).toContainText('Labour $95.00 an hour');
  await expect(page.locator('.pricing-bar')).toContainText('Materials at cost × 1.5');
  await expect(page.locator('.pricing-bar')).toContainText('No target margin set');
  await expect(page.locator('.pricing-bar a, .pricing-bar input, .pricing-bar button, .pricing-bar select')).toHaveCount(0);

  await expect(page.locator('.line.cost select.type')).toHaveValue('material');
  await scopeThreeTypes(page);
  // Labour is always in hours: the unit is fixed and the quantity is the hours allowed.
  await expect(page.locator('.line.cost').nth(1).locator('input.unit')).toHaveValue('hr');
  await expect(page.locator('.line.cost').nth(1).locator('input.unit')).toBeDisabled();
  await expect(page.locator('.labour-tile')).toContainText('8 hours');
  await expect(page.locator('.labour-tile')).toContainText('costs us $400.00');
  // The goal rate is shown as the goal; the charge is what the client lines say (none yet).
  await expect(page.locator('.labour-tile')).toContainText('goal $760.00 at $95.00 an hour');
  await expect(page.locator('.labour-tile')).toContainText('no client line in hours');

  await page.click('button:has-text("Fill from costs")');
  await expect(page.locator('.modal')).toContainText('Labour lines: the hours at $95.00 an hour.');
  await expect(page.locator('.modal')).toContainText('Material lines: our cost × 1.5.');
  await expect(page.locator('.modal')).toContainText('Other lines (1): the markup below.');
  await page.locator('.modal input').fill('10');
  await page.click('.modal button:has-text("Fill")');

  const charge = page.locator('.line.charge');
  await expect(charge).toHaveCount(3);
  await expect(charge.nth(0).locator('.line-total')).toHaveText('$300.00');
  await expect(charge.nth(1).locator('input.unit')).toHaveValue('hr');
  await expect(charge.nth(1).locator('input.num').nth(1)).toHaveValue('95');
  await expect(charge.nth(1).locator('.line-total')).toHaveText('$760.00');
  await expect(charge.nth(2).locator('.line-total')).toHaveText('$220.00');
  await expect(page.locator('.margin-strip')).toContainText('$1,280.00');
  await expect(page.locator('.margin-tile')).toContainText('$480.00  (37.5%)');
  await expect(page.locator('.labour-tile')).toContainText('quote charges $760.00 for 8 hours');
  // Re-price the client hours away from the goal: the tile follows the quote, not the goal.
  await charge.nth(1).locator('input.num').nth(1).fill('40');
  await expect(page.locator('.labour-tile')).toContainText('quote charges $320.00 for 8 hours');
  await expect(page.locator('.labour-tile')).toContainText('goal $760.00 at $95.00 an hour');
  await charge.nth(1).locator('input.num').nth(1).fill('95');

  await expect(page.locator('.save-state')).toContainText('Saved as version 1', { timeout: 10000 });
  expect(calls('quote_builder_save').pop().body.cost_lines.map((l) => [l.line_type, l.unit, l.qty])).toEqual([['material', 'm', 10], ['labour', 'hr', 8], ['other', 'item', 1]]);
  expect(db.versions[0].cost_lines.map((l) => l.line_type)).toEqual(['material', 'labour', 'other']);

  // The saved version carries the types and the hours: they read back the same after a reload.
  await page.reload();
  await expect(page.locator('.line.cost select.type').nth(1)).toHaveValue('labour');
  await expect(page.locator('.labour-tile')).toContainText('8 hours');
  await page.click('.tab:has-text("History")');
  await expect(page.locator('table.hist')).toContainText('Labour allowed');
  await expect(page.locator('table.hist tbody tr')).toContainText('8 hours');
  await page.click('table.hist a:has-text("Scope v1")');
  await expect(page.locator('.compare .internal')).toContainText('Labour');
  await expect(page.locator('.labour-tile')).toContainText('costs us $400.00');
});

test('fill with only Material and Labour lines asks for no markup', async ({ page }) => {
  await signIn(page);
  await page.click('.job-card:has-text("SWR-26103")');
  await typeLine(page.locator('.line.cost').nth(0), { description: 'Fascia board', qty: 2, unit: 'm', price: 30, supplier: 'Bunnings' });
  await page.click('button:has-text("Fill from costs")');
  await expect(page.locator('.modal')).toContainText('Material lines: our cost × 1.5.');
  await expect(page.locator('.modal input')).toHaveCount(0);
  await page.click('.modal button:has-text("Fill")');
  await expect(page.locator('.line.charge .line-total')).toHaveText('$90.00');
});

test('a setting that is not set falls back to the markup question and says which one is missing', async ({ page }) => {
  db.settings.labour_rate_ex_gst = null;
  await signIn(page);
  await page.click('.job-card:has-text("SWR-26103")');
  await expect(page.locator('.pricing-bar')).toContainText('Labour rate not set');
  await scopeThreeTypes(page);
  await expect(page.locator('.labour-tile')).toContainText('costs us $400.00');
  await expect(page.locator('.labour-tile')).not.toContainText('charged');
  await page.click('button:has-text("Fill from costs")');
  await expect(page.locator('.modal')).toContainText('The labour rate is not set, so Labour lines use the markup below.');
  await page.locator('.modal input').fill('20');
  await page.click('.modal button:has-text("Fill")');
  const charge = page.locator('.line.charge');
  await expect(charge.nth(0).locator('.line-total')).toHaveText('$300.00');
  await expect(charge.nth(1).locator('.line-total')).toHaveText('$480.00');
  await expect(charge.nth(2).locator('.line-total')).toHaveText('$240.00');
});

test('margin target: red below 15 percent while none is set; a set target replaces that, with what to charge', async ({ page }) => {
  await signIn(page);
  await page.click('.job-card:has-text("SWR-26103")');
  await typeLine(page.locator('.line.cost').nth(0), { description: 'Fascia board', qty: 1, unit: 'm', price: 100, supplier: 'Bunnings' });
  await typeLine(page.locator('.line.charge').nth(0), { description: 'Replace fascia', qty: 1, unit: 'item', price: 105 });
  await expect(page.locator('.margin-tile')).toContainText('$5.00  (4.8%)');
  await expect(page.locator('.margin-tile')).toContainText('No target margin set');
  await expect(page.locator('.margin-tile')).toHaveClass(/warn/);
  await page.locator('.line.charge input.num').nth(1).fill('125');
  await expect(page.locator('.margin-tile')).toContainText('$25.00  (20.0%)');
  await expect(page.locator('.margin-tile')).toContainText('No target margin set');
  await expect(page.locator('.margin-tile')).not.toHaveClass(/warn/);
  await expect.poll(() => db.versions.length && db.versions[0].charge_lines[0].unit_price_ex_gst, { timeout: 10000 }).toBe(125);

  db.settings.target_margin_pct = 35;
  await page.reload();
  await expect(page.locator('.pricing-bar')).toContainText('Target margin 35%');
  await expect(page.locator('.margin-tile')).toContainText('(20.0%)');
  await expect(page.locator('.margin-tile')).toHaveClass(/warn/);
  await expect(page.locator('.margin-tile')).toContainText('To hit 35%, charge $153.85 ex GST');
  await page.locator('.line.charge input.num').nth(1).fill('160');
  await expect(page.locator('.margin-tile')).toContainText('On the 35% target');
  await expect(page.locator('.margin-tile')).not.toHaveClass(/warn/);
});

test('a server that sends no settings yet: the quote screen works exactly as it did', async ({ page }) => {
  db.settings = undefined;
  await signIn(page);
  await page.click('.job-card:has-text("SWR-26103")');
  await expect(page.locator('.line.cost')).toHaveCount(1);
  await expect(page.locator('select.type')).toHaveCount(0);
  await expect(page.locator('.pricing-bar')).toHaveCount(0);
  await expect(page.locator('.labour-tile')).toHaveCount(0);
  await expect(page.locator('button:has-text("Material order list")')).toHaveCount(0);
  await expect(page.locator('button:has-text("Scope of works (no prices)")')).toHaveCount(1);
  await typeLine(page.locator('.line.cost').nth(0), { description: 'Fascia board', qty: 1, unit: 'hr', price: 100, supplier: 'Bunnings' });
  await page.click('button:has-text("Fill from costs + markup")');
  await expect(page.locator('.modal')).toContainText('at this markup');
  await page.locator('.modal input').fill('10');
  await page.click('.modal button:has-text("Fill")');
  await expect(page.locator('.line.charge .line-total')).toHaveText('$110.00');
  // Below 15 percent is still red, and nothing mentions a target.
  await expect(page.locator('.margin-tile')).toHaveClass(/warn/);
  await expect(page.locator('.margin-tile')).not.toContainText('target');
  await expect(page.locator('.save-state')).toContainText('Saved as version 1', { timeout: 10000 });
  expect(db.versions[0].cost_lines[0]).not.toHaveProperty('line_type');
});

test('private quote: no goal note, and Fill keeps the one markup for every line', async ({ page }) => {
  db.jobs.push({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', job_number: 'SWM-26000', type: 'miscellaneous', status: 'draft', repair_stage: null, client_name: 'Jane Citizen', client_phone: '', client_email: '',
    site_address: '5 Sample Rd', site_suburb: 'Bayswater', category: 'private_renovation', created_at: new Date().toISOString() });
  await signIn(page);
  await page.click('button:has-text("Private quotes")');
  await page.click('.job-card:has-text("SWM-26000")');
  // A private job is sent no settings: no goal note. Line types are on, so one scope gives
  // a quote, a scope of works and a material order list on this lane too.
  await expect(page.locator('.pricing-bar')).toHaveCount(0);
  await expect(page.locator('select.type')).toHaveCount(1);
  await expect(page.locator('.labour-tile')).toHaveCount(1);
  await expect(page.locator('.labour-tile')).not.toContainText('goal');
  await expect(page.locator('button:has-text("Material order list")')).toHaveCount(1);
  const cost = page.locator('.line.cost');
  await typeLine(cost.nth(0), { description: 'Fascia board', qty: 10, unit: 'm', price: 20, supplier: 'Bunnings' });
  await page.click('button:has-text("+ Add cost line")');
  await typeLine(cost.nth(1), { description: 'Carpenter on site', qty: 8, unit: 'hr', price: 50, supplier: 'Dave the chippy' });
  await page.click('button:has-text("+ Add cost line")');
  await typeLine(cost.nth(2), { description: 'Skip bin hire', qty: 1, unit: 'item', price: 200, supplier: 'Skip hire co' });
  await page.click('button:has-text("Fill from costs + markup")');
  await expect(page.locator('.modal')).toContainText('at this markup');
  await page.locator('.modal input').fill('30');
  await page.click('.modal button:has-text("Fill")');
  await expect(page.locator('.line.charge .line-total')).toHaveText(['$260.00', '$520.00', '$260.00']);
  await expect(page.locator('.margin-tile')).not.toContainText('target');
});

test('scope of works prints the client lines with their quantities, no dollar amount, no Labour allowed section and nothing from the cost table; material order list has Material lines by supplier and nothing else', async ({ page }) => {
  await capturePdfs(page);
  await signIn(page);
  await page.click('.job-card:has-text("SWR-26103")');
  await scopeThreeTypes(page);
  await page.click('button:has-text("+ Add cost line")');
  await typeLine(page.locator('.line.cost').nth(3), { description: 'Colorbond gutter', qty: 6, unit: 'lm', price: 12.5, supplier: 'Stratco' });
  await page.fill('.title-input', 'Storm damage repairs');
  await page.fill('textarea.narrative', 'Replace damaged fascia to the rear eave and make good.');
  await page.click('button:has-text("Fill from costs")');
  await page.locator('.modal input').fill('10');
  await page.click('.modal button:has-text("Fill")');
  // The client Labour line is reworded to 7.5 hours; the cost table still allows 8.
  await page.locator('.line.charge').nth(1).locator('input.num').nth(0).fill('7.5');
  await expect(page.locator('.labour-tile')).toContainText('8 hours');
  await page.evaluate(() => { window.open = () => null; });

  await page.click('button:has-text("Scope of works (no prices)")');
  const scope = await lastPdfWords(page, 1, 'scope-of-works');
  for (const want of ['Scope of works', 'Storm damage repairs', 'Replace damaged fascia to the rear eave', 'Fascia board', 'Carpenter on site', 'SWR-26103', 'MLB-27100']) expect(scope).toContain(want);
  // Each printed piece of text on its own, so a table cell is matched whole.
  const cells = scope.split('\n').map((s) => s.slice(1, s.lastIndexOf(')')));
  // Client line quantities and units print as they do on the client quote.
  for (const want of ['10', 'm', '7.5', 'hr', '6', 'lm']) expect(cells).toContain(want);
  // Nothing from the cost table: no Labour allowed section, not its 8 hours, no dollar amount, no supplier.
  expect(scope).not.toContain('$');
  expect(scope.toLowerCase()).not.toContain('labour allowed');
  expect(squash(scope)).not.toContain('labourallowed');
  expect(scope).not.toContain('8 hours');
  expect(cells).not.toContain('8');
  for (const secret of ['Bunnings', 'Stratco', 'Dave the chippy', 'Skip hire co']) expect(scope).not.toContain(secret);

  await page.click('button:has-text("Material order list")');
  await expect(page.locator('.toast')).toContainText('2 cost lines are not marked Material, so they are not on this list.');
  const list = await lastPdfWords(page, 2, 'material-order-list');
  for (const want of ['Material order list', 'Not for the client', 'Bunnings', 'Fascia board', '$20.00', '$200.00', 'Stratco', 'Colorbond gutter', '$12.50', '$75.00', 'Materials total', '$275.00', '2 cost lines are not marked Material']) expect(list).toContain(want);
  expect(list.indexOf('Bunnings')).toBeLessThan(list.indexOf('Stratco'));
  // No labour, no Other line, and none of the prices the client is charged.
  for (const secret of ['Carpenter on site', 'Dave the chippy', 'Skip bin hire', 'Skip hire co', '$30.00', '$95.00', '$18.75', '$760.00']) expect(list).not.toContain(secret);
});

test('material order list prints a long quantity and a long unit whole', async ({ page }) => {
  await capturePdfs(page);
  await signIn(page);
  await page.click('.job-card:has-text("SWR-26103")');
  await typeLine(page.locator('.line.cost').nth(0), { description: 'Roof screws', qty: 1000.125, unit: 'per metre', price: 2, supplier: 'Bunnings' });
  await page.evaluate(() => { window.open = () => null; });
  await page.click('button:has-text("Material order list")');
  const list = await lastPdfWords(page, 1);
  for (const want of ['Roof screws', '(1000.125)', '(per metre)', '$2,000.25']) expect(list).toContain(want);
});

test('screens render at iPad size (screenshots for review)', async ({ page }, info) => {
  await signIn(page);
  await page.screenshot({ path: `test-results/shots/${info.project.name}-list.png`, fullPage: true });
  await page.click('.job-card:has-text("SWR-26101")');
  await typeLine(page.locator('.line.cost').nth(0), { description: 'Remove and dispose damaged fascia', qty: 12.5, unit: 'm', price: 18, supplier: 'Bunnings' });
  await page.click('button:has-text("+ Add cost line")');
  await pickType(page.locator('.line.cost').nth(1), 'Labour');
  await page.locator('.line.cost').nth(1).locator('textarea.desc').fill('Carpenter on site');
  await page.locator('.line.cost').nth(1).locator('input.num').nth(0).fill('8');
  await typeLine(page.locator('.line.charge').nth(0), { description: 'Replace fascia, 12.5 m, supply and install', qty: 1, unit: 'item', price: 650 });
  await page.screenshot({ path: `test-results/shots/${info.project.name}-scope.png`, fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
