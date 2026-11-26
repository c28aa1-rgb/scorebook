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

test('plus/minus follows substitutions', function () {
  var g = game([
    ev(1, 'us', 'a', 'make', 2),          // a, b on: +2
    ev(1, 'them', '4', 'make', 3),        // a, b on: -3
    ev(1, 'us', 'b', 'sub', 'out'), ev(1, 'us', 'c', 'sub', 'in'),
    ev(2, 'us', 'c', 'make', 3),          // a, c on: +3
    ev(2, 'us', 'a', 'make', 1)           // a, c on: +1
  ], 2);
  g.starters = ['a', 'b'];
  assert.strictEqual(SB.plusMinus(g), null, 'no subLog, no plus/minus');
  g.subLog = true;
  assert.deepStrictEqual(SB.plusMinus(g), { a: 3, b: -1, c: 4 });
  assert.deepStrictEqual(SB.lineupAfter(g), ['a', 'c']);
  // Subs don't create box-score lines or change the score.
  var c = SB.computeGame(g);
  assert.strictEqual(c.score.us, 6);
  assert.deepStrictEqual(c.pm, { a: 3, b: -1, c: 4 });
  assert.strictEqual(SB.fmtPm(3) + SB.fmtPm(-1) + SB.fmtPm(0) + SB.fmtPm(undefined), '+3-10—');
});

test('season game logs and plus/minus totals', function () {
  var g1 = game([ev(1, 'us', 'a', 'make', 2), ev(1, 'them', '4', 'make', 2), ev(1, 'us', 'a', 'make', 3)], 4);
  g1.id = 'g1'; g1.starters = ['a']; g1.subLog = true; g1.appeared = ['a']; g1.opponent = 'X';
  var g2 = game([ev(1, 'us', 'a', 'make', 2)], 4);
  g2.id = 'g2'; g2.appeared = ['a'];    // older game, no sub log
  var s = SB.computeSeason([g1, g2], [{ id: 'a' }]).players.a;
  assert.strictEqual(s.gp, 2);
  assert.strictEqual(s.line.pts, 7);
  assert.strictEqual(s.pm, 3);
  assert.strictEqual(s.pmGp, 1);
  assert.deepStrictEqual(s.games.map(function (x) { return [x.id, x.line.pts, x.pm]; }), [['g1', 5, 3], ['g2', 2, undefined]]);
});

test('custom rules: halves, fouls that never reset, double bonus', function () {
  var halves = SB.copyRules({ periods: 2, bonusReset: 'half', bonusAt: 7, doubleBonusAt: 10 });
  assert.strictEqual(SB.periodLabel(2, halves) + SB.periodLabel(3, halves), 'H2OT');
  assert.strictEqual(SB.periodLabel(3, SB.copyRules({ periods: 3 })), 'Q3');
  var evs = [];
  for (var i = 0; i < 7; i++) evs.push(ev(2, 'us', 'a', 'foul', 'p'));
  var c = SB.computeGame(game(evs, 2, halves));
  assert.strictEqual(c.inBonus.them, true);
  assert.strictEqual(c.inDoubleBonus.them, false);
  for (i = 0; i < 3; i++) evs.push(ev(2, 'us', 'a', 'foul', 'p'));
  assert.strictEqual(SB.computeGame(game(evs, 2, halves)).inDoubleBonus.them, true);
  // OT carries the second half's fouls when fouls reset by half.
  assert.strictEqual(SB.computeGame(game(evs, 3, halves)).currentFouls.us, 10);
  // Fouls that never reset add up across the game.
  var never = SB.copyRules({ bonusReset: 'game' });
  c = SB.computeGame(game([ev(1, 'us', 'a', 'foul', 'p'), ev(3, 'us', 'a', 'foul', 'p')], 4, never));
  assert.strictEqual(c.currentFouls.us, 2);
});

test('scrimmage rules', function () {
  var r = SB.scrimmageRules(SB.copyRules());
  // Shooting foul on a 2: 1 point awarded, then the free throw. On a 3: 2 awarded.
  var evs = [ev(1, 'us', 'a', 'award', 1), ev(1, 'us', 'a', 'make', 1), ev(1, 'them', '4', 'award', 2), ev(1, 'them', '4', 'miss', 1),
    ev(2, 'us', 'a', 'make', 2)];
  for (var i = 0; i < 7; i++) evs.push(ev(2, 'us', 'b', 'foul', 'p'));
  var c = SB.computeGame({ events: evs, quarter: 7, rules: r });
  assert.strictEqual(c.score.us, 4);
  assert.strictEqual(c.players.a.pts, 4);
  assert.deepStrictEqual([c.players.a.fgm, c.players.a.fga, c.players.a.ftm], [1, 1, 1], 'awards are not shots');
  assert.strictEqual(c.opp['4'].pts, 2);
  // No foul-outs, no bonus, unlimited timeouts, quarters past 6 are still quarters.
  assert.strictEqual(SB.outReason(c.players.b, r), '');
  assert.strictEqual(SB.foulState(7, r, 0), 'ok');
  assert.strictEqual(c.inBonus.them, false);
  assert.strictEqual(c.timeoutsLeft.us.full, Infinity);
  assert.strictEqual(SB.periodLabel(7, r), 'Q7');
  // Each quarter scored on its own: Q1 tied 2–2, Q2 won 2–0; Q3–Q6 had no scoring.
  assert.deepStrictEqual(c.periodsWon, { us: 1, them: 0, tied: 5 });
  assert.strictEqual(SB.gameFlow(evs).biggestLead.us, 2);
});

test('timeouts per half', function () {
  var r = SB.copyRules({ timeoutsReset: 'half', timeoutsFull: 2, timeoutsShort: 1, otTimeoutsFull: 1 });
  var evs = [ev(1, 'us', '', 'timeout', 'full'), ev(2, 'us', '', 'timeout', 'full'), ev(2, 'us', '', 'timeout', 'short')];
  var c = SB.computeGame(game(evs, 2, r));
  assert.deepStrictEqual(c.timeoutsLeft.us, { full: 0, short: 0 });
  c = SB.computeGame(game(evs, 3, r));
  assert.deepStrictEqual(c.timeoutsLeft.us, { full: 2, short: 1 }, 'a fresh allotment in the second half');
  evs.push(ev(4, 'us', '', 'timeout', 'full'));
  c = SB.computeGame(game(evs, 5, r));
  assert.deepStrictEqual(c.timeoutsLeft.us, { full: 2, short: 1 }, 'OT adds to what is left of the second half');
  assert.deepStrictEqual(c.timeoutsAllot, { full: 3, short: 1 });
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
  assert.strictEqual(c.inBonus.them, false, '4 fouls is one away from the bonus, not in it');
  evs.push(ev(1, 'us', 'c', 'foul', 'p'));
  c = SB.computeGame(game(evs, 1));
  assert.strictEqual(c.inBonus.them, true, 'the 5th foul puts them in the bonus');
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
