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
    '.rpt .pw{margin:0.4rem 0 0;font-weight:700;font-size:0.85rem}',
    '.rpt .key{margin:0.3rem 0 0;font-size:0.72rem;color:var(--ink2)}',
    '.rpt .c.ma:after{content:"";position:absolute;left:18%;right:18%;top:0.48rem;height:2px;background:var(--ledger);transform:rotate(-38deg)}',
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
    '.rpt{-webkit-print-color-adjust:exact;print-color-adjust:exact}',
    '.rpt .rpt-logo{flex:none;width:3.6rem;height:3.6rem;align-self:center;margin-right:0.2rem}',
    '.rpt .rpt-title{flex:1;min-width:0}',
    '.rpt .rpt-page{color:var(--accent)}',
    '.rpt .rpt-ologo{flex:none;width:3.2rem;height:3.2rem;border-radius:50%;align-self:center;box-shadow:0 0 0 1px var(--rule)}',
    '.rpt .kp{display:grid;grid-template-columns:repeat(auto-fit,minmax(6.4rem,1fr));margin-top:0.9rem;border-top:1px solid var(--rule);border-left:1px solid var(--rule)}',
    '.rpt .kp div{padding:0.45rem 0.6rem;border-right:1px solid var(--rule);border-bottom:1px solid var(--rule)}',
    '.rpt .kp b{display:block;font-family:"Roboto Condensed","sans-serif-condensed",Bahnschrift,"Arial Narrow",sans-serif;font-size:1.45rem;line-height:1.05}',
    '.rpt .kp span{display:block;font-size:0.6rem;letter-spacing:0.1em;text-transform:uppercase;color:var(--ledger);font-weight:700;margin-top:0.1rem}',
    '.rpt .kp small{display:block;font-size:0.7rem;color:var(--ink2)}',
    '.rpt .mchart{display:block;width:100%;height:auto;margin-top:0.2rem}',
    '.rpt .mwrap{position:relative;cursor:crosshair;-webkit-user-select:none;user-select:none}',
    '.rpt .mguide{stroke:var(--ink);stroke-width:1.2;stroke-dasharray:3 3}',
    '.rpt .mdot{fill:#fff;stroke:var(--ink);stroke-width:2.5}',
    '.rpt .mtip{display:none;position:absolute;top:-0.4rem;transform:translate(-50%,-100%);pointer-events:none;background:var(--ink);color:#fff;border-radius:0.4rem;padding:0.35rem 0.6rem;white-space:nowrap;font-size:0.75rem;line-height:1.3;text-align:center;box-shadow:0 4px 12px rgba(16,24,32,0.25)}',
    '.rpt .mtip span{display:block;font-size:0.62rem;letter-spacing:0.1em;color:#9FB4B0;font-weight:700}',
    '.rpt .mtip b{display:block;font-size:0.95rem;font-family:"Roboto Condensed",Bahnschrift,sans-serif}',
    '.rpt .mtip em{display:block;font-style:normal;font-weight:700;font-size:0.85rem}.rpt .mtip em.u{color:#9DB0FF}.rpt .mtip em.t{color:#FF9C9C}',
    '.rpt .mtip small{display:block;color:#C9D6D3;font-size:0.7rem}',
    '.rpt .mchart .grid{stroke:#DDE6E4;stroke-width:1}',
    '.rpt .mchart .zero{stroke:var(--ink);stroke-width:1.5}',
    '.rpt .mchart .per{stroke:var(--ledger);stroke-width:1.5;stroke-dasharray:3 3}',
    '.rpt .mchart .ax{font-size:10px;fill:var(--ink2);font-family:"Roboto Condensed",Bahnschrift,sans-serif}',
    '.rpt .mchart .pl{font-size:11px;fill:var(--ledger);font-weight:700;font-family:"Roboto Condensed",Bahnschrift,sans-serif}',
    '.rpt .mchart .fa{fill:var(--accent);opacity:0.28}',
    '.rpt .mchart .fb{fill:#C62828;opacity:0.22}',
    '.rpt .mchart .ln{fill:none;stroke:var(--ink);stroke-width:1.6;stroke-linejoin:round}',
    '.rpt .mchart .tl{font-size:10px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase}',
    '.rpt .mchart .tl.us{fill:var(--accent)}.rpt .mchart .tl.th{fill:#C62828}',
    '.rpt .h2h-hd{display:flex;justify-content:space-between;font-size:0.72rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--ledger);margin-bottom:0.2rem}',
    '.rpt .h2h-row{display:flex;align-items:center;gap:0.4rem;padding:0.22rem 0;border-bottom:1px solid var(--rule)}',
    '.rpt .h2h-row .v{width:2rem;text-align:center;font-family:"Roboto Condensed",Bahnschrift,sans-serif;font-size:1rem}',
    '.rpt .h2h-row .v.b{font-weight:700}',
    '.rpt .h2h-row .lab{width:7.8rem;text-align:center;font-size:0.74rem;color:var(--ink2);flex:none}',
    '.rpt .h2h-row .bar{flex:1;height:0.7rem;position:relative;background:#EEF2F1}',
    '.rpt .h2h-row .bar i{position:absolute;top:0;bottom:0}',
    '.rpt .h2h-row .bar.l i{right:0;background:var(--accent)}.rpt .h2h-row .bar.r i{left:0;background:#8FA7A2}',
    '.rpt .sbars{margin-top:0.2rem}',
    '.rpt .sb{display:flex;align-items:center;gap:0.5rem;padding:0.16rem 0}',
    '.rpt .sb .who{width:8.2rem;flex:none;font-size:0.82rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.rpt .sb .jn{display:inline-block;min-width:1.9rem;font-weight:700;color:var(--ink2);font-family:"Roboto Condensed",Bahnschrift,sans-serif}',
    '.rpt .sb .trk{flex:1;display:flex;height:0.85rem;background:#EEF2F1}',
    '.rpt .sb .trk i{display:block;height:100%}',
    '.rpt .sb b{width:1.8rem;text-align:right;font-family:"Roboto Condensed",Bahnschrift,sans-serif}',
    '.rpt .m2{background:var(--accent)}.rpt .m3{background:var(--ledger)}.rpt .m1{background:#D98E04}.rpt .ma{background:#8FA7A2}',
    '.rpt .sw{display:inline-block;width:0.65rem;height:0.65rem;margin:0 0.2rem 0 0.5rem;vertical-align:-0.05rem}',
    '.rpt .unit{display:inline-flex;gap:0.18rem}',
    '.rpt .unit span{min-width:1.6rem;text-align:center;border:1.5px solid var(--ink);border-radius:0.2rem;font-weight:700;font-size:0.8rem;line-height:1.3rem;padding:0 0.1rem}',
    '.rpt td.up{color:var(--ledger)}.rpt td.down{color:#C62828}',
    '.rpt .foot{margin-top:1.6rem;font-size:0.7rem;color:var(--ink2);border-top:1px solid var(--rule);padding-top:0.4rem;display:flex;justify-content:space-between}',
    '@media print{@page{size:letter;margin:0.45in}',
    ' .rpt{max-width:none;padding:0;font-size:9.5pt}',
    ' .rpt .c.us.m{background:none}',
    ' .rpt .mtip,.rpt .mguide,.rpt .mdot{display:none!important}',
    ' .rpt h2{break-after:avoid}',
    ' .rpt+.rpt{break-before:page;page-break-before:always}',
    ' .rpt table,.rpt .led-blk,.rpt .mchart,.rpt .rpt-grid>div,.rpt .kp{break-inside:avoid}}'
  ].join('\n');

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  // names: 'jersey' | 'first' (first name + last initial) | 'full'
  function playerName(p, names) {
    if (!p) return '';
    // Jersey-only reports still need a name for a player who has no number yet.
    if (names === 'jersey' && p.num) return '';
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
    return na - nb || String(a.num).length - String(b.num).length || nameKey(a).localeCompare(nameKey(b));
  }

  function nameKey(x) { var p = x.p || x; return String((p.first || '') + ' ' + (p.last || '')); }

  // Jersey number, or initials for a player who doesn't have one yet.
  function jerseyText(p) {
    if (!p) return '?';
    if (p.num) return p.num;
    return ((p.first || '').charAt(0) + (p.last || '').charAt(0)).toUpperCase() || '–';
  }
  // '#12 ' (with the space), or '' with no number.
  function hashNum(p) { return p && p.num ? '#' + p.num + ' ' : ''; }

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
      out.push({ id: id, num: jerseyText(p), p: p, line: c.players[id] || C.emptyLine() });
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

  // When each period is scored on its own, the winner of each period is bold and a "Won" column counts them.
  function lineScore(game, meta, c) {
    var h = ['<div class="tw"><table class="line"><thead><tr><th class="l">Team</th>'];
    var i, f = foulsByPeriod(game, c.periods), sep = c.rules.scoreResets;
    for (i = 1; i <= c.periods; i++) h.push('<th>' + C.periodLabel(i, c.rules) + '</th>');
    h.push((sep ? '<th class="b">Won</th>' : '') + '<th class="b">' + (sep ? 'Pts' : 'T') + '</th><th>Fouls</th><th>TO</th></tr></thead><tbody>');
    [['us', meta.team.name, 'them'], ['them', oppName(game), 'us']].forEach(function (row) {
      var tm = row[0], other = row[2];
      h.push('<tr><td class="l b">' + esc(row[1]) + '</td>');
      for (i = 0; i < c.periods; i++) h.push('<td' + (sep && c.byPeriod[tm][i] > c.byPeriod[other][i] ? ' class="b"' : '') + '>' + c.byPeriod[tm][i] + '</td>');
      var tu = c.timeoutsUsed[tm];
      h.push((sep ? '<td class="b">' + c.periodsWon[tm] + '</td>' : '') + '<td class="b">' + c.score[tm] + '</td><td class="dim">' + f[tm].join(' · ') +
        '</td><td class="dim">' + (tu.full + tu.short) + '</td></tr>');
    });
    h.push('</tbody></table></div>');
    return h.join('');
  }

  // "Technicals off the court: head coach 1, assistant coach 1, bench players 1. Head coach ejected."
  function staffText(c, tm) {
    var s = c.staff[tm], parts = [];
    if (s.hc) parts.push('head coach ' + s.hc);
    if (s.ac) parts.push('assistant coach ' + s.ac);
    if (s.bench) parts.push('bench players ' + s.bench);
    if (s.team) parts.push('team ' + s.team);
    if (!parts.length) return '';
    var cs = C.coachStatus(s, c.rules);
    return 'Technicals off the court: ' + parts.join(', ') + '.' + (cs.out ? ' Head coach ejected.' : '');
  }
  function staffLine(c, tm) { var t = staffText(c, tm); return t ? '<p class="key">' + esc(t) + '</p>' : ''; }

  // Show the SF column (points for being fouled on a shot, scrimmage rule) when the game uses it.
  function hasSF(c) { return !!(c.rules.shotFoulAward || c.team.us.awd || c.team.them.awd); }
  var SF_KEY = '<p class="key">SF = points for being fouled on a shot. They count in PTS but not as shots or free throws, so percentages aren’t affected.</p>';

  function ourBox(game, meta, c, names) {
    var rows = boxPlayers(game, meta, c), t = c.team.us, pm = c.pm, sf = hasSF(c);
    var h = ['<div class="tw"><table><thead><tr><th class="l">#</th><th class="l">Player</th>',
      '<th class="b">PTS</th><th>FG</th><th>3P</th><th>FT</th>' + (sf ? '<th>SF</th>' : '') + '<th>OR</th><th>DR</th><th>REB</th>',
      '<th>AST</th><th>STL</th><th>BLK</th><th>CHG</th><th>TO</th><th>PF</th>' + (pm ? '<th>+/−</th>' : '') + '</tr></thead><tbody>'];
    rows.forEach(function (r) {
      var l = r.line, pmCell = pm ? '<td>' + C.fmtPm(pm[r.id]) + '</td>' : '';
      h.push('<tr><td class="jr">' + esc(r.num) + '</td><td class="nm">' + esc(playerName(r.p, names)) +
        '</td><td class="b">' + l.pts + '</td><td>' + ma(l.fgm, l.fga) + '</td><td>' + ma(l.tpm, l.tpa) +
        '</td><td>' + ma(l.ftm, l.fta) + (sf ? '</td><td>' + (l.awd || 0) : '') + '</td><td>' + l.oreb + '</td><td>' + l.dreb + '</td><td>' +
        (l.oreb + l.dreb) + '</td><td>' + l.ast + '</td><td>' + l.stl + '</td><td>' + l.blk +
        '</td><td>' + (l.chg || 0) + '</td><td>' + l.to + '</td>' + pfCell(l, c.rules) + pmCell + '</tr>');
    });
    h.push('<tr class="tot"><td class="l" colspan="2">Team</td><td>' + t.pts + '</td><td>' + ma(t.fgm, t.fga) +
      '</td><td>' + ma(t.tpm, t.tpa) + '</td><td>' + ma(t.ftm, t.fta) + (sf ? '</td><td>' + (t.awd || 0) : '') + '</td><td>' + t.oreb + '</td><td>' +
      t.dreb + '</td><td>' + (t.oreb + t.dreb) + '</td><td>' + t.ast + '</td><td>' + t.stl + '</td><td>' +
      t.blk + '</td><td>' + (t.chg || 0) + '</td><td>' + t.to + '</td><td>' + t.pf + (t.tf ? ' (' + t.tf + 'T)' : '') + '</td>' + (pm ? '<td></td>' : '') + '</tr>');
    var on = C.pctShown(meta.settings);
    h.push('<tr class="pct"><td colspan="3"></td><td>' + pctText(on.fg, t.fgm, t.fga) + '</td><td>' +
      pctText(on.tp, t.tpm, t.tpa) + '</td><td>' + pctText(on.ft, t.ftm, t.fta) + '</td><td colspan="' + (9 + (pm ? 1 : 0) + (sf ? 1 : 0)) + '"></td></tr>');
    h.push('</tbody></table></div>' + staffLine(c, 'us') + (sf ? SF_KEY : ''));
    return h.join('');
  }

  function oppBox(game, c) {
    var keys = Object.keys(c.opp).sort(function (a, b) {
      if (a === '') return 1; if (b === '') return -1;
      return byJersey({ num: a }, { num: b });
    });
    var sf = hasSF(c);
    var h = ['<div class="tw"><table><thead><tr><th class="l">#</th><th class="b">PTS</th><th>FGM</th>',
      '<th>3PM</th><th>FTM</th>' + (sf ? '<th>SF</th>' : '') + '<th>PF</th></tr></thead><tbody>'];
    keys.forEach(function (k) {
      var l = c.opp[k];
      h.push('<tr><td class="jr">' + (k === '' ? '<span class="dim">Team</span>' : esc(k)) + '</td><td class="b">' +
        l.pts + '</td><td>' + l.fgm + '</td><td>' + l.tpm + '</td><td>' + l.ftm + '</td>' + (sf ? '<td>' + (l.awd || 0) + '</td>' : '') + pfCell(l, c.rules) + '</tr>');
    });
    var t = c.team.them;
    h.push('<tr class="tot"><td class="l">Team</td><td>' + t.pts + '</td><td>' + t.fgm + '</td><td>' + t.tpm +
      '</td><td>' + t.ftm + '</td>' + (sf ? '<td>' + (t.awd || 0) + '</td>' : '') + '<td>' + t.pf + '</td></tr></tbody></table></div>' + staffLine(c, 'them'));
    return h.join('');
  }

  function flowBlock(game, meta, c, names) {
    var f = C.gameFlow(game.events || []);
    var top = boxPlayers(game, meta, c).sort(function (a, b) { return b.line.pts - a.line.pts; })[0];
    var to = c.timeoutLog.map(function (t) {
      return (t.tm === 'us' ? meta.team.short || meta.team.name : 'OPP') + ' ' + C.periodLabel(t.q, c.rules) +
        (t.v === 'short' ? ' (30s)' : '');
    });
    function item(k, v, wide) { return '<div' + (wide ? ' style="flex-basis:100%"' : '') + '><dt>' + k + '</dt><dd>' + v + '</dd></div>'; }
    var star = boxPlayers(game, meta, c).sort(function (a, b) { return gameScore(b.line) - gameScore(a.line); })[0];
    var starText = star && gameScore(star.line) > 0 ? (esc(hashNum(star.p)) + esc(playerName(star.p, names === 'jersey' ? 'first' : names))).trim() + ' — ' + star.line.pts + ' pts, ' +
      (star.line.oreb + star.line.dreb) + ' reb, ' + star.line.ast + ' ast' + (star.line.stl ? ', ' + star.line.stl + ' stl' : '') : '—';
    var topName = top && top.line.pts ? (esc(hashNum(top.p)) + esc(playerName(top.p, names))).trim() + ' — ' + top.line.pts : '—';
    return '<dl>' +
      item('Top performer', starText, true) +
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
      if (!C.points(e)) continue;
      var start = tot[e.tm] + 1;
      tot[e.tm] += e.v;
      // Shooting-foul points (scrimmage rule) get a green slash, so they aren't mistaken for a basket.
      for (var n = start; n <= tot[e.tm]; n++) cells[e.tm][n] = { v: e.t === 'award' ? 'a' : e.v, last: n === tot[e.tm] };
      var jr = e.tm === 'us' ? jerseyText(findPlayer(game, meta, e.p)) : e.p;
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
    h.push('<div class="led-key">Slash = 2 pts · circled = 3 pts · dot = free throw' + (hasSF(c) ? ' · green slash = shooting-foul point' : '') +
      ' · jersey under the last point of each basket · heavy line = end of period</div></div>');
    return h.join('');
  }

  // ---------- Visuals (plain HTML/SVG so they work in the saved file, published link and print) ----------

  // Possessions estimate from our plays (no clock; the opponent's misses aren't recorded).
  function possOf(l) { return Math.max(0, l.fga - l.oreb + l.to + 0.44 * l.fta); }
  // Game score: a stat line in one number (10 is a solid game).
  function gameScore(l) {
    return l.pts + 0.4 * l.fgm - 0.7 * l.fga - 0.4 * (l.fta - l.ftm) + 0.7 * l.oreb + 0.3 * l.dreb + l.stl + 0.7 * l.ast + 0.7 * l.blk - 0.4 * l.pf - l.to;
  }
  function pct1(m, a) { return a ? (Math.round(m / a * 1000) / 10).toFixed(1) : '—'; }

  // Headline team numbers for this game.
  function glance(game, meta, c) {
    var l = c.team.us, on = C.pctShown(meta.settings), poss = possOf(l);
    function cell(v, lab, sub) { return '<div><b>' + v + '</b><span>' + lab + '</span>' + (sub ? '<small>' + sub + '</small>' : '') + '</div>'; }
    function shot(m, a, show) { return show ? pct1(m, a) + (a ? '%' : '') : 'N/A'; }
    return '<div class="kp">' +
      cell(shot(l.fgm, l.fga, on.fg), 'Field goals', ma(l.fgm, l.fga)) +
      cell(shot(l.tpm, l.tpa, on.tp), '3-pointers', ma(l.tpm, l.tpa)) +
      cell(shot(l.ftm, l.fta, on.ft), 'Free throws', ma(l.ftm, l.fta)) +
      cell(l.oreb + l.dreb, 'Rebounds', l.oreb + ' offensive') +
      cell(l.ast, 'Assists', l.fgm ? Math.round(l.ast / l.fgm * 100) + '% of baskets' : '') +
      cell(l.to, 'Turnovers', l.stl + ' steals') +
      cell(Math.round(poss), 'Possessions', 'estimated') +
      cell(poss ? Math.round(c.score.us / poss * 100) : '—', 'Pts / 100 poss', 'allowed ' + (poss ? Math.round(c.score.them / poss * 100) : '—')) +
      '</div>';
  }

  // Score margin over the game: above the line = we led, below = they led. The x axis is play order
  // (there's no clock), with a divider where each period starts.
  // Hover (mouse) or touch-and-drag (finger) on a margin chart: a guide line and dot follow, with the
  // score, margin and the basket at that point. Self-contained, so the saved/published file can run it too.
  function bindMargin(root) {
    var wraps = (root || document).querySelectorAll('.mwrap');
    for (var k = 0; k < wraps.length; k++) (function (w) {
      if (w.getAttribute('data-bound')) return;
      w.setAttribute('data-bound', '1');
      var svg = w.querySelector('svg'), tip = w.querySelector('.mtip'), guide = w.querySelector('.mguide'), dot = w.querySelector('.mdot');
      var d = JSON.parse(w.getAttribute('data-m')), steps = d.s, Wd = d.w, L = d.l, R = d.r, T = d.t, B = d.b, H = d.h, n = d.n, lim = d.lim;
      function x(i) { return L + i / n * (Wd - L - R); }
      function y(m) { return T + (lim - m) / (2 * lim) * (H - T - B); }
      function show(clientX) {
        var r = svg.getBoundingClientRect(), vx = (clientX - r.left) / r.width * Wd, i = (vx - L) / (Wd - L - R) * n, cur = null;
        for (var j = 0; j < steps.length; j++) { if (steps[j][0] <= i) cur = steps[j]; else break; }
        var at = cur ? cur[0] : 0, us = cur ? cur[1] : 0, th = cur ? cur[2] : 0, m = us - th;
        guide.setAttribute('x1', x(at)); guide.setAttribute('x2', x(at)); dot.setAttribute('cx', x(at)); dot.setAttribute('cy', y(m));
        guide.style.display = dot.style.display = '';
        tip.innerHTML = '<span>' + (cur ? cur[3] : d.q0) + '</span><b>' + d.us + ' ' + us + '–' + th + ' ' + d.them + '</b>' +
          '<em class="' + (m > 0 ? 'u' : m < 0 ? 't' : '') + '">' + (m > 0 ? d.us + ' +' + m : m < 0 ? d.them + ' +' + (-m) : 'Tied') + '</em>' +
          (cur && cur[4] ? '<small>' + cur[4] + '</small>' : '<small>Before the first basket</small>');
        tip.style.display = 'block';
        var px = x(at) / Wd * r.width, half = tip.offsetWidth / 2;
        tip.style.left = Math.max(half, Math.min(r.width - half, px)) + 'px';
      }
      function hide() { tip.style.display = 'none'; guide.style.display = dot.style.display = 'none'; }
      var touching = false;
      w.addEventListener('mousemove', function (e) { if (!touching) show(e.clientX); });
      w.addEventListener('mouseleave', hide);
      w.addEventListener('touchstart', function (e) { touching = true; show(e.touches[0].clientX); }, { passive: true });
      w.addEventListener('touchmove', function (e) { show(e.touches[0].clientX); }, { passive: true });
      document.addEventListener('touchstart', function (e) { if (!w.contains(e.target)) { touching = false; hide(); } }, { passive: true });
    })(wraps[k]);
  }

  function marginChart(game, meta, c, names) {
    var ev = (game.events || []).filter(function (e) { return e.t !== 'sub' && e.t !== 'timeout'; }), n = ev.length;
    if (!n || !(c.score.us + c.score.them)) return '';
    var us = 0, th = 0, pts = [[0, 0]], starts = [], seenQ = {}, top = 0, low = 0, steps = [];
    var what = { 1: 'free throw', 2: '2-pointer', 3: '3-pointer' };
    ev.forEach(function (e, i) {
      if (!seenQ[e.q]) { seenQ[e.q] = true; starts.push([e.q, i]); }
      var p = C.points(e);
      if (!p) return;
      pts.push([i + 0.5, us - th]);
      if (e.tm === 'us') us += p; else th += p;
      pts.push([i + 0.5, us - th]);
      var who = e.tm === 'us' ? (function (pl) { return pl ? (hashNum(pl) + playerName(pl, names)).trim() : ''; })(findPlayer(game, meta, e.p)) || meta.team.name
        : oppName(game) + (e.p ? ' #' + e.p : '');
      steps.push([i + 0.5, us, th, C.periodLabel(e.q, c.rules), esc(who) + ' · ' + (e.t === 'award' ? (p === 1 ? 'shooting-foul point' : p + ' shooting-foul points') : what[p] || p + ' pts')]);
      top = Math.max(top, us - th); low = Math.min(low, us - th);
    });
    pts.push([n, us - th]);
    var lim = Math.max(5, Math.ceil(Math.max(top, -low) / 5) * 5);
    var W = 720, H = 190, L = 34, R = 10, T = 12, B = 24;
    function x(i) { return (L + i / n * (W - L - R)).toFixed(1); }
    function y(m) { return (T + (lim - m) / (2 * lim) * (H - T - B)).toFixed(1); }
    var line = 'M' + pts.map(function (p) { return x(p[0]) + ',' + y(p[1]); }).join(' L');
    var area = line + ' L' + x(n) + ',' + y(0) + ' L' + x(0) + ',' + y(0) + ' Z';
    var id = 'mc' + String(game.id || 'x').replace(/[^a-z0-9]/gi, '');
    var s = ['<svg class="mchart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Score margin through the game">',
      '<defs><clipPath id="' + id + 'a"><rect x="0" y="0" width="' + W + '" height="' + y(0) + '"/></clipPath>',
      '<clipPath id="' + id + 'b"><rect x="0" y="' + y(0) + '" width="' + W + '" height="' + H + '"/></clipPath></defs>'];
    // Gridlines every 5 (or 10) points.
    var step = lim > 20 ? 10 : 5;
    for (var g = -lim; g <= lim; g += step) {
      s.push('<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(g) + '" y2="' + y(g) + '" class="' + (g === 0 ? 'zero' : 'grid') + '"/>');
      s.push('<text x="' + (L - 6) + '" y="' + (+y(g) + 4) + '" class="ax" text-anchor="end">' + (g > 0 ? '+' + g : g) + '</text>');
    }
    starts.forEach(function (st, k) {
      var x0 = +x(st[1]), x1 = k + 1 < starts.length ? +x(starts[k + 1][1]) : W - R;
      if (k) s.push('<line x1="' + x0 + '" x2="' + x0 + '" y1="' + T + '" y2="' + (H - B) + '" class="per"/>');
      s.push('<text x="' + ((x0 + x1) / 2).toFixed(1) + '" y="' + (H - 7) + '" class="pl" text-anchor="middle">' + C.periodLabel(st[0], c.rules) + '</text>');
    });
    s.push('<path d="' + area + '" class="fa" clip-path="url(#' + id + 'a)"/><path d="' + area + '" class="fb" clip-path="url(#' + id + 'b)"/>');
    s.push('<path d="' + line + '" class="ln"/>');
    s.push('<line class="mguide" x1="0" x2="0" y1="' + T + '" y2="' + (H - B) + '" style="display:none"/><circle class="mdot" r="5" cx="0" cy="0" style="display:none"/>');
    s.push('<text x="' + (L + 6) + '" y="' + (T + 13) + '" class="tl us">' + esc(meta.team.name) + ' ahead</text>');
    s.push('<text x="' + (L + 6) + '" y="' + (H - B - 6) + '" class="tl th">' + esc(oppName(game)) + ' ahead</text>');
    s.push('</svg>');
    var f = C.gameFlow(game.events || []);
    var data = { s: steps, w: W, l: L, r: R, t: T, b: B, h: H, n: n, lim: lim, us: esc(meta.team.name), them: esc(oppName(game)), q0: C.periodLabel(1, c.rules) };
    return '<div class="mwrap" data-m="' + esc(JSON.stringify(data)) + '">' + s.join('') + '<div class="mtip"></div></div><p class="key">Biggest lead: ' + esc(meta.team.name) + ' ' + f.biggestLead.us + ', ' + esc(oppName(game)) + ' ' + f.biggestLead.them +
      ' · lead changes: ' + f.leadChanges + ' · times tied: ' + f.ties + '. Hover over the chart, or touch and slide along it, to see the score at any point. Plays run left to right (no clock), so a long stretch means lots of plays, not lots of time.</p>';
  }

  // Head-to-head bars: ours grow left from the middle, theirs grow right.
  function headToHead(game, meta, c) {
    var u = c.team.us, t = c.team.them, tu = c.timeoutsUsed;
    var rows = [['Points', c.score.us, c.score.them], ['2-pointers made', u.fgm - u.tpm, t.fgm - t.tpm], ['3-pointers made', u.tpm, t.tpm],
      ['Free throws made', u.ftm, t.ftm], ['Fouls', u.pf, t.pf], ['Timeouts used', tu.us.full + tu.us.short, tu.them.full + tu.them.short]];
    var top = Math.max.apply(null, rows.slice(1).map(function (r) { return Math.max(r[1], r[2]); }).concat([1]));
    return '<div class="h2h"><div class="h2h-hd"><span>' + esc(meta.team.short || meta.team.name) + '</span><span>' + esc(oppName(game)) + '</span></div>' +
      rows.map(function (r, i) {
        var m = i === 0 ? Math.max(r[1], r[2], 1) : top;
        return '<div class="h2h-row"><span class="v' + (r[1] > r[2] ? ' b' : '') + '">' + r[1] + '</span><span class="bar l"><i style="width:' + (r[1] / m * 100).toFixed(1) +
          '%"></i></span><span class="lab">' + r[0] + '</span><span class="bar r"><i style="width:' + (r[2] / m * 100).toFixed(1) + '%"></i></span><span class="v' +
          (r[2] > r[1] ? ' b' : '') + '">' + r[2] + '</span></div>';
      }).join('') + '</div>';
  }

  // Who scored, as bars split into 2s, 3s, free throws (and shooting-foul points).
  function scorerBars(rows) {
    rows = rows.filter(function (r) { return r.l.pts > 0; }).sort(function (a, b) { return b.l.pts - a.l.pts; });
    if (!rows.length) return '<p class="key">No points.</p>';
    var max = rows[0].l.pts;
    return '<div class="sbars">' + rows.map(function (r) {
      var l = r.l, p2 = 2 * (l.fgm - l.tpm), p3 = 3 * l.tpm, a = l.awd || 0;
      function seg(v, cls) { return v ? '<i class="' + cls + '" style="width:' + (v / max * 100).toFixed(1) + '%"></i>' : ''; }
      return '<div class="sb"><span class="who">' + r.label + '</span><span class="trk">' + seg(p2, 'm2') + seg(p3, 'm3') + seg(l.ftm, 'm1') + seg(a, 'ma') +
        '</span><b>' + l.pts + '</b></div>';
    }).join('') + '</div><p class="key"><i class="sw m2"></i>2s <i class="sw m3"></i>3s <i class="sw m1"></i>free throws' +
      (rows.some(function (r) { return r.l.awd; }) ? ' <i class="sw ma"></i>shooting fouls' : '') + '</p>';
  }

  // Five-player groups used in this game (from the logged subs): points for and against with each on court.
  function lineupsBlock(game, meta, c) {
    if (!game.subLog || !C.replayLineup) return '';
    var units = {}, list = [];
    C.replayLineup(game, function (e, on) {
      if (on.length !== 5 || e.t === 'sub' || e.t === 'timeout') return;
      var k = on.slice().sort().join('|'), u = units[k] || (units[k] = { ids: on.slice(), pf: 0, pa: 0, poss: 0 });
      var p = C.points(e);
      if (p) { if (e.tm === 'us') u.pf += p; else u.pa += p; }
      if (e.tm === 'us') {
        if (e.t === 'make' || e.t === 'miss') u.poss += e.v === 1 ? 0.44 : 1;
        else if (e.t === 'reb' && e.v === 'o') u.poss -= 1;
        else if (e.t === 'to') u.poss += 1;
      }
    });
    Object.keys(units).forEach(function (k) { list.push(units[k]); });
    if (!list.length) return '';
    list.sort(function (a, b) { return b.poss - a.poss; });
    return '<div class="tw"><table><thead><tr><th class="l">Lineup</th><th title="Our possessions, estimated">Poss</th><th>PF</th><th>PA</th><th class="b">+/−</th></tr></thead><tbody>' +
      list.map(function (u) {
        var ps = u.ids.map(function (id) { return findPlayer(game, meta, id) || { num: '?' }; }).sort(byJersey);
        var d = u.pf - u.pa;
        return '<tr><td class="l"><span class="unit">' + ps.map(function (p) { return '<span>' + esc(jerseyText(p)) + '</span>'; }).join('') + '</span></td><td>' +
          Math.max(0, Math.round(u.poss)) + '</td><td>' + u.pf + '</td><td>' + u.pa + '</td><td class="b ' + (d > 0 ? 'up' : d < 0 ? 'down' : '') + '">' + (d > 0 ? '+' + d : d) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  // ---------- The opponent's page ----------
  // Their numbers at a glance.
  function oppGlance(game, meta, c) {
    var t = c.team.them, f = C.gameFlow(game.events || []), tu = c.timeoutsUsed.them;
    function cell(v, lab, sub) { return '<div><b>' + v + '</b><span>' + lab + '</span>' + (sub ? '<small>' + sub + '</small>' : '') + '</div>'; }
    return '<div class="kp">' + cell(c.score.them, 'Points') + cell(t.fgm - t.tpm, '2-pointers made') + cell(t.tpm, '3-pointers made') +
      cell(t.ftm, 'Free throws made') + cell(t.pf, 'Fouls', (t.tf ? t.tf + ' technical' + (t.tf > 1 ? 's' : '') : '')) + cell(tu.full + tu.short, 'Timeouts used') +
      cell(f.biggestLead.them, 'Biggest lead') + cell(f.bestRun.them + '–0', 'Best run') + '</div>';
  }
  // By jersey, with points in each period.
  function oppBoxFull(game, c) {
    var keys = Object.keys(c.opp).sort(function (a, b) { if (a === '') return 1; if (b === '') return -1; return byJersey({ num: a }, { num: b }); });
    var sf = hasSF(c), byQ = {}, n = c.periods, q;
    (game.events || []).forEach(function (e) {
      var p = C.points(e);
      if (!p || e.tm !== 'them') return;
      var k = e.p || '', row = byQ[k] || (byQ[k] = []);
      row[e.q - 1] = (row[e.q - 1] || 0) + p;
    });
    var head = '';
    for (q = 1; q <= n; q++) head += '<th>' + C.periodLabel(q, c.rules) + '</th>';
    var h = ['<div class="tw"><table><thead><tr><th class="l">#</th><th class="b">PTS</th>' + head + '<th>2PM</th><th>3PM</th><th>FTM</th>' + (sf ? '<th>SF</th>' : '') + '<th>PF</th></tr></thead><tbody>'];
    keys.forEach(function (k) {
      var l = c.opp[k], qs = '';
      for (q = 0; q < n; q++) qs += '<td class="dim">' + ((byQ[k] && byQ[k][q]) || '·') + '</td>';
      h.push('<tr><td class="jr">' + (k === '' ? '<span class="dim">Team</span>' : esc(k)) + '</td><td class="b">' + l.pts + '</td>' + qs + '<td>' + (l.fgm - l.tpm) + '</td><td>' + l.tpm +
        '</td><td>' + l.ftm + '</td>' + (sf ? '<td>' + (l.awd || 0) + '</td>' : '') + pfCell(l, c.rules) + '</tr>');
    });
    var t = c.team.them, tq = '';
    for (q = 0; q < n; q++) tq += '<td>' + c.byPeriod.them[q] + '</td>';
    h.push('<tr class="tot"><td class="l">Team</td><td>' + t.pts + '</td>' + tq + '<td>' + (t.fgm - t.tpm) + '</td><td>' + t.tpm + '</td><td>' + t.ftm + '</td>' + (sf ? '<td>' + (t.awd || 0) + '</td>' : '') +
      '<td>' + t.pf + '</td></tr></tbody></table></div>' + staffLine(c, 'them'));
    return h.join('');
  }
  // Fouls and timeouts by period, both teams (bonus situations at a glance).
  function foulsTimeouts(game, meta, c) {
    var f = foulsByPeriod(game, c.periods), head = '', a = '', b = '', q;
    for (q = 0; q < c.periods; q++) { head += '<th>' + C.periodLabel(q + 1, c.rules) + '</th>'; a += '<td>' + f.them[q] + '</td>'; b += '<td>' + f.us[q] + '</td>'; }
    var to = c.timeoutLog.filter(function (t) { return t.tm === 'them'; }).map(function (t) { return C.periodLabel(t.q, c.rules) + (t.v === 'short' ? ' (30s)' : ''); });
    return '<div class="tw"><table><thead><tr><th class="l">Team fouls</th>' + head + '<th class="b">Total</th></tr></thead><tbody>' +
      '<tr><td class="l">' + esc(oppName(game)) + '</td>' + a + '<td class="b">' + c.team.them.pf + '</td></tr>' +
      '<tr><td class="l">' + esc(meta.team.name) + '</td>' + b + '<td class="b">' + c.team.us.pf + '</td></tr></tbody></table></div>' +
      '<p class="key">' + esc(oppName(game)) + ' timeouts: ' + (to.length ? esc(to.join(', ')) : 'none') + '.</p>';
  }

  function render(game, meta, opts) {
    opts = opts || {};
    var names = opts.names || (meta.settings && meta.settings.names) || 'first';
    var c = C.computeGame(game);
    var us = c.score.us, them = c.score.them;
    var status = (game.type === 'scrimmage' ? 'Scrimmage · ' : '') +
      (game.status === 'final' ? (game.type === 'scrimmage' ? 'Final' : resultWord(c, c.rules)) : 'In progress · ' + C.periodLabel(c.quarter, c.rules));
    var h = [], side = opts.side === 'us' || opts.side === 'them' ? opts.side : 'both';
    var pageName = side === 'us' ? meta.team.name : side === 'them' ? oppName(game) : '';
    h.push('<article class="rpt' + (side !== 'both' ? ' rpt-' + side : '') + '">');
    h.push('<header class="rpt-hd">' + (opts.logo ? '<img class="rpt-logo" src="' + esc(opts.logo) + '" alt="">' : '') + '<div class="rpt-title"><div class="rpt-eyebrow">' + esc(status) + ' · ' +
      (game.homeAway === 'away' ? 'Away' : 'Home') + (pageName ? ' · <span class="rpt-page">' + esc(pageName) + ' page</span>' : '') + '</div>');
    h.push('<h1><span class="' + (us > them ? 'win' : '') + '">' + esc(meta.team.name) + ' ' + us +
      '</span><span class="vs">–</span><span class="' + (them > us ? 'win' : '') + '">' + them + ' ' +
      esc(oppName(game)) + '</span></h1></div>');
    h.push((opts.oppLogo ? '<img class="rpt-ologo" src="' + esc(opts.oppLogo) + '" alt="">' : '') + '<div class="rpt-meta"><b>' + esc(fmtDate(game.date)) + '</b>' + esc(game.location || '') + '</div></header>');
    h.push(side === 'them' ? oppGlance(game, meta, c) : glance(game, meta, c));
    h.push('<h2>Score by period</h2>' + lineScore(game, meta, c));
    if (c.rules.scoreResets) h.push('<p class="pw">' + esc(periodsWonText(game, meta, c)) + '</p>');
    var mc = marginChart(game, meta, c, names);
    if (mc) h.push('<h2>Score margin</h2>' + mc);
    if (side === 'them') {
      var oRows = Object.keys(c.opp).map(function (k) { return { l: c.opp[k], label: k === '' ? '<span class="dim">Team</span>' : '<span class="jn">#' + esc(k) + '</span>' }; });
      h.push('<h2>' + esc(oppName(game)) + ' by jersey</h2>' + oppBoxFull(game, c));
      h.push('<div class="rpt-grid"><div><h2>Who scored · ' + esc(oppName(game)) + '</h2>' + scorerBars(oRows) + '</div><div><h2>Head to head</h2>' + headToHead(game, meta, c) + '</div></div>');
      h.push('<h2>Fouls and timeouts</h2>' + foulsTimeouts(game, meta, c));
      h.push('<h2>Running score</h2>' + ledger(game, meta, c));
      h.push('<div class="foot"><span>' + esc(meta.team.name) + ' scorebook</span><span>' + esc(c.rules.name) + ' rules</span></div></article>');
      return h.join('');
    }
    h.push('<h2>' + esc(meta.team.name) + '</h2>' + ourBox(game, meta, c, names));
    var ourRows = boxPlayers(game, meta, c).map(function (r) { return { l: r.line, label: '<span class="jn">' + esc(r.num) + '</span>' + esc(playerName(r.p, names === 'jersey' ? 'first' : names)) }; });
    var oppRows = Object.keys(c.opp).map(function (k) { return { l: c.opp[k], label: k === '' ? '<span class="dim">Team</span>' : '<span class="jn">#' + esc(k) + '</span>' }; });
    h.push('<div class="rpt-grid"><div><h2>Head to head</h2>' + headToHead(game, meta, c) + '</div><div><h2>Game flow</h2>' + flowBlock(game, meta, c, names) + '</div></div>');
    var lu = lineupsBlock(game, meta, c);
    if (side === 'us') {
      h.push('<div class="rpt-grid"><div><h2>Who scored · ' + esc(meta.team.short || meta.team.name) + '</h2>' + scorerBars(ourRows) + '</div>' + (lu ? '<div><h2>Lineups used</h2>' + lu + '</div>' : '') + '</div>');
    } else {
      h.push('<div class="rpt-grid"><div><h2>Who scored · ' + esc(meta.team.short || meta.team.name) + '</h2>' + scorerBars(ourRows) + '</div><div><h2>Who scored · ' + esc(oppName(game)) + '</h2>' + scorerBars(oppRows) + '</div></div>');
      h.push('<div class="rpt-grid"><div><h2>' + esc(oppName(game)) + '</h2>' + oppBox(game, c) + '</div>');
      h.push(lu ? '<div><h2>Lineups used</h2>' + lu + '</div></div>' : '</div>');
    }
    h.push('<h2>Running score</h2>' + ledger(game, meta, c));
    h.push('<div class="foot"><span>' + esc(meta.team.name) + ' scorebook</span><span>' +
      esc(c.rules.name) + ' rules</span></div>');
    h.push('</article>');
    return h.join('');
  }

  // "Periods won: Dalton 4, Trinity 1, 1 tied (points 52–40)" for games scored period by period.
  function periodsWonText(game, meta, c) {
    var w = c.periodsWon, word = c.rules.periods === 2 ? 'Halves' : 'Quarters';
    return word + ' won: ' + meta.team.name + ' ' + w.us + ', ' + oppName(game) + ' ' + w.them + (w.tied ? ', ' + w.tied + ' tied' : '') +
      ' (total points ' + c.score.us + '–' + c.score.them + ')';
  }

  function title(game, meta) {
    var c = C.computeGame(game);
    return (game.type === 'scrimmage' ? 'Scrimmage: ' : '') + meta.team.name + ' ' + c.score.us + ', ' + oppName(game) + ' ' + c.score.them + ' — ' + fmtDate(game.date);
  }

  function standalone(game, meta, opts) {
    return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<meta name="robots" content="noindex,nofollow">' +
      '<title>' + esc(title(game, meta)) + '</title>' +
      '<style>body{margin:0;background:#F4F7F6}' + CSS.replace('--accent:#2340C8', '--accent:' + (meta.team.color || '#2340C8')) +
      '@media screen{.rpt{margin:1rem auto;border:1px solid #C7D5D1}}</style></head><body>' +
      render(game, meta, opts) + '<script>(' + bindMargin.toString() + ')(document);</script></body></html>';
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
    if (c.rules.scoreResets) lines.push(periodsWonText(game, meta, c));
    lines.push('');
    lines.push('Scoring:');
    boxPlayers(game, meta, c).forEach(function (r) {
      if (!r.line.pts && !(r.line.oreb + r.line.dreb) && !r.line.ast && !r.line.chg) return;
      var nm = playerName(r.p, names);
      lines.push((hashNum(r.p) + nm).trim() + ' — ' + r.line.pts + ' pts, ' + (r.line.oreb + r.line.dreb) +
        ' reb, ' + r.line.ast + ' ast' + (r.line.chg ? ', ' + r.line.chg + ' charge' + (r.line.chg > 1 ? 's' : '') + ' taken' : ''));
    });
    lines.push('');
    var on = C.pctShown(meta.settings);
    lines.push('Team: FG ' + ma(t.fgm, t.fga) + (on.fg ? ' (' + pctText(true, t.fgm, t.fga) + ')' : '') + ', 3P ' + ma(t.tpm, t.tpa) +
      ', FT ' + ma(t.ftm, t.fta) + (t.awd ? ', shooting-foul points ' + t.awd : '') + ', REB ' + (t.oreb + t.dreb) + ', AST ' + t.ast + ', TO ' + t.to);
    var st = staffText(c, 'us'), so = staffText(c, 'them');
    if (st) lines.push(meta.team.name + ' — ' + st);
    if (so) lines.push(oppName(game) + ' — ' + so);
    if (opts && opts.url) { lines.push(''); lines.push('Full report: ' + opts.url); }
    return lines.join('\n');
  }

  // Box score for the live game's sheet: the line score, then one team's box.
  function liveBox(game, meta, names, side) {
    var c = C.computeGame(game);
    return '<article class="rpt rpt-mini">' + lineScore(game, meta, c) + (side === 'them' ? '<h2>' + esc(oppName(game)) + ' by jersey</h2>' + oppBox(game, c)
      : '<h2>' + esc(meta.team.name) + '</h2>' + ourBox(game, meta, c, names)) + '</article>';
  }

  root.SBReport = {
    CSS: CSS,
    liveBox: liveBox,
    bindCharts: bindMargin,
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
