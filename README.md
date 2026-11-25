# Dalton Scorebook

A digital basketball scorebook for one team, built for the Fire HD 10 (2021, 1920×1200 → 1280×800 in
Chrome, landscape). Also works on the 2017 Fire HD 8 and on iPads. Plain HTML/CSS/JS, no build step, works
offline. All data lives on the tablet.

On wide screens (1100 CSS px and up, e.g. the Fire HD 10) the live screen has three columns: player cards,
the stat pad, and a **Plays** panel with recent plays, the running score and the timeout countdown (tap ×
twice to remove a play). Narrower screens use the compact two-column layout with a bottom bar.

The screen stays on whenever the app is open (Settings → Screen can limit it to games). It needs the https
address, and on iPad iPadOS 16.4+ (18.4+ when opened from the home screen); Settings shows whether it's
working on that device.

## Using it during a game

- **Our team:** tap a player card, then what happened (+2, ×3, FOUL, …). After a made basket it asks
  *Assist?*; after a miss it asks *Rebound?* — one tap or ignore it. After a free throw the shooter stays
  selected for the second shot.
- **Opponent:** switch to their tab. Tap a jersey number (or **+ Number** to add one), then +1/+2/+3 or
  FOUL. With no number picked, it's logged to their team.
- **Top bar:** score, team fouls this quarter (slashed boxes), **BONUS** when that team shoots on the next
  foul, and timeouts left (tall pips = full, short pips = 30-second). Tap the timeouts to record one; a
  countdown (1:00 or 0:30) runs in the bottom bar and turns red at zero. Tap it to end early.
- **Period button:** end the quarter, go to OT, go back to fix a mistake, or end the game.
- **Undo** removes the last entry. **Play log** lets you remove any earlier entry.
- **Subs:** tap players on/off the court. Fouled-out and ejected players can't go back in. Subs are
  recorded in the play log (that's how plus/minus is worked out); **Undo** skips over them, so fix a
  wrong sub in the Subs sheet or remove it from the play log.
- **CHG** records a charge taken by the selected player, then asks who on the other team was called for
  the offensive foul (tap their number, **No #**, **+ #** for a new number, or **Skip**).
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

## Rules

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
node tools/make-icons.js   # regenerate icons
```

When you change any app file, bump `VERSION` in `sw.js` so tablets pick up the update.
