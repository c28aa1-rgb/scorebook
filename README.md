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
- **Subs, one at a time:** tap the player coming off, then **SUB**, then who's coming in (3 taps). The new
  player takes the same spot on screen.
- **Subs, several at once:** open **Subs** and tap who's coming in and who's going out, in either order;
  each pair is swapped (the waiting half shows in amber). Tap an on-court player twice to take them off
  with no replacement; with an open spot, one tap on a bench player puts them in. Fouled-out and ejected
  players can't go back in.
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

The report has the line score, full box score, opponent scoring by jersey, game flow (lead changes,
runs, timeouts) and a running-score grid like the paper book.

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

**Season** (home screen): leaders in each category (top 3; percentages need at least 1 attempt per game
and 5 in all), and the season stats table. Tap any player for their game-by-game log with totals and
per-game averages; tap a game there to open its report.

**Back up** from Settings after each game (saves a .json file to Downloads). Restore it from the same page.

## Schedule

Home → **Schedule**: upload a CSV (Google Sheets: File → Download → CSV; Excel: Save As → CSV) or paste the
schedule, one game per line, then check the preview and add. Columns can be in any order (date, opponent,
home/away, location, time), with or without a header row; lines like "Tue Dec 2 @ Trinity 4:30 PM" or
"12/5 vs Riverdale" work too. Dates without a year are placed in the current season. Games already on the
schedule are skipped. You can also add games one at a time.

The next three games show under **Up next** on the home screen; **Start game** opens New game with the
opponent, date, place and home/away filled in, and the schedule then shows Resume or the final score.

On New game you can also type the opponent's jersey numbers so their column is ready at tip-off.

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
node tools/make-icons.js   # regenerate icons
```

When you change any app file, bump `VERSION` in `sw.js` so tablets pick up the update. Tablets check for a
new version on launch and whenever the app comes back on screen; Settings → App version shows the running
version and has **Check for updates**.
