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
| T2 Copy the `snapquast73-boop/LIVPBP` site into this repository | in progress | `07f0c355` | all site files (`README.md`, HTML/CSS/JS, `assets/`, `docs/`, `tests/`, `tools/`, workflows, license, notice files) | Upstream tip `5c02527d3c7a56ea66c698cfabff80a407b6dfd3` ("Merge pull request #33"); preserve LICENSE and attribution. |
| T3 Make the copied site site-specific for `kanlerxz87-cyber/Alert5` | in progress | `07f0c355` | `404.html`, `README.md`, `package.json`, page-relative project-path handling | No change to MLB data semantics; keep relative assets so GitHub Pages project hosting works. |
| T4 Publish a copy/verification addendum and flagged items | in progress | `07f0c355` | `flagged.html`, `docs/copy-verification-2026-11-25.md`, `docs/upstream-COORDINATION-2026-11-25.md` (preserved upstream board) | Unverifiable/non-official values are left blank and flagged; no approval blocking merge. |
| T5 Run the full local verification suite and local server smoke checks | in progress | `07f0c355` | `package.json`, `tests/`, `tools/` (no scope expansion unless a check fails) | `npm ci`, `npm test`, `node tests/run-all.mjs`, `node tools/restoration-check.mjs`, plus local HTTP checks. |
| T6 Pull request into `main`, merge, confirm GitHub Pages build/deploy, record result | in progress | `07f0c355` | `COORDINATION.md` only for the final record | PR from this fixed branch into `main`; do not wait for approval after checks pass. |

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
