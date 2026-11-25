/*
 * Scorebook core: rules, event model and derived stats.
 * Pure functions only (no DOM, no storage) so it runs in the browser and in Node tests.
 * Written in ES5 for the Fire HD 8's Android 5.1 WebView.
 *
 * Event shape: { s: seq, q: period (1-based, 5+ = OT), tm: 'us'|'them',
 *                p: playerId (us) or jersey string (them, '' = unknown),
 *                t: type, v: value }
 * Types: 'make' (v 1|2|3), 'miss' (v 1|2|3), 'reb' (v 'o'|'d'), 'ast', 'stl',
 *        'blk', 'to', 'foul' (v 'p'|'t'), 'timeout' (v 'full'|'short').
 */
(function (root) {
  'use strict';

  var DEFAULT_RULES = {
    name: 'NFHS (Ivy Prep)',
    periods: 4,
    periodMinutes: 8,
    foulOut: 5,
    bonusAt: 5,            // team foul number that starts free throws
    bonusReset: 'quarter', // 'quarter' | 'half'
    otFoulsCarry: true,    // 4th-quarter team fouls carry into OT (NFHS)
    timeoutsFull: 3,
    timeoutsShort: 2,
    otMinutes: 4,
    otTimeoutsFull: 1,
    otTimeoutsShort: 0
  };

  function copyRules(r) {
    var out = {}, k;
    for (k in DEFAULT_RULES) out[k] = DEFAULT_RULES[k];
    if (r) for (k in r) if (r.hasOwnProperty(k)) out[k] = r[k];
    return out;
  }

  function periodLabel(q, rules) {
    var n = (rules || DEFAULT_RULES).periods;
    if (q <= n) return 'Q' + q;
    return q - n === 1 ? 'OT' : 'OT' + (q - n);
  }

  // Which foul "bucket" a period belongs to for bonus counting.
  function foulBucket(q, rules) {
    if (q > rules.periods) return rules.otFoulsCarry ? 'p' + rules.periods : 'p' + q;
    if (rules.bonusReset === 'half') return q <= rules.periods / 2 ? 'h1' : 'h2';
    return 'p' + q;
  }

  function emptyLine() {
    return { pts: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0,
             oreb: 0, dreb: 0, ast: 0, stl: 0, blk: 0, to: 0, pf: 0, tf: 0 };
  }

  function addShot(line, made, v) {
    if (v === 1) { line.fta++; if (made) { line.ftm++; line.pts += 1; } }
    else {
      line.fga++;
      if (v === 3) line.tpa++;
      if (made) { line.fgm++; line.pts += v; if (v === 3) line.tpm++; }
    }
  }

  function applyToLine(line, e) {
    switch (e.t) {
      case 'make': addShot(line, true, e.v); break;
      case 'miss': addShot(line, false, e.v); break;
      case 'reb': if (e.v === 'o') line.oreb++; else line.dreb++; break;
      case 'ast': line.ast++; break;
      case 'stl': line.stl++; break;
      case 'blk': line.blk++; break;
      case 'to': line.to++; break;
      case 'foul': line.pf++; if (e.v === 't') line.tf++; break;
    }
  }

  function addLines(a, b) {
    for (var k in b) if (b.hasOwnProperty(k)) a[k] = (a[k] || 0) + b[k];
    return a;
  }

  /*
   * Everything the live screen and the report need, derived from the event list.
   * game: { rules, quarter, events }
   */
  function computeGame(game) {
    var rules = copyRules(game.rules);
    var events = game.events || [];
    var cur = game.quarter || 1;
    var nPeriods = Math.max(cur, rules.periods);
    var r = {
      rules: rules,
      quarter: cur,
      periods: nPeriods,
      score: { us: 0, them: 0 },
      byPeriod: { us: [], them: [] },
      players: {},          // playerId -> line
      opp: {},              // jersey -> line
      team: { us: emptyLine(), them: emptyLine() },
      fouls: { us: {}, them: {} },   // bucket -> count
      timeoutsUsed: { us: { full: 0, short: 0 }, them: { full: 0, short: 0 } },
      timeoutLog: [],
      runs: null
    };
    var i, e, line;
    for (i = 0; i < nPeriods; i++) { r.byPeriod.us.push(0); r.byPeriod.them.push(0); }

    for (i = 0; i < events.length; i++) {
      e = events[i];
      while (r.byPeriod.us.length < e.q) { r.byPeriod.us.push(0); r.byPeriod.them.push(0); }
      if (e.t === 'timeout') {
        r.timeoutsUsed[e.tm][e.v === 'short' ? 'short' : 'full']++;
        r.timeoutLog.push({ tm: e.tm, q: e.q, v: e.v });
        continue;
      }
      if (e.tm === 'us') {
        line = r.players[e.p] || (r.players[e.p] = emptyLine());
      } else {
        var key = e.p || '';
        line = r.opp[key] || (r.opp[key] = emptyLine());
      }
      applyToLine(line, e);
      applyToLine(r.team[e.tm], e);
      if (e.t === 'make') {
        r.score[e.tm] += e.v;
        r.byPeriod[e.tm][e.q - 1] += e.v;
      }
      if (e.t === 'foul') {
        var b = foulBucket(e.q, rules);
        r.fouls[e.tm][b] = (r.fouls[e.tm][b] || 0) + 1;
      }
    }
    r.periods = r.byPeriod.us.length;

    // Timeouts available = regulation + per-OT allotment for OT periods reached.
    var ots = Math.max(0, r.periods - rules.periods, cur - rules.periods);
    r.timeoutsLeft = {};
    ['us', 'them'].forEach(function (tm) {
      r.timeoutsLeft[tm] = {
        full: Math.max(0, rules.timeoutsFull + ots * rules.otTimeoutsFull - r.timeoutsUsed[tm].full),
        short: Math.max(0, rules.timeoutsShort + ots * rules.otTimeoutsShort - r.timeoutsUsed[tm].short)
      };
    });

    // Current team fouls and bonus state for the current period.
    var bucket = foulBucket(cur, rules);
    r.currentFouls = { us: r.fouls.us[bucket] || 0, them: r.fouls.them[bucket] || 0 };
    // shooting.us = we shoot free throws on the next common foul by them.
    r.shooting = {
      us: r.currentFouls.them + 1 >= rules.bonusAt,
      them: r.currentFouls.us + 1 >= rules.bonusAt
    };
    return r;
  }

  function foulState(pf, rules) {
    rules = rules || DEFAULT_RULES;
    if (pf >= rules.foulOut) return 'out';
    if (pf === rules.foulOut - 1) return 'warn';
    return pf >= rules.foulOut - 2 ? 'caution' : 'ok';
  }

  function pct(m, a) { return a ? Math.round((m / a) * 1000) / 10 : null; }

  function fmtPct(m, a) {
    var p = pct(m, a);
    return p === null ? '—' : (p === 100 ? '100' : p.toFixed(1));
  }

  // Which shooting percentages to show, from settings.pct { two, three, ft } (all on by default).
  // FG% counts 2s and 3s together, so it needs both switched on.
  function pctShown(settings) {
    var s = (settings && settings.pct) || {};
    var three = s.three !== false;
    return { fg: s.two !== false && three, tp: three, ft: s.ft !== false };
  }

  function showPct(on, m, a) { return on ? fmtPct(m, a) : 'N/A'; }

  // Longest unanswered scoring run for each team, plus lead changes and ties.
  // A lead change is counted whenever the leader differs from the last team that led,
  // even if the game was tied in between.
  function gameFlow(events) {
    var us = 0, them = 0, lastLeader = 0, wasTied = false, changes = 0, ties = 0;
    var runTm = null, runPts = 0, best = { us: 0, them: 0 }, biggest = { us: 0, them: 0 };
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      if (e.t !== 'make') continue;
      if (e.tm === 'us') us += e.v; else them += e.v;
      if (runTm === e.tm) runPts += e.v; else { runTm = e.tm; runPts = e.v; }
      if (runPts > best[e.tm]) best[e.tm] = runPts;
      var d = us - them;
      if (d > biggest.us) biggest.us = d;
      if (-d > biggest.them) biggest.them = -d;
      var leader = d > 0 ? 1 : (d < 0 ? -1 : 0);
      if (leader === 0) {
        if (!wasTied) ties++;
        wasTied = true;
      } else {
        if (lastLeader !== 0 && leader !== lastLeader) changes++;
        lastLeader = leader;
        wasTied = false;
      }
    }
    return { bestRun: best, biggestLead: biggest, leadChanges: changes, ties: ties };
  }

  /*
   * Season totals per player across finished games.
   * games: [{ events, rules, quarter, roster? }]; players: [{id}]
   */
  function computeSeason(games, players) {
    var out = {}, team = { gp: 0, w: 0, l: 0, pf: 0, pa: 0 };
    players.forEach(function (p) { out[p.id] = { gp: 0, line: emptyLine() }; });
    games.forEach(function (g) {
      var c = computeGame(g);
      team.gp++;
      team.pf += c.score.us; team.pa += c.score.them;
      if (c.score.us > c.score.them) team.w++; else if (c.score.us < c.score.them) team.l++;
      var played = {};
      (g.appeared || []).forEach(function (id) { played[id] = true; });
      for (var id in c.players) if (c.players.hasOwnProperty(id)) played[id] = true;
      for (id in played) {
        if (!out[id]) out[id] = { gp: 0, line: emptyLine() };
        out[id].gp++;
        if (c.players[id]) addLines(out[id].line, c.players[id]);
      }
    });
    return { players: out, team: team };
  }

  var SB = {
    DEFAULT_RULES: DEFAULT_RULES,
    copyRules: copyRules,
    periodLabel: periodLabel,
    foulBucket: foulBucket,
    emptyLine: emptyLine,
    computeGame: computeGame,
    computeSeason: computeSeason,
    gameFlow: gameFlow,
    foulState: foulState,
    pct: pct,
    fmtPct: fmtPct,
    pctShown: pctShown,
    showPct: showPct
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = SB;
  else root.SBCore = SB;
})(this);
