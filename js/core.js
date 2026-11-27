/*
 * Scorebook core: rules, event model and derived stats.
 * Pure functions only (no DOM, no storage) so it runs in the browser and in Node tests.
 * Written in ES5 for the Fire HD 8's Android 5.1 WebView.
 *
 * Event shape: { s: seq, q: period (1-based, 5+ = OT), tm: 'us'|'them',
 *                p: playerId (us) or jersey string (them, '' = unknown),
 *                t: type, v: value }
 * Types: 'make' (v 1|2|3), 'miss' (v 1|2|3), 'reb' (v 'o'|'d'), 'ast', 'stl',
 *        'blk', 'to', 'chg' (charge taken), 'foul' (v 'p'|'t'), 'timeout' (v 'full'|'short'),
 *        Technicals off the court carry w: 'hc' head coach, 'ac' assistant, 'team' (p ''), or
 *        'bench' for a bench player (p = the player; counts against the head coach too).
 *        'sub' (v 'in'|'out'; only in games with subLog: true, which start from game.starters),
 *        'award' (v 1|2: points for being fouled on a shot under the scrimmage rule; counts as
 *        points, line.awd, but not as a shot or a free throw).
 */
(function (root) {
  'use strict';

  var DEFAULT_RULES = {
    name: 'NFHS (Ivy Prep)',
    periods: 4,
    periodMinutes: 8,
    foulOut: 5,            // 0 = players never foul out
    techOut: 2,            // technical fouls that eject a player (NFHS); 0 = no limit
    coachTechDirect: 2,    // head coach ejected at this many direct technicals; 0 = never
    coachTechTotal: 3,     // …or this many in all (direct + assistant + bench players); 0 = never
    benchTechTeamFoul: true, // coach, assistant and team technicals count as team fouls
    bonusAt: 5,            // team foul number that starts free throws; 0 = no bonus
    doubleBonusAt: 0,      // team foul number for the double bonus (2 shots); 0 = none
    bonusReset: 'quarter', // team fouls reset: 'quarter' (each period) | 'half' | 'game' (never)
    otFoulsCarry: true,    // last period's team fouls carry into OT (NFHS)
    timeoutsFull: 3,
    timeoutsShort: 2,
    timeoutsReset: 'game', // timeout allotment is per 'game' or per 'half'
    otMinutes: 4,
    otTimeoutsFull: 1,
    otTimeoutsShort: 0,
    // Mostly for scrimmages:
    timeoutsUnlimited: false,
    scoreResets: false,    // each period is scored on its own (the total is still kept)
    openEnded: false,      // more periods can be added at any time; no overtime
    shotFoulAward: false   // shooting foul = points + 1 free throw: after a +1, ask if it was a free throw
  };

  function copyRules(r) {
    var out = {}, k;
    for (k in DEFAULT_RULES) out[k] = DEFAULT_RULES[k];
    if (r) for (k in r) if (r.hasOwnProperty(k)) out[k] = r[k];
    return out;
  }

  // Starting point for a scrimmage: keeps the period length, drops the limits.
  function scrimmageRules(base) {
    var r = copyRules(base);
    r.name = 'Scrimmage';
    r.periods = 6; r.foulOut = 0; r.techOut = 0; r.bonusAt = 0; r.doubleBonusAt = 0;
    r.coachTechDirect = 0; r.coachTechTotal = 0;
    r.timeoutsUnlimited = true; r.scoreResets = true; r.openEnded = true; r.shotFoulAward = true;
    return r;
  }

  // Q1–Q4… for quarters (and scrimmages that keep adding them), H1–H2 for halves;
  // OT, OT2… after regulation.
  function periodLabel(q, rules) {
    rules = rules || DEFAULT_RULES;
    var n = rules.periods;
    if (q <= n || rules.openEnded) return (n === 2 && q <= 2 ? 'H' : 'Q') + q;
    return q - n === 1 ? 'OT' : 'OT' + (q - n);
  }

  // Points events: shots made and shooting-foul awards.
  function points(e) { return e.t === 'make' || e.t === 'award' ? e.v : 0; }

  // Which foul "bucket" a period belongs to for bonus counting.
  function foulBucket(q, rules) {
    if (q > rules.periods && !rules.openEnded) return rules.otFoulsCarry ? foulBucket(rules.periods, rules) : 'p' + q;
    if (rules.bonusReset === 'game') return 'g';
    if (rules.bonusReset === 'half') return q <= rules.periods / 2 ? 'h1' : 'h2';
    return 'p' + q;
  }

  function emptyLine() {
    return { pts: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0,
             oreb: 0, dreb: 0, ast: 0, stl: 0, blk: 0, to: 0, pf: 0, tf: 0, chg: 0, awd: 0 };
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
      case 'chg': line.chg++; break;
      case 'award': line.pts += e.v; line.awd += e.v; break;
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
      // Technicals off the court: head coach (direct), assistants, bench players, team.
      staff: { us: { hc: 0, ac: 0, bench: 0, team: 0 }, them: { hc: 0, ac: 0, bench: 0, team: 0 } },
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
      if (e.t === 'sub') continue;
      if (e.t === 'foul' && e.w && e.w !== 'bench') {
        // Coach, assistant or team technical: no player gets it.
        r.staff[e.tm][e.w]++;
        if (rules.benchTechTeamFoul) {
          var sb = foulBucket(e.q, rules);
          r.fouls[e.tm][sb] = (r.fouls[e.tm][sb] || 0) + 1;
        }
        continue;
      }
      if (e.t === 'foul' && e.w === 'bench') r.staff[e.tm].bench++;
      if (e.tm === 'us') {
        line = r.players[e.p] || (r.players[e.p] = emptyLine());
      } else {
        var key = e.p || '';
        line = r.opp[key] || (r.opp[key] = emptyLine());
      }
      applyToLine(line, e);
      applyToLine(r.team[e.tm], e);
      if (points(e)) {
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
    // With timeouts per half, only the current half's timeouts count, and OT adds to the second half's.
    var ots = rules.openEnded ? 0 : Math.max(0, r.periods - rules.periods, cur - rules.periods);
    var byHalf = rules.timeoutsReset === 'half' && rules.periods >= 2, mid = Math.floor(rules.periods / 2);
    var from = byHalf && cur > mid ? mid + 1 : 1, to = byHalf && cur <= mid ? mid : Infinity;
    r.timeoutsAllot = {
      full: rules.timeoutsFull + (to === Infinity ? ots * rules.otTimeoutsFull : 0),
      short: rules.timeoutsShort + (to === Infinity ? ots * rules.otTimeoutsShort : 0)
    };
    r.timeoutsLeft = {};
    ['us', 'them'].forEach(function (tm) {
      var used = { full: 0, short: 0 };
      r.timeoutLog.forEach(function (t) { if (t.tm === tm && t.q >= from && t.q <= to) used[t.v === 'short' ? 'short' : 'full']++; });
      r.timeoutsLeft[tm] = rules.timeoutsUnlimited ? { full: Infinity, short: Infinity } : {
        full: Math.max(0, r.timeoutsAllot.full - used.full),
        short: Math.max(0, r.timeoutsAllot.short - used.short)
      };
    });

    // Current team fouls and bonus state for the current period.
    var bucket = foulBucket(cur, rules);
    r.currentFouls = { us: r.fouls.us[bucket] || 0, them: r.fouls.them[bucket] || 0 };
    // shooting.us = we shoot free throws on the next common foul by them.
    var bon = rules.bonusAt > 0;
    r.shooting = {
      us: bon && r.currentFouls.them + 1 >= rules.bonusAt,
      them: bon && r.currentFouls.us + 1 >= rules.bonusAt
    };
    // inBonus.us = the opponent has reached the bonus foul, so every further foul by them is shot.
    r.inBonus = {
      us: bon && r.currentFouls.them >= rules.bonusAt,
      them: bon && r.currentFouls.us >= rules.bonusAt
    };
    var dbl = rules.doubleBonusAt;
    r.inDoubleBonus = {
      us: dbl > 0 && r.currentFouls.them >= dbl,
      them: dbl > 0 && r.currentFouls.us >= dbl
    };
    // Periods won, for games where each period is scored on its own. A period counts once it's
    // over: every one before the current period, and the current one too when the game is final.
    var done = game.status === 'final' ? r.periods : cur - 1;
    r.periodsWon = { us: 0, them: 0, tied: 0 };
    for (i = 0; i < done; i++) {
      var a = r.byPeriod.us[i], b2 = r.byPeriod.them[i];
      r.periodsWon[a > b2 ? 'us' : a < b2 ? 'them' : 'tied']++;
    }
    r.pm = plusMinus(game);
    return r;
  }

  // Replays substitutions from the starters, calling each(event, onCourt) after every event.
  function replayLineup(game, each) {
    var on = (game.starters || []).slice();
    (game.events || []).forEach(function (e) {
      if (e.t === 'sub') {
        var i = on.indexOf(e.p);
        if (e.v === 'out' && i >= 0) on.splice(i, 1);
        else if (e.v === 'in' && i < 0) on.push(e.p);
      }
      if (each) each(e, on);
    });
    return on;
  }

  function lineupAfter(game) { return replayLineup(game); }

  // Plus/minus: our points minus theirs while each player was on court.
  // Needs a game that logged its subs (subLog); null otherwise. Players who never played are absent.
  function plusMinus(game) {
    if (!game.subLog) return null;
    var pm = {};
    (game.starters || []).forEach(function (id) { pm[id] = 0; });
    replayLineup(game, function (e, on) {
      if (e.t === 'sub' && e.v === 'in' && pm[e.p] === undefined) pm[e.p] = 0;
      if (points(e)) on.forEach(function (id) { pm[id] = (pm[id] || 0) + (e.tm === 'us' ? e.v : -e.v); });
    });
    return pm;
  }

  function fmtPm(n) { return n === undefined || n === null ? '—' : (n > 0 ? '+' + n : String(n)); }

  // tf = technical fouls (already included in pf). 'warn' = one foul, or one technical, from leaving.
  function foulState(pf, rules, tf) {
    rules = rules || DEFAULT_RULES;
    var why = outReason({ pf: pf, tf: tf || 0 }, rules);
    if (why) return 'out';
    var lim = rules.foulOut > 0;
    if ((lim && pf === rules.foulOut - 1) || (rules.techOut > 1 && tf === rules.techOut - 1)) return 'warn';
    return lim && pf >= rules.foulOut - 2 ? 'caution' : 'ok';
  }

  // Why a player can no longer play: 'ejected' (technicals), 'fouled' (foul total) or ''.
  function outReason(line, rules) {
    rules = rules || DEFAULT_RULES;
    if (rules.techOut > 0 && (line.tf || 0) >= rules.techOut) return 'ejected';
    return rules.foulOut > 0 && line.pf >= rules.foulOut ? 'fouled' : '';
  }

  // Head coach's technicals: direct (their own) and in all (plus assistants' and bench players').
  // out: 'direct' | 'total' | '' (ejected or not); next: one more technical would eject them
  // ('any' = any bench technical, 'direct' = only another of their own).
  function coachStatus(staff, rules) {
    rules = rules || DEFAULT_RULES;
    var direct = staff.hc, total = staff.hc + staff.ac + staff.bench, dOut = rules.coachTechDirect, tOut = rules.coachTechTotal;
    var out = dOut > 0 && direct >= dOut ? 'direct' : tOut > 0 && total >= tOut ? 'total' : '';
    var next = out ? '' : tOut > 0 && total === tOut - 1 ? 'any' : dOut > 0 && direct === dOut - 1 ? 'direct' : '';
    return { direct: direct, indirect: total - direct, total: total, out: out, next: next };
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
      if (!points(e)) continue;
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
   * Merging two tablets' copies of the scorebook record (roster, schedule, seasons, opponents, settings).
   * Lists are merged item by item, so a tablet with an older copy can't wipe out what another added;
   * deletions travel as tombstones (meta.gone: { id: time }). Single values (team, settings, current
   * season) come from the newer copy. A restored backup (higher meta.gen) replaces everything, and a
   * brand-new tablet's blank record (meta.fresh) always gives way to the cloud's.
   * Returns { meta, local: differs from local, remote: differs from remote }.
   */
  var META_LISTS = ['seasons', 'players', 'opponents', 'schedule'];
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function itemKey(list, x) { return list === 'opponents' ? 'n:' + String(x.name || '').toLowerCase() : 'i:' + x.id; }
  // JSON with sorted keys and no undefined values, so equal records compare equal whatever the key order.
  function stable(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
    return '{' + Object.keys(v).sort().filter(function (k) { return v[k] !== undefined; })
      .map(function (k) { return JSON.stringify(k) + ':' + stable(v[k]); }).join(',') + '}';
  }
  function canonMeta(m) {
    var c = {};
    Object.keys(m || {}).forEach(function (k) {
      if (k === 'updated' || k === 'fresh' || m[k] === undefined) return;
      if (k === 'gone' && !Object.keys(m.gone || {}).length) return;
      c[k] = META_LISTS.indexOf(k) >= 0 ? (m[k] || []).map(stable).sort() : m[k];
    });
    return stable(c);
  }
  function mergeMeta(local, remote) {
    if (!remote) return { meta: local, local: false, remote: true };
    if (!local || local.fresh) return { meta: remote, local: true, remote: false };
    var lg = local.gen || 0, rg = remote.gen || 0;
    if (lg !== rg) { var w = lg > rg ? local : remote; return { meta: w, local: w !== local, remote: w !== remote }; }
    var newer = (remote.updated || 0) > (local.updated || 0) ? remote : local, older = newer === local ? remote : local;
    var out = clone(newer), gone = {}, k, top = Math.max(local.updated || 0, remote.updated || 0);
    [older.gone, newer.gone].forEach(function (g) { for (k in g || {}) if (!gone[k] || g[k] > gone[k]) gone[k] = g[k]; });
    for (k in gone) if (gone[k] < top - 180 * 864e5) delete gone[k];   // forget deletions after six months
    out.gone = gone;
    META_LISTS.forEach(function (name) {
      var list = (out[name] || []).slice(), seen = {};
      list.forEach(function (x) { seen[itemKey(name, x)] = true; });
      (older[name] || []).forEach(function (x) {
        var key = itemKey(name, x);
        if (!seen[key]) { seen[key] = true; list.push(clone(x)); }
      });
      list = list.filter(function (x) { return !(x && x.id && gone[x.id]); });
      if (name === 'schedule') {
        // The same game added on two tablets: keep one (the one that's been played, if either).
        var byGame = {};
        list.forEach(function (x) {
          var gk = x.seasonId + '|' + x.date + '|' + String(x.opponent || '').toLowerCase(), have = byGame[gk];
          if (!have || (!have.gameId && x.gameId)) byGame[gk] = x;
        });
        list = list.filter(function (x) { return byGame[x.seasonId + '|' + x.date + '|' + String(x.opponent || '').toLowerCase()] === x; });
      }
      out[name] = list;
    });
    if (!out.seasons.some(function (s) { return s.id === out.currentSeasonId; }) && out.seasons.length) out.currentSeasonId = out.seasons[0].id;
    out.updated = top;
    var c = canonMeta(out);
    return { meta: out, local: c !== canonMeta(local), remote: c !== canonMeta(remote) };
  }

  /*
   * Season totals per player across finished games, plus each player's game-by-game lines.
   * games: [{ events, rules, quarter, roster? }]; players: [{id}]
   * Per player: gp, line (totals), pm (plus/minus total), pmGp (games where it was tracked),
   * games: [{ id, date, opponent, homeAway, us, them, line, pm }] in the order given.
   */
  function computeSeason(games, players) {
    var out = {}, team = { gp: 0, w: 0, l: 0, pf: 0, pa: 0 };
    function blank() { return { gp: 0, line: emptyLine(), pm: 0, pmGp: 0, games: [] }; }
    players.forEach(function (p) { out[p.id] = blank(); });
    games.forEach(function (g) {
      var c = computeGame(g);
      team.gp++;
      team.pf += c.score.us; team.pa += c.score.them;
      if (c.score.us > c.score.them) team.w++; else if (c.score.us < c.score.them) team.l++;
      var played = {};
      (g.appeared || []).forEach(function (id) { played[id] = true; });
      for (var id in c.players) if (c.players.hasOwnProperty(id)) played[id] = true;
      for (id in played) {
        if (!out[id]) out[id] = blank();
        var o = out[id], line = c.players[id] || emptyLine(), pm = c.pm ? c.pm[id] : undefined;
        o.gp++;
        addLines(o.line, line);
        if (pm !== undefined) { o.pm += pm; o.pmGp++; }
        o.games.push({ id: g.id, date: g.date, opponent: g.opponent, homeAway: g.homeAway,
          us: c.score.us, them: c.score.them, line: line, pm: pm });
      }
    });
    return { players: out, team: team };
  }

  var SB = {
    DEFAULT_RULES: DEFAULT_RULES,
    copyRules: copyRules,
    scrimmageRules: scrimmageRules,
    points: points,
    periodLabel: periodLabel,
    foulBucket: foulBucket,
    emptyLine: emptyLine,
    computeGame: computeGame,
    computeSeason: computeSeason,
    mergeMeta: mergeMeta,
    gameFlow: gameFlow,
    foulState: foulState,
    outReason: outReason,
    coachStatus: coachStatus,
    lineupAfter: lineupAfter,
    plusMinus: plusMinus,
    replayLineup: replayLineup,
    applyToLine: applyToLine,
    addLines: addLines,
    fmtPm: fmtPm,
    pct: pct,
    fmtPct: fmtPct,
    pctShown: pctShown,
    showPct: showPct
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = SB;
  else root.SBCore = SB;
})(this);
