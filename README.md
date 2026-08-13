# NFL Skins Draft Assistant

Tells you which pick to make in a 6-team, 5-round snake skins draft.

Static site: vanilla ES modules, no build step, no dependencies. Open
`index.html` through a local web server and it runs.

## Running it

Browsers refuse to load ES modules over `file://`, so it needs a server:

```sh
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

## League rules it scores against

- 6 teams, 5 rounds, snake, 30 picks. Each pick is a team **and** a direction
  (Win or Lose), unique across the draft, so there are 64 draftable assets.
- A base skin when the result matches the direction. Ties score nothing.
- Two bonus skins, checked **independently** (never if/else), and only if the
  base skin was earned:
  - Win pick: +1 if the opponent is held to `< 10.5`, +1 if your team scores `> 39.5`.
  - Lose pick: mirrored.
- Bye weeks score nothing.
- **Postseason (WC / DIV / CC / SB): every Lose pick scores 0.**
- Payout: the Mendoza Line is the average total skins;
  `(your total - Mendoza) x $100`.

The scoring engine is not reimplemented here. `js/vendor/scoring.js`,
`js/vendor/draft.js` and `js/vendor/nfl-teams.js` are byte-identical copies from
the companion tracker repo, which is the source of truth.
`tools/check_vendor.py` SHA-256s them and fails on drift.

## How the projection works

1. `tools/build_market.py` turns market win totals into per-team offence and
   defence ratings.
2. `tools/build_score_shape.py` learns how real game scores are distributed
   around a predicted mean, by **empirical k=40 nearest-neighbour resampling**
   of actual 2025 scores, validated leave-one-week-out.
3. `js/simulate.js` plays the season thousands of times, including a real
   playoff bracket, and scores every simulated result through the tracker's own
   `scorePick()`.
4. `js/assist.js` turns those totals into draft advice: survival odds to your
   next turn, and reach-vs-wait over a two-pick lookahead.

Everything is seeded. Same seed, same board.

### Read this before trusting a number

**The points column is derived, not a market price.** Sportsbooks post win
totals publicly but not season points-for totals, so only half the input is a
real line. Each team's net strength comes from its win total; the split between
scoring and preventing comes from last season's scoring style, regressed hard
toward league average. Rankings driven by wins are on firm ground. The bonus
projections lean on that assumption. The app says so in an amber banner rather
than presenting the whole board as market truth.

Also: preseason lines are compressed relative to how a season actually finishes,
so simulated team strength disperses less than reality will. Bonus counts are
probably slightly conservative. It affects picks roughly proportionally, so
rankings move less than absolute skin totals do.

`OT_RESOLVE_RATE = 0.84` in `js/simulate.js` is a declared modelling choice, not
a measurement.

## Layout

```
index.html  styles.css     four tabs: Board, Rankings, Asset, Model
js/                        the model and the UI
js/vendor/                 copied from the tracker; never edit by hand
data/*.js                  ES modules, not JSON, because a static site with
                           no build step cannot fetch() from file://
data/win-totals-2026.json  the one file meant to be edited by hand
tools/*.py                 Python 3 stdlib only
test/run.sh                the test suite
```

## Tests

Requires no toolchain beyond what macOS ships. `jsc` is the JavaScriptCore
binary bundled with the OS.

```sh
test/run.sh
```

431 assertions plus two Python verifiers. Invariants worth knowing: postseason
base skins total exactly 13.00 (one per playoff game, Win picks only);
postseason Lose skins total exactly 0; playoff odds sum to 14.000; Super Bowl
odds sum to 1.000.

## Updating the win totals

`data/win-totals-2026.json` is hand-entered and is the only place to change
them. A coherent board sums to exactly **272.0** — 272 regular-season games each
distribute exactly 1.0 win, with a tie counting 0.5 to each side.
`tools/build_market.py` refuses to run if it doesn't, because a board that is
off by a few wins came from more than one book or from a media table rather
than a live board, and guessing which entries are wrong is not something a
script should do.

```sh
python3 tools/build_market.py \
    --win-totals data/win-totals-2026.json \
    --games ../nfl-skins-tracker/data/2025-games.json \
    --last-schedule /tmp/2025-schedule.json \
    --schedule data/schedule-2026.js \
    --out data/market-2026.js
```
