// In-memory stand-in for Supabase auth, Storage and the ops-api quote_builder_* actions,
// written from secureworks-backend docs/quote-builder-contract.md (v1) plus the additions
// the app expects next (docs/backend-needed.md: settings and line types). Routes are
// installed on a Playwright page, so nothing leaves the machine.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SB = 'https://kevgrhcjxspbxgovpmfl.supabase.co';
const ROOT = path.resolve(__dirname, '..', '..');
const STAGES = ['wo_in', 'scoping', 'quoted', 'variation', 'approved', 'materials', 'scheduled', 'on_site', 'complete'];
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const uuid = () => crypto.randomUUID();
const now = () => new Date().toISOString();

// ops-api answers the browser's preflight with these request headers and no others
// (ops-api/index.ts), so a call carrying any other header never leaves a real browser.
const OPS_API_ALLOWED_HEADERS = ['content-type', 'authorization', 'x-api-key'];
const SET_BY_BROWSER = /^(accept|accept-encoding|accept-language|user-agent|origin|referer|content-length|host|connection|priority|sec-.+)$/;

const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'hugo@secureworkswa.com.au', user_metadata: { full_name: 'Hugo Tester' } };

function seed() {
  const job = (o) => Object.assign({ id: uuid(), status: 'processing', client_phone: '', client_email: '', created_at: now(), category: null, builder_purchase_order: null }, o);
  return {
    offline: false,
    loseReply: {},    // action -> true: the next call is carried out, then its reply is dropped
    calls: [],
    logouts: [],      // scope of each sign-out the auth server was sent
    files: {},
    jobs: [
      job({ job_number: 'SWR-26101', type: 'repair', repair_stage: 'scoping', client_name: 'J Smith', site_address: '12 Example St', site_suburb: 'Morley', builder_name: 'ML Builders', builder_work_order: 'MLB-27093', builder_purchase_order: 'PO-56481' }),
      job({ job_number: 'SWR-26102', type: 'repair', repair_stage: 'wo_in', client_name: 'A Brown', site_address: '4 Test Ave', site_suburb: 'Bayswater', builder_name: 'Builderwest', builder_work_order: 'BW-1001' }),
      job({ job_number: 'SWR-26103', type: 'repair', repair_stage: 'scoping', client_name: 'K Lee', site_address: '9 Sample Rd', site_suburb: 'Inglewood', builder_name: 'ML Builders', builder_work_order: 'MLB-27100' }),
      job({ job_number: 'SWR-26104', type: 'repair', repair_stage: 'approved', client_name: 'P Green', site_address: '1 Done St', site_suburb: 'Perth', builder_name: 'AJ Building & Restoration' })
    ],
    versions: [],
    photos: [],
    documents: [],
    variations: [],
    chains: {},       // chain_id -> { job_id, kind }
    scopeChain: {},   // job_id -> chain_id
    privateReq: {},   // request_id -> job_id
    nextMisc: 26001,
    // Pricing settings from quote_builder_settings, not org_config. Test values only: the
    // real numbers live on the server and never in this repo. Set settings to undefined to
    // stand in for an older ops-api that does not send them or keep line types yet. Set it
    // to null for a repair job whose settings read came back null.
    settings: { labour_rate_ex_gst: 95, materials_multiplier: 1.5, target_margin_pct: null }
  };
}

