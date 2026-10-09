'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../../js/lib.js');

test('totals match the contract: GST only on gst_applies lines, margin over charge ex GST', () => {
  const cost = [
    { description: 'Fascia', qty: 12.5, unit: 'm', unit_cost_ex_gst: 18 },
    { description: 'Labour', qty: 4, unit: 'hr', unit_cost_ex_gst: 45 }
  ];
  const charge = [
    { description: 'Replace fascia', qty: 1, unit: 'item', unit_price_ex_gst: 650, gst_applies: true },
    { description: 'Permit fee', qty: 1, unit: 'item', unit_price_ex_gst: 100, gst_applies: false }
  ];
  const t = L.totals(cost, charge);
  assert.equal(t.cost_total_ex_gst, 405);
  assert.equal(t.charge_total_ex_gst, 750);
  assert.equal(t.charge_gst, 65);
  assert.equal(t.charge_total_inc_gst, 815);
  assert.equal(t.margin_ex_gst, 345);
  assert.equal(t.margin_pct, 46);
});

test('margin_pct is null when nothing is charged', () => {
  assert.equal(L.totals([{ description: 'x', qty: 1, unit_cost_ex_gst: 10 }], []).margin_pct, null);
});

test('money rounds to cents and formats with commas', () => {
  assert.equal(L.money(1234567.5), '$1,234,567.50');
  assert.equal(L.money(10.005), '$10.01');
  assert.equal(L.money(0.1 + 0.2), '$0.30');
  assert.equal(L.money(-5), '-$5.00');
  assert.equal(L.round2(2.675), 2.68);
});

test('num reads typed values and refuses negatives and junk', () => {
  assert.equal(L.num('1,250.50'), 1250.5);
  assert.equal(L.num('$40'), 40);
  assert.equal(L.num('-3'), 0);
  assert.equal(L.num('abc'), 0);
  assert.equal(L.num(''), 0);
  assert.equal(L.num(null), 0);
});

test('clean lines drop lines without a description and keep line ids', () => {
  const lines = [
    { line_id: 'c-keep', description: '  Remove fascia ', qty: '2', unit: '', unit_cost_ex_gst: '18.005', supplier_or_trade: ' Bunnings ' },
    { line_id: 'c-blank', description: '', qty: 1, unit: 'item', unit_cost_ex_gst: 0 },
    { line_id: 'c-priced', description: '   ', qty: 1, unit: 'item', unit_cost_ex_gst: 50 }
  ];
  const out = L.cleanCostLines(lines);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], { line_id: 'c-keep', description: 'Remove fascia', qty: 2, unit: 'item', unit_cost_ex_gst: 18.01, supplier_or_trade: 'Bunnings' });
  assert.equal(L.unnamedLines(lines), 1);
});

test('charge lines default gst_applies to true', () => {
  const out = L.cleanChargeLines([{ description: 'A', qty: 1, unit_price_ex_gst: 10 }]);
  assert.equal(out[0].gst_applies, true);
  assert.match(out[0].line_id, /^q-[0-9a-f]{8}$/);
});

test('chargeFromCosts applies markup and makes fresh charge ids', () => {
  const out = L.chargeFromCosts([{ line_id: 'c-1', description: 'Sheet', qty: 3, unit: 'ea', unit_cost_ex_gst: 100 }], 25);
  assert.equal(out.length, 1);
  assert.equal(out[0].unit_price_ex_gst, 125);
  assert.equal(out[0].qty, 3);
  assert.notEqual(out[0].line_id, 'c-1');
  assert.match(out[0].line_id, /^q-/);
});

test('savePayload sends chain_id only for an existing chain and never sends totals', () => {
  const job = { id: 'job-1' };
  const draft = { title: ' T ', narrative: 'N', cost_lines: [{ description: 'x', qty: 1, unit_cost_ex_gst: 1 }], charge_lines: [], photo_media_ids: ['p1'] };
  const scope = L.savePayload(job, 'scope', null, null, draft);
  assert.equal('chain_id' in scope, false);
  assert.equal(scope.base_version_id, null);
  assert.equal(scope.title, 'T');
  assert.equal('cost_total_ex_gst' in scope, false);
  const v = L.savePayload(job, 'variation', 'chain-9', 'ver-2', draft);
  assert.equal(v.chain_id, 'chain-9');
  assert.equal(v.base_version_id, 'ver-2');
});

test('fingerprint ignores blank lines and whitespace in the title', () => {
  const a = { title: 'X', narrative: '', cost_lines: [{ line_id: 'c-1', description: 'a', qty: 1, unit: 'item', unit_cost_ex_gst: 1, supplier_or_trade: '' }], charge_lines: [], photo_media_ids: [] };
  const b = JSON.parse(JSON.stringify(a));
  b.title = ' X ';
  b.cost_lines.push(L.blankCostLine());
  assert.equal(L.draftFingerprint(a), L.draftFingerprint(b));
  b.cost_lines[0].qty = 2;
  assert.notEqual(L.draftFingerprint(a), L.draftFingerprint(b));
});

test('draftFromVersion round-trips a server version', () => {
  const v = { title: 'T', narrative: 'N', photo_media_ids: ['m1'],
    cost_lines: [{ line_id: 'c-1', description: 'a', qty: 2, unit: 'm', unit_cost_ex_gst: 5, supplier_or_trade: 'S', line_total_ex_gst: 10 }],
    charge_lines: [{ line_id: 'q-1', description: 'b', qty: 1, unit: 'item', unit_price_ex_gst: 20, gst_applies: false, line_total_ex_gst: 20 }] };
  const d = L.draftFromVersion(v);
  assert.equal(d.cost_lines[0].line_total_ex_gst, undefined);
  assert.equal(d.charge_lines[0].gst_applies, false);
  assert.deepEqual(d.photo_media_ids, ['m1']);
});

test('groupByBuilder sorts builders and puts jobs with no builder last, newest first', () => {
  const g = L.groupByBuilder([
    { id: 1, builder_name: 'ML Builders', created_at: '2026-10-01' },
    { id: 2, builder_name: null, created_at: '2026-10-02' },
    { id: 3, builder_name: 'AJ Building & Restoration', created_at: '2026-10-03' },
    { id: 4, builder_name: 'ML Builders', created_at: '2026-10-05' }
  ]);
  assert.deepEqual(g.map((x) => x.builder), ['AJ Building & Restoration', 'ML Builders', 'No builder on record']);
  assert.deepEqual(g[1].jobs.map((j) => j.id), [4, 1]);
});

test('filterJobs matches every word across number, client, address, builder and refs', () => {
  const jobs = [
    { job_number: 'SWR-26123', client_name: 'J Smith', site_suburb: 'Morley', builder_name: 'ML Builders', builder_work_order: 'MLB-27093' },
    { job_number: 'SWR-26124', client_name: 'A Brown', site_suburb: 'Bayswater', builder_name: 'Builderwest' }
  ];
  assert.equal(L.filterJobs(jobs, 'smith morley').length, 1);
  assert.equal(L.filterJobs(jobs, 'mlb-27093')[0].job_number, 'SWR-26123');
  assert.equal(L.filterJobs(jobs, '').length, 2);
  assert.equal(L.filterJobs(jobs, 'nobody').length, 0);
});

test('draft keys separate scope and each variation chain', () => {
  assert.equal(L.draftKey('j', 'scope'), 'qb:draft:j:scope:scope');
  assert.equal(L.draftKey('j', 'variation', 'c1'), 'qb:draft:j:variation:c1');
});
