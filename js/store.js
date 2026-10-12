// On-device storage: the draft backup and a few settings, in localStorage. Every access is
// wrapped, because a private window or full storage can make it throw, and the app must still run.
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

  window.QBStore = { getJSON: getJSON, setJSON: setJSON, remove: remove, keys: keys };
})();
