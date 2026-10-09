// On-device storage. Drafts go to localStorage on every keystroke; photos waiting for signal
// go to IndexedDB (they are too big for localStorage). Every access is wrapped, because a
// private window or full storage can make either throw, and the app must still run.
(function () {
  'use strict';

  function getJSON(key) {
    try { var raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }
  function setJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
  }
  function remove(key) { try { localStorage.removeItem(key); } catch (e) { /* ignore */ } }
  function keys(prefix) {
    var out = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(prefix) === 0) out.push(k);
      }
    } catch (e) { /* ignore */ }
    return out;
  }

  var DB_NAME = 'qb-photos', STORE = 'pending';
  var dbPromise = null;
  function db() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      try {
        var req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = function () { req.result.createObjectStore(STORE, { keyPath: 'id' }); };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      } catch (e) { reject(e); }
    });
    return dbPromise;
  }
  function tx(mode, fn) {
    return db().then(function (d) {
      return new Promise(function (resolve, reject) {
        var t = d.transaction(STORE, mode);
        var store = t.objectStore(STORE);
        var result;
        Promise.resolve(fn(store)).then(function (r) { result = r; });
        t.oncomplete = function () { resolve(result); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error); };
      });
    });
  }
  function reqP(r) { return new Promise(function (res, rej) { r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; }); }

  window.QBStore = {
    getJSON: getJSON, setJSON: setJSON, remove: remove, keys: keys,
    pendingPhotos: {
      put: function (rec) { return tx('readwrite', function (s) { s.put(rec); }).catch(function () { return null; }); },
      del: function (id) { return tx('readwrite', function (s) { s.delete(id); }).catch(function () { return null; }); },
      all: function () { return tx('readonly', function (s) { return reqP(s.getAll()); }).catch(function () { return []; }); }
    }
  };
})();
