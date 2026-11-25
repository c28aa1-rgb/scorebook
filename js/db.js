/*
 * Storage: IndexedDB with a localStorage fallback.
 * Two stores: 'meta' (one record, key 'state': team, seasons, players, opponents, settings)
 * and 'games' (one record per game, events embedded). A whole season is only a few
 * hundred KB, so everything is loaded into memory at startup and written back per change.
 * Callback style (no Promises) to stay safe on the Fire's old WebView.
 */
(function (root) {
  'use strict';

  var DB_NAME = 'scorebook';
  var DB_VERSION = 1;
  var LS_PREFIX = 'scorebook:';
  var idb = null;
  var useLS = false;

  function open(cb) {
    var factory = root.indexedDB || root.webkitIndexedDB;
    if (!factory) { useLS = true; return cb(null); }
    var req;
    try { req = factory.open(DB_NAME, DB_VERSION); }
    catch (e) { useLS = true; return cb(null); }
    req.onupgradeneeded = function () {
      var d = req.result;
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
      if (!d.objectStoreNames.contains('games')) d.createObjectStore('games', { keyPath: 'id' });
    };
    req.onsuccess = function () { idb = req.result; cb(null); };
    req.onerror = function () { useLS = true; cb(null); };
    req.onblocked = function () { useLS = true; cb(null); };
  }

  function lsGet(key) {
    try { var s = localStorage.getItem(LS_PREFIX + key); return s ? JSON.parse(s) : null; }
    catch (e) { return null; }
  }

  function lsSet(key, val, cb) {
    try { localStorage.setItem(LS_PREFIX + key, JSON.stringify(val)); cb && cb(null); }
    catch (e) { cb && cb(e); }
  }

  function loadMeta(cb) {
    if (useLS) return cb(null, lsGet('meta'));
    var r = idb.transaction('meta', 'readonly').objectStore('meta').get('state');
    r.onsuccess = function () { cb(null, r.result || null); };
    r.onerror = function () { cb(r.error); };
  }

  function saveMeta(meta, cb) {
    if (useLS) return lsSet('meta', meta, cb);
    var tx = idb.transaction('meta', 'readwrite');
    tx.objectStore('meta').put(meta, 'state');
    tx.oncomplete = function () { cb && cb(null); };
    tx.onerror = function () { cb && cb(tx.error); };
  }

  function loadGames(cb) {
    if (useLS) {
      var ids = lsGet('gameIds') || [], out = [];
      for (var i = 0; i < ids.length; i++) { var g = lsGet('game:' + ids[i]); if (g) out.push(g); }
      return cb(null, out);
    }
    var games = [];
    var req = idb.transaction('games', 'readonly').objectStore('games').openCursor();
    req.onsuccess = function () {
      var cur = req.result;
      if (cur) { games.push(cur.value); cur['continue'](); }
      else cb(null, games);
    };
    req.onerror = function () { cb(req.error); };
  }

  function saveGame(game, cb) {
    if (useLS) {
      var ids = lsGet('gameIds') || [];
      if (ids.indexOf(game.id) < 0) { ids.push(game.id); lsSet('gameIds', ids); }
      return lsSet('game:' + game.id, game, cb);
    }
    var tx = idb.transaction('games', 'readwrite');
    tx.objectStore('games').put(game);
    tx.oncomplete = function () { cb && cb(null); };
    tx.onerror = function () { cb && cb(tx.error); };
  }

  function deleteGame(id, cb) {
    if (useLS) {
      var ids = (lsGet('gameIds') || []).filter(function (x) { return x !== id; });
      lsSet('gameIds', ids);
      try { localStorage.removeItem(LS_PREFIX + 'game:' + id); } catch (e) {}
      return cb && cb(null);
    }
    var tx = idb.transaction('games', 'readwrite');
    tx.objectStore('games')['delete'](id);
    tx.oncomplete = function () { cb && cb(null); };
    tx.onerror = function () { cb && cb(tx.error); };
  }

  // Replace everything (used by backup restore).
  function replaceAll(meta, games, cb) {
    if (useLS) {
      (lsGet('gameIds') || []).forEach(function (id) {
        try { localStorage.removeItem(LS_PREFIX + 'game:' + id); } catch (e) {}
      });
      lsSet('gameIds', []);
      lsSet('meta', meta);
      var left = games.length;
      if (!left) return cb(null);
      games.forEach(function (g) { saveGame(g, function () { if (--left === 0) cb(null); }); });
      return;
    }
    var tx = idb.transaction(['meta', 'games'], 'readwrite');
    var gs = tx.objectStore('games');
    gs.clear();
    games.forEach(function (g) { gs.put(g); });
    tx.objectStore('meta').put(meta, 'state');
    tx.oncomplete = function () { cb(null); };
    tx.onerror = function () { cb(tx.error); };
  }

  root.SBDB = {
    open: open,
    loadMeta: loadMeta,
    saveMeta: saveMeta,
    loadGames: loadGames,
    saveGame: saveGame,
    deleteGame: deleteGame,
    replaceAll: replaceAll,
    usingFallback: function () { return useLS; }
  };
})(this);
