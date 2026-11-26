// Run with: node tests/stats.test.js
// Season stats (js/stats.js), checked on a small hand-made game and on the sample season.
var assert = require('assert'), vm = require('vm'), fs = require('fs'), path = require('path');

// The browser files attach to a shared global, so load them into one context.
var ctx = { Math: Math, Date: Date, JSON: JSON, Object: Object, Array: Array, String: String, Number: Number, parseInt: parseInt, isNaN: isNaN };
ctx.window = ctx;
vm.createContext(ctx);
['js/core.js', 'js/sample.js', 'js/stats.js'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx, { filename: f });
});
var C = ctx.SBCore, S = ctx.SBStatsCalc, Sheets = ctx.SBStats;

var seq = 0;
function ev(q, tm, p, t, v) { return { s: ++seq, q: q, tm: tm, p: p, t: t, v: v }; }
var five = ['a', 'b', 'c', 'd', 'e'];
function game(id, date, events, opts) {
  opts = opts || {};
  return { id: id, date: date, opponent: opts.opponent || 'Opp', homeAway: opts.homeAway || 'home', rules: C.copyRules({}), quarter: 4,
    status: 'final', events: events, starters: five.slice(), appeared: five.concat(opts.bench || []), subLog: true };
}

var tests = [];
function test(name, fn) { tests.push([name, fn]); }

test('on-court points, possessions and lineup units follow the subs', function () {
  var g = game('g1', '2026-12-01', [
    ev(1, 'us', 'a', 'make', 2),            // a-e on: +2, 1 possession
    ev(1, 'them', '4', 'make', 3),          // -3
    ev(2, 'us', 'e', 'sub', 'out'), ev(2, 'us', 'f', 'sub', 'in'),
    ev(2, 'us', 'f', 'miss', 3), ev(2, 'us', 'b', 'reb', 'o'), ev(2, 'us', 'f', 'make', 3), // a-d + f: +3, 1 possession
    ev(4, 'us', 'a', 'to')                  // a-d + f: 1 possession
  ], { bench: ['f'] });
  var R = S.compute([g], [{ id: 'a' }, { id: 'e' }, { id: 'f' }]), a = R.players.a, e = R.players.e, f = R.players.f;
  assert.strictEqual(a.onFor, 5); assert.strictEqual(a.onAgainst, 3);
  assert.strictEqual(e.onFor, 2); assert.strictEqual(e.onAgainst, 3);
  assert.strictEqual(f.onFor, 3); assert.strictEqual(f.gs, 0); assert.strictEqual(a.gs, 1);
  assert.strictEqual(Math.round(a.onPoss * 100) / 100, 3);
  assert.strictEqual(Math.round(e.onPoss * 100) / 100, 1);
  assert.strictEqual(R.units.length, 2);
  var withF = R.units.filter(function (u) { return u.ids.indexOf('f') >= 0; })[0];
  assert.deepStrictEqual([withF.pf, withF.pa, Math.round(withF.poss)], [3, 0, 2]);
  assert.strictEqual(e.periods, 1);   // only on court in Q1
  assert.strictEqual(a.periods, 3);   // Q1, Q2 and Q4 had plays while on court
});

test('record, splits, halftime and streak', function () {
  var w1 = game('w1', '2026-12-01', [ev(1, 'us', 'a', 'make', 2), ev(3, 'them', '1', 'make', 1)]);
  var l1 = game('l1', '2026-12-05', [ev(1, 'them', '1', 'make', 2), ev(4, 'us', 'a', 'make', 1)], { homeAway: 'away' });
  var w2 = game('w2', '2026-12-09', [ev(2, 'them', '1', 'make', 2), ev(3, 'us', 'b', 'make', 3)], { homeAway: 'away' });
  var T = S.compute([w2, w1, l1], []).team;
  assert.deepStrictEqual([T.rec.w, T.rec.l], [2, 1]);
  assert.deepStrictEqual([T.home.w, T.home.l, T.away.w, T.away.l], [1, 0, 1, 1]);
  assert.deepStrictEqual([T.leadHalf.w, T.trailHalf.w, T.trailHalf.l], [1, 1, 1]);
  assert.deepStrictEqual([T.first.w, T.oppFirst.w, T.oppFirst.l], [1, 1, 1]);
  assert.strictEqual(T.close.w + T.close.l, 3);
  assert.strictEqual(T.streak, 'W1');
});

