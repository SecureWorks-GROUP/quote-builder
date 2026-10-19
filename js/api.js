// Sign-in and the ops-api quote_builder_* actions (backend contract:
// secureworks-backend docs/quote-builder-contract.md). The browser only ever holds the
// staff member's own session; the server checks the role and does the writes.
(function () {
  'use strict';
  var cfg = window.QB_CONFIG;
  var AUTH_KEY = 'qb-auth';
  var sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: AUTH_KEY }
  });

  function ApiError(status, code, message) {
    this.name = 'ApiError';
    this.status = status;
    this.code = code || 'error';
    this.message = message || code || 'Request failed';
  }
  ApiError.prototype = Object.create(Error.prototype);

  var authListeners = [];
  function onAuthLost(fn) { authListeners.push(fn); }

  // An expired token is renewed inside getSession. When that renewal cannot reach the server
  // the stored sign-in is still good, so it is a lost connection, not a sign-out.
  async function accessToken() {
    var r = await sb.auth.getSession();
    var s = r && r.data && r.data.session;
    if (!s && r && r.error && r.error.name === 'AuthRetryableFetchError') throw new ApiError(0, 'network', 'No connection');
    return s ? s.access_token : null;
  }

  async function call(action, opts) {
    opts = opts || {};
    var token = await accessToken();
    if (!token) {
      authListeners.forEach(function (f) { f(); });
      throw new ApiError(401, 'not_signed_in', 'Please sign in again');
    }
    var url = cfg.supabaseUrl + '/functions/v1/ops-api?action=' + encodeURIComponent(action);
    if (opts.query) {
      Object.keys(opts.query).forEach(function (k) {
        var v = opts.query[k];
        if (v != null && v !== '') url += '&' + encodeURIComponent(k) + '=' + encodeURIComponent(v);
      });
    }
    var init = {
      method: opts.body ? 'POST' : 'GET',
      headers: { Authorization: 'Bearer ' + token }
    };
    if (opts.body) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    var res;
    try {
      res = await fetch(url, init);
    } catch (e) {
      throw new ApiError(0, 'network', 'No connection');
    }
    var data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (!res.ok) {
      var code = (data && data.code) || ('http_' + res.status);
      if (res.status === 401) authListeners.forEach(function (f) { f(); });
      throw new ApiError(res.status, code, (data && data.error) || ('Request failed (' + res.status + ')'));
    }
    return data;
  }

  async function putFile(signedUrl, blob, contentType) {
    var res;
    try {
      res = await fetch(signedUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body: blob });
    } catch (e) {
      throw new ApiError(0, 'network', 'No connection');
    }
    if (!res.ok) {
      var text = '';
      try { text = await res.text(); } catch (e) { /* ignore */ }
      throw new ApiError(res.status, 'upload_failed', 'Upload failed (' + res.status + ') ' + text.slice(0, 120));
    }
  }

  window.QBApi = {
    ApiError: ApiError,
    onAuthLost: onAuthLost,

    async session() { var r = await sb.auth.getSession(); return (r && r.data && r.data.session) || null; },
    async signIn(email, password) {
      var r = await sb.auth.signInWithPassword({ email: email, password: password });
      if (r.error) throw r.error;
      return r.data.session;
    },
    // Ends this device's login only, so the fence and patio tools stay signed in elsewhere.
    // supabase-js tells the server first and, when that call fails (no signal), leaves the
    // login stored on the device. Signing out here always removes it from this device.
    async signOut() {
      try { await sb.auth.signOut({ scope: 'local' }); } catch (e) { /* removed below */ }
      try { localStorage.removeItem(AUTH_KEY); } catch (e) { /* storage unavailable: nothing stored */ }
    },
    onAuthChange(fn) { sb.auth.onAuthStateChange(function (event, session) { fn(event, session); }); },

    listJobs(lane, stages) {
      var q = { lane: lane, limit: 200 };
      if (lane === 'repair' && stages) q.stages = stages.join(',');
      return call('quote_builder_list_jobs', { query: q });
    },
    getJob(jobId) { return call('quote_builder_get_job', { query: { job_id: jobId } }); },
    createPrivateJob(body) { return call('quote_builder_create_private_job', { body: body }); },
    save(body) { return call('quote_builder_save', { body: body }); },
    photoCaption(photoId, caption) { return call('quote_builder_photo_caption', { body: { photo_id: photoId, caption: caption } }); },
    decideVariation(variationId, approved, notes) {
      return call('quote_builder_decide_variation', { body: { variation_id: variationId, approved: approved, notes: notes || '' } });
    },

    // Upload slot, then bytes, then register. Each attempt asks for a fresh slot, so a
    // retry after a dropped connection never collides with a half-finished upload.
    async uploadPhoto(jobId, blob, fileName, caption, takenAt) {
      var type = blob.type || 'image/jpeg';
      var s = await call('quote_builder_photo_upload_url', { body: { job_id: jobId, file_name: fileName, content_type: type } });
      await putFile(s.signed_url, blob, type);
      var body = { job_id: jobId, path: s.path, caption: caption || '' };
      if (takenAt) body.taken_at = takenAt;
      var r = await call('quote_builder_photo_register', { body: body });
      return r.photo;
    },

    // document: 'quote' (the default) or 'scope_of_works' (repair jobs only).
    pdfSlot(versionId, document) {
      var body = { version_id: versionId };
      if (document && document !== 'quote') body.document = document;
      return call('quote_builder_pdf_upload_url', { body: body });
    },
    putPdf(signedUrl, blob) { return putFile(signedUrl, blob, 'application/pdf'); },
    // extraDocuments: [{ document: 'scope_of_works', pdf_path }], filed on the job beside the quote.
    issue(versionId, pdfPath, extraDocuments) {
      var body = { version_id: versionId, pdf_path: pdfPath };
      if (extraDocuments && extraDocuments.length) body.extra_documents = extraDocuments;
      return call('quote_builder_issue', { body: body });
    }
  };
})();
