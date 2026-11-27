# Live game state and the official-scoring log

Session `ec03918b`, 2026-11-27. How the site captures official game state as it happens, how the
separate official-scoring section is persisted, and exactly which StatsAPI fields each record
quotes. Field origins are the ones already verified in
[`docs/statsapi-field-map.md`](statsapi-field-map.md); nothing new is inferred here.

---

## 1. The three modules

| Module | Job | Never does |
| --- | --- | --- |
| [`assets/js/game-state.js`](../assets/js/game-state.js) | snapshot → diff → ledger, plus localStorage/server persistence | render, chime or notify |
| [`assets/js/scoring-log.js`](../assets/js/scoring-log.js) | formats/exports the ledger rows for the ✏️ Official scoring section | write, fetch or alert |
| [`assets/js/alert-sound.js`](../assets/js/alert-sound.js) | the one ~3 s raindrop sound, its mute preference and its test path | decide *when* an event deserves a sound |

The alerting surface (`reviews-feed.js`) reads the first two and calls the third. That direction
of dependency is the guarantee the brief asked for: **the official-scoring log cannot disturb the
alert path, and the alert path cannot lose a log row** — the log is written by a separate code
path into a separate store (`mlbp.state.v1.<date>` locally, `data/game-state-<date>.json` on the
optional server) from the one that holds the feed rows (`mlbp.feedlog.<date>`,
`data/feed-log-<date>.json`).

---

## 2. What a capture contains

One capture per game per cycle, timestamped with `Date.now()` at the moment of ingestion and
stored as both epoch ms (`at`) and ISO-8601 UTC (`capturedAtISO`, second resolution):

| Field | Official source |
| --- | --- |
| `score` (away/home) | `liveData.linescore.teams.{away,home}.runs`, falling back to `gameData.teams.{side}.score` |
| `inning` (number, ordinal, half, isTop) | `liveData.linescore.currentInning`, `currentInningOrdinal`, `inningState`/`inningHalf`, `isTopInning` |
| `count` (balls, strikes, outs) | `liveData.linescore.balls/strikes/outs`, falling back to the at-bat's `count` |
| `pitchCount.total` | counted from `playEvents[].isPitch === true` (null when a capture carried no play-by-play, so a lean probe can never report a fake 0) |
| `batter`, `pitcher` | `liveData.plays.currentPlay.matchup.{batter,pitcher}`, falling back to `linescore.offense.batter` / `offense.pitcher` |
| `bases` (1B/2B/3B runner) | `liveData.linescore.offense.{first,second,third}` |
| `status` (abstract, coded, detailed, code, reason) | `gameData.status.{abstractGameState,codedGameState,detailedState,statusCode,reason}` |
| `inReview` | the official status registry: `statusCode` matching `M*`, `N*` or `IH` (see `docs/verification-report.md` §16) |

**Batter choice.** The last play with `about.isComplete === false` is the at-bat in progress and is
preferred; `currentPlay` can lag the play list by one pitch (observed on the shipped fixture,
where `currentPlay` is at-bat 44 while play 46 is the latest). `currentPlay` is the fallback when
the projection omits `isComplete`.

**Team names and score fallback.** The play-by-play projection carries no `gameData`, so a
capture made from it builds the smallest official-shaped wrapper from the schedule row
(`gameData.status`, `gameData.teams`, `linescore`) — copied, never invented. The row records which
combination produced it (`source: "playByPlay + schedule"` vs `"feed/live + playByPlay"`).

---

## 3. Diffing: before and after, in MLB's words

`GameState.diff(prev, next)` returns one row per changed field, each with `before`, `after` and a
sentence built from both (`Score: SEA 3 – MIN 4 → SEA 4 – MIN 4`,
`Status: Manager challenge: Tag play → Umpire review: Home run`). Fields compared: score, status
wording, status code, inning, outs, count, pitch count, batter, pitcher, runners, review state,
completed-play count.

The **first** capture of a game produces no rows: there is nothing to compare against, and
inventing a "before" would be inference. A row that says a value changed always contains the two
observed values.

Transitions are appended to the bucket (`transitions`, newest first, capped at 600) and the newest
12 per game are folded into the main Replay Feed as 📡 rows. That projection is limited to the
fields an operator acts on — score, outs, review state and official status
(`FEED_STATE_FIELDS`) — because the count and the batter change several times per at-bat; every
transition, including those, is listed in the 📡 Game State tab.

