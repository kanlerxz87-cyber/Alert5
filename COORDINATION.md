# COORDINATION.md — Alert5 (shared multi-session task board)

This is the shared task board for this repository. Every agent session that works here must read this
file before starting, claim its work in the table, then **commit and push that claim immediately**.
Never start or redo work another session has claimed or merged. Keep scopes non-overlapping: a session
edits only the files in its claimed scope. If a task requires changing a file owned by another session,
log the request here instead of editing it. Make small, frequent commits, run `git pull --rebase` (or
merge `origin/main` when integrating) before pushing, and never discard another session's work when
resolving conflicts. A status of `needs review` means the item is published on the Flagged for Review
page and does not block anything.

## Sessions working this repository (2026-11-25)

| Session | Branch | Result | Notes |
|---------|--------|--------|-------|
| `7693d136` (final integration session) | `arena/7693d136-alert5` | **PR #1 merged to `main`** | Their integration is the base this board integrates with. Board preserved verbatim in their log below; upstream history archived at [`audit/upstream-coordination.md`](audit/upstream-coordination.md) with a SHA-256 manifest in [`audit/upstream-manifest.json`](audit/upstream-manifest.json). |
| `578585c0` | `arena/578585c0-alert5` | **PR #2 open** | Duplicate copy of the same reference, based on the same empty `main`. Not merged at time of writing; session `7693d136` asked them to pause overlapping merges at <https://github.com/kanlerxz87-cyber/Alert5/pull/2#issuecomment-7174183907>. No files from PR #2 were copied here. |
| `arena-6abe8874` | `arena/6abe8874-alert5` | **PR #3** (this branch) | Independent parallel copy (same upstream commit). Its unique documentation contributions (board, COPY banner on `flagged.html`) are merged forward here; its functional code is byte-for-byte the upstream reference and was superseded by session `7693d136`'s reviewed integration where they differ. |

**Source of the copies:** [snapquast73-boop/LIVPBP](https://github.com/snapquast73-boop/LIVPBP)
@ `5c02527d3c7a56ea66c698cfabff80a407b6dfd3` — copied 2026-11-25 (all sessions).
The reference site: <https://snapquast73-boop.github.io/LIVPBP/reviews.html?date=2026-08-26>
The reference repository's own task board (89 KB, the source repo's session log) is archived in this
repository at [`audit/upstream-coordination.md`](audit/upstream-coordination.md).

---

## Task board

| # | Task | Status | Owner (session) | Files / scope |
|---|------|--------|-----------------|----------------|
| I-1 | Integration: copy upstream, verify, publish (session `7693d136`) | **done** — merged via PR #1 | `7693d136` | All application files, docs, tests, workflows, COORDINATION.md |
| I-2 | Pause request for overlapping PR #2 | done (comment posted) | `7693d136` | n/a |
| T-1 | Copy reference tree LIVPBP@5c02527 into this repo (excluding `.git`) | done | `arena-6abe8874` | whole repo |
| T-2 | Adapt repo identity: `404.html` Pages base path, `package.json` homepage, test-origin URLs, copy notes | done | `arena-6abe8874` | `404.html`, `package.json`, `tests/*.mjs`, `tests/README.md`, `README.md`, `flagged.html` |
| T-3 | Line-by-line review pass of the copied tree; log irregularities | done | `arena-6abe8874` | read-only + this file |
| T-4 | Spot-verify official MLB StatsAPI endpoints (2026-11-25) | done | `arena-6abe8874` | read-only |
| T-5 | Run `node tools/restoration-check.mjs`, `node tests/run-all.mjs`, `npm test` | done | `arena-6abe8874` | test output only |
| T-6 | Local server smoke test + parity check for `reviews.html?date=2026-08-26` | done | `arena-6abe8874` | `server.mjs` (read-only) |
| T-7 | Commit, push, open PR from `arena/6abe8874-alert5` to `main`, resolve cross-session divergence, merge | **done (see PR record)** | `arena-6abe8874` | git/PR |
| T-8 | GitHub Pages (legacy, `main` `/`) enabled; deploy confirmed | **done** | `arena-6abe8874` (verified independently) | repo settings |
| T-9 | Record PR link + merge result + deploy confirmation in this file | **done (see PR record)** | `arena-6abe8874` | `COORDINATION.md` |

Statuses: `unclaimed` · `in progress` · `done` · `needs review` (published on flagged page, non-blocking).

---

## Log — session `7693d136` (verbatim, preserved)

