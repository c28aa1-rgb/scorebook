# Dalton Scorebook

A digital basketball scorebook for one team, built for the Fire HD 10 (2021, 1920×1200 → 1280×800 in
Chrome, landscape). Also works on the 2017 Fire HD 8 and on iPads. Plain HTML/CSS/JS, no build step, works
offline. All data lives on the tablet.

On wide screens (1024 CSS px and up: the Fire HD 10 and any iPad in landscape) the live screen shows both teams at once: your
five player cards, the opponent's jersey numbers beside them, then the stat pad. Tapping a player on either
side switches the pad to that team (tap a team's name to switch without picking anyone). Narrower screens
use tabs to switch between teams.

The screen stays on whenever the app is open (Settings → Screen can limit it to games). It needs the https
address, and on iPad iPadOS 16.4+ (18.4+ when opened from the home screen); Settings shows whether it's
working on that device.

## Using it during a game

- **Our team:** tap a player card, then what happened (+2, ×3, FOUL, …). After a made basket it asks
  *Assist?*; after a miss it asks *Rebound?* — one tap or ignore it. After a free throw the shooter stays
  selected for the second shot.
- **Opponent:** switch to their tab. Tap a jersey number (or **+ Number** to add one), then +1/+2/+3 or
  FOUL. With no number picked, it's logged to their team.
- **Top bar:** score, team fouls this quarter (slashed boxes), and on the team that shoots: **1 TO BONUS**
  when the other side's next foul is the bonus foul, **BONUS** once it's been reached; and timeouts left (tall pips = full, short pips = 30-second). Tap the timeouts to record one; a
  countdown (1:00 or 0:30) runs in the bottom bar and turns red at zero. Tap it to end early.
- **Period button:** end the quarter, go to OT, go back to fix a mistake, or end the game.
- **Undo** removes the last entry. **Play log** lets you remove any earlier entry.
- **Reloading mid-game** (reload button, pull-to-refresh) asks first; pull-to-refresh is also turned off on
  the live screen. Everything is saved either way. (Safari on iPad doesn't show this question.)
- **Subs, one at a time:** tap the player coming off, then **SUB**, then who's coming in (3 taps). The new
  player takes the same spot on screen.
- **Subs, several at once:** open **Subs** and tap anyone to take them off (dashed amber) or put them in
  (blue), in any order and with any count along the way. Nothing changes until **Save lineup**, which only
  works with exactly five picked (or everyone still eligible, if fewer than five can play); **Cancel**
  throws the changes away. Each player going in takes the card spot of one coming off, in the order tapped.
  Fouled-out and ejected players can't go back in.
- Subs are recorded in the play log (that's how plus/minus is worked out). Any sub entered before the next
  point counts exactly, so it's fine to catch up during free throws. **Undo** skips over subs; fix a wrong
  one in the Subs sheet or remove it from the play log.
- **Opponent column (wide screens):** rows shrink to fit, switching to slim one-line rows past 8 numbers,
  so about 12 fit before it scrolls.
- **CHG** records a charge taken by the selected player, then asks who on the other team was called for
  the offensive foul (tap their number, **No #**, **+ #** for a new number, or **Skip**).
- **Coach and bench technicals:** tap the team's name (above their column, or their tab), then **TECH**, and
  pick **Head coach**, **Assistant coach**, **Bench player** (pick who) or **Team**. Assistant and bench-player
  technicals count against the head coach too: the top bar shows **HC 1T** / **HC 1+1T** (amber when one more
  would eject) and **HC OUT** at 2 direct or 3 in all (NFHS; both limits and whether these count as team
  fouls are in the rules). Reports list them under each box score.
- **Technicals:** a player's card shows a red **1T** badge and turns amber after one technical; the second
  ejects them (red card, EJECTED). In the box score, **EJ** = ejected and **FO** = fouled out.

## After the game

The report has the key team numbers at a glance, the line score, a score-margin chart (who led and by
how much through the game, with period dividers; hover over it, or touch and slide along it, to see the
score, margin and basket at any point), the full box score, head-to-head bars, who scored (2s,
3s and free throws for both teams), the opponent box score, the lineups used with their plus/minus, game
flow (top performer, lead changes, runs, timeouts) and a running-score grid like the paper book. The charts
are plain HTML/SVG, so they also show in the saved file, the published link and print.

- **Email** opens the mail app with the score, scoring and team stats as text (plus the link if published).
- **Publish link** uploads the report to a private, unlisted link (needs the publishing worker below).
- **Save file** saves a single HTML file you can attach to an email or open anywhere.
- **Share file** (Android and iPad, https address only) opens the tablet's share menu with the report
  file attached and the score summary as the message: Bluetooth (no Wi-Fi needed), Gmail, Drive, etc.
- **Print** prints on Letter paper. Best done from a laptop by opening the published link or saved file.
- **Names on reports:** jersey only / first name + initial / full name, per report or as a default in Settings.
- **Shooting percentages:** in Settings, set 2s, 3s or free throws to N/A if you don't record their misses.
  FG% shows N/A if either 2s or 3s are off.

**Plus/minus** (+/−) is our points minus theirs while each player was on court. It's counted for games
started after subs were recorded (Nov 2026 onward); older games show —.

**Stats** (home screen → Stats, or the five links under Season leaders). The **Games** menu limits
everything to all games, home, away, wins, losses, the last 5 or 10, or scrimmages (which are otherwise
left out).

**Search** (the magnifier at the top of Stats and player pages; it opens into a search field, and × or
Escape closes it): as you type, a list of matching players, stats
and games appears. Tap one, or press Enter for the first. A player or game opens it, and a stat opens the
players view sorted by it (e.g. "free throw" → Shooting, sorted by FT%) or scrolls to it on its sheet
(e.g. "close games" on Team). Searching for a player or opponent also narrows the lists on the current tab
to matching rows; **Show all** (or Escape) clears it.

Tabs:

- **Team:** record (home/away, streak, last 5), points for and against, average scoring by quarter,
  margin by game (wins up, losses down), points and shooting percentages game by game,
  shooting (2s, 3s, FTs, effective FG%, true shooting %), where the points come from, possessions and
  points per 100, assists and turnovers, game situations (close games, leading/trailing at half, scored
  first), fouls and free throws, results by opponent, and single-game team highs.
- **Players:** per game, totals, shooting and advanced views, listed by games played (most first); tap a
  column to sort by it (again to flip, a third time to go back to games played). Each view has a chart:
  production bars (points, rebounds, assists, steals + blocks), a volume-vs-efficiency scatter, and on/off bars. Advanced has game score,
  share of team points, usage, assist-to-turnover, double-doubles, quarters played, plus/minus and on/off
  court net points per 100 possessions.
- **Leaders:** top 5 in 18 categories and single-game highs.
- **Lineups:** every five-player unit with possessions, points for/against and net per 100, and the record
  of each starting lineup (from games that recorded subs).
- **Game log:** each game's team numbers and top scorer.

Tap a player anywhere for their page, headed by their jersey in the team color: season line, rank on the team in each stat, shooting bars, points
mix, impact numbers, points by game and by quarter, season highs, splits (home/away, wins/losses, started/
bench, last 3), their best lineups and the full game log. Tap a game to open its report.

There's no game clock, so nothing is per minute. Possessions are estimated from our plays
(FGA − OREB + TO + 0.44 × FTA); the opponent's misses aren't recorded, so their possessions are taken to
equal ours.

**Print** (top right on Stats and player pages) opens a list of sheets: team, the four player views,
leaders, lineups, game log, this player's page or every player's page. Each prints on its own page,
with wide tables in landscape. Best from a laptop or with Save as PDF.

**Back up** from Settings after each game (saves a .json file to Downloads). Restore it from the same page.

## Schedule

Home → **Schedule**, then **Add games** at the bottom (it opens on its own when the schedule is empty):
upload a CSV (Google Sheets: File → Download → CSV; Excel: Save As → CSV) or paste the
schedule, one game per line, then check the preview and add. Columns can be in any order (date, opponent,
home/away, location, time), with or without a header row; lines like "Tue Dec 2 @ Trinity 4:30 PM" or
"12/5 vs Riverdale" work too. Dates without a year are placed in the current season. Games already on the
schedule are skipped. You can also add games one at a time.

The next three games show under **Up next** on the home screen; **Start game** opens New game with the
opponent, date, place and home/away filled in, and the schedule then shows Resume or the final score.

On New game you can also type the opponent's jersey numbers so their column is ready at tip-off.
When it's a team you've already played this season, their numbers from those games (games and
scrimmages) are filled in as soon as you type or pick the name; remove anyone who isn't playing. Numbers
you type yourself are never replaced.
Schedule entries can be scrimmages (Start scrimmage opens the scrimmage setup) or have the opponent
`TBD` (tournaments), which leaves the opponent blank on New game.

**Roster:** the players are listed first; **Add players** at the bottom opens the form (it opens on its own when
the roster is empty) and stays open after each add for the next one.

**No jerseys yet?** On Roster, leave Jersey blank. The player shows with their initials (cards, subs,
running score) and by name elsewhere; type the number in on Roster later and every game, including ones
already played, shows it.

## Test mode

Settings → **Test mode** → **Start test mode** (or **Start with sample games**) lets you practice or try
things without keeping them: nothing is saved on the tablet or synced, and changes from other tablets
are ignored meanwhile. An amber frame and a **TEST MODE · nothing is saved · Exit** bar show it's on.
**Exit**, or any reload, puts everything back exactly as it was.

## Scrimmages

On New game, set **Type** to **Scrimmage**. The quick setup has quarters (4, 5, 6 or 8) and minutes; the
last scrimmage's settings are remembered, and **More options** has every rule. By default a scrimmage:

- doesn't count toward the season record, stats, leaders or player game logs (it shows with an **S** and a
  Scrimmage tag in the games list);
- scores each quarter on its own: this quarter's score shows under the period in the top bar (QTR 4–2),
  ending a quarter says who won it, and the report shows each quarter's winner and quarters won;
- lets you add quarters whenever you like (Period button → **End Q6 · start Q7**) and end at any time;
- has unlimited timeouts, no foul-outs and no bonus;
- handles the shooting-foul rule (points for the shot + 1 free throw) through **+1**: after each +1 the pad
  asks **Free throw?** — **Free throw** (or just carry on) keeps it a made free throw; **Point only** or
  **2 points** (fouled on a 3) turns it into points that don't count as a shot, so FT% isn't affected.
  Reports show these in an **SF** column (and as green slashes in the running score).

Otherwise the live screen looks and works exactly like a real game (same score display, foul boxes and
timeout pips, just without limits), so scoring a scrimmage is good practice for game day.

## Rules

Settings → **Rules for new games** sets the defaults: periods (4 quarters or 2 halves, shown as Q1–Q4 or
H1–H2), minutes, foul-out and technical limits, the bonus and an optional double bonus, whether team fouls
reset each period, each half or never, whether they carry into OT, and timeouts (full and 30-second, per
game or per half, plus extra per OT). Each game keeps its own copy: change it for one game on the New game
screen (**Change rules for this game**) or mid-game from the period button (**Rules for this game**).

Defaults to NFHS as played in the Ivy Prep league: 4 × 8 min, foul out at 5 (technicals count toward the 5),
ejected on a 2nd technical, bonus on the 5th team foul
each quarter (4th-quarter fouls carry into OT), 3 full + 2 30-second timeouts, OT 4 min with 1 extra
timeout. All editable in Settings; each game keeps the rules it started with.

## Setting up the tablet

The app must be served over **https** for offline mode and home-screen install. Use **Chrome** on the Fire
(not Silk) — Chrome 95, the last version for Android 5, supports everything the app uses.

The app is hosted on GitHub Pages at **https://c28aa1-rgb.github.io/scorebook/**. Every push to `main`
redeploys it within a minute or two.

1. Open the address in Chrome on the Fire, then menu → **Add to Home screen**. It launches full screen,
   landscape, and works with no Wi-Fi after the first load. On an iPad, use Safari → Share → **Add to Home Screen**.
2. In a browser tab, the **Full screen** button (home screen and live game) hides the browser bars. Settings →
   Screen can make games open full screen automatically.

Data is saved per address, so games entered at a local test address don't appear on the hosted one.
Move them with Settings → **Save backup file** and **Restore from backup**.

## Cloud sync (Firebase)

With `js/firebase-config.js` filled in, the app asks for Google sign-in before anything else and only
lets in accounts on the access list (see below). Every change is saved on the tablet first and
then to Firestore, so scoring never waits on the network; changes made offline upload when the tablet is
back online, and signing in on another tablet shows the same games. Settings → **Account and sync** shows
the account, the sync state and **Sign out**. Backup files still work as an extra copy.

How the roster, schedule, seasons and settings sync (since v33): copies from different tablets are merged
item by item, so a tablet with an older copy adds what it has instead of replacing everything, and
deletions are remembered so they don't come back. Single settings take the newest change. A tablet with
nothing saved yet always takes the cloud's copy on its first sign-in (before v33 a brand-new tablet or
browser could replace the cloud copy with a blank one). **Restore from backup** replaces the record on every
tablet. A tablet only sends the record after it has read the server's copy in that session, and not
while offline (offline changes are merged in when it reconnects).

**Safeguards (since v34):**

- **Automatic backups:** every save keeps an hourly snapshot of the roster, schedule, seasons and settings
  in `books/dalton/history`, plus one from the start of each day that isn't overwritten that day. Settings
  → **Automatic backups** lists them; **Restore** (two taps) puts one back on every tablet. Games aren't
  part of these snapshots (each game is its own record and is protected by the lock below). A tablet also
  keeps its previous copy in `localStorage` (`sb-meta-before-sync`) whenever a sync shrinks its roster or
  schedule.
- **Database rules** (`firestore.rules`): a save can't remove more than 5 players or 5 scheduled games at
  once, or empty either list, unless it's a restore. The book can't be deleted, and backups can't be deleted
  from the app.
- **Finished games lock** one hour after **End game**: no tablet can reopen, change or delete them after
  that (publishing the report link still works), and a sync never removes a finished game from a tablet.
  Until then the report shows when it locks. Corrections after that are made in the Firebase console (or
  with the admin API), which the rules don't apply to.

The Firebase project is **daltrillion-admin** (shared with Daltrillion, which doesn't use Firestore; the
scorebook is its own web app there, "Dalton Scorebook"). Google sign-in is enabled and
c28aa1-rgb.github.io is an authorized domain, so sign-in works on the GitHub Pages address (not on
localhost unless that's added under Authentication → Settings → Authorized domains).

Data lives under `books/dalton` (roster, seasons, schedule, settings) and `books/dalton/games/{id}`.
**Who can sign in** is kept in the database, not in this repo (which is public): one document per Google
account in the `access` collection, named by the email address in lower case (e.g.
`access/coach@dalton.org`, any fields). To add or remove someone, open the Firebase console → Firestore
Database → `access` and add or delete their document. `firestore.rules` only lets accounts with a
document there (and a verified email) read or write `books/`, and nobody can change `access` from the app.
Deploy rule changes with `firebase deploy --only firestore:rules`.

**Offline:** once an account has signed in online on a tablet, the app opens there with no internet:
the sign-in and the "allowed" answer are remembered, and it starts straight from the tablet's copy
without waiting on the network. Everything scored offline uploads when the tablet is back online, and
the app then catches up with changes from other tablets. The very first sign-in on a tablet needs internet.

The Firebase SDK is bundled in `vendor/firebase` (so sign-in works offline once cached) and is only loaded
when a config is set; with `config: null` the app runs on the tablet alone, as before.

## Publishing reports (optional)

```
cd worker
npx wrangler r2 bucket create scorebook-reports
npx wrangler secret put PUBLISH_KEY
npx wrangler deploy
```

Then in the app's Settings enter the worker address (e.g. `https://scorebook-reports.<you>.workers.dev`)
and the same publish key.

## Development

```
node tools/serve.js        # http://localhost:8080
node tests/core.test.js    # stat and rules tests
node tests/schedule.test.js  # schedule import tests
node tests/stats.test.js   # season stats tests
# logo and icons: icons/tiger-source.png is the original tiger. tools/render-logo.html draws the cleaned-up
# tiger.png (header, launch screen, reports, stat sheets), favicon-64.png and the app icons from it; open
# http://localhost:8080/tools/render-logo.html, run a receiver on port 8099 for those names, then press Save.
```

When you change any app file, bump `VERSION` in `sw.js` so tablets pick up the update. Tablets check for a
new version on launch and whenever the app comes back on screen; Settings → App version shows the running
version and has **Check for updates**.