test('advanced formulas', function () {
  var l = C.emptyLine();
  l.pts = 20; l.fgm = 7; l.fga = 14; l.tpm = 2; l.tpa = 5; l.ftm = 4; l.fta = 5; l.oreb = 2; l.dreb = 8; l.ast = 3; l.stl = 1; l.blk = 1; l.to = 2; l.pf = 2;
  assert.strictEqual(S.efg(l), 8 / 14);
  assert.strictEqual(Math.round(S.ts(l) * 1000), Math.round(20 / (2 * (14 + 2.2)) * 1000));
  assert.strictEqual(S.poss(l), 14 - 2 + 2 + 0.44 * 5);
  assert.strictEqual(S.doubles(l), 2);
  // 20 + 2.8 - 9.8 - 0.4 + 1.4 + 2.4 + 1 + 2.1 + 0.7 - 0.8 - 2
  assert.strictEqual(Math.round(S.gmsc(l) * 10) / 10, 17.4);
});

test('sample season: player totals add up to the team, every sheet renders', function () {
  var n = 0, meta = { currentSeasonId: 's1', settings: { rules: C.copyRules({}) }, players: [] };
  var out = ctx.SBSample.build(meta, function () { return 'id' + (++n); });
  var finals = out.games.filter(function (g) { return g.status === 'final'; });
  assert.strictEqual(finals.length, 6);
  var R = S.compute(finals, out.players), pts = 0, ast = 0;
  Object.keys(R.players).forEach(function (id) { pts += R.players[id].line.pts; ast += R.players[id].line.ast; });
  assert.strictEqual(pts, R.team.us.pts);
  assert.strictEqual(ast, R.team.us.ast);
  assert.strictEqual(R.team.pf, R.team.us.pts);
  // Every unit's points add up to the game totals (all sample games log subs and always have five on).
  var upf = R.units.reduce(function (a, u) { return a + u.pf; }, 0);
  assert.strictEqual(upf, R.team.pf);
  var c2 = { teamName: 'Dalton', oppWord: 'Opponents', season: '2026–27', filter: 'All games', players: out.players, on: C.pctShown({}), link: true,
    find: function (id) { return out.players.filter(function (p) { return p.id === id; })[0] || null; },
    name: function (p) { return p.first || ''; }, jersey: function (p) { return p.num || '?'; }, full: function (p) { return p.first + ' ' + p.last; },
    periodLabel: function (q) { return 'Q' + q; } };
  ['team', 'leaders', 'lineups', 'games'].forEach(function (k) { assert.ok(/class="sx/.test(Sheets[k](R, c2)), k); });
  Object.keys(Sheets.VIEWS).forEach(function (v) { assert.ok(/sx-players/.test(Sheets.players(R, c2, v)), v); });
  assert.ok(/sx-hero/.test(Sheets.player(R, c2, out.players[0].id)));
  // No finished games: sheets say so instead of breaking.
  var E = S.compute([], out.players);
  assert.ok(/No finished games/.test(Sheets.team(E, c2)));
  assert.ok(/No finished games/.test(Sheets.player(E, c2, out.players[0].id)));
});

var failed = 0;
tests.forEach(function (t) {
  try { t[1](); console.log('ok   ' + t[0]); } catch (e) { failed++; console.log('FAIL ' + t[0] + '\n     ' + e.message); }
});
console.log('\n' + (tests.length - failed) + '/' + tests.length + ' passed');
if (failed) process.exit(1);
