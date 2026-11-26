/*
 * Cloud sync with Firebase: Google sign-in and a Firestore copy of the scorebook.
 * The tablet's own database (db.js) stays the working copy, so scoring never waits on the
 * network; every save is also sent here. Firestore keeps unsent writes on the tablet and
 * delivers them when it's back online.
 *
 * Layout: books/{book}            { meta, updated }   roster, seasons, schedule, settings
 *         books/{book}/games/{id} { game, updated }   one game with its plays
 *
 * Does nothing until js/firebase-config.js has a config; the SDK is only loaded then.
 */
(function (root) {
  'use strict';
  var CFG = root.SB_FIREBASE || {};
  var SDK = ['vendor/firebase/firebase-app-compat.js', 'vendor/firebase/firebase-auth-compat.js', 'vendor/firebase/firebase-firestore-compat.js'];
  var fb = null, auth = null, db = null, book = null;
  var pending = 0, statusFns = [], timers = {}, unsub = [];

  function configured() { return !!(CFG.config && CFG.config.projectId); }

  function allowed(user) {
    var email = user && user.email && user.email.toLowerCase();
    return !!email && (CFG.allowed || []).some(function (a) { return a.toLowerCase() === email; });
  }

  // Loads the three SDK files in order, then sets up auth and Firestore.
  function load(cb) {
    var i = 0;
    (function next() {
      if (i === SDK.length) return start(cb);
      var s = document.createElement('script');
      s.src = SDK[i++];
      s.onload = next;
      s.onerror = function () { cb(new Error('Couldn’t load the sign-in code.')); };
      document.head.appendChild(s);
    })();
  }

  function start(cb) {
    fb = root.firebase;
    fb.initializeApp(CFG.config);
    auth = fb.auth();
    db = fb.firestore();
    db.settings({ ignoreUndefinedProperties: true, merge: true });
    // Keep a copy on the tablet and queue writes made offline.
    db.enablePersistence({ synchronizeTabs: true })['catch'](function () {})
      .then(function () {
        book = db.collection('books').doc(CFG.book || 'dalton');
        // A redirect sign-in (used when a popup isn't possible) finishes here.
        auth.getRedirectResult()['catch'](function (e) { cb(e); });
        cb(null);
      });
  }

  function onAuth(fn) { auth.onAuthStateChanged(fn); }

  // Popup first; a full-page redirect where popups don't work (some home-screen apps).
  function signIn() {
    var p = new fb.auth.GoogleAuthProvider();
    p.setCustomParameters({ prompt: 'select_account', hd: 'dalton.org', login_hint: (CFG.allowed || [])[0] || '' });
    return auth.signInWithPopup(p)['catch'](function (e) {
      if (e && /popup-blocked|operation-not-supported|web-storage-unsupported/.test(e.code || '')) return auth.signInWithRedirect(p);
      throw e;
    });
  }

  function signOut() { stopListening(); return auth.signOut(); }
  function currentUser() { return auth && auth.currentUser; }

  // ---------- sync status: 'offline' | 'syncing' | 'synced' ----------
  function status() { return !navigator.onLine ? 'offline' : pending ? 'syncing' : 'synced'; }
  function onStatus(fn) { statusFns.push(fn); }
  function tellStatus() { var s = status(); statusFns.forEach(function (fn) { fn(s); }); }
  root.addEventListener('online', tellStatus);
  root.addEventListener('offline', tellStatus);

  function track(p) {
    pending++; tellStatus();
    p.then(done, done);
    function done() { pending--; tellStatus(); }
    return p;
  }

  // Plain JSON copy: drops undefined values and anything Firestore can't store.
  function clean(o) { return JSON.parse(JSON.stringify(o)); }

  // Saves are debounced per document, so a burst of taps is one write.
  function later(key, fn) {
    clearTimeout(timers[key]);
    timers[key] = setTimeout(function () { delete timers[key]; fn(); }, 800);
  }

  function pushMeta(meta) {
    if (!book) return;
    later('meta', function () { track(book.set({ meta: clean(meta), updated: meta.updated || Date.now() })); });
  }
  function pushGame(g) {
    if (!book) return;
    later('g' + g.id, function () { track(book.collection('games').doc(g.id).set({ game: clean(g), updated: g.updated || Date.now() })); });
  }
  function removeGame(id) {
    if (!book) return;
    clearTimeout(timers['g' + id]);
    track(book.collection('games').doc(id)['delete']());
  }

  // Everything in the cloud: cb(err, { meta, games }).
  function pull(cb) {
    Promise.all([book.get(), book.collection('games').get()]).then(function (r) {
      var meta = r[0].exists ? r[0].data().meta : null;
      cb(null, { meta: meta, games: r[1].docs.map(function (d) { return d.data().game; }) });
    }, function (e) { cb(e); });
  }

  // Changes made on another tablet. Skips echoes of this tablet's own writes.
  function listen(onMeta, onGame, onGameGone) {
    stopListening();
    unsub.push(book.onSnapshot(function (s) {
      if (s.exists && !s.metadata.hasPendingWrites) onMeta(s.data().meta);
    }, function () {}));
    unsub.push(book.collection('games').onSnapshot(function (q) {
      q.docChanges().forEach(function (ch) {
        if (ch.doc.metadata.hasPendingWrites) return;
        if (ch.type === 'removed') onGameGone(ch.doc.id);
        else onGame(ch.doc.data().game);
      });
    }, function () {}));
  }
  function stopListening() { unsub.forEach(function (u) { u(); }); unsub = []; }

  // Restore from a backup: the cloud becomes exactly the backup.
  function replaceAll(meta, games) {
    if (!book) return;
    pushMeta(meta);
    book.collection('games').get().then(function (q) {
      var keep = {};
      games.forEach(function (g) { keep[g.id] = true; pushGame(g); });
      q.docs.forEach(function (d) { if (!keep[d.id]) removeGame(d.id); });
    });
  }

  root.SBCloud = {
    configured: configured, allowed: allowed, load: load, onAuth: onAuth, signIn: signIn, signOut: signOut,
    currentUser: currentUser, status: status, onStatus: onStatus, pushMeta: pushMeta, pushGame: pushGame,
    removeGame: removeGame, pull: pull, listen: listen, replaceAll: replaceAll
  };
})(this);
