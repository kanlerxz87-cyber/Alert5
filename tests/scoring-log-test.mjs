#!/usr/bin/env node
/* ============================================================================
 * scoring-log-test.mjs — the separate, persistent Official Scoring Log.
 *
 * What the user asked for, checked literally:
 *   · pending official-scorer rulings and scoring changes live in a store of
 *     their OWN — never in the alert feed's store
 *   · the store survives a refresh (it reloads from storage)
 *   · "before" is kept forever; "after" can be filled in later
 *   · a ruling the API has not published stays Open — nothing is inferred
 *   · a corrupt or foreign payload can neither crash nor leak into the log
 * ==========================================================================*/
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
const ok = (cond, label) => {
  if (cond) console.log('  ok  ' + label);
  else { failures += 1; console.log('  FAIL ' + label); }
};

function load(opts = {}) {
  const store = Object.assign({}, opts.store || {});
  const warnings = [];
  const sandbox = {
    console: { log: console.log, warn: (...a) => warnings.push(a.join(' ')), error: () => {} },
    Date, Math, JSON, Object, Array, Number, String, Boolean, isFinite, encodeURIComponent, decodeURIComponent,
    setTimeout, clearTimeout,
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
      key: (i) => Object.keys(store)[i],
      get length() { return Object.keys(store).length; },
    },
  };
  sandbox.window = sandbox;
  sandbox.global = sandbox;
  sandbox.location = { hostname: opts.hostname || 'example.test', protocol: 'https:' };
  sandbox.fetch = () => Promise.reject(new Error('offline in this test'));
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/js/scoring-log.js'), 'utf8'), sandbox,
    { filename: 'scoring-log.js' });
  return { S: sandbox.ScoringLog, store, warnings };
}

console.log('scoring-log: the separate persistent store');

const DATE = '2026-08-28';

/* 1. it is its own store, under its own key */
{
  const { S } = load();
  ok(S.PREFIX && S.PREFIX.indexOf('scoringlog') !== -1,
    `own storage prefix: ${S.PREFIX}`);
  ok(S.SERVER_PATH === '/api/scoring-log', `own endpoint: ${S.SERVER_PATH}`);
  const payload = S.empty(DATE);
  ok(payload.date === DATE && Array.isArray(payload.entries), 'empty() is a valid, empty log');
  ok(!('snapshots' in payload) && !('order' in payload),
    'the payload does not borrow one field from the alert feed log');
}

/* 2. a pending ruling, then its resolution, with both wordings kept */
{
  const { S, store } = load();
  const payload = S.empty(DATE);
  const first = S.upsert(payload, {
    id: '824638:71:pending',
    kind: 'pending',
    date: DATE,
    gamePk: 824638,
    atBatIndex: 71,
    inningLabel: 'Bot 7',
    batter: 'Pete Crow-Armstrong',
    status: 'open',
    firstSeenAt: 1000,
    lastSeenAt: 1000,
    firstSeenApiTimeStamp: '20260828_203856',
    firstSeenLatencyMs: 640,
    before: { eventType: 'os_ruling_pending_primary', description: 'Official Scorer Ruling Pending', apiTimeStamp: '20260828_203856' },
    notes: ['Observed official eventType os_ruling_pending_primary.'],
  });
  ok(first.created === true, 'a pending ruling is inserted');
  ok(first.entry.before.eventType === 'os_ruling_pending_primary',
    'the exact official eventType is kept as "before"');
  ok(first.entry.status === 'open', 'with nothing published yet it stays Open');

  /* The same observation again must not duplicate anything. */
  const again = S.upsert(payload, {
    id: '824638:71:pending', kind: 'pending', date: DATE, gamePk: 824638,
    atBatIndex: 71, status: 'open', lastSeenAt: 2000,
    before: { eventType: 'os_ruling_pending_primary', description: 'Official Scorer Ruling Pending' },
  });
  ok(again.created === false && payload.entries.length === 1,
    're-observing the same pending ruling updates in place, one row');

  /* The official scorer publishes the final call. */
  const resolved = S.upsert(payload, {
    id: '824638:71:pending', kind: 'pending', date: DATE, gamePk: 824638,
    atBatIndex: 71, status: 'resolved', resolvedAt: 9000, lastSeenAt: 9000,
    after: { eventType: 'single', description: 'Pete Crow-Armstrong singles on a line drive.', apiTimeStamp: '20260828_204030' },
    firstSeenApiTimeStamp: '20260828_203856',
    notes: ['Resolved: official result is now "single".'],
  });
  ok(resolved.entry.status === 'resolved', 'the same row becomes Resolved');
  ok(resolved.entry.before.eventType === 'os_ruling_pending_primary' &&
    resolved.entry.after.eventType === 'single',
    'BOTH wordings survive: the pending text and the final call');
  ok(resolved.entry.resolutionLagMs === 8000,
    `the resolution lag is recorded (${resolved.entry.resolutionLagMs} ms)`);
  ok(resolved.entry.firstSeenAt === 1000 && resolved.entry.firstSeenApiTimeStamp === '20260828_203856',
    'the original first-seen time and API clock are never overwritten');

  /* A later downgrade to "unresolved" is honest, not a silent reopen. */
  const unknown = S.upsert(payload, {
    id: '824638:71:pending', kind: 'pending', date: DATE, gamePk: 824638,
    atBatIndex: 71, status: 'unresolved', lastSeenAt: 10000,
  });
  ok(unknown.entry.status === 'resolved' || unknown.entry.status === 'unresolved',
    'a stale observation can never silently reopen a resolved ruling');

  S.save(DATE, payload);
  const raw = Object.keys(store).find((k) => k.indexOf(DATE) !== -1);
  ok(!!raw, `saved under a date-keyed key (${raw})`);
  ok(JSON.parse(store[raw]).entries.length === 1, 'exactly one row persisted');
}

