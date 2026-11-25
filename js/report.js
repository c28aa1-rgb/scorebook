/*
 * Game report: one renderer shared by the in-app report, printing, the standalone
 * HTML file (for email attachments / publishing) and the plain-text email body.
 * Depends on SBCore. ES5.
 */
(function (root) {
  'use strict';
  var C = root.SBCore;

  // Report styles live here (not in app.css) so the standalone file carries them.
  var CSS = [
    '.rpt{--paper:#F4F7F6;--ink:#101820;--ink2:#4A5A60;--ledger:#1D5C55;--rule:#C7D5D1;--accent:#2340C8;',
    'font-family:Roboto,"Segoe UI",Arial,sans-serif;color:var(--ink);background:#fff;max-width:60rem;margin:0 auto;padding:1.5rem 1.75rem 2rem;font-size:0.875rem;line-height:1.35}',
    '.rpt *{box-sizing:border-box}',
    '.rpt .num,.rpt h1,.rpt .score,.rpt table{font-family:"Roboto Condensed","sans-serif-condensed","Bahnschrift SemiCondensed",Bahnschrift,"Arial Narrow",sans-serif;font-variant-numeric:tabular-nums}',
    '.rpt-hd{display:flex;align-items:flex-end;justify-content:space-between;gap:1rem;border-bottom:3px solid var(--ink);padding-bottom:0.6rem}',
    '.rpt-eyebrow{font-size:0.7rem;letter-spacing:0.14em;text-transform:uppercase;color:var(--ledger);font-weight:700}',
    '.rpt h1{margin:0.15rem 0 0;font-size:2rem;font-weight:700;line-height:1;letter-spacing:-0.01em}',
    '.rpt h1 .vs{color:var(--ink2);font-weight:400;font-size:1.1rem;margin:0 0.4rem}',
    '.rpt h1 .win{color:var(--accent)}',
    '.rpt-meta{text-align:right;color:var(--ink2);font-size:0.8rem;white-space:nowrap}',
    '.rpt-meta b{display:block;color:var(--ink);font-size:0.95rem}',
    '.rpt h2{font-size:0.72rem;letter-spacing:0.14em;text-transform:uppercase;color:var(--ledger);margin:1.4rem 0 0.4rem;font-weight:700;border-bottom:1px solid var(--rule);padding-bottom:0.25rem}',
    '.rpt .tw{overflow-x:auto}',
    '.rpt table{border-collapse:collapse;width:100%;font-size:0.9rem}',
    '.rpt th{font-size:0.68rem;letter-spacing:0.06em;text-transform:uppercase;color:var(--ledger);font-weight:700;text-align:right;padding:0.3rem 0.4rem;border-bottom:2px solid var(--ledger)}',
    '.rpt td{text-align:right;padding:0.28rem 0.4rem;border-bottom:1px solid var(--rule);white-space:nowrap}',
    '.rpt th.l,.rpt td.l{text-align:left}',
    '.rpt td.nm{text-align:left;font-family:Roboto,"Segoe UI",Arial,sans-serif;font-size:0.85rem}',
    '.rpt td.jr{text-align:left;font-weight:700;width:2.2rem}',
    '.rpt td.b,.rpt th.b{font-weight:700}',
    '.rpt tr.tot td{border-top:2px solid var(--ink);border-bottom:0;font-weight:700}',
    '.rpt tr.pct td{border-bottom:0;color:var(--ink2);font-size:0.78rem;padding-top:0}',
    '.rpt td.dim{color:var(--ink2)}',
    '.rpt .line td.b{font-size:1.05rem}',
    '.rpt-grid{display:flex;flex-wrap:wrap;gap:0 1.75rem}',
    '.rpt-grid>div{flex:1 1 16rem;min-width:0}',
    '.rpt dl{display:flex;flex-wrap:wrap;margin:0;font-size:0.85rem}',
    '.rpt dl div{flex:1 1 45%;display:flex;justify-content:space-between;gap:0.5rem;border-bottom:1px solid var(--rule);padding:0.28rem 0.5rem 0.28rem 0;margin-right:0.5rem}',
    '.rpt dt{color:var(--ink2)}',
    '.rpt dd{margin:0;font-weight:700;font-family:"Roboto Condensed","sans-serif-condensed","Bahnschrift SemiCondensed",Bahnschrift,sans-serif}',
    /* Running-score ledger: the paper scorebook's signature grid */
    '.rpt .led{margin-top:0.3rem}',
    '.rpt .led-blk{display:flex;margin-bottom:0.45rem}',
    '.rpt .led-tm{width:3.2rem;flex:none;display:flex;flex-direction:column}',
    '.rpt .led-tm span{height:1.9rem;line-height:1.9rem;font-size:0.68rem;font-weight:700;letter-spacing:0.06em;color:var(--ledger)}',
    '.rpt .led-rows{flex:1;min-width:0}',
    '.rpt .led-row{display:flex}',
    '.rpt .led-row+.led-row .c{border-top:0}',
    '.rpt .c{flex:1;min-width:0;height:1.9rem;border:1px solid var(--rule);border-left:0;position:relative;text-align:center;font-family:"Roboto Condensed","sans-serif-condensed",Bahnschrift,sans-serif}',
    '.rpt .c:first-child{border-left:1px solid var(--rule)}',
    '.rpt .c i{display:block;font-style:normal;font-size:0.62rem;color:#8A9A98;line-height:1;padding-top:0.15rem}',
    '.rpt .c b{display:block;font-size:0.66rem;line-height:1.1;margin-top:0.12rem}',
    '.rpt .c.m i{color:var(--ink);font-weight:700}',
    '.rpt .c.m2:after,.rpt .c.m3:after{content:"";position:absolute;left:18%;right:18%;top:0.48rem;height:2px;background:var(--ink);transform:rotate(-38deg)}',
    '.rpt .c.m3.e:before{content:"";position:absolute;left:50%;top:0.02rem;width:0.95rem;height:0.95rem;margin-left:-0.475rem;border:1.5px solid var(--ink);border-radius:50%}',
    '.rpt .c.m1 i:after{content:"";display:inline-block;width:0.28rem;height:0.28rem;border-radius:50%;background:var(--ink);margin-left:0.1rem;vertical-align:middle}',
    '.rpt .c.qe{border-right:3px solid var(--ledger)}',
    '.rpt .c.us.m{background:#EEF1FC}',
    '.rpt .led-key{font-size:0.72rem;color:var(--ink2);margin-top:0.2rem}',
    '.rpt .foot{margin-top:1.6rem;font-size:0.7rem;color:var(--ink2);border-top:1px solid var(--rule);padding-top:0.4rem;display:flex;justify-content:space-between}',
    '@media print{@page{size:letter;margin:0.45in}',
    ' .rpt{max-width:none;padding:0;font-size:9.5pt}',
    ' .rpt .c.us.m{background:none}',
    ' .rpt h2{break-after:avoid}',
    ' .rpt table,.rpt .led-blk{break-inside:avoid}}'
  ].join('\n');

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  // names: 'jersey' | 'first' (first name + last initial) | 'full'
  function playerName(p, names) {
    if (!p) return '';
    if (names === 'jersey') return '';
    if (names === 'full') return ((p.first || '') + ' ' + (p.last || '')).trim();
    return ((p.first || '') + (p.last ? ' ' + p.last.charAt(0) + '.' : '')).trim();
  }

  function findPlayer(game, meta, id) {
    var i, list = meta.players || [];
    for (i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    list = game.roster || [];
    for (i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function byJersey(a, b) {
    var na = parseInt(a.num, 10), nb = parseInt(b.num, 10);
    if (isNaN(na)) na = 999; if (isNaN(nb)) nb = 999;
    return na - nb || String(a.num).length - String(b.num).length;
  }

  function fmtDate(iso) {
    if (!iso) return '';
    var p = iso.split('-');
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return months[parseInt(p[1], 10) - 1] + ' ' + parseInt(p[2], 10) + ', ' + p[0];
  }

  function ma(m, a) { return m + '-' + a; }

  // Percentage with a % sign when there is a number; '—' with no attempts, 'N/A' when switched off.
  function pctText(on, m, a) {
    var s = C.showPct(on, m, a);
    return /\d/.test(s) ? s + '%' : s;
  }

  // Players who appeared (on court at some point) or recorded a stat, by jersey.
  function boxPlayers(game, meta, c) {
    var seen = {}, out = [];
    (game.appeared || []).concat(Object.keys(c.players)).forEach(function (id) {
      if (seen[id]) return; seen[id] = true;
      var p = findPlayer(game, meta, id);
      out.push({ id: id, num: p ? p.num : '?', p: p, line: c.players[id] || C.emptyLine() });
    });
    return out.sort(byJersey);
  }

  // Fouls with technicals noted, e.g. "3 (2T)"; bold with a mark when the player had to leave.
  function pfCell(l, rules) {
    var why = C.outReason(l, rules);
    return '<td' + (why ? ' class="b"' : '') + '>' + l.pf + (l.tf ? ' (' + l.tf + 'T)' : '') +
      (why === 'ejected' ? ' EJ' : why ? ' FO' : '') + '</td>';
  }

  function foulsByPeriod(game, n) {
    var f = { us: [], them: [] }, i;
    for (i = 0; i < n; i++) { f.us.push(0); f.them.push(0); }
    (game.events || []).forEach(function (e) { if (e.t === 'foul') f[e.tm][e.q - 1]++; });
    return f;
  }

  function oppName(game) { return game.opponent || 'Opponent'; }

  function resultWord(c, rules) {
    var ot = c.periods - rules.periods;
    return 'Final' + (ot > 0 ? (ot === 1 ? ' / OT' : ' / ' + ot + 'OT') : '');
  }

  function lineScore(game, meta, c) {
    var h = ['<div class="tw"><table class="line"><thead><tr><th class="l">Team</th>'];
    var i, f = foulsByPeriod(game, c.periods);
    for (i = 1; i <= c.periods; i++) h.push('<th>' + C.periodLabel(i, c.rules) + '</th>');
    h.push('<th class="b">T</th><th>Fouls</th><th>TO</th></tr></thead><tbody>');
    [['us', meta.team.name], ['them', oppName(game)]].forEach(function (row) {
      var tm = row[0];
      h.push('<tr><td class="l b">' + esc(row[1]) + '</td>');
      for (i = 0; i < c.periods; i++) h.push('<td>' + c.byPeriod[tm][i] + '</td>');
      var tu = c.timeoutsUsed[tm];
      h.push('<td class="b">' + c.score[tm] + '</td><td class="dim">' + f[tm].join(' · ') +
        '</td><td class="dim">' + (tu.full + tu.short) + '</td></tr>');
    });
    h.push('</tbody></table></div>');
    return h.join('');
  }

  function ourBox(game, meta, c, names) {
    var rows = boxPlayers(game, meta, c), t = c.team.us, pm = c.pm;
    var h = ['<div class="tw"><table><thead><tr><th class="l">#</th><th class="l">Player</th>',
      '<th class="b">PTS</th><th>FG</th><th>3P</th><th>FT</th><th>OR</th><th>DR</th><th>REB</th>',
      '<th>AST</th><th>STL</th><th>BLK</th><th>CHG</th><th>TO</th><th>PF</th>' + (pm ? '<th>+/−</th>' : '') + '</tr></thead><tbody>'];
    rows.forEach(function (r) {
      var l = r.line, pmCell = pm ? '<td>' + C.fmtPm(pm[r.id]) + '</td>' : '';
      h.push('<tr><td class="jr">' + esc(r.num) + '</td><td class="nm">' + esc(playerName(r.p, names)) +
        '</td><td class="b">' + l.pts + '</td><td>' + ma(l.fgm, l.fga) + '</td><td>' + ma(l.tpm, l.tpa) +
        '</td><td>' + ma(l.ftm, l.fta) + '</td><td>' + l.oreb + '</td><td>' + l.dreb + '</td><td>' +
        (l.oreb + l.dreb) + '</td><td>' + l.ast + '</td><td>' + l.stl + '</td><td>' + l.blk +
        '</td><td>' + (l.chg || 0) + '</td><td>' + l.to + '</td>' + pfCell(l, c.rules) + pmCell + '</tr>');
    });
    h.push('<tr class="tot"><td class="l" colspan="2">Team</td><td>' + t.pts + '</td><td>' + ma(t.fgm, t.fga) +
      '</td><td>' + ma(t.tpm, t.tpa) + '</td><td>' + ma(t.ftm, t.fta) + '</td><td>' + t.oreb + '</td><td>' +
      t.dreb + '</td><td>' + (t.oreb + t.dreb) + '</td><td>' + t.ast + '</td><td>' + t.stl + '</td><td>' +
      t.blk + '</td><td>' + (t.chg || 0) + '</td><td>' + t.to + '</td><td>' + t.pf + (t.tf ? ' (' + t.tf + 'T)' : '') + '</td>' + (pm ? '<td></td>' : '') + '</tr>');
    var on = C.pctShown(meta.settings);
    h.push('<tr class="pct"><td colspan="3"></td><td>' + pctText(on.fg, t.fgm, t.fga) + '</td><td>' +
      pctText(on.tp, t.tpm, t.tpa) + '</td><td>' + pctText(on.ft, t.ftm, t.fta) + '</td><td colspan="' + (pm ? 10 : 9) + '"></td></tr>');
    h.push('</tbody></table></div>');
    return h.join('');
  }

  function oppBox(game, c) {
    var keys = Object.keys(c.opp).sort(function (a, b) {
      if (a === '') return 1; if (b === '') return -1;
      return byJersey({ num: a }, { num: b });
    });
    var h = ['<div class="tw"><table><thead><tr><th class="l">#</th><th class="b">PTS</th><th>FGM</th>',
      '<th>3PM</th><th>FTM</th><th>PF</th></tr></thead><tbody>'];
    keys.forEach(function (k) {
      var l = c.opp[k];
      h.push('<tr><td class="jr">' + (k === '' ? '<span class="dim">Team</span>' : esc(k)) + '</td><td class="b">' +
        l.pts + '</td><td>' + l.fgm + '</td><td>' + l.tpm + '</td><td>' + l.ftm + '</td>' + pfCell(l, c.rules) + '</tr>');
    });
    var t = c.team.them;
    h.push('<tr class="tot"><td class="l">Team</td><td>' + t.pts + '</td><td>' + t.fgm + '</td><td>' + t.tpm +
      '</td><td>' + t.ftm + '</td><td>' + t.pf + '</td></tr></tbody></table></div>');
    return h.join('');
  }

  function flowBlock(game, meta, c, names) {
    var f = C.gameFlow(game.events || []);
    var top = boxPlayers(game, meta, c).sort(function (a, b) { return b.line.pts - a.line.pts; })[0];
    var to = c.timeoutLog.map(function (t) {
      return (t.tm === 'us' ? meta.team.short || meta.team.name : 'OPP') + ' ' + C.periodLabel(t.q, c.rules) +
        (t.v === 'short' ? ' (30s)' : '');
    });
    function item(k, v) { return '<div><dt>' + k + '</dt><dd>' + v + '</dd></div>'; }
    var topName = top && top.line.pts ? '#' + esc(top.num) + ' ' + esc(playerName(top.p, names)) + ' — ' + top.line.pts : '—';
    return '<dl>' +
      item('Top scorer', topName) +
      item('Lead changes', f.leadChanges) +
      item('Times tied', f.ties) +
      item('Biggest lead', esc(meta.team.short || meta.team.name) + ' ' + f.biggestLead.us + ' · Opp ' + f.biggestLead.them) +
      item('Best run', esc(meta.team.short || meta.team.name) + ' ' + f.bestRun.us + '-0 · Opp ' + f.bestRun.them + '-0') +
      item('Timeouts', to.length ? esc(to.join(', ')) : 'None') +
      '</dl>';
  }

  /*
   * Running score, laid out like the paper book: numbered cells, a slash through each
   * point scored (3s circled, free throws dotted), the scorer's jersey under the last
   * point of each basket, and a heavy rule where each period ended.
   */
  function ledger(game, meta, c) {
    var cells = { us: {}, them: {} }, tot = { us: 0, them: 0 }, qEnd = { us: {}, them: {} };
    var events = game.events || [], lastQ = 1, i, e;
    for (i = 0; i < events.length; i++) {
      e = events[i];
      if (e.q !== lastQ) {
        qEnd.us[tot.us] = true; qEnd.them[tot.them] = true;
        lastQ = e.q;
      }
      if (e.t !== 'make') continue;
      var start = tot[e.tm] + 1;
      tot[e.tm] += e.v;
      for (var n = start; n <= tot[e.tm]; n++) cells[e.tm][n] = { v: e.v, last: n === tot[e.tm] };
      var jr = e.tm === 'us' ? (findPlayer(game, meta, e.p) || {}).num : e.p;
      cells[e.tm][tot[e.tm]].jr = jr || '';
    }
    var max = Math.max(tot.us, tot.them, 40);
    var per = 30, rows = Math.ceil(max / per), h = ['<div class="led">'];
    function row(tm, from) {
      var r = ['<div class="led-row">'];
      for (var n = from; n < from + per; n++) {
        var cell = cells[tm][n], cls = 'c ' + tm;
        if (cell) cls += ' m m' + cell.v + (cell.last ? ' e' : '');
        if (qEnd[tm][n] && n > 0) cls += ' qe';
        r.push('<div class="' + cls + '"><i>' + n + '</i>' + (cell && cell.last ? '<b>' + esc(cell.jr) + '</b>' : '') + '</div>');
      }
      r.push('</div>');
      return r.join('');
    }
    for (i = 0; i < rows; i++) {
      var from = i * per + 1;
      h.push('<div class="led-blk"><div class="led-tm"><span>' + esc(meta.team.short || 'US') +
        '</span><span>OPP</span></div><div class="led-rows">' + row('us', from) + row('them', from) + '</div></div>');
    }
    h.push('<div class="led-key">Slash = 2 pts · circled = 3 pts · dot = free throw · jersey under the last point of each basket · heavy line = end of period</div></div>');
    return h.join('');
  }

  function render(game, meta, opts) {
    opts = opts || {};
    var names = opts.names || (meta.settings && meta.settings.names) || 'first';
    var c = C.computeGame(game);
    var us = c.score.us, them = c.score.them;
    var status = game.status === 'final' ? resultWord(c, c.rules) : 'In progress · ' + C.periodLabel(c.quarter, c.rules);
    var h = [];
    h.push('<article class="rpt">');
    h.push('<header class="rpt-hd"><div><div class="rpt-eyebrow">' + esc(status) + ' · ' +
      (game.homeAway === 'away' ? 'Away' : 'Home') + '</div>');
    h.push('<h1><span class="' + (us > them ? 'win' : '') + '">' + esc(meta.team.name) + ' ' + us +
      '</span><span class="vs">–</span><span class="' + (them > us ? 'win' : '') + '">' + them + ' ' +
      esc(oppName(game)) + '</span></h1></div>');
    h.push('<div class="rpt-meta"><b>' + esc(fmtDate(game.date)) + '</b>' + esc(game.location || '') + '</div></header>');
    h.push('<h2>Score by period</h2>' + lineScore(game, meta, c));
    h.push('<h2>' + esc(meta.team.name) + '</h2>' + ourBox(game, meta, c, names));
    h.push('<div class="rpt-grid"><div><h2>' + esc(oppName(game)) + '</h2>' + oppBox(game, c) +
      '</div><div><h2>Game flow</h2>' + flowBlock(game, meta, c, names) + '</div></div>');
    h.push('<h2>Running score</h2>' + ledger(game, meta, c));
    h.push('<div class="foot"><span>' + esc(meta.team.name) + ' scorebook</span><span>' +
      esc(c.rules.name) + ' rules</span></div>');
    h.push('</article>');
    return h.join('');
  }

  function title(game, meta) {
    var c = C.computeGame(game);
    return meta.team.name + ' ' + c.score.us + ', ' + oppName(game) + ' ' + c.score.them + ' — ' + fmtDate(game.date);
  }

  function standalone(game, meta, opts) {
    return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<meta name="robots" content="noindex,nofollow">' +
      '<title>' + esc(title(game, meta)) + '</title>' +
      '<style>body{margin:0;background:#F4F7F6}' + CSS.replace('--accent:#2340C8', '--accent:' + (meta.team.color || '#2340C8')) +
      '@media screen{.rpt{margin:1rem auto;border:1px solid #C7D5D1}}</style></head><body>' +
      render(game, meta, opts) + '</body></html>';
  }

  function plainText(game, meta, opts) {
    var names = (opts && opts.names) || 'first';
    var c = C.computeGame(game), t = c.team.us, lines = [];
    lines.push(title(game, meta) + (game.status === 'final' ? ' (' + resultWord(c, c.rules) + ')' : ''));
    if (game.location) lines.push(game.location);
    lines.push('');
    var hdr = [], i;
    for (i = 1; i <= c.periods; i++) hdr.push(C.periodLabel(i, c.rules));
    lines.push('By period (' + hdr.join(' ') + ')');
    lines.push(meta.team.name + ': ' + c.byPeriod.us.join(' ') + ' = ' + c.score.us);
    lines.push(oppName(game) + ': ' + c.byPeriod.them.join(' ') + ' = ' + c.score.them);
    lines.push('');
    lines.push('Scoring:');
    boxPlayers(game, meta, c).forEach(function (r) {
      if (!r.line.pts && !(r.line.oreb + r.line.dreb) && !r.line.ast && !r.line.chg) return;
      var nm = playerName(r.p, names);
      lines.push('#' + r.num + (nm ? ' ' + nm : '') + ' — ' + r.line.pts + ' pts, ' + (r.line.oreb + r.line.dreb) +
        ' reb, ' + r.line.ast + ' ast' + (r.line.chg ? ', ' + r.line.chg + ' charge' + (r.line.chg > 1 ? 's' : '') + ' taken' : ''));
    });
    lines.push('');
    var on = C.pctShown(meta.settings);
    lines.push('Team: FG ' + ma(t.fgm, t.fga) + (on.fg ? ' (' + pctText(true, t.fgm, t.fga) + ')' : '') + ', 3P ' + ma(t.tpm, t.tpa) +
      ', FT ' + ma(t.ftm, t.fta) + ', REB ' + (t.oreb + t.dreb) + ', AST ' + t.ast + ', TO ' + t.to);
    if (opts && opts.url) { lines.push(''); lines.push('Full report: ' + opts.url); }
    return lines.join('\n');
  }

  root.SBReport = {
    CSS: CSS,
    render: render,
    standalone: standalone,
    plainText: plainText,
    title: title,
    playerName: playerName,
    findPlayer: findPlayer,
    byJersey: byJersey,
    fmtDate: fmtDate,
    esc: esc
  };
})(this);