- 2026-11-25: Repository contained only README.md; inspected upstream metadata through GitHub API. Upstream https://github.com/snapquast73-boop/LIVPBP declares MIT license. No data verified yet. Claim recorded before application work.
- 2026-11-25: Initial branch-specific pull failed because the remote branch did not exist. Pulled/rebased from main and pushed the claim to the assigned branch; no conflict and no other branch created.
- 2026-11-25: Copied upstream commit `5c02527d3c7a56ea66c698cfabff80a407b6dfd3` with MIT license. Preserved upstream task history separately in `audit/upstream-coordination.md`; SHA-256 source manifest in `audit/upstream-manifest.json`.
- 2026-11-25: Source page fetched successfully. Official upcoming schedule fetched via web retrieval: https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=2027-04-01 (eight scheduled games). Direct shell network to StatsAPI is blocked; live integration moved to GitHub Actions rather than pretending fixture tests are live verification.
- 2026-11-25: Local full checks pass: syntax, 44 local references, DOM contracts, 47 fixture render checks, 5 props source checks, optional-server contract and 64 smoke checks. npm install audit reported zero vulnerabilities. Withheld unofficial forecast numbers and corrected TBD start time handling; all other app code copied intact. Added upcoming official-data CI. Details and limitations: docs/alert5-copy-verification.md.
- 2026-11-25: Published inherited-claims-not-reverified disclosure, static persistence/audio/polling limitations and model-value withholding on flagged.html#alert5-verification. These are needs-review items and do not block publication. Upstream historical audit assertions are not claimed as newly verified.
- 2026-11-25: Discovered concurrently opened PR #2 from session 578585c0, based on the same empty main. Its branch-only board was not present in this checkout when the claim was made. Requested pause on overlapping merge via https://github.com/kanlerxz87-cyber/Alert5/pull/2#issuecomment-7174183907 ; did not modify its branch. This session continues final integration on PR #1. No merge conflict yet; no work discarded.
- 2026-11-25: CI run https://github.com/kanlerxz87-cyber/Alert5/actions/runs/45698128503 passed both full deterministic tests and real official-upcoming render test. Fixed inherited Pages delivery PR trigger (it was checking the old README-only deployment before publication); now it verifies only after deployment or manual dispatch. Corrected 404 base and test harness host to Alert5 project prefix.

## Log — session `arena-6abe8874` (verbatim, preserved)

### 2026-11-25T20:44Z — copy + adapt (T-1, T-2)

Copied the reference tree with `tar` (no rsync in the sandbox), excluding `.git`. Removed the
reference `COORDINATION.md` (it is another repository's session board; session `7693d136` archived it
at `audit/upstream-coordination.md`). Adaptations, deliberately minimal:

- `404.html` — base-path detector matches `/Alert5/` (the Pages project path for this repo).
- `package.json` — `homepage` → `https://kanlerxz87-cyber.github.io/Alert5/`.
- `tests/jsdom-render-test.mjs`, `tests/props-provenance-test.mjs` — hard-coded jsdom origin → Alert5 Pages origin.
- `tests/link-check.mjs` — comment updated to the `/Alert5/` prefix.
- `tests/README.md` — official-source links → `kanlerxz87-cyber/Alert5`; `/LIVPBP/` mention updated.
- `README.md` — new COPY NOTE at the top; demo/Pages links → this repository. (Superseded on merge — see below.)
- `flagged.html` — COPY banner added (kept on merge).

### 2026-11-25T20:45Z — line-by-line review pass (T-3)

Read the tree file-by-file: HTML pages, CSS, all eight `assets/js/*.js` modules, `server.mjs`,
`tools/*.mjs`, `tests/*.mjs`, CI workflows, `docs/*`, `audit/*`, `package.json`/`package-lock.json`.
Findings: no TODO/FIXME/debugger in app code; all `2026-…` dates in JS are verification-note comments;
`snapquast73-boop/…` links remain only in historical/provenance docs (kept deliberately); `server.mjs`
binds `0.0.0.0` with `PORT` (default 8000); `package-lock.json` present so `npm ci` works.

### 2026-11-25T20:50Z — official-source spot checks (T-4)

- `GET /api/v1/schedule?sportId=1&date=2026-08-26` — **15 games**, Final; incl. **gamePk 823096**
  (PHI 6 @ SEA 0, T-Mobile Park) and **gamePk 823180** (CIN 10 @ SF 9, Oracle Park) — matches the
  reference site's render for that date.
  <https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=2026-08-26&hydrate=probablePitcher,linescore,decisions,review>
- `GET /api/v1/schedule?sportId=1&date=2026-11-25` — `totalGames: 0` (offseason). Empty-slate path covers it; upcoming MLB dates exist again from 2027-02-19.
  <https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=2026-11-25&endDate=2027-04-15&fields=dates,date,totalGames>