// Like ops-api normaliseCostLines: only the contract's fields are kept. A server with
// settings keeps a valid line_type and drops any other value without refusing the line.
function costLine(db, l) {
  const out = { line_id: l.line_id || 'c-' + uuid().slice(0, 8), description: l.description, qty: l.qty, unit: l.unit,
    unit_cost_ex_gst: l.unit_cost_ex_gst, line_total_ex_gst: r2(l.qty * l.unit_cost_ex_gst), supplier_or_trade: l.supplier_or_trade };
  if (db.settings !== undefined && ['material', 'labour', 'other'].includes(l.line_type)) out.line_type = l.line_type;
  return out;
}
function chargeLine(l) {
  const ex = r2(l.qty * l.unit_price_ex_gst);
  const gst = l.gst_applies === false ? 0 : r2(ex * 0.1);
  return Object.assign({}, l, { line_id: l.line_id || 'q-' + uuid().slice(0, 8), gst_applies: l.gst_applies !== false, line_total_ex_gst: ex, gst_ex: gst, line_total_inc_gst: r2(ex + gst) });
}
function totals(v) {
  const cost = r2(v.cost_lines.reduce((s, l) => s + l.line_total_ex_gst, 0));
  const ex = r2(v.charge_lines.reduce((s, l) => s + l.line_total_ex_gst, 0));
  const gst = r2(v.charge_lines.reduce((s, l) => s + l.gst_ex, 0));
  const margin = r2(ex - cost);
  Object.assign(v, { cost_total_ex_gst: cost, charge_total_ex_gst: ex, charge_gst: gst, charge_total_inc_gst: r2(ex + gst), margin_ex_gst: margin, margin_pct: ex > 0 ? r2(margin / ex * 100) : null });
}

function err(status, code) { return { status, body: { error: code, code } }; }

function publicJob(db, j) {
  return {
    id: j.id, job_number: j.job_number, type: j.type, status: j.status, repair_stage: j.type === 'repair' ? j.repair_stage : null,
    client_name: j.client_name, client_phone: j.client_phone, client_email: j.client_email, site_address: j.site_address, site_suburb: j.site_suburb,
    builder_name: j.builder_name || null, builder_work_order: j.builder_work_order || null, builder_purchase_order: j.builder_purchase_order || null,
    category: j.category || null, created_at: j.created_at
  };
}

function chainVersions(db, chainId) { return db.versions.filter((v) => v.chain_id === chainId).sort((a, b) => a.version - b.version); }

function moveStage(job, to) {
  if (job.type !== 'repair') return { moved: false, reason: 'not_a_repair_job' };
  if (STAGES.indexOf(job.repair_stage) >= STAGES.indexOf(to)) return { moved: false, reason: 'already_past_stage', stage: job.repair_stage };
  const from = job.repair_stage;
  job.repair_stage = to;
  return { moved: true, from, to };
}

