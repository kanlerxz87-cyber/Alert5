# Copy / verification addendum — MLB Live PBP copy in `kanlerxz87-cyber/Alert5`

Date: 2026-11-25 · Session: `07f0c355` · Branch: `arena/07f0c355-alert5`
Purpose: record exactly what was copied, what was verified for **this repository**, and what remains unverified or flagged.

The short version: this is a byte-for-byte copy of the currently published upstream project except for the site-specific fork notice, the project-site 404 base path, the `package.json` homepage, this addendum, and the root `COORDINATION.md` claim board. No application data, baseball values, replay logic, scoring rules, or review parsing logic were changed.

---

## 1. Source copied

| # | Item | Value from the source, read 2026-11-25 | Official / first-party source | Status |
|---|---|---|---|---|
| C-0 | Upstream repository copied | `snapquast73-boop/LIVPBP` at `5c02527d3c7a56ea66c698cfabff80a407b6dfd3` ("Merge pull request #33"). `git ls-remote origin HEAD` on a fresh clone returned exactly this SHA. | [upstream commit `5c02527`](https://github.com/snapquast73-boop/LIVPBP/commit/5c02527d3c7a56ea66c698cfabff80a407b6dfd3) · [upstream repository](https://github.com/snapquast73-boop/LIVPBP) | Copied |
| C-1 | Upstream license | MIT License, `Copyright (c) 2026 MLB-Live-PBP contributors`; copied unchanged to `LICENSE`. | [upstream LICENSE](https://github.com/snapquast73-boop/LIVPBP/blob/5c02527d3c7a56ea66c698cfabff80a407b6dfd3/LICENSE) | Copied / preserved |
| C-2 | Upstream `.git` metadata | Not copied (this repository has its own history). | Local `git` object model; no upstream working tree is committed except source files. | By design |
| C-3 | Upstream coordination board | Preserved verbatim as [`docs/upstream-COORDINATION-2026-11-25.md`](upstream-COORDINATION-2026-11-25.md); root `COORDINATION.md` is the board for this repository. | [preserved upstream board](https://github.com/snapquast73-boop/LIVPBP/blob/5c02527d3c7a56ea66c698cfabff80a407b6dfd3/COORDINATION.md) | Preserved |
| C-4 | Upstream verification / audit logs | Preserved unchanged: [`docs/verification-report.md`](verification-report.md), [`docs/statsapi-field-map.md`](statsapi-field-map.md), [`audit/`](../audit/), and `flagged.html` sections 1–14. | Those files' inline official links are preserved; see §4 below. | Preserved, **not independently re-verified row-by-row by this session** |

## 2. Files changed relative to the copied upstream tree

Measured with `diff -qr --exclude=.git --exclude=node_modules /tmp/LIVPBP .` after the copy and site-specific edits:

```text
Files /tmp/LIVPBP/404.html and ./404.html differ          # project-site base path: /Alert5/ instead of /LIVPBP/
Files /tmp/LIVPBP/COORDINATION.md and ./COORDINATION.md differ  # root board is this repository's board; upstream board preserved under docs/
Files /tmp/LIVPBP/README.md and ./README.md differ        # fork notice + live-demo link for this repository; upstream text retained
Files /tmp/LIVPBP/package.json and ./package.json differ  # homepage set to this repository's GitHub Pages URL
Only in ./docs: upstream-COORDINATION-2026-11-25.md       # preserved upstream board
```

No `assets/*.js`, `assets/css/style.css`, `server.mjs`, `tests/`, `tools/`, HTML page structure, or MLB parsing logic was edited in this pass.

## 3. What was run and checked on 2026-11-25

| # | Check | Result | Source / command | Status |
|---|---|---|---|---|
| V-1 | Repository + Pages configuration for `kanlerxz87-cyber/Alert5` | Public repo, default branch `main`, `viewerPermission: ADMIN`; Pages: `status: built`, `build_type: legacy`, `source: {branch: main, path: /}`, `html_url: https://kanlerxz87-cyber.github.io/Alert5/`. | `gh repo view` / `gh api repos/kanlerxz87-cyber/Alert5/pages` → [Pages API](https://api.github.com/repos/kanlerxz87-cyber/Alert5/pages) | Verified for repo settings; deploy of this change is recorded in `COORDINATION.md` after merge |
| V-2 | Static-reference / syntax / server contract checker | `node tools/restoration-check.mjs` → **ALL CHECKS PASSED** (including `GET /.git/HEAD` → 403) | Local run in this repo | Passed |
| V-3 | Network-free smoke suite | `npm test` → **64 passed, 0 failed** | [`tools/smoke-test.mjs`](../tools/smoke-test.mjs) | Passed |
| V-4 | Combined syntax + link + contract + jsdom suite | `node tests/run-all.mjs` → syntax OK; **41 local references** OK; **8 contract bindings** OK across 5 pages; **47/47** jsdom checks passed; fixtures are copied from official StatsAPI responses | [`tests/run-all.mjs`](../tests/run-all.mjs) · [`tests/fixtures/`](../tests/fixtures/) | Passed |
| V-5 | Props provenance | `node tests/props-provenance-test.mjs` → **5 passed, 0 failed**; every rendered driver row keeps a clickable `statsapi.mlb.com` source URL | [`tests/props-provenance-test.mjs`](../tests/props-provenance-test.mjs) | Passed |
| V-6 | Separate link check | `node tests/link-check.mjs` → **41 local references** checked; OK | [`tests/link-check.mjs`](../tests/link-check.mjs) | Passed |
| V-7 | Official review-status registry fetched | Parses as JSON; contains the codes the site keys on (e.g. `IH` “Instant Replay”, `MF`/`MA`/… “Manager challenge…”, ABS `MJ`/`NJ`). | [`/api/v1/gameStatus`](https://statsapi.mlb.com/api/v1/gameStatus) | Verified reachable/current on this date |
| V-8 | Official schedule for 2026-11-25 (today in the session) | `totalItems: 0`, `totalGames: 0`, `totalGamesInProgress: 0`, `dates: []` — i.e. an offseason/empty slate, not a broken site. | [`/api/v1/schedule?sportId=1&date=2026-11-25&hydrate=probablePitcher,linescore,decisions,review`](https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=2026-11-25&hydrate=probablePitcher,linescore,decisions,review) | Verified empty slate |
| V-9 | Official schedule for the deep-link/reference game day 2026-08-26 | `totalItems: 15`, `totalGames: 15`, `totalGamesInProgress: 0`. | [`/api/v1/schedule?sportId=1&date=2026-08-26&fields=totalGames,totalItems,totalEvents,totalGamesInProgress,dates.totalGames`](https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=2026-08-26&fields=totalGames,totalItems,totalEvents,totalGamesInProgress,dates.totalGames) | Verified 15 scheduled games |
| V-10 | Deep-link behaviour for upcoming game days | `index.html?date=YYYY-MM-DD` and `reviews.html?date=YYYY-MM-DD` set the page date from the query string; date nav/picker update `?date=`; empty-slate days offer the most recent date with games. Implemented by copied code and covered by suite V-3 §[11]/§[8]/§[9]. | [`assets/js/scoreboard.js`](../assets/js/scoreboard.js) · [`assets/js/reviews-feed.js`](../assets/js/reviews-feed.js) · suite output | Passed by test harness |
| V-11 | Deployed GitHub Pages result | Pending at the moment this file was written; the final merge/deploy/result is recorded in [`COORDINATION.md`](../COORDINATION.md) and is not marked verified here until it happens. | [this repository's Pages](https://kanlerxz87-cyber.github.io/Alert5/) · [Pages API](https://api.github.com/repos/kanlerxz87-cyber/Alert5/pages) | **Unverified until post-merge check** |

## 4. Flagged for review — this copy

These are non-blocking. They are also rendered on [`flagged.html`](../flagged.html) §15.

| # | Item | Confirmed official value | Why flagged / resolution | Official source |
|---|---|---|---|---|
| K-1 | Upstream verification tables (§1–§14 on `flagged.html`; `docs/verification-report.md`) | Blank for this copy | They are the upstream rebuild's evidence, preserved verbatim. This session did **not** re-fetch every historical stat row (game 823109/824466/824638/849799/824960/775296/823243/…) individually; doing so would not make the copied code more correct, and unconfirmed cells remain blank in the preserved logs. Use the inline links for manual review. | [gameStatus](https://statsapi.mlb.com/api/v1/gameStatus) · [verification report](verification-report.md) · [field map](statsapi-field-map.md) |
| K-2 | Original pre-rebuild client source | Blank | Upstream could not recover `buffedlizard55-lab/MLB-Live-PBP` (404); this copy inherits that limitation. The site is a working reconstruction verified against StatsAPI, not a byte-for-byte resurrection of the lost client. | [upstream API 404 check](https://api.github.com/repos/buffedlizard55-lab/MLB-Live-PBP) · [upstream commit tree](https://github.com/snapquast73-boop/LIVPBP/tree/5c02527d3c7a56ea66c698cfabff80a407b6dfd3) |
| K-3 | Upstream tag instruction in retained README | Blank (this repository has no `v1.0.0-stable-checkpoint` tag) | The upstream README's revert instruction references an upstream tag that was not copied into this repository. Do not run it expecting a tag to exist here. | Local `git tag` → empty · [upstream release/tag](https://github.com/snapquast73-boop/LIVPBP/releases/tag/v1.0.0-stable-checkpoint) |
| K-4 | MLB cross-endpoint inconsistency, game 775296 | `errors` = **2** in `/linescore`, **3** in v1.1 `/feed/live` (upstream flag D-1, retained) | No value corrected or guessed. The page uses `feed/live` because it is the single request feeding the page; the discrepancy is upstream MLB's, not this copy's. | [`/api/v1/game/775296/linescore`](https://statsapi.mlb.com/api/v1/game/775296/linescore) · [`/api/v1.1/game/775296/feed/live`](https://statsapi.mlb.com/api/v1.1/game/775296/feed/live) |
| K-5 | Structured ABS `reviewDetails` vs play description, game 824960 | `reviewType: "MJ"`, `challengeTeamId: 110` | Upstream flag AF-7, retained. The app reads structured fields and does not invent missing prose. | [`/api/v1/game/824960/playByPlay?fields=allPlays,about,atBatIndex,inning,halfInning,result,description,playEvents,index,details,reviewDetails,isOverturned,inProgress,reviewType,challengeTeamId`](https://statsapi.mlb.com/api/v1/game/824960/playByPlay?fields=allPlays,about,atBatIndex,inning,halfInning,result,description,playEvents,index,details,reviewDetails,isOverturned,inProgress,reviewType,challengeTeamId) |
| K-6 | Club colours and hit-model constants | Blank | No official MLB source publishes hex colours or the model's tuned constants; upstream flags U-1/U-2/D-4, retained unchanged. Presentation/model tuning only. | [`/api/v1/teams?sportId=1`](https://statsapi.mlb.com/api/v1/teams?sportId=1) · [season stats example](https://statsapi.mlb.com/api/v1/people/660271/stats?stats=expectedStatistics,season,statSplits,gameLog&group=hitting&sitCodes=vl,vr&season=2026) |
| K-7 | Upcoming/live game availability | Blank for future games | The site has no fabricated future schedule. For any date, it reads `GET /api/v1/schedule?sportId=1&date=YYYY-MM-DD&hydrate=probablePitcher,linescore,decisions,review`; if MLB has not published games for that date, the page correctly shows an empty state. Today (2026-11-25) returns `totalGames: 0`. | [2026-11-25 schedule](https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=2026-11-25&hydrate=probablePitcher,linescore,decisions,review) |
| K-8 | GitHub Pages deploy of this merge | Blank until the merge branch is built | Flagged page is published before the deploy is confirmed; the confirmation (or failure and fix loop) is appended to `COORDINATION.md` after merge. | [this repository's Pages](https://kanlerxz87-cyber.github.io/Alert5/) · [Pages API](https://api.github.com/repos/kanlerxz87-cyber/Alert5/pages) |

## 5. Manual-review quick links

- Gameday-style public scoreboard this copy serves: <https://kanlerxz87-cyber.github.io/Alert5/>
- Replay Feed deep link for the reference game day: <https://kanlerxz87-cyber.github.io/Alert5/reviews.html?date=2026-08-26>
- Flagged for Review page: <https://kanlerxz87-cyber.github.io/Alert5/flagged.html>
- Official MLB StatsAPI root used by the app: <https://statsapi.mlb.com/api/v1/gameStatus>
- Official scoring-changes definition: <https://www.mlb.com/official-information/scoring-changes>
- Upstream project this copy is derived from: <https://github.com/snapquast73-boop/LIVPBP>

## 6. Integration decision

Per the session brief, flagged/unverified items do **not** block merge. The merge target is `main`; after merge, GitHub Pages must reach `built` for the merge commit and the live pages must be smoke-checked before `COORDINATION.md` records the result. If the build/deploy check fails, the fix is iterated until it passes; a broken site is not merged.
