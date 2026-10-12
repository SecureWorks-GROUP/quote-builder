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
  expect(pdf).toContain('This quote is valid for 30 days');
  // No licence or insurance claim prints until the owner supplies the wording.
  expect(pdf).not.toMatch(/licen[cs]ed|insured/i);
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
  const pdf = db.files[Object.keys(db.files).find((k) => k.startsWith('job-pdfs/'))].body.toString('latin1');
  expect(pdf).toContain('Site photos');
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
