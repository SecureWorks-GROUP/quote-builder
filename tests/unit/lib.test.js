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

test('a unit price typed past cents totals the same on screen as the saved, rounded line', () => {
  const cost = [{ description: 'Sheet', qty: 100, unit: 'm', unit_cost_ex_gst: '2.375' }];
  const charge = [{ description: 'Supply', qty: 1000, unit: 'm', unit_price_ex_gst: '1.005', gst_applies: true }];
  assert.equal(L.costLineTotal(cost[0]), 238);
  assert.equal(L.chargeLineTotal(charge[0]), 1010);
  assert.deepEqual(L.totals(cost, charge), L.totals(L.cleanCostLines(cost), L.cleanChargeLines(charge)));
  assert.equal(L.totals(cost, charge).charge_total_inc_gst, 1111);
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

test('qtyText keeps up to 3 decimals and drops trailing zeros', () => {
  assert.equal(L.qtyText(2.375), '2.375');
  assert.equal(L.qtyText('12.50'), '12.5');
  assert.equal(L.qtyText(4), '4');
  assert.equal(L.qtyText(2.3756), '2.376');
  assert.equal(L.qtyText(0.1 + 0.2), '0.3');
  assert.equal(L.qtyText('abc'), '0');
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
  assert.deepEqual(out[0], { line_id: 'c-keep', line_type: 'other', description: 'Remove fascia', qty: 2, unit: 'item', unit_cost_ex_gst: 18.01, supplier_or_trade: 'Bunnings' });
  assert.equal(L.unnamedLines(lines), 1);
});

test('charge lines default gst_applies to true', () => {
  const out = L.cleanChargeLines([{ description: 'A', qty: 1, unit_price_ex_gst: 10 }]);
  assert.equal(out[0].gst_applies, true);
  assert.match(out[0].line_id, /^q-[0-9a-f]{8}$/);
});

test('chargeFromCosts applies markup and makes fresh charge ids', () => {
  const out = L.chargeFromCosts([{ line_id: 'c-1', description: 'Sheet', qty: 3, unit: 'ea', unit_cost_ex_gst: 100 }], { otherMarkupPct: 25 });
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

// The pricing numbers here are test values. The real ones live on the server and are never
// written in this repo, because the site is public.
const RULES = { lane: 'repair', labourRate: 95, materialsMultiplier: 1.5, otherMarkupPct: 20 };
const SCOPE = [
  { line_id: 'c-1', line_type: 'labour', description: 'Carpenter', qty: 10, unit: 'day', unit_cost_ex_gst: 50, supplier_or_trade: 'Dave' },
  { line_id: 'c-2', line_type: 'material', description: 'Fascia board', qty: 4, unit: 'm', unit_cost_ex_gst: 250, supplier_or_trade: 'Bunnings' },
  { line_id: 'c-3', line_type: 'other', description: 'Skip bin', qty: 1, unit: 'item', unit_cost_ex_gst: 200, supplier_or_trade: 'Skip hire co' }
];
const prices = (lines) => lines.map((l) => [l.qty, l.unit, l.unit_price_ex_gst, L.chargeLineTotal(l)]);

test('insurance fill: labour hours at the rate, materials at cost times the multiplier, other at the markup', () => {
  const out = L.chargeFromCosts(SCOPE, RULES);
  assert.deepEqual(prices(out), [[10, 'hr', 95, 950], [4, 'm', 375, 1500], [1, 'item', 240, 240]]);
  assert.equal(L.totals(SCOPE, out).charge_total_ex_gst, 2690);
  assert.deepEqual(out.map((l) => l.description), ['Carpenter', 'Fascia board', 'Skip bin']);
  assert.ok(out.every((l) => /^q-/.test(l.line_id) && l.gst_applies === true));
});

test('labour is charged at the rate whatever it costs us, and a material price rounds to cents', () => {
  const out = L.chargeFromCosts([
    { line_type: 'labour', description: 'Free labour', qty: 2.5, unit_cost_ex_gst: 0 },
    { line_type: 'material', description: 'Screws', qty: 3, unit: 'box', unit_cost_ex_gst: 3.33 }
  ], RULES);
  assert.deepEqual(prices(out), [[2.5, 'hr', 95, 237.5], [3, 'box', 5, 15]]);
});

test('a setting that is not set sends that type down the markup path; the numbers are never invented', () => {
  const noRate = L.chargeFromCosts(SCOPE, { lane: 'repair', labourRate: null, materialsMultiplier: 1.5, otherMarkupPct: 20 });
  assert.deepEqual(prices(noRate).map((p) => p[2]), [60, 375, 240]);
  const noMult = L.chargeFromCosts(SCOPE, { lane: 'repair', labourRate: 95, otherMarkupPct: 20 });
  assert.deepEqual(prices(noMult).map((p) => p[2]), [95, 300, 240]);
  assert.deepEqual(L.fillNeeds(SCOPE, { lane: 'repair', labourRate: null, materialsMultiplier: 1.5 }),
    { labourRateMissing: true, materialsMultiplierMissing: false, otherLines: 1, askMarkup: true });
});

test('markup is only asked when an Other line exists or a needed setting is missing', () => {
  const typed = SCOPE.slice(0, 2);
  assert.equal(L.fillNeeds(typed, RULES).askMarkup, false);
  assert.equal(L.fillNeeds(SCOPE, RULES).askMarkup, true);
  // A missing rate does not matter while there is no Labour line to price.
  assert.equal(L.fillNeeds([SCOPE[1]], { lane: 'repair', labourRate: null, materialsMultiplier: 1.5 }).askMarkup, false);
  assert.equal(L.fillNeeds(typed, { lane: 'private' }).askMarkup, true);
});

test('a private quote ignores the settings: every line takes the one markup, as before', () => {
  const out = L.chargeFromCosts(SCOPE, { lane: 'private', labourRate: 95, materialsMultiplier: 1.5, otherMarkupPct: 30 });
  assert.deepEqual(prices(out).map((p) => p[2]), [65, 325, 260]);
  assert.deepEqual(prices(L.chargeFromCosts(SCOPE, { otherMarkupPct: 30 })), prices(out));
});

test('labour allowed: hours and cost from Labour lines only, charged amount when there is a rate', () => {
  assert.deepEqual(L.labourAllowed(SCOPE, 95), { hours: 10, cost_ex_gst: 500, charge_ex_gst: 950 });
  assert.deepEqual(L.labourAllowed(SCOPE), { hours: 10, cost_ex_gst: 500, charge_ex_gst: null });
  assert.deepEqual(L.labourAllowed([{ description: 'a', qty: 0.1, line_type: 'labour' }, { description: 'b', qty: 0.2, line_type: 'labour' }], 95).hours, 0.3);
  assert.equal(L.hoursText(1), '1 hour');
  assert.equal(L.hoursText(7.5), '7.5 hours');
});

test('a cost line saved before types existed reads as Other: not labour, not on the material list', () => {
  const old = [{ line_id: 'c-9', description: 'Labour', qty: 24, unit: 'item', unit_cost_ex_gst: 25, supplier_or_trade: '' }];
  assert.equal(L.lineType(old[0]), 'other');
  assert.deepEqual(L.labourAllowed(old, 95), { hours: 0, cost_ex_gst: 0, charge_ex_gst: 0 });
  assert.equal(L.draftFromVersion({ cost_lines: old }).cost_lines[0].line_type, 'other');
  assert.equal(L.cleanCostLines([{ description: 'x', line_type: 'banana' }])[0].line_type, 'other');
  const list = L.materialsBySupplier(old);
  assert.deepEqual([list.line_count, list.not_listed, list.groups.length], [0, 1, 0]);
});

test('a Labour line is always in hours; a new cost line starts as Material', () => {
  assert.equal(L.cleanCostLines([SCOPE[0]])[0].unit, 'hr');
  assert.equal(L.blankCostLine().line_type, 'material');
  assert.equal(L.savePayload({ id: 'j' }, 'scope', null, null, { cost_lines: SCOPE, charge_lines: [] }).cost_lines[0].line_type, 'labour');
});

test('chargeForTarget: what to charge to reach the target margin, null with no target', () => {
  assert.equal(L.chargeForTarget(650, 35), 1000);
  assert.equal(L.chargeForTarget(100, 35), 153.85);
  assert.equal(L.chargeForTarget(100, null), null);
  assert.equal(L.chargeForTarget(100, 0), null);
  assert.equal(L.chargeForTarget(100, 100), null);
});

test('pricingSettings: a server that sends none gives null; a missing or junk number is not set', () => {
  assert.equal(L.pricingSettings(undefined), null);
  assert.deepEqual(L.pricingSettings({}), { labour_rate_ex_gst: null, materials_multiplier: null, target_margin_pct: null });
  assert.deepEqual(L.pricingSettings({ labour_rate_ex_gst: '95', materials_multiplier: 1.5, target_margin_pct: 35 }),
    { labour_rate_ex_gst: 95, materials_multiplier: 1.5, target_margin_pct: 35 });
  assert.deepEqual(L.pricingSettings({ labour_rate_ex_gst: -5, materials_multiplier: 'x', target_margin_pct: 100 }),
    { labour_rate_ex_gst: null, materials_multiplier: null, target_margin_pct: null });
});

test('material order list: Material lines by supplier A to Z, no supplier last, with costs and totals', () => {
  const list = L.materialsBySupplier(SCOPE.concat([
    { line_id: 'c-4', line_type: 'material', description: 'Gutter', qty: 2, unit: 'lm', unit_cost_ex_gst: 12.5, supplier_or_trade: 'Stratco' },
    { line_id: 'c-5', line_type: 'material', description: 'Paint', qty: 1, unit: 'ea', unit_cost_ex_gst: 60, supplier_or_trade: 'bunnings' },
    { line_id: 'c-6', line_type: 'material', description: 'Sundries', qty: 1, unit: 'lot', unit_cost_ex_gst: 40, supplier_or_trade: '' },
    { line_id: 'c-7', line_type: 'material', description: '', qty: 1, unit: 'ea', unit_cost_ex_gst: 999, supplier_or_trade: 'Nobody' }
  ]));
  assert.deepEqual(list.groups.map((g) => [g.supplier, g.lines.map((l) => l.description), g.total_ex_gst]), [
    ['Bunnings', ['Fascia board', 'Paint'], 1060],
    ['Stratco', ['Gutter'], 25],
    ['No supplier named', ['Sundries'], 40]
  ]);
  assert.deepEqual(list.groups[0].lines[0], { line_id: 'c-2', description: 'Fascia board', qty: 4, unit: 'm', unit_cost_ex_gst: 250, line_total_ex_gst: 1000 });
  assert.equal(list.total_ex_gst, 1125);
  assert.equal(list.line_count, 4);
  assert.equal(list.not_listed, 1);
});
