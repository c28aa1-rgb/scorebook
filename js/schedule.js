/*
 * Reads a season schedule from pasted text or a CSV file (Google Sheets / Excel "Download as CSV").
 * One game per line. Columns can come in any order, with or without a header row:
 *   date, opponent, home/away, location, time
 * Dates: 2026-12-02, 12/2, 12/2/26, Dec 2, Tue Dec 2, December 2, 2026. Opponents can carry
 * "@ " / "at " (away) or "vs " (home). Pure functions, ES5, so it also runs in Node tests.
 */
(function (root) {
  'use strict';

  var MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  // Season years run Jul–Jun: a date with no year belongs to the season that starts in startYear.
  function iso(y, m, d, startYear) {
    if (!y) y = m >= 7 ? startYear : startYear + 1;
    else if (y < 100) y += 2000;
    if (m < 1 || m > 12 || d < 1 || d > 31) return '';
    return y + '-' + pad(m) + '-' + pad(d);
  }

  function parseDate(s, startYear) {
    s = String(s || '').trim().replace(/\s+/g, ' ');
    var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return iso(+m[1], +m[2], +m[3], startYear);
    m = s.match(/^(?:[a-z]{3,9}\.?,? )?(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?$/i);
    if (m) return iso(m[3] ? +m[3] : 0, +m[1], +m[2], startYear);
    // Optional weekday, then month name and day, then an optional year.
    m = s.match(/^(?:[a-z]{3,9}\.?,? )?([a-z]{3,9})\.? (\d{1,2})(?:st|nd|rd|th)?,?(?: (\d{4}))?$/i);
    if (m) {
      var mi = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
      if (mi >= 0) return iso(m[3] ? +m[3] : 0, mi + 1, +m[2], startYear);
    }
    return '';
  }

  function isTime(s) { return /^\d{1,2}(:\d{2})?\s*(am|pm|a\.m\.|p\.m\.|a|p)$/i.test(s) || /^\d{1,2}:\d{2}$/.test(s); }

  function sideWord(s) {
    s = s.toLowerCase().replace(/\.$/, '');
    if (s === 'home' || s === 'h' || s === 'vs') return 'home';
    if (s === 'away' || s === 'a' || s === '@' || s === 'at' || s === 'neutral' || s === 'n') return 'away';
    return '';
  }

  // Splits one line into cells, honouring "quoted, cells".
  function cells(line, delim) {
    var out = [], cur = '', q = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line.charAt(i);
      if (q) {
        if (ch === '"' && line.charAt(i + 1) === '"') { cur += '"'; i++; }
        else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === delim) { out.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    out.push(cur.trim());
    return out;
  }

  function delimOf(line) { return line.indexOf('\t') >= 0 ? '\t' : line.indexOf(';') >= 0 && line.indexOf(',') < 0 ? ';' : ','; }

  // A line with no separators, like "Tue Dec 2 @ Trinity 4:30 PM" pasted from a website:
  // take the longest leading run of words that reads as a date, a time at the end, and the rest.
  function splitPlain(line, startYear) {
    var parts = line.split(/\s{2,}/);
    if (parts.length > 1) return parts;
    var w = line.split(' '), out = null;
    for (var k = Math.min(4, w.length - 1); k >= 1 && !out; k--) {
      if (parseDate(w.slice(0, k).join(' ').replace(/,$/, ''), startYear)) out = [w.slice(0, k).join(' ').replace(/,$/, '')];
    }
    if (!out) return [line];
    var rest = w.slice(out[0].split(' ').length).join(' ').replace(/^[,\-–]\s*/, '');
    var t = rest.match(/\s+(\d{1,2}(:\d{2})?\s*(am|pm|a\.m\.|p\.m\.)|\d{1,2}:\d{2})$/i);
    if (t) { out.push(t[1]); rest = rest.slice(0, t.index); }
    out.push(rest.trim());
    return out;
  }

  var HEADERS = {
    date: /^(date|day|game date)$/i,
    time: /time/i,
    homeAway: /^(h\/a|home\/away|home or away|home|away|side)$/i,
    location: /loc|venue|gym|site|where|place|facility/i,
    opponent: /opp|opponent|team|against|school|vs/i
  };

  // Returns { rows: [{date, time, opponent, homeAway, location}], bad: [lines it couldn't read] }.
  function parse(text, startYear) {
    var lines = String(text || '').replace(/\r\n?/g, '\n').split('\n').filter(function (l) { return l.trim(); });
    var rows = [], bad = [];
    if (!lines.length) return { rows: rows, bad: bad };
    var cols = null, head = cells(lines[0], delimOf(lines[0]));
    if (!parseDate(head[0], startYear) && head.some(function (h) { return HEADERS.date.test(h) || HEADERS.opponent.test(h); })) {
      cols = {};
      head.forEach(function (h, i) {
        for (var k in HEADERS) if (cols[k] === undefined && HEADERS[k].test(h)) { cols[k] = i; return; }
      });
      lines = lines.slice(1);
    }
    lines.forEach(function (line) {
      var c = cells(line, delimOf(line)), g = { date: '', time: '', opponent: '', homeAway: '', location: '' }, i;
      // No cell reads as a date ("Friday, January 9 vs. Collegiate"): treat it as plain text.
      if (!cols && !c.some(function (v) { return parseDate(v, startYear); })) c = splitPlain(line.trim(), startYear);
      // A comma inside "Dec 2, 2026" splits the year off into the next cell ("2026" or
      // "2026 vs. Collegiate"): move it back onto the date.
      for (i = 0; i < c.length - 1; i++) {
        var y = /[a-z]/i.test(c[i]) && c[i + 1].match(/^(\d{4})(?:\s+(.*))?$/);
        if (y && parseDate(c[i] + ' ' + y[1], startYear)) {
          if (y[2]) c.splice(i, 2, c[i] + ' ' + y[1], y[2]);
          else c.splice(i, 2, c[i] + ' ' + y[1]);
        }
      }
      if (cols) {
        if (cols.date !== undefined) g.date = parseDate(c[cols.date], startYear);
        if (cols.time !== undefined) g.time = c[cols.time] || '';
        if (cols.opponent !== undefined) g.opponent = c[cols.opponent] || '';
        if (cols.homeAway !== undefined) g.homeAway = sideWord(c[cols.homeAway] || '');
        if (cols.location !== undefined) g.location = c[cols.location] || '';
      } else {
        var left = [];
        c.forEach(function (v) {
          if (!v) return;
          if (!g.date && parseDate(v, startYear)) g.date = parseDate(v, startYear);
          else if (!g.time && isTime(v)) g.time = v;
          else if (!g.homeAway && sideWord(v)) g.homeAway = sideWord(v);
          else left.push(v);
        });
        g.opponent = left[0] || '';
        g.location = left.slice(1).join(', ');
      }
      // "@ Trinity", "at Trinity", "vs. Riverdale" carry home/away in the name.
      var m = g.opponent.match(/^(@|at|vs\.?|v\.?)\s+(.+)$/i);
      if (m) { g.opponent = m[2]; if (!g.homeAway) g.homeAway = /^(@|at)$/i.test(m[1]) ? 'away' : 'home'; }
      g.opponent = g.opponent.replace(/\s*\*+$/, '').trim();
      if (!g.homeAway) g.homeAway = 'home';
      if (g.date && g.opponent) rows.push(g); else bad.push(line.trim());
    });
    rows.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    return { rows: rows, bad: bad };
  }

  var SBSchedule = { parse: parse, parseDate: parseDate };
  if (typeof module !== 'undefined' && module.exports) module.exports = SBSchedule;
  else root.SBSchedule = SBSchedule;
})(this);