---

## 4. The official-scoring ledger

Two record kinds, keyed `gamePk:kind:atBatIndex:basis` so re-observing the same situation merges
(keeps the first-seen wording, advances `lastSeen`, appends to `history`) instead of duplicating.

### `pending` — an at-bat that has not been scored yet

Detected from the API's own event-type registry: `os_ruling_pending_primary` /
`os_ruling_pending_prior`, description **"Official Scorer Ruling Pending"**
(<https://statsapi.mlb.com/api/v1/eventTypes>). The row stores the placeholder event type and
description as observed (`before`), the inning, the batter and pitcher, the official score, the
source URL, and `state: "pending"`.

When MLB later publishes the ruling, the record is **updated, not deleted**: `state` becomes
`"resolved"`, and `resolved` holds the official wording that replaced the placeholder
(`eventType`, `description`, `isOut`, `rbi`, `outs`, score). The section therefore shows both the
pending state and what it became.

A pending ruling decides how a play is *charged* (hit vs error vs fielder's choice); it does not
remove a run. That is stated in the section footer and was already the site's published position.

### `scoring_change` — the official scorer reclassified a play

The payload carries no change marker, so the change is detected by diffing each completed play's
official classification between polls (`Reviews.snapshotPlays` / `Reviews.diffSnapshots`):

| Field | Source |
| --- | --- |
| `eventType` | `result.eventType` |
| `description` | `result.description` |
| `isOut` | `result.isOut` |
| `rbi` | `result.rbi` |
| `outs` | `count.outs` |
| score | `result.awayScore` / `result.homeScore` |
| errors | `runners[].details.eventType` containing "error" |

**Completion rule.** `about.isComplete === true` is preferred. Some official play-by-play
projections omit `isComplete` on finished plays; a play that carries an official `result.eventType`
and is not the last (in-progress) play is treated as completed, otherwise the reclassification
detector would be blind to exactly the plays it exists for. The rule lives in
`Reviews.isCompletedPlay` and is covered by the smoke suite.

Both sides are stored verbatim (`before` = the first observed call, `after` = the reclassified
call), together with the official score after the play and an attribution note. A change is only
recorded when its initial call was observed before the change landed — the site never
reconstructs a "before" it did not see.

Payload edits that do not reclassify (description/RBI/score only) and plays that vanish from the
payload are still flagged as irregularities on the feed, never corrected or hidden.

---

## 5. Persistence

| Layer | Key / route | Cap |
| --- | --- | --- |
| Browser | `localStorage["mlbp.state.v1.<YYYY-MM-DD>"]` | 10 dates, 400 snapshots/game, 800 ledger rows, 600 transitions; shed history (snapshots, then transitions) if storage fills — ledger rows are shed last |
| Optional server (`server.mjs`) | `GET`/`POST /api/game-state?date=<date>`, file `data/game-state-<date>.json` | merges by ledger key and by `gamePk`+`at`+`field` for transitions |

Both merges are idempotent and union-preserving: a row already on one side is never dropped, a
resolved state never regresses to pending, and the newest baseline per game wins. The client
flushes the bucket on `pagehide`/`beforeunload` and every 1.2 s while active, so a refresh
re-reads the ledger and the per-game baselines before the first scan runs.

On GitHub Pages there is no `server.mjs`, so the store is per-browser; the section footer says
"this browser's localStorage" in that case rather than implying a shared store.

---

## 6. Exports

`Export CSV` / `Export JSON` write every logged row: first/last seen (UTC), kind, basis, gamePk,
matchup, inning, at-bat index, batter, pitcher, the official before/after event type,
description, RBI and out flag, state, score and the source URL. CSV quotes every field so a
description containing commas or quotes round-trips into a spreadsheet unchanged.

---

## 7. Tests

| Check | Command |
| --- | --- |
| Snapshot/diff/ledger/merge, exports, the alert sound graph, the request budget and 304 revalidation | `node tests/state-log-test.mjs` (26 checks: snapshot/diff, ledger merge + resolve, ring throttle, exports, sound graph, blocked audio, budget, 304, 429) |
| End-to-end UI: state panel, separate scoring panel, reload persistence, alert toggle, latency read-out | `node tools/smoke-test.mjs` section `[13b]` (7 checks) |
| Everything | `npm run test:all` |
