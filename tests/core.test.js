// Run with: node tests/core.test.js
var assert = require('assert');
var SB = require('../js/core.js');

var seq = 0;
function ev(q, tm, p, t, v) { return { s: ++seq, q: q, tm: tm, p: p, t: t, v: v }; }
function game(events, quarter, rules) { return { events: events, quarter: quarter || 1, rules: rules }; }

var tests = [];
function test(name, fn) { tests.push([name, fn]); }

test('scores and shooting lines', function () {
  var c = SB.computeGame(game([
    ev(1, 'us', 'a', 'make', 2), ev(1, 'us', 'a', 'make', 3), ev(1, 'us', 'a', 'miss', 3),
    ev(1, 'us', 'a', 'make', 1), ev(1, 'us', 'a', 'miss', 1), ev(2, 'them', '12', 'make', 2)
  ], 2));
  assert.strictEqual(c.score.us, 6);
  assert.strictEqual(c.score.them, 2);
  var a = c.players.a;
  assert.deepStrictEqual([a.fgm, a.fga, a.tpm, a.tpa, a.ftm, a.fta], [2, 3, 1, 2, 1, 2]);
  assert.deepStrictEqual(c.byPeriod.us, [6, 0, 0, 0]);
  assert.deepStrictEqual(c.byPeriod.them, [0, 2, 0, 0]);
  assert.strictEqual(c.opp['12'].pts, 2);
});

test('technical fouls: warning at 1, ejection at 2', function () {
  var c = SB.computeGame(game([ev(1, 'us', 'a', 'foul', 't')]));
  assert.strictEqual(SB.foulState(c.players.a.pf, c.rules, c.players.a.tf), 'warn');
  assert.strictEqual(SB.outReason(c.players.a, c.rules), '');
  c = SB.computeGame(game([ev(1, 'us', 'a', 'foul', 't'), ev(2, 'us', 'a', 'foul', 't')]));
  assert.strictEqual(SB.foulState(c.players.a.pf, c.rules, c.players.a.tf), 'out');
  assert.strictEqual(SB.outReason(c.players.a, c.rules), 'ejected');
  // Personal fouls alone still foul out at 5; techs count toward that total.
  assert.strictEqual(SB.outReason({ pf: 5, tf: 1 }, c.rules), 'fouled');
  // Rules from before techOut existed get the default; 0 turns the limit off.
  assert.strictEqual(SB.copyRules({ foulOut: 5 }).techOut, 2);
  assert.strictEqual(SB.outReason({ pf: 3, tf: 3 }, SB.copyRules({ techOut: 0 })), '');
});

test('charges taken', function () {
  var c = SB.computeGame(game([ev(1, 'us', 'a', 'chg'), ev(2, 'us', 'a', 'chg'), ev(2, 'us', 'b', 'chg')]));
  assert.strictEqual(c.players.a.chg, 2);
  assert.strictEqual(c.team.us.chg, 3);
  assert.strictEqual(c.players.a.pf, 0);
});

test('percentages can be switched off', function () {
  assert.deepStrictEqual(SB.pctShown({}), { fg: true, tp: true, ft: true });
  assert.deepStrictEqual(SB.pctShown({ pct: { two: false } }), { fg: false, tp: true, ft: true });
  assert.deepStrictEqual(SB.pctShown({ pct: { three: false, ft: false } }), { fg: false, tp: false, ft: false });
  assert.strictEqual(SB.showPct(false, 4, 4), 'N/A');
  assert.strictEqual(SB.showPct(true, 4, 4), '100');
  assert.strictEqual(SB.showPct(true, 0, 0), '—');
});

test('player foul states', function () {
  assert.strictEqual(SB.foulState(2), 'ok');
  assert.strictEqual(SB.foulState(3), 'caution');
  assert.strictEqual(SB.foulState(4), 'warn');
  assert.strictEqual(SB.foulState(5), 'out');
});

test('bonus: 5th team foul in a quarter sends opponent to the line', function () {
  var evs = [];
  for (var i = 0; i < 3; i++) evs.push(ev(1, 'us', 'a', 'foul', 'p'));
  var c = SB.computeGame(game(evs, 1));
  assert.strictEqual(c.currentFouls.us, 3);
  assert.strictEqual(c.shooting.them, false);
  evs.push(ev(1, 'us', 'b', 'foul', 'p'));
  c = SB.computeGame(game(evs, 1));
  assert.strictEqual(c.shooting.them, true, 'after 4 fouls the next one is the 5th = shooting');
});

