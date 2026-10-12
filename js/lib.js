// Pure logic for the quote builder: money, lines, totals, job grouping, draft keys.
// No DOM and no network here, so the same file runs in the page and under `node --test`.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QBLib = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var GST_RATE = 0.1;

  // Repairs board stages, in board order (ops-api INSURANCE_REPAIR_STAGES).
  var REPAIR_STAGES = ['wo_in', 'scoping', 'quoted', 'variation', 'approved', 'materials', 'scheduled', 'on_site', 'complete'];
  var STAGE_LABELS = {
    wo_in: 'Work order in', scoping: 'Scoping', quoted: 'Quoted', variation: 'Variation',
    approved: 'Approved', materials: 'Materials', scheduled: 'Scheduled', on_site: 'On site', complete: 'Complete'
  };

  // Job list filters Hugo can pick on the Repairs lane.
  var STAGE_FILTERS = [
    { key: 'to_scope', label: 'To scope', stages: ['wo_in', 'scoping'] },
    { key: 'quoted', label: 'Quoted', stages: ['quoted', 'variation'] },
    { key: 'approved', label: 'Approved and on', stages: ['approved', 'materials', 'scheduled', 'on_site'] }
  ];

  var UNITS = ['item', 'm', 'm2', 'lm', 'hr', 'day', 'ea', 'sheet', 'lot'];

  var PRIVATE_CATEGORIES = [
    { value: 'private_renovation', label: 'Private renovation' },
    { value: 'private_repair', label: 'Private repair' },
    { value: 'maintenance', label: 'Maintenance' },
    { value: 'other', label: 'Other' }
  ];

  function round2(n) {
    var x = Number(n);
    if (!isFinite(x)) return 0;
    return Math.round((x + Number.EPSILON) * 100) / 100;
  }

  // Parse what Hugo typed into a number field. Blank or junk is 0; negatives clamp to 0
  // because the server refuses negative amounts.
  function num(v) {
    if (typeof v === 'number') return isFinite(v) && v > 0 ? v : 0;
    if (v == null) return 0;
    var s = String(v).replace(/[$,\s]/g, '');
    if (s === '') return 0;
    var x = parseFloat(s);
    return isFinite(x) && x > 0 ? x : 0;
  }

  function money(n) {
    var x = round2(n);
    var neg = x < 0;
    var parts = Math.abs(x).toFixed(2).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-$' : '$') + parts.join('.');
  }

  // Quantity as typed, to 3 decimals with no trailing zeros, so qty x price reads true on the quote.
  function qtyText(q) {
    var x = Number(q);
    if (!isFinite(x)) return '0';
    return String(Math.round((x + Number.EPSILON) * 1000) / 1000);
  }

  function randomHex(len) {
    var out = '';
    var c = (typeof crypto !== 'undefined' && crypto.getRandomValues) ? crypto : null;
    if (c) {
      var bytes = new Uint8Array(Math.ceil(len / 2));
      c.getRandomValues(bytes);
      for (var i = 0; i < bytes.length; i++) out += ('0' + bytes[i].toString(16)).slice(-2);
      return out.slice(0, len);
    }
    for (var j = 0; j < len; j++) out += Math.floor(Math.random() * 16).toString(16);
    return out;
  }

  function uuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    var h = randomHex(32);
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-4' + h.slice(13, 16) + '-' +
      ((parseInt(h[16], 16) & 3) | 8).toString(16) + h.slice(17, 20) + '-' + h.slice(20, 32);
  }

  // line_id is kept across versions so a later actual-costs record can point at it.
  function newLineId(kind) { return (kind === 'charge' ? 'q-' : 'c-') + randomHex(8); }

  function blankCostLine() {
    return { line_id: newLineId('cost'), description: '', qty: 1, unit: 'item', unit_cost_ex_gst: 0, supplier_or_trade: '' };
  }

  function blankChargeLine() {
    return { line_id: newLineId('charge'), description: '', qty: 1, unit: 'item', unit_price_ex_gst: 0, gst_applies: true };
  }

  // The unit amount is saved in whole cents, so the line is worked out from it in whole cents.
  function costLineTotal(l) { return round2(num(l.qty) * round2(num(l.unit_cost_ex_gst))); }
  function chargeLineTotal(l) { return round2(num(l.qty) * round2(num(l.unit_price_ex_gst))); }
  function chargeLineGst(l) { return l.gst_applies === false ? 0 : round2(chargeLineTotal(l) * GST_RATE); }

  // Mirrors the server's sums so the screen agrees with what the server stores.
  function totals(costLines, chargeLines) {
    var cost = 0, chargeEx = 0, gst = 0;
    (costLines || []).forEach(function (l) { cost += costLineTotal(l); });
    (chargeLines || []).forEach(function (l) { chargeEx += chargeLineTotal(l); gst += chargeLineGst(l); });
    cost = round2(cost); chargeEx = round2(chargeEx); gst = round2(gst);
    var margin = round2(chargeEx - cost);
    return {
      cost_total_ex_gst: cost,
      charge_total_ex_gst: chargeEx,
      charge_gst: gst,
      charge_total_inc_gst: round2(chargeEx + gst),
      margin_ex_gst: margin,
      margin_pct: chargeEx > 0 ? round2((margin / chargeEx) * 100) : null
    };
  }

  // The server requires a description, so a line without one stays on this iPad only
  // until Hugo names it. The screen flags it and issuing is blocked while one exists.
  function isBlankLine(l) { return !String(l.description || '').trim(); }

  function hasAmounts(l) {
    return num(l.unit_cost_ex_gst) > 0 || num(l.unit_price_ex_gst) > 0 || !!String(l.supplier_or_trade || '').trim();
  }

  // Lines with a price or supplier but no description: flagged on screen and block issuing.
  function unnamedLines(lines) {
    return (lines || []).filter(function (l) { return isBlankLine(l) && hasAmounts(l); }).length;
  }

  function cleanCostLines(lines) {
    return (lines || []).filter(function (l) { return !isBlankLine(l); }).map(function (l) {
      return {
        line_id: l.line_id || newLineId('cost'),
        description: String(l.description).trim().slice(0, 2000),
        qty: num(l.qty),
        unit: String(l.unit || '').trim() || 'item',
        unit_cost_ex_gst: round2(num(l.unit_cost_ex_gst)),
        supplier_or_trade: String(l.supplier_or_trade || '').trim()
      };
    });
  }

  function cleanChargeLines(lines) {
    return (lines || []).filter(function (l) { return !isBlankLine(l); }).map(function (l) {
      return {
        line_id: l.line_id || newLineId('charge'),
        description: String(l.description).trim().slice(0, 2000),
        qty: num(l.qty),
        unit: String(l.unit || '').trim() || 'item',
        unit_price_ex_gst: round2(num(l.unit_price_ex_gst)),
        gst_applies: l.gst_applies !== false
      };
    });
  }

  // Turn cost lines into client charge lines at a markup, as a starting point Hugo then edits.
  function chargeFromCosts(costLines, markupPct) {
    var m = 1 + num(markupPct) / 100;
    return cleanCostLines(costLines).map(function (l) {
      return {
        line_id: newLineId('charge'),
        description: l.description,
        qty: l.qty,
        unit: l.unit,
        unit_price_ex_gst: round2(l.unit_cost_ex_gst * m),
        gst_applies: true
      };
    });
  }

  // The editable part of a version, in the shape quote_builder_save takes.
  function draftFromVersion(v) {
    v = v || {};
    return {
      title: v.title || '',
      narrative: v.narrative || '',
      cost_lines: (v.cost_lines || []).map(function (l) {
        return { line_id: l.line_id, description: l.description || '', qty: l.qty, unit: l.unit || 'item',
          unit_cost_ex_gst: l.unit_cost_ex_gst, supplier_or_trade: l.supplier_or_trade || '' };
      }),
      charge_lines: (v.charge_lines || []).map(function (l) {
        return { line_id: l.line_id, description: l.description || '', qty: l.qty, unit: l.unit || 'item',
          unit_price_ex_gst: l.unit_price_ex_gst, gst_applies: l.gst_applies !== false };
      }),
      photo_media_ids: (v.photo_media_ids || []).slice()
    };
  }

  function emptyDraft() {
    return { title: '', narrative: '', cost_lines: [blankCostLine()], charge_lines: [blankChargeLine()], photo_media_ids: [] };
  }

  function savePayload(job, kind, chainId, baseVersionId, draft) {
    var p = {
      job_id: job.id,
      kind: kind,
      base_version_id: baseVersionId || null,
      title: String(draft.title || '').trim(),
      narrative: String(draft.narrative || ''),
      cost_lines: cleanCostLines(draft.cost_lines),
      charge_lines: cleanChargeLines(draft.charge_lines),
      photo_media_ids: (draft.photo_media_ids || []).slice()
    };
    if (chainId) p.chain_id = chainId;
    return p;
  }

  // Compare what matters for saving, so a reload that changes nothing does not trigger a save.
  function draftFingerprint(draft) {
    return JSON.stringify({
      t: String(draft.title || '').trim(),
      n: String(draft.narrative || ''),
      c: cleanCostLines(draft.cost_lines),
      q: cleanChargeLines(draft.charge_lines),
      p: draft.photo_media_ids || []
    });
  }

  function latestVersion(chain) {
    var vs = (chain && chain.versions) || [];
    return vs.length ? vs[vs.length - 1] : null;
  }

  function searchText(job) {
    return [job.job_number, job.client_name, job.site_address, job.site_suburb, job.builder_name,
      job.builder_work_order, job.builder_purchase_order, job.category].filter(Boolean).join(' ').toLowerCase();
  }

  function filterJobs(jobs, query) {
    var words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return (jobs || []).slice();
    return (jobs || []).filter(function (j) {
      var t = searchText(j);
      return words.every(function (w) { return t.indexOf(w) !== -1; });
    });
  }

  // Group repair jobs by builder (e.g. ML Builders), builders A to Z, "No builder" last.
  function groupByBuilder(jobs) {
    var map = {};
    (jobs || []).forEach(function (j) {
      var k = (j.builder_name && String(j.builder_name).trim()) || '';
      (map[k] = map[k] || []).push(j);
    });
    return Object.keys(map).sort(function (a, b) {
      if (!a) return 1;
      if (!b) return -1;
      return a.localeCompare(b);
    }).map(function (k) {
      var list = map[k].slice().sort(function (a, b) {
        return String(b.created_at || '').localeCompare(String(a.created_at || ''));
      });
      return { builder: k || 'No builder on record', jobs: list };
    });
  }

  function stageLabel(s) { return STAGE_LABELS[s] || (s ? String(s) : ''); }

  function categoryLabel(v) {
    for (var i = 0; i < PRIVATE_CATEGORIES.length; i++) if (PRIVATE_CATEGORIES[i].value === v) return PRIVATE_CATEGORIES[i].label;
    return v ? String(v).replace(/_/g, ' ') : '';
  }

  // Local draft storage key. A new variation has no chain yet, so it uses a local id.
  function draftKey(jobId, kind, chainRef) {
    return 'qb:draft:' + jobId + ':' + kind + ':' + (chainRef || 'scope');
  }

  function fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Australia/Perth' });
  }

  function fmtDateTime(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Perth' });
  }

  function addressLine(job) {
    return [job && job.site_address, job && job.site_suburb].filter(Boolean).join(', ');
  }

  return {
    GST_RATE: GST_RATE, REPAIR_STAGES: REPAIR_STAGES, STAGE_LABELS: STAGE_LABELS, STAGE_FILTERS: STAGE_FILTERS,
    UNITS: UNITS, PRIVATE_CATEGORIES: PRIVATE_CATEGORIES,
    round2: round2, num: num, money: money, qtyText: qtyText, uuid: uuid, newLineId: newLineId,
    blankCostLine: blankCostLine, blankChargeLine: blankChargeLine,
    costLineTotal: costLineTotal, chargeLineTotal: chargeLineTotal, chargeLineGst: chargeLineGst, totals: totals,
    isBlankLine: isBlankLine, hasAmounts: hasAmounts, unnamedLines: unnamedLines, cleanCostLines: cleanCostLines, cleanChargeLines: cleanChargeLines, chargeFromCosts: chargeFromCosts,
    draftFromVersion: draftFromVersion, emptyDraft: emptyDraft, savePayload: savePayload, draftFingerprint: draftFingerprint,
    latestVersion: latestVersion, filterJobs: filterJobs, groupByBuilder: groupByBuilder,
    stageLabel: stageLabel, categoryLabel: categoryLabel, draftKey: draftKey,
    fmtDate: fmtDate, fmtDateTime: fmtDateTime, addressLine: addressLine
  };
});
