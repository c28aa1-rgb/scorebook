/*
 * Season stats: everything that can be worked out from the plays, and the stat sheets that show it.
 * The same sheets are shown in the app and printed, so they're plain tables and CSS bars.
 *
 * There's no game clock, so nothing is per minute. "Possessions" are estimated from our own plays
 * (FGA − OREB + TO + 0.44 × FTA); the opponent's misses aren't recorded, so their possessions are
 * taken to be the same as ours (teams alternate possessions).
 *
 * compute(): pure (runs in Node tests). Renderers return HTML strings. ES5 for the Fire tablets.
 */
(function (root) {
  'use strict';
  var C = root.SBCore;

  // ---------- small helpers ----------
  function poss(l) { return Math.max(0, l.fga - l.oreb + l.to + 0.44 * l.fta); }
  function reb(l) { return l.oreb + l.dreb; }
  function ratio(n, d) { return d ? n / d : null; }
  function efg(l) { return ratio(l.fgm + 0.5 * l.tpm, l.fga); }
  function ts(l) { return ratio(l.pts - (l.awd || 0), 2 * (l.fga + 0.44 * l.fta)); }
  // Hollinger's game score, without minutes: a one-number summary of a stat line.
  function gmsc(l) {
    return l.pts + 0.4 * l.fgm - 0.7 * l.fga - 0.4 * (l.fta - l.ftm) + 0.7 * l.oreb + 0.3 * l.dreb + l.stl +
      0.7 * l.ast + 0.7 * l.blk - 0.4 * l.pf - l.to;
  }
  // Ten or more in two (or three) of points, rebounds, assists, steals, blocks.
  function doubles(l) {
    return [l.pts, reb(l), l.ast, l.stl, l.blk].filter(function (v) { return v >= 10; }).length;
  }
  function blank() { return C.emptyLine(); }
  function wl() { return { w: 0, l: 0, t: 0 }; }
  function addWL(o, m) { if (m > 0) o.w++; else if (m < 0) o.l++; else o.t++; }

  // Changes to our possession count from one of our plays (see the possessions estimate above).
  function possDelta(e) {
    if (e.tm !== 'us') return 0;
    if (e.t === 'make' || e.t === 'miss') return e.v === 1 ? 0.44 : 1;
    if (e.t === 'reb' && e.v === 'o') return -1;
    if (e.t === 'to') return 1;
    return 0;
  }

  /*
   * One finished game, in more detail than computeGame: starters, periods each player was on court,
   * points for/against and possessions while on court, points by period, and 5-man units.
   */
  function gameDetail(g) {
    var c = C.computeGame(g), r = c.rules, events = g.events || [], starters = g.starters || [];
    var d = { g: g, c: c, players: {}, units: {}, tracked: !!g.subLog, flow: C.gameFlow(events),
      margin: c.score.us - c.score.them, poss: poss(c.team.us) };
    function P(id) {
      return d.players[id] || (d.players[id] = { started: starters.indexOf(id) >= 0, periods: {}, onFor: 0, onAgainst: 0, onPoss: 0, byQ: [] });
    }
    (g.appeared || []).forEach(P);
    Object.keys(c.players).forEach(P);

    var us = 0, them = 0, after = [];
    function note(e, on) {
      if (e.t === 'sub' || e.t === 'timeout') return;
      if (on) on.forEach(function (id) { P(id).periods[e.q] = true; });
      if (e.tm === 'us' && e.p && d.players[e.p] !== undefined) P(e.p).periods[e.q] = true;
      var pts = C.points(e), dp = possDelta(e);
      if (pts) {
        if (e.tm === 'us') us += pts; else them += pts;
        if (d.first === undefined) d.first = e.tm;
        if (e.tm === 'us' && e.p) { var pl = P(e.p); pl.byQ[e.q - 1] = (pl.byQ[e.q - 1] || 0) + pts; }
      }
      after[e.q - 1] = { us: us, them: them };
      if (!on) return;
      on.forEach(function (id) {
        var x = P(id);
        if (pts) { if (e.tm === 'us') x.onFor += pts; else x.onAgainst += pts; }
        x.onPoss += dp;
      });
      if (on.length === 5) {
        var key = on.slice().sort().join('|'), u = d.units[key] || (d.units[key] = { ids: on.slice().sort(), pf: 0, pa: 0, poss: 0 });
        if (pts) { if (e.tm === 'us') u.pf += pts; else u.pa += pts; }
        u.poss += dp;
      }
    }
    if (d.tracked) C.replayLineup(g, function (e, on) { note(e, on); });
    else events.forEach(function (e) { note(e, null); });
    // Score at the end of each period (carried forward over periods with no scoring).
    var last = { us: 0, them: 0 };
    for (var q = 0; q < c.periods; q++) { if (after[q]) last = after[q]; after[q] = last; }
    d.after = after;
    var half = Math.floor(r.periods / 2);
    d.half = half && after[half - 1] ? after[half - 1].us - after[half - 1].them : null;
    d.ot = !r.openEnded && c.periods > r.periods;
    return d;
  }

  /*
   * Season numbers from a list of finished games (any filter the caller applied).
   * players: the season roster (so players with no games still get a row).
   */
  function compute(games, players) {
    var details = games.slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.created || 0) - (b.created || 0); })
      .map(gameDetail);
    var T = {
      n: details.length, us: blank(), them: blank(), rec: wl(), home: wl(), away: wl(), close: wl(), ot: wl(),
      leadHalf: wl(), trailHalf: wl(), tiedHalf: wl(), first: wl(), oppFirst: wl(), blowW: 0, blowL: 0,
      pf: 0, pa: 0, poss: 0, per: { us: [], them: [], n: [] }, otPts: { us: 0, them: 0, n: 0 },
      lc: 0, ties: 0, staff: { hc: 0, ac: 0, bench: 0, team: 0 }, toUsed: 0, oppTo: 0, results: []
    };
    var P = {}, units = {}, opps = {}, starts = {};
    function player(id) {
      return P[id] || (P[id] = { id: id, gp: 0, gs: 0, line: blank(), pm: 0, pmGp: 0, onFor: 0, onAgainst: 0, onPoss: 0,
        tFor: 0, tAgainst: 0, tPoss: 0, periods: 0, periodsAvail: 0, byQ: [], byQn: [], team: blank(), dd: 0, td: 0, gs2: 0, games: [] });
    }
    (players || []).forEach(function (p) { player(p.id); });

    details.forEach(function (d) {
      var g = d.g, c = d.c, m = d.margin, r = c.rules;
      T.us = C.addLines(T.us, c.team.us); T.them = C.addLines(T.them, c.team.them);
      T.pf += c.score.us; T.pa += c.score.them; T.poss += d.poss;
      addWL(T.rec, m); addWL(g.homeAway === 'away' ? T.away : T.home, m);
      if (Math.abs(m) <= 5) addWL(T.close, m);
      if (m >= 15) T.blowW++; if (m <= -15) T.blowL++;
      if (d.ot) addWL(T.ot, m);
      if (d.half !== null) addWL(d.half > 0 ? T.leadHalf : d.half < 0 ? T.trailHalf : T.tiedHalf, m);
      if (d.first) addWL(d.first === 'us' ? T.first : T.oppFirst, m);
      T.lc += d.flow.leadChanges; T.ties += d.flow.ties;
      ['hc', 'ac', 'bench', 'team'].forEach(function (k) { T.staff[k] += c.staff.us[k]; });
      T.toUsed += c.timeoutsUsed.us.full + c.timeoutsUsed.us.short;
      T.results.push(m > 0 ? 'W' : m < 0 ? 'L' : 'T');
      // Scoring by period: regulation periods by number, overtime together.
      for (var q = 0; q < c.periods; q++) {
        if (q < r.periods || r.openEnded) {
          T.per.us[q] = (T.per.us[q] || 0) + c.byPeriod.us[q]; T.per.them[q] = (T.per.them[q] || 0) + c.byPeriod.them[q];
          T.per.n[q] = (T.per.n[q] || 0) + 1;
        } else { T.otPts.us += c.byPeriod.us[q]; T.otPts.them += c.byPeriod.them[q]; }
      }
      if (d.ot) T.otPts.n++;
      var ok = (g.opponent || 'Opponent').trim(), o = opps[ok.toLowerCase()] || (opps[ok.toLowerCase()] = { name: ok, rec: wl(), pf: 0, pa: 0, games: [] });
      addWL(o.rec, m); o.pf += c.score.us; o.pa += c.score.them; o.games.push(d);

      if (d.tracked && g.starters && g.starters.length === 5) {
        var sk = g.starters.slice().sort().join('|'), st = starts[sk] || (starts[sk] = { ids: g.starters.slice().sort(), rec: wl(), pf: 0, pa: 0 });
        addWL(st.rec, m); st.pf += c.score.us; st.pa += c.score.them;
      }
      Object.keys(d.units).forEach(function (k) {
        var u = d.units[k], U = units[k] || (units[k] = { ids: u.ids, gp: 0, pf: 0, pa: 0, poss: 0 });
        U.gp++; U.pf += u.pf; U.pa += u.pa; U.poss += u.poss;
      });

      Object.keys(d.players).forEach(function (id) {
        var x = d.players[id], s = player(id), line = c.players[id] || blank(), pm = c.pm ? c.pm[id] : undefined;
        s.gp++; if (x.started) s.gs++;
        s.line = C.addLines(s.line, line);
        s.team = C.addLines(s.team, c.team.us);
        if (pm !== undefined) { s.pm += pm; s.pmGp++; }
        if (d.tracked) {
          s.onFor += x.onFor; s.onAgainst += x.onAgainst; s.onPoss += x.onPoss;
          s.tFor += c.score.us; s.tAgainst += c.score.them; s.tPoss += d.poss;
        }
        var np = Object.keys(x.periods).length;
        s.periods += np; s.periodsAvail += c.periods;
        for (var q2 = 0; q2 < Math.min(c.periods, r.periods); q2++) {
          s.byQ[q2] = (s.byQ[q2] || 0) + (x.byQ[q2] || 0); s.byQn[q2] = (s.byQn[q2] || 0) + 1;
        }
        var dbl = doubles(line);
        if (dbl >= 2) s.dd++; if (dbl >= 3) s.td++;
        s.games.push({ d: d, line: line, pm: pm, started: x.started, periods: np, gmsc: gmsc(line) });
      });
    });

    // Streak: the run of identical results at the end.
    var res = T.results, k2 = res.length - 1, streak = '';
    if (k2 >= 0) { var n = 0; while (k2 - n >= 0 && res[k2 - n] === res[k2]) n++; streak = res[k2] + n; }
    T.streak = streak;
    T.last5 = wl(); res.slice(-5).forEach(function (x) { T.last5[x === 'W' ? 'w' : x === 'L' ? 'l' : 't']++; });

    return {
      details: details, team: T, players: P,
      units: Object.keys(units).map(function (k) { return units[k]; }),
      starts: Object.keys(starts).map(function (k) { return starts[k]; }),
      opponents: Object.keys(opps).map(function (k) { return opps[k]; }).sort(function (a, b) { return a.games[0].g.date < b.games[0].g.date ? -1 : 1; })
    };
  }

  root.SBStatsCalc = {
    compute: compute, gameDetail: gameDetail, poss: poss, efg: efg, ts: ts, gmsc: gmsc, doubles: doubles, reb: reb, ratio: ratio
  };

  // =====================================================================================
  // Stat sheets. ctx: { teamName, oppWord, season, filter (label), players (season roster),
  //   find(id) -> player, name(p), full(p), jersey(p), on (pctShown), link (rows open things),
  //   sort { k, dir } for the players table, view for the players table }
  // =====================================================================================
  function esc(s) {
    return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function f1(n) { return n === null || n === undefined || isNaN(n) ? '—' : (Math.round(n * 10) / 10).toFixed(1); }
  function per(n, gp) { return gp ? f1(n / gp) : '—'; }
  function pc(r) { return r === null || r === undefined ? '—' : (r * 100 >= 99.95 ? '100' : (r * 100).toFixed(1)); }
  function sgn(n) { return n === null || n === undefined || isNaN(n) ? '—' : n > 0 ? '+' + n : String(n); }
  function sgn1(n) { return n === null || n === undefined || isNaN(n) ? '—' : (n > 0 ? '+' : '') + f1(n); }
  function rec(o) { return o.w + '–' + o.l + (o.t ? '–' + o.t : ''); }
  function ma(m, a) { return m + '-' + a; }
  function shortDate(iso) {
    var p = (iso || '').split('-'), mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return p.length === 3 ? mo[+p[1] - 1] + ' ' + (+p[2]) : '';
  }
  function vs(g) { return (g.homeAway === 'away' ? '@ ' : 'vs ') + (g.opponent || 'Opponent'); }
  function result(d) { return (d.margin > 0 ? 'W' : d.margin < 0 ? 'L' : 'T') + ' ' + d.c.score.us + '–' + d.c.score.them; }

  // Shooting numbers respect Settings → shooting percentages (N/A when misses aren't recorded).
  function pcIf(on, m, a) { return on ? pc(ratio(m, a)) : 'N/A'; }
  function efgIf(ctx, l) { return ctx.on.fg ? pcs(efg(l)) : 'N/A'; }
  function tsIf(ctx, l) { return ctx.on.fg && ctx.on.ft ? pcs(ts(l)) : 'N/A'; }
  // Percentage with its sign, for the label/value lists.
  function pcs(r) { return r === null || r === undefined ? '—' : pc(r) + '%'; }

  function sheet(ctx, title, right, body, cls) {
    return '<section class="sx' + (cls ? ' ' + cls : '') + '"><header class="sx-hd"><div><div class="sx-eye">' + esc(ctx.teamName) + ' · ' +
      esc(ctx.season) + ' · ' + esc(ctx.filter) + '</div><h1>' + title + '</h1></div><div class="sx-meta">' + (right || '') + '</div></header>' + body + '</section>';
  }
  function h2(t, small) { return '<h2>' + t + (small ? ' <small>' + small + '</small>' : '') + '</h2>'; }
  function kpis(list) {
    return '<div class="sx-kpis">' + list.map(function (k) {
      return '<div' + (k[2] ? ' class="' + k[2] + '"' : '') + '><b>' + k[0] + '</b><span>' + k[1] + '</span>' + (k[3] ? '<em>' + k[3] + '</em>' : '') + '</div>';
    }).join('') + '</div>';
  }
  function dl(rows, cls) {
    return '<dl class="sx-dl' + (cls ? ' ' + cls : '') + '">' + rows.map(function (r) {
      return '<div><dt>' + r[0] + (r[2] ? '<small>' + r[2] + '</small>' : '') + '</dt><dd>' + r[1] + '</dd></div>';
    }).join('') + '</dl>';
  }
  function bar(frac, cls) {
    var w = Math.max(0, Math.min(1, frac || 0)) * 100;
    return '<span class="sx-bar' + (cls ? ' ' + cls : '') + '"><i style="width:' + w.toFixed(1) + '%"></i></span>';
  }
  // Points mix: share from 2s, 3s, free throws (and shooting-foul points in scrimmages).
  function mix(l) {
    var p2 = 2 * (l.fgm - l.tpm), p3 = 3 * l.tpm, pf = l.ftm, pa = l.awd || 0, tot = p2 + p3 + pf + pa;
    if (!tot) return '<p class="sx-none">No points yet.</p>';
    function seg(v, cls, lab) { return v ? '<i class="' + cls + '" style="width:' + (v / tot * 100).toFixed(1) + '%" title="' + lab + '"></i>' : ''; }
    function key(v, cls, lab) { return v ? '<span><i class="' + cls + '"></i>' + lab + ' ' + Math.round(v / tot * 100) + '% <small>(' + v + ')</small></span>' : ''; }
    return '<div class="sx-mix">' + seg(p2, 'm2', '2s') + seg(p3, 'm3', '3s') + seg(pf, 'm1', 'FTs') + seg(pa, 'ma', 'SF') + '</div>' +
      '<div class="sx-key">' + key(p2, 'm2', '2-pointers') + key(p3, 'm3', '3-pointers') + key(pf, 'm1', 'Free throws') + key(pa, 'ma', 'Shooting fouls') + '</div>';
  }
  // Made/attempted bar rows for 2s, 3s and free throws.
  function shotBars(ctx, l) {
    function row(lab, m, a, on) {
      return '<div class="sx-shot"><span class="lab">' + lab + '</span>' + bar(on && a ? m / a : 0, 'shot') +
        '<span class="v"><b>' + (on ? pc(ratio(m, a)) + (a ? '%' : '') : 'N/A') + '</b><small>' + ma(m, a) + '</small></span></div>';
    }
    return row('2PT', l.fgm - l.tpm, l.fga - l.tpa, ctx.on.fg) + row('3PT', l.tpm, l.tpa, ctx.on.tp) + row('FT', l.ftm, l.fta, ctx.on.ft);
  }
  function pTag(ctx, p) { return '<span class="sx-jr">' + esc(ctx.jersey(p)) + '</span>' + esc(ctx.name(p)); }
  function link(ctx, hash) { return ctx.link ? ' class="tap" data-a="go" data-x="' + hash + '"' : ''; }
  function rosterRows(S, ctx) {
    var seen = {}, rows = [];
    (ctx.players || []).forEach(function (p) { seen[p.id] = true; rows.push({ p: p, s: S.players[p.id] }); });
    Object.keys(S.players).forEach(function (id) {
      if (!seen[id]) { var p = ctx.find(id); if (p) rows.push({ p: p, s: S.players[id] }); }
    });
    return rows.filter(function (r) { return r.s; });
  }

  // ---------- Team ----------
  function teamSheet(S, ctx) {
    var T = S.team, n = T.n, us = T.us, th = T.them, h = [];
    if (!n) return sheet(ctx, 'Team', '', '<p class="sx-none">No finished games' + (ctx.filter !== 'All games' ? ' match this filter' : '') + ' yet.</p>');
    var ppp = ratio(T.pf, T.poss), oppp = ratio(T.pa, T.poss);
    h.push(kpis([
      [rec(T.rec), 'Record', 'big'], [rec(T.home), 'Home'], [rec(T.away), 'Away'], [T.streak || '—', 'Streak'],
      [rec(T.last5), 'Last ' + Math.min(5, n)], [per(T.pf, n), 'Points / game'], [per(T.pa, n), 'Allowed / game'],
      [sgn1((T.pf - T.pa) / n), 'Margin / game', (T.pf >= T.pa ? 'pos' : 'neg')]
    ]));

    // Scoring by period: averages with bars.
    var np = T.per.us.length, maxv = 1, cols = [];
    for (var q = 0; q < np; q++) cols.push({ lab: ctx.periodLabel(q + 1), us: T.per.us[q] / T.per.n[q], th: T.per.them[q] / T.per.n[q] });
    if (T.otPts.n) cols.push({ lab: 'OT', us: T.otPts.us / T.otPts.n, th: T.otPts.them / T.otPts.n, note: T.otPts.n + ' game' + (T.otPts.n > 1 ? 's' : '') });
    cols.forEach(function (c) { maxv = Math.max(maxv, c.us, c.th); });
    h.push(h2('Scoring by ' + (np === 2 ? 'half' : 'quarter'), 'average points'));
    h.push('<div class="sx-qs">' + cols.map(function (c) {
      var m = c.us - c.th;
      return '<div class="sx-q"><div class="bars"><i class="us" style="height:' + (c.us / maxv * 100).toFixed(1) + '%"><b>' + f1(c.us) + '</b></i>' +
        '<i class="th" style="height:' + (c.th / maxv * 100).toFixed(1) + '%"><b>' + f1(c.th) + '</b></i></div><span class="lab">' + c.lab + '</span>' +
        '<span class="m ' + (m >= 0 ? 'pos' : 'neg') + '">' + sgn1(m) + '</span>' + (c.note ? '<small>' + c.note + '</small>' : '') + '</div>';
    }).join('') + '<div class="sx-qkey"><span><i class="us"></i>' + esc(ctx.teamName) + '</span><span><i class="th"></i>' + esc(ctx.oppWord) + '</span></div></div>');

    h.push('<div class="sx-cols">');
    h.push('<div>' + h2('Shooting') + shotBars(ctx, us) + dl([
      ['Field goals', ctx.on.fg ? pc(ratio(us.fgm, us.fga)) + '% <small>' + ma(us.fgm, us.fga) + '</small>' : 'N/A'],
      ['Effective FG%', efgIf(ctx, us), '3s count 1.5×'], ['True shooting %', tsIf(ctx, us), 'includes free throws'],
      ['3-point attempt rate', pcs(ratio(us.tpa, us.fga)), 'share of shots that are 3s'], ['Free throw rate', f1(ratio(us.fta, us.fga) * 100), 'FTA per 100 shots'],
      ['3-pointers made / game', per(us.tpm, n)], ['Free throws made / game', per(us.ftm, n)]
    ]) + h2('Where the points come from') + mix(us) + '</div>');
    h.push('<div>' + h2('Possessions', 'estimated') + dl([
      ['Possessions / game', per(T.poss, n)], ['Points per 100 possessions', f1(ppp * 100), 'offense'],
      ['Allowed per 100 possessions', f1(oppp * 100), 'defense'], ['Net per 100', sgn1((ppp - oppp) * 100)],
      ['Turnovers / game', per(us.to, n)], ['Turnovers per 100 possessions', f1(ratio(us.to, T.poss) * 100)],
      ['Assists / game', per(us.ast, n)], ['Assisted baskets', pcs(ratio(us.ast, us.fgm)), 'share of made field goals'],
      ['Assist-to-turnover', f1(ratio(us.ast, us.to))], ['Offensive rebounds / game', per(us.oreb, n)],
      ['Defensive rebounds / game', per(us.dreb, n)], ['Steals / game', per(us.stl, n)], ['Blocks / game', per(us.blk, n)],
      ['Charges taken', String(us.chg || 0)]
    ]) + '</div>');
    h.push('</div><div class="sx-cols">');
    h.push('<div>' + h2('Game situations', 'record') + dl([
      ['Close games', rec(T.close), 'decided by 5 or fewer'], ['Won by 15+', String(T.blowW)], ['Lost by 15+', String(T.blowL)],
      ['Overtime', T.ot.w + T.ot.l + T.ot.t ? rec(T.ot) : '—'],
      ['Leading at half', rec(T.leadHalf)], ['Trailing at half', rec(T.trailHalf)], ['Tied at half', rec(T.tiedHalf)],
      ['Scored first', rec(T.first)], [esc(ctx.oppWord) + ' scored first', rec(T.oppFirst)],
      ['Lead changes / game', per(T.lc, n)], ['Times tied / game', per(T.ties, n)]
    ]) + '</div>');
    h.push('<div>' + h2('Fouls and free throws') + dl([
      ['Fouls / game', per(us.pf, n)], ['Fouls drawn / game', per(th.pf, n), esc(ctx.oppWord) + ' fouls'],
      ['Free throw attempts / game', per(us.fta, n)], [esc(ctx.oppWord) + ' free throws made / game', per(th.ftm, n)],
      [esc(ctx.oppWord) + ' 3-pointers / game', per(th.tpm, n)],
      ['Player technicals', String(us.tf || 0)], ['Coach and bench technicals', String(T.staff.hc + T.staff.ac + T.staff.bench + T.staff.team)],
      ['Timeouts used / game', per(T.toUsed, n)]
    ]) + '</div></div>');

    h.push(h2('Opponents'));
    h.push('<table class="sx-t"><thead><tr><th class="l">Opponent</th><th>GP</th><th>W–L</th><th>PF</th><th>PA</th><th>Margin</th><th class="l">Results</th></tr></thead><tbody>' +
      S.opponents.map(function (o) {
        var gp = o.games.length, one = gp === 1 ? link(ctx, '#report/' + o.games[0].g.id) : '';
        return '<tr' + one + '><td class="l nm">' + esc(o.name) + '</td><td>' + gp + '</td><td>' + rec(o.rec) + '</td><td>' + o.pf + '</td><td>' + o.pa +
          '</td><td class="' + (o.pf >= o.pa ? 'pos' : 'neg') + '">' + sgn(o.pf - o.pa) + '</td><td class="l dim">' +
          o.games.map(function (d) { return result(d) + ' (' + shortDate(d.g.date) + ')'; }).join(', ') + '</td></tr>';
      }).join('') + '</tbody></table>');

    h.push(h2('Team highs', 'single game'));
    h.push(teamHighs(S, ctx));
    return sheet(ctx, 'Team', '<b>' + n + '</b> game' + (n === 1 ? '' : 's'), h.join(''));
  }

  function teamHighs(S, ctx) {
    var D = S.details;
    function best(fn, low, min) {
      var b = null;
      D.forEach(function (d) { var v = fn(d); if (v === null || (min && !min(d))) return; if (!b || (low ? v < b.v : v > b.v)) b = { v: v, d: d }; });
      return b;
    }
    function row(lab, b, fmt) {
      return [lab, b ? (fmt ? fmt(b.v) : b.v) + ' <small>' + esc(vs(b.d.g)) + ', ' + shortDate(b.d.g.date) + '</small>' : '—'];
    }
    var u = function (d) { return d.c.team.us; };
    return dl([
      row('Most points', best(function (d) { return d.c.score.us; })),
      row('Fewest allowed', best(function (d) { return d.c.score.them; }, true)),
      row('Biggest win', best(function (d) { return d.margin > 0 ? d.margin : null; }), function (v) { return 'by ' + v; }),
      row('Most 3-pointers', best(function (d) { return u(d).tpm; })),
      row('Most assists', best(function (d) { return u(d).ast; })),
      row('Most rebounds', best(function (d) { return reb(u(d)); })),
      row('Most steals', best(function (d) { return u(d).stl; })),
      row('Fewest turnovers', best(function (d) { return u(d).to; }, true)),
      row('Best FG%', ctx.on.fg ? best(function (d) { return ratio(u(d).fgm, u(d).fga); }, false, function (d) { return u(d).fga >= 20; }) : null,
        function (v) { return pc(v) + '%'; }),
      row('Biggest lead', best(function (d) { return d.flow.biggestLead.us || null; })),
      row('Best run', best(function (d) { return d.flow.bestRun.us || null; }), function (v) { return v + '–0'; })
    ], 'two');
  }

  // ---------- Players table (per game / totals / shooting / advanced) ----------
  var VIEWS = {
    pergame: 'Per game', totals: 'Totals', shooting: 'Shooting', advanced: 'Advanced'
  };
  function onOff(s) {
    if (s.onPoss < 10) return { on: null, off: null };
    var on = (s.onFor - s.onAgainst) / s.onPoss * 100, op = s.tPoss - s.onPoss;
    var off = op >= 10 ? ((s.tFor - s.onFor) - (s.tAgainst - s.onAgainst)) / op * 100 : null;
    return { on: on, off: off };
  }
  function usage(s) { var t = s.team; return ratio(s.line.fga + 0.44 * s.line.fta + s.line.to, t.fga + 0.44 * t.fta + t.to); }
  function playerCols(view, ctx) {
    function c(k, lab, v, fmt, cls, title) { return { k: k, lab: lab, v: v, fmt: fmt || function (x) { return x === null ? '—' : String(x); }, cls: cls, title: title }; }
    // Sorts by the value, shows something else (e.g. made-attempted, sorted by makes).
    function show(col, fn) { col.show = fn; return col; }
    function avgc(k, lab, fn, cls) { return c(k, lab, function (s) { return s.gp ? fn(s.line) / s.gp : null; }, f1, cls); }
    function totc(k, lab, fn, cls) { return c(k, lab, function (s) { return fn(s.line); }, null, cls); }
    function pct(k, lab, m, a, on) { return c(k, lab, function (s) { return on ? ratio(s.line[m], s.line[a]) : null; }, function (x) { return on ? pc(x) : 'N/A'; }); }
    var gp = c('gp', 'GP', function (s) { return s.gp; }), gs = c('gs', 'GS', function (s) { return s.gs; });
    if (view === 'totals') return [gp, gs, totc('pts', 'PTS', function (l) { return l.pts; }, 'b'),
      totc('fgm', 'FGM', function (l) { return l.fgm; }), totc('fga', 'FGA', function (l) { return l.fga; }),
      totc('tpm', '3PM', function (l) { return l.tpm; }), totc('tpa', '3PA', function (l) { return l.tpa; }),
      totc('ftm', 'FTM', function (l) { return l.ftm; }), totc('fta', 'FTA', function (l) { return l.fta; }),
      totc('oreb', 'OR', function (l) { return l.oreb; }), totc('dreb', 'DR', function (l) { return l.dreb; }), totc('reb', 'REB', reb),
      totc('ast', 'AST', function (l) { return l.ast; }), totc('stl', 'STL', function (l) { return l.stl; }), totc('blk', 'BLK', function (l) { return l.blk; }),
      totc('to', 'TO', function (l) { return l.to; }), totc('pf', 'PF', function (l) { return l.pf; }), totc('tf', 'TF', function (l) { return l.tf || 0; }),
      totc('chg', 'CHG', function (l) { return l.chg || 0; }),
      c('pm', '+/−', function (s) { return s.pmGp ? s.pm : null; }, sgn)];
    if (view === 'shooting') return [gp,
      show(c('fg', 'FG', function (s) { return s.line.fgm; }), function (s) { return ma(s.line.fgm, s.line.fga); }), pct('fgp', 'FG%', 'fgm', 'fga', ctx.on.fg),
      show(c('two', '2P', function (s) { return s.line.fgm - s.line.tpm; }), function (s) { return ma(s.line.fgm - s.line.tpm, s.line.fga - s.line.tpa); }), c('twop', '2P%', function (s) { return ctx.on.fg ? ratio(s.line.fgm - s.line.tpm, s.line.fga - s.line.tpa) : null; }, function (x) { return ctx.on.fg ? pc(x) : 'N/A'; }),
      show(c('three', '3P', function (s) { return s.line.tpm; }), function (s) { return ma(s.line.tpm, s.line.tpa); }), pct('tpp', '3P%', 'tpm', 'tpa', ctx.on.tp),
      show(c('ft', 'FT', function (s) { return s.line.ftm; }), function (s) { return ma(s.line.ftm, s.line.fta); }), pct('ftp', 'FT%', 'ftm', 'fta', ctx.on.ft),
      c('efg', 'eFG%', function (s) { return ctx.on.fg ? efg(s.line) : null; }, function (x) { return ctx.on.fg ? pc(x) : 'N/A'; }, 'b', 'Effective FG%: 3s count 1.5×'),
      c('ts', 'TS%', function (s) { return ctx.on.fg && ctx.on.ft ? ts(s.line) : null; }, function (x) { return ctx.on.fg && ctx.on.ft ? pc(x) : 'N/A'; }, '', 'True shooting %: includes free throws'),
      c('pps', 'PTS/FGA', function (s) { return ratio(2 * (s.line.fgm - s.line.tpm) + 3 * s.line.tpm, s.line.fga); }, function (x) { return x === null ? '—' : x.toFixed(2); }),
      c('tpr', '3PA%', function (s) { return ratio(s.line.tpa, s.line.fga); }, pc, '', 'Share of shots that are 3s'),
      c('ftr', 'FTr', function (s) { return ratio(s.line.fta, s.line.fga); }, function (x) { return x === null ? '—' : x.toFixed(2); }, '', 'Free throw attempts per shot')];
    if (view === 'advanced') return [gp, gs,
      c('gmsc', 'GmSc', function (s) { return s.gp ? s.games.reduce(function (a, g) { return a + g.gmsc; }, 0) / s.gp : null; }, f1, 'b', 'Game score per game'),
      c('share', '%PTS', function (s) { return ratio(s.line.pts, s.team.pts); }, pc, '', 'Share of team points in games played'),
      c('usg', 'USG%', function (s) { return usage(s); }, pc, '', 'Share of team possessions used (shots, FTs, turnovers)'),
      c('ato', 'AST/TO', function (s) { return ratio(s.line.ast, s.line.to); }, function (x) { return x === null ? '—' : x.toFixed(2); }),
      c('stocks', 'STL+BLK', function (s) { return s.gp ? (s.line.stl + s.line.blk) / s.gp : null; }, f1),
      c('dd', 'DD', function (s) { return s.dd; }, null, '', 'Double-doubles'),
      c('qp', 'QTRS', function (s) { return s.gp ? s.periods / s.gp : null; }, f1, '', 'Periods played per game'),
      c('pm', '+/−', function (s) { return s.pmGp ? s.pm : null; }, sgn),
      c('pmg', '+/− G', function (s) { return s.pmGp ? s.pm / s.pmGp : null; }, sgn1),
      c('onr', 'ON', function (s) { return onOff(s).on; }, sgn1, '', 'Team net points per 100 possessions with them on court'),
      c('offr', 'OFF', function (s) { return onOff(s).off; }, sgn1, '', '…and with them off court'),
      c('diff', 'ON−OFF', function (s) { var o = onOff(s); return o.on !== null && o.off !== null ? o.on - o.off : null; }, sgn1, 'b')];
    // Per game
    return [gp, gs, avgc('pts', 'PTS', function (l) { return l.pts; }, 'b'), avgc('reb', 'REB', reb),
      avgc('oreb', 'OR', function (l) { return l.oreb; }), avgc('dreb', 'DR', function (l) { return l.dreb; }),
      avgc('ast', 'AST', function (l) { return l.ast; }), avgc('stl', 'STL', function (l) { return l.stl; }), avgc('blk', 'BLK', function (l) { return l.blk; }),
      avgc('to', 'TO', function (l) { return l.to; }), avgc('pf', 'PF', function (l) { return l.pf; }),
      pct('fgp', 'FG%', 'fgm', 'fga', ctx.on.fg), pct('tpp', '3P%', 'tpm', 'tpa', ctx.on.tp), pct('ftp', 'FT%', 'ftm', 'fta', ctx.on.ft),
      c('chg', 'CHG', function (s) { return s.line.chg || 0; }),
      c('pm', '+/−', function (s) { return s.pmGp ? s.pm / s.pmGp : null; }, sgn1)];
  }

  function playersSheet(S, ctx, view) {
    view = VIEWS[view] ? view : 'pergame';
    var cols = playerCols(view, ctx), rows = rosterRows(S, ctx), sort = ctx.sort || {};
    var sc = null;
    cols.forEach(function (c) { if (c.k === sort.k) sc = c; });
    if (sc) rows.sort(function (a, b) {
      var x = a.s.gp ? sc.v(a.s) : null, y = b.s.gp ? sc.v(b.s) : null;
      if (x === null && y === null) return 0; if (x === null) return 1; if (y === null) return -1;
      return sort.dir === 'asc' ? x - y : y - x;
    });
    var h = ['<table class="sx-t sx-players"><thead><tr><th class="l">Player</th>'];
    cols.forEach(function (c) {
      var on = sc === c;
      h.push('<th' + (c.cls ? ' class="' + c.cls + '"' : '') + (c.title ? ' title="' + esc(c.title) + '"' : '') + '>' +
        (ctx.link ? '<button data-a="statSort" data-x="' + c.k + '">' + c.lab + (on ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '') + '</button>' : c.lab) + '</th>');
    });
    h.push('</tr></thead><tbody>');
    rows.forEach(function (r) {
      h.push('<tr' + link(ctx, '#player/' + r.p.id) + (r.s.gp ? '' : ' class="dim"') + '><td class="l nm">' + pTag(ctx, r.p) + '</td>');
      cols.forEach(function (c) {
        var v = r.s.gp ? c.v(r.s) : null;
        h.push('<td' + (c.cls ? ' class="' + c.cls + '"' : '') + '>' + (r.s.gp || c.k === 'gp' ? (c.show && r.s.gp ? c.show(r.s) : c.fmt(c.k === 'gp' ? r.s.gp : v)) : '—') + '</td>');
      });
      h.push('</tr>');
    });
    // Team row: the same columns over the team's line.
    var T = S.team, tl = { gp: T.n, gs: T.n * 5, line: T.us, team: T.us, pm: T.pf - T.pa, pmGp: T.n, games: [], dd: '', periods: 0,
      onPoss: 0, tPoss: 0 };
    h.push('<tr class="tot"><td class="l">Team</td>');
    cols.forEach(function (c) {
      var skip = { gs: 1, gmsc: 1, share: 1, usg: 1, dd: 1, qp: 1, onr: 1, offr: 1, diff: 1 }[c.k];
      h.push('<td>' + (skip || !T.n ? '' : c.show ? c.show(tl) : c.fmt(c.v(tl))) + '</td>');
    });
    h.push('</tr></tbody></table>');
    var notes = {
      pergame: 'Averages per game played. +/− is per game, from games that recorded substitutions.',
      totals: 'Season totals. TF = technical fouls (included in PF). CHG = charges taken.',
      shooting: 'eFG% counts 3s as 1.5 makes. TS% adds free throws (0.44 × FTA). PTS/FGA = points per field goal attempt (free throws left out). 3PA% = share of shots that are 3s. FTr = free throw attempts per field goal attempt.',
      advanced: 'GmSc = game score per game (points, shooting, rebounds, assists, steals, blocks, fouls and turnovers in one number; 10 is a solid game). %PTS = share of team points in games played. USG% = share of team possessions they used. QTRS = periods played per game. ON / OFF = team net points per 100 possessions with them on / off the court (shown from 10 possessions; possessions are estimated). DD = double-doubles.'
    };
    h.push('<p class="sx-foot">' + notes[view] + '</p>');
    return sheet(ctx, 'Players · ' + VIEWS[view], '<b>' + T.n + '</b> game' + (T.n === 1 ? '' : 's'), h.join(''), 'wide');
  }

  // ---------- Leaders ----------
  function leaderCats(ctx) {
    function avg(fn) { return function (s) { return s.gp ? fn(s.line) / s.gp : null; }; }
    function pq(m, a, on, min) {
      return function (s) { var att = typeof a === 'function' ? a(s.line) : s.line[a]; return on && att >= Math.max(min || 5, s.gp) ? (typeof m === 'function' ? m(s.line) : s.line[m]) / att : null; };
    }
    return [
      { lab: 'Points', unit: 'per game', v: avg(function (l) { return l.pts; }), fmt: f1 },
      { lab: 'Rebounds', unit: 'per game', v: avg(reb), fmt: f1 },
      { lab: 'Assists', unit: 'per game', v: avg(function (l) { return l.ast; }), fmt: f1 },
      { lab: 'Steals', unit: 'per game', v: avg(function (l) { return l.stl; }), fmt: f1 },
      { lab: 'Blocks', unit: 'per game', v: avg(function (l) { return l.blk; }), fmt: f1 },
      { lab: 'Offensive rebounds', unit: 'per game', v: avg(function (l) { return l.oreb; }), fmt: f1 },
      { lab: 'Field goal %', unit: '5+ attempts', v: pq('fgm', 'fga', ctx.on.fg), fmt: pc },
      { lab: '3-point %', unit: '5+ attempts', v: pq('tpm', 'tpa', ctx.on.tp), fmt: pc },
      { lab: 'Free throw %', unit: '5+ attempts', v: pq('ftm', 'fta', ctx.on.ft), fmt: pc },
      { lab: 'True shooting %', unit: '10+ shots', v: function (s) { return ctx.on.fg && ctx.on.ft && s.line.fga >= 10 ? ts(s.line) : null; }, fmt: pc },
      { lab: '3-pointers made', unit: 'total', v: function (s) { return s.line.tpm; }, fmt: String },
      { lab: 'Free throws made', unit: 'total', v: function (s) { return s.line.ftm; }, fmt: String },
      { lab: 'Game score', unit: 'per game', v: function (s) { return s.gp ? s.games.reduce(function (a, g) { return a + g.gmsc; }, 0) / s.gp : null; }, fmt: f1 },
      { lab: 'Assist-to-turnover', unit: '5+ assists', v: function (s) { return s.line.ast >= 5 ? ratio(s.line.ast, s.line.to || 1) : null; }, fmt: function (x) { return x.toFixed(2); } },
      { lab: 'Steals + blocks', unit: 'per game', v: avg(function (l) { return l.stl + l.blk; }), fmt: f1 },
      { lab: 'Charges taken', unit: 'total', v: function (s) { return s.line.chg || 0; }, fmt: String },
      { lab: 'Plus/minus', unit: 'total', v: function (s) { return s.pmGp ? s.pm : null; }, fmt: sgn, any: true },
      { lab: 'Double-doubles', unit: 'total', v: function (s) { return s.dd; }, fmt: String }
    ];
  }
  function ranked(S, ctx, cat) {
    var rows = [];
    rosterRows(S, ctx).forEach(function (r) {
      if (!r.s.gp) return;
      var v = cat.v(r.s);
      if (v !== null && v !== undefined && !isNaN(v) && (cat.any || v > 0)) rows.push({ p: r.p, s: r.s, v: v });
    });
    return rows.sort(function (a, b) { return b.v - a.v; });
  }
  function leadersSheet(S, ctx) {
    if (!S.team.n) return sheet(ctx, 'Leaders', '', '<p class="sx-none">No finished games yet.</p>');
    var h = ['<div class="sx-ldrs">'];
    leaderCats(ctx).forEach(function (cat) {
      var rows = ranked(S, ctx, cat).slice(0, 5);
      h.push('<div class="sx-ldr"><h3>' + cat.lab + ' <small>' + cat.unit + '</small></h3>' + (rows.length ? '<ol>' + rows.map(function (x) {
        return '<li' + link(ctx, '#player/' + x.p.id) + '>' + pTag(ctx, x.p) + '<b>' + cat.fmt(x.v) + '</b></li>';
      }).join('') + '</ol>' : '<p class="sx-none">—</p>') + '</div>');
    });
    h.push('</div>');
    h.push(h2('Single-game highs'));
    var cats = [['Points', function (l) { return l.pts; }], ['Rebounds', reb], ['Assists', function (l) { return l.ast; }],
      ['Steals', function (l) { return l.stl; }], ['Blocks', function (l) { return l.blk; }], ['3-pointers', function (l) { return l.tpm; }],
      ['Free throws made', function (l) { return l.ftm; }], ['Charges', function (l) { return l.chg || 0; }], ['Game score', gmsc]];
    h.push('<table class="sx-t"><thead><tr><th class="l">Category</th><th>High</th><th class="l">Player</th><th class="l">Game</th></tr></thead><tbody>');
    cats.forEach(function (cat) {
      var best = null;
      rosterRows(S, ctx).forEach(function (r) {
        r.s.games.forEach(function (g) { var v = cat[1](g.line); if (v > 0 && (!best || v > best.v)) best = { v: v, p: r.p, g: g }; });
      });
      h.push('<tr' + (best ? link(ctx, '#report/' + best.g.d.g.id) : '') + '><td class="l">' + cat[0] + '</td><td class="b">' + (best ? (cat[0] === 'Game score' ? f1(best.v) : best.v) : '—') +
        '</td><td class="l nm">' + (best ? pTag(ctx, best.p) : '') + '</td><td class="l dim">' + (best ? esc(vs(best.g.d.g)) + ', ' + shortDate(best.g.d.g.date) : '') + '</td></tr>');
    });
    h.push('</tbody></table>');
    h.push('<p class="sx-foot">Top 5 in each category. Percentages need at least one attempt per game played (and 5 in all). Game score sums up a stat line in one number; 10 is a solid game.</p>');
    return sheet(ctx, 'Leaders', '<b>' + S.team.n + '</b> games', h.join(''));
  }

  // ---------- Lineups ----------
  function unitCell(ctx, ids) {
    ids = ids.slice().sort(function (x, y) { var p = ctx.find(x) || {}, q = ctx.find(y) || {}, n = parseInt(p.num, 10), m = parseInt(q.num, 10); return (isNaN(n) ? 999 : n) - (isNaN(m) ? 999 : m); });
    return '<span class="sx-unit">' + ids.map(function (id) { var p = ctx.find(id) || { num: '?' }; return '<span title="' + esc(ctx.name(p)) + '">' + esc(ctx.jersey(p)) + '</span>'; }).join('') + '</span>' +
      '<small class="sx-unames">' + ids.map(function (id) { return esc(ctx.name(ctx.find(id) || {})); }).join(', ') + '</small>';
  }
  function unitRows(ctx, units, min) {
    return units.map(function (u) {
      var thin = u.poss < min, net = ratio(u.pf - u.pa, u.poss);
      return '<tr' + (thin ? ' class="dim"' : '') + '><td class="l">' + unitCell(ctx, u.ids) + '</td><td>' + u.gp + '</td><td>' + Math.round(u.poss) +
        '</td><td>' + u.pf + '</td><td>' + u.pa + '</td><td class="b ' + (u.pf >= u.pa ? 'pos' : 'neg') + '">' + sgn(u.pf - u.pa) + '</td><td>' +
        f1(ratio(u.pf, u.poss) * 100) + '</td><td>' + (thin ? '—' : sgn1(net * 100)) + '</td></tr>';
    }).join('');
  }
  function unitHead() {
    return '<thead><tr><th class="l">Lineup</th><th>GP</th><th title="Our possessions, estimated">POSS</th><th>PF</th><th>PA</th><th>+/−</th>' +
      '<th title="Points scored per 100 possessions">OFF</th><th title="Net points per 100 possessions">NET</th></tr></thead>';
  }
  function lineupsSheet(S, ctx) {
    var tracked = S.details.filter(function (d) { return d.tracked; }).length;
    if (!tracked) return sheet(ctx, 'Lineups', '', '<p class="sx-none">Lineups come from substitutions, so they show for games that recorded subs.</p>');
    var units = S.units.slice().sort(function (a, b) { return b.poss - a.poss; }), h = [];
    var best = units.filter(function (u) { return u.poss >= 10; }).sort(function (a, b) { return (b.pf - b.pa) / b.poss - (a.pf - a.pa) / a.poss; });
    if (best.length) {
      h.push(kpis([
        [sgn1((best[0].pf - best[0].pa) / best[0].poss * 100), 'Best unit, net / 100', 'pos'],
        [String(units.length), 'Five-player units used'], [Math.round(units[0].poss) + '', 'Most-used unit, possessions']
      ]));
    }
    h.push(h2('Five-player units', 'most used first'));
    h.push('<table class="sx-t">' + unitHead() + '<tbody>' + unitRows(ctx, units.slice(0, 20), 10) + '</tbody></table>');
    if (S.starts.length) {
      h.push(h2('Starting lineups'));
      h.push('<table class="sx-t"><thead><tr><th class="l">Starters</th><th>GS</th><th>W–L</th><th>PF</th><th>PA</th><th>Margin / game</th></tr></thead><tbody>' +
        S.starts.sort(function (a, b) { return (b.rec.w + b.rec.l) - (a.rec.w + a.rec.l); }).map(function (st) {
          var gs = st.rec.w + st.rec.l + st.rec.t;
          return '<tr><td class="l">' + unitCell(ctx, st.ids) + '</td><td>' + gs + '</td><td>' + rec(st.rec) + '</td><td>' + st.pf + '</td><td>' + st.pa +
            '</td><td class="b ' + (st.pf >= st.pa ? 'pos' : 'neg') + '">' + sgn1((st.pf - st.pa) / gs) + '</td></tr>';
        }).join('') + '</tbody></table>');
    }
    h.push('<p class="sx-foot">From ' + tracked + ' game' + (tracked === 1 ? '' : 's') + ' with substitutions recorded. POSS = our possessions with that five on court (estimated); OFF = points scored per 100 of them; NET = points scored minus allowed per 100. Units under 10 possessions are greyed out: too few to judge.</p>');
    return sheet(ctx, 'Lineups', '<b>' + tracked + '</b> games', h.join(''), 'wide');
  }

  // ---------- Game log ----------
  function gamesSheet(S, ctx) {
    if (!S.team.n) return sheet(ctx, 'Game log', '', '<p class="sx-none">No finished games yet.</p>');
    var h = ['<table class="sx-t"><thead><tr><th class="l">Date</th><th class="l">Opponent</th><th class="l">Result</th><th>FG</th><th>FG%</th><th>3P</th><th>FT</th>' +
      '<th>REB</th><th>OR</th><th>AST</th><th>STL</th><th>BLK</th><th>TO</th><th>PF</th><th>POSS</th><th title="Lead changes">LC</th><th class="l">Top scorer</th></tr></thead><tbody>'];
    S.details.slice().reverse().forEach(function (d) {
      var l = d.c.team.us, top = null;
      Object.keys(d.c.players).forEach(function (id) { var x = d.c.players[id]; if (!top || x.pts > top.pts) top = { id: id, pts: x.pts }; });
      var tp = top && top.pts ? ctx.find(top.id) : null;
      h.push('<tr' + link(ctx, '#report/' + d.g.id) + '><td class="l">' + shortDate(d.g.date) + '</td><td class="l nm">' + esc(vs(d.g)) + (d.g.type === 'scrimmage' ? ' <small>(S)</small>' : '') +
        '</td><td class="l b ' + (d.margin >= 0 ? 'pos' : 'neg') + '">' + result(d) + (d.ot ? ' OT' : '') + '</td><td>' + ma(l.fgm, l.fga) + '</td><td>' + pcIf(ctx.on.fg, l.fgm, l.fga) +
        '</td><td>' + ma(l.tpm, l.tpa) + '</td><td>' + ma(l.ftm, l.fta) + '</td><td>' + reb(l) + '</td><td>' + l.oreb + '</td><td>' + l.ast + '</td><td>' + l.stl +
        '</td><td>' + l.blk + '</td><td>' + l.to + '</td><td>' + l.pf + '</td><td>' + Math.round(d.poss) + '</td><td>' + d.flow.leadChanges + '</td><td class="l nm">' +
        (tp ? pTag(ctx, tp) + ' <b>' + top.pts + '</b>' : '—') + '</td></tr>');
    });
    var T = S.team, u = T.us, n = T.n;
    h.push('<tr class="tot"><td class="l" colspan="3">Per game · ' + rec(T.rec) + '</td><td>' + per(u.fgm, n) + '-' + per(u.fga, n) + '</td><td>' + pcIf(ctx.on.fg, u.fgm, u.fga) +
      '</td><td>' + per(u.tpm, n) + '-' + per(u.tpa, n) + '</td><td>' + per(u.ftm, n) + '-' + per(u.fta, n) + '</td><td>' + per(reb(u), n) + '</td><td>' + per(u.oreb, n) +
      '</td><td>' + per(u.ast, n) + '</td><td>' + per(u.stl, n) + '</td><td>' + per(u.blk, n) + '</td><td>' + per(u.to, n) + '</td><td>' + per(u.pf, n) +
      '</td><td>' + per(T.poss, n) + '</td><td>' + per(T.lc, n) + '</td><td></td></tr></tbody></table>');
    h.push('<p class="sx-foot">POSS = our possessions (estimated). LC = lead changes.' + (ctx.link ? ' Tap a game to open its report.' : '') + '</p>');
    return sheet(ctx, 'Game log', '<b>' + n + '</b> games', h.join(''), 'wide');
  }

  // ---------- One player ----------
  function rankOf(S, ctx, id, fn, lowBetter) {
    var rows = rosterRows(S, ctx).filter(function (r) { return r.s.gp; }).map(function (r) { return { id: r.p.id, v: fn(r.s) }; })
      .filter(function (x) { return x.v !== null && x.v !== undefined && !isNaN(x.v); });
    var me = null; rows.forEach(function (x) { if (x.id === id) me = x; });
    if (!me) return '';
    var better = rows.filter(function (x) { return lowBetter ? x.v < me.v : x.v > me.v; }).length + 1;
    var sfx = better % 10 === 1 && better !== 11 ? 'st' : better % 10 === 2 && better !== 12 ? 'nd' : better % 10 === 3 && better !== 13 ? 'rd' : 'th';
    return better + sfx + ' on team';
  }
  function splitRow(ctx, lab, list) {
    var l = blank(), pm = 0, pmn = 0;
    list.forEach(function (g) { l = C.addLines(l, g.line); if (g.pm !== undefined) { pm += g.pm; pmn++; } });
    var n = list.length;
    if (!n && lab !== 'Season') return '';
    return '<tr><td class="l">' + lab + '</td><td>' + n + '</td><td class="b">' + per(l.pts, n) + '</td><td>' + per(reb(l), n) + '</td><td>' + per(l.ast, n) +
      '</td><td>' + per(l.stl, n) + '</td><td>' + per(l.to, n) + '</td><td>' + (n ? pcIf(ctx.on.fg, l.fgm, l.fga) : '—') + '</td><td>' + (n ? pcIf(ctx.on.tp, l.tpm, l.tpa) : '—') +
      '</td><td>' + (n ? pcIf(ctx.on.ft, l.ftm, l.fta) : '—') + '</td><td>' + (pmn ? sgn1(pm / pmn) : '—') + '</td></tr>';
  }
  function playerSheet(S, ctx, id) {
    var p = ctx.find(id) || { num: '?', first: 'Player' }, s = S.players[id], h = [];
    var head = '<div class="sx-hero"><div class="sx-cell"><span>' + esc(ctx.jersey(p)) + '</span><i></i></div><div class="who"><div class="sx-eye">' +
      esc(ctx.teamName) + ' · ' + esc(ctx.season) + ' · ' + esc(ctx.filter) + '</div><h1>' + esc(ctx.full(p)) + '</h1>';
    if (!s || !s.gp) {
      return '<section class="sx player">' + head + '<p class="sub">No finished games' + (ctx.filter !== 'All games' ? ' match this filter' : '') + ' yet.</p></div></div></section>';
    }
    var l = s.line, gp = s.gp, oo = onOff(s);
    head += '<p class="sub">' + gp + ' game' + (gp === 1 ? '' : 's') + ' · ' + s.gs + ' start' + (s.gs === 1 ? '' : 's') + ' · played ' + s.periods + ' of ' + s.periodsAvail +
      ' periods</p></div><div class="line"><div><b>' + per(l.pts, gp) + '</b><span>PPG</span></div><div><b>' + per(reb(l), gp) + '</b><span>RPG</span></div><div><b>' +
      per(l.ast, gp) + '</b><span>APG</span></div></div></div>';
    h.push(head);
    function rk(fn, low) { return rankOf(S, ctx, id, fn, low); }
    function avgOf(fn) { return function (x) { return x.gp ? fn(x.line) / x.gp : null; }; }
    h.push(kpis([
      [per(l.pts, gp), 'Points', '', rk(avgOf(function (x) { return x.pts; }))],
      [per(reb(l), gp), 'Rebounds', '', rk(avgOf(reb))],
      [per(l.ast, gp), 'Assists', '', rk(avgOf(function (x) { return x.ast; }))],
      [per(l.stl, gp), 'Steals', '', rk(avgOf(function (x) { return x.stl; }))],
      [per(l.blk, gp), 'Blocks', '', rk(avgOf(function (x) { return x.blk; }))],
      [per(l.to, gp), 'Turnovers', '', ''],
      [s.pmGp ? sgn(s.pm) : '—', 'Plus/minus', s.pm >= 0 ? 'pos' : 'neg', s.pmGp ? rk(function (x) { return x.pmGp ? x.pm : null; }) : ''],
      [f1(s.games.reduce(function (a, g) { return a + g.gmsc; }, 0) / gp), 'Game score', '', rk(function (x) { return x.gp ? x.games.reduce(function (a, g) { return a + g.gmsc; }, 0) / x.gp : null; })]
    ]));

    h.push('<div class="sx-cols"><div>' + h2('Shooting') + shotBars(ctx, l) + dl([
      ['Effective FG%', efgIf(ctx, l), '3s count 1.5×'], ['True shooting %', tsIf(ctx, l), 'includes free throws'],
      ['Points per shot', l.fga ? (ratio(2 * (l.fgm - l.tpm) + 3 * l.tpm, l.fga)).toFixed(2) : '—', 'per field goal attempt'],
      ['3-point attempt rate', pcs(ratio(l.tpa, l.fga)), 'share of shots that are 3s'],
      ['Free throw attempts / game', per(l.fta, gp)]
    ]) + h2('Where the points come from') + mix(l) + '</div>');
    h.push('<div>' + h2('Impact') + dl([
      ['Share of team points', pcs(ratio(l.pts, s.team.pts)), 'in games played'],
      ['Usage', pcs(usage(s)), 'team possessions used'],
      ['Assist-to-turnover', f1(ratio(l.ast, l.to))],
      ['Steals + blocks / game', per(l.stl + l.blk, gp)],
      ['Offensive / defensive rebounds', per(l.oreb, gp) + ' / ' + per(l.dreb, gp), 'per game'],
      ['Charges taken', String(l.chg || 0)], ['Fouls / game', per(l.pf, gp) + (l.tf ? ' <small>' + l.tf + ' tech</small>' : '')],
      ['Double-doubles', String(s.dd)],
      ['Plus/minus / game', s.pmGp ? sgn1(s.pm / s.pmGp) : '—'],
      ['Team net / 100, on court', sgn1(oo.on), 'possessions estimated'], ['Team net / 100, off court', sgn1(oo.off)]
    ]) + '</div></div>');

    // Points by game (bars) and by period.
    var maxp = 1, avgp = l.pts / gp;
    s.games.forEach(function (g) { maxp = Math.max(maxp, g.line.pts); });
    h.push(h2('Points by game', 'line = season average'));
    h.push('<div class="sx-spark"><em class="avg" style="bottom:calc((100% - 1.2rem) * ' + (avgp / maxp).toFixed(3) + ')"></em>' + s.games.map(function (g) {
      return '<div' + link(ctx, '#report/' + g.d.g.id) + '><i style="height:' + (g.line.pts / maxp * 100).toFixed(1) + '%"><b>' + g.line.pts + '</b></i><span>' +
        esc((g.d.g.opponent || '').slice(0, 9)) + '</span></div>';
    }).join('') + '</div>');
    var qs = '';
    for (var q = 0; q < s.byQ.length; q++) qs += '<div><b>' + per(s.byQ[q], s.byQn[q]) + '</b><span>' + ctx.periodLabel(q + 1) + '</span></div>';
    h.push('<div class="sx-cols"><div>' + h2('Points by ' + (s.byQ.length === 2 ? 'half' : 'quarter'), 'average') + '<div class="sx-perq">' + qs + '</div>');
    h.push(h2('Season highs') + dl([['Points', 'pts'], ['Rebounds', 'reb'], ['Assists', 'ast'], ['Steals', 'stl'], ['Blocks', 'blk'], ['3-pointers', 'tpm'], ['Game score', 'gmsc']].map(function (c) {
      var b = null;
      s.games.forEach(function (g) { var v = c[1] === 'reb' ? reb(g.line) : c[1] === 'gmsc' ? g.gmsc : g.line[c[1]]; if (v > 0 && (!b || v > b.v)) b = { v: v, g: g }; });
      return [c[0], b ? (c[1] === 'gmsc' ? f1(b.v) : b.v) + ' <small>' + esc(vs(b.g.d.g)) + ', ' + shortDate(b.g.d.g.date) + '</small>' : '—'];
    })) + '</div>');
    var home = s.games.filter(function (g) { return g.d.g.homeAway !== 'away'; }), away = s.games.filter(function (g) { return g.d.g.homeAway === 'away'; });
    h.push('<div>' + h2('Splits', 'per game') + '<table class="sx-t sx-split"><thead><tr><th class="l"></th><th>GP</th><th>PTS</th><th>REB</th><th>AST</th><th>STL</th><th>TO</th>' +
      '<th>FG%</th><th>3P%</th><th>FT%</th><th>+/−</th></tr></thead><tbody>' +
      splitRow(ctx, 'Season', s.games) + splitRow(ctx, 'Home', home) + splitRow(ctx, 'Away', away) +
      splitRow(ctx, 'Wins', s.games.filter(function (g) { return g.d.margin > 0; })) + splitRow(ctx, 'Losses', s.games.filter(function (g) { return g.d.margin < 0; })) +
      splitRow(ctx, 'Started', s.games.filter(function (g) { return g.started; })) + splitRow(ctx, 'Off the bench', s.games.filter(function (g) { return !g.started; })) +
      splitRow(ctx, 'Last 3 games', s.games.slice(-3)) + '</tbody></table>');
    var mine = S.units.filter(function (u) { return u.ids.indexOf(id) >= 0 && u.poss >= 5; })
      .sort(function (a, b) { return (b.pf - b.pa) - (a.pf - a.pa); }).slice(0, 3);
    if (mine.length) h.push(h2('Best lineups with ' + esc(ctx.name(p))) + '<table class="sx-t">' + unitHead() + '<tbody>' + unitRows(ctx, mine, 10) + '</tbody></table>');
    h.push('</div></div>');

    h.push(h2('Game log'));
    h.push('<table class="sx-t"><thead><tr><th class="l">Date</th><th class="l">Opponent</th><th class="l">Result</th><th class="b">PTS</th><th>FG</th><th>3P</th><th>FT</th>' +
      '<th>OR</th><th>DR</th><th>REB</th><th>AST</th><th>STL</th><th>BLK</th><th>TO</th><th>PF</th><th>CHG</th><th>+/−</th><th>GmSc</th></tr></thead><tbody>');
    s.games.slice().reverse().forEach(function (g) {
      var x = g.line;
      h.push('<tr' + link(ctx, '#report/' + g.d.g.id) + '><td class="l">' + shortDate(g.d.g.date) + '</td><td class="l nm">' + esc(vs(g.d.g)) + (g.started ? '' : ' <small>bench</small>') +
        '</td><td class="l ' + (g.d.margin >= 0 ? 'pos' : 'neg') + '">' + result(g.d) + '</td><td class="b">' + x.pts + '</td><td>' + ma(x.fgm, x.fga) + '</td><td>' + ma(x.tpm, x.tpa) +
        '</td><td>' + ma(x.ftm, x.fta) + '</td><td>' + x.oreb + '</td><td>' + x.dreb + '</td><td>' + reb(x) + '</td><td>' + x.ast + '</td><td>' + x.stl + '</td><td>' + x.blk +
        '</td><td>' + x.to + '</td><td>' + x.pf + '</td><td>' + (x.chg || 0) + '</td><td>' + sgn(g.pm) + '</td><td>' + f1(g.gmsc) + '</td></tr>');
    });
    h.push('<tr class="tot"><td class="l" colspan="3">Totals</td><td class="b">' + l.pts + '</td><td>' + ma(l.fgm, l.fga) + '</td><td>' + ma(l.tpm, l.tpa) + '</td><td>' + ma(l.ftm, l.fta) +
      '</td><td>' + l.oreb + '</td><td>' + l.dreb + '</td><td>' + reb(l) + '</td><td>' + l.ast + '</td><td>' + l.stl + '</td><td>' + l.blk + '</td><td>' + l.to + '</td><td>' + l.pf +
      '</td><td>' + (l.chg || 0) + '</td><td>' + (s.pmGp ? sgn(s.pm) : '—') + '</td><td></td></tr></tbody></table>');
    h.push('<p class="sx-foot">Game score sums up a stat line in one number (10 is a solid game). Usage = share of team possessions used by shots, free throws and turnovers. On/off court = team points scored minus allowed per 100 possessions (estimated from our plays). Plus/minus counts games that recorded substitutions.</p>');
    return '<section class="sx player">' + h.join('') + '</section>';
  }

  root.SBStats = {
    VIEWS: VIEWS, team: teamSheet, players: playersSheet, leaders: leadersSheet, lineups: lineupsSheet, games: gamesSheet, player: playerSheet
  };
})(this);