function handle(db, action, q, body) {
  const findJob = (id) => db.jobs.find((j) => j.id === id);
  switch (action) {
    case 'quote_builder_list_jobs': {
      const lane = q.get('lane') || 'repair';
      const stages = (q.get('stages') || 'wo_in,scoping').split(',');
      const jobs = db.jobs.filter((j) => lane === 'private' ? j.type === 'miscellaneous' : j.type === 'repair' && stages.includes(j.repair_stage)).map((j) => {
        const cid = db.scopeChain[j.id];
        const vs = cid ? chainVersions(db, cid) : [];
        const lv = vs[vs.length - 1];
        return Object.assign(publicJob(db, j), { latest_scope: lv ? { version: lv.version, status: lv.status, charge_total_inc_gst: lv.charge_total_inc_gst, updated_at: lv.updated_at } : null });
      });
      return { status: 200, body: { lane, stages: lane === 'repair' ? stages : null, jobs } };
    }
    case 'quote_builder_get_job': {
      const j = findJob(q.get('job_id'));
      if (!j) return err(404, 'job_not_found');
      const cid = db.scopeChain[j.id] || null;
      const varChains = Object.keys(db.chains).filter((c) => db.chains[c].job_id === j.id && db.chains[c].kind === 'variation');
      // A private job, and an older server (settings === undefined), get neither key.
      // A repair job gets the goal and can_edit_settings: false. settings === null is a
      // failed read: the key is present and null, and there is still nothing to edit.
      const goal = db.settings === undefined || j.type === 'miscellaneous' ? {} :
        { settings: db.settings === null ? null : Object.assign({}, db.settings), can_edit_settings: false };
      return { status: 200, body: Object.assign(goal, {
        job: publicJob(db, j),
        scope: { chain_id: cid, versions: cid ? chainVersions(db, cid) : [] },
        variations: varChains.map((c) => {
          const vr = db.variations.find((v) => v.chain_id === c);
          return { chain_id: c, variation_id: vr ? vr.id : null, variation_number: vr ? vr.number : null, variation_status: vr ? vr.status : null, versions: chainVersions(db, c) };
        }),
        photos: db.photos.filter((p) => p.job_id === j.id).map((p) => ({ id: p.id, url: p.url, caption: p.caption, taken_at: p.taken_at || null, created_at: p.created_at })),
        documents: db.documents.filter((d) => d.job_id === j.id && !d.superseded_at).map((d) => ({ id: d.id, quote_number: d.quote_number, url: d.url, version_id: d.version_id, created_at: d.created_at }))
      }) };
    }
    case 'quote_builder_create_private_job': {
      if (!body.request_id || !body.client_name) return err(400, 'client_name_required');
      if (db.privateReq[body.request_id]) return { status: 200, body: { created: false, job: publicJob(db, findJob(db.privateReq[body.request_id])) } };
      const j = { id: uuid(), job_number: 'SWM-' + (db.nextMisc++), type: 'miscellaneous', status: 'draft', repair_stage: null, client_name: body.client_name, client_phone: body.client_phone,
        client_email: body.client_email, site_address: body.site_address, site_suburb: body.site_suburb, category: body.category || 'private_renovation', created_at: now() };
      db.jobs.push(j);
      db.privateReq[body.request_id] = j.id;
      return { status: 200, body: { created: true, job: publicJob(db, j) } };
    }
    case 'quote_builder_save': {
      const j = findJob(body.job_id);
      if (!j) return err(404, 'job_not_found');
      if (!['repair', 'miscellaneous'].includes(j.type)) return err(409, 'job_not_quotable');
      for (const l of [...body.cost_lines, ...body.charge_lines]) if (!l.description) return err(400, 'description_required');
      let chainId;
      if (body.kind === 'scope') {
        chainId = db.scopeChain[j.id];
        if (!chainId) { chainId = uuid(); db.scopeChain[j.id] = chainId; db.chains[chainId] = { job_id: j.id, kind: 'scope' }; }
      } else if (body.chain_id) {
        chainId = body.chain_id;
        if (!db.chains[chainId]) return err(404, 'chain_not_found');
      } else {
        chainId = uuid(); db.chains[chainId] = { job_id: j.id, kind: 'variation' };
      }
      const vs = chainVersions(db, chainId);
      const latest = vs[vs.length - 1] || null;
      if ((body.base_version_id || null) !== (latest ? latest.id : null)) return err(409, 'stale_version');
      let v;
      if (latest && latest.status === 'draft') v = latest;
      else {
        const vr = db.variations.find((x) => x.chain_id === chainId);
        v = { id: uuid(), job_id: j.id, kind: body.kind, chain_id: chainId, version: latest ? latest.version + 1 : 1, status: 'draft', created_by: USER.id, created_at: now(),
          variation_id: vr ? vr.id : null, issued_by: null, issued_at: null, client_pdf_document_id: null };
        db.versions.push(v);
      }
      Object.assign(v, { title: body.title, narrative: body.narrative, cost_lines: body.cost_lines.map((l) => costLine(db, l)), charge_lines: body.charge_lines.map(chargeLine),
        photo_media_ids: body.photo_media_ids || [], client_snapshot: { client_name: j.client_name }, quote_number: null, updated_at: now(), _slot: null });
      totals(v);
      return { status: 200, body: { version: strip(v) } };
    }
    case 'quote_builder_photo_upload_url': {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(body.content_type)) return err(400, 'content_type_not_allowed');
      const p = body.job_id + '/scope/' + uuid().slice(0, 8) + '-' + body.file_name;
      return { status: 200, body: { path: p, signed_url: SB + '/storage/v1/object/upload/sign/job-photos/' + p + '?token=t', token: 't', public_url: SB + '/storage/v1/object/public/job-photos/' + p } };
    }
    case 'quote_builder_photo_register': {
      if (!db.files['job-photos/' + body.path]) return err(409, 'upload_missing');
      let ph = db.photos.find((p) => p.path === body.path);
      if (!ph) {
        ph = { id: uuid(), job_id: body.job_id, path: body.path, url: SB + '/storage/v1/object/public/job-photos/' + body.path, caption: body.caption || '', taken_at: body.taken_at || null, created_at: now() };
        db.photos.push(ph);
      }
      return { status: 200, body: { photo: { id: ph.id, url: ph.url, caption: ph.caption } } };
    }
    case 'quote_builder_photo_caption': {
      const ph = db.photos.find((p) => p.id === body.photo_id);
      if (!ph) return err(404, 'photo_not_found');
      ph.caption = body.caption;
      return { status: 200, body: { photo: { id: ph.id, url: ph.url, caption: ph.caption } } };
    }
    case 'quote_builder_pdf_upload_url': {
      const v = db.versions.find((x) => x.id === body.version_id);
      if (!v) return err(404, 'version_not_found');
      if (v.status !== 'draft') return err(409, 'version_frozen');
      const j = findJob(v.job_id);
      let qn;
      if (v.kind === 'scope') qn = j.job_number + '-Q' + v.version;
      else {
        const vr = db.variations.find((x) => x.chain_id === v.chain_id);
        const n = vr ? vr.number : db.variations.filter((x) => x.job_id === j.id).length + 1;
        qn = j.job_number + '-V' + n + '.' + v.version;
      }
      const p = j.id + '/quotes/' + qn + '-' + uuid().slice(0, 6) + '.pdf';
      v._slot = { path: p, quote_number: qn };
      v.quote_number = qn;
      return { status: 200, body: { path: p, signed_url: SB + '/storage/v1/object/upload/sign/job-pdfs/' + p + '?token=t', token: 't', quote_number: qn } };
    }
    case 'quote_builder_issue': {
      const v = db.versions.find((x) => x.id === body.version_id);
      if (!v) return err(404, 'version_not_found');
      if (v.status !== 'draft') return err(409, 'version_frozen');
      if (!v.charge_lines.length) return err(409, 'no_charge_lines');
      if (!v._slot || v._slot.path !== body.pdf_path) return err(409, 'pdf_not_prepared');
      if (!db.files['job-pdfs/' + body.pdf_path]) return err(409, 'upload_missing');
      const j = findJob(v.job_id);
      db.documents.filter((d) => d.chain_id === v.chain_id && !d.superseded_at).forEach((d) => { d.superseded_at = now(); });
      const doc = { id: uuid(), job_id: j.id, chain_id: v.chain_id, version_id: v.id, quote_number: v._slot.quote_number, url: SB + '/storage/v1/object/public/job-pdfs/' + body.pdf_path, created_at: now() };
      db.documents.push(doc);
      Object.assign(v, { status: 'issued', issued_at: now(), issued_by: USER.id, client_pdf_document_id: doc.id });
      let variation = null, stage;
      if (v.kind === 'variation') {
        let vr = db.variations.find((x) => x.chain_id === v.chain_id);
        if (vr && vr.status !== 'pending_approval') return err(409, 'variation_decided');
        if (!vr) { vr = { id: uuid(), job_id: j.id, chain_id: v.chain_id, number: db.variations.filter((x) => x.job_id === j.id).length + 1, status: 'pending_approval' }; db.variations.push(vr); }
        vr.amount = v.charge_total_inc_gst; vr.cost_estimate = v.cost_total_ex_gst;
        v.variation_id = vr.id;
        variation = { id: vr.id, variation_number: vr.number, status: vr.status, amount: vr.amount };
        stage = moveStage(j, 'variation');
      } else stage = moveStage(j, 'quoted');
      return { status: 200, body: { version: strip(v), document: { id: doc.id, quote_number: doc.quote_number, url: doc.url }, variation, stage } };
    }
    case 'quote_builder_decide_variation': {
      const vr = db.variations.find((x) => x.id === body.variation_id);
      if (!vr) return err(404, 'variation_not_found');
      if (vr.status !== 'pending_approval') return err(409, 'variation_decided');
      vr.status = body.approved ? 'approved' : 'rejected';
      const stage = body.approved ? moveStage(findJob(vr.job_id), 'approved') : { moved: false, reason: 'rejected' };
      return { status: 200, body: { approved: !!body.approved, variation_id: vr.id, stage } };
    }
    default:
      return err(400, 'unknown_action');
  }
}

