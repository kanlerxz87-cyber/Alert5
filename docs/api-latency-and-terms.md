# Latency, request budget and terms of use

Audience: whoever operates this site and whoever audits it. Every number below is produced by
code in this repository, and every external rule is linked to the source it came from. Nothing
here is a measured MLB response time — the StatsAPI does not publish one.

Session `ec03918b`, 2026-11-27.

---

## 1. What "as fast as possible" means here

The StatsAPI is **pull-only**: there is no push, no webhook and no streaming endpoint. A shorter
poll only reduces *how long a landed event sits unseen*; it cannot make MLB publish sooner. So
"fastest" is bounded by two things, and both are enforced in code:

| Bound | Where it is enforced | Why it matters |
| --- | --- | --- |
| The host's tolerance (requests per minute) | `BUDGET_PROFILES` + `take()` in [`assets/js/api.js`](../assets/js/api.js) | A page that polls faster than the host allows gets throttled, which is *slower* in practice and is the opposite of what the brief asks for |
| The user's tab (backgrounded, throttled timers) | visibility handling in [`reviews-feed.js`](../assets/js/reviews-feed.js) | A hidden tab cannot render; it now keeps a slow heartbeat so the first paint on return is current |

Everything else is tuned to remove *waiting*, not to remove the budget:

1. **The event is detected on the leanest endpoint that carries it.** `GET /api/v1/game/{pk}/playByPlay`
   with a `fields` projection carries `reviewDetails`, `reviewDetails.inProgress`, the
   `os_ruling_pending_*` event types and every play's official `result` — every event the feed
   alerts on. It is a fraction of the size of `/feed/live`, so it completes sooner.
2. **Review state is detected from the official game status, not from play text.** The 125 ms
   slate sweep (`GET /api/v1/schedule?...&fields=…status…`, ~2 KB for the whole day) notices
   `statusCode` flipping to a review code (`M*`, `N*`, `IH`) the moment MLB calls the review,
   before any play description exists. A game that flips during a cycle is fetched immediately,
   out of band, instead of waiting for that cycle to finish.
3. **Conditional requests.** The play-by-play poll sends `If-None-Match` / `If-Modified-Since`
   when the same URL was fetched before; a `304 Not Modified` is answered from the last body
   (`validators` in `api.js`). When nothing has changed the poll costs headers only; when
   something has changed it is delivered on the first request that asks.
4. **Priority, not starvation.** Games under review are fetched **first** in every cycle at
   `REVIEW_REFRESH_MS` (250 ms). Other live games have their own due time
   (`LIVE_REFRESH_MS` 750 ms, relaxing to `LIVE_RELAXED_MS` 1200 ms on a slate of more than eight
   live games), so a 15-game slate slows every game slightly instead of starving the bottom of
   the list.
5. **No wasted hydration.** The challenge counters (manager/ABS) refresh on their own 15 s clock
   (`COUNTER_REFRESH_MS`) from the projected `/feed/live`, instead of on every 250 ms poll.
6. **Post-final rulings are re-scanned, not abandoned.** A finished game is re-read every 2 s for
   two minutes, every 5 s to five minutes, then every 15 s inside a bounded 30-minute window
   (`finalGraceDelay`), which is where the official scorer publishes most reclassifications.
7. **The one request per game per cycle is bounded by the budget, never by the timer.** If a class
   is out of tokens the call is skipped for that cycle and reported as a deferral
   (`DeferredError`, `err.deferred`), not as an error — the UI never shows a red status line for
   the budget doing its job (the count is visible in the latency read-out instead).

### What is *not* claimed

- No latency figure is promised. The read-out under the feed shows the cadence the scheduler is
  actually holding and the remaining budget; it does not claim a round-trip time.
- A browser that is asleep, a laptop lid that is closed, or a suspended tab stops rendering. When
  it wakes, the first cycle re-reads everything that is due (all due times are reset), so the
  operator sees current state immediately. Background audio is not provided.
- MLB publishes when MLB publishes. A review that stands for forty seconds and is never written
  into `reviewDetails` is invisible to every client, including mlb.com's.

---

## 2. The budget, exactly

Defined in `BUDGET_PROFILES` ([`assets/js/api.js`](../assets/js/api.js)). Each class is a token
bucket: `perMinute` tokens refilled continuously, with a burst of a tenth of the ceiling (minimum
four) so a page that has just opened can make its boot calls.

