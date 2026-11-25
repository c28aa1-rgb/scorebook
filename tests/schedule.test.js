// Run with: node tests/schedule.test.js
var assert = require('assert');
var S = require('../js/schedule.js');

var tests = [];
function test(name, fn) { tests.push([name, fn]); }

test('dates in common formats, year from the season', function () {
  assert.strictEqual(S.parseDate('2026-12-02', 2026), '2026-12-02');
  assert.strictEqual(S.parseDate('12/2', 2026), '2026-12-02');
  assert.strictEqual(S.parseDate('1/15', 2026), '2027-01-15', 'January belongs to the second year');
  assert.strictEqual(S.parseDate('1/15/27', 2026), '2027-01-15');
  assert.strictEqual(S.parseDate('Dec 2', 2026), '2026-12-02');
  assert.strictEqual(S.parseDate('Tue, Dec. 2', 2026), '2026-12-02');
  assert.strictEqual(S.parseDate('December 2nd, 2026', 2026), '2026-12-02');
  assert.strictEqual(S.parseDate('Fri 2/6', 2026), '2027-02-06');
  assert.strictEqual(S.parseDate('Trinity', 2026), '');
});

test('CSV with a header row, any column order', function () {
  var r = S.parse('Opponent,Date,Time,Home/Away,Location\nTrinity,12/2,4:30 PM,Away,Trinity Upper Gym\n"Riverdale, CC",12/5,6:00 PM,Home,Dalton Main Gym', 2026);
  assert.strictEqual(r.bad.length, 0);
  assert.deepStrictEqual(r.rows[0], { date: '2026-12-02', time: '4:30 PM', opponent: 'Trinity', homeAway: 'away', location: 'Trinity Upper Gym' });
  assert.strictEqual(r.rows[1].opponent, 'Riverdale, CC');
  assert.strictEqual(r.rows[1].homeAway, 'home');
});

test('pasted lines with no header, @ and vs, sorted by date', function () {
  var r = S.parse('Dec 9, 2026  ,  vs Poly Prep, 5:00pm\nDec 2 @ Trinity\nTue 12/16\tHorace Mann\tAway\tHM Gym\nno game this week', 2026);
  assert.deepStrictEqual(r.rows.map(function (g) { return [g.date, g.opponent, g.homeAway, g.location, g.time]; }), [
    ['2026-12-02', 'Trinity', 'away', '', ''],
    ['2026-12-09', 'Poly Prep', 'home', '', '5:00pm'],
    ['2026-12-16', 'Horace Mann', 'away', 'HM Gym', '']
  ]);
  assert.deepStrictEqual(r.bad, ['no game this week']);
});

test('lines copied from a website, no separators', function () {
  var r = S.parse('Tue Dec 2 @ Trinity 4:30 PM\nFriday, January 9 vs. Collegiate\nSat 1/17 - at Hackley 2:00pm\nJanuary 23, 2027 vs. Poly Prep', 2026);
  assert.deepStrictEqual(r.rows.map(function (g) { return [g.date, g.opponent, g.homeAway, g.time]; }), [
    ['2026-12-02', 'Trinity', 'away', '4:30 PM'],
    ['2027-01-09', 'Collegiate', 'home', ''],
    ['2027-01-17', 'Hackley', 'away', '2:00pm'],
    ['2027-01-23', 'Poly Prep', 'home', '']
  ]);
});

test('tab-separated (copied from a spreadsheet)', function () {
  var r = S.parse('12/2\t@ Trinity\t4:30\n12/16\tHorace Mann\tAway\tHM Gym', 2026);
  assert.deepStrictEqual(r.rows.map(function (g) { return [g.date, g.opponent, g.homeAway, g.location, g.time]; }), [
    ['2026-12-02', 'Trinity', 'away', '', '4:30'],
    ['2026-12-16', 'Horace Mann', 'away', 'HM Gym', '']
  ]);
});

var failed = 0;
tests.forEach(function (t) {
  try { t[1](); console.log('ok   ' + t[0]); }
  catch (e) { failed++; console.log('FAIL ' + t[0] + '\n     ' + e.message); }
});
console.log('\n' + (tests.length - failed) + '/' + tests.length + ' passed');
if (failed) process.exit(1);