function strip(v) { const o = Object.assign({}, v); delete o._slot; return o; }

const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };

async function install(page, db) {
  await page.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js', (r) =>
    r.fulfill({ path: path.join(ROOT, 'node_modules/@supabase/supabase-js/dist/umd/supabase.js'), contentType: 'text/javascript', headers: cors }));
  await page.route('https://cdnjs.cloudflare.com/ajax/libs/jspdf/3.0.3/jspdf.umd.min.js', (r) =>
    r.fulfill({ path: path.join(ROOT, 'node_modules/jspdf/dist/jspdf.umd.min.js'), contentType: 'text/javascript', headers: cors }));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));

  await page.route(SB + '/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (db.offline) return route.abort('internetdisconnected');

    if (url.pathname === '/auth/v1/token') {
      const b = JSON.parse(req.postData() || '{}');
      if (url.searchParams.get('grant_type') === 'password' && b.password !== 'right-password') {
        return route.fulfill({ status: 400, headers: cors, contentType: 'application/json', body: JSON.stringify({ error: 'invalid_grant', error_description: 'Invalid login credentials' }) });
      }
      const exp = Math.floor(Date.now() / 1000) + 3600;
      return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({
        access_token: 'test-access-token', token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: 'r', user: USER }) });
    }
    if (url.pathname === '/auth/v1/logout') { db.logouts.push(url.searchParams.get('scope')); return route.fulfill({ status: 204, headers: cors }); }
    if (url.pathname === '/auth/v1/user') return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(USER) });

    if (url.pathname.startsWith('/storage/v1/object/upload/sign/')) {
      const key = decodeURIComponent(url.pathname.replace('/storage/v1/object/upload/sign/', ''));
      db.files[key] = { body: req.postDataBuffer(), type: req.headers()['content-type'] };
      return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ Key: key }) });
    }
    if (url.pathname.startsWith('/storage/v1/object/public/')) {
      const key = decodeURIComponent(url.pathname.replace('/storage/v1/object/public/', ''));
      const f = db.files[key];
      if (!f) return route.fulfill({ status: 404, headers: cors });
      return route.fulfill({ status: 200, headers: cors, contentType: f.type, body: f.body });
    }
    if (url.pathname === '/functions/v1/ops-api') {
      const action = url.searchParams.get('action');
      const auth = req.headers()['authorization'];
      const apikey = req.headers()['apikey'];
      db.calls.push({ action, method: req.method(), auth, apikey, body: req.postData() ? JSON.parse(req.postData()) : null });
      if (Object.keys(req.headers()).some((h) => !OPS_API_ALLOWED_HEADERS.includes(h) && !SET_BY_BROWSER.test(h))) return route.abort('failed');
      if (auth !== 'Bearer test-access-token') return route.fulfill({ status: 401, headers: cors, contentType: 'application/json', body: JSON.stringify({ error: 'unauthorized', code: 'unauthorized' }) });
      const body = req.postData() ? JSON.parse(req.postData()) : {};
      const r = handle(db, action, url.searchParams, body);
      if (db.loseReply[action]) { delete db.loseReply[action]; return route.abort('internetdisconnected'); }
      return route.fulfill({ status: r.status, headers: cors, contentType: 'application/json', body: JSON.stringify(r.body) });
    }
    return route.fulfill({ status: 404, headers: cors });
  });
}

module.exports = { seed, install, USER, SB };
