/*
 * Sample data for practicing: a demo roster, one finished game and one game in progress.
 * Plays are generated with a seeded random number generator, so the same games appear every time.
 * Everything created here is tagged sample: true so it can be removed in one step. ES5.
 */
(function (root) {
  'use strict';
  var C = root.SBCore;

  var ROSTER = [
    ['3', 'Maya', 'Kessler'], ['5', 'Jordan', 'Ellis'], ['11', 'Ava', 'Thompson'], ['14', 'Noor', 'Haddad'],
    ['22', 'Sam', 'Rivera'], ['24', 'Priya', 'Natarajan'], ['30', 'Lena', 'Okafor'], ['33', 'Chloe', 'Brandt'],
    ['40', 'Iris', 'Morales'], ['42', 'Tess', 'Lindqvist']
  ];

  function rng(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function pick(r, list) { return list[Math.floor(r() * list.length)]; }

  function dateOffset(days) {
    var d = new Date(); d.setDate(d.getDate() + days);
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  }

  /*
   * Simulates possessions into game.events.
   * plan: [{ q, poss, lineup: [ids] }] — how many possessions each side gets in each period.
   */
  function simulate(game, plan, oppNums, r) {
    var ev = game.events;
    function add(tm, p, t, v, q) { game.seq++; ev.push({ s: game.seq, q: q, tm: tm, p: p, t: t, v: v }); }
    function fouls(id) {
      var n = 0;
      for (var i = 0; i < ev.length; i++) if (ev[i].tm === 'us' && ev[i].p === id && ev[i].t === 'foul') n++;
      return n;
    }

    plan.forEach(function (step) {
      var q = step.q, on = step.lineup;
      for (var i = 0; i < on.length; i++) if (game.appeared.indexOf(on[i]) < 0) game.appeared.push(on[i]);
      game.onCourt = on.slice();
      for (var n = 0; n < step.poss; n++) {
        // Our possession
        var shooter = pick(r, on), x = r();
        if (x < 0.12) add('us', shooter, 'to', undefined, q);
        else if (x < 0.22) {
          var fouler = pick(r, oppNums);
          add('them', fouler, 'foul', 'p', q);
          for (var f = 0; f < 2; f++) add('us', shooter, r() < 0.68 ? 'make' : 'miss', 1, q);
        } else {
          var three = r() < 0.3, made = r() < (three ? 0.34 : 0.48), v = three ? 3 : 2;
          add('us', shooter, made ? 'make' : 'miss', v, q);
          if (made && r() < 0.55) add('us', pick(r, on.filter(function (id) { return id !== shooter; })), 'ast', undefined, q);
          if (!made && r() < 0.3) add('us', pick(r, on), 'reb', 'o', q);
        }
        // Their possession
        var y = r();
        if (y < 0.1) add('us', pick(r, on), 'stl', undefined, q);
        else if (y < 0.26) {
          var candidates = on.filter(function (id) { return fouls(id) < 3; });
          add('us', pick(r, candidates.length ? candidates : on), 'foul', 'p', q);
          var ft = pick(r, oppNums);
          for (var k = 0; k < 2; k++) if (r() < 0.64) add('them', ft, 'make', 1, q);
        } else {
          var t3 = r() < 0.28, mk = r() < (t3 ? 0.31 : 0.45);
          if (mk) add('them', pick(r, oppNums), 'make', t3 ? 3 : 2, q);
          else if (r() < 0.06) add('us', pick(r, on), 'blk', undefined, q);
          else if (r() < 0.72) add('us', pick(r, on), 'reb', 'd', q);
        }
      }
    });
  }

  function baseGame(id, seasonId, rules, roster, opts) {
    return {
      id: id, seasonId: seasonId, opponent: opts.opponent, date: opts.date, location: opts.location,
      homeAway: opts.homeAway, rules: C.copyRules(rules), quarter: 1, status: 'live', events: [], seq: 0,
      onCourt: [], appeared: [], starters: roster.slice(0, 5), roster: [], oppNums: opts.oppNums.slice(),
      created: Date.now(), publishedUrl: '', publishId: '', sample: true
    };
  }

  // Returns { players: [new players], games: [two games] }. Uses the current roster if there is one.
  function build(meta, uid) {
    var seasonId = meta.currentSeasonId, rules = meta.settings.rules, added = [];
    var players = meta.players.filter(function (p) { return p.seasonId === seasonId; });
    if (players.length < 8) {
      ROSTER.forEach(function (r) {
        if (players.some(function (p) { return p.num === r[0]; })) return;
        var p = { id: uid(), seasonId: seasonId, num: r[0], first: r[1], last: r[2], sample: true };
        added.push(p); players.push(p);
      });
    }
    players.sort(function (a, b) { return parseInt(a.num, 10) - parseInt(b.num, 10); });
    var ids = players.map(function (p) { return p.id; });
    var snap = players.map(function (p) { return { id: p.id, num: p.num, first: p.first, last: p.last }; });
    var starters = ids.slice(0, 5), bench = ids.slice(5);
    function rotate(outA, outB, inA, inB) {
      var l = starters.slice();
      if (bench[inA]) l[outA] = bench[inA];
      if (bench[inB]) l[outB] = bench[inB];
      return l;
    }

    // Finished game, a few days ago.
    var g1 = baseGame(uid(), seasonId, rules, ids, {
      opponent: 'Riverdale', date: dateOffset(-4), location: 'Dalton Main Gym', homeAway: 'home',
      oppNums: ['2', '4', '10', '12', '15', '21', '23']
    });
    g1.roster = snap;
    simulate(g1, [
      { q: 1, poss: 13, lineup: starters },
      { q: 2, poss: 6, lineup: rotate(3, 4, 0, 1) }, { q: 2, poss: 7, lineup: starters },
      { q: 3, poss: 13, lineup: starters },
      { q: 4, poss: 6, lineup: rotate(1, 2, 2, 0) }, { q: 4, poss: 8, lineup: starters }
    ], g1.oppNums, rng(20261120));
    g1.events.push({ s: ++g1.seq, q: 2, tm: 'us', p: '', t: 'timeout', v: 'full' });
    g1.events.push({ s: ++g1.seq, q: 3, tm: 'them', p: '', t: 'timeout', v: 'full' });
    g1.events.push({ s: ++g1.seq, q: 4, tm: 'us', p: '', t: 'timeout', v: 'short' });
    g1.events.sort(function (a, b) { return a.q - b.q || a.s - b.s; });
    g1.quarter = 4; g1.status = 'final'; g1.ended = Date.now();

    // Game in progress: early Q3, with fouls piling up so the warning states are visible.
    var g2 = baseGame(uid(), seasonId, rules, ids, {
      opponent: 'Trinity', date: dateOffset(0), location: 'Trinity Upper Gym', homeAway: 'away',
      oppNums: ['1', '3', '7', '13', '20', '32']
    });
    g2.roster = snap;
    simulate(g2, [
      { q: 1, poss: 13, lineup: starters },
      { q: 2, poss: 7, lineup: rotate(2, 4, 1, 2) }, { q: 2, poss: 6, lineup: starters },
      { q: 3, poss: 4, lineup: starters }
    ], g2.oppNums, rng(20261124));
    function add2(tm, p, t, v) { g2.events.push({ s: ++g2.seq, q: 3, tm: tm, p: p, t: t, v: v }); }
    add2('us', '', 'timeout', 'full');
    add2('them', '', 'timeout', 'full');
    // Put the second starter on 4 fouls (one from fouling out) and our team on 3+ fouls this quarter.
    var count = 0, edge = starters[1];
    g2.events.forEach(function (e) { if (e.tm === 'us' && e.t === 'foul' && e.p === edge) count++; });
    while (count < 4) { add2('us', edge, 'foul', 'p'); count++; }
    var q3 = C.computeGame({ events: g2.events, quarter: 3, rules: g2.rules }).currentFouls.us;
    for (var i = q3; i < 3; i++) add2('us', starters[3], 'foul', 'p');
    add2('them', '7', 'foul', 'p'); add2('them', '13', 'foul', 'p');
    g2.quarter = 3;
    g2.onCourt = starters.slice();

    return { players: added, games: [g1, g2] };
  }

  root.SBSample = { build: build };
})(this);
