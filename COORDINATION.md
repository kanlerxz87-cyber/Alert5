# COORDINATION.md — Alert5 (shared multi-session task board)

This is the shared task board for this repository. Every agent session that works here must read this
file before starting, claim the task it intends to do by writing its session ID and file scope into
the table, then **commit and push that claim immediately**. Never start a task another session has
claimed. Keep scopes non-overlapping: a session edits only the files in its claimed scope. If a task
requires changing a file owned by another session, log the request here instead of editing it. Make
small, frequent commits, and run `git pull --rebase` before every push. A status of `needs review`
means the item is published on the Flagged for Review page and does not block anything.

**Session ID of the session that built this copy:** `arena-6abe8874`
(branch `arena/6abe8874-alert5`, branched from `e8ce3cc` on `main`)

**Source of the copy:** [snapquast73-boop/LIVPBP](https://github.com/snapquast73-boop/LIVPBP)
@ `5c02527d3c7a56ea66c698cfabff80a407b6dfd3` — copied 2026-11-25.
The reference site: <https://snapquast73-boop.github.io/LIVPBP/reviews.html?date=2026-08-26>
The reference repository's own task board (89 KB, not copied here on purpose — it documents a
different repository's sessions): <https://github.com/snapquast73-boop/LIVPBP/blob/main/COORDINATION.md>

---

## Task board

| # | Task | Status | Owner (session) | Files / scope |
|---|------|--------|-----------------|----------------|
| T-1 | Copy reference tree LIVPBP@5c02527 into this repo (excluding `.git`) | done | `arena-6abe8874` | whole repo |
| T-2 | Adapt repo identity: `404.html` Pages base path, `package.json` homepage, test-origin URLs, copy notes in README/flagged/tests README | done | `arena-6abe8874` | `404.html`, `package.json`, `tests/*.mjs`, `tests/README.md`, `README.md`, `flagged.html`, `COORDINATION.md` |
| T-3 | Line-by-line review pass of the copied tree; log irregularities (see below) | done | `arena-6abe8874` | read-only + this file |
| T-4 | Spot-verify official MLB StatsAPI endpoints (2026-11-25) — see Verification below | done | `arena-6abe8874` | read-only |
| T-5 | Run `node tools/restoration-check.mjs`, `node tests/run-all.mjs`, `npm test` | done | `arena-6abe8874` | `node_modules/` (ignored), test output only |
| T-6 | Local server smoke test + parity check against the reference site for `reviews.html?date=2026-08-26` | done | `arena-6abe8874` | `server.mjs` (read-only), `data/` (ignored) |
| T-7 | Commit, push, open pull request from `arena/6abe8874-alert5` to `main`, merge it | done (see PR record) | `arena-6abe8874` | git/PR |
| T-8 | Enable GitHub Pages (legacy, `main` `/`) and confirm the deploy succeeds | done (see Deploy record) | `arena-6abe8874` | repo settings |
| T-9 | Record PR link + merge result + deploy confirmation in this file (follow-up PR) | done (see PR record) | `arena-6abe8874` | `COORDINATION.md` |

Statuses: `unclaimed` · `in progress` · `done` · `needs review` (published on flagged page, non-blocking).

No other session has claimed work on this repository as of 2026-11-25T20:45Z. All tasks above are
claimed by `arena-6abe8874`; scopes do not overlap with any other session on file.

---

## Session log

### 2026-11-25T20:44Z — `arena-6abe8874` — copy + adapt (T-1, T-2)

Copied the reference tree with `tar` (no rsync in the sandbox), excluding `.git`. Removed the
reference `COORDINATION.md` (it is another repository's session board; not carried over).
Adaptations, deliberately minimal:

- `404.html` — base-path detector now matches `/Alert5/` instead of `/LIVPBP/` (the Pages project path for this repo).
- `package.json` — `homepage` now `https://kanlerxz87-cyber.github.io/Alert5/`.
- `tests/jsdom-render-test.mjs`, `tests/props-provenance-test.mjs` — the hard-coded jsdom origin is now `https://kanlerxz87-cyber.github.io/Alert5/…`.
- `tests/link-check.mjs` — comment updated to the `/Alert5/` prefix.
- `tests/README.md` — official-source links now point at `kanlerxz87-cyber/Alert5`; `/LIVPBP/` mention updated.
- `README.md` — new COPY NOTE (2026-11-25) at the top documenting the source, the commit, and exactly what changed; Live-demo and deployment examples now reference this repository; checkpoint notice now explains the `v1.0.0-stable-checkpoint` tag lives on the source repo.
- `flagged.html` — added a clearly-labeled COPY banner at the top of the intro; all rows and their official-source links kept verbatim.
- `scripts/styles/pages/tests/fixtures/docs/audit` otherwise byte-for-byte the reference tree.

### 2026-11-25T20:45Z — `arena-6abe8874` — line-by-line review pass (T-3)

Read the tree file-by-file: all HTML pages, all CSS, all eight `assets/js/*.js` modules (in full via
the reference clone, plus re-reads of the adapted files), `server.mjs`, `tools/*.mjs`, `tests/*.mjs`,
CI workflows, `docs/*`, `audit/*`, `package.json`/`package-lock.json`, `.gitignore`, `.nojekyll`.
Findings:

- No `TODO`/`FIXME`/`debugger` in application code; `console.*` only in test/tool output.
- All `2026-…` dates inside `assets/js/*.js` are verification-note comments (e.g. "verified 2026-11-20
  against GET /api/v1/gameStatus"), not behaviour.
- `snapquast73-boop/…` hard-coded links remain **only** in `README.md`, `flagged.html`, `docs/*`,
  `audit/*` — all deliberate provenance / manual-review links to the reference repository and its Pages
  site. Kept unchanged on purpose.
- `assets/css/style.css` contains no repo-specific references.
- `server.mjs` binds `0.0.0.0`, port from `PORT` (default 8000) — suitable for a local/hosted preview.
- `.github/workflows/site-check.yml` runs `npm ci` (lock file present) and `npm test`;
  `pages-delivery.yml` verifies the deployed Pages build against the merged SHA via `gh api repos/…/pages`. Both unchanged.
- Reference `COORDINATION.md` and the source repo's Pages URL references inside carried-over documents
  are historical records, not active configuration.

Irregularities logged (see "Irregularities" below): F-COPY-1 … F-COPY-6, plus the carried-over
reference list (U-* and I-* on `flagged.html`).

### 2026-11-25T20:50Z — `arena-6abe8874` — official-source spot checks (T-4)

Performed against the official MLB StatsAPI (links below open the exact requests):

- `GET /api/v1/schedule?sportId=1&date=2026-08-26&…` — **15 games**, Final; includes **gamePk 823096**
  (Philadelphia Phillies 6 @ Seattle Mariners 0, T-Mobile Park) and **gamePk 823180** (Cincinnati Reds
  10 @ San Francisco Giants 9, Oracle Park) — matching the reference site's render for the same date.
  <https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=2026-08-26&hydrate=probablePitcher,linescore,decisions,review>
- `GET /api/v1/schedule?sportId=1&date=2026-11-25` — `totalGames: 0` (offseason). The site's
  empty-slate path (and "most recent date with games" helper) covers this; upcoming MLB dates with
  games exist again from 2027-02-19 (spring training) —
  <https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=2026-11-25&endDate=2027-04-15&fields=dates,date,totalGames>
- `GET /api/v1/gameStatus` — registry live; spot-checked rows match the parser's fallback table in
  `assets/js/reviews.js` (`IH` → "Instant Replay"/"Review", `MF` → "Manager challenge: Close play at
  1st", `MA` → "Manager challenge: Tag play", …). <https://statsapi.mlb.com/api/v1/gameStatus>
- Full line-by-line field verification of the parser/fixture set was performed on the reference on
  2026-11-20 (T-1…T-11) and 2026-11-22 (audit); those reports and their official-source links are
  carried over unchanged in `docs/verification-report.md`, `docs/statsapi-field-map.md` and
  `flagged.html`. Nothing in the copy changes that code path.

---

## Irregularities

### Found in this copy (2026-11-25)

| # | Item | Status | Why it is irregular / resolution |
|---|------|--------|----------------------------------|
| F-COPY-1 | `v1.0.0-stable-checkpoint` tag referenced by the copied README checkpoint notice | Resolved in docs | The tag exists only on `snapquast73-boop/LIVPBP`, not here. README now states this copy's baseline is the copy PR's merge commit. |
| F-COPY-2 | `flagged.html` / `docs/*` / `audit/*` cite the source repo (`snapquast73-boop/LIVPBP*`) throughout | Kept deliberately | They are the manual-review evidence trail for the carried-over verification. Kept verbatim; a COPY banner was prepended to `flagged.html`. |
| F-COPY-3 | Reference `COORDINATION.md` (89 KB) not carried over | Kept out deliberately | It records another repository's sessions; this board replaces it. Link to the source board is in the header above. |
| F-COPY-4 | `flagged.html` and `docs/verification-report.md` describe "this rebuild" / branch `arena/f7276bda-livpbp` of the **source** repo | Kept as historical record | Rewriting them would falsify the review record. The COPY banner + this board identify the current repository. |
| F-COPY-5 | `pages-delivery.yml` only verifies Pages output on `workflow_run` of the Pages deployment; Pages must be enabled for this repo first | Handled in T-8 | Pages is enabled (legacy, `main` `/`) as part of the integration flow; see Deploy record. |
| F-COPY-6 | `2026-11-25` is an offseason date — the schedule API returns 0 games; reference site behaviour for such dates is an empty state plus a "most recent date with games" suggestion | Not a defect | Confirmed against the official API (T-4). The site renders the empty state; live behaviour resumes on game days (next MLB dates: 2027-02-19). |

### Carried over from the source repository (not re-verified here, published on `flagged.html`)

The full, linked list lives on the site's **⚑ Flagged for Review** page
(<https://kanlerxz87-cyber.github.io/Alert5/flagged.html>) and in `docs/verification-report.md` /
`audit/`. Highlights: U-1 (TEAM_COLORS palette — presentation only, not an official source), U-2
(hit-model constants), U-3/U-4 (server defects, fixed on the reference), U-6/U-7 (original upstream
`buffedlizard55-lab/MLB-Live-PBP` is 404; assets were reconstructed, not restored), U-8…U-11,
I-1…I-9 (see `flagged.html` for the complete tables and official links). **None of these block the
merge**; they are the queue for post-launch review.

---

## Verification — official sources used for this copy

| # | What | Official source |
|---|------|-----------------|
| V-1 | Reference site behaviour for 2026-08-26 (15 games; gamePks 823096/823180; render target) | <https://snapquast73-boop.github.io/LIVPBP/reviews.html?date=2026-08-26> |
| V-2 | 2026-08-26 schedule identical to the reference render (15 games, same gamePks, PHI 6–SEA 0, CIN 10–SF 9) | <https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=2026-08-26&hydrate=probablePitcher,linescore,decisions,review> |
| V-3 | 2026-11-25 slate is empty (offseason) | <https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=2026-11-25> |
| V-4 | Upcoming game days exist again from 2027-02-19 | <https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=2026-11-25&endDate=2027-04-15&fields=dates,date,totalGames> |
| V-5 | Game-status / review-code registry (IH, M*, N*, MJ/NJ) | <https://statsapi.mlb.com/api/v1/gameStatus> |
| V-6 | Official scoring changes policy | <https://www.mlb.com/official-information/scoring-changes> |
| V-7 | Reference verification report (field-by-field, 2026-11-20) with per-row links | [`docs/verification-report.md`](docs/verification-report.md) |
| V-8 | Reference field map + audit (2026-11-22) | [`docs/statsapi-field-map.md`](docs/statsapi-field-map.md) · [`audit/`](audit/) |

Nothing in the copy's code path was changed relative to the reference except the six identity
substitutions listed in the task board (T-2); test fixtures are the reference fixtures (values copied
verbatim from official StatsAPI responses).

---

## PR & deploy record

| Step | Result |
|------|--------|
| Branch | `arena/6abe8874-alert5` (from `e8ce3cc`) |
| Pull request | _(recorded in PR record PR-1 below)_ |
| Merge commit | _(recorded in PR record PR-2 below)_ |
| GitHub Pages | _(recorded in PR record PR-2 below)_ |
| Live site | _(recorded in PR record PR-2 below)_ |
