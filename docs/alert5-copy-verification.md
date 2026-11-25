# Alert5 copy verification

## Provenance and scope

Copied 2026-11-25 from the [official upstream GitHub repository](https://github.com/snapquast73-boop/LIVPBP/tree/5c02527d3c7a56ea66c698cfabff80a407b6dfd3), commit `5c02527d3c7a56ea66c698cfabff80a407b6dfd3`. The MIT license and attribution are retained. `audit/upstream-manifest.json` records SHA-256 hashes of every source file; `audit/upstream-coordination.md` preserves its task history. The current board is separate.

The source repository is authoritative for the copied software, **not** authoritative for MLB facts. Historical audit documents and fixtures are inherited assertions and were not all independently reverified. A full line-by-line factual certification of every inherited claim has not been completed; no such certification is claimed. No schedules or game results were manually added to production. Pages fetches official MLB data directly at runtime. Unknown values are not newly filled in.

## Sources inspected during this copy

- [Reference replay page](https://snapquast73-boop.github.io/LIVPBP/reviews.html?date=2026-08-26): retrieved and observed functioning, with official per-entry source links. This observation is not proof of every historic event value.
- [Official MLB upcoming schedule](https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=2027-04-01): retrieved 2026-11-25; response reports eight scheduled games. Confirmed published upcoming dates exist; no assumption that all future dates have games.
- The same response exposes `status.startTimeTBD=true` for game 854204 while also publishing `gameDate`; the fork now respects TBD rather than presenting a placeholder time as a confirmed start time.
- [Official MLB live feed endpoint](https://statsapi.mlb.com/api/v1.1/game/823180/feed/live) and [play-by-play endpoint](https://statsapi.mlb.com/api/v1/game/823180/playByPlay) are linked for manual review of reference events; their entire payloads are **not** certified by this report.
- [GitHub Pages documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages) for the static-hosting limitation (manual review link, not retrieved in this session).

## Checks and boundaries

- `npm ci`: installed locked development dependencies, zero reported npm vulnerabilities at installation time.
- `npm run test:all`: syntax, relative local references, DOM contracts, 47 fixture render assertions, five props provenance checks, server round-trip/static access tests, and 64 smoke assertions.
- Runtime data-table source cells are retained in linescore, boxscore and props tables; replay entries link to official play-by-play. Source links identify input data, not an official endorsement of locally computed probabilities.
- Unofficial model percentages, tiers and point adjustments are withheld from presentation and marked unverified. Underlying upstream model code remains for provenance, but is not a verified MLB forecast.
- `npm run test:official`: added live-network integration check. Fetches the upcoming April 1 slate directly from MLB (next calendar year by default), logs every returned matchup with its official source, and renders the real scoreboard and replay-feed scripts at the Alert5 project prefix with actual official responses. No synthetic payload fallback. Runs in GitHub Actions because direct StatsAPI access from the Arena shell is blocked. Logs and check conclusion, rather than fixture tests, establish this check's result.
- Local link checks validate local files; they do not assert that every external URL is reachable or every remote historic statement remains correct.
- Exact future alert delivery latency, live browser sound permissions, API service availability, and background delivery are unverified. Polling requires an open browser tab; this is not a push-notification service.
- GitHub Pages is static: server-side cross-browser persistence requires separately hosting the included optional server. The copied Pages behavior uses localStorage.

All these limitations are also published on [Flagged for Review](../flagged.html#alert5-verification). No inherited factual assertion is promoted to freshly verified merely because a deterministic test passes.
