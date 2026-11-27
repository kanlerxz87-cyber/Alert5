# Request budget & API compliance

This is the binding description of every request the site makes to the MLB
StatsAPI, why each one exists, and which clause of the terms governs it. It is
written to be checkable: each number below is either a constant in the source
(the file and symbol are named) or a measurement recorded in this repository.

Last verified: 2026-11-27.

---

## 1. The rules this app is written against

Two published statements pull in different directions, and both are respected.

| Source | What it says | How this app answers it |
| --- | --- | --- |
| The StatsAPI's own notice on `statsapi.mlb.com` | The API is provided for "individual, non-commercial, non-bulk use". | One person's browser polls it; there is no crawler, no bulk export, no redistribution, no server-side mirror of MLB data, no analytics, no ads. |
| MLB.com Terms of Use, §1 | Forbids automated collection and any display beyond personal, non-commercial home use. | The site is a personal project served from GitHub Pages. It is not offered as a service to others, has no accounts, and stores nothing on a server that anyone else reads. |
| MLB.com Terms of Use, §1 (load) | Forbids placing an unreasonable load on MLB infrastructure. | Section 3 below is the budget; every cadence is bounded, and the ceiling is ~150 requests/s in a pathological worst case, with typical full-slate load around 7 req/s. |
| HTTP semantics | `429 Too Many Requests` and `Retry-After`. | The shared client honours both: it enters a quiet window (`Retry-After` when sent, clamped 1 s–5 min; otherwise 60 s) during which no request is issued. `MAX_RETRIES` and a 15 s timeout prevent a stuck socket from becoming a retry storm. |

There is **no published numeric rate limit** for the StatsAPI, and no written
authorisation for this use either. The app therefore treats the absence of a
limit as a reason to be conservative, not permissive.

The API is **pull-only**: nothing can be pushed to a browser before MLB
publishes it. "Fastest possible" therefore means *the shortest honest polling
interval plus one round trip*, never "instant".

---

## 2. What is never done

- No request is made to an endpoint that is not listed in section 3.
- No `boxscore`, `roster`, `people`, `venues` or `teams` endpoint is polled on
  the replay feed; those are one-shot loads on the game page only.
- No scraping of HTML pages, no undocumented endpoints, no API keys, no
  credentials, no attempt to defeat an access control (the `docs.statsapi.mlb.com`
  portal is behind Okta and is not touched).
- No `diffPatch` usage: it ignores `startTimecode` and `fields`, so it would
  transfer the whole document for no benefit (verified 2026-11-27).
- No request while the tab is hidden: every loop checks `document.hidden` and
  suspends.
- No request storm after a failure: 429 enters a quiet window, and two failed
  probes on a game drop that game to a direct capture rather than retrying the
  probe tightly.

---

## 3. The budget, surface by surface

All figures are per browser tab. "Projected" means the request carries the
`fields=` projection, which is what keeps the payloads small.

### Replay feed (`reviews.html`) — the all-games surface

| Loop | Constant | Interval | Payload | Purpose |
| --- | --- | --- | --- | --- |
| Live-state capture | `CAPTURE_BURST_MS` / `CAPTURE_HOT_MS` | 250 ms / 150 ms while a review is open | ~1.7 KB projected (`STATE_FIELDS`) | The fast path. Used while a game is visibly moving, while it is in a review, and for the first capture. |
| Change probe | `PROBE_MS` / `PROBE_MS_HOT` | 250 ms / 150 ms | ~150 B (`PROBE_FIELDS`) | Used once a game has gone quiet; only a moved `metaData.timeStamp` triggers a capture. |
| Slate status sweep | `STATUS_SWEEP_MS` | 125 ms | `schedule?hydrate=game(status)` — one request for the whole slate | Catches a review/status code change on any game without capturing any of them. |
| Play-log seed | `PLAYLOG_SWEEP_MS` | once per game, then every 3 min | ~16 KB projected (`FEED_FIELDS`) | Establishes the official-scoring baseline and lets a reclassification be diffed. Shortened to 4 s while a ruling is pending or a review is open (`PLAYLOG_PENDING_MS`), never closer than 2.5 s (`PLAYLOG_MIN_GAP_MS`). |
| Slate refresh | `SLATE_MS` / `SLATE_MS_IDLE` | 5 s / 30 s | same sweep | Keeps the game list current during the day. |