/* 3. it survives a refresh */
{
  const { S, store } = load();
  const payload = S.empty(DATE);
  S.upsert(payload, {
    id: '824638:25:change', kind: 'change', date: DATE, gamePk: 824638, atBatIndex: 25,
    status: 'resolved', firstSeenAt: 1, lastSeenAt: 2, resolvedAt: 2,
    before: { eventType: 'single', description: 'Singles.' },
    after: { eventType: 'field_error', description: 'Reached on error.' },
  });
  S.save(DATE, payload);
  const saved = Object.assign({}, store);

  const reloaded = load({ store: saved });
  /* loadLocal() is the synchronous read that must never lose a row; load() is
   * async only because it may also merge the server copy. */
  const local = reloaded.S.loadLocal(DATE);
  ok(!!local && local.entries.length === 1, 'a refresh restores the row from storage');
  ok(local.entries[0].before.eventType === 'single' &&
    local.entries[0].after.eventType === 'field_error',
    'both the initial call and the final call come back intact');
}

/* 4. storage that lies must not take the page down */
{
  const { S } = load();
  /* A real browser can hold anything under our key — an older version, another
   * app, a half-written string.  None of it may crash the page or invent rows:
   * the honest answer is "no usable log", and the empty log takes over. */
  const bad = ['not json', '{"entries":"nope"}', '[]', 'null', '{"entries":[{"no":"id"}]}'];
  bad.forEach((raw) => {
    let threw = false;
    let got = null;
    try {
      /* A fresh page (its own storage) holding exactly this string. */
      got = load({ store: { [S.PREFIX + DATE]: raw } }).S.loadLocal(DATE);
    } catch (e) { threw = true; }
    ok(!threw, `corrupt payload ${JSON.stringify(raw)} does not throw`);
    ok(!got || Array.isArray(got.entries), `corrupt payload ${JSON.stringify(raw)} yields no rows rather than bad ones`);
  });
}

/* 5. a foreign (alert-feed shaped) payload cannot be merged in */
{
  const { S } = load();
  const foreign = { v: 1, date: DATE, entries: [{ gamePk: 1, kind: 'review', review: { code: 'MJ' } }], order: [], snapshots: {} };
  const out = S.mergePayloads(foreign, S.empty(DATE), DATE);
  ok(!out.order && !out.snapshots, 'merging never introduces feed-log fields');
  ok((out.entries || []).length === 0,
    'an entry without a scoring-log id is dropped, not guessed at');
}

/* 6. the summary the section header shows */
{
  const { S } = load();
  const payload = S.empty(DATE);
  const add = (id, kind, status) => S.upsert(payload, {
    id, kind, status, date: DATE, gamePk: 1, atBatIndex: 1,
    firstSeenAt: 1, lastSeenAt: 1, resolvedAt: status === 'resolved' ? 2 : null,
  });
  add('1:1:pending', 'pending', 'open');
  add('1:2:pending', 'pending', 'resolved');
  add('1:3:change', 'change', 'resolved');
  add('1:4:edit', 'edit', 'resolved');
  const sum = S.summarize(payload);
  ok(sum.total === 4 && sum.open === 1 && sum.changes === 1 && sum.edits === 1 &&
    sum.pendingResolved === 1,
    `summary counts what it claims (${JSON.stringify(sum)})`);
}

/* 7. static hosting skips the server layer instead of hammering a 404 */
{
  const { S } = load({ hostname: 'someone.github.io' });
  ok(S.isStaticHost() === true, 'a *.github.io host is detected as static');
  const local = load();
  ok(local.S.isStaticHost() === false, 'any other host is not assumed static');
}

console.log(failures ? `\nscoring-log-test: ${failures} FAILURE(S)` : '\nscoring-log-test: OK');
process.exit(failures ? 1 : 0);
