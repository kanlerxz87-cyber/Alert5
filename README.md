# Alert5 — MLB live play-by-play and replay alerts

Copied from [snapquast73-boop/LIVPBP](https://github.com/snapquast73-boop/LIVPBP/tree/5c02527d3c7a56ea66c698cfabff80a407b6dfd3) (MIT), pinned at `5c02527d3c7a56ea66c698cfabff80a407b6dfd3`.

- [Live scoreboard](https://kanlerxz87-cyber.github.io/Alert5/)
- [Replay feed](https://kanlerxz87-cyber.github.io/Alert5/reviews.html) — defaults to the current local date, not a fixed historical day.
- [Reference date](https://kanlerxz87-cyber.github.io/Alert5/reviews.html?date=2026-08-26)
- [Upcoming slate](https://kanlerxz87-cyber.github.io/Alert5/index.html?date=2027-04-01)
- [Flagged for Review](https://kanlerxz87-cyber.github.io/Alert5/flagged.html#alert5-verification)

No build step or API key is required. GitHub Pages serves the files directly. Live data comes from MLB StatsAPI in the visitor’s browser. Keep a page open for polling alerts; browser audio may require a click. Pages uses browser-local persistence, not the optional server’s shared store.

Latency policy and the terms-of-use position: [`docs/api-latency-and-terms.md`](docs/api-latency-and-terms.md). Live game state, the separate official-scoring log and the alert sound: [`docs/live-state-and-scoring-log.md`](docs/live-state-and-scoring-log.md) and [`docs/alert-sound.md`](docs/alert-sound.md).

```sh
npm ci
npm run test:all
npm run test:state   # live state, official-scoring log, alert sound, request budget
npm run test:official # requires access to statsapi.mlb.com
npm run serve        # optional local server, port 8000, binds 0.0.0.0
```

[Copy verification](docs/alert5-copy-verification.md) records the scope and limitations. Parallel integration PR #4 restored upstream model probability/adjustment displays for reference parity. These are local, unverified calculations, not official MLB values; see the published review flags. TBD start times are respected. The remaining application behavior is preserved. The upstream documentation below is historical, not a fresh Alert5 verification. Its upstream URLs, dates and checkpoint tag refer to LIVPBP; that tag is not installed in this repository.

---

# ⚾ MLB Live PBP — Live MLB Scoreboard & Play-by-Play

> ### ♻️ **RESTORATION NOTE (2026-11-20)** ♻️
> This repository was uploaded incomplete: the three HTML pages referenced a stylesheet and nine
> scripts under `assets/` that were **not** part of the upload, so GitHub Pages served an unstyled,
> inert page. The original author's repository (the previous "Live demo" link) no longer exists on
> GitHub (`404`), so the client could not be copied back.
>
> What was done here: every missing asset was re-implemented against the pages' own DOM contract and
> the **official MLB StatsAPI**, then verified — field by field, with the official response linked for
> each one — in [`docs/verification-report.md`](docs/verification-report.md), and end-to-end with
> `node tests/jsdom-render-test.mjs` (field map: `docs/statsapi-field-map.md`). Known deviations from this README's description of the
> original (refresh cadence, the reduced hit-forecast drivers, the simplified review score tracker,
> and every unverified item) are published on the
> **[⚑ Flagged for Review](https://snapquast73-boop.github.io/LIVPBP/flagged.html)** page, with source
> links. The text below is the original project documentation, unchanged apart from this note, the
> demo link, the file-tree entries that now exist, and the test commands in "Run it locally".

> ### 🛑 **CHECKPOINT NOTICE: `v1.0.0-stable-checkpoint`** 🛑
> **This tag marks a safe, working baseline of the code. If any experimental changes break the app, you can instantly revert back to this stable state by running:**
> ```bash
> git reset --hard v1.0.0-stable-checkpoint
> ```

A zero-dependency, static web app that pulls **live MLB game data** straight from the
public MLB StatsAPI and renders it in a **Gameday-style scoreboard** — exactly the data
mlb.com uses, re-implemented from scratch in vanilla HTML/CSS/JS.

- **Scoreboard** (like [MLB.com](https://www.mlb.com/scoreboard)) — every game for any
  date, with live scores, inning, count, probable pitchers, and W/L/S decisions.
  Deep links: `index.html?date=YYYY-MM-DD` opens a specific day (same for
  `reviews.html?date=YYYY-MM-DD`), and the address bar follows the selected date;
  the date-picker and day-nav buttons stay the in-page controls.
- **Game view** (like [MLB.com Gameday](https://www.mlb.com/gameday)) — **who's at bat,
  who's pitching, the count, outs, runners on base**, on-deck / in-the-hole hitters,
  pitch counts, last play, inning-by-inning linescore, full box score, and the complete
  play-by-play timeline with pitch-by-pitch details.
- **Instant Replay Reviews & Challenge Alerts** — real-time alerts and dedicated tracking
  for **Manager Challenges**, **Crew Chief Reviews**, **Umpire Reviews**, and **ABS**
  (Automated Ball-Strike system) pitch challenges across both the Scoreboard and Game views:
  - **All-Games "Replay Feed" page** (`reviews.html`) — a live, chat-style feed that pulls
    review events from **every game on the schedule** (not just one game): new manager
    challenges, crew chief reviews, umpire reviews, ABS pitch challenges and
    boundary-call reviews (potential home runs / fair-foul at the wall) appear at the
    top of the feed as they happen, with game link, inning, challenging team, reason,
    outcome, batter/pitcher context, and a three-row **review score tracker**:
    **Before review** (the call-on-field score when the active review is first
    observed), **Possible after** (call stands plus any conditional run-removal
    scenario supported by the reviewed scoring movements), and **Actual after**
    (the official score after the resolved reviewed play/action, when exposed).
    For example: `NYY 6 – BOS 5`, possible
    `NYY 5 – BOS 5` if the reviewed safe-at-home run is removed, then the actual
    official score after the ruling. The possible score is **not a prediction**:
    on a home-run/boundary review MLB may instead place runners. A boundary review
    with no currently credited run says “score impact pending” and does not invent
    an alternate score. If the page opens only after resolution, it shows an
    attributable official Actual-after score when available and honestly marks
    Before/Possible as not observed. A later end-of-plate-appearance score is not
    assigned to an earlier pitch review. For ABS,
    the feed also shows the pitch count before the challenge, who challenged (batter /
    catcher / pitcher, from official play text or the challenging team's batting/
    fielding side), and the count after the call is overturned or stands.
    Every ABS-challenge and manager-challenge row also carries a
    **challenges-remaining tracker**: the challenging team's current official
    counter (e.g. `CIN: 2 ABS challenges left now (2 successful · 0 failed)` or
    `PIT: 1 manager challenge left now (0 used)`), with the both-teams summary
    (`Challenges left: CIN 1 MGR · 2 ABS — CHC 1 MGR · 2 ABS`) on hover and on
    the Under-Review live strip. The numbers are the **official StatsAPI
    counters read as-is** — `review.away/home.used/remaining` (manager
    challenges, from the schedule's `hydrate=review` and feed/live
    `gameData.review`) and `gameData.absChallenges.away/home.usedSuccessful/
    usedFailed/remaining` (ABS, feed/live only; verified live 2026-08-28) —
    never counts derived from feed events, never zero-filled when absent
    (pre-ABS seasons have no `absChallenges` object at all), and a used-counter
    that moves backwards between polls is flagged on the row as an
    irregularity instead of being silently corrected. Crew-chief, umpire and
    boundary reviews are not charged to a team's counter, so those rows show
    no counter line by design. Includes
    an "Under Review" live strip, per-type
    filters — **All** (every category except ABS pitch challenges:
    challenges, reviews, boundary calls, under review, runs at risk),
    **ABS** (ABS challenges stay fully tracked here, in the **ABS
    Challenges** stat, and in the challenges-remaining counters),
    **Challenges**, **Reviews**, **Boundary Calls**, **Under Review**,
    **⚠️ Runs at Risk** —,
    summary stats for the whole day, and an optional **alert sound** — a gentle
    synthesized raindrop chime, **~3 seconds** (soft sine drops on an A-minor
    pentatonic figure, a light echo and a warm two-note bloom that fades out;
    pure sine tones through a 3.4 kHz low-pass, no buzzer), built to be heard all
    season without fatigue. It is off by default, remembers your choice per
    browser, and sounds for **every event that appears in the feed** — new
    manager challenges, crew-chief/umpire reviews, instant replays, boundary
    calls, official-scorer pending rulings, official scoring changes and runs at
    risk. Routine ABS pitch challenges stay silent by policy (dozens a game);
    they remain tracked in the ABS tab and the counters. One sound per event
    burst (2.5 s cooldown) so five events in one poll do not stack, and the same
    sound is used by the scoreboard's review ticker and the game page, so it is
    recognisable across surfaces. **▶︎ Test sound** plays it on demand even while
    alerts are muted, and turning the toggle on plays the real sound once — the
    audio path can be verified at any time, not just when a challenge happens.
    The read-out next to the controls says whether the browser is currently
    blocking audio (it does until the first click).
  - **⚠️ Runs at Risk — "could this review take a run OFF the board?"** The feed
    tracks, per review, whether the call on the field credited runs to the very
    event now under review, so an overturn could remove them from the score. When
    it can, you get, immediately: the **same gentle raindrop chime** used for any
    new review (one alert sound for the whole page — it is literally the same
    audio graph, and shares its 2.5s cooldown), an
    optional **desktop notification**, a persistent **red banner** at the top of
    the page listing every affected game with the call-stands score and — only
    when the payload actually supports it — the score if the runs come off,
    a **⚠️ N RUN(S) AT RISK** badge and glow on the feed row,
    a **Runs at Risk** stat, and a dedicated filter tab. It fires once per review
    (not once per poll), clears the moment the review resolves, and applies to
    every review type — manager challenge, crew chief/umpire review, boundary call,
    "under review", and ABS — because it is decided by the *data*, not the type: a
    run counts only when the official payload has a `runners[]` record with
    `details.isScoringEvent:true` whose `details.playIndex` matches the reviewed
    event. A score change elsewhere in the plate appearance (a steal of home, a
    wild pitch) never counts, and the ruling itself is **never predicted**.
    Note that browsers block audio until you have interacted with the page, so a
    run-at-risk chime on the very first page load may be silent until you click
    something; the desktop notification is not affected.
  - **Scoreboard Live Ticker & Alert Badges** — surfaces any game currently in review or challenge,
    with a link straight to the all-games Replay Feed.
  - **Live Game Review Alert Banner** — eye-catching alert at the top of the game and live module when a call is under review.
  - **Dedicated "Challenges & Reviews" Tab** — full breakdown of every review event with summary stats (overturn rate, breakdown by challenge type and team), call reasons, and outcomes (Overturned, Stands, Confirmed).
  - **Play-by-Play Chips** — highlighted review outcome chips directly on affected plays.
  - All review parsing is validated against the real StatsAPI shapes (`reviewDetails`
    with codes `MJ` = ABS pitch challenge, `MA`/`MF` = manager challenges, and
    `NH` = boundary-call review, plus
    `feed.gameData.review` / `feed.gameData.absChallenges` challenge counters) — see
    `docs/verification-report.md` and `tools/smoke-test.mjs` (review-parser checks) plus
    `tests/jsdom-render-test.mjs` (end-to-end render). The original `tools/review-test.mjs`
    was not part of the upload — see `flagged.html` F-003.
- **Two-sided hit forecast** — a transparent per-plate-appearance hit probability that
  compounds the batter's and pitcher's season rates (log5), real platoon splits,
  recent form, head-to-head history, same-game familiarity, and the live count into a
  single number with a matchup tier (Elite → Pitcher's edge) and per-driver point
  adjustments. It appears in the live at-bat card, the Props & Matchup tab, and
  completed PBP rows.
- Auto-refreshes: on a live game page the full feed lands every **500ms**, while
  a dedicated **125ms status watcher** catches a brand-new challenge/review the
  instant MLB flips the official game status — and paints the review banner from
  the lean probe (~3 KB) while the 1–2MB full feed is still downloading (and
  while a review is in flight the page probes the lean play-by-play endpoint
  every **250ms**, pulling the full feed only when the review state flips). The
  Replay Feed sweeps the whole slate's official status every **125ms**; a game
  under review is re-read every **250ms**, other live games on their own due
  times (**750ms**, relaxing to **1200ms** on a slate of more than eight live
  games) so no game is starved, and the challenge counters on a slower **15s**
  clock. A game that flips into a review *during* a cycle is fetched out of band
  instead of waiting for that cycle to finish, and a hidden tab keeps a 3s
  heartbeat rather than stopping, so returning to it paints current data. Every
  one of those cadences is capped by the request budget in `assets/js/api.js`,
  not by the timer. The scoreboard keeps its 500ms hydrated-schedule poll and adds the same
  **125ms status sweep** for the review ticker. When the persistence server is running, a **live push**
  (server-sent events) delivers every tracked entry recorded by another tab or
  browser as soon as it is written — the Replay Feed is the only writer of that
  log, and its write is coalesced at ≤1/s — while the periodic pull stays as the
  fallback (and for static hosting). Post-Final scorer rulings are re-scanned every **1s** for the
  first two minutes, then 2.5s to five minutes, then 15s inside a bounded
  30-minute grace. Works on desktop and mobile.
- **📡 Live game state, captured as it happens** — every game on the slate is
  snapshotted on every capture into a complete, second-stamped official state:
  score, inning/half, outs, balls/strikes, total pitch count, the batter at bat,
  the pitcher, the runners on base, and the exact official status wording. Two
  consecutive captures are diffed, so each *transition* is recorded in the API's
  own words (`Score: SEA 3 – MIN 4 → SEA 4 – MIN 4`,
  `Status: Manager challenge: Tag play → Umpire review: Home run`) rather than
  only its final value. The newest 12 transitions per game appear in the main
  feed as 📡 rows; the full history and the per-game score/outs timeline are in
  the 📡 Game State tab. Records come from `assets/js/game-state.js`; the rule
  that a first observation never has a fabricated "before" is enforced there.
- **✏️ Official scoring — a separate, persisted section** — official-scorer
  *pending rulings* (`os_ruling_pending_primary` / `os_ruling_pending_prior`, the
  at-bat has not been scored yet) and *scoring changes* (the official scorer
  reclassifying an already-scored play) are logged in the ✏️ Official Scoring
  section, deliberately **outside** the alert feed. Each row keeps the exact
  official wording before and after the change (event type + description, RBI,
  out flag, outs, score), when it was first and last observed, and its source
  endpoint. A pending ruling is updated — never deleted — to `resolved` with the
  wording that replaced it. The log survives a page refresh, a new tab and (with
  the optional server) a different browser; it is stored in its own key and its
  own file, so it cannot disturb the alert path. CSV/JSON export included.
  Details: [`docs/live-state-and-scoring-log.md`](docs/live-state-and-scoring-log.md).
- **Honest, bounded request rate.** Every call is charged to a request class with
  a documented per-minute ceiling (`BUDGET_PROFILES` in `assets/js/api.js`), and
  a spent budget skips a cycle (a silent deferral) instead of piling up requests
  or showing an error. The play-by-play poll is conditionally revalidated, so an
  unchanged game costs headers only. The read-out under the feed shows the
  cadence actually held, the ceiling, and how many calls were deferred. Full
  numbers and the terms-of-use position: [`docs/api-latency-and-terms.md`](docs/api-latency-and-terms.md).
- **"Under review" is detected from the official game status, not from play
  text.** All three surfaces run a dedicated **125ms review-status watcher**
  (`GET /api/v1/schedule` with a `fields` projection and no hydrations — the
  whole slate's `gamePk` + `status` in ~2.4 KB, ~1/8th the size of the schedule
  the rest of the page uses); the Replay Feed and the scoreboard use it for
  the whole slate, and the game page sweeps a ~150-byte per-game status
  projection on the same cadence. MLB flips `status.statusCode` the instant a
  review is **called**, while the play description is written when it
  **resolves** — so this cuts the worst-case wait from ~3s (the schedule cache)
  to ~125ms plus one round trip, and it surfaces the official review reason
  ("Tag play", "Home run", "Pitch Result", …) before any play text exists.
  Detection reads the API's own status registry (`GET /api/v1/gameStatus`:
  `M*` manager challenge, `N*` umpire review, `IH` instant replay, `MJ`/`NJ`
  ABS pitch challenge) instead of matching the words "challenge"/"review" —
  which silently missed crew-chief reviews, whose official `detailedState` is
  **"Instant Replay"**. See `docs/verification-report.md` §16.
- No build step, no frameworks, no API keys — it runs on **GitHub Pages** (or any static
  host, or even `file://`).

> **Live demo:** [kanlerxz87-cyber.github.io/Alert5](https://kanlerxz87-cyber.github.io/Alert5/)
> (Restored 2026-11-20: the original author's repo linked here previously is
> no longer on GitHub — see `flagged.html` items F-002/F-008 and
> `COORDINATION.md` for the restoration log and flagged irregularities.)

---

## How it works — reverse-engineering MLB.com Gameday

MLB.com's Gameday is a JavaScript app. It reads JSON from a public, undocumented API at
**`https://statsapi.mlb.com/api/v1/`** (plus `v1.1` for live game feeds) and pulls
images (logos, headshots) from **`mlbstatic.com`**. No login, no API key, and the API
sends CORS headers, so any static page can call it directly from the browser.

This project does the same thing with its own front end. The API calls we make:

| What we need | Endpoint | Official source |
| --- | --- | --- |
| Games for a date (scoreboard cards, probables, live count) | `GET /api/v1/schedule?sportId=1&date=YYYY-MM-DD&hydrate=probablePitcher,linescore,decisions,review` | [schedule (2026-10-28)](https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=2026-10-28&hydrate=probablePitcher,linescore,decisions,review) |
| **Review status for the whole slate** (Replay Feed's 250ms watcher) | `GET /api/v1/schedule?sportId=1&date=YYYY-MM-DD&fields=dates,games,gamePk,season,status,abstractGameState,codedGameState,detailedState,statusCode,reason,startTimeTBD,abstractGameCode` | [slate status projection](https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=2026-10-28&fields=dates,games,gamePk,season,status,abstractGameState,codedGameState,detailedState,statusCode,reason,startTimeTBD,abstractGameCode) |
| **Review status for one game** (game page's 250ms status watcher, ~150 B) | `GET /api/v1.1/game/{gamePk}/feed/live?fields=gameData,status,abstractGameState,codedGameState,detailedState,statusCode,reason,startTimeTBD,abstractGameCode` | [game status projection](https://statsapi.mlb.com/api/v1.1/game/849799/feed/live?fields=gameData,status,abstractGameState,codedGameState,detailedState,statusCode,reason,startTimeTBD,abstractGameCode) |
| Official game-status registry (source of every review `statusCode` + `reason`) | `GET /api/v1/gameStatus` | [gameStatus registry](https://statsapi.mlb.com/api/v1/gameStatus) |
| Full game state — play-by-play, current at-bat, linescore, box score, decisions, rosters | `GET /api/v1.1/game/{gamePk}/feed/live` | [feed/live v1.1](https://statsapi.mlb.com/api/v1.1/game/849799/feed/live) |
| Fallback feed (older games) | `GET /api/v1/game/{gamePk}/feed/live` | [feed/live v1](https://statsapi.mlb.com/api/v1/game/744932/feed/live) |
| Fallback bundle (if the feed 404s) | `GET /api/v1/game/{gamePk}/playByPlay` + `/boxscore` + `/linescore` | [playByPlay](https://statsapi.mlb.com/api/v1/game/849799/playByPlay) · [boxscore](https://statsapi.mlb.com/api/v1/game/849799/boxscore) · [linescore](https://statsapi.mlb.com/api/v1/game/849799/linescore) |
| Play-by-play + official MGR/ABS challenge counters (all-games Replay Feed scans per game) | `GET /api/v1/game/{gamePk}/playByPlay` + leaf-projected `GET /api/v1.1/game/{gamePk}/feed/live?fields=gameData,review,absChallenges,…` | [playByPlay](https://statsapi.mlb.com/api/v1/game/824638/playByPlay) · [absChallenges](https://statsapi.mlb.com/api/v1.1/game/824638/feed/live?fields=gameData,review,absChallenges,hasChallenges,away,home,used,remaining,usedSuccessful,usedFailed) |
| Team logos | `https://www.mlbstatic.com/team-logos/team-cap-on-dark/{teamId}.svg` | [team logo 119](https://www.mlbstatic.com/team-logos/team-cap-on-dark/119.svg) |
| Player headshots | `https://img.mlbstatic.com/mlb-photos/image/upload/.../v1/people/{playerId}/headshot/67/current` | [headshot 660271](https://img.mlbstatic.com/mlb-photos/image/upload/v1/people/660271/headshot/67/current) |
| Batter / pitcher season inputs for the forecast | `GET /api/v1/people/{playerId}/stats?stats=expectedStatistics,season,statSplits,gameLog&group=hitting&sitCodes=vl,vr&season=YYYY` (same CSV for `group=pitching`). **Note:** the `statcast` stat is rejected with HTTP 400 for `group=hitting` on the live API (verified 2026-08-19), so it is deliberately not requested — xBA comes from `expectedStatistics`. | [people/660271/stats](https://statsapi.mlb.com/api/v1/people/660271/stats?stats=expectedStatistics,season,statSplits,gameLog&group=hitting&sitCodes=vl,vr&season=2026) |
| Career head-to-head for the live forecast | `GET /api/v1/people/{batterId}/stats?stats=vsPlayer&group=hitting&opposingPlayerId={pitcherId}` | [vsPlayer H2H](https://statsapi.mlb.com/api/v1/people/694192/stats?stats=vsPlayer&group=hitting&opposingPlayerId=656876) |

The live feed is the heart of it — one response contains everything Gameday shows:

```
liveData.plays.allPlays[]      → every at-bat: result, description, count, outs,
                                 batter/pitcher matchup, runner movement, pitch events
liveData.plays.currentPlay     → the at-bat happening RIGHT NOW (batter, pitcher, count)
liveData.linescore             → inning state, inning-by-inning runs/hits/errors
liveData.boxscore              → per-player batting & pitching lines, batting order
liveData.decisions             → winning/losing/saving pitcher
gameData.players / teams       → names, positions, records, venue, weather, status
```

The app polls `feed/live` every 500ms while a game is in progress (every 250ms
while a review is in flight, via a lean play-by-play probe that fetches the
full feed only when the review state flips) and only rebuilds the DOM when the
baseball state changes
(count, pitch event, score, inning, play, or review outcome). The heavy box-score
table is lazy-rendered only when its tab is open. Preview and final games use
slower cadences, and polling pauses automatically while the tab is hidden.

## Two-sided hit forecast

The hit percentage is a **transparent, per-plate-appearance estimate** — not an MLB
projection or a betting line. It is built to *discriminate*: great spots and terrible
spots land far apart instead of clustering around the league average. Two numbers are
shown, and they intentionally live in different bands:

- **Per-PA headline ("Hit this PA")** — the chance the batter gets a hit in *this*
  plate appearance. For **real MLB matchups this typically reads 22–30%** (league hit
  rates cluster around `.245`, and real batters/pitchers do too); the model's full
  clamp band is 13–62% per-PA (10–78% with live count), reached only by stacked
  synthetic edges like an overmatched call-up vs an ace (~13%) or an elite hitter on
  a hitter's count vs a weak arm (~50%). A single-PA hit rate can't honestly reach
  80%: even a perfect .400 hitter vs a .150-allowed pitcher resolves to ~55% before
  clamps. (The original `tools/model-calibration-report.mjs` archetype grid was not part of
  the upload — see `flagged.html` F-003/U-2; the shipped model constants are documented in
  `assets/js/props.js`.)
- **"≥1 hit in next N PAs" projection** — the *wide* number, and where the promised
  16–95% spread actually lives. It is `1 − (1 − per-PA)^remaining PAs`, so during a
  live game it naturally reads **50–95%** (the broadcast-style graphic number most
  fans expect). It is shown on the live at-bat card and in the Props & Matchup tab;
  on a **Final game there are no PAs left, so it reads "—"/0%** and the per-PA rate is
  the relevant number. Both are per-batter and per-pitcher.

The model:

1. **Season level (both sides):** the batter's xBA/AVG hit-production signal and the
   pitcher's xBA-allowed/opponent-AVG signal are each regressed toward a `.245` league
   baseline (light regression so a full-season signal can move the forecast by
   ~10-14 points), then compounded in log-odds space — a generalized **log5** (Bill
   James's odds-ratio method), so extreme signals push the estimate toward the
   extremes rather than canceling toward the mean. Total evidence is capped at
   ±1.9 logits from the league prior.
2. **Platoon splits:** each player's real `vs LHP` / `vs RHP` (pitchers: `vs LHB` /
   `vs RHB`) split enters as a shrunken *differential* against their own season rate.
   Without split data, a small flat handedness adjustment is used instead.
3. **Recent form:** the player's game-log window (last ~8 games, strictly before the
   modeled game's date, so a forecast never leaks the game's own result) nudges the
   estimate with a meaningful weight (capped so a single hot/cold week cannot dominate
   the season signal).
4. **Head-to-head:** the career batter/pitcher line is a bounded but real nudge
   (~up to 5.5 pts of weighted signal).
5. **Same-game familiarity:** each repeat plate appearance against the same pitcher
   adds a small times-through-the-order bump (~+0.75 pts/pass, capped at the third look).
6. **Live count:** mid-at-bat, the fresh-count estimate is multiplied in odds space by
   an empirically anchored count factor (3-1 » 0-0 » 0-2); walks are *not* hits, so
   3-ball factors deliberately exclude the walk's value. (The original
   `tools/count-model-derivation.mjs` derivation was not part of the upload — see
   `flagged.html` F-003/U-2; the shipped count factors are documented in `assets/js/props.js`.)

The headline number is the **hit probability for this plate appearance**; the chance
of at least one more hit across the remaining expected plate appearances is shown as a
secondary projection. A **matchup tier** (Elite matchup / Favorable / Neutral / Tough /
Pitcher's edge) and per-driver **adjustment chips** (season, platoon, form, history,
familiarity, count — in percentage points) make every forecast explainable.

If one player has no usable season data, the forecast remains available but labels the
fallback (for example, “Batter input; pitcher baseline fallback”). If neither side has
data, it shows the league baseline instead of pretending the estimate is personalized.
The same cached model powers the live at-bat card, Props & Matchup tab, and PBP chips;
for archived games the request is scoped to the feed's game season.

## Project structure

```
.
├── index.html                 # Scoreboard page (all games for a date; ?date=YYYY-MM-DD)
├── game.html                  # Game page (?gamePk=<id>)
├── reviews.html               # All-games Replay Feed (?date=YYYY-MM-DD; live review feed)
├── 404.html
├── flagged.html               # ⚑ Flagged for Review — irregularities + official source links
├── assets/
│   ├── css/style.css          # Dark Gameday-style theme (responsive)
│   └── js/
│       ├── api.js             # MLB StatsAPI client (fetch, retry, fallbacks, formatters)
│       ├── ui.js              # Shared UI: team logos, colors, count dots, runners diamond
│       ├── reviews.js         # Challenge & replay review parser (Manager, Crew Chief, ABS)
│       ├── reviews-feed.js    # All-games Replay Feed logic (diff helpers + page)
│       ├── scoreboard.js      # Scoreboard page logic
│       ├── feed-log.js        # Per-date feed log: localStorage + optional server.mjs sync/SSE
│       ├── props.js           # Two-sided hit model, stat cache, Props & Matchup tab
│       └── game.js            # Game page logic (live "at bat" module, linescore, box, PBP)
├── server.mjs                 # Optional zero-dependency persistence server (static + feed log)
├── tests/                     # Zero-network checks: link check, jsdom render test, fixtures
├── docs/verification-report.md# Field-by-field verification with official source links
└── COORDINATION.md            # Multi-session task board, claims, merge + deployment record
```

## Run it locally

Run the built-in persistence server (recommended — persists scoring changes and reviews to disk across browsers):

```bash
# Node built-in server (multi-browser persistent logging backend)
node server.mjs

# or any static file server
python3 -m http.server 8000
# or
npx serve .
```

Then open <http://localhost:8000>. You can also open `index.html` directly in a browser
(`file://` works — the app uses plain scripts, no modules).

To run the checks that ship with this repository (no network needed):

```bash
node tests/link-check.mjs                # every local href/src/url() in the site resolves
node tests/jsdom-render-test.mjs         # end-to-end render of the real pages (needs jsdom)
npm install --no-save jsdom              # ...one-time dev dependency for the test above only
node tests/jsdom-render-test.mjs --live  # same test, answering the pages from the live StatsAPI
node server.mjs                          # optional persistence backend for the feed log
```

The original repository also listed 15 `tools/*.mjs` scripts and `docs/*` notes; those files were
never uploaded and are not reproducible, so they are not claimed here — see
[`flagged.html`](flagged.html) F-003.

Every entry tracked (challenges, reviews, scoring-pending rulings, scoring
changes) is persistent across the website:
- **Across browsers & sessions**: saved to the backend disk store (`data/feed-log-<date>.json`)
  via `POST /api/feed-log` and cached in `localStorage`, so opening the website on
  another browser immediately restores all tracked entries and baselines. Every accepted
  write is also pushed to the other open pages over
  `GET /api/feed-log/stream?date=<date>` (server-sent events, ~3s reconnect hint,
  20s heartbeat), so a challenge, review, pending ruling or scoring change recorded in
  one browser (a Replay Feed must be open somewhere — it is the only writer) shows up
  in the others as soon as that write lands, instead of on their next poll; the
  periodic pull remains the fallback when the stream is unavailable (static
  hosting, no `EventSource`, blocked connection).
- **Across the website**:
  - `reviews.html`: renders the All feed and dedicated ✏️ Scoring Changes tab.
  - `game.html`: dedicated **Challenges & Reviews** tab displays official scoring changes
    with full initial-call-to-final-ruling breakdown, and updates the tab badge.
  - `index.html`: scoreboard cards display the `✏️ N Scoring Change(s)` indicator.
  (the original `docs/scoring-changes.md` was not uploaded — see F-003 on [`flagged.html`](flagged.html)).

To *see and hear* the ⚠️ Runs at Risk surfaces without waiting for a live review,
run the offline, fixture-driven render test — it stubs the API with the exact same
deterministic payload the pages use and makes no network request:

```bash
npm install --no-save jsdom     # dev-only, one time
node tests/jsdom-render-test.mjs
# (the original tools/run-risk-preview.html was not part of the upload — see
#  flagged.html F-003; the render test above is the shipped equivalent)
```

## Deploy to GitHub Pages

The site is 100% static (repo root = site root), so GitHub Pages serves it directly
with no build step and no workflow permissions:

1. **Push this project to GitHub** (any repo — e.g. `yourname/MLB-Live-PBP`).
2. In the repo: **Settings → Pages → Source → "Deploy from a branch"** → branch
   `main` → folder `/ (root)` → **Save**.
3. Your site is live at **`https://<your-username>.github.io/<repo-name>/`** —
   e.g. `https://buffedlizard55-lab.github.io/MLB-Live-PBP/`. Every push to `main`
   republishes it automatically (takes ~1 minute).

### Optional: Actions-based deployment & CI smoke test

The repo's Pages setup doesn't require Actions. If you'd rather deploy via GitHub
Actions (and/or run the nightly API smoke test), ready-to-use workflow files are in
`docs/workflows/` *(not part of the upload — create `.github/workflows/` yourself if you want Actions)*:

- `pages.yml` — deploys to Pages on every push to `main` (requires the repo setting
  **Pages → Source → "GitHub Actions"** instead of branch deployment).
- `smoke.yml` — runs the deterministic two-sided model checks and a nightly
  check that the upstream MLB StatsAPI still matches our parsers; run it anytime
  from **Actions** with "Run workflow".

To use them, copy the file contents into `.github/workflows/` in the repo (the GitHub
web UI's *Add file* is the easiest way), then go to **Settings → Pages → Source →
GitHub Actions**.

### Customizing

- **Season / league:** `SPORT_ID` in `assets/js/api.js` (1 = MLB). Minor-league IDs
  (11–14) also work.
- **Refresh rate:** `LIVE_POLL_MS`, `REVIEW_POLL_MS`, `PREVIEW_POLL_MS`, and `FINAL_POLL_MS` in
  `assets/js/game.js` (the 250ms in-review probe uses `REVIEW_POLL_MS` against the
  lean `playByPlay` endpoint); `LIVE_POLL_MS` / `REVIEW_POLL_MS` / `IDLE_POLL_MS`
  in `assets/js/scoreboard.js`; `REVIEW_REFRESH_MS` / `LIVE_REFRESH_MS` /
  `LIVE_RELAXED_MS` / `COUNTER_REFRESH_MS` / `HIDDEN_SCAN_MS` and
  `FETCH_CONCURRENCY` in `assets/js/reviews-feed.js`.
- **Request budget:** `BUDGET_PROFILES` and the token bucket in `assets/js/api.js`
  (requests per minute per class, plus the burst). Raising a number there is the
  one change that can turn a fast feed into a blocked IP — see
  [`docs/api-latency-and-terms.md`](docs/api-latency-and-terms.md) before doing it.
- **Alert sound:** `assets/js/alert-sound.js` (`COOLDOWN_MS`, `LENGTH_MS`, the drop
  figure and the bloom). It is shared by all three pages, so a change is heard
  everywhere at once.
- **Team colors:** `TEAM_COLORS` in `assets/js/ui.js`.

## Notes & etiquette

- The MLB StatsAPI is **unofficial and may change without notice**. The client is
  written defensively (fallbacks for every endpoint and missing fields) and the app
  degrades gracefully if a field disappears.
- **Terms & budget:** the binding rules for this data, the request rate of every
  polling surface, and the code paths that enforce them are written down in
  `docs/api-compliance.md` *(not part of the upload — see F-003 on [`flagged.html`](flagged.html))* — including the two clauses
  that pull in different directions (the API's own notice permits "individual,
  non-commercial, non-bulk use"; MLB.com's Terms of Use §1 forbids automated
  collection and any display beyond personal, non-commercial home use) and the
  open question of public deployment. There is no published rate limit for the
  StatsAPI and no written authorization either way.
- Be a good citizen: the app needs **no API key** (the StatsAPI is keyless and
  open-CORS) and it self-limits — every page pauses when the tab is hidden,
  backs off on preview/final games, bounds post-Final re-scans to a 30-minute
  grace window, and the shared client honours **HTTP 429** with a quiet period
  (the server's own `Retry-After` when it sends one, clamped to 1s–5min;
  otherwise 60 seconds), so it can never hammer a host that has asked it to
  slow down. The live push is server-side (same-origin `EventSource`) and adds
  no requests to MLB's API. The Replay Feed scans live games'
  playByPlay (the light, `fields`-projected endpoint — no boxscore/rosters)
  on a per-game due time, fetches in-review games first, conditionally
  revalidates (an unchanged game answers `304` from the cached body), and only
  re-renders when a review event actually changes. Worst case on a full ~15-game
  slate that is ~20 playByPlay requests/s plus ~8 tiny status sweeps/s — bounded
  by the `pbp` (480/min) and `status` (600/min) token buckets in
  `assets/js/api.js`, so the timer can never outrun the budget, and a spent
  budget skips a cycle silently instead of erroring. Post-Final re-scans are
  2s → 5s → 15s inside a 30-minute grace window. The StatsAPI is pull-only — a
  shorter poll only reduces how long a landed event sits unseen, and the exact
  numbers, the terms-of-use position and the compliance reasoning are in
  [`docs/api-latency-and-terms.md`](docs/api-latency-and-terms.md).
- This is a **personal, non-commercial project** (no ads, no analytics, no data resale — see the
  request budget and the governing terms in `docs/api-compliance.md` *(not part of the upload — see F-003 on [`flagged.html`](flagged.html))*).
  It lives in a public repository and is served from GitHub Pages; that is hosting, not a service
  offered to others.
- Review/challenge data shapes were verified against the live API on 2026-08-19
  (schedule `hydrate=review`, `reviewDetails` codes `MJ`/`MA`/`MF`, and
  `gameData.absChallenges`); see `docs/verification-report.md`.
- Team logos, headshots, and the underlying data are © MLB Advanced Media / MLB and
  their respective owners. This is an unofficial fan project — not affiliated with
  or endorsed by MLB.

## License

[MIT](LICENSE)
