# Copy verification — Alert5 ← LIVPBP

Verification performed 2026-11-25 (UTC) for the copy of the reference site
[`LIVPBP/reviews.html?date=2026-08-26`](https://snapquast73-boop.github.io/LIVPBP/reviews.html?date=2026-08-26).
Every row below links the exact official source checked. MLB StatsAPI is a live
service: values in the game feeds are the values returned when fetched on that
date. Where an official source does not publish a value, the cell is blank and
the item is flagged, never filled in or inferred.

## 1. Copy provenance

| # | Item checked | Value / result | Official source |
| --- | --- | --- | --- |
| P-1 | Upstream repository that serves the reference site | `snapquast73-boop/LIVPBP`, default branch `main`, public, Pages enabled | [GitHub API repository](https://api.github.com/repos/snapquast73-boop/LIVPBP) · [repository](https://github.com/snapquast73-boop/LIVPBP) |
| P-2 | Upstream file tree copied | 35 files: 3 HTML pages, `404.html`, `flagged.html`, 8 JS files, 1 CSS file, docs, audit, tests, tools, workflows, server, license | [GitHub API recursive tree](https://api.github.com/repos/snapquast73-boop/LIVPBP/git/trees/main?recursive=1) |
| P-3 | Licence permitting the copy | MIT | [LICENSE](https://github.com/snapquast73-boop/LIVPBP/blob/main/LICENSE) |
| P-4 | This repo's Pages publishing source | `https://kanlerxz87-cyber.github.io/Alert5/`, branch `main`, path `/` | [GitHub API Pages config](https://api.github.com/repos/kanlerxz87-cyber/Alert5/pages) |

## 2. Reference feed rows, checked field by field

The reference page showed three review entries. Each row below was checked
against the official game feed and the official club registry. "Before review"
is blank because the feed itself marks those observations as not observed —
the page was opened after the rulings.

| # | Reference entry | Official values checked | Official source(s) |
| --- | --- | --- | --- |
| V-1 | `823096:36:p:MF` — PHI @ SEA, Bot 5, challenged by Seattle | `allPlays[36]`: inning 5, bottom; `reviewDetails` = `{reviewType:"MF", challengeTeamId:136, isOverturned:false, inProgress:false}`; description "Mariners challenged (play at 1st), call on the field was upheld: J.P. Crawford grounds out sharply, shortstop Trea Turner to first baseman Alec Bohm."; matchup J.P. Crawford vs Jesús Luzardo; `awayScore:6`, `homeScore:0`. Team id 136 = SEA, 143 = PHI. `gameData.review.home` = `{used:1, remaining:0}` → 0 manager challenges left, 1 used. Before-review score: **not published by MLB; left blank / "not observed"**. | [playByPlay (review details + score)](https://statsapi.mlb.com/api/v1/game/823096/playByPlay?fields=allPlays,atBatIndex,about,result,awayScore,homeScore,description,reviewDetails,reviewType,challengeTeamId,isOverturned,inProgress) · [matchup](https://statsapi.mlb.com/api/v1/game/823096/playByPlay?fields=allPlays,atBatIndex,result,description,matchup,batter,pitcher,id,fullName) · [feed/live counters](https://statsapi.mlb.com/api/v1.1/game/823096/feed/live?fields=gameData,review,absChallenges,hasChallenges,away,home,used,remaining,usedSuccessful,usedFailed) · [team registry](https://statsapi.mlb.com/api/v1/teams?sportId=1&fields=teams,id,name,abbreviation,teamName) |
| V-2 | `823180:57:p:MA` — CIN @ SF, Top 7, challenged by San Francisco | `allPlays[57]`: inning 7, top; `reviewDetails` = `{reviewType:"MA", challengeTeamId:137, isOverturned:false, inProgress:false}`; description "Giants challenged (tag play), call on the field was upheld: Sal Stewart out on a sacrifice fly to center fielder Jonah Cox. Ke'Bryan Hayes scores. Héctor Rodríguez to 3rd. Elly De La Cruz to 2nd."; matchup Sal Stewart vs Ryan Walker; `awayScore:3`, `homeScore:6`. Team id 137 = SF, 113 = CIN. `gameData.review.home` = `{used:1, remaining:0}` → SF 0 manager challenges left, 1 used. 1 run at risk is consistent with the credited scoring movement in the reviewed play. Before-review score: **not published; blank**. | [playByPlay (review details + score)](https://statsapi.mlb.com/api/v1/game/823180/playByPlay?fields=allPlays,atBatIndex,about,result,awayScore,homeScore,description,reviewDetails,reviewType,challengeTeamId,isOverturned,inProgress) · [matchup](https://statsapi.mlb.com/api/v1/game/823180/playByPlay?fields=allPlays,atBatIndex,result,description,matchup,batter,pitcher,id,fullName) · [feed/live counters](https://statsapi.mlb.com/api/v1.1/game/823180/feed/live?fields=gameData,review,absChallenges,hasChallenges,away,home,used,remaining,usedSuccessful,usedFailed) · [team registry](https://statsapi.mlb.com/api/v1/teams?sportId=1&fields=teams,id,name,abbreviation,teamName) |
| V-3 | `823180:84:p:NF` — CIN @ SF, Top 9, umpire review | `allPlays[84]`: inning 9, top; `reviewDetails` = `{reviewType:"NF", isOverturned:false, inProgress:false}` (no `challengeTeamId` — not a manager challenge); description "Umpire reviewed (play at 1st), call on the field was upheld: Umpire reviewed (slide interference), call on the field was upheld: Héctor Rodríguez grounds into a force out, pitcher Reiver Sanmartin to shortstop Christian Koss. Ivan Johnson out at 2nd. Héctor Rodríguez to 1st."; matchup Héctor Rodríguez vs Reiver Sanmartin; `awayScore:10`, `homeScore:9`. Official counters: CIN manager `{used:0, remaining:1}`, ABS `{usedSuccessful:4, usedFailed:0, remaining:2}`; SF manager `{used:1, remaining:0}`, ABS `{usedSuccessful:2, usedFailed:1, remaining:1}` → "CIN 1 MGR · 2 ABS — SF 0 MGR · 1 ABS". Before-review score: **not published; blank**. | [playByPlay (review details + score)](https://statsapi.mlb.com/api/v1/game/823180/playByPlay?fields=allPlays,atBatIndex,about,result,awayScore,homeScore,description,reviewDetails,reviewType,challengeTeamId,isOverturned,inProgress) · [matchup](https://statsapi.mlb.com/api/v1/game/823180/playByPlay?fields=allPlays,atBatIndex,result,description,matchup,batter,pitcher,id,fullName) · [feed/live counters](https://statsapi.mlb.com/api/v1.1/game/823180/feed/live?fields=gameData,review,absChallenges,hasChallenges,away,home,used,remaining,usedSuccessful,usedFailed) |

## 3. Whole-day values shown on the reference page

| # | Reference value | Official result | Official source |
| --- | --- | --- | --- |
| D-1 | "15 game(s) on Wed Aug 26, 2026" | `totalGames: 15`, `dates[0].date: "2026-08-26"` | [schedule 2026-08-26](https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=2026-08-26&hydrate=review,linescore,probablePitcher) |
| D-2 | "0 live" | `totalGamesInProgress: 0` (all sampled games `status.abstractGameState: "Final"`) | [schedule 2026-08-26](https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=2026-08-26&hydrate=review,linescore,probablePitcher) |
| D-3 | "76 tracked entries" | Not a value published by MLB; it is the client's count of review/ABS/scoring events observed across the 15 game feeds. No single official endpoint publishes this aggregate, so no number is asserted from an official source here. **Flagged: F-C2.** | [schedule 2026-08-26](https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=2026-08-26&hydrate=review,linescore,probablePitcher) (games scanned) |
| D-4 | "scanned 3:38:34 PM" | Client-side local clock timestamp; not published by MLB. **Flagged: F-C3.** | [reference page](https://snapquast73-boop.github.io/LIVPBP/reviews.html?date=2026-08-26) |
| D-5 | "2 Challenges / 1 Umpire reviews / 27 ABS challenges / 1 Under review / 1 Runs at risk / 0 Scoring changes" summary tiles | Client-side counts derived from the game feeds; not published as a set by MLB. The underlying event codes are in the official registry. **Flagged: F-C2.** | [gameStatus registry](https://statsapi.mlb.com/api/v1/gameStatus) · [eventTypes registry](https://statsapi.mlb.com/api/v1/eventTypes?fields=eventTypes,code,description) |

## 4. Upcoming game days (the copy is date-driven, not date-hardcoded)

| # | Check | Official result | Official source |
| --- | --- | --- | --- |
| U-1 | Today's slate (2026-11-25) | `totalGames: 0`, `dates: []` — offseason empty-state is correct | [schedule 2026-11-25](https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=2026-11-25) |
| U-2 | Example upcoming day (2027-03-25) | `totalGames: 14`, first listed game `gamePk: 853719` CWS @ DET, `statusCode: "S"` (Scheduled) | [schedule 2027-03-25](https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=2027-03-25&hydrate=review,linescore,probablePitcher) |
| U-3 | Scoreboard/replay date comes from `?date=` or the browser's current date, not a fixed date | `todayISO()` uses `new Date()`; `urlDate()` reads `?date=` and validates ISO dates | [`api.js` L323](https://github.com/snapquast73-boop/LIVPBP/blob/main/assets/js/api.js#L323) · [`reviews-feed.js` L97–L121](https://github.com/snapquast73-boop/LIVPBP/blob/main/assets/js/reviews-feed.js#L97-L121) |

## 5. Implementation line checks (first-party source = authoritative for code behaviour)

| # | File / lines | What the code does | Source |
| --- | --- | --- | --- |
| C-1 | `assets/js/api.js` L18, L163–L185, L206–L215, L252–L281 | Single API root `https://statsapi.mlb.com/api`; schedule, range, feed/live (v1.1 with v1 fallback), lean game status, and gameStatus registry helpers | [`api.js`](https://github.com/snapquast73-boop/LIVPBP/blob/main/assets/js/api.js) · [MLB StatsAPI root](https://statsapi.mlb.com/api) |
| C-2 | `assets/js/reviews.js` L275–L365, L575–L589, L648–L660 | Review type read from `reviewDetails.reviewType`; possible score derived only from runs credited to the reviewed event; official manager/ABS counters read as-is | [`reviews.js`](https://github.com/snapquast73-boop/LIVPBP/blob/main/assets/js/reviews.js) · [gameStatus registry](https://statsapi.mlb.com/api/v1/gameStatus) · [feed/live counters](https://statsapi.mlb.com/api/v1.1/game/823180/feed/live?fields=gameData,review,absChallenges,hasChallenges,away,home,used,remaining,usedSuccessful,usedFailed) |
| C-3 | `assets/js/reviews-feed.js` L32–L36, L714–L748, L763–L773 | Requests play-by-play with `reviewDetails`/`runners`/`pitchNumber` fields; renders Before/Possible/Actual score lines, "not observed" when absent, and official counter lines | [`reviews-feed.js`](https://github.com/snapquast73-boop/LIVPBP/blob/main/assets/js/reviews-feed.js) · [playByPlay](https://statsapi.mlb.com/api/v1/game/823180/playByPlay?fields=allPlays,about,atBatIndex,playEvents,reviewDetails,runners,isPitch,pitchNumber) |
| C-4 | `assets/js/ui.js` L16–L25 | Club abbreviation map and MLBstatic image hosts | [`ui.js`](https://github.com/snapquast73-boop/LIVPBP/blob/main/assets/js/ui.js) · [team registry](https://statsapi.mlb.com/api/v1/teams?sportId=1&fields=teams,id,name,abbreviation,teamName) |
| C-5 | `assets/js/feed-log.js` L193–L246 | On `*.github.io` the optional server log is disabled and the browser-local log is used; the optional backend is `server.mjs` | [`feed-log.js`](https://github.com/snapquast73-boop/LIVPBP/blob/main/assets/js/feed-log.js) · [`server.mjs`](https://github.com/snapquast73-boop/LIVPBP/blob/main/server.mjs) |
| C-6 | `404.html` L10, `package.json` L6, `tests/jsdom-render-test.mjs` L151, `tests/props-provenance-test.mjs` L24, `README.md` | Deployment strings retargeted from `/LIVPBP/` to `/Alert5/`; baseball logic untouched | [local `404.html`](../404.html) · [Pages config](https://api.github.com/repos/kanlerxz87-cyber/Alert5/pages) |

## 6. Checks run on the copy

| # | Check | Result | Source / how to reproduce |
| --- | --- | --- | --- |
| T-1 | `npm ci` | 8 packages installed, 0 vulnerabilities | [`package.json`](../package.json) · [upstream package.json](https://github.com/snapquast73-boop/LIVPBP/blob/main/package.json) · [npm registry](https://registry.npmjs.org/jsdom) |
| T-2 | `node tests/run-all.mjs` | PASS: JS syntax; 54 local references; 8 page-name/DOM bindings; 49 jsdom checks | [`tests/run-all.mjs`](../tests/run-all.mjs) · [upstream test suite](https://github.com/snapquast73-boop/LIVPBP/tree/main/tests) |
| T-3 | `npm test` | 64 passed, 0 failed | [`tools/smoke-test.mjs`](../tools/smoke-test.mjs) · [upstream smoke test](https://github.com/snapquast73-boop/LIVPBP/blob/main/tools/smoke-test.mjs) |
| T-4 | `node tools/restoration-check.mjs` (with local `node server.mjs`) | See integration log in [COORDINATION.md](../COORDINATION.md) | [`tools/restoration-check.mjs`](../tools/restoration-check.mjs) · [upstream tool](https://github.com/snapquast73-boop/LIVPBP/blob/main/tools/restoration-check.mjs) |

## Flagged items published on the site

The independent findings are published in [flagged.html §17](../flagged.html#alert5-independent-check):

- **F-C2** — client-derived aggregates (tracked-entry count, summary-tile
  counts) are not published by MLB as fixed values; no number is asserted here.
- **F-C3** — before-review scores are left blank when they were not observed,
  and the "scanned …" footer time is a local clock reading, not an MLB value.
- **F-C6** — this session's original branch was a duplicate full copy based on
  the empty initial commit; it was not merged. The branch was reset to merged
  `main` before contributing this independent check, so no integrated work was
  overwritten.

All pre-existing irregularities from the upstream verification log remain on
[flagged.html](../flagged.html).
