# Coordination

Shared task board for parallel agent sessions. Read this before starting work.

## Current session

- Session: `79f6678f` (arena/79f6678f-alert5)
- Branch: `arena/79f6678f-alert5`
- Base: `e8ce3ccee068c419d71cc1678592007a60733d76` (main)
- Started: 2026-11-25T20:42:00Z

## Task board

| Task | Status | Owner | Scope / files | Notes |
|---|---|---|---|---|
| Copy source repo snapquast73-boop/LIVPBP into Alert5 and adapt repo-specific refs | in progress | 79f6678f | repo root (all copied files), 404.html, package.json, README.md, COORDINATION.md | Source: https://github.com/snapquast73-boop/LIVPBP (main @ 5c02527d3c7a56ea66c698cfabff80a407b6dfd3). Reference site: https://snapquast73-boop.github.io/LIVPBP/reviews.html?date=2026-08-26 |
| Verify site builds/runs and tests pass | unclaimed | | tests/, tools/, package.json | Run restoration-check, smoke tests, jsdom render tests as available |
| Verify site works for upcoming game days (MLB StatsAPI schedule) | unclaimed | | assets/js/api.js, index/reviews/game pages | Confirm date-driven schedule works for future dates via official MLB StatsAPI |
| Final integration: PR to main, merge, confirm Pages deploy | unclaimed | | repo-wide | Blocked until tasks above done |

## Log

| Time (UTC) | Session | Event | Details / Sources |
|---|---|---|---|
| 2026-11-25T20:42:00Z | 79f6678f | Claimed copy task | Inspected source repo `snapquast73-boop/LIVPBP` via GitHub API (`GET https://api.github.com/repos/snapquast73-boop/LIVPBP` → default_branch=main) and cloned `main` at `5c02527d3c7a56ea66c698cfabff80a407b6dfd3`. Reference site fetched: https://snapquast73-boop.github.io/LIVPBP/reviews.html?date=2026-08-26 . Copying files into Alert5, excluding `.git` and source COORDINATION.md. Will adapt 404 base path and repo identity references. |