**Measured payloads** (recorded in `tests/fixtures/feed-824638-capture.json`
and its `_provenance` block): the same 7th-inning snapshot of game 824638 on
2026-08-28 costs **~16.5 KB** as a whole feed and **~1.7 KB** as a projected
state capture. The 1.7 KB figure is the one that matters: it is why the fast
path can run at 250 ms without moving megabytes.

**Worst case, full ~15-game slate with every game live and moving:** 15 games ×
4 captures/s ≈ 60 captures/s plus 8 status sweeps/s ≈ **68 req/s**, at
~1.7 KB each ≈ 115 KB/s. That is the ceiling a single tab can reach, only while
all fifteen games are actually playing, and only for the seconds in which each
game is moving.

**Typical load:** most games are quiet for most of the day, so the probe path
(~150 B) dominates: ~15 games × 4 probes/s ≈ 60 probes/s ≈ 9 KB/s, plus a
capture only when MLB's own clock moves.

**A finished game** is re-read on a decaying schedule inside a 30-minute grace
(`FINAL_GRACE_MS`), then never again: ~70 requests per game, bounded.

### Game page (`game.html`)

One `feed/live` (projected) every `POLL_MS` while the game is live, plus a
single `boxscore` / `people` load per game. No polling continues after `Final`
beyond the same 30-minute grace.

### Scoreboard (`index.html`) and props

One `schedule` per date change, and one `gameStatus` sweep per refresh. Props
load `people/{id}/stats` once per player per page view; that response is cached
for the tab's lifetime and the fetch is deduplicated across players.

---

## 4. Why the fast path does not need the play log

The historical play log is the largest part of a feed (15 KB of 16.5 KB in the
measured snapshot). Everything the alert layer must notice is in the small
projection:

- the official clock (`metaData.timeStamp`),
- the running score, count, outs, bases, batter, pitcher, on-deck and in-hole,
- `statusCode` — `M*`, `N*` and `IH` are exactly how the API reports a
  challenge/review in progress,
- `currentPlay.about.startTime` / `endTime` — the current at-bat's own official
  start and end, which is how a review is timed to the second.

The play log is pulled separately, on its own slow cadence, for the two things
that genuinely need history: review rows and the official-scoring diff. If a
play-log read fails, the state capture and its alerts are unaffected.

---

## 5. Enforcing code, by name

| Rule | Where |
| --- | --- |
| No request while hidden | `document.hidden` guard in `captureTick`, `scan`, `sweep` (`assets/js/reviews-feed.js`) |
| 429 quiet window, `Retry-After` | `getJSON` / quiet-window logic (`assets/js/api.js`) |
| 15 s timeout, bounded retries | `getJSON` (`assets/js/api.js`) |
| Bounded concurrency | `FETCH_CONCURRENCY` + `runLimited` (`assets/js/reviews-feed.js`) |
| One capture in flight per game | `state.capturing[gamePk]` guard (`assets/js/reviews-feed.js`) |
| Probe floor / capture floor | `PROBE_MS`, `PROBE_MS_HOT`, `CAPTURE_FLOOR_MS`, `CAPTURE_FLOOR_HOT_MS` |
| Play-log floor | `PLAYLOG_MIN_GAP_MS`, `PLAYLOG_SWEEP_MS`, `PLAYLOG_PENDING_MS` |
| Post-Final bound | `FINAL_GRACE_MS` + `finalGraceDelay` |
| Hidden-tab pause | `visibilitychange` handler (`assets/js/reviews-feed.js`) |

Every one of these constants is exported on `ReplayFeed` so a test can assert
the budget instead of trusting the comment.

---

## 6. If MLB changes the rules

The honest fallback is to slow the fast path down, not to work around it. The
cadences are single constants (`PROBE_MS`, `CAPTURE_BURST_MS`,
`STATUS_SWEEP_MS`, `PLAYLOG_SWEEP_MS`), so raising the floor is a one-line
change, and the feed's own latency chip reports what was actually lost. If the
API's terms are read as forbidding this use outright, the app is designed to
degrade to manual refresh with no other changes.