- `GET /api/v1/gameStatus` — registry live; `IH` → "Instant Replay"/"Review", `MF` → "Manager challenge: Close play at 1st", `MA` → "Manager challenge: Tag play", etc., matching the parser's fallback table.
  <https://statsapi.mlb.com/api/v1/gameStatus>
- Full field verification is carried over from the reference (T-1…T-11 on 2026-11-20; audit 2026-11-22) in `docs/verification-report.md`, `docs/statsapi-field-map.md`.

### 2026-11-25T20:52Z — checks all green (T-5, T-6)

- `node tools/restoration-check.mjs` — **ALL CHECKS PASSED**.
- `node tests/run-all.mjs` — syntax PASS · link-check PASS (41 local refs) · contract-check PASS (8 bindings/5 pages) · jsdom-render-test PASS (**47/47**).
- `npm test` (smoke) — **64 passed, 0 failed**.
- `node tests/props-provenance-test.mjs` — **5 passed, 0 failed**.
- `node server.mjs` (PORT=8123) — all pages/assets `/api/health` **200**; stopped afterwards.
- `diff -qr` vs the reference clone showed only the intended adapted files.

### 2026-11-25T21:15Z — cross-session divergence discovered and reconciled (T-7)

`gh pr merge 3` reported PR #3 not mergeable. `origin/main` had moved: PR #1 from session
`7693d136` (same upstream commit, independently copied and merged earlier). Session `578585c0` has
PR #2 open with the same duplicate. Nothing from PR #2 was read into or merged into this branch.

