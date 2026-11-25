# Dalton Scorebook

A digital basketball scorebook for one team, built for a 2017 Fire HD 8 (1280×800, Android 5.1).
Plain HTML/CSS/JS, no build step, works offline. All data lives on the tablet.

## Using it during a game

- **Our team:** tap a player card, then what happened (+2, ×3, FOUL, …). After a made basket it asks
  *Assist?*; after a miss it asks *Rebound?* — one tap or ignore it. After a free throw the shooter stays
  selected for the second shot.
- **Opponent:** switch to their tab. Tap a jersey number (or **+ Number** to add one), then +1/+2/+3 or
  FOUL. With no number picked, it's logged to their team.
- **Top bar:** score, team fouls this quarter (slashed boxes), **BONUS** when that team shoots on the next
  foul, and timeouts left (tall pips = full, short pips = 30-second). Tap the timeouts to record one.
- **Period button:** end the quarter, go to OT, go back to fix a mistake, or end the game.
- **Undo** removes the last entry. **Play log** lets you remove any earlier entry.
- **Subs:** tap players on/off the court. Fouled-out and ejected players can't go back in.
- **CHG** records a charge taken by the selected player. Record the opponent's offensive foul on their
  tab if you want it in their fouls.
- **Technicals:** a player's card shows a red **1T** badge and turns amber after one technical; the second
  ejects them (red card, EJECTED). In the box score, **EJ** = ejected and **FO** = fouled out.

## After the game

The report has the line score, full box score, opponent scoring by jersey, game flow (lead changes,
runs, timeouts) and a running-score grid like the paper book.

- **Email** opens the mail app with the score, scoring and team stats as text (plus the link if published).
- **Publish link** uploads the report to a private, unlisted link (needs the publishing worker below).
- **Save file** saves a single HTML file you can attach to an email or open anywhere.
- **Print** prints on Letter paper. Best done from a laptop by opening the published link or saved file.
- **Names on reports:** jersey only / first name + initial / full name, per report or as a default in Settings.
- **Shooting percentages:** in Settings, set 2s, 3s or free throws to N/A if you don't record their misses.
  FG% shows N/A if either 2s or 3s are off.

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
