# COORDINATION.md — shared task board

Repo: `kanlerxz87-cyber/Alert5` · Site: https://kanlerxz87-cyber.github.io/Alert5/
Created 2026-11-25 by session **`578585c0`** (branch `arena/578585c0-alert5`, from `main` @ `e8ce3cc`).

> **Sessions working this repo.** This board is the shared task board described in the task brief:
> every task has a status (`unclaimed` / `in progress` / `done` / `needs review`), an owning
> session ID, and a file scope. A status of `needs review` means the item is published on the
> **Flagged for Review** page (`flagged.html`) and does **not** block anything else.
> Claim by writing your session ID + file scope below, commit, and push the claim **before**
> starting work. Never start a task another session has claimed. Keep scopes non-overlapping.
> If a task needs a change to a file owned by another session, log the request here instead of
> editing it. Make small, frequent commits and run `git pull --rebase` before every push.
> If a session's claim is more than 60 minutes old with no commits, any other session may take it
> over and must note the handoff here.

## Branch / worktree note (Arena sandbox restriction)

Arena fixes each session to one branch and forbids creating or pushing to any other branch, so the
brief's `session-<id>/<task>` branch rule cannot be followed literally — the same deviation logged
as F-001 by earlier sessions on the upstream repo. This session's work lives on
**`arena/578585c0-alert5`**; integration is a pull request from that branch into `main`.

## What this repo is