test('team fouls reset each quarter', function () {
  var evs = [];
  for (var i = 0; i < 6; i++) evs.push(ev(1, 'them', '3', 'foul', 'p'));
  var c = SB.computeGame(game(evs, 2));
  assert.strictEqual(c.currentFouls.them, 0);
  assert.strictEqual(c.shooting.us, false);
  assert.strictEqual(c.opp['3'].pf, 6);
});

test('4th quarter fouls carry into OT', function () {
  var evs = [];
  for (var i = 0; i < 4; i++) evs.push(ev(4, 'us', 'a', 'foul', 'p'));
  evs.push(ev(5, 'us', 'b', 'foul', 'p'));
  var c = SB.computeGame(game(evs, 5));
  assert.strictEqual(c.currentFouls.us, 5);
  assert.strictEqual(c.shooting.them, true);
  var c2 = SB.computeGame(game(evs, 5, { otFoulsCarry: false }));
  assert.strictEqual(c2.currentFouls.us, 1);
});

test('timeouts remaining with OT allotment', function () {
  var evs = [ev(1, 'us', '', 'timeout', 'full'), ev(2, 'us', '', 'timeout', 'short'),
             ev(3, 'them', '', 'timeout', 'full')];
  var c = SB.computeGame(game(evs, 3));
  assert.deepStrictEqual(c.timeoutsLeft.us, { full: 2, short: 1 });
  assert.deepStrictEqual(c.timeoutsLeft.them, { full: 2, short: 2 });
  c = SB.computeGame(game(evs, 5));
  assert.deepStrictEqual(c.timeoutsLeft.us, { full: 3, short: 1 }, 'OT adds one full');
  c = SB.computeGame(game(evs, 6));
  assert.deepStrictEqual(c.timeoutsLeft.us, { full: 4, short: 1 }, 'second OT adds another');
});

test('timeouts never go negative', function () {
  var evs = [];
  for (var i = 0; i < 5; i++) evs.push(ev(1, 'us', '', 'timeout', 'full'));
  assert.strictEqual(SB.computeGame(game(evs, 1)).timeoutsLeft.us.full, 0);
});

test('period labels', function () {
  assert.strictEqual(SB.periodLabel(1), 'Q1');
  assert.strictEqual(SB.periodLabel(5), 'OT');
  assert.strictEqual(SB.periodLabel(6), 'OT2');
});

test('game flow: runs, lead changes through ties', function () {
  var f = SB.gameFlow([
    ev(1, 'us', 'a', 'make', 2),   // 2-0 us lead
    ev(1, 'them', '', 'make', 2),  // 2-2 tie
    ev(1, 'them', '', 'make', 3),  // 2-5 them lead -> change
    ev(1, 'us', 'a', 'make', 3),   // 5-5 tie
    ev(1, 'us', 'a', 'make', 2)    // 7-5 us -> change
  ]);
  assert.strictEqual(f.leadChanges, 2);
  assert.strictEqual(f.ties, 2);
  assert.strictEqual(f.bestRun.them, 5);
  assert.strictEqual(f.bestRun.us, 5);
  assert.strictEqual(f.biggestLead.them, 3);
});

test('season totals and record', function () {
  var g1 = game([ev(1, 'us', 'a', 'make', 2), ev(1, 'them', '', 'make', 3)], 4);
  var g2 = game([ev(1, 'us', 'a', 'make', 3)], 4);
  g2.appeared = ['b'];
  var s = SB.computeSeason([g1, g2], [{ id: 'a' }, { id: 'b' }]);
  assert.strictEqual(s.players.a.gp, 2);
  assert.strictEqual(s.players.a.line.pts, 5);
  assert.strictEqual(s.players.b.gp, 1);
  assert.deepStrictEqual([s.team.w, s.team.l], [1, 1]);
});

var failed = 0;
tests.forEach(function (t) {
  try { t[1](); console.log('ok   ' + t[0]); }
  catch (err) { failed++; console.log('FAIL ' + t[0] + '\n     ' + err.message); }
});
console.log('\n' + (tests.length - failed) + '/' + tests.length + ' passed');
process.exit(failed ? 1 : 0);
