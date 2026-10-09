// Quote builder screens. Plain JS, no build step. Hash routes:
//   #/                      job list (insurance repairs or private quotes)
//   #/new                   new private quote (creates a miscellaneous job)
//   #/job/<id>              the job's scope (cost table, photos, client charge table)
//   #/job/<id>/variations   the job's variations
//   #/job/<id>/var/<ref>    one variation (ref is its chain id, or new-<local id> before first save)
//   #/job/<id>/history      every version: what was allowed against what was quoted
//   #/job/<id>/v/<id>       one version, read only
(function () {
  'use strict';
  var L = window.QBLib, api = window.QBApi, store = window.QBStore;
  var app = document.getElementById('app');

  var state = {
    session: null,
    lane: store.getJSON('qb:lane') || 'repair',
    stageFilter: store.getJSON('qb:stageFilter') || 'to_scope',
    search: '',
    bundles: {},      // job_id -> quote_builder_get_job response
    editor: null,     // the open scope or variation editor
    pending: [],      // photos waiting to upload
    online: navigator.onLine !== false
  };

  // ---------- DOM helpers ----------
  function el(tag, attrs) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
      else if (k === 'value') n.value = v;
      else if (k === 'checked') n.checked = !!v;
      else if (k === 'disabled') n.disabled = !!v;
      else n.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) append(n, arguments[i]);
    return n;
  }
  // append(parent, child, child, ...): children may be nodes, strings, arrays or null.
  function append(n, c) {
    if (arguments.length > 2) { for (var i = 1; i < arguments.length; i++) append(n, arguments[i]); return; }
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { append(n, x); }); return; }
    n.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function $(sel, root) { return (root || document).querySelector(sel); }

  function toast(msg, kind) {
    var t = el('div', { class: 'toast ' + (kind || ''), role: 'status', text: msg });
    document.body.appendChild(t);
    setTimeout(function () { t.classList.add('show'); }, 10);
    setTimeout(function () { t.classList.remove('show'); setTimeout(function () { t.remove(); }, 300); }, 3200);
  }

  // A modal that resolves with the button value. Never uses window.alert/confirm.
  function modal(opts) {
    return new Promise(function (resolve) {
      var back = el('div', { class: 'modal-back' });
      var box = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' });
      function done(v) { back.remove(); resolve(v); }
      append(box, el('h2', { text: opts.title }));
      if (opts.body) append(box, typeof opts.body === 'string' ? el('p', { text: opts.body }) : opts.body);
      var row = el('div', { class: 'modal-actions' });
      (opts.buttons || [{ label: 'OK', value: true, primary: true }]).forEach(function (b) {
        append(row, el('button', { class: 'btn ' + (b.primary ? 'btn-primary' : b.danger ? 'btn-danger' : 'btn-ghost'), text: b.label,
          onclick: function () { done(typeof b.value === 'function' ? b.value() : b.value); } }));
      });
      append(box, row);
      append(back, box);
      back.addEventListener('click', function (e) { if (e.target === back && opts.dismissValue !== undefined) done(opts.dismissValue); });
      document.body.appendChild(back);
      var first = box.querySelector('input,textarea');
      if (first) setTimeout(function () { first.focus(); }, 50);
    });
  }

  function errorText(e) {
    if (!e) return 'Something went wrong';
    if (e.code === 'network') return 'No connection. Your work is kept on this iPad.';
    if (e.code === 'operator_access_required') return 'Your login does not have quote builder access. Ask Marnin to give your login the ops manager role.';
    if (e.code === 'not_signed_in' || e.status === 401) return 'Please sign in again.';
    return e.message || String(e);
  }

  // ---------- Shell ----------
  function topbar(back) {
    var user = state.session && state.session.user;
    return el('header', { class: 'topbar' },
      el('div', { class: 'topbar-left' },
        back ? el('a', { class: 'btn btn-back', href: back.href, text: '‹ ' + back.label }) :
          el('a', { class: 'brand', href: '#/' }, el('img', { src: 'assets/logo-white.png', alt: 'SecureWorks' }), el('span', { text: 'Quote builder' }))),
      el('div', { class: 'topbar-right' },
        el('span', { class: 'net ' + (state.online ? 'on' : 'off'), text: state.online ? '' : 'Offline' }),
        state.pending.length ? el('span', { class: 'pill pill-warn', text: state.pending.length + ' photo' + (state.pending.length > 1 ? 's' : '') + ' waiting' }) : null,
        user ? el('button', { class: 'btn btn-ghost-light', text: 'Sign out', onclick: signOut }) : null));
  }

  function preparedBy() {
    var u = state.session && state.session.user;
    if (!u) return '';
    var m = u.user_metadata || {};
    if (m.full_name || m.name) return m.full_name || m.name;
    var local = String(u.email || '').split('@')[0].replace(/[._-]+/g, ' ');
    return local.replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  // ---------- Sign in ----------
  function renderSignIn(message) {
    clear(app);
    var email = el('input', { type: 'email', id: 'email', autocomplete: 'username', autocapitalize: 'off', placeholder: 'you@secureworkswa.com.au', required: true });
    var pw = el('input', { type: 'password', id: 'password', autocomplete: 'current-password', placeholder: 'Password', required: true });
    var err = el('p', { class: 'form-error', text: message || '' });
    var btn = el('button', { class: 'btn btn-primary btn-block', type: 'submit', text: 'Sign in' });
    var form = el('form', { class: 'signin-card', onsubmit: async function (e) {
      e.preventDefault();
      btn.disabled = true; btn.textContent = 'Signing in…'; err.textContent = '';
      try {
        state.session = await api.signIn(email.value.trim(), pw.value);
        route();
      } catch (ex) {
        err.textContent = /invalid/i.test(ex.message || '') ? 'Email or password is not right.' : errorText(ex);
        btn.disabled = false; btn.textContent = 'Sign in';
      }
    } },
      el('img', { class: 'signin-logo', src: 'assets/logo-white.png', alt: 'SecureWorks Group' }),
      el('h1', { text: 'Quote builder' }),
      el('p', { class: 'muted-light', text: 'Sign in with your SecureWorks login (the same one as the fence and patio tools).' }),
      el('label', { for: 'email', text: 'Email' }), email,
      el('label', { for: 'password', text: 'Password' }), pw,
      err, btn);
    append(app, el('div', { class: 'signin-wrap' }, form));
  }

  async function signOut() {
    var ok = await modal({ title: 'Sign out?', body: 'Drafts stay saved on this iPad.', buttons: [
      { label: 'Cancel', value: false }, { label: 'Sign out', value: true, primary: true }] });
    if (!ok) return;
    await api.signOut();
    state.session = null;
    location.hash = '#/';
    renderSignIn();
  }

  // ---------- Job list ----------
  function listCacheKey() { return 'qb:list:' + state.lane + ':' + (state.lane === 'repair' ? state.stageFilter : 'all'); }

  async function renderList() {
    clear(app);
    append(app, topbar());
    var main = el('main', { class: 'page' });
    append(app, main);

    var lanes = el('div', { class: 'seg' },
      el('button', { class: 'seg-btn' + (state.lane === 'repair' ? ' active' : ''), text: 'Insurance repairs', onclick: function () { setLane('repair'); } }),
      el('button', { class: 'seg-btn' + (state.lane === 'private' ? ' active' : ''), text: 'Private quotes', onclick: function () { setLane('private'); } }));
    append(main, el('div', { class: 'list-head' }, lanes,
      el('a', { class: 'btn btn-primary', href: '#/new', text: '+ New private quote' })));

    if (state.lane === 'repair') {
      append(main, el('div', { class: 'chips' }, L.STAGE_FILTERS.map(function (f) {
        return el('button', { class: 'chip' + (state.stageFilter === f.key ? ' active' : ''), text: f.label, onclick: function () {
          state.stageFilter = f.key; store.setJSON('qb:stageFilter', f.key); renderList();
        } });
      })));
    }
    var search = el('input', { type: 'search', class: 'search', placeholder: 'Search job number, client, address, builder, work order', value: state.search,
      oninput: function () { state.search = search.value; drawJobs(); } });
    append(main, search);
    var listEl = el('div', { class: 'job-list' }, el('p', { class: 'muted', text: 'Loading jobs…' }));
    append(main, listEl);

    var jobs = null, note = '';
    var cached = store.getJSON(listCacheKey());
    if (cached) { jobs = cached.jobs; drawJobs(); }
    try {
      var stages = state.lane === 'repair' ? L.STAGE_FILTERS.filter(function (f) { return f.key === state.stageFilter; })[0].stages : null;
      var r = await api.listJobs(state.lane, stages);
      jobs = r.jobs || [];
      note = '';
      store.setJSON(listCacheKey(), { jobs: jobs, at: new Date().toISOString() });
    } catch (e) {
      note = errorText(e) + (cached ? ' Showing the list from ' + L.fmtDateTime(cached.at) + '.' : '');
      if (!jobs) jobs = [];
    }
    drawJobs();

    function drawJobs() {
      clear(listEl);
      if (note) append(listEl, el('p', { class: 'banner banner-warn', text: note }));
      var shown = L.filterJobs(jobs || [], state.search);
      if (!shown.length) {
        append(listEl, el('p', { class: 'empty', text: jobs && jobs.length ? 'No jobs match that search.' :
          state.lane === 'repair' ? 'No repair jobs at this stage.' : 'No private quotes yet. Tap New private quote to start one.' }));
        return;
      }
      if (state.lane === 'repair') {
        L.groupByBuilder(shown).forEach(function (g) {
          append(listEl, el('section', { class: 'group' },
            el('h2', { class: 'group-title' }, g.builder, el('span', { class: 'count', text: String(g.jobs.length) })),
            g.jobs.map(jobCard)));
        });
      } else {
        append(listEl, shown.map(jobCard));
      }
    }
  }

  function setLane(l) { state.lane = l; store.setJSON('qb:lane', l); renderList(); }

  function jobCard(j) {
    var ls = j.latest_scope;
    var scopeText = ls ? 'v' + ls.version + ' ' + (ls.status === 'issued' ? 'issued' : 'draft') + ' · ' + L.money(ls.charge_total_inc_gst) : 'Not scoped yet';
    var refs = [j.builder_work_order && ('WO ' + j.builder_work_order), j.builder_purchase_order && ('PO ' + j.builder_purchase_order)].filter(Boolean).join('  ·  ');
    var hasLocal = store.keys('qb:draft:' + j.id + ':').some(function (k) { var d = store.getJSON(k); return d && d.dirty; });
    return el('a', { class: 'job-card', href: '#/job/' + j.id },
      el('div', { class: 'job-card-top' },
        el('span', { class: 'job-no', text: j.job_number || 'No number' }),
        j.repair_stage ? el('span', { class: 'pill stage-' + j.repair_stage, text: L.stageLabel(j.repair_stage) }) :
          j.category ? el('span', { class: 'pill', text: L.categoryLabel(j.category) }) : null),
      el('div', { class: 'job-client', text: j.client_name || 'No client name' }),
      el('div', { class: 'job-addr', text: L.addressLine(j) || 'No address' }),
      refs ? el('div', { class: 'job-refs', text: refs }) : null,
      el('div', { class: 'job-scope' + (ls ? '' : ' none') }, scopeText,
        hasLocal ? el('span', { class: 'pill pill-warn', text: 'Unsynced edits on this iPad' }) : null));
  }

  // ---------- New private job ----------
  function renderNewPrivate() {
    clear(app);
    append(app, topbar({ href: '#/', label: 'Jobs' }));
    var saved = store.getJSON('qb:pending-private') || {};
    var f = {};
    function field(key, label, type, attrs) {
      var input = el(type === 'textarea' ? 'textarea' : 'input', Object.assign({ id: 'np-' + key, value: saved[key] || '' }, type === 'textarea' ? { rows: 3 } : { type: type }, attrs || {}));
      input.addEventListener('input', persist);
      f[key] = input;
      return el('div', { class: 'field' }, el('label', { for: 'np-' + key, text: label }), input);
    }
    var cat = el('select', { id: 'np-category', onchange: persist }, L.PRIVATE_CATEGORIES.map(function (c) {
      var o = el('option', { value: c.value, text: c.label });
      if ((saved.category || 'private_renovation') === c.value) o.selected = true;
      return o;
    }));
    f.category = cat;
    function persist() {
      var v = { request_id: saved.request_id };
      Object.keys(f).forEach(function (k) { v[k] = f[k].value; });
      saved = v;
      store.setJSON('qb:pending-private', v);
    }
    var err = el('p', { class: 'form-error' });
    var btn = el('button', { class: 'btn btn-primary btn-block', type: 'submit', text: 'Create job and start quote' });
    var form = el('form', { class: 'card form-card', onsubmit: async function (e) {
      e.preventDefault();
      persist();
      if (!saved.client_name || !saved.client_name.trim()) { err.textContent = 'Client name is needed.'; return; }
      // One request_id per new job, kept across retries so a dropped reply never makes two jobs.
      if (!saved.request_id) { saved.request_id = L.uuid(); store.setJSON('qb:pending-private', saved); }
      btn.disabled = true; btn.textContent = 'Creating…'; err.textContent = '';
      try {
        var r = await api.createPrivateJob({
          request_id: saved.request_id,
          client_name: saved.client_name.trim(), client_phone: saved.client_phone || '', client_email: saved.client_email || '',
          site_address: saved.site_address || '', site_suburb: saved.site_suburb || '',
          category: saved.category || 'private_renovation', notes: saved.notes || ''
        });
        store.remove('qb:pending-private');
        store.remove('qb:list:private:all');
        toast((r.created === false ? 'Opened ' : 'Created ') + (r.job.job_number || 'job'));
        location.hash = '#/job/' + r.job.id;
      } catch (ex) {
        err.textContent = errorText(ex) + (ex.code === 'network' ? ' Tap the button again when you have signal; it will not make a second job.' : '');
        btn.disabled = false; btn.textContent = 'Create job and start quote';
      }
    } },
      el('h1', { text: 'New private quote' }),
      el('p', { class: 'muted', text: 'For work with no insurance job behind it. This makes a new miscellaneous job (SWM number) for the client, then opens its quote.' }),
      field('client_name', 'Client name *', 'text', { autocomplete: 'name', required: true }),
      el('div', { class: 'field-row' }, field('client_phone', 'Phone', 'tel', { autocomplete: 'tel' }), field('client_email', 'Email', 'email', { autocomplete: 'email', autocapitalize: 'off' })),
      el('div', { class: 'field-row' }, field('site_address', 'Site address', 'text', { autocomplete: 'street-address' }), field('site_suburb', 'Suburb', 'text')),
      el('div', { class: 'field' }, el('label', { for: 'np-category', text: 'Kind of work' }), cat),
      field('notes', 'Notes', 'textarea'),
      err, btn);
    append(app, el('main', { class: 'page narrow' }, form));
  }

  // ---------- Job bundle ----------
  function bundleKey(jobId) { return 'qb:job:' + jobId; }

  async function loadBundle(jobId, force) {
    if (!force && state.bundles[jobId]) return state.bundles[jobId];
    try {
      var b = await api.getJob(jobId);
      state.bundles[jobId] = b;
      store.setJSON(bundleKey(jobId), { bundle: b, at: new Date().toISOString() });
      return b;
    } catch (e) {
      if (e.code === 'network') {
        var c = store.getJSON(bundleKey(jobId));
        if (c) { c.bundle._offlineAt = c.at; state.bundles[jobId] = c.bundle; return c.bundle; }
      }
      throw e;
    }
  }

  function jobHeader(job, active) {
    var info = [];
    if (job.type === 'miscellaneous') {
      if (job.client_phone) info.push(['Phone', job.client_phone]);
      if (job.client_email) info.push(['Email', job.client_email]);
      if (job.category) info.push(['Kind', L.categoryLabel(job.category)]);
    } else {
      info.push(['Builder', job.builder_name || 'Not on record']);
      if (job.builder_work_order) info.push(['Work order', job.builder_work_order]);
      if (job.builder_purchase_order) info.push(['Purchase order', job.builder_purchase_order]);
    }
    var base = '#/job/' + job.id;
    return el('div', { class: 'job-head' },
      el('div', { class: 'job-head-main' },
        el('div', { class: 'job-head-title' },
          el('span', { class: 'job-no big', text: job.job_number || '' }),
          job.repair_stage ? el('span', { class: 'pill stage-' + job.repair_stage, text: L.stageLabel(job.repair_stage) }) : el('span', { class: 'pill', text: 'Private' })),
        el('div', { class: 'job-client big', text: job.client_name || 'No client name' }),
        el('div', { class: 'job-addr', text: L.addressLine(job) || 'No address' })),
      el('dl', { class: 'job-head-info' }, info.map(function (p) { return [el('dt', { text: p[0] }), el('dd', { text: p[1] })]; })),
      el('nav', { class: 'tabs' },
        el('a', { class: 'tab' + (active === 'scope' ? ' active' : ''), href: base, text: 'Scope' }),
        el('a', { class: 'tab' + (active === 'variations' ? ' active' : ''), href: base + '/variations', text: 'Variations' }),
        el('a', { class: 'tab' + (active === 'history' ? ' active' : ''), href: base + '/history', text: 'History' })));
  }

  async function withBundle(jobId, active, fn) {
    clear(app);
    append(app, topbar({ href: '#/', label: 'Jobs' }));
    var main = el('main', { class: 'page' }, el('p', { class: 'muted', text: 'Loading job…' }));
    append(app, main);
    var b;
    try { b = await loadBundle(jobId, true); }
    catch (e) {
      clear(main);
      append(main, el('p', { class: 'banner banner-error', text: e.status === 404 ? 'That job was not found.' : errorText(e) }),
        el('button', { class: 'btn', text: 'Try again', onclick: route }));
      return;
    }
    clear(main);
    append(main, jobHeader(b.job, active));
    if (b._offlineAt) append(main, el('p', { class: 'banner banner-warn', text: 'Offline. Showing this job as it was at ' + L.fmtDateTime(b._offlineAt) + '. Edits save on this iPad and upload when signal is back.' }));
    fn(main, b);
  }

  // ---------- Editor (scope or one variation) ----------
  function chainFor(b, kind, chainRef) {
    if (kind === 'scope') return b.scope || { chain_id: null, versions: [] };
    return (b.variations || []).filter(function (v) { return v.chain_id === chainRef; })[0] || null;
  }

  function openEditor(main, b, kind, chainRef) {
    flushEditor();
    var chain = chainFor(b, kind, chainRef);
    var isNew = kind === 'variation' && !chain && /^new-/.test(chainRef || '');
    if (kind === 'variation' && !isNew && !chain) { append(main, el('p', { class: 'banner banner-error', text: 'Variation not found.' })); return; }
    var chainId = kind === 'scope' ? (chain.chain_id || null) : (isNew ? null : chain.chain_id);
    var localRef = kind === 'scope' ? 'scope' : chainRef;
    var key = L.draftKey(b.job.id, kind, localRef);
    var latest = chain ? L.latestVersion(chain) : null;
    var local = store.getJSON(key);

    var ed = {
      job: b.job, kind: kind, chainId: chainId, localRef: localRef, key: key,
      baseVersionId: latest ? latest.id : null,
      latest: latest,
      draft: latest ? L.draftFromVersion(latest) : L.emptyDraft(),
      locked: !!(latest && latest.status === 'issued'),
      syncedFp: null,
      saving: false, again: false, timer: null, retryTimer: null,
      status: '', conflict: null,
      knownChains: (b.variations || []).map(function (v) { return v.chain_id; }),
      variation: chain && kind === 'variation' ? chain : null,
      dom: {}
    };
    ed.syncedFp = latest ? L.draftFingerprint(ed.draft) : L.draftFingerprint(L.emptyDraft());

    if (local && local.dirty) {
      if ((local.base_version_id || null) === ed.baseVersionId) {
        ed.draft = local.draft; ed.locked = false;
        if (local.chain_id && !ed.chainId) ed.chainId = local.chain_id;
      } else {
        ed.conflict = local;
      }
    }
    if (!ed.draft.cost_lines.length) ed.draft.cost_lines.push(L.blankCostLine());
    if (!ed.draft.charge_lines.length) ed.draft.charge_lines.push(L.blankChargeLine());
    state.editor = ed;
    renderEditor(main, b, ed);
    if (!ed.conflict && local && local.dirty) scheduleSave(ed, 300);
  }

  function renderEditor(main, b, ed) {
    var wrap = el('div', { class: 'editor' + (ed.locked ? ' locked' : '') });
    ed.dom.wrap = wrap;
    append(main, wrap);

    // Version strip
    ed.dom.versionBar = el('div', { class: 'version-bar' });
    append(wrap, ed.dom.versionBar);
    drawVersionBar(b, ed);

    if (ed.conflict) {
      var c = ed.conflict;
      append(wrap, el('div', { class: 'banner banner-warn conflict' },
        el('p', { text: 'This iPad has edits from ' + L.fmtDateTime(c.updated_at) + ' that were never saved, but this quote has changed since (another save or an issue). Pick which to keep.' }),
        el('div', { class: 'row-actions' },
          el('button', { class: 'btn btn-primary', text: 'Keep my iPad edits', onclick: function () {
            // Save them on top of the newest version (base = what the server has now).
            ed.draft = c.draft; ed.locked = false; ed.conflict = null;
            writeLocal(ed, true); rerenderEditorOnly(state.bundles[ed.job.id], ed); scheduleSave(ed, 50);
          } }),
          el('button', { class: 'btn', text: 'Use the saved version', onclick: function () {
            store.remove(ed.key); ed.conflict = null; rerender();
          } }))));
    }

    // Title and scope write-up (prints on the client quote)
    var title = el('input', { type: 'text', class: 'title-input', placeholder: ed.kind === 'variation' ? 'Variation title, e.g. Extra fascia found rotten' : 'Quote title, e.g. Storm damage repairs', value: ed.draft.title, disabled: ed.locked,
      oninput: function () { ed.draft.title = title.value; changed(ed); } });
    var narrative = el('textarea', { class: 'narrative', rows: 4, placeholder: 'Scope of works: what we will do. This prints on the client quote.', value: ed.draft.narrative, disabled: ed.locked,
      oninput: function () { ed.draft.narrative = narrative.value; autoGrow(narrative); changed(ed); } });
    setTimeout(function () { autoGrow(narrative); }, 0);

    // Internal cost table
    ed.dom.costBody = el('div', { class: 'lines' });
    ed.dom.costTotal = el('strong');
    append(wrap, el('section', { class: 'card internal' },
      el('div', { class: 'card-head' }, el('h2', { text: 'What it costs us' }), el('span', { class: 'pill pill-internal', text: 'Internal only, never on the quote' })),
      el('div', { class: 'lines-head cost' }, ['Description', 'Qty', 'Unit', 'Unit cost', 'Supplier or trade', 'Line total', ''].map(function (h) { return el('span', { text: h }); })),
      ed.dom.costBody,
      el('div', { class: 'lines-foot' },
        el('button', { class: 'btn', text: '+ Add cost line', disabled: ed.locked, onclick: function () { ed.draft.cost_lines.push(L.blankCostLine()); changed(ed); drawCost(ed, true); } }),
        el('div', { class: 'running' }, 'Cost total (ex GST) ', ed.dom.costTotal))));
    drawCost(ed);

    // Photos
    ed.dom.photos = el('div', { class: 'photo-grid' });
    var camInput = el('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'hidden', onchange: function () { addPhotos(ed, camInput.files); camInput.value = ''; } });
    var libInput = el('input', { type: 'file', accept: 'image/*', multiple: true, class: 'hidden', onchange: function () { addPhotos(ed, libInput.files); libInput.value = ''; } });
    append(wrap, el('section', { class: 'card' },
      el('div', { class: 'card-head' }, el('h2', { text: 'Site photos' }), el('span', { class: 'muted small', text: 'Ticked photos go on the client quote' })),
      el('div', { class: 'row-actions' },
        el('button', { class: 'btn btn-primary', text: 'Take photo', onclick: function () { camInput.click(); } }),
        el('button', { class: 'btn', text: 'Choose from library', onclick: function () { libInput.click(); } }),
        camInput, libInput),
      ed.dom.photos));
    drawPhotos(ed);

    // Margin strip between the two halves
    ed.dom.margin = el('div', { class: 'margin-strip' });
    append(wrap, ed.dom.margin);

    // Client charge table
    ed.dom.chargeBody = el('div', { class: 'lines' });
    ed.dom.chargeTotals = el('div', { class: 'charge-totals' });
    append(wrap, el('section', { class: 'card client' },
      el('div', { class: 'card-head' }, el('h2', { text: 'What we charge the client' }), el('span', { class: 'pill pill-client', text: 'Prints on the quote PDF' })),
      el('div', { class: 'field' }, el('label', { text: 'Quote title' }), title),
      el('div', { class: 'field' }, el('label', { text: 'Scope of works' }), narrative),
      el('div', { class: 'lines-head charge' }, ['Description', 'Qty', 'Unit', 'Unit price', 'GST', 'Line total', ''].map(function (h) { return el('span', { text: h }); })),
      ed.dom.chargeBody,
      el('div', { class: 'lines-foot' },
        el('div', { class: 'row-actions' },
          el('button', { class: 'btn', text: '+ Add charge line', disabled: ed.locked, onclick: function () { ed.draft.charge_lines.push(L.blankChargeLine()); changed(ed); drawCharge(ed, true); } }),
          el('button', { class: 'btn btn-ghost', text: 'Fill from costs + markup', disabled: ed.locked, onclick: function () { fillFromCosts(ed); } })),
        ed.dom.chargeTotals)));
    drawCharge(ed);

    // Actions
    ed.dom.actions = el('div', { class: 'editor-actions' });
    append(wrap, ed.dom.actions);
    drawActions(b, ed);
    drawTotals(ed);
  }

  function rerender() { route(); }

  function autoGrow(t) { t.style.height = 'auto'; t.style.height = Math.max(t.scrollHeight, 44) + 'px'; }

  function drawVersionBar(b, ed) {
    var bar = ed.dom.versionBar;
    clear(bar);
    var label;
    if (ed.kind === 'variation') {
      var vn = ed.variation && ed.variation.variation_number;
      label = vn ? 'Variation ' + vn : 'New variation';
    } else label = 'Scope';
    var v = ed.latest;
    var parts = [];
    if (!v) parts.push('not saved yet');
    else if (ed.locked) parts.push('version ' + v.version + ' issued ' + L.fmtDate(v.issued_at) + (v.quote_number ? ' as ' + v.quote_number : ''));
    else if (v.status === 'issued') parts.push('revising: will save as version ' + (v.version + 1));
    else parts.push('version ' + v.version + ' draft');
    var docRow = v && (b.documents || []).filter(function (d) { return d.version_id === v.id; })[0];
    ed.dom.saveState = el('span', { class: 'save-state', text: ed.status });
    append(bar,
      el('div', { class: 'version-label' }, el('strong', { text: label }), ' · ' + parts.join(' '),
        ed.variation && ed.variation.variation_status ? el('span', { class: 'pill var-' + ed.variation.variation_status, text: varStatusLabel(ed.variation.variation_status) }) : null),
      el('div', { class: 'row-actions' },
        docRow && docRow.url ? el('a', { class: 'btn btn-ghost', href: docRow.url, target: '_blank', rel: 'noopener', text: 'Open issued PDF' }) : null,
        ed.locked ? el('button', { class: 'btn btn-primary', text: 'Start a revision', disabled: !canRevise(ed), onclick: function () { ed.locked = false; writeLocal(ed, false); rerenderEditorOnly(b, ed); } }) : null,
        ed.dom.saveState));
    if (ed.locked && !canRevise(ed)) append(bar, el('p', { class: 'muted small', text: 'This variation has been ' + varStatusLabel(ed.variation.variation_status).toLowerCase() + '. Start a new variation for further changes.' }));
  }

  function canRevise(ed) {
    return !(ed.kind === 'variation' && ed.variation && (ed.variation.variation_status === 'approved' || ed.variation.variation_status === 'rejected'));
  }

  function rerenderEditorOnly(b, ed) {
    var main = ed.dom.wrap.parentNode;
    ed.dom.wrap.remove();
    ed.dom = {};
    renderEditor(main, b, ed);
  }

  function varStatusLabel(s) {
    return { pending_approval: 'Waiting on approval', approved: 'Approved', rejected: 'Rejected' }[s] || (s ? String(s).replace(/_/g, ' ') : 'Draft');
  }

  function numInput(value, onchange, disabled, cls) {
    var i = el('input', { type: 'text', inputmode: 'decimal', class: 'num ' + (cls || ''), value: value === 0 || value ? String(value) : '', disabled: disabled, placeholder: '0' });
    i.addEventListener('input', function () { onchange(i.value); });
    i.addEventListener('focus', function () { setTimeout(function () { try { i.select(); } catch (e) { /* ignore */ } }, 0); });
    return i;
  }

  function unitInput(value, onchange, disabled) {
    var i = el('input', { type: 'text', class: 'unit', list: 'qb-units', value: value || '', disabled: disabled, autocapitalize: 'off' });
    i.addEventListener('input', function () { onchange(i.value); });
    return i;
  }

  function descInput(value, onchange, disabled, placeholder) {
    var t = el('textarea', { class: 'desc', rows: 1, value: value || '', disabled: disabled, placeholder: placeholder });
    t.addEventListener('input', function () { onchange(t.value); autoGrow(t); });
    setTimeout(function () { autoGrow(t); }, 0);
    return t;
  }

  function delBtn(onclick, disabled) {
    return el('button', { class: 'btn-icon', 'aria-label': 'Delete line', title: 'Delete line', disabled: disabled, onclick: onclick, text: '×' });
  }

  function drawCost(ed, focusLast) {
    var body = ed.dom.costBody;
    clear(body);
    ed.draft.cost_lines.forEach(function (l, idx) {
      var total = el('span', { class: 'line-total', text: L.money(L.costLineTotal(l)) });
      function upd(field, v) { l[field] = v; total.textContent = L.money(L.costLineTotal(l)); row.classList.toggle('unnamed', L.isBlankLine(l) && hasNums(l)); changed(ed); }
      var row = el('div', { class: 'line cost' + (L.isBlankLine(l) && hasNums(l) ? ' unnamed' : '') },
        descInput(l.description, function (v) { upd('description', v); }, ed.locked, 'What, e.g. Remove and dispose damaged fascia'),
        lbl('Qty', numInput(l.qty, function (v) { upd('qty', v); }, ed.locked)),
        lbl('Unit', unitInput(l.unit, function (v) { upd('unit', v); }, ed.locked)),
        lbl('Unit cost', numInput(l.unit_cost_ex_gst, function (v) { upd('unit_cost_ex_gst', v); }, ed.locked, 'money')),
        lbl('Supplier or trade', el('input', { type: 'text', class: 'supplier', list: 'qb-suppliers', value: l.supplier_or_trade || '', disabled: ed.locked, oninput: function (e) { upd('supplier_or_trade', e.target.value); } })),
        lbl('Line total', total),
        delBtn(function () { ed.draft.cost_lines.splice(idx, 1); if (!ed.draft.cost_lines.length) ed.draft.cost_lines.push(L.blankCostLine()); changed(ed); drawCost(ed); }, ed.locked));
      append(body, row);
    });
    refreshSupplierList(ed);
    if (focusLast) { var d = body.querySelectorAll('.desc'); if (d.length) d[d.length - 1].focus(); }
  }

  function hasNums(l) { return L.num(l.unit_cost_ex_gst) > 0 || L.num(l.unit_price_ex_gst) > 0; }

  function lbl(text, input) { return el('label', { class: 'cell' }, el('span', { class: 'cell-label', text: text }), input); }

  function refreshSupplierList(ed) {
    var dl = $('#qb-suppliers');
    if (!dl) return;
    var seen = {};
    clear(dl);
    ed.draft.cost_lines.forEach(function (l) {
      var s = String(l.supplier_or_trade || '').trim();
      if (s && !seen[s.toLowerCase()]) { seen[s.toLowerCase()] = 1; append(dl, el('option', { value: s })); }
    });
  }

  function drawCharge(ed, focusLast) {
    var body = ed.dom.chargeBody;
    clear(body);
    ed.draft.charge_lines.forEach(function (l, idx) {
      var total = el('span', { class: 'line-total', text: L.money(L.chargeLineTotal(l)) });
      function upd(field, v) { l[field] = v; total.textContent = L.money(L.chargeLineTotal(l)); row.classList.toggle('unnamed', L.isBlankLine(l) && hasNums(l)); changed(ed); }
      var gst = el('input', { type: 'checkbox', checked: l.gst_applies !== false, disabled: ed.locked, onchange: function () { upd('gst_applies', gst.checked); } });
      var row = el('div', { class: 'line charge' + (L.isBlankLine(l) && hasNums(l) ? ' unnamed' : '') },
        descInput(l.description, function (v) { upd('description', v); }, ed.locked, 'What the client sees, e.g. Replace fascia, supply and install'),
        lbl('Qty', numInput(l.qty, function (v) { upd('qty', v); }, ed.locked)),
        lbl('Unit', unitInput(l.unit, function (v) { upd('unit', v); }, ed.locked)),
        lbl('Unit price', numInput(l.unit_price_ex_gst, function (v) { upd('unit_price_ex_gst', v); }, ed.locked, 'money')),
        el('label', { class: 'cell gst' }, el('span', { class: 'cell-label', text: 'GST' }), gst),
        lbl('Line total', total),
        delBtn(function () { ed.draft.charge_lines.splice(idx, 1); if (!ed.draft.charge_lines.length) ed.draft.charge_lines.push(L.blankChargeLine()); changed(ed); drawCharge(ed); }, ed.locked));
      append(body, row);
    });
    if (focusLast) { var d = body.querySelectorAll('.desc'); if (d.length) d[d.length - 1].focus(); }
  }

  function drawTotals(ed) {
    var t = L.totals(ed.draft.cost_lines, ed.draft.charge_lines);
    if (ed.dom.costTotal) ed.dom.costTotal.textContent = L.money(t.cost_total_ex_gst);
    if (ed.dom.chargeTotals) {
      clear(ed.dom.chargeTotals);
      append(ed.dom.chargeTotals,
        el('div', { class: 'tot-row' }, el('span', { text: 'Subtotal (ex GST)' }), el('strong', { text: L.money(t.charge_total_ex_gst) })),
        el('div', { class: 'tot-row' }, el('span', { text: 'GST' }), el('strong', { text: L.money(t.charge_gst) })),
        el('div', { class: 'tot-row grand' }, el('span', { text: 'Total (inc GST)' }), el('strong', { text: L.money(t.charge_total_inc_gst) })));
    }
    if (ed.dom.margin) {
      clear(ed.dom.margin);
      var low = t.margin_pct != null && t.margin_pct < 15;
      append(ed.dom.margin,
        el('div', null, el('span', { text: 'Allowed (cost)' }), el('strong', { text: L.money(t.cost_total_ex_gst) })),
        el('div', null, el('span', { text: 'Quoted (ex GST)' }), el('strong', { text: L.money(t.charge_total_ex_gst) })),
        el('div', { class: t.margin_ex_gst < 0 || low ? 'warn' : '' }, el('span', { text: 'Margin' }),
          el('strong', { text: L.money(t.margin_ex_gst) + (t.margin_pct != null ? '  (' + t.margin_pct.toFixed(1) + '%)' : '') })));
    }
  }

  async function fillFromCosts(ed) {
    var input = el('input', { type: 'text', inputmode: 'decimal', value: String(store.getJSON('qb:markup') || 30) });
    var pct = await modal({ title: 'Fill charge lines from costs', body: el('div', null,
      el('p', { text: 'Makes one client line per cost line at this markup. You can edit every line after.' }),
      el('div', { class: 'field' }, el('label', { text: 'Markup %' }), input)),
      buttons: [{ label: 'Cancel', value: null }, { label: 'Fill', primary: true, value: function () { return input.value; } }], dismissValue: null });
    if (pct == null) return;
    var lines = L.chargeFromCosts(ed.draft.cost_lines, pct);
    if (!lines.length) { toast('Add cost lines with a description first.', 'warn'); return; }
    store.setJSON('qb:markup', L.num(pct));
    var existing = ed.draft.charge_lines.filter(function (l) { return !L.isBlankLine(l) || hasNums(l); });
    ed.draft.charge_lines = existing.concat(lines);
    changed(ed);
    drawCharge(ed);
  }

  // ---------- Photos ----------
  function drawPhotos(ed) {
    var grid = ed.dom.photos;
    if (!grid) return;
    clear(grid);
    var b = state.bundles[ed.job.id] || {};
    var photos = b.photos || [];
    var sel = ed.draft.photo_media_ids || [];
    if (!photos.length && !state.pending.some(function (p) { return p.job_id === ed.job.id; })) {
      append(grid, el('p', { class: 'muted', text: 'No photos yet.' }));
    }
    photos.forEach(function (p) {
      var on = sel.indexOf(p.id) !== -1;
      var cb = el('input', { type: 'checkbox', checked: on, disabled: ed.locked, onchange: function () {
        var s = ed.draft.photo_media_ids = (ed.draft.photo_media_ids || []).filter(function (x) { return x !== p.id; });
        if (cb.checked) s.push(p.id);
        card.classList.toggle('on', cb.checked);
        changed(ed);
      } });
      var cap = el('input', { type: 'text', class: 'caption', placeholder: 'Caption', value: captionFor(p) });
      cap.addEventListener('change', function () { saveCaption(p, cap.value); });
      var card = el('div', { class: 'photo' + (on ? ' on' : '') },
        el('a', { href: p.url, target: '_blank', rel: 'noopener' }, el('img', { src: p.url, alt: p.caption || 'Site photo', loading: 'lazy' })),
        cap,
        el('label', { class: 'photo-pick' }, cb, el('span', { text: 'On quote' })));
      append(grid, card);
    });
    state.pending.filter(function (p) { return p.job_id === ed.job.id; }).forEach(function (p) {
      var cap = el('input', { type: 'text', class: 'caption', placeholder: 'Caption', value: p.caption || '' });
      cap.addEventListener('input', function () { p.caption = cap.value; store.pendingPhotos.put(p); });
      if (!p._url) p._url = URL.createObjectURL(p.blob);
      append(grid, el('div', { class: 'photo pending' },
        el('img', { src: p._url, alt: 'Photo waiting to upload' }),
        cap,
        el('span', { class: 'pill pill-warn', text: p.error ? 'Waiting for signal' : 'Uploading…' })));
    });
  }

  function captionFor(p) {
    var q = store.getJSON('qb:captions') || {};
    return q[p.id] != null ? q[p.id] : (p.caption || '');
  }

  async function saveCaption(p, caption) {
    var q = store.getJSON('qb:captions') || {};
    q[p.id] = caption;
    store.setJSON('qb:captions', q);
    try {
      await api.photoCaption(p.id, caption);
      p.caption = caption;
      var q2 = store.getJSON('qb:captions') || {};
      if (q2[p.id] === caption) { delete q2[p.id]; store.setJSON('qb:captions', q2); }
    } catch (e) {
      if (e.code !== 'network') toast('Caption not saved: ' + errorText(e), 'error');
    }
  }

  async function flushCaptions() {
    var q = store.getJSON('qb:captions') || {};
    for (var id in q) {
      if (!Object.prototype.hasOwnProperty.call(q, id)) continue;
      try {
        await api.photoCaption(id, q[id]);
        var q2 = store.getJSON('qb:captions') || {};
        if (q2[id] === q[id]) { delete q2[id]; store.setJSON('qb:captions', q2); }
      } catch (e) { if (e.code === 'network') return; }
    }
  }

  // Shrink camera photos to at most 2048 px JPEG before upload: quicker on a weak signal,
  // and well under the 10 MB bucket limit.
  function compress(file) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var max = 2048;
        var s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        var c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob(function (blob) { resolve(blob || file); }, 'image/jpeg', 0.82);
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    });
  }

  async function addPhotos(ed, files) {
    var list = Array.prototype.slice.call(files || []);
    for (var i = 0; i < list.length; i++) {
      var f = list[i];
      var blob = await compress(f);
      if (['image/jpeg', 'image/png', 'image/webp'].indexOf(blob.type) === -1) { toast('That file type cannot be uploaded. Use a JPEG or PNG photo.', 'error'); continue; }
      var rec = {
        id: L.uuid(), job_id: ed.job.id, blob: blob,
        file_name: (f.name || 'photo').replace(/\.[^.]+$/, '') + (blob.type === 'image/png' ? '.png' : blob.type === 'image/webp' ? '.webp' : '.jpg'),
        caption: '', taken_at: f.lastModified ? new Date(f.lastModified).toISOString() : null,
        attach_key: ed.locked ? null : ed.key, created_at: new Date().toISOString()
      };
      state.pending.push(rec);
      await store.pendingPhotos.put(rec);
    }
    drawPhotos(ed);
    processPhotoQueue();
  }

  var photoBusy = false;
  async function processPhotoQueue() {
    if (photoBusy || !state.session) return;
    photoBusy = true;
    try {
      var queue = state.pending.slice();
      for (var i = 0; i < queue.length; i++) {
        var p = queue[i];
        try {
          var photo = await api.uploadPhoto(p.job_id, p.blob, p.file_name, p.caption, p.taken_at);
          state.pending = state.pending.filter(function (x) { return x.id !== p.id; });
          await store.pendingPhotos.del(p.id);
          if (p._url) URL.revokeObjectURL(p._url);
          var b = state.bundles[p.job_id];
          if (b) {
            b.photos = (b.photos || []).filter(function (x) { return x.id !== photo.id; }).concat([photo]);
            store.setJSON(bundleKey(p.job_id), { bundle: b, at: new Date().toISOString() });
          }
          attachPhoto(p.attach_key, photo.id);
        } catch (e) {
          p.error = e.code || 'error';
          if (e.code !== 'network' && e.status !== 401 && e.status !== 0) {
            // A refusal that retrying will not fix: tell Hugo, keep the photo on the iPad.
            toast('Photo not uploaded: ' + errorText(e), 'error');
          }
          break;
        }
      }
    } finally {
      photoBusy = false;
      if (state.editor) drawPhotos(state.editor);
      refreshTopbarBadge();
    }
  }

  function attachPhoto(key, photoId) {
    if (!key) return;
    var ed = state.editor;
    if (ed && ed.key === key) {
      if (!ed.locked && ed.draft.photo_media_ids.indexOf(photoId) === -1) { ed.draft.photo_media_ids.push(photoId); changed(ed); }
      return;
    }
    var d = store.getJSON(key);
    if (d && d.draft && d.draft.photo_media_ids.indexOf(photoId) === -1) {
      d.draft.photo_media_ids.push(photoId); d.dirty = true; d.updated_at = new Date().toISOString();
      store.setJSON(key, d);
    }
  }

  function refreshTopbarBadge() {
    var old = $('.topbar');
    if (!old) return;
    var right = old.querySelector('.topbar-right');
    var fresh = topbar().querySelector('.topbar-right');
    if (right && fresh) right.replaceWith(fresh);
  }

  // ---------- Autosave ----------
  function changed(ed) {
    if (ed.locked) return;
    drawTotals(ed);
    writeLocal(ed, true);
    setStatus(ed, 'Saved on this iPad');
    scheduleSave(ed, 1800);
  }

  function writeLocal(ed, dirty) {
    var fp = L.draftFingerprint(ed.draft);
    store.setJSON(ed.key, {
      v: 1, job_id: ed.job.id, kind: ed.kind, chain_id: ed.chainId, base_version_id: ed.baseVersionId,
      draft: ed.draft, dirty: dirty && fp !== ed.syncedFp, updated_at: new Date().toISOString()
    });
  }

  function setStatus(ed, text, kind) {
    ed.status = text;
    if (ed.dom.saveState) { ed.dom.saveState.textContent = text; ed.dom.saveState.className = 'save-state ' + (kind || ''); }
  }

  function scheduleSave(ed, ms) {
    clearTimeout(ed.timer);
    ed.timer = setTimeout(function () { cloudSave(ed); }, ms);
  }

  // Saves the draft to Supabase. One request at a time; edits made while a save is in
  // flight are picked up by a follow-up save.
  async function cloudSave(ed) {
    if (ed.locked || ed.conflict) return true;
    if (ed.stale) return false;
    if (ed.saving) { ed.again = true; return ed.savingPromise; }
    var fp = L.draftFingerprint(ed.draft);
    if (fp === ed.syncedFp && ed.baseVersionId && ed.latest && ed.latest.status === 'draft') { writeLocal(ed, false); setStatus(ed, savedText(ed), 'ok'); return true; }
    ed.saving = true;
    setStatus(ed, 'Saving…');
    ed.savingPromise = (async function () {
      try {
        if (ed.kind === 'variation' && !ed.chainId && ed.firstSaveTried) await adoptOrphanChain(ed);
        ed.firstSaveTried = true;
        var payload = L.savePayload(ed.job, ed.kind, ed.chainId, ed.baseVersionId, ed.draft);
        var sentFp = L.draftFingerprint(ed.draft);
        var r = await api.save(payload);
        var v = r.version;
        ed.baseVersionId = v.id;
        ed.latest = v;
        ed.syncedFp = sentFp;
        if (ed.kind === 'variation' && !ed.chainId) adoptNewChain(ed, v.chain_id);
        ed.chainId = v.chain_id;
        mergeVersion(ed, v);
        writeLocal(ed, true);
        setStatus(ed, savedText(ed), 'ok');
        clearTimeout(ed.retryTimer);
        if (ed.dom.versionBar) drawVersionBar(state.bundles[ed.job.id], ed);
        return true;
      } catch (e) {
        if (e.code === 'stale_version' || e.code === 'version_frozen' || e.code === 'version_issued') {
          await handleStale(ed);
        } else if (e.code === 'network' || e.status === 0 || e.status >= 500) {
          setStatus(ed, 'No signal: saved on this iPad, will retry', 'warn');
          clearTimeout(ed.retryTimer);
          if (!ed.closed) ed.retryTimer = setTimeout(function () { cloudSave(ed); }, 15000);
        } else if (e.status === 401 || e.code === 'not_signed_in') {
          setStatus(ed, 'Signed out: saved on this iPad', 'warn');
        } else {
          setStatus(ed, 'Not saved: ' + errorText(e), 'error');
        }
        return false;
      } finally {
        ed.saving = false;
        if (ed.again && !ed.stale && !ed.closed) { ed.again = false; scheduleSave(ed, 200); }
      }
    })();
    return ed.savingPromise;
  }

  function savedText(ed) {
    var v = ed.latest;
    return 'Saved' + (v ? ' as version ' + v.version : '') + ' ' + new Date().toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
  }

  // A brand new variation has no chain until its first save. If that first save's reply was
  // lost, look for the chain it made before trying again, so a retry never makes a second one.
  async function adoptOrphanChain(ed) {
    try {
      var b = await loadBundle(ed.job.id, true);
      var me = state.session && state.session.user && state.session.user.id;
      var fresh = (b.variations || []).filter(function (c) {
        if (ed.knownChains.indexOf(c.chain_id) !== -1) return false;
        var lv = L.latestVersion(c);
        return lv && lv.status === 'draft' && (!me || !lv.created_by || lv.created_by === me);
      });
      if (fresh.length === 1) {
        var lv = L.latestVersion(fresh[0]);
        adoptNewChain(ed, fresh[0].chain_id);
        ed.chainId = fresh[0].chain_id;
        ed.baseVersionId = lv.id;
        ed.latest = lv;
      }
    } catch (e) { /* offline: the save below fails the same way and retries later */ }
  }

  // Move the local draft from its new-xxx key to the real chain id and fix the address bar.
  function adoptNewChain(ed, chainId) {
    var oldKey = ed.key;
    ed.localRef = chainId;
    ed.key = L.draftKey(ed.job.id, 'variation', chainId);
    store.remove(oldKey);
    ed.knownChains.push(chainId);
    state.pending.forEach(function (p) { if (p.attach_key === oldKey) { p.attach_key = ed.key; store.pendingPhotos.put(p); } });
    var h = '#/job/' + ed.job.id + '/var/' + chainId;
    if (location.hash !== h) { ignoreHash = h; history.replaceState(null, '', h); }
  }

  function mergeVersion(ed, v) {
    var b = state.bundles[ed.job.id];
    if (!b) return;
    var chain;
    if (ed.kind === 'scope') { b.scope = b.scope || { chain_id: v.chain_id, versions: [] }; b.scope.chain_id = v.chain_id; chain = b.scope; }
    else {
      b.variations = b.variations || [];
      chain = b.variations.filter(function (c) { return c.chain_id === v.chain_id; })[0];
      if (!chain) { chain = { chain_id: v.chain_id, variation_id: v.variation_id || null, variation_number: null, variation_status: null, versions: [] }; b.variations.push(chain); }
      ed.variation = chain;
    }
    var i = chain.versions.findIndex(function (x) { return x.id === v.id; });
    if (i === -1) chain.versions.push(v); else chain.versions[i] = v;
    store.setJSON(bundleKey(ed.job.id), { bundle: b, at: new Date().toISOString() });
  }

  async function handleStale(ed) {
    ed.stale = true;
    clearTimeout(ed.timer); clearTimeout(ed.retryTimer);
    setStatus(ed, 'Changed elsewhere', 'warn');
    var local = store.getJSON(ed.key);
    if (local) { local.dirty = true; local.base_version_id = 'stale:' + (ed.baseVersionId || ''); store.setJSON(ed.key, local); }
    // An editor Hugo already left: keep the edits flagged for next time, no pop-up.
    if (ed.closed) return;
    await modal({ title: 'This quote changed on another device', body: 'Someone saved or issued it after you opened it. Your edits are kept on this iPad. The page will reload so you can pick which version to keep.' });
    rerender();
  }

  // Leaving an editor: one last save, no retries after (the draft stays on the iPad and the
  // next open picks it up). Returns that save so the next screen can wait for it.
  function flushEditor() {
    var ed = state.editor;
    if (!ed) return Promise.resolve();
    state.editor = null;
    ed.closed = true;
    clearTimeout(ed.timer);
    clearTimeout(ed.retryTimer);
    if (ed.saving) return ed.savingPromise;
    if (!ed.locked && !ed.conflict && !ed.stale && L.draftFingerprint(ed.draft) !== ed.syncedFp) return cloudSave(ed);
    return Promise.resolve();
  }

  function flushEditorAndWait() {
    var p = flushEditor();
    return Promise.race([p, new Promise(function (r) { setTimeout(r, 8000); })]).catch(function () { /* draft kept locally */ });
  }

  // ---------- Actions: preview, issue ----------
  function drawActions(b, ed) {
    var box = ed.dom.actions;
    clear(box);
    append(box,
      el('button', { class: 'btn', text: 'Preview client PDF', onclick: function () { previewPdf(b, ed); } }),
      ed.locked ? null : el('button', { class: 'btn btn-primary btn-big', text: ed.kind === 'variation' ? 'Issue variation quote' : 'Issue client quote', onclick: function () { issue(b, ed); } }));
    append(box, el('p', { class: 'muted small', text: 'Issuing freezes this version, saves the PDF on the job' + (b.job.type === 'miscellaneous' ? '' : ' and moves the Repairs board card') + '. Nothing is emailed or texted to anyone.' }));
  }

  function selectedPhotos(b, ed) {
    var byId = {};
    (b.photos || []).forEach(function (p) { byId[p.id] = p; });
    return (ed.draft.photo_media_ids || []).map(function (id) { return byId[id]; }).filter(Boolean)
      .map(function (p) { return { url: p.url, caption: captionFor(p) }; });
  }

  function pdfOpts(b, ed, quoteNumber) {
    return {
      job: b.job, kind: ed.kind, version: ed.draft, quoteNumber: quoteNumber,
      variationNumber: ed.variation && ed.variation.variation_number,
      preparedBy: preparedBy(), photos: selectedPhotos(b, ed)
    };
  }

  function openBlob(blob, win, name) {
    var url = URL.createObjectURL(blob);
    if (win && !win.closed) { win.location.href = url; return; }
    var a = el('a', { href: url, download: name || 'quote.pdf', target: '_blank' });
    document.body.appendChild(a); a.click(); a.remove();
  }

  async function previewPdf(b, ed) {
    // Open the tab now, inside the tap, so Safari does not block it as a pop-up.
    var win = window.open('', '_blank');
    if (win) { try { win.document.title = 'Preparing quote…'; win.document.body.textContent = 'Preparing the quote PDF…'; } catch (e) { /* ignore */ } }
    try {
      var qn = ed.locked && ed.latest && ed.latest.quote_number ? ed.latest.quote_number : 'DRAFT';
      var blob = await window.QBPdf.render(pdfOpts(b, ed, qn));
      openBlob(blob, win, (b.job.job_number || 'quote') + '-' + qn + '.pdf');
    } catch (e) {
      if (win) win.close();
      toast('Could not make the PDF: ' + (e.message || e), 'error');
    }
  }

  async function issue(b, ed) {
    var charge = L.cleanChargeLines(ed.draft.charge_lines);
    var unnamed = L.unnamedLines(ed.draft.cost_lines) + L.unnamedLines(ed.draft.charge_lines);
    if (!charge.length) { await modal({ title: 'No client lines yet', body: 'Add at least one line under What we charge the client before issuing.' }); return; }
    if (unnamed) { await modal({ title: 'Some lines have no description', body: unnamed + ' line' + (unnamed > 1 ? 's have' : ' has') + ' a price but no description, so ' + (unnamed > 1 ? 'they are' : 'it is') + ' not saved. Add a description or delete ' + (unnamed > 1 ? 'them' : 'it') + ' first.' }); return; }
    var t = L.totals(ed.draft.cost_lines, ed.draft.charge_lines);
    var ok = await modal({ title: ed.kind === 'variation' ? 'Issue this variation?' : 'Issue this quote?', body: el('div', null,
      el('p', { text: 'Total to the client: ' + L.money(t.charge_total_inc_gst) + ' inc GST. Our cost: ' + L.money(t.cost_total_ex_gst) + '.' }),
      el('p', { text: 'This freezes the version and saves the PDF on ' + (b.job.job_number || 'the job') + '. Nothing is sent to anyone. Later changes become a new version.' })),
      buttons: [{ label: 'Cancel', value: false }, { label: 'Issue', value: true, primary: true }], dismissValue: false });
    if (!ok) return;

    var busy = el('div', { class: 'modal-back' }, el('div', { class: 'modal' }, el('h2', { text: 'Issuing…' }), el('p', { class: 'busy-step', text: 'Saving the latest edits' })));
    document.body.appendChild(busy);
    function step(s) { var p = busy.querySelector('.busy-step'); if (p) p.textContent = s; }
    try {
      clearTimeout(ed.timer);
      if (ed.saving) await ed.savingPromise;
      var saved = await cloudSave(ed);
      if (!saved || L.draftFingerprint(ed.draft) !== ed.syncedFp || !ed.baseVersionId) throw new api.ApiError(0, 'not_saved', 'The latest edits could not be saved, so the quote was not issued. Check your signal and try again.');
      var versionId = ed.baseVersionId;
      var result = null;
      for (var attempt = 0; attempt < 2 && !result; attempt++) {
        step('Getting the quote number');
        var slot = await api.pdfSlot(versionId);
        step('Making the PDF (' + slot.quote_number + ')');
        var blob = await window.QBPdf.render(pdfOpts(b, ed, slot.quote_number));
        step('Uploading the PDF');
        await api.putPdf(slot.signed_url, blob);
        step('Filing it on the job');
        try { result = await api.issue(versionId, slot.path); }
        catch (e) { if (attempt === 0 && (e.code === 'quote_number_changed' || e.code === 'pdf_not_prepared' || e.code === 'upload_missing')) continue; throw e; }
      }
      busy.remove();
      store.remove(ed.key);
      var stageMsg = stageText(result.stage);
      await modal({ title: 'Issued ' + (result.document && result.document.quote_number || ''), body: el('div', null,
        el('p', { text: 'The PDF is saved on the job as its own document.' }),
        stageMsg ? el('p', { text: stageMsg }) : null,
        result.document && result.document.url ? el('p', null, el('a', { class: 'btn', href: result.document.url, target: '_blank', rel: 'noopener', text: 'Open the PDF' })) : null) });
      ed.closed = true;
      state.editor = null;
      rerender();
    } catch (e) {
      busy.remove();
      await modal({ title: 'Not issued', body: errorText(e) + (e.code === 'variation_decided' ? ' Start a new variation instead.' : '') });
      if (e.code === 'stale_version') rerender();
    }
  }

  function stageText(s) {
    if (!s) return '';
    if (s.moved) return 'Repairs board: moved from ' + L.stageLabel(s.from) + ' to ' + L.stageLabel(s.to) + '.';
    if (s.reason === 'already_past_stage') return 'Repairs board: card left where it is (already further along).';
    if (s.reason === 'stage_write_failed') return 'Repairs board: the card could not be moved just now. The quote is issued; move the card on the board.';
    return '';
  }

  // ---------- Variations list ----------
  function renderVariations(main, b) {
    flushEditor();
    var list = el('section', { class: 'card' },
      el('div', { class: 'card-head' }, el('h2', { text: 'Variations' }),
        el('a', { class: 'btn btn-primary', href: '#/job/' + b.job.id + '/var/new-' + L.uuid().slice(0, 8), text: '+ New variation' })));
    var vars = b.variations || [];
    // Unsaved new variations kept on this iPad
    store.keys('qb:draft:' + b.job.id + ':variation:new-').forEach(function (k) {
      var d = store.getJSON(k);
      if (!d || !d.dirty) return;
      var ref = k.split(':variation:')[1];
      append(list, el('a', { class: 'var-row', href: '#/job/' + b.job.id + '/var/' + ref },
        el('strong', { text: d.draft.title || 'New variation' }), el('span', { class: 'pill pill-warn', text: 'Not uploaded yet' })));
    });
    if (!vars.length && list.childNodes.length === 1) append(list, el('p', { class: 'muted', text: 'No variations on this job yet.' }));
    vars.forEach(function (c) {
      var lv = L.latestVersion(c);
      var actions = el('div', { class: 'row-actions' });
      if (c.variation_id && c.variation_status === 'pending_approval') {
        append(actions,
          el('button', { class: 'btn', text: 'Record approved', onclick: function (e) { e.preventDefault(); decide(b, c, true); } }),
          el('button', { class: 'btn btn-ghost', text: 'Record rejected', onclick: function (e) { e.preventDefault(); decide(b, c, false); } }));
      }
      append(list, el('div', { class: 'var-row' },
        el('a', { class: 'var-main', href: '#/job/' + b.job.id + '/var/' + c.chain_id },
          el('strong', { text: (c.variation_number ? 'Variation ' + c.variation_number : 'Variation (not issued)') + (lv && lv.title ? ': ' + lv.title : '') }),
          el('span', { class: 'muted', text: lv ? 'v' + lv.version + ' ' + lv.status + ' · ' + L.money(lv.charge_total_inc_gst) + ' inc GST · cost ' + L.money(lv.cost_total_ex_gst) : '' }),
          el('span', { class: 'pill var-' + (c.variation_status || 'draft'), text: varStatusLabel(c.variation_status) })),
        actions));
    });
    append(main, list);
  }

  async function decide(b, chain, approved) {
    var notes = el('textarea', { rows: 3, placeholder: 'e.g. Builder approved by email 9 Oct' });
    var ok = await modal({ title: approved ? 'Record variation ' + chain.variation_number + ' as approved?' : 'Record variation ' + chain.variation_number + ' as rejected?',
      body: el('div', null, el('p', { text: approved ? 'Use this once the builder or client has approved it.' + (b.job.type === 'miscellaneous' ? '' : ' The Repairs board card moves to Approved.') : 'The variation is closed. Start a new one for changed work.' }),
        el('div', { class: 'field' }, el('label', { text: 'Notes' }), notes)),
      buttons: [{ label: 'Cancel', value: false }, { label: approved ? 'Approved' : 'Rejected', value: true, primary: approved, danger: !approved }], dismissValue: false });
    if (!ok) return;
    try {
      var r = await api.decideVariation(chain.variation_id, approved, notes.value);
      toast((approved ? 'Recorded as approved. ' : 'Recorded as rejected. ') + stageText(r.stage));
      rerender();
    } catch (e) { modal({ title: 'Not recorded', body: errorText(e) }); }
  }

  // ---------- History ----------
  function versionRows(b, chain, label) {
    var docs = b.documents || [];
    return chain.versions.slice().reverse().map(function (v) {
      var d = docs.filter(function (x) { return x.version_id === v.id; })[0];
      return el('tr', null,
        el('td', null, el('a', { href: '#/job/' + b.job.id + '/v/' + v.id, text: label + ' v' + v.version })),
        el('td', null, el('span', { class: 'pill ' + (v.status === 'issued' ? 'pill-client' : 'pill-warn'), text: v.status })),
        el('td', { text: L.fmtDate(v.issued_at || v.updated_at) }),
        el('td', { class: 'r', text: L.money(v.cost_total_ex_gst) }),
        el('td', { class: 'r', text: L.money(v.charge_total_ex_gst) }),
        el('td', { class: 'r' + (v.margin_ex_gst < 0 ? ' neg' : ''), text: L.money(v.margin_ex_gst) + (v.margin_pct != null ? ' (' + Number(v.margin_pct).toFixed(1) + '%)' : '') }),
        el('td', null, d && d.url ? el('a', { href: d.url, target: '_blank', rel: 'noopener', text: d.quote_number || 'PDF' }) : (v.quote_number || '')));
    });
  }

  function renderHistory(main, b) {
    flushEditor();
    var head = el('tr', null, ['Version', 'Status', 'Date', 'Allowed (cost)', 'Quoted (ex GST)', 'Margin', 'PDF'].map(function (h, i) { return el('th', { class: i >= 3 && i <= 5 ? 'r' : '', text: h }); }));
    var rows = [];
    if (b.scope && b.scope.versions && b.scope.versions.length) rows = rows.concat(versionRows(b, b.scope, 'Scope'));
    (b.variations || []).forEach(function (c) { rows = rows.concat(versionRows(b, c, c.variation_number ? 'Variation ' + c.variation_number : 'Variation')); });
    append(main, el('section', { class: 'card' },
      el('div', { class: 'card-head' }, el('h2', { text: 'Version history' }), el('span', { class: 'muted small', text: 'Tap a version to see what was allowed against what was quoted' })),
      rows.length ? el('div', { class: 'table-scroll' }, el('table', { class: 'hist' }, el('thead', null, head), el('tbody', null, rows))) :
        el('p', { class: 'muted', text: 'Nothing saved for this job yet.' })));
  }

  function renderVersion(main, b, versionId) {
    flushEditor();
    var v = null, label = '';
    if (b.scope) b.scope.versions.forEach(function (x) { if (x.id === versionId) { v = x; label = 'Scope'; } });
    (b.variations || []).forEach(function (c) { c.versions.forEach(function (x) { if (x.id === versionId) { v = x; label = c.variation_number ? 'Variation ' + c.variation_number : 'Variation'; } }); });
    if (!v) { append(main, el('p', { class: 'banner banner-error', text: 'Version not found.' })); return; }
    var costRows = (v.cost_lines || []).map(function (l) {
      return el('tr', null, el('td', { text: l.description }), el('td', { class: 'r', text: L.qtyText(l.qty) + ' ' + (l.unit || '') }),
        el('td', { class: 'r', text: L.money(l.unit_cost_ex_gst) }), el('td', { text: l.supplier_or_trade || '' }),
        el('td', { class: 'r', text: L.money(l.line_total_ex_gst != null ? l.line_total_ex_gst : L.costLineTotal(l)) }));
    });
    var chargeRows = (v.charge_lines || []).map(function (l) {
      return el('tr', null, el('td', { text: l.description }), el('td', { class: 'r', text: L.qtyText(l.qty) + ' ' + (l.unit || '') }),
        el('td', { class: 'r', text: L.money(l.unit_price_ex_gst) }), el('td', { text: l.gst_applies === false ? 'GST free' : '' }),
        el('td', { class: 'r', text: L.money(l.line_total_ex_gst != null ? l.line_total_ex_gst : L.chargeLineTotal(l)) }));
    });
    var photos = (b.photos || []).filter(function (p) { return (v.photo_media_ids || []).indexOf(p.id) !== -1; });
    append(main,
      el('div', { class: 'version-bar' }, el('div', { class: 'version-label' }, el('strong', { text: label + ' version ' + v.version }),
        ' · ' + v.status + (v.issued_at ? ' ' + L.fmtDate(v.issued_at) : '') + (v.quote_number ? ' · ' + v.quote_number : '')),
        el('a', { class: 'btn btn-ghost', href: '#/job/' + b.job.id + '/history', text: 'Back to history' })),
      v.title ? el('h2', { class: 'v-title', text: v.title }) : null,
      v.narrative ? el('p', { class: 'v-narrative', text: v.narrative }) : null,
      el('div', { class: 'margin-strip' },
        el('div', null, el('span', { text: 'Allowed (cost)' }), el('strong', { text: L.money(v.cost_total_ex_gst) })),
        el('div', null, el('span', { text: 'Quoted (ex GST)' }), el('strong', { text: L.money(v.charge_total_ex_gst) })),
        el('div', null, el('span', { text: 'Quoted (inc GST)' }), el('strong', { text: L.money(v.charge_total_inc_gst) })),
        el('div', { class: v.margin_ex_gst < 0 ? 'warn' : '' }, el('span', { text: 'Margin' }), el('strong', { text: L.money(v.margin_ex_gst) + (v.margin_pct != null ? ' (' + Number(v.margin_pct).toFixed(1) + '%)' : '') }))),
      el('div', { class: 'compare' },
        el('section', { class: 'card internal' }, el('h2', { text: 'Allowed: what it costs us' }),
          el('div', { class: 'table-scroll' }, el('table', { class: 'hist' }, el('thead', null, el('tr', null, el('th', { text: 'Description' }), el('th', { class: 'r', text: 'Qty' }), el('th', { class: 'r', text: 'Unit cost' }), el('th', { text: 'Supplier' }), el('th', { class: 'r', text: 'Total' }))), el('tbody', null, costRows)))),
        el('section', { class: 'card client' }, el('h2', { text: 'Quoted: what we charge' }),
          el('div', { class: 'table-scroll' }, el('table', { class: 'hist' }, el('thead', null, el('tr', null, el('th', { text: 'Description' }), el('th', { class: 'r', text: 'Qty' }), el('th', { class: 'r', text: 'Unit price' }), el('th', { text: '' }), el('th', { class: 'r', text: 'Total' }))), el('tbody', null, chargeRows))))),
      photos.length ? el('section', { class: 'card' }, el('h2', { text: 'Photos on this version' }),
        el('div', { class: 'photo-grid' }, photos.map(function (p) { return el('div', { class: 'photo on' }, el('img', { src: p.url, alt: p.caption || 'Site photo', loading: 'lazy' }), el('p', { class: 'small', text: captionFor(p) })); }))) : null);
  }

  // ---------- Router ----------
  var ignoreHash = null;
  async function route() {
    if (!state.session) { renderSignIn(); return; }
    await flushEditorAndWait();
    var h = location.hash || '#/';
    var m;
    if (h === '#/new') { flushEditor(); renderNewPrivate(); }
    else if ((m = h.match(/^#\/job\/([^/]+)\/var\/([^/]+)$/))) withBundle(m[1], 'variations', function (main, b) { openEditor(main, b, 'variation', decodeURIComponent(m[2])); });
    else if ((m = h.match(/^#\/job\/([^/]+)\/variations$/))) withBundle(m[1], 'variations', renderVariations);
    else if ((m = h.match(/^#\/job\/([^/]+)\/history$/))) withBundle(m[1], 'history', renderHistory);
    else if ((m = h.match(/^#\/job\/([^/]+)\/v\/([^/]+)$/))) withBundle(m[1], 'history', function (main, b) { renderVersion(main, b, m[2]); });
    else if ((m = h.match(/^#\/job\/([^/]+)$/))) withBundle(m[1], 'scope', function (main, b) { openEditor(main, b, 'scope'); });
    else { flushEditor(); renderList(); }
  }

  window.addEventListener('hashchange', function () {
    if (ignoreHash && location.hash === ignoreHash) { ignoreHash = null; return; }
    route();
  });
  window.addEventListener('online', function () {
    state.online = true; refreshTopbarBadge();
    if (state.editor) cloudSave(state.editor);
    processPhotoQueue(); flushCaptions();
  });
  window.addEventListener('offline', function () { state.online = false; refreshTopbarBadge(); });
  document.addEventListener('visibilitychange', function () {
    var ed = state.editor;
    if (document.visibilityState === 'hidden' && ed) { writeLocal(ed, true); if (!ed.locked && !ed.conflict) cloudSave(ed); }
    if (document.visibilityState === 'visible') { processPhotoQueue(); flushCaptions(); }
  });
  window.addEventListener('pagehide', function () { var ed = state.editor; if (ed && !ed.locked) writeLocal(ed, true); });

  api.onAuthLost(function () {
    if (!state.session) return;
    state.session = null;
    renderSignIn('Your sign-in has expired. Sign in again; your drafts are kept on this iPad.');
  });

  async function start() {
    append(document.body, el('datalist', { id: 'qb-units' }, L.UNITS.map(function (u) { return el('option', { value: u }); })));
    append(document.body, el('datalist', { id: 'qb-suppliers' }));
    try { state.session = await api.session(); } catch (e) { state.session = null; }
    state.pending = (await store.pendingPhotos.all()) || [];
    route();
    if (state.session) { processPhotoQueue(); flushCaptions(); }
    api.onAuthChange(function (event, session) {
      if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') state.session = session;
      if (event === 'SIGNED_IN') { processPhotoQueue(); flushCaptions(); if (state.editor) cloudSave(state.editor); }
    });
    setInterval(function () { if (state.pending.length) processPhotoQueue(); }, 30000);
  }

  window.QBApp = { state: state };
  start();
})();