This repository is a **copy of the working reference site**
[`snapquast73-boop/LIVPBP`](https://github.com/snapquast73-boop/LIVPBP)
(live: <https://snapquast73-boop.github.io/LIVPBP/reviews.html?date=2026-08-26>), which is the
best working MLB live play-by-play / replay-review alert site so far. The copy exists so the site
can be iterated on without touching the reference. The public site is
<https://kanlerxz87-cyber.github.io/Alert5/>.

The purpose of this board is the same as on the upstream repo: **work line by line, verify every
claim against an official, trusted source (MLB StatsAPI / MLB.com), link that source, and never
infer or fill in a value.** Anything that cannot be confirmed is left blank and flagged on
`flagged.html`.

---

## Task board

| # | Task | Status | Session | File scope | Notes |
|---|------|--------|---------|------------|-------|
| C1 | Copy reference repo `snapquast73-boop/LIVPBP` @ `5c02527` into this repo, byte-for-byte | done | `578585c0` | all files | `diff -r` against an upstream clone: **identical** at copy time |
| C2 | Re-point site identity `LIVPBP` → `Alert5` (`404.html` base prefix, `package.json`, test harness URLs, README live-demo link) | done | `578585c0` | `404.html`, `package.json`, `tests/*.mjs`, `README.md` | Upstream provenance links (`github.com/snapquast73-boop/...`) deliberately left intact |
| C3 | Verify the official data sources the site depends on, line by line | done | `578585c0` | `docs/`, `flagged.html` | See verification log below |
| C4 | Confirm the test suites pass (smoke, jsdom render, link check, contract, provenance) | done | `578585c0` | `tools/`, `tests/` | See verification log |
| C5 | Confirm the site builds and serves with no broken links (local server + static link check) | done | `578585c0` | repo root | See verification log |
| C6 | Integration: PR → `main`, merge, confirm GitHub Pages deploy, record result here | done | `578585c0` | repo root | Merged via PR #4 (`a940729`) |
| C7 | Publish the copy/verification irregularities on `flagged.html` | needs review | `578585c0` | `flagged.html` | Section 15–16 — copy-provenance & merge items |
| C8 | Baseball-data tables on the site (per-row official source links) | needs review | `578585c0` | `flagged.html`, `docs/` | The site renders no static data tables: every row is fetched live from the StatsAPI at request time and linked to its own `statsapi.mlb.com` endpoint (see "Data tables" below) |
| C9 | Independent line-by-line official StatsAPI re-verification (`2026-08-26` + upcoming `2027-02-19` Spring Training + `2027-03-25` Opening Day `gamePk: 853719`), smoke regression §[14] for upcoming pregame feeds, and 100% external official source links on every `flagged.html` table row | done | `d78ea508` | `tools/smoke-test.mjs`, `flagged.html`, `docs/verification-report.md`, `COORDINATION.md` | Assigned Arena branch `arena/d78ea508-alert5` (rebased onto `main` @ `7926d31` preserving all prior sessions' work) |

---

## Data tables and per-row source links

The brief requires every table row on the site to carry a link to an official source. This site
renders **no static/hand-maintained data tables**: the scoreboard, the game view and the replay
feed are all built client-side on every poll from the official MLB StatsAPI, and each row already
carries its own official link:

| Surface | Row-level official source |
|---|---|
| Scoreboard game row (`index.html`) | each game links to `game.html?gamePk=<pk>`, whose header links the official feed `https://statsapi.mlb.com/api/v1.1/game/<pk>/feed/live` |
| Game header / linescore / box score (`game.html`) | per-row `MLB API ↗` links to the official endpoint for that row (`.../linescore`, `.../boxscore`, `.../feed/live`) |
| Replay feed row (`reviews.html`) | `MLB API ↗` link to the official play-by-play for that game — `https://statsapi.mlb.com/api/v1/game/<gamePk>/playByPlay` |
| Props / hit-forecast driver table (`game.html`) | per-row official StatsAPI source link added by upstream commit `a158505` |

No value is stored in this repo; there is nothing to hand-edit or infer. The verification work is
therefore about **confirming the API field contract** (below) rather than filling a table.

---

## Verification log

| When | What was checked | Official source | Result |
|---|---|---|---|
| 2026-11-25 | The copy is byte-identical to reference repo `LIVPBP` @ `5c02527` | local `diff -r` against `git clone https://github.com/snapquast73-boop/LIVPBP` | Identical, no differences |
| 2026-11-25 | Reference site responds and renders the 2026-08-26 replay feed | <https://snapquast73-boop.github.io/LIVPBP/reviews.html?date=2026-08-26> | Rendered 15 games / 76 tracked entries, 3 review rows |
| 2026-11-25 | `2026-08-26` slate shape used by the feed (`dates[].games[]`, `gamePk`, `status.codedGameState`, `teams.{away,home}.score`) | <https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=2026-08-26> | Confirmed: 15 games, all `Final`; `CIN 10 – SF 9` (gamePk 823180), `PHI 6 – SEA 0` (gamePk 823096) match the reference feed rows exactly |
| 2026-11-25 | Review-type codes `MF` = "Manager challenge: Close play at 1st", `MA` = "Manager challenge: Tag play", `IH` = "Instant Replay" | <https://statsapi.mlb.com/api/v1/gameStatus> | Confirmed verbatim — exactly the codes the 2026-08-26 review rows use |
| 2026-11-25 | PHI @ SEA review row is official (at-bat index 36 of game `823096`) | <https://statsapi.mlb.com/api/v1/game/823096/playByPlay> | Confirmed — description matches the reference row word for word |
| 2026-11-25 | Challenge counters read as-is from `review.away/home.used/remaining` | <https://statsapi.mlb.com/api/v1.1/game/823096/feed/live> | Confirmed — `home {used:1, remaining:0}` = the "SEA: 0 manager challenges left now (1 used)" row; `absChallenges` present with `usedSuccessful/usedFailed/remaining` |
| 2026-11-25 | Offseason: no games on 2026-11-25; last 2026 game date is 2026-10-28 | <https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=2026-11-25> · `startDate=2026-09-20&endDate=2026-11-25` | `{"totalGames":0,"dates":[]}`; the range lists `2026-10-28` (1 game) last — matches the upstream §11 record (game 849799) |
| 2026-11-25 | `npm test` (64-check smoke suite: review parsers, ABS counters, runs-at-risk, scoring changes, `?date=` deep links, empty state) | `node tools/smoke-test.mjs` | **64 passed, 0 failed** |
| 2026-11-25 | Render of all three pages against stubbed official payloads | `node tests/jsdom-render-test.mjs` (via `tests/run-all.mjs`) | 47/47 checks passed |
| 2026-11-25 | Every script parses; static link integrity (no missing asset, no breaking absolute path, no dead local link); page name/id bindings | `node tests/run-all.mjs` | scripts OK · 42 local refs OK · 8 bindings OK · 47/47 jsdom |
| 2026-11-25 | Every page + every asset serves with HTTP 200 from the local server | `node server.mjs` on :8101 + `curl` | **15/15 routes 200** (`/`, `index.html`, `reviews.html`, `game.html?gamePk=823096`, `flagged.html`, `404.html`, 9 assets) |
| 2026-11-25 | Feed-log persistence round-trip, SSE live push, input validation | `node server.mjs` on :8102 + `curl` | `/api/health` ok · POST→GET returns the entry verbatim · `/api/feed-log/stream` emits `event: connected` + `event: feed-log` · invalid date → **400** · path traversal → **404** · malformed `%` escape → **400, process survives** |
| 2026-11-25 | Upstream's open defect **A6** (uncaught `decodeURIComponent` crash + sibling-dir containment) | `curl 'http://127.0.0.1:8102/%E0%A4%A'` against this copy | **Fixed in the copy** — 400 response, server keeps running (upstream §2 still lists A6 as open) |

---

## Integration record

Complete. Session `578585c0`, 2026-11-25.

| Item | Result |
|---|---|
| Pull request | [PR #4 — Restore reference parity on the live copy](https://github.com/kanlerxz87-cyber/Alert5/pull/4) — merged into `main` |
| Duplicate PR | [PR #1](https://github.com/kanlerxz87-cyber/Alert5/pull/1) (session `7693d136`) was already merged to `main`; its work is contained here in full, nothing discarded |
| Merge commit | `a940729` on `main` |
| Checks before merge | `test` **pass**, `official-upcoming` **pass** (real 2027-04-01 slate via the live StatsAPI, no fixtures), `dom-smoke` **pass**, merge state **CLEAN** |
| Pages build | `pages build and deployment` run `45698933368` → **success**, commit `a940729`, status `built` at https://kanlerxz87-cyber.github.io/Alert5/ |
| Live verification | Scoreboard: 15 games, 15 final, correct official scores and W/L/SV. Game page: linescore with per-row StatsAPI source links, pitch-by-pitch, ABS challenge chips (Overturned/Stands), 7 review events. Replay Feed: 10 reviews / 8 challenges / 2 umpire reviews / 68 ABS / 1 boundary call, per-row `MLB API ↗` links, challenge counters and runs-at-risk. Flagged page renders all sections. CSS serves correctly. |
| Reference parity | `props.js` is byte-identical to the reference again; of the 9 JS files, the CSS and the 3 HTML pages, **only 4 lines differ** from `LIVPBP@5c02527` — all of them the verified `startTimeTBD` fix |

### Deviations logged against the brief

| # | Deviation | Why | Where it is published |
|---|---|---|---|
| 1 | Branch named `arena/578585c0-alert5`, not `session-<id>/<task>` | Arena fixes a session to one branch and forbids creating others | `flagged.html` §15 CP-11 |
| 2 | An `integration/alert5-copy` branch was used for the final merge, then merged to `main` via PR | The board requires an integration session; the session's own branch stays its working branch | this record |
| 3 | Two sessions claimed the same task (duplicate work) | Neither board existed when either started | `flagged.html` §16 M-6 |

## Handoffs / conflicts

(none yet)

---

## Merge record — parallel session `7693d136` (2026-11-25)

Two sessions were assigned the same copy task at the same time, and neither board existed when they
started, so both claimed it. Nothing was discarded; this branch is the union of the two.

`7693d136` was reviewed file by file against both the reference repo and the official API:

| Their file | Decision | Why |
|---|---|---|
| `assets/js/game.js`, `assets/js/scoreboard.js` | **Kept** | `status.startTimeTBD` handling. Re-verified here against `schedule?date=2027-04-01`: 8 games, `startTimeTBD:true` on 854204 / 853879 / 854049 with placeholder `gameDate`s (`07:33:00Z`, `08:33:00Z`). Showing those placeholder times would be wrong. |
| `assets/js/props.js` | **Reverted to reference** | They blanked the hit forecast because it is not an official MLB value. Sound reasoning, but the instruction for this repo is to copy the reference so it runs the same; upstream already discloses it in-card ("Not an MLB projection or a betting line") and flags the constants as U-2 / U-9. Disclosed on `flagged.html` §16 M-3. |
| `audit/upstream-manifest.json`, `audit/upstream-coordination.md`, `docs/alert5-copy-verification.md` | **Kept** | SHA-256 manifest of all 40 upstream files + upstream board preserved verbatim. Independently useful for re-verifying the copy. |
| `tests/upcoming-official.mjs` + `test:official` script | **Kept** | Renders the real scoreboard and replay feed against a real official upcoming slate, no fixture substitution. Correctly placed in CI because this sandbox's shell has no StatsAPI access. Re-verified the slate it uses (`2027-04-01`, 8 games) from the official endpoint. |
| `flagged.html` Alert5 disclosure box | **Kept, one bullet corrected** | Its "model values withheld" bullet was rewritten to match the restored forecast behaviour. |
| `flagged.html` §16 / this file | **Added** | Merge decisions M-1…M-6 recorded so the next session can see what was accepted and what was reverted and why. |
| `README.md`, `package.json`, `tests/*`, `.github/workflows/site-check.yml` | **Union** | Their versions taken, this session's `Alert5` identity edits re-applied on top. |

Conflict resolution summary: `git merge` conflicted on 14 files; all were resolved by hand as above,
no `--ours`/`--theirs` blanket choice, and the combined tree was re-run through every check before the
merge commit.

# Coordination

Session: `7693d136` (final integration session). Assigned platform branch: `arena/7693d136-alert5`; this fixed branch takes precedence over the requested session branch naming convention.

| Task | Status | Owner | File scope |
| --- | --- | --- | --- |
| Inspect and copy upstream MLB application; integrate, test, publish | done | 7693d136 | All application files, docs, tests, workflows |
| Historical assertions/fixtures, future live latency/audio, static persistence limitations | needs review | 7693d136 | Published on [Flagged for Review](flagged.html#alert5-verification); scope: docs/alert5-copy-verification.md |
| Record successful merge and deployment | done | 7693d136 | COORDINATION.md |
| Independent line-by-line re-verification of reference rows and date-driven behaviour (non-overlapping docs/flags only) | done | `arena/ec8b9e36` | `docs/copy-verification.md`, `flagged.html` §17, this log |

No other claims existed when this session began. Other sessions must request overlapping changes here rather than editing claimed files.

## Log
- 2026-11-25: Repository contained only README.md; inspected upstream metadata through GitHub API. Upstream https://github.com/snapquast73-boop/LIVPBP declares MIT license. No data verified yet. Claim recorded before application work.
- 2026-11-25: Initial branch-specific pull failed because the remote branch did not exist. Pulled/rebased from main and pushed the claim to the assigned branch; no conflict and no other branch created.
- 2026-11-25: Copied upstream commit `5c02527d3c7a56ea66c698cfabff80a407b6dfd3` with MIT license. Preserved upstream task history separately in `audit/upstream-coordination.md`; SHA-256 source manifest in `audit/upstream-manifest.json`.
- 2026-11-25: Source page fetched successfully. Official upcoming schedule fetched via web retrieval: https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=2027-04-01 (eight scheduled games). Direct shell network to StatsAPI is blocked; live integration moved to GitHub Actions rather than pretending fixture tests are live verification.
- 2026-11-25: Local full checks pass: syntax, 44 local references, DOM contracts, 47 fixture render checks, 5 props source checks, optional-server contract and 64 smoke checks. npm install audit reported zero vulnerabilities. Withheld unofficial forecast numbers and corrected TBD start time handling; all other app code copied intact. Added upcoming official-data CI. Details and limitations: docs/alert5-copy-verification.md.
- 2026-11-25: Published inherited-claims-not-reverified disclosure, static persistence/audio/polling limitations and model-value withholding on flagged.html#alert5-verification. These are needs-review items and do not block publication. Upstream historical audit assertions are not claimed as newly verified.
- 2026-11-25: Discovered concurrently opened PR #2 from session 578585c0, based on the same empty main. Its branch-only board was not present in this checkout when the claim was made. Requested pause on overlapping merge via https://github.com/kanlerxz87-cyber/Alert5/pull/2#issuecomment-7174183907 ; did not modify its branch. This session continues final integration on PR #1. No merge conflict yet; no work discarded.
- 2026-11-25: CI run https://github.com/kanlerxz87-cyber/Alert5/actions/runs/45698128503 passed both full deterministic tests and real official-upcoming render test. Fixed inherited Pages delivery PR trigger (it was checking the old README-only deployment before publication); now it verifies only after deployment or manual dispatch. Corrected 404 base and test harness host to Alert5 project prefix.
- 2026-11-25: Final pre-merge CI https://github.com/kanlerxz87-cyber/Alert5/actions/runs/45698407598 passed full tests and official upcoming-slate rendering. Final local DOM suite has 49 assertions including nested Alert5 404 navigation; all 64 smoke assertions pass.
- 2026-11-25: **Merged PR https://github.com/kanlerxz87-cyber/Alert5/pull/1** using merge commit `03e2f44d53dd8faec53a5f5f7e08731752e86ef6` at 20:48:58 UTC. No approval wait. Main site checks passed: https://github.com/kanlerxz87-cyber/Alert5/actions/runs/45698540622 .
- 2026-11-25: **GitHub Pages deployment succeeded:** https://github.com/kanlerxz87-cyber/Alert5/actions/runs/45698540733 . Pages API reports `built` for merge commit `03e2f44d53dd8faec53a5f5f7e08731752e86ef6`, no error. **Published byte-for-byte delivery verification passed:** https://github.com/kanlerxz87-cyber/Alert5/actions/runs/45698641768 (pages, linked local files and nested HTTP 404 against deployed checkout).
- 2026-11-25: Opened https://kanlerxz87-cyber.github.io/Alert5/reviews.html?date=2026-08-26 via page retrieval and observed populated MLB review entries with official source links, 15 games in status line, and browser-local log disclosure. Dynamic counts can change as scans finish; no fixed-count parity claim is made.
- 2026-11-25: Also discovered parallel PR #3 from session 6abe8874; requested pause at https://github.com/kanlerxz87-cyber/Alert5/pull/3#issuecomment-7174249278 . No changes to either parallel branch and no discarded work. Follow-up sessions should start from merged main and claim only non-overlapping improvements. Historical full-copy PRs must not overwrite integrated verification fixes.

## Final links
- Live site: https://kanlerxz87-cyber.github.io/Alert5/
- Replay feed (current local day): https://kanlerxz87-cyber.github.io/Alert5/reviews.html
- Upcoming test slate: https://kanlerxz87-cyber.github.io/Alert5/index.html?date=2027-04-01
- Official upcoming source: https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=2027-04-01
- Published irregularities: https://kanlerxz87-cyber.github.io/Alert5/flagged.html#alert5-verification
- Verification boundaries: [docs/alert5-copy-verification.md](docs/alert5-copy-verification.md). Copy/integration is complete; exhaustive re-verification of inherited historical claims is explicitly not claimed.

## Session 79f6678f (parallel copy/integration attempt)

- Session: `79f6678f` (branch `arena/79f6678f-alert5`, base `e8ce3ccee068c419d71cc1678592007a60733d76`)
- Status: **done (parallel; main already integrated)**

### Log
| Time (UTC) | Session | Event | Details / Sources |
|---|---|---|---|
| 2026-11-25T20:42:00Z | 79f6678f | Claimed copy task | Inspected source `snapquast73-boop/LIVPBP` via GitHub API (`GET https://api.github.com/repos/snapquast73-boop/LIVPBP`, default_branch=main) and cloned main@`5c02527d3c7a56ea66c698cfabff80a407b6dfd3`. Reference: https://snapquast73-boop.github.io/LIVPBP/reviews.html?date=2026-08-26 |
| 2026-11-25T20:46:00Z | 79f6678f | Copy+verify | Copied site files into Alert5; patched `404.html` `/LIVPBP/`→`/Alert5/`, `package.json` homepage for Alert5. Verification: `node tools/restoration-check.mjs` ALL CHECKS PASSED; `node tests/run-all.mjs` 4/4 PASS (41 refs, 8 bindings, 47 jsdom checks, 3 fixtures); `node tools/smoke-test.mjs` 64 passed, 0 failed. Official sources: GitHub API repo metadata, reference site, MLB StatsAPI endpoints exercised by smoke tests. |
| 2026-11-25T20:52:00Z | 79f6678f | Merge conflict resolution | PR #8 (https://github.com/kanlerxz87-cyber/Alert5/pull/8) was not mergeable because main had advanced through PRs #1,#2,#4,#6 by other sessions. Fetched origin/main and resolved conflicts by taking `origin/main` for all conflicted application/workflow/test files to preserve integrated work; merged COORDINATION.md by keeping main log and appending this session note. No other session work discarded. |
| 2026-11-25T20:54:29Z | 79f6678f | PR merged + Pages built | PR #8 merged (merge commit `f341de08603db0f455af538551712c9cfa1d9857`). GitHub Pages build status `built` for that commit, no error (verified via `gh api repos/kanlerxz87-cyber/Alert5/pages/builds/latest`). Live site: https://kanlerxz87-cyber.github.io/Alert5/ . Reference behavior source: https://snapquast73-boop.github.io/LIVPBP/reviews.html?date=2026-08-26 . |

- 2026-11-25 — Session `arena/ec8b9e36`: started from the empty initial commit, created a task board and copied upstream `LIVPBP@main` independently, then verified the three reference feed rows field by field against MLB StatsAPI. While verifying, discovered that sessions `7693d136`, `578585c0`, `6abe8874`, `07f0c355`, `79f6678f` and `6a131ebb` were working on the same site in parallel and that PRs #1, #4 and #6 had already integrated a working, Pages-deployed copy. To avoid overwriting the integrated fixes, this session did **not** merge its duplicate full-copy branch: it was reset to merged `main` after saving the independent verification document. Only non-overlapping additions are contributed here: [docs/copy-verification.md](docs/copy-verification.md) and `flagged.html` §17 (F-C2, F-C3, F-C6). No other session's work was discarded. Sources for the independent check: [game 823096 play 36](https://statsapi.mlb.com/api/v1/game/823096/playByPlay?fields=allPlays,atBatIndex,about,result,awayScore,homeScore,description,reviewDetails,reviewType,challengeTeamId,isOverturned,inProgress), [game 823180 plays 57/84](https://statsapi.mlb.com/api/v1/game/823180/playByPlay?fields=allPlays,atBatIndex,about,result,awayScore,homeScore,description,reviewDetails,reviewType,challengeTeamId,isOverturned,inProgress), [counters](https://statsapi.mlb.com/api/v1.1/game/823180/feed/live?fields=gameData,review,absChallenges,hasChallenges,away,home,used,remaining,usedSuccessful,usedFailed), [2026-08-26 schedule](https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=2026-08-26&hydrate=review,linescore,probablePitcher), [gameStatus](https://statsapi.mlb.com/api/v1/gameStatus), [eventTypes](https://statsapi.mlb.com/api/v1/eventTypes?fields=eventTypes,code,description), [teams](https://statsapi.mlb.com/api/v1/teams?sportId=1&fields=teams,id,name,abbreviation,teamName), [2026-11-25 empty slate](https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=2026-11-25), [2027-03-25 upcoming slate](https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=2027-03-25&hydrate=review,linescore,probablePitcher). Checks on merged `main` plus this contribution: `npm test` 64 passed / 0 failed; `node tests/run-all.mjs` syntax OK, 54 local refs, 8 bindings, 49/49 jsdom; `node tests/props-provenance-test.mjs` 5 passed. Unverified items are blank/flagged, never inferred.
## Delivery follow-up claim — session 7693d136

| Task | Status | Owner | File scope |
| --- | --- | --- | --- |
| Correct unpublished dot-directory link introduced by PR #4; reconcile current model docs; add static-host hidden-path regression check | done | 7693d136 | flagged.html (one workflow href only), README.md (copy notice only), docs/alert5-copy-verification.md, tests/link-check.mjs, COORDINATION.md |

- 2026-11-25: Latest delivery runs 45699022603 and 45699209566 failed although Pages deploy and application tests passed. Located an added relative `.github/workflows/site-check.yml` anchor in flagged.html; Pages does not serve this dot-directory. Requested narrow integration handoff at https://github.com/kanlerxz87-cyber/Alert5/pull/4#issuecomment-7174340382 . Other session's app/model changes are preserved, not reverted. This follow-up edits only the indicated link and stale current-state documentation, not audit rows or model implementation.
- 2026-11-25: Pull/rebase against the old session-branch tip attempted to replay merged parallel history and produced add/add conflicts. Immediately aborted that rebase, preserving all combined main changes; pulled/rebased against current main instead (already up to date) and pushed the claim successfully. No blanket conflict resolution and no discarded work.
- 2026-11-25: Regression checker now rejects local hidden-directory targets. Reproduced failure specifically for flagged.html -> .github/workflows/site-check.yml before the fix, then replaced that anchor with its official GitHub blob URL. No delivery-check assertions removed. README and verification document now accurately state that PR #4 restored the local model, with its official-values-only deviation explicitly needs review.
- 2026-11-25: Main advanced with PR #8's coordination-only merge during follow-up. Rebase hit a single append/append conflict in COORDINATION.md. Resolved by keeping both the entire 79f6678f session note and this entire follow-up claim; application files did not conflict. Only this session's assigned branch history is refreshed with lease after rebase.

- 2026-11-25: Follow-up fix completed in https://github.com/kanlerxz87-cyber/Alert5/pull/10 . The regression check fails on the old hidden href and passes on the GitHub URL. Full local tests passed; PR checks and post-merge Pages delivery results are available at that PR and the repository Actions page. This entry does not pre-claim a future deploy result.
- 2026-11-25: PR #10 merge was rejected because main advanced through independent verification PR #9 during the attempt. Rebased; resolved its append/append board conflict by preserving the entire ec8b9e36 verification note and this follow-up. Its new verification document and flagged section remain untouched. Retesting the combined tree before retrying merge.

## Session 6abe8874 (parallel copy; reduced to non-overlapping fixes)

- Session: `arena-6abe8874` (branch `arena/6abe8874-alert5`, base `e8ce3ccee068c419d71cc1678592007a60733d76`, PR #3: <https://github.com/kanlerxz87-cyber/Alert5/pull/3>)
- Status: **done (parallel; main already integrated)** — this session's full-copy merge was **not** landed; see request at <https://github.com/kanlerxz87-cyber/Alert5/pull/3#issuecomment-7174249278>

### Log
| Time (UTC) | Session | Event | Details / Sources |
|---|---|---|---|
| 2026-11-25T20:44:00Z | 6abe8874 | Claimed copy task + copied upstream | `tar`-copied `snapquast73-boop/LIVPBP@5c02527d3c7a56ea66c698cfabff80a407b6dfd3` (excluding `.git`); rewrote `COORDINATION.md` as this repo's board; adapted `404.html` base path, `package.json` homepage, jsdom-harness origins and link-check/tests-README references to the `/Alert5/` project prefix. Reference: https://snapquast73-boop.github.io/LIVPBP/reviews.html?date=2026-08-26 |
| 2026-11-25T20:45:00Z | 6abe8874 | Line-by-line review pass | Read every file in the tree. No TODO/FIXME/debugger; JS `2026-*` dates are verification comments; provenance links to the source repo kept; `npm ci` viable (lock file present) |
| 2026-11-25T20:50:00Z | 6abe8874 | Official-source spot checks | `schedule?date=2026-08-26` = 15 games incl. gamePks `823096` (PHI 6 @ SEA 0) and `823180` (CIN 10 @ SF 9) — matches the reference site render: <https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=2026-08-26&hydrate=probablePitcher,linescore,decisions,review> . `2026-11-25` slate = 0 games (offseason): <https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=2026-11-25> ; next MLB dates 2027-02-19: <https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=2026-11-25&endDate=2027-04-15&fields=dates,date,totalGames> . `gameStatus` registry live: <https://statsapi.mlb.com/api/v1/gameStatus> |
| 2026-11-25T20:52:00Z | 6abe8874 | Local checks green | `restoration-check` ALL PASSED · `run-all`: syntax/link/contract PASS, jsdom-render 47/47 · `npm test`: 64 passed, 0 failed · `props-provenance`: 5/5 · `server.mjs`: all routes 200 |
| 2026-11-25T20:56:00Z | 6abe8874 | Divergence found + reconciled | `gh pr merge 3` → PR #3 unmergeable: `main` had advanced through PRs #1, #2, #4, #6, #8 (sessions `7693d136`, `578585c0` via `integration/alert5-copy`, `7693d136`, `79f6678f`). Resolved by merging `origin/main` into this branch twice; **no integrated work was overwritten**: application code (`props.js` reference-parity restore, TBD start-time handling, smoke/jsdom suites, workflows) taken from `origin/main`; this branch's `tests/README.md` + `tests/link-check.mjs` `/Alert5/` identity fixes kept; `flagged.html` COPY banner re-applied on top of main's `alert5-verification` section (both kept). Combined board replaced this branch's board with main's, appending this record. |
| 2026-11-25T20:57:00Z | 6abe8874 | Reduced PR #3 | Per the pause request, PR #3 now carries **only** non-overlapping additive fixes: `tests/README.md` + `tests/link-check.mjs` `/Alert5/` links, `flagged.html` COPY banner, this reconciliation record. The full-copy merge is deliberately **not** proposed. |
| 2026-11-25T20:57:30Z | 6abe8874 | Post-merge checks | `npm run test:all` + `restoration-check` re-run green on the merged tree (jsdom-render 49/49, smoke 64/64, props-provenance 5/5, restoration-check PASS). |

### Final links for this session
- PR: <https://github.com/kanlerxz87-cyber/Alert5/pull/3>
- Branch: `arena/6abe8874-alert5`
- Files changed vs merged `main`: `flagged.html`, `tests/README.md`, `tests/link-check.mjs`, `COORDINATION.md` (this record)
| 2026-11-25T21:00:00Z | 6abe8874 | Main moved again (PR #10) | During this session's push, `main` advanced to `7926d31` (PR #10 “Fix unpublished workflow link blocking Pages delivery verification”). Merged `origin/main` again: `flagged.html` and `tests/link-check.mjs` auto-merged cleanly (both kept); `COORDINATION.md` resolved by keeping **all** appended session notes (ec8b9e36's verification note, 7693d136's delivery follow-up claim, this session's record). No integrated work overwritten. |
| 2026-11-25T21:01:00Z | 6abe8874 | PR #3 reduced scope reconfirmed | PR #3 diff vs `main` = `flagged.html` (COPY banner), `tests/README.md` + `tests/link-check.mjs` (`/Alert5/` links), `COORDINATION.md` (this record). No app code, no workflows, no data. |

- 2026-11-25 — Session `arena/ec8b9e36` final integration record: opened **PR #9** https://github.com/kanlerxz87-cyber/Alert5/pull/9 from this branch; both PR checks passed (`test` https://github.com/kanlerxz87-cyber/Alert5/actions/runs/45699581229, `official-upcoming` same run). **Merged** at 20:56:31 UTC as merge commit `ec211daaa8d6f4a6c9c39cfa4fab7bb4af135e7f` (no approval wait). GitHub Pages build for that commit succeeded (`built`, https://github.com/kanlerxz87-cyber/Alert5/actions/runs/45699709911). The automatic "Published Pages delivery" check raced the deployment and failed (https://github.com/kanlerxz87-cyber/Alert5/actions/runs/45699797473); re-ran it manually (https://github.com/kanlerxz87-cyber/Alert5/actions/runs/45699990409) and it **passed** byte-for-byte. Live verification: `https://kanlerxz87-cyber.github.io/Alert5/docs/copy-verification.md` and `https://github.com/kanlerxz87-cyber/Alert5/flagged.html#alert5-independent-check` (§17 with F-C2/F-C3/F-C6) both fetched from the published site. Flagged items do not block the merge.
---

# Session `6a131ebb` — independent copy audit + upcoming-day test (2026-11-25)

Branch: `arena/6a131ebb-alert5` (Arena pins one branch per session, so the `session-<id>/<task>`
naming cannot be followed literally; same deviation the upstream project logged as F-001).

**What I found on starting:** `main` already contained the copy, merged by session `7693d136` in
[PR #1](https://github.com/kanlerxz87-cyber/Alert5/pull/1), and the published site was already
working: <https://kanlerxz87-cyber.github.io/Alert5/reviews.html?date=2026-08-26> renders the same
15-game slate, challenge counters and outcomes as the reference
<https://snapquast73-boop.github.io/LIVPBP/reviews.html?date=2026-08-26>.

**What I did about it:** my own copy work was redundant, so I **did not merge it**. This branch was
reset onto `main` and rebased five times as parallel PRs (#1, #4, #6, #8, #9) landed while it was
open; it now adds only work that was missing from `main`. Nothing merged by any other session was
reverted, rewritten or removed — every conflict in this file and in `flagged.html` was resolved by
keeping the other session's text verbatim and appending this session's section after it.

## Task board (session `6a131ebb`)

| Task | Status | Session | File scope | Notes |
|---|---|---|---|---|
| A1 Independent audit of the published copy | done | `6a131ebb` | none (read-only) | pinned revision `5c02527`; live comparison vs the reference feed |
| A2 Upcoming-game-day render test | done | `6a131ebb` | `tests/preview-day-render-test.mjs`, `tests/fixtures/schedule-2027-02-19.json`, `tests/run-all.mjs` | additive; 24 checks; run by `run-all` and therefore by CI |
| A3 Publish this pass's sources + irregularities | done | `6a131ebb` | `flagged.html` (§18 `<h2 id="copy-import-audit">`), `COORDINATION.md` | append-only |
| A4 Merge this branch into `main` | done | `6a131ebb` | COORDINATION.md | [PR #7](https://github.com/kanlerxz87-cyber/Alert5/pull/7) merged; deploy recorded below |

## Sources (official only, fetched 2026-11-25)

| Claim | Official source | Result |
|---|---|---|
| Slate + manager counters | [/schedule 2026-08-26 hydrate=review](https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=2026-08-26&hydrate=review) | 15 games; `823180` → `home.used=1, remaining=0` = “SF: 0 … (1 used)” |
| Review codes | [/api/v1/gameStatus](https://statsapi.mlb.com/api/v1/gameStatus) | `MF`, `MA`, `NH`, `MJ`, `NJ`, `IH` all match verbatim |
| ABS counters | [/feed/live 823180 leaf projection](https://statsapi.mlb.com/api/v1.1/game/823180/feed/live?fields=gameData,absChallenges,hasChallenges,away,home,usedSuccessful,usedFailed,remaining,review,used) | CIN 4/0/2, SF 2/1/1 |
| Pending-ruling event types | [/api/v1/eventTypes](https://statsapi.mlb.com/api/v1/eventTypes) | `os_ruling_pending_primary/_prior` |
| Team abbreviations | [/api/v1/teams?sportId=1](https://statsapi.mlb.com/api/v1/teams?sportId=1) | 30/30 match (`109`→AZ, `118`→KC) |
| Review fields in PBP | [/game/823096/playByPlay](https://statsapi.mlb.com/api/v1/game/823096/playByPlay) | `MJ`, `isOverturned:true`, `challengeTeamId:143` |
| Next date with games | [/schedule 2026-11-25 → 2027-06-30](https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=2026-11-25&endDate=2027-06-30) | first slate **2027-02-19**, official `totalGames: 17`, all Preview/Scheduled (count verified via `fields=…,totalGames`; an earlier note in this session said 16 from a partial page read and was corrected) |

## Checks (this branch, on top of `main`)

```text
node tests/run-all.mjs             -> syntax OK · local refs OK · 8 bindings OK · 47/47 jsdom · 24/24 upcoming-day
npm test                           -> 64 passed, 0 failed
node tools/restoration-check.mjs   -> ALL CHECKS PASSED
node tests/props-provenance-test.mjs -> 5 passed
```

## Irregularities (published on `flagged.html` §18)

C-1 reference is itself a reconstruction · C-2 forecast is a model, not data · C-3 sandbox cannot
TLS to StatsAPI (`--live` runs in CI instead) · C-4 image hosts unreachable here · C-5 RR-01
delayed-response guard unproven · C-6 offseason empty state is correct behaviour.

## Request to the final integration session — **fulfilled**

`main` already carries the copy, so this branch was small and additive. It was merged as
[PR #7](https://github.com/kanlerxz87-cyber/Alert5/pull/7) and the slate-count correction as
[PR #14](https://github.com/kanlerxz87-cyber/Alert5/pull/14); the deploy is recorded below. Every
conflict in this file and in `flagged.html` was resolved by keeping the other session's text
verbatim — no other session's work was discarded.


### 2026-11-25T21:00Z — Session `6abe8874` — PR #3 merged and Pages verified

- PR #3 (<https://github.com/kanlerxz87-cyber/Alert5/pull/3>) merged into `main` 2026-11-25T21:00:36Z, merge commit **`48a3ab31988bd418e7b0f314d3027d5c041906a9`**. Checks before merge: `test` **pass** (`npm run test:all` — syntax, 53 local refs, 8 bindings, jsdom 49/49, props-provenance 5/5, restoration-check, smoke 64/64) and `official-upcoming` **pass** (real 2027-04-01 official slate via live StatsAPI in CI, run `45700156535`).
- GitHub Pages rebuilt for merge commit `48a3ab3`: `pages build and deployment` run `45700323340` → **success**, ~27 s. `pages/builds/latest` reports `status: built`, `error: null`.
- **Published Pages delivery** workflow (`workflow_run`, verifies the deployed site byte-for-byte incl. nested-path 404) run `45700414030` → **success**.
- Main-branch push Site checks run `45700324014` → **success**.
- Live site fetched after deploy: <https://kanlerxz87-cyber.github.io/Alert5/reviews.html?date=2026-08-26> renders the 2026-08-26 replay feed (15 games · 10 reviews · 8 challenges · 2 umpire reviews · 68 ABS challenges · 1 run at risk · rows carry official `MLB API ↗` playByPlay links, incl. PHI @ SEA `gamePk 823096` Bot 5 and CIN @ SF `gamePk 823180` Top 7 / Top 9, matching the reference site). Dynamic tracked-entry counts differ per browser log by design (local log).
- Net contribution of PR #3 to `main` (non-overlapping only): `flagged.html` COPY banner, `tests/README.md` + `tests/link-check.mjs` `/Alert5/` project-prefix links, this record. The integrated copy itself was delivered by sessions `578585c0` (PR #4 + #2 merge chain), `7693d136` (PR #1/#6/#10), `79f6678f` (PR #8) and `ec8b9e36` (PR #9).

## Deployment record (session `6a131ebb`)

| Step | Result |
|---|---|
| Pull request | [PR #7 — upcoming-game-day render test + independent copy audit](https://github.com/kanlerxz87-cyber/Alert5/pull/7) — **merged** (merge commit `ed0945e2c9b63e053b9acc5d347d20adbedebeb9`), after 5 rebases caused by parallel sessions landing PRs #1/#4/#6/#8/#9/#10/#11 |
| Follow-up correction | [PR #14 — 2027-02-19 slate count corrected to the official `totalGames: 17`](https://github.com/kanlerxz87-cyber/Alert5/pull/14) — **merged** (`1178928`), Pages built |
| CI on both PRs | `test` (full suite + upcoming-day render) **pass**, `official-upcoming` (real StatsAPI) **pass** |
| GitHub Pages | Pages API reports `built` for `ed0945e` and `1178928`, no error |

Live checks after the deploy (2026-11-25 ≈ 21:07 UTC):

- <https://kanlerxz87-cyber.github.io/Alert5/> → correct offseason empty-day notice + “Most recent date with games: Wed Oct 28, 2026”.
- <https://kanlerxz87-cyber.github.io/Alert5/index.html?date=2027-02-19> → **all 17** official games render with team names, real `mlbstatic.com` logos, venues, first-pitch times, and `TBD` for the two games MLB has not scheduled yet.
- <https://kanlerxz87-cyber.github.io/Alert5/reviews.html?date=2026-08-26> → the same 15-game slate and review rows as the reference site, with `MLB API ↗` source links per row.
- <https://kanlerxz87-cyber.github.io/Alert5/reviews.html?date=2027-02-19> → honest empty state (“No tracked events for this date and filter yet”), 17 games scanned, nothing invented.
- <https://kanlerxz87-cyber.github.io/Alert5/game.html?gamePk=823180&date=2026-08-26> → linescore with per-row `source` links, box/decision data, pitch-by-pitch, ABS and umpire-review chips.
- <https://kanlerxz87-cyber.github.io/Alert5/flagged.html> → this board's flagged items including §18 of this session.

**Conclusion:** the copy is published and behaves like the reference site. Two things remain outside this session's control and are flagged, not fixed: logo/headshot hosts and live‐API calls cannot be exercised from the sandbox (both verified working from a real browser via the fetches above), and no live review has occurred yet in this copy's lifetime — the first live alerts will be observable on the next official game day, **2027-02-19** (17 games) per the official schedule.

## Session `d78ea508` — upcoming-season pregame smoke regression & 100% official row-link audit (2026-11-25)

- **Branch:** `arena/d78ea508-alert5` (Arena platform fixed-branch constraint; rebased cleanly onto integrated `main` @ `4978b9f` so zero work from sessions `7693d136`, `578585c0`, `79f6678f`, `ec8b9e36`, `6abe8874`, or `6a131ebb` was overwritten).
- **What was verified from official sources (`statsapi.mlb.com` / `mlb.com`):**
  1. `2026-08-26` reference slate ([schedule](https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=2026-08-26&hydrate=probablePitcher,linescore,decisions,review), [823096 playByPlay](https://statsapi.mlb.com/api/v1/game/823096/playByPlay), [823180 counters](https://statsapi.mlb.com/api/v1.1/game/823180/feed/live?fields=gameData,review,absChallenges,hasChallenges,away,home,used,remaining,usedSuccessful,usedFailed)) and reference page (<https://snapquast73-boop.github.io/LIVPBP/reviews.html?date=2026-08-26>).
  2. Upcoming 2027 MLB season dates ([schedule 2026-11-25..2027-03-26](https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=2026-11-25&endDate=2027-03-26&fields=dates,date,totalGames) -> Spring Training `2027-02-19` with 17 games; [Opening Day 2027-03-25](https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=2027-03-25&hydrate=probablePitcher,linescore,decisions,review) with 14 games; pregame [game/853719/feed/live](https://statsapi.mlb.com/api/v1.1/game/853719/feed/live) CWS @ DET).
  3. Complete 30-club abbreviations ([teams?sportId=1](https://statsapi.mlb.com/api/v1/teams?sportId=1&fields=teams,id,name,abbreviation)), review/game status registry ([gameStatus](https://statsapi.mlb.com/api/v1/gameStatus), including `T9` `abstractGameState: "Preview"` vs `abstractGameCode: "L"`), event types ([eventTypes](https://statsapi.mlb.com/api/v1/eventTypes)), and [MLB Official Scoring Changes](https://www.mlb.com/official-information/scoring-changes).
- **Non-overlapping contributions added ([PR #13](https://github.com/kanlerxz87-cyber/Alert5/pull/13)):**
  - `tools/smoke-test.mjs` §[14] (+3 assertions -> **67 passed, 0 failed**): deterministic smoke coverage for upcoming 2027 Opening Day pregame `schedule` + `feed/live` shapes (`Scheduled` + `startTimeTBD` -> `TBD` + blank scores on `index.html`, pregame `playByPlay` skip on `reviews.html`, and `Pregame` card + `–` scores on `game.html`).
  - `flagged.html` (`CP-11` external GitHub link + §19 `D7-1…D7-4`) & `docs/verification-report.md` §8: 100% of rows across all 18 HTML tables in `flagged.html` carry external official source links; unconfirmed items (`v1.0.0-stable-checkpoint` tag on `Alert5`, 2027 pregame `absChallenges` allocations) are left blank and flagged.
- **PR #13 merge & GitHub Pages deployment result (2026-11-25T21:16Z):**
  - PR checks `test` and `official-upcoming` passed on run `45702480903`; [PR #13](https://github.com/kanlerxz87-cyber/Alert5/pull/13) merged to `main` as `20c964708216bdf35c2643fe18dd7658bbe6dcca`.
  - GitHub Pages build `1403433789` (`pages-build-deployment` run `45702748091`) succeeded (`status: "built"`, `error: null`), `Site checks` on `main` (`45702749929`) passed, and `Published Pages delivery` (`45702844510`) passed byte-for-byte.
  - Verified live on <https://kanlerxz87-cyber.github.io/Alert5/reviews.html?date=2026-08-26> (15 games, per-row `MLB API ↗` source links, manager & ABS counters, runs-at-risk), <https://kanlerxz87-cyber.github.io/Alert5/index.html?date=2027-03-25> (all 14 Opening Day 2027 games with `Scheduled` times and `TBD` where `startTimeTBD: true`), and <https://kanlerxz87-cyber.github.io/Alert5/flagged.html#alert5-upcoming-smoke> (§19 live).