| Class | What it covers | live | idle | dormant |
| --- | --- | --- | --- | --- |
| `status` | lean slate/per-game status projection | 600/min | 120/min | 20/min |
| `pbp` | `playByPlay` — the in-game event feed | 480/min | 60/min | 6/min |
| `feed` | the full `feed/live` hydration (counters) | 120/min | 30/min | 4/min |
| `other` | schedule hydration, registries, people stats | 120/min | 60/min | 10/min |

- **live** — the tab is visible.
- **idle** — entered on HTTP 429 (the host's own ceiling talking), and on a page that has been
  hidden long enough to fall to the dormant profile.
- **dormant** — a hidden tab. It keeps a 3 s heartbeat (`HIDDEN_SCAN_MS`) so returning to the tab
  paints fresh data instead of waiting for a cold cycle.

Worst case for one visible tab on a full 15-game slate: 15 `pbp` requests per cycle ÷ 0.75 s =
**20 req/s** for play-by-play, plus 8 status sweeps/s, plus 1 hydrated schedule poll every 0.5 s —
about **29 req/s, ~1,700 req/min**, which is inside the `pbp` ceiling (8/s) and the `status`
ceiling (10/s). Nothing in the code path can exceed the bucket, because the bucket is charged
before every attempt, retries included.

Retries, timeouts and 429 handling are unchanged from the inherited client and are documented in
the README's "Notes & etiquette" section: request timeout 15 s, one retry on 5xx/timeout, and a
quiet period of the host's `Retry-After` (clamped 1 s–5 min) or 60 s.

---

## 3. Terms of use — what this site relies on, and what it does not do

Two documents pull in different directions; the site is built to satisfy the stricter reading.

| Rule | Source | How this site complies |
| --- | --- | --- |
| StatsAPI is keyless, open-CORS, and its notice permits *individual, non-commercial, non-bulk* use | [statsapi.mlb.com](https://statsapi.mlb.com/api/v1/gameStatus) (the API itself) | One browser polls for one person. The budget above bounds the request rate; no crawler, no server-side harvesting, no redistribution of raw payloads. |
| MLB.com Terms of Use §1 forbids automated collection and any display beyond personal, non-commercial home use | <https://www.mlb.com/official-information/terms-of-use> | The site is a personal, non-commercial project: no ads, no analytics, no data resale, no accounts. It stores only what it needs to replay the feed it already showed (see §4). |
| No published numeric rate limit, and no written authorization either way | <https://www.mlb.com/official-information/terms-of-use> (no rate-limit clause) | Therefore the site self-limits rather than relying on a documented allowance, honours 429 immediately, and drops to the idle profile when the host pushes back. |
| Attribution: data © MLB Advanced Media | <https://www.mlb.com> | Every page footer says this is an unofficial fan project, not affiliated with MLB, and every row links its official endpoint. |

**What the site explicitly does not do:** no scraping of pages, no bypassing of authentication, no
bulk downloads, no background service harvesting feeds on behalf of other users, no server-side
mirroring of MLB content, and no ML-derived or betting use of the data.

Recommended operational posture, if you deploy this publicly:

- Keep it personal and non-commercial, or ask MLB Advanced Media for written permission first.
- Do not raise `BUDGET_PROFILES` to "poll harder". The buckets exist because no rate limit is
  published; raising them trades a small latency win for the risk of an IP-level block.
- Leave the 429 handling alone. It is the only thing standing between a burst and a block.

---

## 4. Where the data goes

| Store | What it holds | Survives refresh | Survives another browser |
| --- | --- | --- | --- |
| `localStorage` `mlbp.feedlog.<date>` | alert rows (reviews, boundary calls, pending rulings, scoring changes) | yes | no |
| `localStorage` `mlbp.state.v1.<date>` | second-stamped game state, transitions, the official-scoring ledger | yes | no |
| `POST /api/feed-log` (server.mjs, optional) | the alert rows | yes | yes |
| `POST /api/game-state` (server.mjs, optional) | the state/ledger bucket | yes | yes |

The two stores are deliberately separate processes and separate files
(`data/feed-log-<date>.json`, `data/game-state-<date>.json`): a failure in one cannot block or
corrupt the other, which is the brief's requirement that the official-scoring log stay apart from
the alert system. On GitHub Pages only `localStorage` exists, and the UI says so
("state kept in this browser") instead of pretending otherwise.

Both stores hold *only* payload fields that were actually observed — official wording, official
codes, official counters — with the endpoint that produced each row linked on the row.
