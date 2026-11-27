/*
 * Scorebook app: routing, screens and input handling.
 * Rendering is plain innerHTML per screen with one delegated click handler;
 * elements opt in with data-a="action" and data-x="argument". ES5.
 */
(function () {
  'use strict';
  var C = window.SBCore, DB = window.SBDB, R = window.SBReport, esc = R.esc;
  // The logo as a data URL too, so saved and published reports carry it inside the file.
  var LOGO = 'icons/tiger.png', logoData = '';
  try {
    fetch(LOGO).then(function (r) { return r.blob(); }).then(function (b) {
      var fr = new FileReader(); fr.onload = function () { logoData = String(fr.result); }; fr.readAsDataURL(b);
    })['catch'](function () {});
  } catch (e) {}
  var app = document.getElementById('app');

  var meta = null;     // team, seasons, players, opponents, settings
  var games = [];      // all games, events embedded
  var route = { name: 'home', id: null };
  // Transient live-screen state (not persisted).
  var ui = { side: 'us', sel: null, oppSel: null, prompt: null, drawer: null, msg: null, kp: '', armed: null, subIn: null };
  var toastTimer = null, msgTimer = null;

  // ---------- helpers ----------
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  function randomId(n) {
    var chars = 'abcdefghijkmnpqrstuvwxyz23456789', out = '', bytes = new Uint8Array(n);
    (window.crypto || window.msCrypto).getRandomValues(bytes);
    for (var i = 0; i < n; i++) out += chars.charAt(bytes[i] % chars.length);
    return out;
  }

  function today() {
    var d = new Date(), m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  }

  function seasonName(d) {
    d = d || new Date();
    var y = d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1;
    return y + '–' + String(y + 1).slice(2);
  }

  function find(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
  function gameById(id) { return find(games, id); }
  function player(id) { return find(meta.players, id); }

  function seasonPlayers() {
    return meta.players.filter(function (p) { return p.seasonId === meta.currentSeasonId; }).sort(R.byJersey);
  }

  function seasonGames() {
    return games.filter(function (g) { return g.seasonId === meta.currentSeasonId; })
      .sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : (b.created || 0) - (a.created || 0); });
  }

  // Finished games that count for the season: scrimmages are left out of the record and stats.
  function seasonFinals() {
    return seasonGames().filter(function (g) { return g.status === 'final' && g.type !== 'scrimmage'; });
  }

  function shortName(p) {
    if (!p) return '';
    return ((p.first || '') + (p.last ? ' ' + p.last.charAt(0) + '.' : '')).trim();
  }

  // Jersey number, or the player's initials while they don't have one yet (jerseys not handed out).
  function jerseyOf(p) {
    if (!p) return '?';
    if (p.num) return p.num;
    return ((p.first || '').charAt(0) + (p.last || '').charAt(0)).toUpperCase() || '–';
  }
  // "#12 Sam K.", or just "Sam K." with no number yet.
  function pTag(p) { return p ? (p.num ? '#' + p.num + ' ' : '') + shortName(p) : ''; }

  // Test mode: try anything without keeping it. Changes live only in memory (nothing is saved on
  // the tablet or synced, and changes from other tablets are ignored), so a reload brings back the
  // real data. Deliberately not remembered across reloads.
  var testMode = false;

  // Every save goes to the tablet first, then to the cloud when sync is on. The updated time
  // decides which copy wins when two tablets have changed the same thing.
  function saveMeta() {
    if (testMode) return;
    delete meta.fresh;
    meta.updated = Date.now();
    DB.saveMeta(meta, function (err) { if (err) toast('Could not save. Storage may be full.'); });
    // Sent to the cloud only once this session has read the server's copy and while online; until then
    // the change waits here and is merged in (not sent blind) by the next catch-up.
    if (syncing && pulledNow && navigator.onLine) Cloud.pushMeta(meta);
  }
  var pulledNow = false;
  // Remembers a deleted roster or schedule entry (see SBCore.mergeMeta).
  function markGone(id) { if (id) { meta.gone = meta.gone || {}; meta.gone[id] = Date.now(); } }

  function saveGame(g) {
    if (testMode) return;
    g.updated = Date.now();
    if (syncing) g.synced = true;
    DB.saveGame(g, function (err) { if (err) toast('Could not save game. Storage may be full.'); });
    if (syncing) Cloud.pushGame(g);
  }
  // Finished games lock an hour after they end (the database enforces the same rule): they can't be
  // reopened, changed or deleted from any tablet after that. Only the database owner can.
  var LOCK_AFTER = 60 * 60 * 1000;
  function lockAt(g) { return (g.ended || 0) + LOCK_AFTER; }
  function gameLocked(g) { return !!g && g.status === 'final' && Date.now() >= lockAt(g); }

  function removeGame(id) {
    if (testMode) return;
    DB.deleteGame(id);
    if (syncing) Cloud.removeGame(id);
  }

  function toast(text, ms) {
    var el = document.getElementById('toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; document.body.appendChild(el); }
    el.textContent = text; el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, ms || 2600);
  }

  // Message shown in the live pad header (e.g. "Pick a player first").
  function padMsg(text) {
    ui.msg = text;
    clearTimeout(msgTimer);
    msgTimer = setTimeout(function () { ui.msg = null; if (route.name === 'game') render(); }, 2200);
  }

  function applyTheme() {
    var hex = (meta.team.color || '#2340C8').replace('#', '');
    var r = parseInt(hex.substr(0, 2), 16), g = parseInt(hex.substr(2, 2), 16), b = parseInt(hex.substr(4, 2), 16);
    function mix(c) { return Math.round(c * 0.13 + 255 * 0.87); }
    var s = document.documentElement.style;
    s.setProperty('--accent', '#' + hex);
    s.setProperty('--accent-soft', 'rgb(' + mix(r) + ',' + mix(g) + ',' + mix(b) + ')');
  }

  // The live screen is a fixed canvas scaled to fill the window by setting the root font size:
  // 80 x 50 rem with both teams shown on wide screens (Fire HD 10: 1280 x 800, iPads in
  // landscape), else the compact 60 x 37.5 rem layout (Fire HD 8: 960 x 600, portrait).
  var WIDE_MIN = 1024;   // every iPad in landscape; the Fire HD 8 (960) stays compact
  function fitScale() {
    var w = window.innerWidth, h = window.innerHeight, wide = w >= WIDE_MIN, fs;
    if (route.name === 'game') fs = wide ? Math.min(w / 80, h / 50) : Math.min(w / 60, h / 37.5);
    else fs = Math.min(18, Math.max(14, w / 60));
    document.documentElement.style.fontSize = Math.max(10, fs).toFixed(2) + 'px';
    if (ui.wide !== wide) {
      ui.wide = wide;
      if (route.name === 'game' && meta) render();
    }
  }

  // Keep the screen on (Screen Wake Lock API; needs https; iPadOS 16.4+, 18.4+ for a home-screen
  // app). By default the whole time the app is open; Settings can limit it to games. The browser
  // drops the lock when the app is hidden, so it's requested again on return and on any tap
  // (some browsers only grant it right after a tap).
  var wakeLock = null, wakeRefused = false;
  function wantWake() {
    if (meta && meta.settings.keepAwake !== 'games') return true;
    if (route.name === 'game') return true;
    var g = route.name === 'report' && gameById(route.id);
    return !!(g && g.status !== 'final');
  }
  function wakeStatus() {
    if (!navigator.wakeLock) {
      return 'This browser can’t keep the screen on' + (location.protocol === 'https:' ? '' : ' at this address — use the https one') +
        '. On iPad it needs iPadOS 16.4 or later (18.4 or later for the home-screen app).';
    }
    if (wakeLock && wakeLock !== 'pending') return 'Screen is being kept on now.';
    if (!wantWake()) return 'Screen will stay on during games.';
    return wakeRefused ? 'This browser refused to keep the screen on. Tap anywhere to try again; if it still won’t, check that Low Power Mode is off.'
      : 'Screen isn’t being kept on yet — tap anywhere to turn it on.';
  }

  function syncWake() {
    if (!navigator.wakeLock) return;
    if (wantWake() && !wakeLock && document.visibilityState === 'visible') {
      wakeLock = 'pending';
      navigator.wakeLock.request('screen').then(function (l) {
        wakeLock = l; wakeRefused = false;
        l.addEventListener('release', function () { if (wakeLock === l) { wakeLock = null; if (route.name === 'settings') render(); } });
        if (!wantWake()) syncWake();
        if (route.name === 'settings') render();
      })['catch'](function () {
        wakeLock = null;
        if (!wakeRefused) { wakeRefused = true; if (route.name === 'settings') render(); }
      });
    } else if (!wantWake() && wakeLock && wakeLock !== 'pending') {
      var l = wakeLock; wakeLock = null; l.release()['catch'](function () {});
    }
  }

  // Full screen. Browsers only allow it from a tap, so it is entered from click handlers.
  // Not offered where unsupported (iPhone) or when already running from the home screen.
  function fsActive() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }
  function fsAvailable() {
    var d = document.documentElement;
    if (!(d.requestFullscreen || d.webkitRequestFullscreen)) return false;
    if (window.navigator.standalone) return false;
    return !(window.matchMedia && window.matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches);
  }
  function quiet(p) { if (p && p['catch']) p['catch'](function () {}); }
  function enterFullscreen() {
    var d = document.documentElement;
    if (fsActive() || !fsAvailable()) return;
    try { quiet(d.requestFullscreen ? d.requestFullscreen() : d.webkitRequestFullscreen()); } catch (e) {}
  }
  function exitFullscreen() {
    try { quiet(document.exitFullscreen ? document.exitFullscreen() : document.webkitExitFullscreen()); } catch (e) {}
  }
  function autoFullscreen() { return meta.settings.autoFull !== '0'; }

  // App version: the offline copy's name, asked from the service worker (shown in Settings).
  var swReg = null, swVersion = '';
  function askVersion() {
    var ctl = navigator.serviceWorker && navigator.serviceWorker.controller;
    if (!ctl || !window.MessageChannel) return;
    var ch = new MessageChannel();
    ch.port1.onmessage = function (e) { swVersion = e.data; if (route.name === 'settings') render(); };
    ctl.postMessage('version', [ch.port2]);
  }

  // Web Share with files (Chrome on Android, Safari on iPad; needs https). Checked once for the button.
  function canShareFiles(files) {
    try { return !!(navigator.canShare && navigator.canShare({ files: files })); } catch (e) { return false; }
  }
  var SHARE_FILES = !!window.File && canShareFiles([new File(['x'], 'report.html', { type: 'text/html' })]);

  function download(name, text, type) {
    var blob = new Blob([text], { type: type });
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
  }

  function slug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

  // ---------- defaults & boot ----------
  function defaultMeta() {
    var sid = uid();
    return {
      version: 1,
      team: { name: 'Dalton', short: 'DAL', color: '#2340C8' },
      seasons: [{ id: sid, name: seasonName() }],
      currentSeasonId: sid,
      players: [],
      opponents: [],
      settings: { rules: C.copyRules(), names: 'first', publishUrl: '', publishKey: '' },
      schedule: []   // [{ id, seasonId, date, time, opponent, homeAway, location, gameId }]
    };
  }

  // The launch animation plays for about 4 seconds from page load (none if motion is reduced),
  // then fades; if loading takes longer, it stays until the app is ready.
  function hideSplash() {
    var s = document.getElementById('splash');
    if (!s) return;
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var since = window.performance && performance.now ? performance.now() : 0;
    setTimeout(function () {
      s.className = 'done';
      setTimeout(function () { if (s.parentNode) s.parentNode.removeChild(s); }, 550);
    }, reduce ? 0 : Math.max(0, 4000 - since));
  }

  // Reloading or closing mid-game asks first (an accidental pull-to-refresh or reload button tap).
  // Reloads the app does on purpose (Exit test mode, updates, sign-in) skip the question.
  var leavingOnPurpose = false;
  function reloadNow() { leavingOnPurpose = true; location.reload(); }
  window.addEventListener('beforeunload', function (e) {
    if (leavingOnPurpose || route.name !== 'game') return;
    var g = gameById(route.id);
    if (!g || g.status !== 'live') return;
    e.preventDefault();
    e.returnValue = 'Leave the game? Everything scored so far is saved.';
    return e.returnValue;
  });

  function boot() {
    DB.open(function () {
      DB.loadMeta(function (err, m) {
        meta = m || defaultMeta();
        // Nothing saved on this tablet yet: a blank record that never counts as newer than the cloud's
        // (stamped 0 and marked fresh), so signing in on a new tablet can't wipe out the real one.
        if (!m) { meta.updated = 0; meta.fresh = true; DB.saveMeta(meta, function () {}); }
        meta.schedule = meta.schedule || [];   // added after the first version
        DB.loadGames(function (err2, gs) {
          games = gs || [];
          if (Cloud.configured()) startCloud(); else openApp();
        });
      });
    });
  }

  // Shows the app (once): listeners, first screen, end of the launch animation.
  var appOpen = false;
  function openApp() {
    if (appOpen) { onRoute(); return; }
    appOpen = true;
    applyTheme();
    window.addEventListener('hashchange', onRoute);
    window.addEventListener('resize', fitScale);
    hideSplash();
    document.addEventListener('visibilitychange', syncWake);
    window.addEventListener('focus', syncWake);
    window.addEventListener('pageshow', syncWake);
    document.addEventListener('fullscreenchange', onFullscreen);
    document.addEventListener('webkitfullscreenchange', onFullscreen);
    onRoute();
  }

  // ---------- cloud sign-in and sync ----------
  var Cloud = window.SBCloud, syncing = false, gate = null, syncState = 'synced';

  function startCloud() {
    Cloud.load(function (err) {
      if (err) { showGate('error', err.message + ' Check the internet connection.'); return; }
      Cloud.onAuth(function (user) {
        if (!user) { syncing = false; showGate('signin'); return; }
        Cloud.checkAccess(user, function (ok) {
          if (ok === null) { syncing = false; showGate('error', 'Couldn’t check access for ' + user.email + '. Connect to the internet the first time you sign in.'); return; }
          if (!ok) { syncing = false; showGate('denied', user.email); return; }
          gate = null;
          startSync(function () { openApp(); });
        });
      });
    });
    Cloud.onStatus(function (s) { syncState = s; if (route.name === 'settings' && !gate) render(); });
  }

  // Full-screen sign-in / no-access screen; nothing else is shown until an allowed account signs in.
  function showGate(kind, detail, msg) {
    if (kind === 'signin' && !msg) {
      var re = Cloud.takeRedirectError();
      if (re) msg = 'Sign-in didn’t work (' + (re.code || re.message) + ').';
    }
    gate = { kind: kind, detail: detail || '', msg: msg || '' };
    hideSplash();
    var body;
    if (kind === 'denied') {
      body = '<p><b>' + esc(detail) + '</b> doesn’t have access to this scorebook.</p>' +
        '<button class="btn pri" data-a="signInOther">Use a different account</button>';
    } else if (kind === 'error') {
      body = '<p>' + esc(detail || 'Couldn’t start sign-in. Check the internet connection.') + '</p>' +
        '<button class="btn pri" data-a="reload">Try again</button>';
    } else {
      body = '<p>Sign in with Google to open the scorebook.</p>' +
        '<button class="btn pri gate-google" data-a="signIn">Sign in with Google</button>' +
        (gate.msg ? '<p class="gate-msg">' + esc(gate.msg) + '</p>' : '');
    }
    app.innerHTML = '<div class="gate"><span class="gate-logo"><img src="' + LOGO + '" alt=""></span><h1>' + esc(meta.team.name) + ' Scorebook</h1>' + body + '</div>';
  }

  // After sign-in: follow live changes and merge the cloud copy with this tablet's. The app opens
  // at once from the tablet's own copy when offline (or if the server takes over 4 s); the merge
  // then runs in the background, and again whenever the connection comes back.
  function startSync(cb) {
    syncing = true;
    listenCloud();
    // Going offline means the next save waits for a fresh read of the server's copy.
    window.addEventListener('offline', function () { pulledNow = false; catchUpLater(); });
    var opened = false;
    function open() { if (!opened) { opened = true; cb(); } }
    if (!navigator.onLine) { catchUpLater(); open(); return; }
    setTimeout(open, 4000);
    mergeWithCloud(function (ok) {
      if (!ok) catchUpLater();
      if (opened) refresh(); else open();
    });
  }

  // Retry the merge when the tablet is back online (or in 30 s if it seems online but the server
  // couldn't be reached).
  var catchUpPending = false;
  function catchUpLater() {
    if (catchUpPending) return;
    catchUpPending = true;
    function retry() {
      window.removeEventListener('online', retry);
      catchUpPending = false;
      mergeWithCloud(function (ok) { if (ok) refresh(); else catchUpLater(); });
    }
    if (navigator.onLine) setTimeout(retry, 30000); else window.addEventListener('online', retry);
  }

  // Per game and for the rest (meta), the copy changed most recently wins. A game that was synced
  // before but is gone from the server copy was deleted on another tablet; one never synced is new here.
  function mergeWithCloud(done) {
    Cloud.pull(function (err, remote) {
      if (err || testMode) { done(!err); return; }
      pulledNow = true;
      takeMerged(C.mergeMeta(meta, remote.meta));
      var byId = {};
      remote.games.forEach(function (rg) { byId[rg.id] = rg; });
      games = games.filter(function (g) {
        var rg = byId[g.id];
        if (!rg) {
          // Missing from the server: deleted on another tablet, unless it's a finished game, which is
          // never removed by a sync (it stays on this tablet).
          if (g.synced && g.status !== 'final') { DB.deleteGame(g.id); return false; }
          if (g.synced) return true;
          g.synced = true; DB.saveGame(g, function () {}); Cloud.pushGame(g);
          return true;
        }
        if ((g.updated || 0) > (rg.updated || 0)) Cloud.pushGame(g);
        return true;
      });
      remote.games.forEach(function (rg) {
        var lg = gameById(rg.id);
        if (!lg || (rg.updated || 0) > (lg.updated || 0)) takeRemoteGame(rg);
      });
      done(true);
    });
  }

  // Changes made on other tablets, as they happen (works from the offline copy too).
  function listenCloud() {
    Cloud.listen(onRemoteMeta, function (rg) {
      if (testMode) return;
      var lg = gameById(rg.id);
      if (!lg || (rg.updated || 0) > (lg.updated || 0)) { takeRemoteGame(rg); refresh(); }
    }, function (id) {
      var gone = gameById(id);
      if (testMode || !gone || gone.status === 'final') return;
      games = games.filter(function (g) { return g.id !== id; });
      DB.deleteGame(id);
      if (route.id === id) go('#home'); else refresh();
    });
  }

  function takeRemoteGame(rg) {
    rg.synced = true;
    games = games.filter(function (g) { return g.id !== rg.id; }).concat([rg]);
    DB.saveGame(rg, function () {});
  }
  function onRemoteMeta(rm) {
    if (testMode || !rm) return;
    if (takeMerged(C.mergeMeta(meta, rm))) { applyTheme(); refresh(); }
  }

  // Uses a merged record: saves it here if it changed anything, and sends it up if the cloud lacks
  // something. Before a sync shrinks the roster or schedule here, the old copy is kept on this tablet
  // (localStorage sb-meta-before-sync) in case it's ever needed. Returns true if this tablet changed.
  function takeMerged(mm) {
    if (mm.local) {
      var old = meta, nu = mm.meta;
      if ((old.players || []).length > (nu.players || []).length || (old.schedule || []).length > (nu.schedule || []).length) {
        try { localStorage.setItem('sb-meta-before-sync', JSON.stringify({ at: Date.now(), meta: old })); } catch (e) {}
      }
      meta = nu; meta.schedule = meta.schedule || [];
      if (!mm.remote) DB.saveMeta(meta, function () {});
    }
    if (mm.remote) saveMeta();
    return mm.local;
  }
  // Redraw after a change from another tablet, but not under an open sheet or mid-typing.
  function refresh() {
    if (!appOpen || gate || ui.drawer) return;
    var a = document.activeElement;
    if (a && /INPUT|TEXTAREA|SELECT/.test(a.tagName)) return;
    render();
  }

  function onFullscreen() { fitScale(); render(); }

  function go(hash) { if (location.hash === hash) onRoute(); else location.hash = hash; }

  function onRoute() {
    var parts = (location.hash || '#home').slice(1).split('/');
    route = { name: parts[0] || 'home', id: parts[1] || null };
    ui.drawer = null; ui.prompt = null; ui.armed = null;
    document.documentElement.classList.remove('print-stats');
    if (route.name === 'game') {
      var g = gameById(route.id);
      if (!g) return go('#home');
      if (g.status === 'final') return go('#report/' + g.id);
    }
    fitScale();
    render();
    syncWake();
    window.scrollTo(0, 0);
  }

  function render() {
    if (gate) { showGate(gate.kind, gate.detail, gate.msg); return; }
    var fn = screens[route.name] || screens.home;
    app.innerHTML = route.name === 'game' ? fn() : '<div class="pg">' + fn() + '</div>';
    // No pull-to-refresh on the live screen, where a downward swipe is easy to make by accident.
    document.documentElement.classList.toggle('in-game', route.name === 'game');
    if (route.name === 'stats' || route.name === 'player') applyStatSearch(false);
    if (route.name === 'report' && R.bindCharts) R.bindCharts(app);
    if (route.name === 'game' && ui.flash) {
      var el = app.querySelector('[data-flash="1"]');
      ui.flash = null;
      if (el) setTimeout(function () { el.classList.remove('hit'); }, 180);
    }
  }

  // ---------- event recording ----------
  function addEvent(g, tm, p, t, v) {
    g.seq = (g.seq || 0) + 1;
    var e = { s: g.seq, q: g.quarter, tm: tm, p: p, t: t, v: v };
    g.events.push(e);
    g.updated = Date.now();
    saveGame(g);
    return e;
  }

  function describe(e, g) {
    var who, staff = { hc: 'head coach', ac: 'assistant coach', team: 'team' };
    if (e.t === 'foul' && staff[e.w]) return (e.tm === 'us' ? meta.team.name : (g.opponent || 'Opponent')) + ' — technical on the ' + staff[e.w];
    if (e.t === 'timeout') who = e.tm === 'us' ? meta.team.name : (g.opponent || 'Opponent');
    else if (e.tm === 'us') { var p = player(e.p) || R.findPlayer(g, meta, e.p); who = p ? pTag(p) : 'Player'; }
    else who = e.p ? (g.opponent || 'Opp') + ' #' + e.p : (g.opponent || 'Opponent');
    var what = {
      make: { 1: 'made free throw', 2: 'made 2', 3: 'made 3' },
      miss: { 1: 'missed free throw', 2: 'missed 2', 3: 'missed 3' }
    };
    var d;
    if (e.t === 'make' || e.t === 'miss') d = what[e.t][e.v];
    else if (e.t === 'reb') d = e.v === 'o' ? 'offensive rebound' : 'defensive rebound';
    else if (e.t === 'foul') d = e.v === 't' ? (e.w === 'bench' ? 'technical (on the bench)' : 'technical foul') : e.of ? 'offensive foul' : 'foul';
    else if (e.t === 'timeout') d = e.v === 'short' ? '30-second timeout' : 'full timeout';
    else if (e.t === 'sub') d = e.v === 'in' ? 'subbed in' : 'subbed out';
    else if (e.t === 'award') d = (e.v === 1 ? 'point' : e.v + ' points') + ' for shooting foul';
    else d = { ast: 'assist', stl: 'steal', blk: 'block', to: 'turnover', chg: 'took a charge' }[e.t] || e.t;
    return who + ' — ' + d;
  }

  // ---------- screens ----------
  var screens = {};

  function pageHead(title, left, right) {
    return '<header class="pg-hd">' + (left || '') + '<h1>' + esc(title) + '</h1>' + (right || '') + '</header>';
  }

  function backBtn(hash, label) {
    return '<button class="back" data-a="go" data-x="' + hash + '">‹ ' + esc(label || 'Back') + '</button>';
  }

  // ----- Home -----
  screens.home = function () {
    var season = find(meta.seasons, meta.currentSeasonId) || meta.seasons[0];
    var gs = seasonGames(), live = gs.filter(function (g) { return g.status !== 'final'; });
    var finals = seasonFinals();
    var s = C.computeSeason(finals, seasonPlayers());
    var h = [];
    h.push(pageHead(meta.team.name + ' · ' + season.name, '<span class="hd-logo"><img src="' + LOGO + '" alt=""></span>',
      (fsAvailable() ? '<button class="btn sm" data-a="fullscreen">' + (fsActive() ? 'Exit full screen' : 'Full screen') + '</button>' : '') +
      '<button class="btn sm" data-a="go" data-x="#stats/team">Stats</button>' +
      '<button class="btn sm" data-a="go" data-x="#schedule">Schedule</button>' +
      '<button class="btn sm" data-a="go" data-x="#roster">Roster</button>' +
      '<button class="btn sm" data-a="go" data-x="#settings">Settings</button>' +
      '<button class="btn sm pri" data-a="go" data-x="#new">New game</button>'));
    h.push('<div class="pg-bd">');
    h.push('<div class="home-top">');
    live.forEach(function (g) {
      var c = C.computeGame(g);
      h.push('<button class="live-card" data-a="go" data-x="#game/' + g.id + '"><span class="sc">' + c.score.us + '–' +
        c.score.them + '</span><div><b>Resume ' + (g.type === 'scrimmage' ? 'scrimmage ' : '') + 'vs ' + esc(g.opponent) + '</b><small>' +
        C.periodLabel(g.quarter, c.rules) + ' · ' + esc(R.fmtDate(g.date)) + '</small></div><span class="btn sm">Resume</span></button>');
    });
    h.push('<div class="record"><div><b class="num">' + s.team.w + '–' + s.team.l + '</b><span>Record</span></div>' +
      '<div><b class="num">' + (s.team.gp ? (s.team.pf / s.team.gp).toFixed(1) : '—') + '</b><span>Pts / game</span></div>' +
      '<div><b class="num">' + (s.team.gp ? (s.team.pa / s.team.gp).toFixed(1) : '—') + '</b><span>Allowed</span></div></div>');
    h.push('</div>');

    var next = upcoming().slice(0, 3);
    if (next.length) {
      h.push('<h2>Up next</h2><ul class="games sched">' + next.map(function (x) { return schedRow(x, false); }).join('') + '</ul>');
    }

    h.push('<h2>Games</h2>');
    if (!gs.length) {
      h.push('<div class="empty-state">No games yet this season.<br>' +
        (seasonPlayers().length ? '<button class="btn pri" data-a="go" data-x="#new">Start a game</button>'
          : 'Add your roster first, then start a game.<br><button class="btn pri" data-a="go" data-x="#roster">Add players</button>') + '</div>');
    } else {
      h.push('<ul class="games">');
      gs.forEach(function (g) {
        var c = C.computeGame(g), wl, cls;
        if (g.status !== 'final') { wl = '●'; cls = 'live'; }
        else if (g.type === 'scrimmage') { wl = 'S'; cls = 'scrim'; }
        else if (c.score.us > c.score.them) { wl = 'W'; cls = 'w'; }
        else if (c.score.us < c.score.them) { wl = 'L'; cls = 'l'; }
        else { wl = 'T'; cls = 'l'; }
        h.push('<li><button data-a="go" data-x="' + (g.status === 'final' ? '#report/' : '#game/') + g.id + '">' +
          '<span class="wl ' + cls + '">' + wl + '</span><span class="op">' + (g.homeAway === 'away' ? '@ ' : 'vs ') + esc(g.opponent) +
          (g.type === 'scrimmage' ? ' <span class="tag-scrim">Scrimmage</span>' : '') +
          '<small>' + esc(R.fmtDate(g.date)) + (g.location ? ' · ' + esc(g.location) : '') + '</small></span>' +
          '<span class="sc">' + c.score.us + '–' + c.score.them + '</span></button></li>');
      });
      h.push('</ul>');
    }

    if (finals.length) h.push('<h2>Season leaders</h2>' + leaders(s));
    h.push('<h2>Stats</h2><div class="stat-links">' + [['team', 'Team', 'Record, scoring by quarter, shooting, situations'],
      ['players', 'Players', 'Per game, totals, shooting, advanced'], ['leaders', 'Leaders', 'Top 5 in every category, single-game highs'],
      ['lineups', 'Lineups', 'Five-player units and starting lineups'], ['games', 'Game log', 'Every game’s team numbers']].map(function (x) {
      return '<button data-a="go" data-x="#stats/' + x[0] + '"><b>' + x[1] + '</b><small>' + x[2] + '</small></button>';
    }).join('') + '</div>');
    h.push('</div>');
    return h.join('');
  };

  function avg(n, gp) { return gp ? (n / gp).toFixed(1) : '—'; }

  // Top 3 in each category. Per-game averages for counting stats; percentages need
  // at least 1 attempt per game played and 5 in all, so one lucky shot doesn't lead.
  function leaders(s) {
    var ps = seasonPlayers(), on = C.pctShown(meta.settings), cats = [
      { label: 'Points', unit: 'PPG', val: function (r) { return r.line.pts / r.gp; } },
      { label: 'Rebounds', unit: 'RPG', val: function (r) { return (r.line.oreb + r.line.dreb) / r.gp; } },
      { label: 'Assists', unit: 'APG', val: function (r) { return r.line.ast / r.gp; } },
      { label: 'Steals', unit: 'SPG', val: function (r) { return r.line.stl / r.gp; } },
      { label: 'Blocks', unit: 'BPG', val: function (r) { return r.line.blk / r.gp; } },
      { label: 'Charges taken', unit: 'total', whole: true, val: function (r) { return r.line.chg || 0; } },
      { label: 'Plus/minus', unit: 'total', whole: true, pm: true, val: function (r) { return r.pmGp ? r.pm : null; } }
    ];
    function pctCat(label, show, m, a) {
      if (show) cats.push({ label: label, unit: '5+ attempts', pct: true, val: function (r) {
        var att = r.line[a]; return att >= Math.max(5, r.gp) ? r.line[m] / att * 100 : null;
      } });
    }
    pctCat('Field goal %', on.fg, 'fgm', 'fga');
    pctCat('3-point %', on.tp, 'tpm', 'tpa');
    pctCat('Free throw %', on.ft, 'ftm', 'fta');
    var h = ['<div class="leaders">'];
    cats.forEach(function (cat) {
      var rows = [];
      ps.forEach(function (p) {
        var r = s.players[p.id];
        if (!r || !r.gp) return;
        var v = cat.val(r);
        if (v !== null && (cat.pm || v > 0)) rows.push({ p: p, v: v });
      });
      rows.sort(function (a, b) { return b.v - a.v; });
      h.push('<div class="ldr"><h3>' + cat.label + ' <small>' + cat.unit + '</small></h3>');
      if (!rows.length) h.push('<p class="none">—</p>');
      else h.push('<ol>' + rows.slice(0, 3).map(function (x) {
        var v = cat.pm ? C.fmtPm(x.v) : cat.whole ? String(x.v) : x.v.toFixed(1);
        return '<li><button data-a="go" data-x="#player/' + x.p.id + '"><span class="jr">' + esc(jerseyOf(x.p)) + '</span>' +
          esc(shortName(x.p)) + '<b>' + v + '</b></button></li>';
      }).join('') + '</ol>');
      h.push('</div>');
    });
    h.push('</div>');
    return h.join('');
  }

  // ----- Stats -----
  // Which finished games the stats cover. Scrimmages only count under their own filter.
  var STAT_FILTERS = [['all', 'All games'], ['home', 'Home'], ['away', 'Away'], ['wins', 'Wins'], ['losses', 'Losses'],
    ['last5', 'Last 5 games'], ['last10', 'Last 10 games'], ['scrim', 'Scrimmages']];
  function statFilter() { return ui.statFilter || 'all'; }
  function statFilterLabel() { var f = statFilter(), l = 'All games'; STAT_FILTERS.forEach(function (x) { if (x[0] === f) l = x[1]; }); return l; }
  function statGames() {
    var f = statFilter(), done = seasonGames().filter(function (g) { return g.status === 'final'; });
    if (f === 'scrim') return done.filter(function (g) { return g.type === 'scrimmage'; });
    var list = done.filter(function (g) { return g.type !== 'scrimmage'; });
    function margin(g) { var c = C.computeGame(g); return c.score.us - c.score.them; }
    if (f === 'home') return list.filter(function (g) { return g.homeAway !== 'away'; });
    if (f === 'away') return list.filter(function (g) { return g.homeAway === 'away'; });
    if (f === 'wins') return list.filter(function (g) { return margin(g) > 0; });
    if (f === 'losses') return list.filter(function (g) { return margin(g) < 0; });
    if (f === 'last5' || f === 'last10') return list.slice(0, f === 'last5' ? 5 : 10); // seasonGames is newest first
    return list;
  }
  function statsCtx(forPrint) {
    var season = find(meta.seasons, meta.currentSeasonId) || {}, rules = meta.settings.rules;
    return {
      teamName: meta.team.name, oppWord: 'Opponents', season: season.name || '', filter: statFilterLabel(),
      players: seasonPlayers(), on: C.pctShown(meta.settings), link: !forPrint, sort: ui.statSort,
      find: function (id) { return player(id) || findInGames(id); },
      name: shortName, jersey: jerseyOf,
      full: function (p) { return ((p.first || '') + ' ' + (p.last || '')).trim() || 'Player'; },
      periodLabel: function (q) { return C.periodLabel(q, rules); },
      teamColor: meta.team.color, teamShort: meta.team.name, logo: LOGO
    };
  }
  // A player no longer on the roster, from a game's roster snapshot.
  function findInGames(id) {
    for (var i = 0; i < games.length; i++) { var p = find(games[i].roster || [], id); if (p) return p; }
    return null;
  }
  function statsData() { return window.SBStatsCalc.compute(statGames(), seasonPlayers()); }

  var STAT_TABS = [['team', 'Team'], ['players', 'Players'], ['leaders', 'Leaders'], ['lineups', 'Lineups'], ['games', 'Game log']];
  function filterSelect() {
    return '<label class="stat-filter"><span>Games</span><select data-statfilter="1">' + STAT_FILTERS.map(function (f) {
      return '<option value="' + f[0] + '"' + (statFilter() === f[0] ? ' selected' : '') + '>' + f[1] + '</option>';
    }).join('') + '</select></label>';
  }


  // ----- Stats search -----
  // One box on every stats screen. As you type: a jump list of matching players, stats and games
  // (tap one, or Enter for the first), and the lists on the current sheet narrow to matching rows.
  // Stat entries: words to match, then where to go (players table view + sort, or a sheet + a label to scroll to).
  var STAT_INDEX = [
    ['Points per game', 'points ppg pts scoring scorer', 'pergame', 'pts'], ['Rebounds per game', 'rebounds reb rpg boards', 'pergame', 'reb'],
    ['Offensive rebounds', 'offensive rebounds oreb or', 'pergame', 'oreb'], ['Defensive rebounds', 'defensive rebounds dreb dr', 'pergame', 'dreb'],
    ['Assists per game', 'assists ast apg passing', 'pergame', 'ast'], ['Steals per game', 'steals stl spg', 'pergame', 'stl'],
    ['Blocks per game', 'blocks blk bpg', 'pergame', 'blk'], ['Turnovers per game', 'turnovers to tov', 'pergame', 'to'],
    ['Fouls per game', 'fouls pf personal', 'pergame', 'pf'], ['Charges taken', 'charges chg', 'pergame', 'chg'],
    ['Plus/minus', 'plus minus +/- pm', 'pergame', 'pm'], ['Games played', 'games played gp', 'pergame', 'gp'], ['Games started', 'starts started gs starters', 'pergame', 'gs'],
    ['Field goal %', 'field goal percentage fg% fgp shooting', 'shooting', 'fgp'], ['2-point %', 'two 2-point 2p% twos', 'shooting', 'twop'],
    ['3-point %', 'three 3-point 3p% threes 3pt', 'shooting', 'tpp'], ['Free throw %', 'free throw ft% ftp foul shots', 'shooting', 'ftp'],
    ['Effective FG%', 'effective efg', 'shooting', 'efg'], ['True shooting %', 'true shooting ts', 'shooting', 'ts'],
    ['Points per shot', 'points per shot pps efficiency', 'shooting', 'pps'], ['3-point attempt rate', '3pa rate three attempt', 'shooting', 'tpr'],
    ['Free throw rate', 'free throw rate ftr', 'shooting', 'ftr'], ['Shot volume vs efficiency', 'scatter volume efficiency chart', 'shooting', 'efg'],
    ['3-pointers made', 'threes made 3pm', 'totals', 'tpm'], ['Free throws made', 'free throws made ftm', 'totals', 'ftm'],
    ['Technical fouls', 'technicals tf tech', 'totals', 'tf'], ['Season totals', 'totals season total', 'totals', 'pts'],
    ['Game score', 'game score gmsc rating', 'advanced', 'gmsc'], ['Usage', 'usage usg possessions used', 'advanced', 'usg'],
    ['Share of team points', 'share team points %pts', 'advanced', 'share'], ['Assist-to-turnover', 'assist turnover ratio ast/to ato', 'advanced', 'ato'],
    ['Steals + blocks', 'stocks steals blocks defense', 'advanced', 'stocks'], ['Double-doubles', 'double doubles dd', 'advanced', 'dd'],
    ['Quarters played', 'quarters periods played qtrs minutes', 'advanced', 'qp'], ['On/off court', 'on off court net impact', 'advanced', 'diff'],
    ['Record', 'record wins losses w-l', 'team', 'Record'], ['Home and away', 'home away road', 'team', 'Home'], ['Streak', 'streak', 'team', 'Streak'],
    ['Scoring by quarter', 'quarter period halves scoring by', 'team', 'Scoring by'], ['Margin by game', 'margin game by game wins losses chart', 'team', 'Game by game'],
    ['Points by game', 'points by game trend', 'team', 'Points by game'], ['Shooting by game', 'shooting by game trend', 'team', 'Shooting by game'],
    ['Where the points come from', 'points mix 2s 3s free throws breakdown', 'team', 'Where the points'],
    ['Possessions and points per 100', 'possessions pace offense defense rating per 100 efficiency', 'team', 'Possessions'],
    ['Close games', 'close games clutch', 'team', 'Close games'], ['Leading or trailing at half', 'half halftime leading trailing', 'team', 'Leading at half'],
    ['Scored first', 'scored first start', 'team', 'Scored first'], ['Fouls and free throws', 'fouls drawn free throws bonus', 'team', 'Fouls and free throws'],
    ['Opponents', 'opponents head to head results by opponent', 'team', 'Opponents'], ['Team highs', 'team highs records best game', 'team', 'Team highs'],
    ['Leaders', 'leaders top best', 'leaders', ''], ['Single-game highs', 'single game highs career high records', 'leaders', 'Single-game highs'],
    ['Lineups', 'lineups five units groups combinations', 'lineups', ''], ['Starting lineups', 'starting lineups starters', 'lineups', 'Starting lineups'],
    ['Game log', 'game log games results schedule', 'games', '']
  ];
  var sqResults = [];

  // In the header: a magnifier icon; tapped, it grows into the search field (and shrinks back on close).
  var SQ_ICON = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="6" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M13 13l5 5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
  function searchBox() {
    if (!ui.sqOpen) return '<button class="btn sm sq-btn" data-a="sqOpen" aria-label="Search players, stats and games" title="Search">' + SQ_ICON + '</button>';
    return '<div class="hd-search' + (ui.sqAnim ? ' grow' : '') + '"><span class="sq-ico">' + SQ_ICON + '</span>' +
      '<input id="stat-q" type="search" data-statq="1" placeholder="Players, stats, games…" autocomplete="off" value="' + esc(ui.statQ || '') + '" aria-label="Search stats">' +
      '<button class="sq-x" data-a="sqClose" aria-label="Close search">×</button><div class="sq-res" id="sq-res" hidden></div></div>';
  }
  function sqWords(q) { return String(q || '').toLowerCase().split(/\s+/).filter(Boolean); }
  function sqHas(text, words) { text = String(text).toLowerCase(); return words.every(function (w) { return text.indexOf(w) >= 0; }); }

  function statSearchResults(q) {
    var words = sqWords(q), out = [];
    if (!words.length) return out;
    var ps = seasonPlayers();
    ps.forEach(function (p) {
      if (sqHas((p.num ? '#' + p.num + ' ' + p.num + ' ' : '') + (p.first || '') + ' ' + (p.last || ''), words)) {
        out.push({ kind: 'Player', label: pTag(p) || 'Player', go: '#player/' + p.id });
      }
    });
    STAT_INDEX.forEach(function (s) {
      if (sqHas(s[0] + ' ' + s[1], words)) out.push({ kind: 'Stat', label: s[0], stat: s });
    });
    seasonGames().filter(function (g) { return g.status === 'final'; }).forEach(function (g) {
      var c = C.computeGame(g), d = R.fmtDate(g.date);
      if (sqHas(g.opponent + ' ' + d + ' ' + (g.homeAway === 'away' ? 'away @' : 'home vs') + (g.type === 'scrimmage' ? ' scrimmage' : ''), words)) {
        out.push({ kind: 'Game', label: (g.homeAway === 'away' ? '@ ' : 'vs ') + g.opponent + ' · ' + d.replace(/, \d{4}$/, '') + ' · ' +
          (c.score.us > c.score.them ? 'W ' : c.score.us < c.score.them ? 'L ' : 'T ') + c.score.us + '–' + c.score.them, go: '#report/' + g.id });
      }
    });
    return out;
  }

  // Applies the search to the screen: the jump list, and narrowing the lists on the current sheet.
  function applyStatSearch(showList) {
    var input = document.getElementById('stat-q'), box = document.getElementById('sq-res');
    if (!input) return;
    var q = ui.statQ || '', words = sqWords(q);
    sqResults = statSearchResults(q);
    if (box) {
      if (!words.length || !showList) box.hidden = true;
      else {
        box.hidden = false;
        box.innerHTML = sqResults.length ? sqResults.slice(0, 9).map(function (r, i) {
          return '<button data-a="sqGo" data-x="' + i + '"><small>' + r.kind + '</small><span>' + esc(r.label) + '</span></button>';
        }).join('') + (sqResults.length > 9 ? '<p>' + (sqResults.length - 9) + ' more: keep typing to narrow it down</p>' : '')
          : '<p>Nothing matches “' + esc(q) + '”.</p>';
      }
    }
    // Narrow the lists of people and games on the sheet (not the team numbers, which aren't a list).
    var sheet = document.querySelector('.sx-wrap');
    if (!sheet) return;
    var rows = sheet.querySelectorAll('.sx-t tbody tr:not(.tot), .sx-ldr li, .sx-mult .row, .sx-div .row'), shown = 0, any = false;
    var narrowing = words.length && sqResults.some(function (r) { return r.kind !== 'Stat'; });
    for (var i = 0; i < rows.length; i++) {
      var hit = !narrowing || sqHas(rows[i].textContent, words);
      rows[i].style.display = hit ? '' : 'none';
      // Count list rows, not the matching bars in the charts above them.
      if (rows[i].className.split(' ').indexOf('row') < 0) { any = true; if (hit) shown++; }
    }
    // Leader cards with nobody matching are hidden too.
    var cards = sheet.querySelectorAll('.sx-ldr');
    for (var c = 0; c < cards.length; c++) {
      var visible = false, lis = cards[c].querySelectorAll('li');
      for (var k = 0; k < lis.length; k++) if (lis[k].style.display !== 'none') visible = true;
      cards[c].style.display = narrowing && !visible ? 'none' : '';
    }
    var note = document.getElementById('sq-note');
    if (!note) { note = document.createElement('p'); note.id = 'sq-note'; note.className = 'sq-note'; sheet.insertBefore(note, sheet.firstChild); }
    note.hidden = !(narrowing && any);
    note.innerHTML = narrowing && any ? 'Showing ' + shown + ' row' + (shown === 1 ? '' : 's') + ' matching “' + esc(q) + '”. <button data-a="sqClear">Show all</button>' : '';
    // Point out matching stat labels (column headings and list labels).
    var labels = sheet.querySelectorAll('.sx-t th, .sx-dl dt, .sx h2, .sx-ldr h3');
    for (var j = 0; j < labels.length; j++) {
      var on = words.length && !narrowing && sqHas(labels[j].textContent, words);
      if (on) labels[j].classList.add('sq-hit'); else labels[j].classList.remove('sq-hit');
    }
  }

  // Scrolls to a label on the sheet after jumping to it (e.g. "Close games" on the Team sheet).
  function focusStatLabel(text) {
    var all = document.querySelectorAll('.sx-wrap h2, .sx-wrap dt, .sx-wrap h3, .sx-wrap .sx-kpis span');
    for (var i = 0; i < all.length; i++) {
      if (all[i].textContent.toLowerCase().indexOf(text.toLowerCase()) === 0) {
        var el = all[i].closest ? (all[i].closest('.sx-dl > div') || all[i].closest('.sx-kpis > div') || all[i]) : all[i];
        el.scrollIntoView({ block: 'center' });
        el.classList.add('sq-flash');
        setTimeout(function () { el.classList.remove('sq-flash'); }, 1800);
        return;
      }
    }
  }

  screens.stats = function () {
    var tab = route.id || 'team', season = find(meta.seasons, meta.currentSeasonId) || {}, SS = window.SBStats;
    ui.lastStats = tab;
    var h = [pageHead(ui.sqOpen ? '' : 'Stats · ' + (season.name || ''), backBtn('#home', 'Home'), searchBox() + '<button class="btn sm" data-a="printStats">Print</button>')];
    h.push('<div class="stat-bar no-print"><div class="seg stat-tabs">' + STAT_TABS.map(function (t) {
      return '<button data-a="go" data-x="#stats/' + t[0] + '" class="' + (tab === t[0] ? 'on' : '') + '">' + t[1] + '</button>';
    }).join('') + '</div>' + filterSelect() + '</div>');
    if (tab === 'players') {
      var v = ui.statView || 'pergame';
      h.push('<div class="stat-bar sub no-print"><div class="seg stat-views">' + Object.keys(SS.VIEWS).map(function (k) {
        return '<button data-a="statView" data-x="' + k + '" class="' + (v === k ? 'on' : '') + '">' + SS.VIEWS[k] + '</button>';
      }).join('') + '</div><span class="stat-hint">Tap a column to sort · tap a player for their page</span></div>');
    }
    var S = statsData(), ctx = statsCtx(false), body;
    if (tab === 'players') body = SS.players(S, ctx, ui.statView || 'pergame');
    else body = (SS[tab] || SS.team)(S, ctx);
    h.push('<div class="sx-wrap">' + body + '</div>');
    if (ui.drawer === 'print') h.push(printPicker(null));
    return h.join('');
  };

  // ----- Player page -----
  screens.player = function () {
    var p = player(route.id) || findInGames(route.id);
    if (!p) return pageHead('Player not found', backBtn('#stats/players', 'Stats'), '');
    var ps = seasonPlayers(), i = -1;
    ps.forEach(function (x, k) { if (x.id === p.id) i = k; });
    var prev = i > 0 ? ps[i - 1] : null, next = i >= 0 && i < ps.length - 1 ? ps[i + 1] : null;
    var nav = (prev ? '<button class="btn sm" data-a="go" data-x="#player/' + prev.id + '">‹ ' + esc(jerseyOf(prev)) + '</button>' : '') +
      (next ? '<button class="btn sm" data-a="go" data-x="#player/' + next.id + '">' + esc(jerseyOf(next)) + ' ›</button>' : '') +
      searchBox() + '<button class="btn sm" data-a="printStats">Print</button>';
    var h = [pageHead(ui.sqOpen ? '' : pTag(p), backBtn('#stats/' + (ui.lastStats || 'players'), 'Stats'), nav)];
    h.push('<div class="stat-bar no-print"><span class="stat-hint">Tap a game to open its report</span>' + filterSelect() + '</div>');
    h.push('<div class="sx-wrap">' + window.SBStats.player(statsData(), statsCtx(false), p.id) + '</div>');
    if (ui.drawer === 'print') h.push(printPicker(p.id));
    return h.join('');
  };

  // Print: pick any of the stat sheets; each prints on its own page (wide tables in landscape).
  function printPicker(pid) {
    var sel = ui.printSel || {}, opts = [['team', 'Team summary'], ['players:pergame', 'Players · per game'], ['players:totals', 'Players · totals'],
      ['players:shooting', 'Players · shooting'], ['players:advanced', 'Players · advanced'], ['leaders', 'Leaders and highs'], ['lineups', 'Lineups'],
      ['games', 'Game log']];
    if (pid) opts.unshift(['player:' + pid, 'This player’s page']);
    opts.push(['allplayers', 'Every player’s page (one each)']);
    var h = '<p class="note" style="margin-top:0">Covering <b>' + esc(statFilterLabel()) + '</b>. Each sheet prints on its own page.</p><div class="print-pick">' +
      opts.map(function (o) {
        return '<button class="bp' + (sel[o[0]] ? ' on' : '') + '" data-a="printToggle" data-x="' + o[0] + '"><span class="num">' + (sel[o[0]] ? '✓' : '') + '</span><span>' + o[1] + '</span></button>';
      }).join('') + '</div>';
    var n = Object.keys(sel).filter(function (k) { return sel[k]; }).length;
    return sheet('Print stat sheets', h, '<button class="btn ghost" data-a="closeDrawer">Cancel</button><button class="btn pri" data-a="printGo"' + (n ? '' : ' disabled') + '>Print ' +
      (n ? n + ' sheet' + (n === 1 ? '' : 's') : '') + '</button>');
  }

  // ----- Schedule -----
  function seasonSchedule() {
    return meta.schedule.filter(function (x) { return x.seasonId === meta.currentSeasonId; })
      .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.time || '') < (b.time || '') ? -1 : 1; });
  }
  // Scheduled games not yet started (or whose game was deleted), from today on.
  function upcoming() {
    var t = today();
    return seasonSchedule().filter(function (x) { return x.date >= t && !(x.gameId && gameById(x.gameId)); });
  }

  // One schedule line. full = the Schedule screen (shows played results and a remove button).
  function schedRow(x, full) {
    var g = x.gameId && gameById(x.gameId), right;
    if (g) {
      var c = C.computeGame(g);
      right = g.status === 'final'
        ? '<button class="btn sm ghost" data-a="go" data-x="#report/' + g.id + '">' + (g.type === 'scrimmage' ? 'Scrimmage ' : c.score.us > c.score.them ? 'W ' : c.score.us < c.score.them ? 'L ' : 'T ') + c.score.us + '–' + c.score.them + '</button>'
        : '<button class="btn sm pri" data-a="go" data-x="#game/' + g.id + '">Resume ' + c.score.us + '–' + c.score.them + '</button>';
    } else {
      right = '<button class="btn sm pri" data-a="startScheduled" data-x="' + x.id + '">' + (x.type === 'scrimmage' ? 'Start scrimmage' : 'Start game') + '</button>';
    }
    var armed = ui.armed === 'sch' + x.id;
    return '<li class="sch-row"><span class="sch-when"><b>' + esc(R.fmtDate(x.date).replace(/, \d{4}$/, '')) + '</b><small>' + esc(weekday(x.date)) +
      (x.time ? ' · ' + esc(x.time) : '') + '</small></span><span class="op">' + (x.homeAway === 'away' ? '@ ' : 'vs ') + esc(x.opponent) +
      (x.type === 'scrimmage' ? ' <span class="tag-scrim">Scrimmage</span>' : '') + (x.location ? '<small>' + esc(x.location) + '</small>' : '') + '</span>' + right +
      (full ? '<button class="btn sm danger' + (armed ? ' armed' : '') + '" data-a="rmSched" data-x="' + x.id + '">' + (armed ? 'Confirm' : 'Remove') + '</button>' : '') + '</li>';
  }

  function weekday(isoDate) {
    var p = isoDate.split('-');
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(+p[0], +p[1] - 1, +p[2]).getDay()];
  }

  // First year of the current season ("2026–27" → 2026), for dates written without a year.
  function seasonStartYear() {
    var s = find(meta.seasons, meta.currentSeasonId), y = s && parseInt(s.name, 10);
    if (y > 1900) return y;
    var d = new Date();
    return d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1;
  }

  screens.schedule = function () {
    var season = find(meta.seasons, meta.currentSeasonId), list = seasonSchedule(), pv = ui.schedPreview;
    var h = [pageHead('Schedule · ' + season.name, backBtn('#home', 'Home'), '')];
    h.push('<div class="pg-bd">');
    if (pv) {
      h.push('<h2>Check before adding · ' + pv.rows.length + ' game' + (pv.rows.length === 1 ? '' : 's') + ' found</h2>');
      if (pv.rows.length) {
        h.push('<div class="tw"><table class="st"><thead><tr><th class="l">Date</th><th class="l">Time</th><th class="l">Opponent</th><th class="l">Location</th></tr></thead><tbody>' +
          pv.rows.map(function (x) {
            return '<tr><td class="l">' + esc(weekday(x.date) + ' ' + R.fmtDate(x.date)) + '</td><td class="l">' + esc(x.time) + '</td><td class="l nm">' +
              (x.homeAway === 'away' ? '@ ' : 'vs ') + esc(x.opponent) + '</td><td class="l">' + esc(x.location) + '</td></tr>';
          }).join('') + '</tbody></table></div>');
      }
      if (pv.dupes) h.push('<p class="note">' + pv.dupes + ' already on the schedule and will be skipped.</p>');
      if (pv.bad.length) {
        h.push('<p class="note"><b>Couldn’t read ' + pv.bad.length + ' line' + (pv.bad.length === 1 ? '' : 's') + '</b> (no date or opponent found):</p><ul class="bad-lines">' +
          pv.bad.slice(0, 8).map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + (pv.bad.length > 8 ? '<li>…</li>' : '') + '</ul>');
      }
      h.push('<div class="form">' + (pv.rows.length ? '<button class="btn pri" data-a="schedAdd">Add ' + pv.rows.length + ' game' + (pv.rows.length === 1 ? '' : 's') + '</button>' : '') +
        '<button class="btn ghost" data-a="schedCancel">Cancel</button></div>');
    }
    h.push('<h2>' + list.length + ' scheduled game' + (list.length === 1 ? '' : 's') + '</h2>');
    if (!list.length) h.push('<p class="note">Nothing scheduled yet. Upcoming games show on the home screen with a Start game button.</p>');
    else h.push('<ul class="games sched">' + list.map(function (x) { return schedRow(x, true); }).join('') + '</ul>');
    // Adding games lives in a section at the bottom that opens on demand (open when the schedule is empty).
    var open = !pv && (ui.schedOpen === undefined ? !list.length : ui.schedOpen);
    if (!pv) {
      h.push('<div class="add-area' + (open ? ' open' : '') + '"><button class="add-toggle" data-a="schedToggle"><span class="pm">' + (open ? '−' : '+') + '</span>' +
        '<b>Add games</b><small>Upload a CSV, paste a schedule, or add one game</small></button>');
      if (open) {
        h.push('<div class="add-body">');
        h.push('<h3 class="add-hd">Upload or paste a schedule</h3><p class="note">Upload a spreadsheet saved as CSV (Google Sheets: File → Download → CSV; Excel: Save As → CSV), ' +
            'or paste the schedule below, one game per line. Columns can be in any order: date, opponent, home/away, location, time. ' +
            'Lines like “Tue Dec 2 @ Trinity 4:30 PM” or “12/5 vs Riverdale” work too.</p>' +
            '<div class="form"><label class="btn" for="sch-file">Upload a file…</label><input id="sch-file" type="file" accept=".csv,.txt,.tsv,text/csv,text/plain" class="sr" data-schedfile="1"></div>' +
            '<div class="fld" style="margin-top:0.75rem"><label for="sch-text">Or paste it here</label><textarea id="sch-text" rows="6" data-schedtext="1" placeholder="Tue Dec 2 @ Trinity 4:30 PM&#10;Fri Dec 5 vs Riverdale 6:00 PM&#10;1/9/27, Collegiate, Away, Collegiate Gym">' +
            esc(ui.schedText || '') + '</textarea></div><div class="form"><button class="btn pri" data-a="schedRead">Read schedule</button></div>');
        h.push('<h3 class="add-hd">Add one game</h3><form class="form" data-form="addSched">' +
            '<div class="fld xs" style="flex-basis:11rem"><label for="sa-date">Date</label><input id="sa-date" name="date" type="date" required></div>' +
            '<div class="fld xs" style="flex-basis:8rem"><label for="sa-time">Time</label><input id="sa-time" name="time" placeholder="4:30 PM" autocomplete="off"></div>' +
            '<div class="fld"><label for="sa-opp">Opponent</label><input id="sa-opp" name="opponent" required autocomplete="off"></div>' +
            '<div class="fld xs" style="flex-basis:9rem"><label for="sa-side">Side</label><select id="sa-side" name="homeAway"><option value="home">Home</option><option value="away">Away</option></select></div>' +
            '<div class="fld"><label for="sa-loc">Location</label><input id="sa-loc" name="location" autocomplete="off"></div>' +
            '<div class="fld xs"><span class="lab">&nbsp;</span><button class="btn pri" type="submit">Add</button></div></form>');
        h.push('</div>');
      }
      h.push('</div>');
    }
    h.push('</div>');
    return h.join('');
  };


  function readSchedule(text) {
    var res = window.SBSchedule.parse(text, seasonStartYear()), have = {};
    seasonSchedule().forEach(function (x) { have[x.date + '|' + x.opponent.toLowerCase()] = true; });
    var fresh = res.rows.filter(function (x) { return !have[x.date + '|' + x.opponent.toLowerCase()]; });
    ui.schedPreview = { rows: fresh, bad: res.bad, dupes: res.rows.length - fresh.length };
    render();
    window.scrollTo(0, 0);
  }

  // ----- Roster -----
  screens.roster = function () {
    var ps = seasonPlayers(), season = find(meta.seasons, meta.currentSeasonId);
    var h = [pageHead('Roster · ' + season.name, backBtn('#home', 'Home'), '')];
    h.push('<div class="pg-bd">');
    h.push('<h2>' + ps.length + ' player' + (ps.length === 1 ? '' : 's') + '</h2>');
    if (!ps.length) h.push('<p class="note">No players yet. Add each player once below. Names can be hidden on shared reports in Settings.</p>');
    h.push('<ul class="roster">');
    ps.forEach(function (p) {
      h.push('<li><input class="rn" value="' + esc(p.num) + '" placeholder="–" maxlength="2" inputmode="numeric" data-edit="num" data-x="' + p.id + '" aria-label="Jersey">' +
        '<input class="rf" value="' + esc(p.first) + '" data-edit="first" data-x="' + p.id + '" aria-label="First name">' +
        '<input class="rl" value="' + esc(p.last) + '" data-edit="last" data-x="' + p.id + '" aria-label="Last name">' +
        '<button class="btn sm danger' + (ui.armed === 'rm' + p.id ? ' armed' : '') + '" data-a="rmPlayer" data-x="' + p.id + '">' +
        (ui.armed === 'rm' + p.id ? 'Confirm remove' : 'Remove') + '</button></li>');
    });
    h.push('</ul>');
    // Adding players lives in a section at the bottom that opens on demand (open when the roster is empty).
    var open = ui.rosterOpen === undefined ? !ps.length : ui.rosterOpen;
    h.push('<div class="add-area' + (open ? ' open' : '') + '"><button class="add-toggle" data-a="rosterToggle"><span class="pm">' + (open ? '−' : '+') + '</span>' +
      '<b>Add players</b><small>One at a time' + (ps.length ? '' : ', or copy last season’s roster') + '</small></button>');
    if (open) {
      h.push('<div class="add-body"><h3 class="add-hd">Add a player</h3><form class="form" data-form="addPlayer">' +
        '<div class="fld xs"><label for="np-num">Jersey</label><input id="np-num" name="num" inputmode="numeric" maxlength="2" autocomplete="off" placeholder="later"></div>' +
        '<div class="fld"><label for="np-first">First name</label><input id="np-first" name="first" autocomplete="off" required></div>' +
        '<div class="fld"><label for="np-last">Last name</label><input id="np-last" name="last" autocomplete="off"></div>' +
        '<div class="fld xs"><span class="lab">&nbsp;</span><button class="btn pri" type="submit">Add</button></div></form>' +
        '<p class="note">No jerseys yet? Leave Jersey blank: the player shows with their initials until you type the number in above, and games already played pick it up too.</p>');
      var prev = meta.seasons.filter(function (x) { return x.id !== meta.currentSeasonId; });
      if (!ps.length && prev.length) h.push('<div class="form"><button class="btn" data-a="copyRoster">Copy roster from ' + esc(prev[prev.length - 1].name) + '</button></div>');
      h.push('</div>');
    }
    h.push('</div></div>');
    return h.join('');
  };

  // ----- New game -----
  var draft = null;

  // Jersey numbers this opponent used in earlier games this season (scrimmages too), so a rematch
  // starts with their column ready: { nums: '1 3 7', games: 2 }, or null if we haven't played them.
  function oppKey(name) { return (name || '').trim().toLowerCase(); }

  function pastOppNums(name) {
    var key = oppKey(name), seen = {}, nums = [], n = 0, shown = '';
    if (!key) return null;
    seasonGames().forEach(function (g) {
      if (oppKey(g.opponent) !== key) return;
      n++; shown = shown || g.opponent.trim();
      (g.oppNums || []).concat((g.events || []).filter(function (e) { return e.tm === 'them' && e.p; }).map(function (e) { return e.p; }))
        .forEach(function (x) { if (!seen[x]) { seen[x] = true; nums.push(x); } });
    });
    if (!nums.length) return null;
    nums.sort(function (a, b) { return R.byJersey({ num: a }, { num: b }); });
    return { nums: nums.join(' '), games: n, name: shown };
  }

  // Fills in their numbers when the opponent is one we've played. Numbers you typed yourself are
  // kept; a filled-in list you edited is kept for that opponent but replaced if you change the opponent.
  // Returns the note to show under the field ('' when nothing was filled in).
  function autofillOpp() {
    var key = oppKey(draft.opponent), e = draft.oppEdited;
    if (e && (!e.fromAuto || e.key === key)) return e.fromAuto ? draft.oppNote || '' : '';
    draft.oppEdited = null;
    var past = pastOppNums(draft.opponent);
    draft.oppNumsText = past ? past.nums : '';
    draft.oppAuto = draft.oppNumsText;
    return draft.oppNote = past ? 'Filled in from ' + (past.games === 1 ? 'the earlier game' : past.games + ' earlier games') + ' vs ' + past.name +
      ' this season. Remove anyone who isn’t playing; new numbers can be added during the game.' : '';
  }
  screens['new'] = function () {
    var ps = seasonPlayers();
    if (!draft) draft = { opponent: '', date: today(), location: '', homeAway: 'home', starters: [] };
    var oppNote = autofillOpp();
    var h = [pageHead('New game', backBtn('#home', 'Home'),
      '<button class="btn pri" data-a="startGame"' + (ps.length ? '' : ' disabled') + '>' + (draft.type === 'scrimmage' ? 'Start scrimmage' : 'Start game') + '</button>')];
    h.push('<div class="pg-bd">');
    if (!ps.length) {
      h.push('<div class="empty-state">Your roster is empty.<br><button class="btn pri" data-a="go" data-x="#roster">Add players</button></div></div>');
      return h.join('');
    }
    h.push('<h2>Game</h2><div class="form">');
    h.push('<div class="fld xs" style="flex-basis:16rem"><span class="lab">Type</span><div class="seg">' +
      '<button data-a="draftType" data-x="game" class="' + (draft.type !== 'scrimmage' ? 'on' : '') + '">Game</button>' +
      '<button data-a="draftType" data-x="scrimmage" class="' + (draft.type === 'scrimmage' ? 'on' : '') + '">Scrimmage</button></div></div>');
    h.push('<div class="fld"><label for="ng-opp">Opponent</label><input id="ng-opp" list="opps" data-draft="opponent" value="' + esc(draft.opponent) + '" autocomplete="off" placeholder="e.g. Riverdale">' +
      '<datalist id="opps">' + meta.opponents.map(function (o) { return '<option value="' + esc(o.name) + '">'; }).join('') + '</datalist></div>');
    h.push('<div class="fld xs" style="flex-basis:11rem"><label for="ng-date">Date</label><input id="ng-date" type="date" data-draft="date" value="' + esc(draft.date) + '"></div>');
    h.push('<div class="fld"><label for="ng-loc">Location</label><input id="ng-loc" data-draft="location" value="' + esc(draft.location) + '" placeholder="Gym"></div>');
    h.push('<div class="fld xs" style="flex-basis:12rem"><span class="lab">Side</span><div class="seg">' +
      '<button data-a="draftSide" data-x="home" class="' + (draft.homeAway === 'home' ? 'on' : '') + '">Home</button>' +
      '<button data-a="draftSide" data-x="away" class="' + (draft.homeAway === 'away' ? 'on' : '') + '">Away</button></div></div>');
    h.push('<div class="fld" style="flex-basis:100%"><label for="ng-nums">Their jersey numbers (optional)</label><input id="ng-nums" data-draft="oppNumsText" value="' +
      esc(draft.oppNumsText || '') + '" placeholder="e.g. 1 3 7 13 20 32" autocomplete="off"></div>');
    h.push('</div><p class="note" id="ng-nums-note">' + (oppNote || 'Entering their numbers now sets up their column before tip-off. You can still add numbers during the game.') + '</p>');
    h.push('<h2>Starters · ' + draft.starters.length + ' of 5</h2><div class="pick">');
    ps.forEach(function (p) {
      var on = draft.starters.indexOf(p.id) >= 0;
      h.push('<button class="bp' + (on ? ' on' : '') + '" data-a="draftStarter" data-x="' + p.id + '"><span class="num">' + esc(jerseyOf(p)) +
        '</span><span>' + esc(shortName(p)) + '</span></button>');
    });
    h.push('</div>');
    var noNum = ps.filter(function (p) { return !p.num; }).length;
    if (noNum) h.push('<p class="note">' + (noNum === 1 ? '1 player doesn’t' : noNum + ' players don’t') + ' have a jersey number yet, so they show with initials. Add numbers in Roster whenever you have them; this game updates too.</p>');
    if (draft.type === 'scrimmage') {
      // Quick setup: the usual choices up front, everything else under More options.
      var sr = draft.rules;
      h.push('<h2>Scrimmage setup</h2><div class="form rules"><div class="fld xs" style="flex-basis:20rem"><span class="lab">Quarters</span><div class="seg">' +
        [4, 5, 6, 8].map(function (n) { return '<button data-a="draftPeriods" data-x="' + n + '" class="' + (sr.periods === n ? 'on' : '') + '">' + n + '</button>'; }).join('') +
        '</div></div><div class="fld xs" style="flex-basis:9.5rem"><label for="sq-min">Minutes each</label><input id="sq-min" type="number" min="0" inputmode="numeric" data-drule="periodMinutes" value="' +
        sr.periodMinutes + '"></div></div>');
      h.push('<p class="note">' + rulesSummary(sr) + '. Doesn’t count toward the season record or stats. You can add quarters during the scrimmage.</p>');
      h.push(ui.moreRules ? rulesForm(sr, 'data-drule') : '<button class="btn sm ghost" data-a="moreRules">More options</button>');
      h.push('</div>');
      return h.join('');
    }
    h.push('<h2>Rules</h2>');
    if (draft.rules) {
      h.push(rulesForm(draft.rules, 'data-drule') + '<p class="note">These apply to this game only. ' +
        '<button class="btn sm ghost" data-a="draftRules" data-x="off">Use the usual rules</button></p>');
    } else {
      h.push('<p class="note">' + rulesSummary(C.copyRules(meta.settings.rules)) + '</p>' +
        '<button class="btn sm" data-a="draftRules" data-x="on">Change rules for this game</button>');
    }
    h.push('</div>');
    return h.join('');
  };

  // ----- Live game -----
  screens.game = function () {
    var g = gameById(route.id), c = C.computeGame(g), r = c.rules, wide = ui.wide;
    var h = ['<div class="lv' + (wide ? ' wide' : '') + '">'];
    h.push('<header class="lv-top">');
    h.push('<button class="lv-home" data-a="go" data-x="#home"><span class="ic">☰</span>Games</button>');
    if (fsAvailable()) h.push('<button class="lv-fs" data-a="fullscreen"><span class="fs-ic"></span>' + (fsActive() ? 'Exit' : 'Full') + '</button>');
    h.push(teamBlock('us', meta.team.name, c));
    // When each period is scored on its own, its score sits under the period; the big scores stay game totals.
    h.push('<button class="lv-q" data-a="drawer" data-x="quarter"><span class="num">' + C.periodLabel(g.quarter, r) + '</span><small>' +
      (r.scoreResets ? (r.periods === 2 ? 'HALF ' : 'QTR ') + (c.byPeriod.us[g.quarter - 1] || 0) + '–' + (c.byPeriod.them[g.quarter - 1] || 0) : 'PERIOD') + '</small></button>');
    h.push(teamBlock('them', g.opponent, c));
    h.push('<button class="lv-undo" data-a="undo"' + (g.events.length ? '' : ' disabled') + '><span class="ic">↶</span>Undo</button>');
    h.push('</header>');

    h.push('<main class="lv-main"><section class="lv-left">');
    if (wide) {
      // Both teams at once: tapping a player on either side switches the pad to that team.
      // The header buttons switch it without picking anyone (e.g. a team foul with no number).
      h.push('<div class="col us' + (ui.side === 'us' ? ' on' : '') + '"><button class="col-hd" data-a="side" data-x="us">' + esc(meta.team.name) +
        '</button>' + ourCards(g, c) + '</div>');
      h.push('<div class="col them' + (ui.side === 'them' ? ' on' : '') + '"><button class="col-hd" data-a="side" data-x="them">' + esc(g.opponent) +
        '</button>' + oppRows(g, c) + '</div>');
    } else {
      h.push('<div class="tabs"><button data-a="side" data-x="us" class="' + (ui.side === 'us' ? 'on' : '') + '">' + esc(meta.team.name) +
        '</button><button data-a="side" data-x="them" class="' + (ui.side === 'them' ? 'on' : '') + '">' + esc(g.opponent) + '</button></div>');
      h.push(ui.side === 'us' ? ourCards(g, c) : oppChips(g, c));
    }
    h.push('</section><section class="lv-pad">');
    h.push(padHead(g, c));
    h.push(ui.side === 'us' ? ourPad() : oppPad());
    h.push('</section></main>');

    var last = g.events[g.events.length - 1];
    h.push('<footer class="lv-bot"><button class="btn" data-a="drawer" data-x="bench">Subs</button>' +
      '<button class="btn" data-a="drawer" data-x="log">Play log</button>' +
      (ui.timer && ui.timer.game === g.id ? timerChip(g) :
        '<div class="last">' + (last ? 'Last: <b>' + esc(describe(last, g)) + '</b>' : 'Tap a player, then what they did.') + '</div>') +
      '<button class="btn" data-a="go" data-x="#report/' + g.id + '">Box score</button></footer>');
    h.push('</div>');
    if (ui.drawer) h.push(drawer(g, c));
    return h.join('');
  };

  // Scrimmage rules (no bonus, unlimited timeouts) keep the same look as a real game, so a
  // scrimmage doubles as practice: 5 team-foul boxes and the usual pips, just never limiting.
  function teamBlock(tm, name, c) {
    var fouls = c.currentFouls[tm], r = c.rules, left = c.timeoutsLeft[tm], h = [], i;
    var nBox = r.bonusAt > 0 ? r.bonusAt : 5;
    var boxes = '<span class="boxes">';
    for (i = 0; i < nBox; i++) boxes += '<span class="box' + (i < fouls ? ' on' : '') + '"></span>';
    boxes += '</span>' + (fouls > nBox ? '<span>+' + (fouls - nBox) + '</span>' : '');
    var full = left.full, short = left.short;
    if (r.timeoutsUnlimited) {
      full = Math.max(0, c.timeoutsAllot.full - c.timeoutsUsed[tm].full);
      short = Math.max(0, c.timeoutsAllot.short - c.timeoutsUsed[tm].short);
    }
    var pips = '<span class="pips">';
    for (i = 0; i < c.timeoutsAllot.full; i++) pips += '<span class="pip' + (i < full ? ' on' : '') + '"></span>';
    for (i = 0; i < c.timeoutsAllot.short; i++) pips += '<span class="pip s' + (i < short ? ' on' : '') + '"></span>';
    var to = 'TO ' + pips + '</span><span>' + (r.timeoutsUnlimited ? '∞' : full + '+' + short) + '</span>';
    // Head coach's technicals at a glance: "HC 1T", "HC 1+1T" (direct + from the bench), "HC OUT".
    var cs = C.coachStatus(c.staff[tm], r), hc = '';
    if (cs.total) hc = ' <span class="tag-coach' + (cs.out ? ' out' : cs.next ? ' warn' : '') + '">' +
      (cs.out ? 'HC OUT' : 'HC ' + cs.direct + (cs.indirect ? '+' + cs.indirect : '') + 'T') + '</span>';
    h.push('<div class="tm ' + tm + '"><span class="tm-score">' + c.score[tm] + '</span><div class="tm-info">');
    h.push('<span class="tm-name">' + esc(name) + hc + '</span>');
    // Shown on the team that shoots: BONUS once the other side reaches the bonus foul,
    // "1 TO BONUS" when their next foul gets there.
    var bonus = c.inDoubleBonus[tm] ? '<span class="bonus">DOUBLE BONUS</span>' : c.inBonus[tm] ? '<span class="bonus">BONUS</span>' :
      c.shooting[tm] ? '<span class="bonus next">1 TO BONUS</span>' : '';
    h.push('<span class="tm-row"><span>FOULS ' + fouls + '</span>' + boxes + bonus + '</span>');
    h.push('<button class="tm-to" data-a="drawer" data-x="to-' + tm + '">' + to + '</button>');
    h.push('</div></div>');
    return h.join('');
  }

  // With no foul-out limit (scrimmages) the usual 5 boxes still show, with "+2" past five.
  function foulBoxes(pf, rules, tf) {
    var n = rules.foulOut > 0 ? rules.foulOut : 5, s = '<span class="boxes">';
    for (var i = 0; i < n; i++) s += '<span class="box' + (i < pf ? ' on' : '') + '"></span>';
    return s + '</span>' + (pf > n ? '<span class="pf-over num">+' + (pf - n) + '</span>' : '') + (tf ? '<span class="tag-t">' + tf + 'T</span>' : '');
  }

  function outTag(l, rules) {
    var why = C.outReason(l, rules);
    return why ? '<span class="tag-out">' + (why === 'ejected' ? 'EJECTED' : 'FOULED OUT') + '</span><br>' : '';
  }

  // One message for everything a foul changed, so warnings never replace each other.
  function foulNotice(name, l, rules, wasTech, ours) {
    var why = C.outReason(l, rules), sub = ours ? ' Make a sub.' : '';
    if (why === 'ejected') return name + ' is ejected (' + l.tf + ' technicals).' + sub;
    if (why === 'fouled') return name + ' has fouled out.' + sub;
    var out = [];
    if (wasTech && rules.techOut > 1 && l.tf === rules.techOut - 1) out.push(name + ' has ' + l.tf + ' technical' + (l.tf > 1 ? 's' : '') + '. One more is an ejection.');
    if (l.pf === rules.foulOut - 1) out.push(name + ' has ' + l.pf + ' fouls.');
    return out.join(' ');
  }

  function ourCards(g, c) {
    var h = ['<div class="cards">'], i;
    for (i = 0; i < 5; i++) {
      var id = g.onCourt[i];
      if (!id) { h.push('<button class="card empty" data-a="drawer" data-x="bench">+ Put a player in</button>'); continue; }
      var p = player(id) || R.findPlayer(g, meta, id) || { num: '?', first: '?' };
      var l = c.players[id] || C.emptyLine(), st = C.foulState(l.pf, c.rules, l.tf);
      var cls = 'card' + (ui.sel === id ? ' sel' : '') + (st === 'warn' ? ' warn' : '') + (st === 'out' ? ' out' : '') +
        (ui.flash === id ? ' hit' : '');
      h.push('<button class="' + cls + '" data-a="pick" data-x="' + id + '"' + (ui.flash === id ? ' data-flash="1"' : '') + '>' +
        '<span class="jr">' + esc(jerseyOf(p)) + '</span><span class="nm"><b>' + esc(shortName(p)) + '</b><small>FG ' + l.fgm + '/' + l.fga +
        ' · 3P ' + l.tpm + '/' + l.tpa + ' · FT ' + l.ftm + '/' + l.fta + ' · REB ' + (l.oreb + l.dreb) + '</small></span>' +
        '<span class="' + (st === 'warn' ? 'warn' : st === 'out' ? 'out' : '') + '">' + outTag(l, c.rules) +
        foulBoxes(l.pf, c.rules, l.tf) + '</span><span class="pts">' + l.pts + '<small>PTS</small></span></button>');
    }
    h.push('</div>');
    return h.join('');
  }

  // Wide layout: the opponent as one row per number, shaped like our player cards
  // (jersey | fouls and made shots | points). We only record their makes, so no attempts.
  // Rows shrink to fit the column; past 8 numbers they switch to a slim single line so about
  // 12 fit without scrolling.
  function oppRows(g, c) {
    var nums = (g.oppNums || []).slice().sort(function (a, b) { return R.byJersey({ num: a }, { num: b }); });
    var h = ['<div class="opp-rows' + (nums.length > 8 ? ' dense' : '') + '">'];
    nums.forEach(function (n) {
      var l = c.opp[n] || C.emptyLine(), st = C.foulState(l.pf, c.rules, l.tf);
      var cls = 'card' + (ui.side === 'them' && ui.oppSel === n ? ' osel' : '') + (st === 'warn' ? ' warn' : '') + (st === 'out' ? ' out' : '');
      h.push('<button class="' + cls + '" data-a="oppPick" data-x="' + esc(n) + '"><span class="jr">' + esc(n) + '</span>' +
        '<span class="nm"><span class="' + (st === 'warn' ? 'warn' : st === 'out' ? 'out' : '') + '">' + outTag(l, c.rules) +
        foulBoxes(l.pf, c.rules, l.tf) + '</span><small>FG ' + l.fgm + ' · 3P ' + l.tpm + ' · FT ' + l.ftm + '</small></span>' +
        '<span class="pts">' + l.pts + '<small>PTS</small></span></button>');
    });
    var tl = c.opp[''] || C.emptyLine();
    h.push('<button class="card fixed' + (ui.side === 'them' && ui.oppSel === null ? ' osel' : '') + '" data-a="oppPick" data-x="">' +
      '<span class="jr">–</span><span class="nm"><b>Team</b><small>no number</small></span><span class="pts">' + tl.pts + '<small>PTS</small></span></button>');
    h.push('<button class="card empty fixed" data-a="drawer" data-x="keypad">+ Add a number</button>');
    h.push('</div>');
    return h.join('');
  }

  function oppChips(g, c) {
    var nums = (g.oppNums || []).slice().sort(function (a, b) { return R.byJersey({ num: a }, { num: b }); });
    var h = ['<div class="opp">'];
    nums.forEach(function (n) {
      var l = c.opp[n] || C.emptyLine(), st = C.foulState(l.pf, c.rules, l.tf);
      h.push('<button class="chip' + (ui.oppSel === n ? ' sel' : '') + (st === 'out' ? ' out' : '') + '" data-a="oppPick" data-x="' + esc(n) + '">' +
        '<span class="num">' + esc(n) + '</span><small>' + l.pts + ' pts</small><span class="' + (st === 'warn' ? 'warn' : st === 'out' ? 'out' : '') + '">' +
        foulBoxes(l.pf, c.rules, l.tf) + '</span></button>');
    });
    var tl = c.opp[''] || C.emptyLine();
    h.push('<button class="chip team' + (ui.oppSel === null && ui.side === 'them' ? ' sel' : '') + '" data-a="oppPick" data-x=""><span class="num">TEAM</span><small>' + tl.pts + ' pts</small><small>no number</small></button>');
    h.push('<button class="chip add" data-a="drawer" data-x="keypad">+ Number</button>');
    h.push('</div>');
    return h.join('');
  }

  function padHead(g, c) {
    // Scrimmage: was that +1 a real free throw, or the point(s) for being fouled on a shot?
    if (ui.prompt && ui.prompt.k === 'ft') {
      var s = ui.prompt.s, txt = 'style="font-family:var(--f-body);font-size:.85rem"';
      return '<div class="pad-head ask"><span class="lbl">Free throw?</span>' +
        '<button class="qk" data-a="promptSkip" ' + txt + '>Free throw</button>' +
        '<button class="qk" data-a="ftConvert" data-x="' + s + ':1" ' + txt + '>Point only</button>' +
        '<button class="qk" data-a="ftConvert" data-x="' + s + ':2" ' + txt + '>2 points</button></div>';
    }
    if (ui.prompt) {
      var pr = ui.prompt, others = g.onCourt.filter(function (id) { return id && id !== pr.p; });
      var label = pr.k === 'ast' ? 'Assist?' : 'Rebound?';
      var list = pr.k === 'ast' ? others : g.onCourt.filter(function (id) { return id; });
      var h = ['<div class="pad-head ask"><span class="lbl">' + label + '</span>'];
      list.forEach(function (id) {
        var p = player(id) || {};
        h.push('<button class="qk" data-a="promptPick" data-x="' + id + '">' + esc(jerseyOf(p)) + '</button>');
      });
      if (pr.k === 'reb') h.push('<button class="qk" data-a="promptPick" data-x="them" style="font-family:var(--f-body);font-size:.8rem">Theirs</button>');
      h.push('<button class="qk no" data-a="promptSkip">' + (pr.k === 'ast' ? 'No assist' : 'Skip') + '</button></div>');
      return h.join('');
    }
    if (ui.msg) return '<div class="pad-head msg"><span class="lbl">' + esc(ui.msg) + '</span></div>';
    if (ui.side === 'us') {
      var p = ui.sel ? player(ui.sel) : null;
      return '<div class="pad-head"><span class="lbl">' + (p ? esc(pTag(p)) + ' <em>— what happened?</em>'
        : '<em>Tap a player, then what they did · TECH now = coach or bench technical</em>') + '</span></div>';
    }
    return '<div class="pad-head"><span class="lbl">' + esc(g.opponent) + ' ' + (ui.oppSel ? '#' + esc(ui.oppSel) + ' <em>— what happened?</em>'
      : '<em>team (no number) — what happened? · TECH = coach or bench technical</em>') + '</span></div>';
  }

  function key(a, x, big, small, cls) {
    return '<button class="k ' + (cls || '') + '" data-a="' + a + '" data-x="' + x + '"><b>' + big + '</b><small>' + small + '</small></button>';
  }

  function ourPad() {
    return '<div class="pad">' +
      key('act', 'make:2', '+2', 'Made 2', 'make') + key('act', 'make:3', '+3', 'Made 3', 'make') +
      key('act', 'make:1', '+1', 'Made FT', 'make') + key('act', 'ast:', 'AST', 'Assist', 'stat') +
      key('act', 'miss:2', '×2', 'Missed 2', 'miss') + key('act', 'miss:3', '×3', 'Missed 3', 'miss') +
      key('act', 'miss:1', '×1', 'Missed FT', 'miss') + key('act', 'stl:', 'STL', 'Steal', 'stat') +
      key('act', 'reb:o', 'OREB', 'Off. rebound', 'stat') + key('act', 'reb:d', 'DREB', 'Def. rebound', 'stat') +
      key('act', 'blk:', 'BLK', 'Block', 'stat') + key('act', 'to:', 'TO', 'Turnover', 'stat') +
      key('act', 'foul:p', 'FOUL', 'Personal foul', 'foul') + key('act', 'foul:t', 'TECH', 'Technical', 'foul') +
      key('act', 'chg:', 'CHG', 'Took a charge', 'stat') + key('subKey', '', 'SUB', 'Substitute', 'stat') +
      '</div>';
  }

  function oppPad() {
    return '<div class="pad">' +
      key('oppAct', 'make:2', '+2', 'Made 2', 'make') + key('oppAct', 'make:3', '+3', 'Made 3', 'make') +
      key('oppAct', 'make:1', '+1', 'Made FT', 'make') + key('drawer', 'keypad', '#', 'New number', 'stat') +
      key('oppAct', 'foul:p', 'FOUL', 'Personal foul', 'foul wide') + key('oppAct', 'foul:t', 'TECH', 'Technical', 'foul') +
      key('side', 'us', '‹', 'Back to ' + esc(meta.team.short || 'us'), 'stat') +
      '</div>';
  }

  // ----- Drawers -----
  function sheet(title, body, foot, small) {
    return '<div class="scrim" data-a="closeDrawer" data-self="1"><div class="sheet' + (small ? ' sm' : '') + '">' +
      '<div class="sheet-hd"><h3>' + esc(title) + '</h3><button class="btn sm ghost" data-a="closeDrawer">Close</button></div>' +
      '<div class="sheet-bd">' + body + '</div>' + (foot ? '<div class="sheet-ft">' + foot + '</div>' : '') + '</div></div>';
  }

  function drawer(g, c) {
    var d = ui.drawer, r = c.rules, h;
    if (d === 'to-us' || d === 'to-them') {
      var tm = d.slice(3), left = c.timeoutsLeft[tm], name = tm === 'us' ? meta.team.name : g.opponent, unl = r.timeoutsUnlimited;
      h = '<div class="stack">' +
        '<button class="btn pri" data-a="timeout" data-x="' + tm + ':full"' + (left.full ? '' : ' disabled') + '>Full timeout' + (unl ? '' : ' <small>' + left.full + ' left</small>') + '</button>' +
        '<button class="btn" data-a="timeout" data-x="' + tm + ':short"' + (left.short ? '' : ' disabled') + '>30-second timeout' + (unl ? '' : ' <small>' + left.short + ' left</small>') + '</button></div>';
      return sheet(name + ' timeout · ' + C.periodLabel(g.quarter, r), h, '', true);
    }
    if (d === 'quarter') {
      var q = g.quarter, inReg = q < r.periods;
      h = '<div class="stack">';
      if (r.openEnded) {
        // Scrimmage-style: keep adding periods, end whenever the coach is done.
        var w = c.periodsWon, wn = (r.periods === 2 ? 'halves' : 'quarters') + ' won ' + w.us + '–' + w.them + (w.tied ? ' (' + w.tied + ' tied)' : '');
        h += '<button class="btn' + (inReg ? ' pri' : '') + '" data-a="setQ" data-x="' + (q + 1) + '">End ' + C.periodLabel(q, r) + ' · start ' + C.periodLabel(q + 1, r) +
          (inReg ? '' : '<small>add another</small>') + '</button>';
        h += '<button class="btn' + (inReg ? ' ghost' : ' pri') + '" data-a="endGame">End ' + (g.type === 'scrimmage' ? 'scrimmage' : 'game') + ' — final<small>' +
          (r.scoreResets ? wn + ' · total ' : '') + c.score.us + '–' + c.score.them + '</small></button>';
        inReg = false;
      } else if (inReg) h += '<button class="btn pri" data-a="setQ" data-x="' + (q + 1) + '">End ' + C.periodLabel(q, r) + ' · start ' + C.periodLabel(q + 1, r) + '</button>';
      else {
        var tied = c.score.us === c.score.them;
        h += '<button class="btn' + (tied ? '' : ' pri') + '" data-a="endGame">End game — final<small>' + c.score.us + '–' + c.score.them + '</small></button>';
        h += '<button class="btn' + (tied ? ' pri' : '') + '" data-a="setQ" data-x="' + (q + 1) + '">Start ' + C.periodLabel(q + 1, r) + '<small>' + r.otMinutes + ' min · +' + r.otTimeoutsFull + ' timeout</small></button>';
      }
      if (q > 1) h += '<button class="btn ghost" data-a="setQ" data-x="' + (q - 1) + '">Go back to ' + C.periodLabel(q - 1, r) + '<small>fix a mistake</small></button>';
      if (inReg) h += '<button class="btn ghost" data-a="endGame">End game early<small>' + c.score.us + '–' + c.score.them + '</small></button>';
      h += '<button class="btn ghost" data-a="drawer" data-x="rules">Rules for this game<small>timeouts, fouls, periods</small></button>';
      h += '</div>';
      return sheet('Period · now ' + C.periodLabel(q, r), h, '', true);
    }
    if (d === 'bench' || d === 'replace') {
      var court = g.onCourt.filter(Boolean), bench = seasonPlayers().filter(function (p) { return court.indexOf(p.id) < 0; });
      var pend = ui.pendSub;
      var benchBtn = function (p, action) {
        var on = court.indexOf(p.id) >= 0, l = c.players[p.id] || C.emptyLine(), why = C.outReason(l, r);
        return '<button class="bp' + (on ? ' on' : '') + (why ? ' out' : '') + (pend && pend.id === p.id ? ' pend' : '') + '" data-a="' + action + '" data-x="' + p.id + '"' +
          (!on && why ? ' disabled' : '') + '><span class="num">' + esc(jerseyOf(p)) + '</span><span>' + esc(shortName(p)) + '<small>' + l.pts + ' pts · ' + l.pf + ' PF' +
          (l.tf ? ' · ' + l.tf + 'T' : '') + (why ? (why === 'ejected' ? ' · EJECTED' : ' · OUT') : '') + '</small></span></button>';
      };
      if (d === 'replace') {
        h = '<div class="bench">' + bench.map(function (p) { return benchBtn(p, 'replaceWith'); }).join('') + '</div>';
        return sheet('Who’s coming in for ' + subName(ui.subOut) + '?', h,
          '<button class="btn ghost" data-a="drawer" data-x="bench">Other subs</button><button class="btn" data-a="closeDrawer">Cancel</button>');
      }
      // A draft of the next lineup: tap anyone in or out, in any order; nothing changes until Save,
      // which needs a full five (or everyone still eligible, if fewer than five can play).
      var lu = ui.lineup || court.slice(), need = lineupNeed(g, court), n = lu.length;
      var mark = function (p) {
        var picked = lu.indexOf(p.id) >= 0, wasOn = court.indexOf(p.id) >= 0, l = c.players[p.id] || C.emptyLine(), why = C.outReason(l, r);
        var cls = picked ? ' on' : wasOn ? ' leaving' : '', note = picked && !wasOn ? 'Going in' : !picked && wasOn ? 'Coming off' : '';
        return '<button class="bp' + cls + (why ? ' out' : '') + '" data-a="lineupTap" data-x="' + p.id + '"' + (!wasOn && why ? ' disabled' : '') +
          '><span class="num">' + esc(jerseyOf(p)) + '</span><span>' + esc(shortName(p)) + '<small>' + (note ? '<b>' + note + '</b> · ' : '') +
          l.pts + ' pts · ' + l.pf + ' PF' + (l.tf ? ' · ' + l.tf + 'T' : '') + (why ? (why === 'ejected' ? ' · EJECTED' : ' · OUT') : '') + '</small></span></button>';
      };
      var ok = n === need, changed = n !== court.length || lu.some(function (id) { return court.indexOf(id) < 0; });
      var hint = ok ? (changed ? 'Lineup ready. Tap <b>Save lineup</b> to make the subs.' : 'Tap anyone to take them off or put them in, in any order. Nothing changes until you save.')
        : n < need ? 'Pick <b>' + (need - n) + ' more</b> to make ' + need + ' on court.' : 'Take <b>' + (n - need) + ' off</b>: only ' + need + ' can be on court.';
      h = '<p class="sub-hint' + (ok ? '' : ' on') + '">' + hint + '</p>' +
        '<h4 class="bench-hd">On court now</h4><div class="bench">' +
        court.map(function (id) { return mark(player(id) || R.findPlayer(g, meta, id) || { id: id, num: '?' }); }).join('') + '</div>' +
        '<h4 class="bench-hd">Bench</h4><div class="bench">' + bench.map(mark).join('') + '</div>' +
        '<p class="note">Subs entered any time before the next point count exactly for plus/minus, so it’s fine to catch up during free throws.</p>';
      return sheet('Substitutions · ' + n + ' of ' + need + ' picked', h, '<button class="btn ghost" data-a="closeDrawer">Cancel</button>' +
        '<button class="btn pri" data-a="lineupSave"' + (ok ? '' : ' disabled') + '>' + (changed || !ok ? 'Save lineup' : 'Done') + '</button>');
    }
    if (d === 'tech-us' || d === 'tech-them') {
      var ttm = d.slice(5), tname = ttm === 'us' ? meta.team.name : g.opponent, cs = C.coachStatus(c.staff[ttm], r);
      if (ui.techBench) {
        // Bench player: ours are everyone not on the court; theirs are the numbers entered so far.
        var who = ttm === 'us'
          ? seasonPlayers().filter(function (p) { return g.onCourt.indexOf(p.id) < 0; }).map(function (p) { return [p.id, jerseyOf(p), shortName(p)]; })
          : (g.oppNums || []).slice().sort(function (a, b) { return R.byJersey({ num: a }, { num: b }); }).map(function (n) { return [n, n, '']; });
        h = '<div class="bench">' + who.map(function (w) {
          return '<button class="bp" data-a="techTo" data-x="' + ttm + ':bench:' + esc(w[0]) + '"><span class="num">' + esc(w[1]) + '</span><span>' + esc(w[2]) + '</span></button>';
        }).join('') + '</div>' + (who.length ? '' : '<p class="note">No numbers entered for them yet. Add the number from their column first.</p>');
        return sheet('Technical on a ' + tname + ' bench player', h, '<button class="btn ghost" data-a="techBack" data-x="' + ttm + '">Back</button>', true);
      }
      var lim = (r.coachTechDirect ? 'out at ' + r.coachTechDirect + ' direct' : '') + (r.coachTechDirect && r.coachTechTotal ? ' or ' : '') +
        (r.coachTechTotal ? r.coachTechTotal + ' in all' : '');
      h = '<p class="note" style="margin-top:0">Head coach so far: <b>' + cs.direct + ' direct</b>, ' + cs.indirect + ' from assistants and bench players' +
        (lim ? ' (' + lim + ')' : '') + (cs.out ? '. <b>Ejected.</b>' : '.') + '</p><div class="stack">' +
        '<button class="btn" data-a="techTo" data-x="' + ttm + ':hc">Head coach<small>direct technical</small></button>' +
        '<button class="btn" data-a="techTo" data-x="' + ttm + ':ac">Assistant coach<small>counts against the head coach</small></button>' +
        '<button class="btn" data-a="techBenchPick">Bench player<small>pick who · counts against the head coach</small></button>' +
        '<button class="btn" data-a="techTo" data-x="' + ttm + ':team">Team<small>e.g. delay, too many players</small></button></div>';
      return sheet('Technical foul · ' + tname, h, '', true);
    }
    if (d === 'rules') {
      return sheet('Rules for this game', '<p class="note" style="margin-top:0">Changes apply right away: team fouls, bonus and timeouts left are worked out again ' +
        'from the plays. Your usual rules in Settings don’t change.</p>' + rulesForm(r, 'data-grule'), '<button class="btn pri" data-a="closeDrawer">Done</button>');
    }
    if (d === 'keypad') {
      var forChg = ui.kpFor === 'chg';
      h = '<div class="kp-show num">' + (ui.kp ? esc(ui.kp) : '<span style="color:var(--rule)">#</span>') + '</div><div class="keypad">';
      ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '00'].forEach(function (k) { h += '<button data-a="kp" data-x="' + k + '">' + k + '</button>'; });
      h += '<button data-a="kp" data-x="del">⌫</button></div>';
      return sheet(forChg ? 'Offensive foul on ' + g.opponent + ' #' : g.opponent + ' player number', h,
        '<button class="btn pri" data-a="kpAdd"' + (ui.kp ? '' : ' disabled') + '>' + (forChg ? 'Foul on #' : 'Add #') + esc(ui.kp) + '</button>', true);
    }
    if (d === 'chgFoul') {
      var nums = (g.oppNums || []).slice().sort(function (a, b) { return R.byJersey({ num: a }, { num: b }); });
      h = '<p class="note" style="margin-top:0">Who was called for the offensive foul?</p><div class="keypad chg-pick">';
      nums.forEach(function (n) {
        var l = c.opp[n] || C.emptyLine();
        h += '<button data-a="chgFoul" data-x="' + esc(n) + '">' + esc(n) + '<small>' + l.pf + ' PF</small></button>';
      });
      h += '<button class="ghost" data-a="chgFoul" data-x="">No #<small>team</small></button>' +
        '<button class="ghost" data-a="drawer" data-x="keypad-chg">+ #<small>new number</small></button></div>';
      return sheet('Charge taken · foul on ' + g.opponent, h, '<button class="btn ghost" data-a="closeDrawer">Skip — don’t record a foul</button>', true);
    }
    if (d === 'log') {
      var evs = g.events.slice().reverse(), tot = { us: 0, them: 0 }, running = {};
      g.events.forEach(function (e) { if (e.t === 'make') tot[e.tm] += e.v; running[e.s] = tot.us + '–' + tot.them; });
      h = evs.length ? '<ul class="log">' : '<p class="note">Nothing recorded yet.</p>';
      evs.forEach(function (e) {
        var armed = ui.armed === 'ev' + e.s;
        h += '<li><span class="q">' + C.periodLabel(e.q, r) + '</span><span class="d ' + e.tm + '">' + esc(describe(e, g)) + '</span>' +
          '<span class="sc">' + running[e.s] + '</span><button class="btn sm danger' + (armed ? ' armed' : '') + '" data-a="rmEvent" data-x="' + e.s + '">' +
          (armed ? 'Confirm' : 'Remove') + '</button></li>';
      });
      if (evs.length) h += '</ul>';
      return sheet('Play log · ' + g.events.length + ' entries', h, '');
    }
    return '';
  }

  // ----- Report -----
  screens.report = function () {
    var g = gameById(route.id);
    if (!g) return screens.home();
    var names = ui.reportNames || meta.settings.names || 'first';
    var live = g.status !== 'final';
    var h = [pageHead(R.title(g, meta), backBtn(live ? '#game/' + g.id : '#home', live ? 'Game' : 'Home'), '')];
    h.push('<div class="rpt-bar no-print">');
    h.push('<div class="seg" style="height:2.6rem;flex:0 0 18rem"><button data-a="repNames" data-x="jersey" class="' + (names === 'jersey' ? 'on' : '') + '">Jersey only</button>' +
      '<button data-a="repNames" data-x="first" class="' + (names === 'first' ? 'on' : '') + '">First name</button>' +
      '<button data-a="repNames" data-x="full" class="' + (names === 'full' ? 'on' : '') + '">Full name</button></div>');
    h.push('<span class="sp"></span>');
    var locked = gameLocked(g);
    if (locked) h.push('<span class="lock-tag" title="Finished games can only be changed or deleted in the database">Locked</span>');
    else h.push('<button class="btn sm danger' + (ui.armed === 'del' + g.id ? ' armed' : '') + '" data-a="deleteGame">' +
      (ui.armed === 'del' + g.id ? 'Confirm delete' : 'Delete game') + '</button>');
    if (live) h.push('<button class="btn sm pri" data-a="go" data-x="#game/' + g.id + '">Back to game</button>');
    else if (!locked) h.push('<button class="btn sm ghost" data-a="reopen">Reopen game</button>');
    h.push('<button class="btn sm" data-a="print">Print</button>');
    h.push('<button class="btn sm" data-a="dlReport">Save file</button>');
    if (SHARE_FILES) h.push('<button class="btn sm" data-a="shareReport">Share file</button>');
    h.push('<button class="btn sm" data-a="publish">' + (g.publishedUrl ? 'Update link' : 'Publish link') + '</button>');
    h.push('<button class="btn sm pri" data-a="email">Email</button>');
    h.push('</div>');
    if (!live) {
      var lt = new Date(lockAt(g)), lh = lt.getHours();
      h.push('<p class="pub no-print">' + (locked ? 'This game is locked: finished games can’t be reopened, changed or deleted from any tablet, so nothing can wipe them by accident. A correction has to be made in the database.'
        : 'You can still reopen or delete this game until ' + ((lh % 12) || 12) + ':' + ('0' + lt.getMinutes()).slice(-2) + (lh < 12 ? ' AM' : ' PM') + '. After that it locks for good.') + '</p>');
    }
    if (g.publishedUrl) h.push('<p class="pub no-print">Published: <b>' + esc(g.publishedUrl) + '</b></p>');
    h.push('<style>' + R.CSS + '</style><div class="rpt-wrap">' + R.render(g, meta, { names: names, logo: LOGO }) + '</div>');
    return h.join('');
  };

  // ----- Settings -----
  // One-line description of a rule set, e.g. for the New game screen.
  function rulesSummary(r) {
    var per = r.periods === 2 ? 'halves' : 'quarters';
    var reset = { quarter: r.periods === 2 ? 'each half' : 'each quarter', half: 'each half', game: 'never' }[r.bonusReset];
    return esc(r.name) + ': ' + r.periods + ' ' + per + ' × ' + r.periodMinutes + ' min' +
      (r.openEnded ? ' (more can be added)' : '') + (r.scoreResets ? ' · score restarts each ' + (r.periods === 2 ? 'half' : 'quarter') : '') +
      ' · ' + (r.foulOut ? 'foul out at ' + r.foulOut : 'no foul-outs') + (r.techOut ? ', ejected at ' + r.techOut + ' techs' : '') +
      (r.bonusAt ? ' · bonus on team foul ' + r.bonusAt + (r.doubleBonusAt ? ' (double on ' + r.doubleBonusAt + ')' : '') + ', fouls reset ' + reset : ' · no bonus') +
      (r.shotFoulAward ? ' · shooting fouls: points + 1 free throw (after +1 it asks which)' : '') +
      (r.timeoutsUnlimited ? ' · unlimited timeouts'
        : ' · ' + r.timeoutsFull + ' full + ' + r.timeoutsShort + ' 30-sec timeouts per ' + (r.timeoutsReset === 'half' ? 'half' : 'game')) +
      (r.openEnded ? '' : ' · OT ' + r.otMinutes + ' min, +' + r.otTimeoutsFull + (r.otTimeoutsShort ? ' full +' + r.otTimeoutsShort + ' 30-sec' : '') + ' timeout');
  }

  // Rule fields. attr says where edits go: data-rule (Settings: defaults for new games),
  // data-drule (New game: this game only) or data-grule (the live game being scored).
  function rulesForm(r, attr) {
    function id(k) { return attr + '-' + k; }
    function num(k, label) {
      return '<div class="fld xs" style="flex-basis:9.5rem"><label for="' + id(k) + '">' + label + '</label><input id="' + id(k) +
        '" type="number" min="0" inputmode="numeric" ' + attr + '="' + k + '" value="' + r[k] + '"></div>';
    }
    function sel(k, label, opts) {
      var cur = typeof r[k] === 'boolean' ? (r[k] ? '1' : '0') : String(r[k]);
      return '<div class="fld xs" style="flex-basis:12rem"><label for="' + id(k) + '">' + label + '</label><select id="' + id(k) + '" ' + attr + '="' + k + '">' +
        opts.map(function (o) { return '<option value="' + o[0] + '"' + (cur === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></div>';
    }
    return '<div class="form"><div class="fld"><label for="' + id('name') + '">Rules name (shown on reports)</label><input id="' + id('name') + '" ' + attr +
      '="name" value="' + esc(r.name) + '"></div></div>' +
      '<h3 class="rules-hd">Game</h3><div class="form rules">' + num('periods', 'Periods (4 = quarters)') + num('periodMinutes', 'Minutes each') +
      sel('scoreResets', 'Score', [['0', 'Running total'], ['1', 'Restarts 0–0 each period']]) +
      sel('openEnded', 'After the last period', [['0', 'Overtime if tied'], ['1', 'Add periods any time']]) + num('otMinutes', 'OT minutes') + '</div>' +
      '<h3 class="rules-hd">Fouls</h3><div class="form rules">' + num('foulOut', 'Foul out at (0 = never)') + num('techOut', 'Ejected at techs (0 = never)') +
      num('bonusAt', 'Bonus on team foul (0 = none)') + num('doubleBonusAt', 'Double bonus on (0 = none)') +
      sel('bonusReset', 'Team fouls reset', [['quarter', 'Each period'], ['half', 'Each half'], ['game', 'Never']]) +
      sel('otFoulsCarry', 'Team fouls in OT', [['1', 'Carry over'], ['0', 'Start at 0']]) +
      num('coachTechDirect', 'Coach out at direct techs (0 = never)') + num('coachTechTotal', 'Coach out at total techs (0 = never)') +
      sel('benchTechTeamFoul', 'Coach / bench techs are team fouls', [['1', 'Yes'], ['0', 'No']]) +
      sel('shotFoulAward', 'After +1, ask "free throw?"', [['0', 'No (always a free throw)'], ['1', 'Yes (point or free throw)']]) + '</div>' +
      '<h3 class="rules-hd">Timeouts</h3><div class="form rules">' + sel('timeoutsUnlimited', 'Timeouts', [['0', 'Limited'], ['1', 'Unlimited']]) +
      num('timeoutsFull', 'Full') + num('timeoutsShort', '30-second') +
      sel('timeoutsReset', 'Allotment is per', [['game', 'Game'], ['half', 'Half (fresh each half)']]) +
      num('otTimeoutsFull', 'Full added per OT') + num('otTimeoutsShort', '30-sec added per OT') + '</div>';
  }

  var BOOL_RULES = { otFoulsCarry: 1, scoreResets: 1, openEnded: 1, shotFoulAward: 1, timeoutsUnlimited: 1, benchTechTeamFoul: 1 };
  function ruleValue(k, v) {
    if (BOOL_RULES[k]) return v === '1';
    if (k === 'bonusReset' || k === 'timeoutsReset') return v;
    if (k === 'name') return String(v).trim() || 'Custom';
    var n = Math.max(0, parseInt(v, 10) || 0);
    return k === 'periods' ? Math.max(1, n) : n;
  }

  screens.settings = function () {
    var r = C.copyRules(meta.settings.rules), s = meta.settings;
    var h = [pageHead('Settings', backBtn('#home', 'Home'), '')];
    h.push('<div class="pg-bd">');
    h.push('<h2>Team</h2><div class="form">' +
      '<div class="fld"><label for="t-name">Team name</label><input id="t-name" data-team="name" value="' + esc(meta.team.name) + '"></div>' +
      '<div class="fld xs" style="flex-basis:8rem"><label for="t-short">Short</label><input id="t-short" data-team="short" maxlength="4" value="' + esc(meta.team.short) + '"></div>' +
      '<div class="fld xs" style="flex-basis:8rem"><label for="t-color">Color</label><input id="t-color" type="color" data-team="color" value="' + esc(meta.team.color) + '"></div></div>');

    h.push('<h2>Season</h2><div class="form">' +
      '<div class="fld"><label for="s-cur">Current season</label><select id="s-cur" data-season="1">' +
      meta.seasons.map(function (x) { return '<option value="' + x.id + '"' + (x.id === meta.currentSeasonId ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join('') +
      '</select></div><div class="fld"><label for="s-new">New season name</label><input id="s-new" placeholder="' + esc(seasonName(new Date(new Date().getFullYear() + 1, 8, 1))) + '"></div>' +
      '<div class="fld xs"><span class="lab">&nbsp;</span><button class="btn" data-a="newSeason">Start season</button></div></div>');

    h.push('<h2>Rules for new games</h2>' + rulesForm(r, 'data-rule') +
      '<p class="note">Each game keeps the rules it started with. To use different rules for one game (a tournament, a scrimmage), ' +
      'change them on the New game screen, or from the period button during a game.</p>');

    var pctOpts = s.pct || {};
    function pctSel(k, label) {
      var on = pctOpts[k] !== false;
      return '<div class="fld xs" style="flex-basis:11rem"><label for="p-' + k + '">' + label + '</label><select id="p-' + k + '" data-pct="' + k + '">' +
        '<option value="1"' + (on ? ' selected' : '') + '>Show %</option><option value="0"' + (on ? '' : ' selected') + '>Show N/A</option></select></div>';
    }
    h.push('<h2>Screen</h2><div class="form">' +
      '<div class="fld"><label for="s-full">Full screen</label><select id="s-full" data-setting="autoFull">' +
      '<option value="1"' + (autoFullscreen() ? ' selected' : '') + '>Go full screen when a game opens</option>' +
      '<option value="0"' + (autoFullscreen() ? '' : ' selected') + '>Only with the Full screen button</option></select></div>' +
      '<div class="fld"><label for="s-awake">Keep screen on</label><select id="s-awake" data-setting="keepAwake">' +
      '<option value="always"' + (s.keepAwake !== 'games' ? ' selected' : '') + '>Whenever the app is open</option>' +
      '<option value="games"' + (s.keepAwake === 'games' ? ' selected' : '') + '>Only during games</option></select></div>' +
      '</div><p class="note">' + (fsAvailable() ? 'Swipe down from the top or tap Exit to leave full screen. '
        : 'This browser is already full screen or doesn’t support it. On iPad, use Share → Add to Home Screen for a full-screen app. ') +
      '<b>' + wakeStatus() + '</b></p>');

    h.push('<h2>Shooting percentages</h2><div class="form">' +
      pctSel('two', '2-pointers') + pctSel('three', '3-pointers') + pctSel('ft', 'Free throws') +
      '</div><p class="note">Switch a shot type to N/A if you don’t record its misses, so it doesn’t show a false 100%. FG% counts 2s and 3s, so it shows N/A if either is off. Applies to all reports and season stats.</p>');

    h.push('<h2>Sharing</h2><div class="form">' +
      '<div class="fld"><label for="s-names">Names on reports</label><select id="s-names" data-setting="names">' +
      [['jersey', 'Jersey numbers only'], ['first', 'First name + last initial'], ['full', 'Full names']].map(function (o) {
        return '<option value="' + o[0] + '"' + (s.names === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
      }).join('') + '</select></div>' +
      '<div class="fld"><label for="s-pub">Publish address</label><input id="s-pub" data-setting="publishUrl" placeholder="https://scorebook-reports.example.workers.dev" value="' + esc(s.publishUrl) + '" autocomplete="off"></div>' +
      '<div class="fld"><label for="s-key">Publish key</label><input id="s-key" type="password" data-setting="publishKey" value="' + esc(s.publishKey) + '" autocomplete="off"></div>' +
      '</div><p class="note">Published reports get a long random link that isn’t listed or searchable. Leave the address blank to share by email text and saved files only.</p>');

    if (syncing) {
      var u = Cloud.currentUser(), word = { synced: 'Everything is synced.', syncing: 'Syncing…', offline: 'Offline. Changes are saved on this tablet and will sync when it’s back online.' }[syncState];
      h.push('<h2>Account and sync</h2><p class="note">Signed in as <b>' + esc(u && u.email) + '</b>. ' + word +
        ' Every change is saved to the cloud, so signing in on another tablet shows the same games.</p>' +
        '<div class="form"><button class="btn danger' + (ui.armed === 'signout' ? ' armed' : '') + '" data-a="signOut">' +
        (ui.armed === 'signout' ? 'Confirm sign out' : 'Sign out') + '</button></div>');
    }
    if (syncing) {
      h.push('<h2>Automatic backups</h2><p class="note">The cloud keeps a copy of the roster, schedule, seasons and settings every hour there are changes, plus one from the start of each day. ' +
        'Restoring one puts it back on every tablet; games aren’t affected.</p>');
      var hs = ui.history;
      if (!hs) h.push('<div class="form"><button class="btn" data-a="loadHistory">Show automatic backups</button></div>');
      else if (hs === 'loading') h.push('<p class="note">Loading…</p>');
      else if (hs.error) h.push('<p class="note">Couldn’t load them: ' + esc(hs.error) + ' Is the tablet online?</p>');
      else if (!hs.length) h.push('<p class="note">None yet. The first one is made the next time something changes.</p>');
      else h.push('<ul class="games hist">' + hs.map(function (x, i) {
        var m = x.meta || {}, sid = m.currentSeasonId, armed = ui.armed === 'hist' + i;
        var np = (m.players || []).filter(function (p) { return p.seasonId === sid; }).length, ns = (m.schedule || []).filter(function (s) { return s.seasonId === sid; }).length;
        return '<li class="sch-row"><span class="sch-when"><b>' + esc(histWhen(x)) + '</b><small>' + (x.id.indexOf('day-') === 0 ? 'Start of day' : 'Hourly') + '</small></span>' +
          '<span class="op">' + np + ' player' + (np === 1 ? '' : 's') + ' · ' + ns + ' scheduled game' + (ns === 1 ? '' : 's') + '</span>' +
          '<button class="btn sm' + (armed ? ' danger armed' : '') + '" data-a="restoreHistory" data-x="' + i + '">' + (armed ? 'Confirm restore' : 'Restore') + '</button></li>';
      }).join('') + '</ul>');
    }
    h.push('<h2>Backup</h2><p class="note">' + (syncing ? 'The cloud copy is your main backup. A backup file is an extra copy you can keep yourself.'
      : 'Everything is stored on this tablet. Save a backup after each game in case the browser data is cleared.') + '</p>' +
      '<div class="form"><button class="btn" data-a="exportAll">Save backup file</button>' +
      '<label class="btn ghost" for="imp">Restore from backup…</label><input id="imp" type="file" accept=".json,application/json" class="sr" data-import="1"></div>' +
      (DB.usingFallback() ? '<p class="note">Note: this browser is using basic storage (localStorage). Keep backups.</p>' : ''));

    h.push('<h2>App version</h2><p class="note">This tablet is running <b>' +
      esc(swVersion || (location.protocol === 'https:' ? 'version not known yet' : 'the local test copy')) +
      '</b>. New versions install by themselves when the tablet is online; this checks right away.</p>' +
      '<div class="form"><button class="btn" data-a="checkUpdate">Check for updates</button></div>');

    var hasSample = games.some(function (g) { return g.sample; }) || meta.players.some(function (p) { return p.sample; });
    if (testMode) {
      h.push('<h2>Test mode</h2><p class="note"><b>Test mode is on.</b> Nothing you do is saved or synced. Exit test mode (or reload the app) ' +
        'to go back to your real games exactly as they were.</p><div class="form"><button class="btn pri" data-a="testExit">Exit test mode</button>' +
        (hasSample ? '' : '<button class="btn" data-a="loadSample">Add sample games</button>') + '</div>');
    } else {
      h.push('<h2>Test mode</h2><p class="note">Practice or try things out without keeping anything: score a pretend game, change settings, ' +
        'delete games. Nothing is saved or synced, and reloading the app puts everything back. “With sample games” adds a demo roster ' +
        '(if yours is empty), a finished game and a game in progress to practice on.</p>' +
        '<div class="form"><button class="btn" data-a="testStart">Start test mode</button><button class="btn" data-a="testStart" data-x="sample">Start with sample games</button>' +
        (hasSample ? '<button class="btn danger' + (ui.armed === 'rmSample' ? ' armed' : '') + '" data-a="removeSample">' +
          (ui.armed === 'rmSample' ? 'Confirm: remove all sample data' : 'Remove saved sample data') + '</button>' : '') + '</div>');
    }
    h.push('</div>');
    return h.join('');
  };

  // ---------- actions ----------
  var actions = {};

  actions.go = function (x) {
    draft = x === '#new' ? null : draft;
    if (x.indexOf('#game/') === 0 && autoFullscreen()) enterFullscreen();
    go(x);
  };
  actions.fullscreen = function () { if (fsActive()) exitFullscreen(); else enterFullscreen(); };

  // Live: choosing who
  // Tapping a team's name (or tab) points the pad at that team with nobody picked, so TECH
  // then means a coach, bench or team technical.
  actions.side = function (x) {
    ui.side = x; ui.prompt = null;
    if (x === 'us') ui.sel = null; else ui.oppSel = null;
    render();
  };
  // Tapping a player always selects (never toggles off): after a free throw the shooter
  // stays selected, and a reflexive second tap must not clear it.
  // Picking a player also points the pad at their team (both teams show at once on wide screens).
  actions.pick = function (x) { ui.sel = x; ui.msg = null; ui.side = 'us'; render(); };
  actions.oppPick = function (x) { ui.oppSel = x === '' ? null : x; ui.side = 'them'; render(); };

  // Scrimmage shooting-foul rule: a +1 is recorded as a made free throw, then the pad asks whether
  // it was one. "Point only" / "2 points" turn it into points that aren't a shot ('award'), so
  // free-throw percentage isn't affected.
  function askFreeThrow(g, e) { if (C.copyRules(g.rules).shotFoulAward) ui.prompt = { k: 'ft', s: e.s }; }
  actions.ftConvert = function (x) {
    var g = gameById(route.id), p = x.split(':'), s = parseInt(p[0], 10), v = parseInt(p[1], 10), e = null;
    for (var i = 0; i < g.events.length; i++) if (g.events[i].s === s) e = g.events[i];
    if (!e) return render();
    e.t = 'award'; e.v = v;
    saveGame(g);
    toast(v === 1 ? 'Counted as a point, not a free throw.' : 'Counted as 2 points, not a free throw.');
    render();
  };

  // Live: our team stat
  actions.act = function (x) {
    var g = gameById(route.id), parts = x.split(':'), t = parts[0], v = parts[1];
    if (!ui.sel && t === 'foul' && v === 't') { ui.drawer = 'tech-us'; ui.techBench = false; return render(); }
    if (!ui.sel) { padMsg('Pick a player first'); return render(); }
    if (t === 'make' || t === 'miss') v = parseInt(v, 10);
    var c = C.computeGame(g), pl = c.players[ui.sel];
    if (t === 'foul' && pl && C.outReason(pl, c.rules)) {
      padMsg(C.outReason(pl, c.rules) === 'ejected' ? 'That player has been ejected' : 'That player has already fouled out');
      return render();
    }
    var e = addEvent(g, 'us', ui.sel, t, v === '' ? undefined : v);
    ui.flash = ui.sel;
    if (t === 'make' && v > 1) ui.prompt = { k: 'ast', p: ui.sel };
    else if (t === 'miss') ui.prompt = { k: 'reb', p: ui.sel };
    else if (t === 'chg') { ui.drawer = 'chgFoul'; ui.chgSeq = e.s; }
    else if (t === 'make' && v === 1) askFreeThrow(g, e);
    if (t === 'foul') {
      var after = C.computeGame(g), p = player(ui.sel);
      var notes = [foulNotice(pTag(p), after.players[ui.sel], after.rules, v === 't', true)];
      if (after.shooting.them && after.currentFouls.us === after.rules.bonusAt - 1) notes.push(g.opponent + ' shoot on the next foul (bonus).');
      notes = notes.filter(Boolean);
      if (notes.length) toast(notes.join(' '), notes.length > 1 || C.outReason(after.players[ui.sel], after.rules) ? 5000 : 0);
    }
    // Free throws usually come in pairs: keep the shooter selected.
    if (!(t === 'make' || t === 'miss') || v !== 1) ui.sel = null;
    render();
    return e;
  };

  actions.promptPick = function (x) {
    var g = gameById(route.id), pr = ui.prompt;
    ui.prompt = null;
    if (pr && x !== 'them') {
      // Our rebound after our own miss is always offensive.
      addEvent(g, 'us', x, pr.k === 'ast' ? 'ast' : 'reb', pr.k === 'ast' ? undefined : 'o');
      ui.flash = x;
    }
    render();
  };
  actions.promptSkip = function () { ui.prompt = null; render(); };

  // Live: opponent
  // Records a foul on an opponent ('' = no number) and shows any warning it causes.
  // link: seq of the charge this offensive foul came from, so undo removes the pair together.
  function oppFoul(g, num, v, confirm, link) {
    var e = addEvent(g, 'them', num, 'foul', v);
    if (link) { e.of = link; saveGame(g); }
    var c = C.computeGame(g);
    var note = num ? foulNotice(g.opponent + ' #' + num, c.opp[num], c.rules, v === 't') : '';
    if (confirm) note = confirm + (note ? ' ' + note : '');
    if (note) toast(note, num && C.outReason(c.opp[num], c.rules) ? 5000 : 0);
  }

  function chgConfirm(g, num) { return 'Offensive foul on ' + g.opponent + (num ? ' #' + num : ' (no number)') + '.'; }

  actions.oppAct = function (x) {
    var g = gameById(route.id), parts = x.split(':'), t = parts[0], v = parts[1];
    if (t === 'make') v = parseInt(v, 10);
    if (t === 'foul' && v === 't' && !ui.oppSel) { ui.drawer = 'tech-them'; ui.techBench = false; return render(); }
    if (t === 'foul') oppFoul(g, ui.oppSel || '', v);
    else {
      var e = addEvent(g, 'them', ui.oppSel || '', t, v);
      if (t === 'make' && v === 1) askFreeThrow(g, e);
    }
    if (!(t === 'make' && v === 1)) ui.oppSel = null;
    render();
  };

  actions.kp = function (x) {
    if (x === 'del') ui.kp = ui.kp.slice(0, -1);
    else if (x === '00') ui.kp = '00';
    else if (ui.kp.length < 2 && ui.kp !== '00') ui.kp += x;
    render();
  };
  actions.kpAdd = function () {
    var g = gameById(route.id);
    if (!ui.kp) return;
    g.oppNums = g.oppNums || [];
    if (g.oppNums.indexOf(ui.kp) < 0) g.oppNums.push(ui.kp);
    if (ui.kpFor === 'chg') {
      // From the charge sheet: record the foul and stay on our side.
      ui.kpFor = null; ui.drawer = null;
      oppFoul(g, ui.kp, 'p', chgConfirm(g, ui.kp), ui.chgSeq);
      ui.chgSeq = null;
      ui.kp = '';
      return render();
    }
    ui.oppSel = ui.kp; ui.kp = ''; ui.drawer = null; ui.side = 'them';
    saveGame(g);
    render();
  };

  // Timeout countdown, shown in the live footer in place of the last-play line.
  // It updates only its own text each tick, so the screen isn't redrawn every second.
  var TIMEOUT_SECS = { full: 60, short: 30 }, timerTick = null;
  function startTimer(g, tm, v, seq) {
    ui.timer = { game: g.id, tm: tm, v: v, seq: seq, end: Date.now() + TIMEOUT_SECS[v] * 1000 };
    clearInterval(timerTick);
    timerTick = setInterval(tickTimer, 250);
  }
  function stopTimer() { ui.timer = null; clearInterval(timerTick); timerTick = null; }
  function timerLeft() { return Math.max(0, Math.ceil((ui.timer.end - Date.now()) / 1000)); }
  function fmtClock(s) { return Math.floor(s / 60) + ':' + (s % 60 < 10 ? '0' : '') + (s % 60); }
  function tickTimer() {
    var t = ui.timer;
    if (!t) return stopTimer();
    var left = timerLeft(), el = document.getElementById('to-clock');
    if (el) el.textContent = left ? fmtClock(left) : '0:00';
    if (left || t.done) return;
    // Time's up: turn the chip red, buzz the tablet if it can, and clear it after a few seconds.
    t.done = true;
    if (navigator.vibrate) navigator.vibrate([300, 150, 300]);
    if (route.name === 'game') render();
    setTimeout(function () { if (ui.timer === t) { stopTimer(); if (route.name === 'game') render(); } }, 8000);
  }
  function timerChip(g) {
    var t = ui.timer, left = timerLeft();
    return '<button class="to-clock' + (t.done ? ' done' : '') + '" data-a="endTimer">' +
      '<span class="who">' + esc(t.tm === 'us' ? meta.team.name : g.opponent) + ' · ' + (t.v === 'short' ? '30-second' : 'full') + ' timeout</span>' +
      '<b id="to-clock" class="num">' + fmtClock(left) + '</b><small>' + (t.done ? 'Time’s up' : 'Tap to end') + '</small></button>';
  }
  actions.endTimer = function () { stopTimer(); render(); };

  actions.timeout = function (x) {
    var g = gameById(route.id), p = x.split(':');
    var e = addEvent(g, p[0], '', 'timeout', p[1]);
    startTimer(g, p[0], p[1], e.s);
    ui.drawer = null;
    var c = C.computeGame(g), left = c.timeoutsLeft[p[0]];
    toast((p[0] === 'us' ? meta.team.name : g.opponent) + ' timeout.' + (c.rules.timeoutsUnlimited ? '' : ' ' + left.full + ' full + ' + left.short + ' short left.'));
    render();
  };

  // A charge and the offensive foul it drew are one play: removing either removes both.
  function linkedSeqs(g, s) {
    var out = [s];
    g.events.forEach(function (e) {
      if (e.s === s && e.of) out.push(e.of);
      if (e.of === s) out.push(e.s);
    });
    return out;
  }

  // Undo removes the last play, skipping over subs (change those in the Subs sheet).
  actions.undo = function () {
    var g = gameById(route.id), i = g.events.length - 1;
    while (i >= 0 && g.events[i].t === 'sub') i--;
    if (i < 0) { toast('Nothing to undo. Use Subs to change who’s on court.'); return; }
    var e = g.events[i];
    var gone = linkedSeqs(g, e.s), removed = g.events.filter(function (x) { return gone.indexOf(x.s) >= 0; });
    g.events = g.events.filter(function (x) { return gone.indexOf(x.s) < 0; });
    if (ui.timer && gone.indexOf(ui.timer.seq) >= 0) stopTimer();
    saveGame(g);
    ui.prompt = null;
    toast('Undid: ' + removed.map(function (x) { return describe(x, g); }).join(' + '));
    render();
  };

  actions.rmEvent = function (x) {
    var g = gameById(route.id), s = parseInt(x, 10);
    if (ui.armed !== 'ev' + s) { ui.armed = 'ev' + s; return render(); }
    var gone = linkedSeqs(g, s);
    g.events = g.events.filter(function (e) { return gone.indexOf(e.s) < 0; });
    if (ui.timer && ui.timer.game === g.id && gone.indexOf(ui.timer.seq) >= 0) stopTimer();
    // Removing a logged sub changes who is on court now.
    if (g.subLog) g.onCourt = C.lineupAfter(g);
    ui.armed = null;
    saveGame(g);
    render();
  };

  actions.setQ = function (x) {
    var g = gameById(route.id), prev = g.quarter;
    g.quarter = parseInt(x, 10);
    ui.drawer = null; ui.prompt = null;
    saveGame(g);
    var c = C.computeGame(g), r = c.rules, msg;
    if (r.scoreResets && g.quarter > prev) {
      // Say how the period that just ended went, since the scoreboard goes back to 0–0.
      var a = c.byPeriod.us[prev - 1], b = c.byPeriod.them[prev - 1];
      msg = C.periodLabel(prev, r) + ' ' + (a > b ? 'to ' + meta.team.name : a < b ? 'to ' + g.opponent : 'tied') + ' ' + a + '–' + b + '. ' +
        C.periodLabel(g.quarter, r) + ' started.';
    } else {
      msg = C.periodLabel(g.quarter, r) + ' started' + (r.bonusAt ? ' · team fouls ' + c.currentFouls.us + '–' + c.currentFouls.them : '');
    }
    toast(msg, r.scoreResets ? 4500 : 0);
    render();
  };

  actions.endGame = function () {
    var g = gameById(route.id);
    g.status = 'final';
    g.ended = Date.now();
    saveGame(g);
    go('#report/' + g.id);
  };

  actions.reopen = function () {
    var g = gameById(route.id);
    if (gameLocked(g)) { toast('This game is locked. Finished games can only be changed in the database.'); return; }
    g.status = 'live';
    saveGame(g);
    go('#game/' + g.id);
  };

  // Subs are logged as events so plus/minus knows who was on court. Taking a player
  // off and straight back on (or the reverse) cancels out instead of logging both.
  function logSub(g, id, v) {
    if (!g.subLog) return;
    var last = g.events[g.events.length - 1];
    if (last && last.t === 'sub' && last.p === id && last.v !== v && last.q === g.quarter) g.events.pop();
    else addEvent(g, 'us', id, 'sub', v);
  }

  // Returns why a player can't come in ('' if they can), with a toast saying so.
  function blockedFromCourt(g, id) {
    var c = C.computeGame(g), l = c.players[id], why = l ? C.outReason(l, c.rules) : '';
    if (why) toast(why === 'ejected' ? 'That player has been ejected.' : 'That player has fouled out.');
    return why;
  }

  function cameIn(g, id) {
    if (g.appeared.indexOf(id) < 0) g.appeared.push(id);
    // Keep the game's roster snapshot complete for players added mid-season.
    var p = player(id);
    if (p && !find(g.roster, id)) g.roster.push({ id: p.id, num: p.num, first: p.first, last: p.last });
  }

  function putIn(g, id) { g.onCourt.push(id); logSub(g, id, 'in'); cameIn(g, id); saveGame(g); }

  function takeOff(g, id) {
    g.onCourt.splice(g.onCourt.indexOf(id), 1);
    logSub(g, id, 'out');
    if (ui.sel === id) ui.sel = null;
    saveGame(g);
  }

  // The player coming in takes the outgoing player's card position, so the others don't move.
  function swapPlayers(g, outId, inId) {
    g.onCourt[g.onCourt.indexOf(outId)] = inId;
    logSub(g, outId, 'out');
    logSub(g, inId, 'in');
    cameIn(g, inId);
    if (ui.sel === outId) ui.sel = null;
    saveGame(g);
  }

  function subName(id) { return pTag(player(id) || {}); }

  // How many the lineup must have to save: five, or fewer when not enough players can still play.
  function lineupNeed(g, court) {
    var c = C.computeGame(g), able = court.length;
    seasonPlayers().forEach(function (p) {
      if (court.indexOf(p.id) < 0 && !C.outReason(c.players[p.id] || C.emptyLine(), c.rules)) able++;
    });
    return Math.min(5, able);
  }

  // Subs sheet: a draft of the next lineup. Tap anyone to put them in or take them off, in any
  // order and with any count along the way; Save makes the subs once the lineup is full.
  actions.lineupTap = function (x) {
    var g = gameById(route.id), lu = ui.lineup || (ui.lineup = g.onCourt.filter(Boolean)), i = lu.indexOf(x);
    if (i >= 0) lu.splice(i, 1);
    else if (g.onCourt.indexOf(x) >= 0 || !blockedFromCourt(g, x)) lu.push(x);
    else return;
    render();
  };

  // '#12', or the name for a player with no number yet.
  function shortTag(id) { var p = player(id) || {}; return p.num ? '#' + p.num : shortName(p); }

  // Each player coming in takes the card spot of one going off (in the order they were tapped),
  // so the rest of the lineup stays where it is on screen.
  actions.lineupSave = function () {
    var g = gameById(route.id), court = g.onCourt.filter(Boolean), lu = ui.lineup || court;
    if (lu.length !== lineupNeed(g, court)) return;
    var outs = court.filter(function (id) { return lu.indexOf(id) < 0; }), ins = lu.filter(function (id) { return court.indexOf(id) < 0; });
    outs.forEach(function (id, k) { if (k < ins.length) swapPlayers(g, id, ins[k]); else takeOff(g, id); });
    ins.slice(outs.length).forEach(function (id) { putIn(g, id); });
    if (ins.length || outs.length) {
      toast(ins.length && outs.length && ins.length === outs.length
        ? ins.map(function (id, k) { return shortTag(id) + ' in for ' + shortTag(outs[k]); }).join(' · ')
        : (ins.length ? 'In: ' + ins.map(function (id) { return subName(id); }).join(', ') : '') +
          (ins.length && outs.length ? ' · ' : '') + (outs.length ? 'Off: ' + outs.map(function (id) { return subName(id); }).join(', ') : ''));
    }
    ui.drawer = null; ui.lineup = null;
    render();
  };

  // SUB key on the pad: with one of our players picked, go straight to "who replaces them?".
  actions.subKey = function () {
    var g = gameById(route.id);
    ui.pendSub = null; ui.lineup = null;
    if (ui.sel && g.onCourt.indexOf(ui.sel) >= 0) { ui.subOut = ui.sel; ui.drawer = 'replace'; }
    else ui.drawer = 'bench';
    render();
  };
  actions.replaceWith = function (x) {
    var g = gameById(route.id);
    if (blockedFromCourt(g, x)) return;
    swapPlayers(g, ui.subOut, x);
    toast(subName(x) + ' in for ' + subName(ui.subOut));
    ui.drawer = null; ui.subOut = null;
    render();
  };

  actions.drawer = function (x) {
    // 'keypad-chg' is the number keypad opened from the charge sheet: the number gets the offensive foul.
    ui.kpFor = x === 'keypad-chg' ? 'chg' : null;
    if (x === 'keypad-chg') x = 'keypad';
    ui.drawer = x; ui.prompt = null; ui.armed = null; ui.pendSub = null; ui.techBench = false; ui.lineup = null;
    if (x === 'keypad') ui.kp = '';
    render();
  };
  actions.closeDrawer = function () { ui.drawer = null; ui.armed = null; ui.kpFor = null; ui.pendSub = null; ui.subOut = null; ui.techBench = false; ui.lineup = null; render(); };

  // Technicals off the court (team name, then TECH): head coach, assistant, a bench player or the team.
  actions.techBenchPick = function () { ui.techBench = true; render(); };
  actions.techBack = function () { ui.techBench = false; render(); };
  actions.techTo = function (x) {
    var g = gameById(route.id), p = x.split(':'), tm = p[0], w = p[1], id = p.slice(2).join(':');
    var e = addEvent(g, tm, w === 'bench' ? id : '', 'foul', 't');
    e.w = w;
    saveGame(g);
    ui.drawer = null; ui.techBench = false;
    var c = C.computeGame(g), team = tm === 'us' ? meta.team.name : g.opponent, notes = [];
    if (w === 'bench') {
      var name = tm === 'us' ? subName(id) : g.opponent + ' #' + id;
      notes.push('Technical on ' + name + ' (bench).');
      notes.push(foulNotice(name, (tm === 'us' ? c.players : c.opp)[id], c.rules, true, false));
    } else {
      notes.push('Technical on the ' + team + ' ' + { hc: 'head coach', ac: 'assistant coach', team: 'team' }[w] + '.');
    }
    if (w !== 'team') notes.push(coachNotice(team, C.coachStatus(c.staff[tm], c.rules), w));
    notes = notes.filter(Boolean);
    toast(notes.join(' '), notes.length > 1 ? 6000 : 0);
    render();
  };

  function coachNotice(team, cs, w) {
    if (cs.out === 'direct') return team + '’s head coach is ejected (' + cs.direct + ' direct technicals).';
    if (cs.out === 'total') return team + '’s head coach is ejected (' + cs.total + ' technicals on the bench).';
    var out = [];
    if (w === 'hc' && cs.direct === 1) out.push('The head coach must stay seated.');
    if (cs.next === 'any') out.push('One more bench technical ejects the head coach.');
    else if (cs.next === 'direct') out.push('One more technical on the head coach ejects them.');
    return out.join(' ');
  }
  actions.chgFoul = function (x) {
    var g = gameById(route.id);
    ui.drawer = null;
    oppFoul(g, x, 'p', chgConfirm(g, x), ui.chgSeq);
    ui.chgSeq = null;
    render();
  };

  // New game
  actions.draftSide = function (x) { draft.homeAway = x; render(); };
  actions.draftStarter = function (x) {
    var i = draft.starters.indexOf(x);
    if (i >= 0) draft.starters.splice(i, 1);
    else if (draft.starters.length < 5) draft.starters.push(x);
    else toast('Five starters already picked. Tap one to remove it.');
    render();
  };
  // Schedule
  actions.rosterToggle = function () {
    ui.rosterOpen = !(ui.rosterOpen === undefined ? !seasonPlayers().length : ui.rosterOpen);
    render();
    if (ui.rosterOpen) { var el = document.querySelector('.add-area'); if (el) el.scrollIntoView(); var n = document.getElementById('np-num'); if (n) n.focus(); }
  };
  actions.schedToggle = function () {
    ui.schedOpen = !(ui.schedOpen === undefined ? !seasonSchedule().length : ui.schedOpen);
    render();
    if (ui.schedOpen) { var el = document.querySelector('.add-area'); if (el) el.scrollIntoView(); }
  };
  actions.schedRead = function () {
    var el = document.getElementById('sch-text'), text = el ? el.value : '';
    if (!text.trim()) { toast('Paste the schedule first, or upload a file.'); return; }
    ui.schedText = text;
    readSchedule(text);
  };
  actions.schedCancel = function () { ui.schedPreview = null; render(); };
  actions.schedAdd = function () {
    var rows = ui.schedPreview.rows;
    rows.forEach(function (x) {
      meta.schedule.push({ id: uid(), seasonId: meta.currentSeasonId, date: x.date, time: x.time, opponent: x.opponent,
        homeAway: x.homeAway, location: x.location, gameId: null });
    });
    saveMeta();
    ui.schedPreview = null; ui.schedText = '';
    toast('Added ' + rows.length + ' game' + (rows.length === 1 ? '' : 's') + ' to the schedule.');
    render();
  };
  actions.rmSched = function (x) {
    if (ui.armed !== 'sch' + x) { ui.armed = 'sch' + x; return render(); }
    ui.armed = null;
    meta.schedule = meta.schedule.filter(function (s) { return s.id !== x; });
    markGone(x);
    saveMeta();
    render();
  };
  // Opens New game filled in from the schedule; starting it marks the entry as played.
  actions.startScheduled = function (x) {
    var s = find(meta.schedule, x);
    // 'TBD' (a tournament game whose opponent isn't known yet) leaves the opponent for you to fill in.
    draft = { opponent: /^tbd$/i.test(s.opponent) ? '' : s.opponent, date: s.date < today() ? today() : s.date, location: s.location, homeAway: s.homeAway, starters: [], schedId: s.id };
    if (s.type === 'scrimmage') { draft.type = 'scrimmage'; draft.rules = C.copyRules(meta.settings.scrimRules || C.scrimmageRules(meta.settings.rules)); }
    go('#new');
  };

  // Scrimmage: starts from the last scrimmage's rules (or the defaults) so the setup is usually one tap.
  actions.draftType = function (x) {
    draft.type = x;
    draft.rules = x === 'scrimmage' ? C.copyRules(meta.settings.scrimRules || C.scrimmageRules(meta.settings.rules)) : null;
    ui.moreRules = false;
    render();
  };
  actions.draftPeriods = function (x) { draft.rules.periods = parseInt(x, 10); render(); };
  actions.moreRules = function () { ui.moreRules = true; render(); };

  actions.draftRules = function (x) { draft.rules = x === 'on' ? C.copyRules(meta.settings.rules) : null; render(); };

  // "1, 3 7/13" → ['1', '3', '7', '13']: jersey numbers, no repeats.
  function parseNums(text) {
    var out = [];
    String(text || '').split(/[^0-9]+/).forEach(function (n) { if (n && n.length <= 2 && out.indexOf(n) < 0) out.push(n); });
    return out;
  }

  actions.startGame = function () {
    var name = (draft.opponent || '').trim();
    if (!name) { toast('Enter the opponent’s name.'); var el = document.getElementById('ng-opp'); if (el) el.focus(); return; }
    if (!meta.opponents.some(function (o) { return o.name.toLowerCase() === name.toLowerCase(); })) {
      meta.opponents.push({ id: uid(), name: name });
      saveMeta();
    }
    var roster = seasonPlayers().map(function (p) { return { id: p.id, num: p.num, first: p.first, last: p.last }; });
    var g = {
      id: uid(), seasonId: meta.currentSeasonId, opponent: name, date: draft.date || today(), location: (draft.location || '').trim(),
      homeAway: draft.homeAway, rules: C.copyRules(draft.rules || meta.settings.rules), quarter: 1, status: 'live', events: [], seq: 0,
      onCourt: draft.starters.slice(), appeared: draft.starters.slice(), starters: draft.starters.slice(), roster: roster,
      oppNums: parseNums(draft.oppNumsText), created: Date.now(), publishedUrl: '', publishId: '', subLog: true,
      type: draft.type === 'scrimmage' ? 'scrimmage' : 'game'
    };
    games.push(g);
    saveGame(g);
    if (g.type === 'scrimmage') { meta.settings.scrimRules = C.copyRules(g.rules); saveMeta(); }
    // Started from the schedule: mark that entry as played.
    var sch = draft.schedId && find(meta.schedule, draft.schedId);
    if (sch) { sch.gameId = g.id; saveMeta(); }
    draft = null;
    ui.side = 'us'; ui.sel = null; ui.oppSel = null;
    if (autoFullscreen()) enterFullscreen();
    go('#game/' + g.id);
  };

  // Roster
  actions.rmPlayer = function (x) {
    if (ui.armed !== 'rm' + x) { ui.armed = 'rm' + x; return render(); }
    meta.players = meta.players.filter(function (p) { return p.id !== x; });
    markGone(x);
    ui.armed = null;
    saveMeta();
    render();
  };
  actions.copyRoster = function () {
    var prev = meta.seasons.filter(function (s) { return s.id !== meta.currentSeasonId; });
    var from = prev[prev.length - 1].id;
    meta.players.filter(function (p) { return p.seasonId === from; }).forEach(function (p) {
      meta.players.push({ id: uid(), seasonId: meta.currentSeasonId, num: p.num, first: p.first, last: p.last });
    });
    saveMeta();
    render();
  };

  // Settings
  actions.newSeason = function () {
    var el = document.getElementById('s-new'), name = (el.value || el.placeholder).trim();
    var s = { id: uid(), name: name };
    meta.seasons.push(s);
    meta.currentSeasonId = s.id;
    saveMeta();
    toast('Started season ' + name + '. Add or copy the roster next.');
    go('#roster');
  };
  actions.loadSample = function () {
    var s = window.SBSample.build(meta, uid);
    s.players.forEach(function (p) { meta.players.push(p); });
    s.games.forEach(function (g) { games.push(g); saveGame(g); });
    s.schedule.forEach(function (x) { meta.schedule.push(x); });
    saveMeta();
    toast(testMode ? 'Sample games added for this test.' : 'Sample games added.');
    go('#home');
  };

  // Test mode on: from here on nothing is saved (see testMode). A bar along the bottom says so.
  actions.testStart = function (x) {
    testMode = true;
    document.body.className += ' test-mode';
    var bar = document.createElement('div');
    bar.id = 'testbar';
    bar.innerHTML = '<span>TEST MODE · nothing is saved</span><button type="button">Exit</button>';
    bar.querySelector('button').onclick = function () { reloadNow(); };
    document.body.appendChild(bar);
    if (x === 'sample') { actions.loadSample(); return; }
    toast('Test mode is on. Nothing you do now is saved.');
    go('#home');
  };
  actions.testExit = function () { reloadNow(); };
  actions.removeSample = function () {
    if (ui.armed !== 'rmSample') { ui.armed = 'rmSample'; return render(); }
    ui.armed = null;
    games.filter(function (g) { return g.sample; }).forEach(function (g) { removeGame(g.id); });
    games = games.filter(function (g) { return !g.sample; });
    meta.players.concat(meta.schedule).forEach(function (x) { if (x.sample) markGone(x.id); });
    meta.players = meta.players.filter(function (p) { return !p.sample; });
    meta.schedule = meta.schedule.filter(function (s) { return !s.sample; });
    saveMeta();
    toast('Sample data removed.');
    render();
  };
  // Cloud sign-in (see startCloud)
  actions.signIn = function () {
    Cloud.signIn()['catch'](function (e) {
      var code = (e && e.code) || '';
      if (/popup-closed|cancelled-popup/.test(code)) return;
      showGate('signin', '', /network/.test(code) ? 'No internet connection. Connect to Wi-Fi to sign in the first time.'
        : /unauthorized-domain/.test(code) ? 'This address isn’t set up for sign-in yet (Firebase → Authentication → Settings → Authorized domains).'
        : 'Sign-in didn’t work (' + code + ').');
    });
  };
  actions.signInOther = function () { Cloud.signOut().then(function () { actions.signIn(); }); };
  actions.reload = function () { reloadNow(); };

  // Automatic backups (cloud snapshots of the record).
  function histWhen(x) {
    var d = new Date(x.at || 0), day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
    var hr = d.getHours(), mn = d.getMinutes();
    return day + ' ' + R.fmtDate(d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2)).replace(/, \d{4}$/, '') + ', ' +
      ((hr % 12) || 12) + ':' + ('0' + mn).slice(-2) + (hr < 12 ? ' AM' : ' PM');
  }
  actions.loadHistory = function () {
    ui.history = 'loading'; render();
    Cloud.listHistory(function (err, list) { ui.history = err ? { error: err.message || String(err) } : list; render(); });
  };
  actions.restoreHistory = function (x) {
    var snap = ui.history && ui.history[+x];
    if (!snap || !snap.meta) return;
    if (ui.armed !== 'hist' + x) { ui.armed = 'hist' + x; return render(); }
    ui.armed = null;
    if (!navigator.onLine || !pulledNow) { toast('Connect to the internet first, then try again.'); return render(); }
    meta = JSON.parse(JSON.stringify(snap.meta));
    meta.schedule = meta.schedule || [];
    meta.gen = Date.now();   // replaces (not merges) on every tablet
    saveMeta();
    applyTheme();
    ui.history = null;
    toast('Restored the roster, schedule and settings from ' + histWhen(snap) + '.', 5000);
    render();
  };
  actions.signOut = function () {
    if (ui.armed !== 'signout') { ui.armed = 'signout'; return render(); }
    ui.armed = null;
    Cloud.signOut();
  };

  actions.checkUpdate = function () {
    if (!swReg) { toast('Updates only apply to the https address, where they’re checked automatically.'); return; }
    ui.reloadOnUpdate = true;
    toast('Checking for updates…');
    swReg.update().then(function () {
      // If a new version was found, it's installing and the page reloads when it takes over.
      if (!swReg.installing && !swReg.waiting) { ui.reloadOnUpdate = false; toast('You have the latest version.'); }
    })['catch'](function () { ui.reloadOnUpdate = false; toast('Couldn’t check for updates. Is the tablet online?'); });
  };

  actions.exportAll = function () {
    var data = { app: 'scorebook', version: 1, exported: new Date().toISOString(), meta: meta, games: games };
    download('scorebook-backup-' + today() + '.json', JSON.stringify(data), 'application/json');
    toast('Backup saved to Downloads.');
  };

  // Report
  actions.repNames = function (x) { ui.reportNames = x; render(); };
  actions.print = function () { document.documentElement.classList.remove('print-stats'); window.print(); };

  // ----- Stats actions -----
  actions.statView = function (x) { ui.statView = x; render(); };
  // Tap a column: highest first; again: lowest first; a third time: back to the default (games played).
  actions.statSort = function (x) {
    var s = ui.statSort || { k: 'gp', dir: 'desc' };
    if (s.k !== x) ui.statSort = { k: x, dir: 'desc' };
    else if (s.dir === 'desc') ui.statSort = { k: x, dir: 'asc' };
    else ui.statSort = null;
    render();
  };
  // Search: a player or game opens it; a stat opens the right players view sorted by it, or the
  // sheet that has it, scrolled to the line.
  actions.sqGo = function (x) {
    var r = sqResults[+x];
    if (!r) return;
    ui.statQ = ''; ui.sqOpen = false;
    if (r.go) return go(r.go);
    var st = r.stat, views = window.SBStats.VIEWS;
    if (views[st[2]]) { ui.statView = st[2]; ui.statSort = { k: st[3], dir: 'desc' }; go('#stats/players'); return; }
    go('#stats/' + st[2]);
    if (st[3]) setTimeout(function () { focusStatLabel(st[3]); }, 60);
  };
  actions.sqOpen = function () {
    ui.sqOpen = true; ui.sqAnim = true;
    render();
    ui.sqAnim = false;
    var i = document.getElementById('stat-q'); if (i) i.focus();
    // The growing animation clips its contents; unclip once it's done so the results list shows.
    setTimeout(function () { var el = document.querySelector('.hd-search.grow'); if (el) el.classList.remove('grow'); }, 300);
  };
  // Shrinks the field back to the icon, then clears the search.
  actions.sqClose = function () {
    var el = document.querySelector('.hd-search');
    function done() { ui.sqOpen = false; ui.statQ = ''; render(); }
    if (el && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) { el.classList.add('shrink'); setTimeout(done, 170); } else done();
  };
  actions.sqClear = function () { ui.statQ = ''; var i = document.getElementById('stat-q'); if (i) i.value = ''; applyStatSearch(false); };
  actions.printStats = function () {
    var sel = {};
    if (route.name === 'player') sel['player:' + route.id] = true;
    else { var t = route.id || 'team'; sel[t === 'players' ? 'players:' + (ui.statView || 'pergame') : t] = true; }
    ui.printSel = sel; ui.drawer = 'print';
    render();
  };
  actions.printToggle = function (x) { ui.printSel = ui.printSel || {}; ui.printSel[x] = !ui.printSel[x]; render(); };
  actions.printGo = function () {
    var sel = ui.printSel || {}, S = statsData(), ctx = statsCtx(true), SS = window.SBStats, out = [];
    var order = ['team', 'players:pergame', 'players:totals', 'players:shooting', 'players:advanced', 'leaders', 'lineups', 'games'];
    Object.keys(sel).forEach(function (k) { if (sel[k] && /^player:/.test(k)) out.push(SS.player(S, ctx, k.slice(7))); });
    order.forEach(function (k) {
      if (!sel[k]) return;
      out.push(k.indexOf('players:') === 0 ? SS.players(S, ctx, k.slice(8)) : SS[k](S, ctx));
    });
    if (sel.allplayers) seasonPlayers().forEach(function (p) { if (S.players[p.id] && S.players[p.id].gp) out.push(SS.player(S, ctx, p.id)); });
    var root = document.getElementById('print-root');
    if (!root) { root = document.createElement('div'); root.id = 'print-root'; document.body.appendChild(root); }
    root.innerHTML = out.join('');
    document.documentElement.classList.add('print-stats');
    ui.drawer = null;
    render();
    setTimeout(function () { window.print(); }, 60);
  };

  function reportFileName(g) { return slug(meta.team.short || meta.team.name) + '-vs-' + slug(g.opponent) + '-' + g.date + '.html'; }

  actions.dlReport = function () {
    var g = gameById(route.id), names = ui.reportNames || meta.settings.names;
    download(reportFileName(g), R.standalone(g, meta, { names: names, logo: logoData }), 'text/html');
    toast('Report file saved to Downloads.');
  };

  // Sends the report file through the tablet's share menu (Bluetooth, Gmail, Drive, …), which
  // works without Wi-Fi for Bluetooth. The email-style summary goes along as the message text.
  actions.shareReport = function () {
    var g = gameById(route.id), names = ui.reportNames || meta.settings.names;
    var file = new File([R.standalone(g, meta, { names: names, logo: logoData })], reportFileName(g), { type: 'text/html' });
    if (!canShareFiles([file])) { toast('This browser can’t share files. Use Save file instead.'); return; }
    navigator.share({ files: [file], title: R.title(g, meta), text: R.plainText(g, meta, { names: names, url: g.publishedUrl }) })['catch'](function (err) {
      if (err && err.name !== 'AbortError') toast('Couldn’t share the file (' + err.name + '). Use Save file instead.');
    });
  };
  actions.email = function () {
    var g = gameById(route.id), names = ui.reportNames || meta.settings.names;
    var subject = R.title(g, meta), body = R.plainText(g, meta, { names: names, url: g.publishedUrl });
    if (navigator.share && g.publishedUrl) {
      navigator.share({ title: subject, text: body, url: g.publishedUrl })['catch'](function () {});
      return;
    }
    location.href = 'mailto:?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
  };
  actions.publish = function () {
    var g = gameById(route.id), s = meta.settings, names = ui.reportNames || s.names;
    if (!s.publishUrl) { toast('Add a publish address in Settings first.'); return; }
    if (!navigator.onLine) { toast('No connection. Publish when you’re back on Wi-Fi.'); return; }
    if (!g.publishId) g.publishId = randomId(22);
    var xhr = new XMLHttpRequest();
    xhr.open('PUT', s.publishUrl.replace(/\/+$/, '') + '/r/' + g.publishId);
    xhr.setRequestHeader('Content-Type', 'text/html; charset=utf-8');
    if (s.publishKey) xhr.setRequestHeader('Authorization', 'Bearer ' + s.publishKey);
    xhr.timeout = 20000;
    xhr.onload = function () {
      if (xhr.status >= 200 && xhr.status < 300) {
        g.publishedUrl = s.publishUrl.replace(/\/+$/, '') + '/r/' + g.publishId;
        saveGame(g);
        toast('Published. Tap Email to send the link.');
        render();
      } else toast('Publish failed (' + xhr.status + '). Check the address and key in Settings.');
    };
    xhr.onerror = xhr.ontimeout = function () { toast('Publish failed: no response from the server.'); };
    toast('Publishing…');
    xhr.send(R.standalone(g, meta, { names: names, logo: logoData }));
  };

  actions.deleteGame = function () {
    var g = gameById(route.id);
    if (gameLocked(g)) { toast('This game is locked. Finished games can only be deleted in the database.'); return; }
    if (ui.armed !== 'del' + g.id) { ui.armed = 'del' + g.id; return render(); }
    ui.armed = null;
    games = games.filter(function (x) { return x.id !== g.id; });
    removeGame(g.id);
    toast('Game deleted.');
    go('#home');
  };

  // ---------- event wiring ----------
  var TWO_TAP = { rmEvent: 1, rmPlayer: 1, removeSample: 1, deleteGame: 1, rmSched: 1, signOut: 1, restoreHistory: 1 };
  function closest(el, attr) {
    while (el && el !== document) { if (el.getAttribute && el.getAttribute(attr) !== null) return el; el = el.parentNode; }
    return null;
  }

  app.addEventListener('click', function (ev) {
    if (!wakeLock) syncWake();
    var el = closest(ev.target, 'data-a');
    if (!el || el.disabled) return;
    // Scrim closes only when the dark area itself is tapped.
    if (el.getAttribute('data-self') && ev.target !== el) return;
    var a = el.getAttribute('data-a');
    if (!actions[a]) return;
    ev.preventDefault();
    // Any action other than answering the prompt dismisses it.
    if (a !== 'promptPick' && a !== 'promptSkip') ui.prompt = null;
    // Two-tap confirm buttons keep their armed state; any other tap disarms them.
    if (!TWO_TAP[a]) ui.armed = null;    actions[a](el.getAttribute('data-x'));
  });

  // Form inputs: edits save immediately; no submit buttons for settings.
  app.addEventListener('change', function (ev) {
    var el = ev.target, k;
    if ((k = el.getAttribute('data-edit'))) {
      var p = player(el.getAttribute('data-x'));
      if (p) { p[k] = el.value.trim(); saveMeta(); }
    } else if (el.getAttribute('data-statfilter')) {
      ui.statFilter = el.value; render();
    } else if ((k = el.getAttribute('data-draft'))) {
      draft[k] = el.value;
    } else if ((k = el.getAttribute('data-team'))) {
      meta.team[k] = el.value.trim() || meta.team[k];
      saveMeta(); applyTheme();
    } else if ((k = el.getAttribute('data-rule'))) {
      meta.settings.rules = C.copyRules(meta.settings.rules);
      meta.settings.rules[k] = ruleValue(k, el.value);
      saveMeta();
    } else if ((k = el.getAttribute('data-drule'))) {
      draft.rules[k] = ruleValue(k, el.value);
    } else if ((k = el.getAttribute('data-grule'))) {
      // Rules of the game being scored: fouls, bonus and timeouts are recomputed from the plays.
      var lg = gameById(route.id);
      lg.rules = C.copyRules(lg.rules);
      lg.rules[k] = ruleValue(k, el.value);
      saveGame(lg);
      render();
    } else if ((k = el.getAttribute('data-pct'))) {
      meta.settings.pct = meta.settings.pct || {};
      meta.settings.pct[k] = el.value === '1';
      saveMeta();
    } else if ((k = el.getAttribute('data-setting'))) {
      meta.settings[k] = el.value.trim();
      saveMeta();
      if (k === 'keepAwake') { syncWake(); render(); }
    } else if (el.getAttribute('data-season')) {
      meta.currentSeasonId = el.value;
      saveMeta(); toast('Switched season.');
    } else if (el.getAttribute('data-import')) {
      importBackup(el.files && el.files[0]);
    } else if (el.getAttribute('data-schedfile')) {
      var f = el.files && el.files[0];
      if (!f) return;
      if (/\.xlsx?$/i.test(f.name)) { toast('Save the spreadsheet as CSV first (File → Download → CSV), then upload that.'); el.value = ''; return; }
      var rd = new FileReader();
      rd.onload = function () { readSchedule(String(rd.result)); };
      rd.readAsText(f);
      el.value = '';
    }
  });

  app.addEventListener('input', function (ev) {
    var k = ev.target.getAttribute('data-draft');
    if (k) draft[k] = ev.target.value;
    if (k === 'oppNumsText') draft.oppEdited = { key: oppKey(draft.opponent), fromAuto: !!draft.oppAuto };
    // Typing the opponent's name fills in the numbers from games against them (without a re-render,
    // which would drop the keyboard).
    if (k === 'opponent') {
      var note = autofillOpp(), nf = document.getElementById('ng-nums'), nn = document.getElementById('ng-nums-note');
      if (nf && nf.value !== draft.oppNumsText) nf.value = draft.oppNumsText;
      if (nn) nn.textContent = note || 'Entering their numbers now sets up their column before tip-off. You can still add numbers during the game.';
    }
    if (ev.target.getAttribute('data-schedtext')) ui.schedText = ev.target.value;
    if (ev.target.getAttribute('data-statq')) { ui.statQ = ev.target.value; applyStatSearch(true); }
  });

  app.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var f = ev.target;
    if (f.getAttribute('data-form') === 'addSched') {
      var sOpp = f.opponent.value.trim();
      if (!f.date.value || !sOpp) return;
      meta.schedule.push({ id: uid(), seasonId: meta.currentSeasonId, date: f.date.value, time: f.time.value.trim(), opponent: sOpp,
        homeAway: f.homeAway.value, location: f.location.value.trim(), gameId: null });
      saveMeta();
      toast('Added ' + (f.homeAway.value === 'away' ? '@ ' : 'vs ') + sOpp + '.');
      render();
      return;
    }
    if (f.getAttribute('data-form') === 'addPlayer') {
      var num = f.num.value.trim(), first = f.first.value.trim(), last = f.last.value.trim();
      if (!first) return;
      if (num && seasonPlayers().some(function (p) { return p.num === num; })) { toast('Jersey #' + num + ' is already on the roster.'); return; }
      meta.players.push({ id: uid(), seasonId: meta.currentSeasonId, num: num, first: first, last: last });
      saveMeta();
      ui.rosterOpen = true;
      render();
      var n = document.getElementById('np-num'); if (n) { n.focus(); n.scrollIntoView({ block: 'center' }); }
    }
  });

  app.addEventListener('keydown', function (ev) {
    if (!ev.target.getAttribute || !ev.target.getAttribute('data-statq')) return;
    if (ev.key === 'Enter') { ev.preventDefault(); if (sqResults.length) actions.sqGo('0'); }
    else if (ev.key === 'Escape') actions.sqClose();
  });
  app.addEventListener('focusin', function (ev) { if (ev.target.getAttribute && ev.target.getAttribute('data-statq') && ui.statQ) applyStatSearch(true); });
  app.addEventListener('focusout', function (ev) {
    if (!ev.target.getAttribute || !ev.target.getAttribute('data-statq')) return;
    setTimeout(function () { var b = document.getElementById('sq-res'); if (b && document.activeElement !== ev.target) b.hidden = true; }, 200);
  });

  function importBackup(file) {
    if (!file) return;
    if (testMode) { toast('Exit test mode before restoring a backup.'); return; }
    var rd = new FileReader();
    rd.onload = function () {
      var data;
      try { data = JSON.parse(rd.result); } catch (e) { return toast('That file isn’t a scorebook backup.'); }
      if (!data || data.app !== 'scorebook' || !data.meta || !data.games) return toast('That file isn’t a scorebook backup.');
      DB.replaceAll(data.meta, data.games, function (err) {
        if (err) return toast('Restore failed: ' + err);
        meta = data.meta; games = data.games;
        meta.schedule = meta.schedule || [];
        // The restored copy becomes the cloud copy too.
        if (syncing) {
          meta.updated = Date.now();
          meta.gen = Date.now();   // newer generation: replaces, not merges, on other tablets
          delete meta.fresh;
          games.forEach(function (g) { g.updated = Date.now(); g.synced = true; });
          Cloud.replaceAll(meta, games);
        }
        applyTheme();
        toast('Restored ' + games.length + ' games.');
        go('#home');
      });
    };
    rd.readAsText(file);
  }

  // Offline support. Skipped on localhost so edits show up immediately while developing.
  // Checks for a new version on launch and whenever the app comes back to the screen (home-screen
  // apps on iPad resume without reloading). A new version takes over at once (skipWaiting in sw.js).
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    var hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').then(function (reg) {
      swReg = reg;
      reg.update()['catch'](function () {});
    })['catch'](function () {});
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (ui.reloadOnUpdate) { reloadNow(); return; }
      if (hadController) toast('A new version is ready. Reload the page to use it.', 6000);
      hadController = true;
      askVersion();
    });
    document.addEventListener('visibilitychange', function () {
      if (swReg && document.visibilityState === 'visible') swReg.update()['catch'](function () {});
    });
    askVersion();
  }

  boot();
})();
