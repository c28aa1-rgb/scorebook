/*
 * Scorebook app: routing, screens and input handling.
 * Rendering is plain innerHTML per screen with one delegated click handler;
 * elements opt in with data-a="action" and data-x="argument". ES5.
 */
(function () {
  'use strict';
  var C = window.SBCore, DB = window.SBDB, R = window.SBReport, esc = R.esc;
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

  function saveMeta() { DB.saveMeta(meta, function (err) { if (err) toast('Could not save. Storage may be full.'); }); }
  function saveGame(g) { DB.saveGame(g, function (err) { if (err) toast('Could not save game. Storage may be full.'); }); }

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

  function boot() {
    DB.open(function () {
      DB.loadMeta(function (err, m) {
        meta = m || defaultMeta();
        if (!m) saveMeta();
        meta.schedule = meta.schedule || [];   // added after the first version
        DB.loadGames(function (err2, gs) {
          games = gs || [];
          applyTheme();
          window.addEventListener('hashchange', onRoute);
          window.addEventListener('resize', fitScale);
          document.addEventListener('visibilitychange', syncWake);
          window.addEventListener('focus', syncWake);
          window.addEventListener('pageshow', syncWake);
          document.addEventListener('fullscreenchange', onFullscreen);
          document.addEventListener('webkitfullscreenchange', onFullscreen);
          onRoute();
        });
      });
    });
  }

  function onFullscreen() { fitScale(); render(); }

  function go(hash) { if (location.hash === hash) onRoute(); else location.hash = hash; }

  function onRoute() {
    var parts = (location.hash || '#home').slice(1).split('/');
    route = { name: parts[0] || 'home', id: parts[1] || null };
    ui.drawer = null; ui.prompt = null; ui.armed = null;
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
    var fn = screens[route.name] || screens.home;
    app.innerHTML = route.name === 'game' ? fn() : '<div class="pg">' + fn() + '</div>';
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
    var who;
    if (e.t === 'timeout') who = e.tm === 'us' ? meta.team.name : (g.opponent || 'Opponent');
    else if (e.tm === 'us') { var p = player(e.p) || R.findPlayer(g, meta, e.p); who = p ? '#' + p.num + ' ' + shortName(p) : 'Player'; }
    else who = e.p ? (g.opponent || 'Opp') + ' #' + e.p : (g.opponent || 'Opponent');
    var what = {
      make: { 1: 'made free throw', 2: 'made 2', 3: 'made 3' },
      miss: { 1: 'missed free throw', 2: 'missed 2', 3: 'missed 3' }
    };
    var d;
    if (e.t === 'make' || e.t === 'miss') d = what[e.t][e.v];
    else if (e.t === 'reb') d = e.v === 'o' ? 'offensive rebound' : 'defensive rebound';
    else if (e.t === 'foul') d = e.v === 't' ? 'technical foul' : e.of ? 'offensive foul' : 'foul';
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
    h.push(pageHead(meta.team.name + ' · ' + season.name, '',
      (fsAvailable() ? '<button class="btn sm" data-a="fullscreen">' + (fsActive() ? 'Exit full screen' : 'Full screen') + '</button>' : '') +
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
    h.push('<h2>Season stats</h2>');
    h.push(seasonTable(s));
    if (finals.length) h.push('<p class="note">Tap a player for their game-by-game log.</p>');
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
        return '<li><button data-a="go" data-x="#player/' + x.p.id + '"><span class="jr">' + esc(x.p.num) + '</span>' +
          esc(shortName(x.p)) + '<b>' + v + '</b></button></li>';
      }).join('') + '</ol>');
      h.push('</div>');
    });
    h.push('</div>');
    return h.join('');
  }

  function seasonTable(s) {
    var ps = seasonPlayers();
    if (!ps.length) return '<p class="note">Season totals appear here once you have a roster and finished games.</p>';
    var on = C.pctShown(meta.settings);
    var h = ['<div class="tw"><table class="st"><thead><tr><th class="l">#</th><th class="l">Player</th><th>GP</th>',
      '<th>PTS</th><th>PPG</th><th>REB</th><th>RPG</th><th>AST</th><th>STL</th><th>CHG</th><th>TO</th><th>FG%</th><th>3P%</th><th>FT%</th><th>PF</th><th>+/−</th></tr></thead><tbody>'];
    ps.forEach(function (p) {
      var row = s.players[p.id] || { gp: 0, line: C.emptyLine(), pm: 0, pmGp: 0 }, l = row.line, reb = l.oreb + l.dreb;
      h.push('<tr class="tap" data-a="go" data-x="#player/' + p.id + '"><td class="l b">' + esc(p.num) + '</td><td class="l nm">' + esc(shortName(p)) + '</td><td>' + row.gp +
        '</td><td>' + l.pts + '</td><td class="b">' + avg(l.pts, row.gp) + '</td><td>' + reb + '</td><td>' + avg(reb, row.gp) +
        '</td><td>' + l.ast + '</td><td>' + l.stl + '</td><td>' + (l.chg || 0) + '</td><td>' + l.to + '</td><td>' + C.showPct(on.fg, l.fgm, l.fga) + '</td><td>' +
        C.showPct(on.tp, l.tpm, l.tpa) + '</td><td>' + C.showPct(on.ft, l.ftm, l.fta) + '</td><td>' + l.pf + '</td><td>' +
        (row.pmGp ? C.fmtPm(row.pm) : '—') + '</td></tr>');
    });
    h.push('</tbody></table></div>');
    return h.join('');
  }

  // ----- Player game log -----
  screens.player = function () {
    var p = player(route.id), season = find(meta.seasons, meta.currentSeasonId);
    if (!p) return pageHead('Player not found', backBtn('#home', 'Home'), '');
    var finals = seasonFinals();
    var s = C.computeSeason(finals, seasonPlayers()), r = s.players[p.id] || { gp: 0, line: C.emptyLine(), pm: 0, pmGp: 0, games: [] };
    var on = C.pctShown(meta.settings), t = r.line, gp = r.gp;
    var h = [pageHead('#' + p.num + ' ' + ((p.first || '') + ' ' + (p.last || '')).trim() + ' · ' + season.name, backBtn('#home', 'Home'), '')];
    h.push('<div class="pg-bd">');
    h.push('<div class="record">' + [
      [gp, 'Games'], [avg(t.pts, gp), 'Pts / game'], [avg(t.oreb + t.dreb, gp), 'Reb / game'], [avg(t.ast, gp), 'Ast / game'],
      [avg(t.stl, gp), 'Stl / game'], [t.chg || 0, 'Charges'], [r.pmGp ? C.fmtPm(r.pm) : '—', 'Plus/minus']
    ].map(function (x) { return '<div><b class="num">' + x[0] + '</b><span>' + x[1] + '</span></div>'; }).join('') + '</div>');
    h.push('<h2>Game log</h2>');
    if (!r.games.length) { h.push('<p class="note">No finished games yet this season.</p></div>'); return h.join(''); }
    function ma(m, a) { return m + '-' + a; }
    function cells(l, pm) {
      return '<td class="b">' + l.pts + '</td><td>' + (l.oreb + l.dreb) + '</td><td>' + l.ast + '</td><td>' + l.stl + '</td><td>' + l.blk +
        '</td><td>' + (l.chg || 0) + '</td><td>' + l.to + '</td><td>' + l.pf + '</td><td>' + ma(l.fgm, l.fga) + '</td><td>' + ma(l.tpm, l.tpa) +
        '</td><td>' + ma(l.ftm, l.fta) + '</td><td>' + pm + '</td>';
    }
    h.push('<div class="tw"><table class="st"><thead><tr><th class="l">Date</th><th class="l">Opponent</th><th class="l">Result</th>' +
      '<th>PTS</th><th>REB</th><th>AST</th><th>STL</th><th>BLK</th><th>CHG</th><th>TO</th><th>PF</th><th>FG</th><th>3P</th><th>FT</th><th>+/−</th></tr></thead><tbody>');
    r.games.forEach(function (x) {
      var res = x.us > x.them ? 'W' : x.us < x.them ? 'L' : 'T';
      h.push('<tr class="tap" data-a="go" data-x="#report/' + x.id + '"><td class="l">' + esc(R.fmtDate(x.date)) + '</td><td class="l nm">' +
        (x.homeAway === 'away' ? '@ ' : 'vs ') + esc(x.opponent) + '</td><td class="l b">' + res + ' ' + x.us + '–' + x.them + '</td>' +
        cells(x.line, C.fmtPm(x.pm)) + '</tr>');
    });
    h.push('<tr class="tot"><td class="l" colspan="3">Totals</td>' + cells(t, r.pmGp ? C.fmtPm(r.pm) : '—') + '</tr>');
    h.push('<tr class="tot"><td class="l" colspan="3">Per game</td><td class="b">' + avg(t.pts, gp) + '</td><td>' + avg(t.oreb + t.dreb, gp) +
      '</td><td>' + avg(t.ast, gp) + '</td><td>' + avg(t.stl, gp) + '</td><td>' + avg(t.blk, gp) + '</td><td>' + avg(t.chg || 0, gp) +
      '</td><td>' + avg(t.to, gp) + '</td><td>' + avg(t.pf, gp) + '</td><td>' + C.showPct(on.fg, t.fgm, t.fga) + (on.fg && t.fga ? '%' : '') +
      '</td><td>' + C.showPct(on.tp, t.tpm, t.tpa) + (on.tp && t.tpa ? '%' : '') + '</td><td>' + C.showPct(on.ft, t.ftm, t.fta) + (on.ft && t.fta ? '%' : '') +
      '</td><td>' + (r.pmGp ? (r.pm > 0 ? '+' : '') + avg(r.pm, r.pmGp) : '—') + '</td></tr>');
    h.push('</tbody></table></div><p class="note">Tap a game to open its report. Plus/minus counts only games that recorded substitutions.</p>');
    h.push('</div>');
    return h.join('');
  };

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
      right = '<button class="btn sm pri" data-a="startScheduled" data-x="' + x.id + '">Start game</button>';
    }
    var armed = ui.armed === 'sch' + x.id;
    return '<li class="sch-row"><span class="sch-when"><b>' + esc(R.fmtDate(x.date).replace(/, \d{4}$/, '')) + '</b><small>' + esc(weekday(x.date)) +
      (x.time ? ' · ' + esc(x.time) : '') + '</small></span><span class="op">' + (x.homeAway === 'away' ? '@ ' : 'vs ') + esc(x.opponent) +
      (x.location ? '<small>' + esc(x.location) + '</small>' : '') + '</span>' + right +
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
    } else {
      h.push('<h2>Add your schedule</h2><p class="note">Upload a spreadsheet saved as CSV (Google Sheets: File → Download → CSV; Excel: Save As → CSV), ' +
        'or paste the schedule below, one game per line. Columns can be in any order: date, opponent, home/away, location, time. ' +
        'Lines like “Tue Dec 2 @ Trinity 4:30 PM” or “12/5 vs Riverdale” work too.</p>' +
        '<div class="form"><label class="btn" for="sch-file">Upload a file…</label><input id="sch-file" type="file" accept=".csv,.txt,.tsv,text/csv,text/plain" class="sr" data-schedfile="1"></div>' +
        '<div class="fld" style="margin-top:0.75rem"><label for="sch-text">Or paste it here</label><textarea id="sch-text" rows="6" data-schedtext="1" placeholder="Tue Dec 2 @ Trinity 4:30 PM&#10;Fri Dec 5 vs Riverdale 6:00 PM&#10;1/9/27, Collegiate, Away, Collegiate Gym">' +
        esc(ui.schedText || '') + '</textarea></div><div class="form"><button class="btn pri" data-a="schedRead">Read schedule</button></div>');
      h.push('<h2>Add one game</h2><form class="form" data-form="addSched">' +
        '<div class="fld xs" style="flex-basis:11rem"><label for="sa-date">Date</label><input id="sa-date" name="date" type="date" required></div>' +
        '<div class="fld xs" style="flex-basis:8rem"><label for="sa-time">Time</label><input id="sa-time" name="time" placeholder="4:30 PM" autocomplete="off"></div>' +
        '<div class="fld"><label for="sa-opp">Opponent</label><input id="sa-opp" name="opponent" required autocomplete="off"></div>' +
        '<div class="fld xs" style="flex-basis:9rem"><label for="sa-side">Side</label><select id="sa-side" name="homeAway"><option value="home">Home</option><option value="away">Away</option></select></div>' +
        '<div class="fld"><label for="sa-loc">Location</label><input id="sa-loc" name="location" autocomplete="off"></div>' +
        '<div class="fld xs"><span class="lab">&nbsp;</span><button class="btn pri" type="submit">Add</button></div></form>');
    }
    h.push('<h2>' + list.length + ' scheduled game' + (list.length === 1 ? '' : 's') + '</h2>');
    if (!list.length) h.push('<p class="note">Nothing scheduled yet. Upcoming games show on the home screen with a Start game button.</p>');
    else h.push('<ul class="games sched">' + list.map(function (x) { return schedRow(x, true); }).join('') + '</ul>');
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
    h.push('<h2>Add a player</h2>');
    h.push('<form class="form" data-form="addPlayer">' +
      '<div class="fld xs"><label for="np-num">Jersey</label><input id="np-num" name="num" inputmode="numeric" maxlength="2" autocomplete="off" required></div>' +
      '<div class="fld"><label for="np-first">First name</label><input id="np-first" name="first" autocomplete="off" required></div>' +
      '<div class="fld"><label for="np-last">Last name</label><input id="np-last" name="last" autocomplete="off"></div>' +
      '<div class="fld xs"><span class="lab">&nbsp;</span><button class="btn pri" type="submit">Add</button></div></form>');
    h.push('<h2>' + ps.length + ' players</h2>');
    if (!ps.length) {
      var prev = meta.seasons.filter(function (s) { return s.id !== meta.currentSeasonId; });
      h.push('<p class="note">Add each player once. Names can be hidden on shared reports in Settings.</p>');
      if (prev.length) h.push('<button class="btn" data-a="copyRoster">Copy roster from ' + esc(prev[prev.length - 1].name) + '</button>');
    }
    h.push('<ul class="roster">');
    ps.forEach(function (p) {
      h.push('<li><input class="rn" value="' + esc(p.num) + '" maxlength="2" inputmode="numeric" data-edit="num" data-x="' + p.id + '" aria-label="Jersey">' +
        '<input class="rf" value="' + esc(p.first) + '" data-edit="first" data-x="' + p.id + '" aria-label="First name">' +
        '<input class="rl" value="' + esc(p.last) + '" data-edit="last" data-x="' + p.id + '" aria-label="Last name">' +
        '<button class="btn sm danger' + (ui.armed === 'rm' + p.id ? ' armed' : '') + '" data-a="rmPlayer" data-x="' + p.id + '">' +
        (ui.armed === 'rm' + p.id ? 'Confirm remove' : 'Remove') + '</button></li>');
    });
    h.push('</ul></div>');
    return h.join('');
  };

  // ----- New game -----
  var draft = null;
  screens['new'] = function () {
    var ps = seasonPlayers();
    if (!draft) draft = { opponent: '', date: today(), location: '', homeAway: 'home', starters: [] };
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
    h.push('</div><p class="note">Entering their numbers now sets up their column before tip-off. You can still add numbers during the game.</p>');
    h.push('<h2>Starters · ' + draft.starters.length + ' of 5</h2><div class="pick">');
    ps.forEach(function (p) {
      var on = draft.starters.indexOf(p.id) >= 0;
      h.push('<button class="bp' + (on ? ' on' : '') + '" data-a="draftStarter" data-x="' + p.id + '"><span class="num">' + esc(p.num) +
        '</span><span>' + esc(shortName(p)) + '</span></button>');
    });
    h.push('</div>');
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
    h.push('<div class="tm ' + tm + '"><span class="tm-score">' + c.score[tm] + '</span><div class="tm-info">');
    h.push('<span class="tm-name">' + esc(name) + '</span>');
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
        '<span class="jr">' + esc(p.num) + '</span><span class="nm"><b>' + esc(shortName(p)) + '</b><small>FG ' + l.fgm + '/' + l.fga +
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
        h.push('<button class="qk" data-a="promptPick" data-x="' + id + '">' + esc(p.num) + '</button>');
      });
      if (pr.k === 'reb') h.push('<button class="qk" data-a="promptPick" data-x="them" style="font-family:var(--f-body);font-size:.8rem">Theirs</button>');
      h.push('<button class="qk no" data-a="promptSkip">' + (pr.k === 'ast' ? 'No assist' : 'Skip') + '</button></div>');
      return h.join('');
    }
    if (ui.msg) return '<div class="pad-head msg"><span class="lbl">' + esc(ui.msg) + '</span></div>';
    if (ui.side === 'us') {
      var p = ui.sel ? player(ui.sel) : null;
      return '<div class="pad-head"><span class="lbl">' + (p ? '#' + esc(p.num) + ' ' + esc(shortName(p)) + ' <em>— what happened?</em>'
        : '<em>Tap a player, then what they did</em>') + '</span></div>';
    }
    return '<div class="pad-head"><span class="lbl">' + esc(g.opponent) + ' ' + (ui.oppSel ? '#' + esc(ui.oppSel) : '<em>team (no number)</em>') +
      ' <em>— what happened?</em></span></div>';
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
          (!on && why ? ' disabled' : '') + '><span class="num">' + esc(p.num) + '</span><span>' + esc(shortName(p)) + '<small>' + l.pts + ' pts · ' + l.pf + ' PF' +
          (l.tf ? ' · ' + l.tf + 'T' : '') + (why ? (why === 'ejected' ? ' · EJECTED' : ' · OUT') : '') + '</small></span></button>';
      };
      if (d === 'replace') {
        h = '<div class="bench">' + bench.map(function (p) { return benchBtn(p, 'replaceWith'); }).join('') + '</div>';
        return sheet('Who’s coming in for ' + subName(ui.subOut) + '?', h,
          '<button class="btn ghost" data-a="drawer" data-x="bench">Other subs</button><button class="btn" data-a="closeDrawer">Cancel</button>');
      }
      var hint;
      if (pend && pend.on) hint = '<b>' + esc(subName(pend.id)) + ' going out.</b> Tap who’s coming in, or tap them again to just take them off.';
      else if (pend) hint = '<b>' + esc(subName(pend.id)) + ' coming in.</b> Tap who’s going out.';
      else if (court.length < 5) hint = 'Tap bench players to put them in (' + (5 - court.length) + ' open spot' + (court.length === 4 ? '' : 's') + ').';
      else hint = 'Tap who’s coming in and who’s going out, in either order. Make as many swaps as you need.';
      h = '<p class="sub-hint' + (pend ? ' on' : '') + '">' + hint + '</p>' +
        '<h4 class="bench-hd">On court · ' + court.length + ' of 5</h4><div class="bench">' +
        court.map(function (id) { return benchBtn(player(id) || R.findPlayer(g, meta, id) || { id: id, num: '?' }, 'subTap'); }).join('') + '</div>' +
        '<h4 class="bench-hd">Bench</h4><div class="bench">' + bench.map(function (p) { return benchBtn(p, 'subTap'); }).join('') + '</div>' +
        '<p class="note">Subs entered any time before the next point count exactly for plus/minus, so it’s fine to catch up during free throws.</p>';
      return sheet('Substitutions', h, '<button class="btn pri" data-a="closeDrawer">Done</button>');
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
    h.push('<button class="btn sm danger' + (ui.armed === 'del' + g.id ? ' armed' : '') + '" data-a="deleteGame">' +
      (ui.armed === 'del' + g.id ? 'Confirm delete' : 'Delete game') + '</button>');
    if (live) h.push('<button class="btn sm pri" data-a="go" data-x="#game/' + g.id + '">Back to game</button>');
    else h.push('<button class="btn sm ghost" data-a="reopen">Reopen game</button>');
    h.push('<button class="btn sm" data-a="print">Print</button>');
    h.push('<button class="btn sm" data-a="dlReport">Save file</button>');
    if (SHARE_FILES) h.push('<button class="btn sm" data-a="shareReport">Share file</button>');
    h.push('<button class="btn sm" data-a="publish">' + (g.publishedUrl ? 'Update link' : 'Publish link') + '</button>');
    h.push('<button class="btn sm pri" data-a="email">Email</button>');
    h.push('</div>');
    if (g.publishedUrl) h.push('<p class="pub no-print">Published: <b>' + esc(g.publishedUrl) + '</b></p>');
    h.push('<style>' + R.CSS + '</style><div class="rpt-wrap">' + R.render(g, meta, { names: names }) + '</div>');
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
      sel('shotFoulAward', 'After +1, ask "free throw?"', [['0', 'No (always a free throw)'], ['1', 'Yes (point or free throw)']]) + '</div>' +
      '<h3 class="rules-hd">Timeouts</h3><div class="form rules">' + sel('timeoutsUnlimited', 'Timeouts', [['0', 'Limited'], ['1', 'Unlimited']]) +
      num('timeoutsFull', 'Full') + num('timeoutsShort', '30-second') +
      sel('timeoutsReset', 'Allotment is per', [['game', 'Game'], ['half', 'Half (fresh each half)']]) +
      num('otTimeoutsFull', 'Full added per OT') + num('otTimeoutsShort', '30-sec added per OT') + '</div>';
  }

  var BOOL_RULES = { otFoulsCarry: 1, scoreResets: 1, openEnded: 1, shotFoulAward: 1, timeoutsUnlimited: 1 };
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

    h.push('<h2>Backup</h2><p class="note">Everything is stored on this tablet. Save a backup after each game in case the browser data is cleared.</p>' +
      '<div class="form"><button class="btn" data-a="exportAll">Save backup file</button>' +
      '<label class="btn ghost" for="imp">Restore from backup…</label><input id="imp" type="file" accept=".json,application/json" class="sr" data-import="1"></div>' +
      (DB.usingFallback() ? '<p class="note">Note: this browser is using basic storage (localStorage). Keep backups.</p>' : ''));

    h.push('<h2>App version</h2><p class="note">This tablet is running <b>' +
      esc(swVersion || (location.protocol === 'https:' ? 'version not known yet' : 'the local test copy')) +
      '</b>. New versions install by themselves when the tablet is online; this checks right away.</p>' +
      '<div class="form"><button class="btn" data-a="checkUpdate">Check for updates</button></div>');

    var hasSample = games.some(function (g) { return g.sample; }) || meta.players.some(function (p) { return p.sample; });
    h.push('<h2>Practice</h2><p class="note">Sample games add a demo roster (if yours is empty), one finished game and one game in progress to practice on.</p>' +
      '<div class="form"><button class="btn" data-a="loadSample">Load sample games</button>' +
      (hasSample ? '<button class="btn danger' + (ui.armed === 'rmSample' ? ' armed' : '') + '" data-a="removeSample">' +
        (ui.armed === 'rmSample' ? 'Confirm: remove all sample data' : 'Remove sample data') + '</button>' : '') + '</div>');
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
  actions.side = function (x) { ui.side = x; ui.prompt = null; render(); };
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
      var notes = [foulNotice('#' + p.num + ' ' + shortName(p), after.players[ui.sel], after.rules, v === 't', true)];
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

  function subName(id) { var p = player(id) || {}; return '#' + p.num + ' ' + shortName(p); }

  // Subs sheet: tap who's coming in and who's going out, in either order; the pair is swapped.
  // With an open spot, a bench tap puts the player straight in. Tapping a picked on-court player
  // again takes them off without a replacement.
  actions.subTap = function (x) {
    var g = gameById(route.id), on = g.onCourt.indexOf(x) >= 0, pend = ui.pendSub;
    if (!on && blockedFromCourt(g, x)) return;
    if (pend && pend.id === x) {
      ui.pendSub = null;
      if (on) takeOff(g, x);
    } else if (pend && pend.on !== on) {
      swapPlayers(g, on ? x : pend.id, on ? pend.id : x);
      ui.pendSub = null;
    } else if (!on && g.onCourt.length < 5) {
      putIn(g, x);
    } else {
      ui.pendSub = { id: x, on: on };
    }
    render();
  };

  // SUB key on the pad: with one of our players picked, go straight to "who replaces them?".
  actions.subKey = function () {
    var g = gameById(route.id);
    ui.pendSub = null;
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
    ui.drawer = x; ui.prompt = null; ui.armed = null; ui.pendSub = null;
    if (x === 'keypad') ui.kp = '';
    render();
  };
  actions.closeDrawer = function () { ui.drawer = null; ui.armed = null; ui.kpFor = null; ui.pendSub = null; ui.subOut = null; render(); };
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
    saveMeta();
    render();
  };
  // Opens New game filled in from the schedule; starting it marks the entry as played.
  actions.startScheduled = function (x) {
    var s = find(meta.schedule, x);
    draft = { opponent: s.opponent, date: s.date < today() ? today() : s.date, location: s.location, homeAway: s.homeAway, starters: [], schedId: s.id };
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
    toast('Sample games added.');
    go('#home');
  };
  actions.removeSample = function () {
    if (ui.armed !== 'rmSample') { ui.armed = 'rmSample'; return render(); }
    ui.armed = null;
    games.filter(function (g) { return g.sample; }).forEach(function (g) { DB.deleteGame(g.id); });
    games = games.filter(function (g) { return !g.sample; });
    meta.players = meta.players.filter(function (p) { return !p.sample; });
    meta.schedule = meta.schedule.filter(function (s) { return !s.sample; });
    saveMeta();
    toast('Sample data removed.');
    render();
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
  actions.print = function () { window.print(); };
  function reportFileName(g) { return slug(meta.team.short || meta.team.name) + '-vs-' + slug(g.opponent) + '-' + g.date + '.html'; }

  actions.dlReport = function () {
    var g = gameById(route.id), names = ui.reportNames || meta.settings.names;
    download(reportFileName(g), R.standalone(g, meta, { names: names }), 'text/html');
    toast('Report file saved to Downloads.');
  };

  // Sends the report file through the tablet's share menu (Bluetooth, Gmail, Drive, …), which
  // works without Wi-Fi for Bluetooth. The email-style summary goes along as the message text.
  actions.shareReport = function () {
    var g = gameById(route.id), names = ui.reportNames || meta.settings.names;
    var file = new File([R.standalone(g, meta, { names: names })], reportFileName(g), { type: 'text/html' });
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
    xhr.send(R.standalone(g, meta, { names: names }));
  };

  actions.deleteGame = function () {
    var g = gameById(route.id);
    if (ui.armed !== 'del' + g.id) { ui.armed = 'del' + g.id; return render(); }
    ui.armed = null;
    games = games.filter(function (x) { return x.id !== g.id; });
    DB.deleteGame(g.id);
    toast('Game deleted.');
    go('#home');
  };

  // ---------- event wiring ----------
  var TWO_TAP = { rmEvent: 1, rmPlayer: 1, removeSample: 1, deleteGame: 1, rmSched: 1 };
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
    if (ev.target.getAttribute('data-schedtext')) ui.schedText = ev.target.value;
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
      if (!num || !first) return;
      if (seasonPlayers().some(function (p) { return p.num === num; })) { toast('Jersey #' + num + ' is already on the roster.'); return; }
      meta.players.push({ id: uid(), seasonId: meta.currentSeasonId, num: num, first: first, last: last });
      saveMeta();
      render();
      var n = document.getElementById('np-num'); if (n) n.focus();
    }
  });

  function importBackup(file) {
    if (!file) return;
    var rd = new FileReader();
    rd.onload = function () {
      var data;
      try { data = JSON.parse(rd.result); } catch (e) { return toast('That file isn’t a scorebook backup.'); }
      if (!data || data.app !== 'scorebook' || !data.meta || !data.games) return toast('That file isn’t a scorebook backup.');
      DB.replaceAll(data.meta, data.games, function (err) {
        if (err) return toast('Restore failed: ' + err);
        meta = data.meta; games = data.games;
        meta.schedule = meta.schedule || [];
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
      if (ui.reloadOnUpdate) { location.reload(); return; }
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
