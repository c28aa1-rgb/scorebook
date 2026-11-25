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
  // 80 x 50 rem with a plays panel on wide screens (Fire HD 10: 1280 x 800), else the
  // compact 60 x 37.5 rem layout (Fire HD 8: 960 x 600, smaller iPads).
  var WIDE_MIN = 1100;
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

  // Keep the screen on while scoring (Screen Wake Lock API; needs https). The browser drops
  // the lock when the tab is hidden, so it's requested again when the app comes back.
  var wakeLock = null;
  function wantWake() {
    if (route.name === 'game') return true;
    var g = route.name === 'report' && gameById(route.id);
    return !!(g && g.status !== 'final');
  }
  function syncWake() {
    if (!navigator.wakeLock) return;
    if (wantWake() && !wakeLock && document.visibilityState === 'visible') {
      wakeLock = 'pending';
      navigator.wakeLock.request('screen').then(function (l) {
        wakeLock = l;
        l.addEventListener('release', function () { if (wakeLock === l) wakeLock = null; });
        if (!wantWake()) syncWake();
      })['catch'](function () { wakeLock = null; });
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
      settings: { rules: C.copyRules(), names: 'first', publishUrl: '', publishKey: '' }
    };
  }

  function boot() {
    DB.open(function () {
      DB.loadMeta(function (err, m) {
        meta = m || defaultMeta();
        if (!m) saveMeta();
        DB.loadGames(function (err2, gs) {
          games = gs || [];
          applyTheme();
          window.addEventListener('hashchange', onRoute);
          window.addEventListener('resize', fitScale);
          document.addEventListener('visibilitychange', syncWake);
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
    var finals = gs.filter(function (g) { return g.status === 'final'; });
    var s = C.computeSeason(finals, seasonPlayers());
    var h = [];
    h.push(pageHead(meta.team.name + ' · ' + season.name, '',
      (fsAvailable() ? '<button class="btn sm" data-a="fullscreen">' + (fsActive() ? 'Exit full screen' : 'Full screen') + '</button>' : '') +
      '<button class="btn sm" data-a="go" data-x="#roster">Roster</button>' +
      '<button class="btn sm" data-a="go" data-x="#settings">Settings</button>' +
      '<button class="btn sm pri" data-a="go" data-x="#new">New game</button>'));
    h.push('<div class="pg-bd">');
    h.push('<div class="home-top">');
    live.forEach(function (g) {
      var c = C.computeGame(g);
      h.push('<button class="live-card" data-a="go" data-x="#game/' + g.id + '"><span class="sc">' + c.score.us + '–' +
        c.score.them + '</span><div><b>Resume vs ' + esc(g.opponent) + '</b><small>' +
        C.periodLabel(g.quarter, c.rules) + ' · ' + esc(R.fmtDate(g.date)) + '</small></div><span class="btn sm">Resume</span></button>');
    });
    h.push('<div class="record"><div><b class="num">' + s.team.w + '–' + s.team.l + '</b><span>Record</span></div>' +
      '<div><b class="num">' + (s.team.gp ? (s.team.pf / s.team.gp).toFixed(1) : '—') + '</b><span>Pts / game</span></div>' +
      '<div><b class="num">' + (s.team.gp ? (s.team.pa / s.team.gp).toFixed(1) : '—') + '</b><span>Allowed</span></div></div>');
    h.push('</div>');

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
        else if (c.score.us > c.score.them) { wl = 'W'; cls = 'w'; }
        else if (c.score.us < c.score.them) { wl = 'L'; cls = 'l'; }
        else { wl = 'T'; cls = 'l'; }
        h.push('<li><button data-a="go" data-x="' + (g.status === 'final' ? '#report/' : '#game/') + g.id + '">' +
          '<span class="wl ' + cls + '">' + wl + '</span><span class="op">' + (g.homeAway === 'away' ? '@ ' : 'vs ') + esc(g.opponent) +
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
    var finals = seasonGames().filter(function (g) { return g.status === 'final'; });
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
      '<button class="btn pri" data-a="startGame"' + (ps.length ? '' : ' disabled') + '>Start game</button>')];
    h.push('<div class="pg-bd">');
    if (!ps.length) {
      h.push('<div class="empty-state">Your roster is empty.<br><button class="btn pri" data-a="go" data-x="#roster">Add players</button></div></div>');
      return h.join('');
    }
    h.push('<h2>Game</h2><div class="form">');
    h.push('<div class="fld"><label for="ng-opp">Opponent</label><input id="ng-opp" list="opps" data-draft="opponent" value="' + esc(draft.opponent) + '" autocomplete="off" placeholder="e.g. Riverdale">' +
      '<datalist id="opps">' + meta.opponents.map(function (o) { return '<option value="' + esc(o.name) + '">'; }).join('') + '</datalist></div>');
    h.push('<div class="fld xs" style="flex-basis:11rem"><label for="ng-date">Date</label><input id="ng-date" type="date" data-draft="date" value="' + esc(draft.date) + '"></div>');
    h.push('<div class="fld"><label for="ng-loc">Location</label><input id="ng-loc" data-draft="location" value="' + esc(draft.location) + '" placeholder="Gym"></div>');
    h.push('<div class="fld xs" style="flex-basis:12rem"><span class="lab">Side</span><div class="seg">' +
      '<button data-a="draftSide" data-x="home" class="' + (draft.homeAway === 'home' ? 'on' : '') + '">Home</button>' +
      '<button data-a="draftSide" data-x="away" class="' + (draft.homeAway === 'away' ? 'on' : '') + '">Away</button></div></div>');
    h.push('</div>');
    h.push('<h2>Starters · ' + draft.starters.length + ' of 5</h2><div class="pick">');
    ps.forEach(function (p) {
      var on = draft.starters.indexOf(p.id) >= 0;
      h.push('<button class="bp' + (on ? ' on' : '') + '" data-a="draftStarter" data-x="' + p.id + '"><span class="num">' + esc(p.num) +
        '</span><span>' + esc(shortName(p)) + '</span></button>');
    });
    h.push('</div>');
    var r = C.copyRules(meta.settings.rules);
    h.push('<p class="note">Rules: ' + esc(r.name) + ' — ' + r.periods + ' × ' + r.periodMinutes + ' min, foul out at ' + r.foulOut +
      (r.techOut ? ', ejected at ' + r.techOut + ' technicals' : '') + ', bonus on team foul ' + r.bonusAt + ' each ' + r.bonusReset + ', ' + r.timeoutsFull + ' full + ' + r.timeoutsShort +
      ' 30-sec timeouts. Change these in Settings.</p>');
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
    h.push('<button class="lv-q" data-a="drawer" data-x="quarter"><span class="num">' + C.periodLabel(g.quarter, r) + '</span><small>PERIOD</small></button>');
    h.push(teamBlock('them', g.opponent, c));
    h.push('<button class="lv-undo" data-a="undo"' + (g.events.length ? '' : ' disabled') + '><span class="ic">↶</span>Undo</button>');
    h.push('</header>');

    h.push('<main class="lv-main"><section class="lv-left">');
    h.push('<div class="tabs"><button data-a="side" data-x="us" class="' + (ui.side === 'us' ? 'on' : '') + '">' + esc(meta.team.name) +
      '</button><button data-a="side" data-x="them" class="' + (ui.side === 'them' ? 'on' : '') + '">' + esc(g.opponent) + '</button></div>');
    h.push(ui.side === 'us' ? ourCards(g, c) : oppChips(g, c));
    if (wide) h.push('<button class="btn lv-subs" data-a="drawer" data-x="bench">Subs</button>');
    h.push('</section><section class="lv-pad">');
    h.push(padHead(g, c));
    h.push(ui.side === 'us' ? ourPad() : oppPad());
    h.push('</section>');
    if (wide) {
      h.push(playsPanel(g, c) + '</main></div>');
      if (ui.drawer) h.push(drawer(g, c));
      return h.join('');
    }
    h.push('</main>');

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

  // Wide layout only: recent plays beside the pad, newest first, with the running score.
  // Each play can be removed with two taps. The timeout countdown sits on top.
  function playsPanel(g, c) {
    var h = ['<aside class="plays">'], tot = { us: 0, them: 0 }, score = {};
    if (ui.timer && ui.timer.game === g.id) h.push(timerChip(g));
    g.events.forEach(function (e) { if (e.t === 'make') tot[e.tm] += e.v; score[e.s] = tot.us + '–' + tot.them; });
    h.push('<div class="plays-hd"><span>Plays</span><small class="num">' + g.events.length + '</small></div><ol class="plays-list">');
    if (!g.events.length) h.push('<li class="none">Plays show here as you enter them.</li>');
    g.events.slice(-60).reverse().forEach(function (e) {
      var armed = ui.armed === 'ev' + e.s;
      var cls = e.t === 'make' ? 'pts ' + e.tm : e.t === 'sub' ? 'dim' : e.t === 'foul' ? 'foul' : '';
      h.push('<li class="' + cls + '"><span class="q num">' + C.periodLabel(e.q, c.rules) + '</span><span class="d">' + esc(describe(e, g)) +
        '</span><span class="sc num">' + score[e.s] + '</span><button class="x' + (armed ? ' armed' : '') + '" data-a="rmEvent" data-x="' + e.s + '">' +
        (armed ? 'Remove' : '×') + '</button></li>');
    });
    h.push('</ol><div class="plays-ft"><button class="btn" data-a="drawer" data-x="log">Full log</button>' +
      '<button class="btn" data-a="go" data-x="#report/' + g.id + '">Box score</button></div></aside>');
    return h.join('');
  }

  function teamBlock(tm, name, c) {
    var fouls = c.currentFouls[tm], r = c.rules, left = c.timeoutsLeft[tm], h = [];
    var boxes = '<span class="boxes">';
    for (var i = 0; i < r.bonusAt; i++) boxes += '<span class="box' + (i < fouls ? ' on' : '') + '"></span>';
    boxes += '</span>' + (fouls > r.bonusAt ? '<span>+' + (fouls - r.bonusAt) + '</span>' : '');
    var pips = '<span class="pips">';
    var totalFull = left.full + c.timeoutsUsed[tm].full, totalShort = left.short + c.timeoutsUsed[tm].short;
    for (i = 0; i < totalFull; i++) pips += '<span class="pip' + (i < left.full ? ' on' : '') + '"></span>';
    for (i = 0; i < totalShort; i++) pips += '<span class="pip s' + (i < left.short ? ' on' : '') + '"></span>';
    pips += '</span>';
    h.push('<div class="tm ' + tm + '"><span class="tm-score">' + c.score[tm] + '</span><div class="tm-info">');
    h.push('<span class="tm-name">' + esc(name) + '</span>');
    h.push('<span class="tm-row"><span>FOULS ' + fouls + '</span>' + boxes + (c.shooting[tm] ? '<span class="bonus">BONUS</span>' : '') + '</span>');
    h.push('<button class="tm-to" data-a="drawer" data-x="to-' + tm + '">TO ' + pips + '<span>' + left.full + '+' + left.short + '</span></button>');
    h.push('</div></div>');
    return h.join('');
  }

  function foulBoxes(pf, rules, tf) {
    var s = '<span class="boxes">';
    for (var i = 0; i < rules.foulOut; i++) s += '<span class="box' + (i < pf ? ' on' : '') + '"></span>';
    return s + '</span>' + (tf ? '<span class="tag-t">' + tf + 'T</span>' : '');
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
    h.push('<button class="chip team' + (ui.oppSel === null ? ' sel' : '') + '" data-a="oppPick" data-x=""><span class="num">TEAM</span><small>' + tl.pts + ' pts</small><small>no number</small></button>');
    h.push('<button class="chip add" data-a="drawer" data-x="keypad">+ Number</button>');
    h.push('</div>');
    return h.join('');
  }

  function padHead(g, c) {
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
      key('act', 'chg:', 'CHG', 'Took a charge', 'stat') + key('drawer', 'bench', 'SUB', 'Substitute', 'stat') +
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
      var tm = d.slice(3), left = c.timeoutsLeft[tm], name = tm === 'us' ? meta.team.name : g.opponent;
      h = '<div class="stack">' +
        '<button class="btn pri" data-a="timeout" data-x="' + tm + ':full"' + (left.full ? '' : ' disabled') + '>Full timeout <small>' + left.full + ' left</small></button>' +
        '<button class="btn" data-a="timeout" data-x="' + tm + ':short"' + (left.short ? '' : ' disabled') + '>30-second timeout <small>' + left.short + ' left</small></button></div>';
      return sheet(name + ' timeout · ' + C.periodLabel(g.quarter, r), h, '', true);
    }
    if (d === 'quarter') {
      var q = g.quarter, inReg = q < r.periods;
      h = '<div class="stack">';
      if (inReg) h += '<button class="btn pri" data-a="setQ" data-x="' + (q + 1) + '">End ' + C.periodLabel(q, r) + ' · start ' + C.periodLabel(q + 1, r) + '</button>';
      else {
        var tied = c.score.us === c.score.them;
        h += '<button class="btn' + (tied ? '' : ' pri') + '" data-a="endGame">End game — final<small>' + c.score.us + '–' + c.score.them + '</small></button>';
        h += '<button class="btn' + (tied ? ' pri' : '') + '" data-a="setQ" data-x="' + (q + 1) + '">Start ' + C.periodLabel(q + 1, r) + '<small>' + r.otMinutes + ' min · +' + r.otTimeoutsFull + ' timeout</small></button>';
      }
      if (q > 1) h += '<button class="btn ghost" data-a="setQ" data-x="' + (q - 1) + '">Go back to ' + C.periodLabel(q - 1, r) + '<small>fix a mistake</small></button>';
      if (inReg) h += '<button class="btn ghost" data-a="endGame">End game early<small>' + c.score.us + '–' + c.score.them + '</small></button>';
      h += '</div>';
      return sheet('Period · now ' + C.periodLabel(q, r), h, '', true);
    }
    if (d === 'bench') {
      var ps = seasonPlayers(), count = g.onCourt.filter(Boolean).length;
      h = '<p class="note" style="margin-top:0">Tap to move players on or off the court. Blue = on court.</p><div class="bench">';
      ps.forEach(function (p) {
        var on = g.onCourt.indexOf(p.id) >= 0, l = c.players[p.id] || C.emptyLine(), why = C.outReason(l, r);
        h += '<button class="bp' + (on ? ' on' : '') + (why ? ' out' : '') + '" data-a="toggleCourt" data-x="' + p.id + '"><span class="num">' + esc(p.num) +
          '</span><span>' + esc(shortName(p)) + '<small>' + l.pts + ' pts · ' + l.pf + ' PF' + (l.tf ? ' · ' + l.tf + 'T' : '') +
          (why ? (why === 'ejected' ? ' · EJECTED' : ' · OUT') : '') + '</small></span></button>';
      });
      h += '</div>';
      return sheet('Substitutions · ' + count + ' of 5 on court', h, '<button class="btn pri" data-a="closeDrawer">Done</button>');
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
  screens.settings = function () {
    var r = C.copyRules(meta.settings.rules), s = meta.settings;
    function num(k, label) {
      return '<div class="fld xs" style="flex-basis:9rem"><label for="r-' + k + '">' + label + '</label><input id="r-' + k + '" type="number" min="0" inputmode="numeric" data-rule="' + k + '" value="' + r[k] + '"></div>';
    }
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

    h.push('<h2>Rules (new games)</h2><div class="form">' +
      num('periods', 'Quarters') + num('periodMinutes', 'Minutes') + num('foulOut', 'Foul out at') + num('techOut', 'Ejected at techs') + num('bonusAt', 'Bonus on foul') +
      '<div class="fld xs" style="flex-basis:9rem"><label for="r-reset">Bonus resets</label><select id="r-reset" data-rule="bonusReset"><option value="quarter"' + (r.bonusReset === 'quarter' ? ' selected' : '') + '>Each quarter</option><option value="half"' + (r.bonusReset === 'half' ? ' selected' : '') + '>Each half</option></select></div>' +
      num('timeoutsFull', 'Full TOs') + num('timeoutsShort', '30-sec TOs') + num('otMinutes', 'OT minutes') + num('otTimeoutsFull', 'TOs per OT') +
      '<div class="fld xs" style="flex-basis:12rem"><label for="r-carry">OT team fouls</label><select id="r-carry" data-rule="otFoulsCarry"><option value="1"' + (r.otFoulsCarry ? ' selected' : '') + '>Carry from Q4</option><option value="0"' + (!r.otFoulsCarry ? ' selected' : '') + '>Reset each OT</option></select></div>' +
      '</div><p class="note">Each game keeps the rules it started with. Changes apply to new games.</p>');

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
      '</div><p class="note">' + (fsAvailable() ? 'Swipe down from the top or tap Exit to leave full screen.'
        : 'This browser is already full screen or doesn’t support it. On iPad, use Share → Add to Home Screen for a full-screen app.') + '</p>');

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
  actions.pick = function (x) { ui.sel = x; ui.msg = null; render(); };
  actions.oppPick = function (x) { ui.oppSel = x === '' ? null : x; render(); };

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
    else addEvent(g, 'them', ui.oppSel || '', t, v);
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
    toast((p[0] === 'us' ? meta.team.name : g.opponent) + ' timeout. ' + left.full + ' full + ' + left.short + ' short left.');
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
    var g = gameById(route.id);
    g.quarter = parseInt(x, 10);
    ui.drawer = null; ui.prompt = null;
    saveGame(g);
    var c = C.computeGame(g);
    toast(C.periodLabel(g.quarter, c.rules) + ' started · team fouls ' + c.currentFouls.us + '–' + c.currentFouls.them);
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

  actions.toggleCourt = function (x) {
    var g = gameById(route.id), i = g.onCourt.indexOf(x);
    if (i >= 0) { g.onCourt.splice(i, 1); logSub(g, x, 'out'); }
    else {
      var c = C.computeGame(g), l = c.players[x];
      if (l && C.outReason(l, c.rules)) { toast(C.outReason(l, c.rules) === 'ejected' ? 'That player has been ejected.' : 'That player has fouled out.'); return; }
      if (g.onCourt.length >= 5) { toast('5 players are on court. Take one off first.'); return; }
      g.onCourt.push(x);
      logSub(g, x, 'in');
      if (g.appeared.indexOf(x) < 0) g.appeared.push(x);
      // Keep the game's roster snapshot complete for players added mid-season.
      var p = player(x);
      if (p && !find(g.roster, x)) g.roster.push({ id: p.id, num: p.num, first: p.first, last: p.last });
    }
    if (ui.sel && g.onCourt.indexOf(ui.sel) < 0) ui.sel = null;
    saveGame(g);
    render();
  };

  actions.drawer = function (x) {
    // 'keypad-chg' is the number keypad opened from the charge sheet: the number gets the offensive foul.
    ui.kpFor = x === 'keypad-chg' ? 'chg' : null;
    if (x === 'keypad-chg') x = 'keypad';
    ui.drawer = x; ui.prompt = null; ui.armed = null;
    if (x === 'keypad') ui.kp = '';
    render();
  };
  actions.closeDrawer = function () { ui.drawer = null; ui.armed = null; ui.kpFor = null; render(); };
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
      homeAway: draft.homeAway, rules: C.copyRules(meta.settings.rules), quarter: 1, status: 'live', events: [], seq: 0,
      onCourt: draft.starters.slice(), appeared: draft.starters.slice(), starters: draft.starters.slice(), roster: roster,
      oppNums: [], created: Date.now(), publishedUrl: '', publishId: '', subLog: true
    };
    games.push(g);
    saveGame(g);
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
    saveMeta();
    toast('Sample data removed.');
    render();
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
  var TWO_TAP = { rmEvent: 1, rmPlayer: 1, removeSample: 1, deleteGame: 1 };
  function closest(el, attr) {
    while (el && el !== document) { if (el.getAttribute && el.getAttribute(attr) !== null) return el; el = el.parentNode; }
    return null;
  }

  app.addEventListener('click', function (ev) {
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
    if (!TWO_TAP[a]) ui.armed = null;
    actions[a](el.getAttribute('data-x'));
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
      var v = el.value;
      if (k === 'otFoulsCarry') v = v === '1';
      else if (k !== 'bonusReset') v = Math.max(0, parseInt(v, 10) || 0);
      meta.settings.rules = C.copyRules(meta.settings.rules);
      meta.settings.rules[k] = v;
      saveMeta();
    } else if ((k = el.getAttribute('data-pct'))) {
      meta.settings.pct = meta.settings.pct || {};
      meta.settings.pct[k] = el.value === '1';
      saveMeta();
    } else if ((k = el.getAttribute('data-setting'))) {
      meta.settings[k] = el.value.trim();
      saveMeta();
    } else if (el.getAttribute('data-season')) {
      meta.currentSeasonId = el.value;
      saveMeta(); toast('Switched season.');
    } else if (el.getAttribute('data-import')) {
      importBackup(el.files && el.files[0]);
    }
  });

  app.addEventListener('input', function (ev) {
    var k = ev.target.getAttribute('data-draft');
    if (k) draft[k] = ev.target.value;
  });

  app.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var f = ev.target;
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
        applyTheme();
        toast('Restored ' + games.length + ' games.');
        go('#home');
      });
    };
    rd.readAsText(file);
  }

  // Offline support. Skipped on localhost so edits show up immediately while developing.
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js')['catch'](function () {});
  }

  boot();
})();
