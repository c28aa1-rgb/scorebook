/*
 * Sample data for practicing: a demo roster, six finished games and one game in progress.
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

  // Per-player tendencies (by roster order) so sample stats look like a real team:
  // w = how often they shoot, two/three = make rates, tr = share of their shots that are 3s, rb = rebounding.
  var STYLE = [
    { w: 3.2, two: 0.5, three: 0.36, tr: 0.35, rb: 1 }, { w: 2.2, two: 0.44, three: 0.31, tr: 0.25, rb: 0.8 },
    { w: 2.6, two: 0.47, three: 0.38, tr: 0.45, rb: 0.9 }, { w: 1.4, two: 0.52, three: 0.2, tr: 0.05, rb: 2.4 },
    { w: 1.8, two: 0.55, three: 0.25, tr: 0.05, rb: 2.8 }, { w: 1.3, two: 0.42, three: 0.33, tr: 0.4, rb: 1 },
    { w: 1, two: 0.45, three: 0.3, tr: 0.2, rb: 1.6 }, { w: 0.9, two: 0.4, three: 0.35, tr: 0.5, rb: 0.7 },
    { w: 0.7, two: 0.46, three: 0.2, tr: 0.1, rb: 1.8 }, { w: 0.6, two: 0.38, three: 0.3, tr: 0.3, rb: 0.8 }
  ];
  function weighted(r, list, key, styles) {
    var tot = 0, i;
    for (i = 0; i < list.length; i++) tot += (styles[list[i]] || {})[key] || 1;
    var x = r() * tot;
    for (i = 0; i < list.length; i++) { x -= (styles[list[i]] || {})[key] || 1; if (x <= 0) return list[i]; }
    return list[list.length - 1];
  }

  function dateOffset(days) {
    var d = new Date(); d.setDate(d.getDate() + days);
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  }

  /*
   * Simulates possessions into game.events.
   * plan: [{ q, poss, lineup: [ids] }] — how many possessions each side gets in each period.
   */
  function simulate(game, plan, oppNums, r, styles, strength) {
    styles = styles || {}; strength = strength || 0;
    var ev = game.events;
    function add(tm, p, t, v, q) { game.seq++; ev.push({ s: game.seq, q: q, tm: tm, p: p, t: t, v: v }); }
    function fouls(id) {
      var n = 0;
      for (var i = 0; i < ev.length; i++) if (ev[i].tm === 'us' && ev[i].p === id && ev[i].t === 'foul') n++;
      return n;
    }

    plan.forEach(function (step) {
      var q = step.q, on = step.lineup;
      // Log substitutions so plus/minus works, as the live screen does.
      game.onCourt.forEach(function (id) { if (on.indexOf(id) < 0) add('us', id, 'sub', 'out', q); });
      on.forEach(function (id) { if (game.onCourt.indexOf(id) < 0) add('us', id, 'sub', 'in', q); });
      for (var i = 0; i < on.length; i++) if (game.appeared.indexOf(on[i]) < 0) game.appeared.push(on[i]);
      game.onCourt = on.slice();
      for (var n = 0; n < step.poss; n++) {
        // Our possession
        var shooter = weighted(r, on, 'w', styles), x = r(), st = styles[shooter] || { two: 0.48, three: 0.34, tr: 0.3 };
        if (x < 0.12) add('us', shooter, 'to', undefined, q);
        else if (x < 0.22) {
          var fouler = pick(r, oppNums);
          add('them', fouler, 'foul', 'p', q);
          for (var f = 0; f < 2; f++) add('us', shooter, r() < 0.68 ? 'make' : 'miss', 1, q);
        } else {
          var three = r() < st.tr, made = r() < (three ? st.three : st.two) + strength, v = three ? 3 : 2;
          add('us', shooter, made ? 'make' : 'miss', v, q);
          if (made && r() < 0.55) add('us', pick(r, on.filter(function (id) { return id !== shooter; })), 'ast', undefined, q);
          if (!made && r() < 0.3) add('us', weighted(r, on, 'rb', styles), 'reb', 'o', q);
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
          var t3 = r() < 0.28, mk = r() < (t3 ? 0.31 : 0.45) - strength;
          if (mk) add('them', pick(r, oppNums), 'make', t3 ? 3 : 2, q);
          else if (r() < 0.06) add('us', pick(r, on), 'blk', undefined, q);
          else if (r() < 0.72) add('us', weighted(r, on, 'rb', styles), 'reb', 'd', q);
        }
      }
    });
  }

  function baseGame(id, seasonId, rules, roster, opts) {
    return {
      id: id, seasonId: seasonId, opponent: opts.opponent, date: opts.date, location: opts.location,
      homeAway: opts.homeAway, rules: C.copyRules(rules), quarter: 1, status: 'live', events: [], seq: 0,
      onCourt: roster.slice(0, 5), appeared: roster.slice(0, 5), starters: roster.slice(0, 5), roster: [], oppNums: opts.oppNums.slice(),
      created: Date.now(), publishedUrl: '', publishId: '', sample: true, subLog: true
    };
  }

  // Returns { players: [new players], games: [two games], schedule: [entries] }. Uses the current roster if there is one.
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

    var styles = {};
    ids.forEach(function (id, i) { styles[id] = STYLE[i] || STYLE[STYLE.length - 1]; });

    // Finished games over the last month: different opponents, rotations and results.
    // [days ago, opponent, side, location, their numbers, seed, strength (+ helps us), rotation]
    var PAST = [
      [-32, 'Hackley', 'away', 'Hackley Gym', ['1', '4', '5', '11', '20', '24', '33'], 20261025, 0.04, [[3, 4, 0, 1], [0, 2, 2, 3]]],
      [-26, 'Poly Prep', 'home', 'Dalton Main Gym', ['3', '10', '12', '14', '22', '30'], 20261031, -0.06, [[1, 4, 0, 3], [2, 3, 1, 2]]],
      [-20, 'Collegiate', 'away', 'Collegiate Gym', ['2', '5', '13', '21', '23', '34'], 20261106, 0.02, [[3, 4, 1, 0], [0, 1, 2, 4]]],
      [-14, 'Horace Mann', 'home', 'Dalton Main Gym', ['0', '1', '10', '15', '25', '32'], 20261112, -0.01, [[2, 4, 0, 1], [1, 3, 3, 2]]],
      [-9, 'Fieldston', 'away', 'Fieldston Gym', ['3', '6', '11', '14', '20', '42'], 20261117, 0.08, [[3, 4, 0, 1], [0, 1, 4, 3]]],
      [-4, 'Riverdale', 'home', 'Dalton Main Gym', ['2', '4', '10', '12', '15', '21', '23'], 20261120, 0, [[3, 4, 0, 1], [1, 2, 2, 0]]]
    ];
    var finals = PAST.map(function (x) {
      var g = baseGame(uid(), seasonId, rules, ids, { opponent: x[1], date: dateOffset(x[0]), location: x[3], homeAway: x[2], oppNums: x[4] });
      var rot = x[7], r = rng(x[5]);
      g.roster = snap;
      simulate(g, [
        { q: 1, poss: 12 + Math.floor(r() * 3), lineup: starters },
        { q: 2, poss: 6, lineup: rotate(rot[0][0], rot[0][1], rot[0][2], rot[0][3]) }, { q: 2, poss: 7, lineup: starters },
        { q: 3, poss: 7, lineup: starters }, { q: 3, poss: 5, lineup: rotate(rot[1][0], rot[1][1], rot[1][2], rot[1][3]) },
        { q: 4, poss: 6, lineup: rotate(rot[0][0], rot[0][1], rot[0][2], rot[0][3]) }, { q: 4, poss: 8, lineup: starters }
      ], g.oppNums, r, styles, x[6]);
      g.events.push({ s: ++g.seq, q: 2, tm: 'us', p: '', t: 'timeout', v: 'full' });
      g.events.push({ s: ++g.seq, q: 3, tm: 'them', p: '', t: 'timeout', v: 'full' });
      g.events.push({ s: ++g.seq, q: 4, tm: 'us', p: '', t: 'timeout', v: 'short' });
      g.events.sort(function (a, b) { return a.q - b.q || a.s - b.s; });
      g.quarter = 4; g.status = 'final'; g.ended = Date.now() + x[0] * 864e5; g.created = Date.now() + x[0];
      return g;
    });

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
    ], g2.oppNums, rng(20261124), styles);
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

    // A schedule: the games above, plus a few still to come.
    function sched(days, opponent, homeAway, location, time, gameId) {
      return { id: uid(), seasonId: seasonId, date: dateOffset(days), time: time, opponent: opponent, homeAway: homeAway,
        location: location, gameId: gameId || null, sample: true };
    }
    var schedule = PAST.map(function (x, i) { return sched(x[0], x[1], x[2], x[3], '5:00 PM', finals[i].id); }).concat([
      sched(0, 'Trinity', 'away', 'Trinity Upper Gym', '4:30 PM', g2.id),
      sched(3, 'Poly Prep', 'home', 'Dalton Main Gym', '5:00 PM'),
      sched(7, 'Collegiate', 'away', 'Collegiate Gym', '4:15 PM'),
      sched(10, 'Trevor Day', 'home', 'Dalton Main Gym', '6:30 PM')
    ]);

    return { players: added, games: finals.concat([g2]), schedule: schedule };
  }

  root.SBSample = { build: build };
})(this);