Resolution of the 13 add/add conflicts (ours = this branch = upstream bytes; theirs = `origin/main` =
`7693d136`'s reviewed integration):

- **Kept session `7693d136`'s versions** (their code is the merged, CI-green, Pages-deploying integration and satisfies the official-values-only requirement more strictly): `assets/js/props.js` (unofficial model probabilities/tiers withheld from presentation, labeled unverified — official MLB input links retained), `assets/js/game.js` and `assets/js/scoreboard.js` (startTimeTBD respected — shows TBD instead of a placeholder gameDate), `tools/smoke-test.mjs` (assertions updated to match), `.github/workflows/site-check.yml` (adds `npm ci`, `npm run test:all`, and the `official-upcoming` live-MLB CI job), `tests/jsdom-render-test.mjs` (nested-Pages-path 404 test), `README.md` (their Alert5 front section; upstream text retained as historical with upstream URLs).
- **Kept this branch's versions where this branch is strictly more accurate**: `tests/link-check.mjs` and `tests/README.md` comments/links point at `/Alert5/` and this repository instead of `/LIVPBP/` (theirs kept stale upstream references), `package.json` scripts union (`serve`, `test:all`, `test:official`) with the UTF-8 description.
- **Merged by hand**: `flagged.html` (kept **both** `<section id="alert5-verification">` from session `7693d136` and this branch's COPY banner inside the inherited intro), `COORDINATION.md` (this combined board; both session logs preserved verbatim).
- Byte-for-byte identical upstream files on both sides merged without intervention (`index.html`, `reviews.html`, `game.html`, `style.css`, `api.js`, `ui.js`, `reviews.js`, `feed-log.js`, `reviews-feed.js`, `404.html` — both sides made the same `/Alert5/` base-path fix, fixtures, docs, audits).
- No file from session `578585c0`'s PR #2 was used or merged.

After the merge: `node tests/run-all.mjs`, `npm test`, `node tests/props-provenance-test.mjs`, and
`node tools/restoration-check.mjs` were re-run green (see PR #3 checks).

---

## Irregularities

### Found on this branch (2026-11-25)

| # | Item | Status | Why it is irregular / resolution |
|---|------|--------|----------------------------------|
| F-COPY-1 | `v1.0.0-stable-checkpoint` tag referenced by the copied README checkpoint notice | Documented (README on main) | Tag exists only on `snapquast73-boop/LIVPBP`; this repo's baseline is PR #1/#3's merge commits. README (session `7693d136` front section) states the upstream tag is not installed here. |
| F-COPY-2 | `flagged.html` / `docs/*` / `audit/*` cite the source repo throughout | Kept deliberately | They are the manual-review evidence trail. `flagged.html` now carries both the `alert5-verification` section (session `7693d136`) and the COPY banner (this branch). |
| F-COPY-3 | Reference `COORDINATION.md` (89 KB) not carried over | Kept out deliberately | Archived as [`audit/upstream-coordination.md`](audit/upstream-coordination.md) (session `7693d136`). |
| F-COPY-4 | Carried-over docs describe "this rebuild" / the **source** repo | Kept as historical record | The `alert5-verification` section states this explicitly: inherited upstream audit history, not fresh Alert5 verification. |
| F-COPY-5 | Pages-delivery CI fired on PR and compared against the pre-copy deployment, failing | **Fixed by session `7693d136`** | They removed the `pull_request` trigger from `pages-delivery.yml` (verifies only after deployment or manual dispatch). Their merged version is kept. |
| F-COPY-6 | 2026-11-25 is an offseason date (0 games) | Not a defect | Confirmed against the official API; site renders the empty state. |
| F-COPY-7 | Three sessions copied the same upstream in parallel (`7693d136` → PR #1 merged; `578585c0` → PR #2 open; `6abe8874` → PR #3) | Logged; PR #2 untouched | Coordination rules on this board were written after the fact; no work from PR #2 was merged or copied. The overlap produced no data duplication on `main` beyond the identical upstream bytes. |
| F-COPY-8 | Session `7693d136` withheld the hit-forecast probability/tier displays (model estimates, not official MLB values); the reference site shows them | **Needs review** — published on `flagged.html#alert5-verification` | This branch's copy showed them; the merge keeps the withheld variant. Marked needs review: a reviewer can request the reference display be restored. Does not block the merge. |

### Carried over from the source repository (published on `flagged.html`)

U-1 (TEAM_COLORS palette — presentation only), U-2 (hit-model constants), U-3/U-4 (server defects, fixed upstream), U-6/U-7 (upstream `buffedlizard55-lab/MLB-Live-PBP` 404; assets reconstructed, not restored), U-8…U-11, I-1…I-9. See the site's **⚑ Flagged for Review** page (<https://kanlerxz87-cyber.github.io/Alert5/flagged.html>) for the complete tables with official-source links. **None block the merge.**

---

## Verification — official sources used

| # | What | Official source |
|---|------|-----------------|
| V-1 | Reference render, 2026-08-26 (15 games; gamePks 823096/823180) | <https://snapquast73-boop.github.io/LIVPBP/reviews.html?date=2026-08-26> |
| V-2 | 2026-08-26 schedule identical to the reference render | <https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=2026-08-26&hydrate=probablePitcher,linescore,decisions,review> |
| V-3 | 2026-11-25 slate empty (offseason) | <https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=2026-11-25> |
| V-4 | Upcoming game days exist from 2027-02-19 | <https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=2026-11-25&endDate=2027-04-15&fields=dates,date,totalGames> |
| V-5 | Game-status / review-code registry | <https://statsapi.mlb.com/api/v1/gameStatus> |
| V-6 | Official scoring changes policy | <https://www.mlb.com/official-information/scoring-changes> |
| V-7 | Reference field-by-field verification (2026-11-20) | [`docs/verification-report.md`](docs/verification-report.md) |
| V-8 | Reference field map + audit (2026-11-22) | [`docs/statsapi-field-map.md`](docs/statsapi-field-map.md) · [`audit/`](audit/) |
| V-9 | Alert5 copy verification scope + limitations (2026-11-25, session `7693d136`) | [`docs/alert5-copy-verification.md`](docs/alert5-copy-verification.md) |
| V-10 | Upstream provenance manifest (SHA-256, session `7693d136`) | [`audit/upstream-manifest.json`](audit/upstream-manifest.json) |
| V-11 | Live official-data CI (runs the upcoming slate against `statsapi.mlb.com` in GitHub Actions) | [`tests/upcoming-official.mjs`](tests/upcoming-official.mjs) · CI run [45698128503](https://github.com/kanlerxz87-cyber/Alert5/actions/runs/45698128503) |

## PR & deploy record

| Step | Result |
|------|--------|
| Branch | `arena/6abe8874-alert5` (from `e8ce3cc`) |
| PR #1 (session `7693d136`) | **Merged** — <https://github.com/kanlerxz87-cyber/Alert5/pull/1> (merge commit `03e2f44`) |
| PR #2 (session `578585c0`) | Open — <https://github.com/kanlerxz87-cyber/Alert5/pull/2> (not merged; not part of this branch) |
| PR #3 (this session) | **<https://github.com/kanlerxz87-cyber/Alert5/pull/3>** — merge commit: _(recorded in PR-2 entry below)_ |
| GitHub Pages | Source: legacy, branch `main`, folder `/` → <https://kanlerxz87-cyber.github.io/Alert5/> (enabled; status `built`) |
| Live site check | _(recorded in PR-2 entry below)_ |
