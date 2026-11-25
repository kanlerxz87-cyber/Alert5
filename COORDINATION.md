# COORDINATION.md — shared task board

Repo: `kanlerxz87-cyber/Alert5` · Site: https://kanlerxz87-cyber.github.io/Alert5/
Updated 2026-11-25 by session **`07f0c355`** (Arena branch `arena/07f0c355-alert5`).

## Branch / worktree note (Arena sandbox restriction)

The task brief describes one branch per session (`session-<id>/<task>`). This Arena
session is fixed to **`arena/07f0c355-alert5`** and must not create, switch to, or push any
other branch, so all work for this session happens on that fixed branch and integration is a
single pull request into `main`. No parallel session branches exist in this repository at the
time this board was created (`git ls-remote` shows `main` plus unrelated `arena/*` refs that
this session will not touch).

## Session claim (2026-11-25)

| Task | Status | Session | File scope | Notes |
|---|---|---|---|---|
| T1 Create/claim this coordination board | done | `07f0c355` | `COORDINATION.md` | Claim made before site files are edited. |
| T2 Copy the `snapquast73-boop/LIVPBP` site into this repository | done | `07f0c355` | all site files (`README.md`, HTML/CSS/JS, `assets/`, `docs/`, `tests/`, `tools/`, workflows, license, notice files) | Upstream tip `5c02527d3c7a56ea66c698cfabff80a407b6dfd3` ("Merge pull request #33"); preserve LICENSE and attribution. Copied in `c31924f`; upstream tip `5c02527`. |
| T3 Make the copied site site-specific for `kanlerxz87-cyber/Alert5` | done | `07f0c355` | `404.html`, `README.md`, `package.json`, page-relative project-path handling | No change to MLB data semantics; relative assets kept; `package.json` homepage → `https://kanlerxz87-cyber.github.io/Alert5/`; `404.html` base path → `/Alert5/`; README fork notice/live-demo link updated. |
| T4 Publish a copy/verification addendum and flagged items | done | `07f0c355` | `flagged.html`, `docs/copy-verification-2026-11-25.md`, `docs/upstream-COORDINATION-2026-11-25.md` (preserved upstream board) | Unverifiable/non-official values are left blank and flagged; `docs/copy-verification-2026-11-25.md`; upstream board preserved at `docs/upstream-COORDINATION-2026-11-25.md`; `flagged.html` §15 added; unverified items left blank. |
| T5 Run the full local verification suite and local server smoke checks | done | `07f0c355` | `package.json`, `tests/`, `tools/` (no scope expansion unless a check fails) | `npm ci`, `npm test`, `node tests/run-all.mjs`, `node tools/restoration-check.mjs`, `npm ci`; `node tools/restoration-check.mjs` ALL PASSED; `npm test` 64/64; `node tests/run-all.mjs` 47/47 jsdom + 41 refs + 8 bindings; `props-provenance` 5/5; `link-check` 46 refs OK; local server: all pages/assets 200, `/.git/HEAD` 403, `/api/health` OK. |
| T6 Pull request into `main`, merge, confirm GitHub Pages build/deploy, record result | in progress | `07f0c355` | `COORDINATION.md` (pre-merge record here; post-merge Pages record follows in this PR branch/follow-up) | PR [#5](https://github.com/kanlerxz87-cyber/Alert5/pull/5) opened from this branch to `main`; pre-merge checks all green; no approval wait. Merge result + Pages confirmation are recorded after the merge runs. |

## Copy record (2026-11-25)

- Source copied: [`snapquast73-boop/LIVPBP` @ `5c02527d3c7a56ea66c698cfabff80a407b6dfd3`](https://github.com/snapquast73-boop/LIVPBP/commit/5c02527d3c7a56ea66c698cfabff80a407b6dfd3) — fresh clone HEAD matched `git ls-remote origin HEAD` before copying.
- Commits: `2a320bb` claim board · `c31924f` copy of upstream tree · `1da58a7` site-specific + verification/flagged records · this commit: PR #5 record.
- Integration PR: [#5](https://github.com/kanlerxz87-cyber/Alert5/pull/5) (`arena/07f0c355-alert5` → `main`).
- Post-copy diff vs source (excluding `.git`, `node_modules`): `404.html` (project-site base path), `README.md` (fork notice + live demo), `package.json` (homepage), root `COORDINATION.md` (this board), added `docs/upstream-COORDINATION-2026-11-25.md`, `docs/copy-verification-2026-11-25.md`. No application/MLB parsing logic changed.
- Upstream license preserved: `LICENSE` (MIT, `Copyright (c) 2026 MLB-Live-PBP contributors`).

## Verification performed for this copy (2026-11-25)

| Check | Result | Source |
|---|---|---|
| Fresh clone of upstream tip | HEAD = `5c02527d3c7a56ea66c698cfabff80a407b6dfd3` | `git ls-remote` · [upstream commit](https://github.com/snapquast73-boop/LIVPBP/commit/5c02527d3c7a56ea66c698cfabff80a407b6dfd3) |
| This repo Pages config | public repo; default `main`; Pages `built`, legacy `main` `/`, `https://kanlerxz87-cyber.github.io/Alert5/` | [Pages API](https://api.github.com/repos/kanlerxz87-cyber/Alert5/pages) |
| Official review-status registry fetched | JSON with `IH`, `M*`, `N*`, `MJ`/`NJ` codes used by the site | [`/api/v1/gameStatus`](https://statsapi.mlb.com/api/v1/gameStatus) |
| Official schedule 2026-11-25 (today) | `totalGames: 0` (offseason/empty slate, not a site error) | [schedule 2026-11-25](https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=2026-11-25&hydrate=probablePitcher,linescore,decisions,review) |
| Official schedule 2026-08-26 (reference/deep-link day) | `totalGames: 15` | [schedule 2026-08-26](https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=2026-08-26&fields=totalGames,totalItems,totalEvents,totalGamesInProgress,dates.totalGames) |
| `node tools/restoration-check.mjs` | ALL CHECKS PASSED | local run |
| `npm test` (`tools/smoke-test.mjs`) | 64 passed, 0 failed | local run |
| `node tests/run-all.mjs` | syntax OK · 46 local refs OK · 8 contract bindings OK · 47/47 jsdom | local run |
| `node tests/props-provenance-test.mjs` | 5 passed, 0 failed | local run |
| `node tests/link-check.mjs` | 46 local references checked; OK | local run |
| `node server.mjs` + HTTP smoke | `/`, `/index.html`, `/reviews.html`, `/game.html`, `/flagged.html`, `/404.html`, CSS/JS → 200; `/api/health` 200 JSON; `/.git/HEAD` → 403 | local run |

## Flagged for review introduced/carried for this copy

Published on `flagged.html` §15 and in [`docs/copy-verification-2026-11-25.md`](docs/copy-verification-2026-11-25.md):
K-1 upstream verification tables preserved but not independently re-verified row-by-row by this session · K-2 original pre-rebuild client missing/404 · K-3 upstream `v1.0.0-stable-checkpoint` tag not present here · K-4 MLB `/linescore` vs `/feed/live` errors disagree (game 775296: 2 vs 3) · K-5 game 824960 structured `reviewDetails` vs prose · K-6 club colours / hit-model constants have no official value · K-7 future games only exist when MLB publishes them (2026-11-25 `totalGames: 0`) · K-8 Pages deploy of this merge unverified until the post-merge build check runs.

## Ground rules for this repository

- The upstream project copied here is MIT-licensed (`Copyright (c) 2026 MLB-Live-PBP contributors`);
  its `LICENSE` and attribution are preserved.
- Official MLB data sources only: `statsapi.mlb.com` (StatsAPI / schedule / feeds) and `mlb.com`
  for MLB-published policy/definition pages. GitHub is used for repository/Pages provenance only,
  never as evidence for baseball data values.
- If an official source does not publish a value, the value stays blank and the item is flagged
  on `flagged.html`; nothing is inferred.
- A status of `needs review` means the item is published and non-blocking.
- Small, frequent commits; `git pull --rebase` before every push; no discarding other sessions'
  work; no edits outside the claimed scope without logging the request here first.
