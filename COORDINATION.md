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
| C6 | Integration: PR → `main`, merge, confirm GitHub Pages deploy, record result here | in progress | `578585c0` | repo root | |
| C7 | Publish the copy/verification irregularities on `flagged.html` | needs review | `578585c0` | `flagged.html` | Section 14 — copy-provenance items |
| C8 | Baseball-data tables on the site (per-row official source links) | needs review | `578585c0` | `flagged.html`, `docs/` | The site renders no static data tables: every row is fetched live from the StatsAPI at request time and linked to its own `statsapi.mlb.com` endpoint (see "Data tables" below) |

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

(filled in by C6 — PR link, merge result, Pages build status, live verification)

## Handoffs / conflicts

(none yet)
