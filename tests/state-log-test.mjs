#!/usr/bin/env node
/* tests/state-log-test.mjs — the live game state, the separate official-scoring
 * log, the alert sound module and the request budget.
 *
 * Everything runs against the SHIPPED files: assets/js/game-state.js,
 * assets/js/scoring-log.js, assets/js/alert-sound.js and assets/js/api.js are
 * loaded into a jsdom window (or a minimal stub window for the pure helpers),
 * never re-implemented here.
 *
 * Payload shapes are copied from tests/fixtures/feed-824638-review.json, whose
 * own `_provenance` block records the official responses they came from.
 *
 *   node tests/state-log-test.mjs
 *
 * jsdom is a dev-only dependency; without it this prints SKIPPED and exits 0.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let JSDOM;
for (const candidate of [process.env.JSDOM_PATH, 'jsdom', '/tmp/jsdo/node_modules/jsdom/lib/api.js']) {
  if (!candidate) continue;
  try {
    const mod = await import(candidate);
    JSDOM = mod.JSDOM || (mod.default && mod.default.JSDOM);
    if (JSDOM) break;
  } catch { /* try the next candidate */ }
}
if (!JSDOM) {
  console.error('state-log-test: SKIPPED — jsdom is not installed (npm install --no-save jsdom)');
  process.exit(0);
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = (n) => JSON.parse(readFileSync(path.join(ROOT, 'tests', 'fixtures', n), 'utf8'));
const feed = FIX('feed-824638-review.json');

const passes = [];
const failures = [];
async function check(name, fn) {
  try {
    await fn();
    passes.push(name);
    console.log('  ✓ ' + name);
  } catch (err) {
    failures.push(name + ' — ' + err.message);
    console.log('  ✗ ' + name + ' — ' + err.message);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

/* Load the shipped modules into a jsdom window with the smallest possible DOM
 * and a recording AudioContext, so the sound path is executed, not mocked out. */
function makeWindow() {
  const dom = new JSDOM('<!doctype html><html><body><span id="sound-state"></span></body></html>', {
    url: 'http://127.0.0.1/reviews.html',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const w = dom.window;
  const calls = { oscillators: 0, starts: [], contexts: 0 };

  class FakeParam {
    constructor(value) { this.value = value; }
    setValueAtTime() { return this; }
    exponentialRampToValueAtTime() { return this; }
    linearRampToValueAtTime() { return this; }
  }
  class FakeNode {
    constructor() { this.gain = new FakeParam(1); this.frequency = new FakeParam(0); this.Q = new FakeParam(1); this.delayTime = new FakeParam(0); this.pan = new FakeParam(0); }
    connect() { return this; }
    disconnect() { return this; }
  }
  class FakeCtx {
    constructor() { calls.contexts += 1; this.currentTime = 0; this.state = 'suspended'; this.destination = new FakeNode(); }
    resume() { this.state = 'running'; return Promise.resolve(); }
    createGain() { return new FakeNode(); }
    createBiquadFilter() { return new FakeNode(); }
    createDelay() { return new FakeNode(); }
    createStereoPanner() { return new FakeNode(); }
    createOscillator() {
      calls.oscillators += 1;
      const node = new FakeNode();
      node.type = 'sine';
      node.start = (at) => { calls.starts.push(at); };
      node.stop = () => {};
      return node;
    }
  }
  w.AudioContext = FakeCtx;
  w.fetch = () => Promise.resolve({ ok: false, status: 404, json: async () => ({}) });

  const load = (file) => {
    const code = readFileSync(path.join(ROOT, 'assets', 'js', file), 'utf8');
    w.eval(code);
  };
  load('api.js');
  load('game-state.js');
  load('scoring-log.js');
  load('alert-sound.js');
  return { dom, w, calls };
}

/* A payload with an in-progress at-bat, a pending official-scorer ruling and a
 * completed play, in the official shapes. */
function playsWithPending() {
  const plays = JSON.parse(JSON.stringify(feed.liveData.plays.allPlays));
  plays.push({
    about: { atBatIndex: 99, inning: 8, halfInning: 'top', isTopInning: true, isComplete: false },
    result: { eventType: 'os_ruling_pending_primary', description: 'Official Scorer Ruling Pending', awayScore: 10, homeScore: 8, isOut: false },
    count: { balls: 0, strikes: 0, outs: 2 },
    matchup: { batter: { id: 1, fullName: 'Pending Batter' }, pitcher: { id: 2, fullName: 'Pending Pitcher' } },
    runners: [],
    playEvents: [
      { index: 0, isPitch: true, count: { balls: 0, strikes: 0, outs: 2 }, details: { description: 'In play, no out recorded' } },
    ],
  });
  return plays;
}

console.log('\n[1] game-state.js — official state capture, diff and ledger');
{
  const { dom, w } = makeWindow();
  const GameState = w.GameState;
  const plays = playsWithPending();
  const t0 = 1700000000000;
  const snap = GameState.snapshot(feed, plays, { at: t0, gamePk: 824638, source: 'test' });

  await check('snapshot captures score, inning, count, outs, pitch count, batter, pitcher, bases', () => {
    assert(snap.gamePk === 824638, 'gamePk');
    assert(snap.score.away === 10 && snap.score.home === 8, 'score ' + JSON.stringify(snap.score));
    assert(snap.inning.number === 9 && snap.inning.half === 'Bottom', 'inning ' + JSON.stringify(snap.inning));
    assert(snap.count.balls === 1 && snap.count.strikes === 1, 'count ' + JSON.stringify(snap.count));
    assert(snap.count.outs === 3, 'outs');
    assert(snap.pitchCount.total === 1, 'pitch count should count isPitch events, got ' + snap.pitchCount.total);
    assert(GameState.nameOf(snap.batter) === 'Pending Batter', 'batter ' + GameState.nameOf(snap.batter));
    assert(GameState.nameOf(snap.pitcher) === 'Pending Pitcher', 'pitcher ' + GameState.nameOf(snap.pitcher));
    assert(GameState.baseText(snap.bases) === 'empty', 'bases ' + GameState.baseText(snap.bases));
  });

  await check('snapshot is timestamped to the second and ISO-stamped', () => {
    assert(snap.at === t0, 'at');
    assert(snap.capturedAtISO === new Date(t0).toISOString(), 'ISO ' + snap.capturedAtISO);
  });

  await check('first observation produces no diff rows (nothing is invented)', () => {
    assert(GameState.diff(null, snap).length === 0, 'expected no rows for a first capture');
  });

  await check('diff names score / count / pitcher / review transitions in words', () => {
    const next = JSON.parse(JSON.stringify(snap));
    next.at = t0 + 1000;
    next.score = { away: 11, home: 8 };
    next.count = { balls: 2, strikes: 1, outs: 2 };
    next.pitcher = { id: 3, name: 'New Pitcher' };
    next.inReview = true;
    const rows = GameState.diff(snap, next);
    const byField = Object.fromEntries(rows.map((r) => [r.field, r]));
    assert(byField.score, 'score row missing');
    assert(byField.score.text.includes('→'), 'score text should show before → after: ' + byField.score.text);
    assert(byField.count, 'count row missing');
    assert(byField.pitcher && byField.pitcher.text.includes('New Pitcher'), 'pitcher row: ' + JSON.stringify(byField.pitcher));
    assert(byField.review && /Review opened/.test(byField.review.text), 'review row: ' + JSON.stringify(byField.review));
    assert(byField.outs, 'outs row missing');
  });

  await check('record() persists the baseline, the snapshot ring and the transitions', () => {
    const store = GameState.createStore({ local: true });
    const bucket = GameState.record(store, '2026-08-28', snap, [], null);
    assert(bucket.games['824638'].at === t0, 'baseline not stored');
    assert(bucket.snapshots['824638'].length === 1, 'ring');
    const next = JSON.parse(JSON.stringify(snap));
    next.at = t0 + 1000;
    next.score = { away: 11, home: 8 };
    const rows = GameState.diff(snap, next);
    const after = GameState.record(store, '2026-08-28', next, rows, null);
    assert(after.transitions.length >= 1, 'transition not recorded');
    assert(after.transitions[0].field === 'score', 'transition field ' + after.transitions[0].field);
    const reread = store.read('2026-08-28');
    assert(reread.games['824638'].score.away === 11, 'read-back baseline');
  });

  await check('record() is idempotent for the same capture timestamp', () => {
    w.localStorage.clear();
    const store = GameState.createStore({ local: true });
    const b1 = GameState.record(store, '2026-08-28', snap, [], null);
    const b2 = GameState.record(store, '2026-08-28', snap, [], null);
    assert(b2.transitions.length === b1.transitions.length, 'a repeated capture added transitions');
    assert(b2.snapshots['824638'].length === 1, 'a repeated capture duplicated a snapshot');
  });

  await check('the snapshot ring is throttled but still records every score change', () => {
    const store = GameState.createStore({ local: true });
    let bucket = GameState.record(store, '2026-08-28', snap, [], { ringMinMs: 1000 });
    for (let i = 1; i <= 6; i += 1) {
      const next = JSON.parse(JSON.stringify(snap));
      next.at = t0 + i * 250;                       // a 250 ms scan
      next.count = { balls: (snap.count.balls + i) % 3, strikes: 1, outs: 3 };
      const rows = GameState.diff(snap, next);
      bucket = GameState.record(store, '2026-08-28', next, rows, { ringMinMs: 1000 });
    }
    assert(bucket.snapshots['824638'].length <= 3,
      '250 ms captures must not each add a ring entry, got ' + bucket.snapshots['824638'].length);
    const next = JSON.parse(JSON.stringify(snap));
    next.at = t0 + 5000;
    next.score = { away: 12, home: 8 };
    const rows = GameState.diff(snap, next);
    bucket = GameState.record(store, '2026-08-28', next, rows, { ringMinMs: 1000 });
    const ring = bucket.snapshots['824638'];
    assert(ring[ring.length - 1].score.away === 12, 'a score change must always be recorded in the ring');
  });

  await check('pending ruling becomes a ledger row and resolves without losing its wording', () => {
    const store = GameState.createStore({ local: true });
    const bucket = GameState.emptyBucket('2026-08-28');
    const row = GameState.ledgerRow({
      kind: 'pending',
      basis: 'primary event ruling pending',
      gamePk: 824638,
      atBatIndex: 99,
      at: t0,
      label: 'CIN @ CHC',
      inningLabel: 'Top 8',
      batter: 'Pending Batter',
      before: { eventType: 'os_ruling_pending_primary', description: 'Official Scorer Ruling Pending' },
      state: 'pending',
      sourceUrl: 'https://statsapi.mlb.com/api/v1/game/824638/playByPlay',
    });
    assert(GameState.addLedgerRow(bucket, row) === true, 'pending row not added');
    assert(bucket.ledger.length === 1, 'ledger length');
    row.state = 'resolved';
    row.resolved = { eventType: 'single', description: 'Batter singles.' };
    row.lastSeen = t0 + 5000;
    GameState.addLedgerRow(bucket, row);
    assert(bucket.ledger.length === 1, 're-observing a pending row must merge, not duplicate');
    assert(bucket.ledger[0].state === 'resolved', 'state should update to resolved');
    assert(bucket.ledger[0].before.eventType === 'os_ruling_pending_primary', 'first-seen wording must be kept');
    assert(bucket.ledger[0].lastSeen === t0 + 5000, 'lastSeen should advance');
    store.write('2026-08-28', bucket);
    const back = store.read('2026-08-28');
    assert(back.ledger.length === 1 && back.ledger[0].resolved.eventType === 'single', 'ledger did not survive a reload');
  });

  await check('mergeBuckets unions ledger + transitions and keeps the newest baseline', () => {
    const t1 = t0 + 10000;
    const a = {
      v: 1, date: '2026-08-28', savedAt: t0,
      games: { 1: { at: t0 } }, snapshots: { 1: [{ at: t0 }] },
      ledger: [{ gamePk: 1, kind: 'pending', atBatIndex: 5, basis: 'x', firstSeen: t0, lastSeen: t0, state: 'pending', history: [] }],
      transitions: [{ gamePk: 1, at: t0, field: 'score' }], seen: {},
    };
    const b = {
      v: 1, date: '2026-08-28', savedAt: t1,
      games: { 1: { at: t1 } }, snapshots: { 1: [{ at: t0 }, { at: t1 }] },
      ledger: [{ gamePk: 1, kind: 'pending', atBatIndex: 5, basis: 'x', firstSeen: t0, lastSeen: t1, state: 'resolved', history: [{ at: t1 }] }],
      transitions: [{ gamePk: 1, at: t1, field: 'count' }], seen: {},
    };
    const merged = GameState.mergeBuckets(a, b, '2026-08-28');
    assert(merged.ledger.length === 1, 'ledger rows duplicated: ' + merged.ledger.length);
    assert(merged.ledger[0].state === 'resolved' && merged.ledger[0].lastSeen === t1, 'merged ledger state');
    assert(merged.transitions.length === 2, 'transitions not unioned: ' + merged.transitions.length);
    assert(merged.games[1].at === t1, 'newest baseline should win');
    assert(merged.snapshots[1].length === 2, 'longer ring should win');
  });

  dom.window.close();
}

console.log('\n[2] scoring-log.js — the separate official-scoring section');
{
  const { dom, w } = makeWindow();
  const SL = w.ScoringLog;
  const t0 = 1700000000000;
  const bucket = {
    v: 1, date: '2026-08-28', games: {}, snapshots: {}, transitions: [], seen: {},
    ledger: [
      {
        gamePk: 824638, kind: 'scoring_change', atBatIndex: 46, basis: 'reclassified',
        firstSeen: t0, lastSeen: t0, state: 'observed', label: 'CIN @ CHC', inningLabel: 'Bot 6',
        batter: 'JJ Bleday', before: { eventType: 'single', description: 'Bleday singles.', rbi: 1, isOut: false },
        after: { eventType: 'field_error', description: 'Bleday reaches on an error.', rbi: 0, isOut: false },
        score: { away: 10, home: 8 }, sourceUrl: 'https://statsapi.mlb.com/api/v1/game/824638/playByPlay',
      },
      {
        gamePk: 824231, kind: 'pending', atBatIndex: 99, basis: 'primary event ruling pending',
        firstSeen: t0 - 1000, lastSeen: t0 - 1000, state: 'pending', label: 'LAD @ DET', inningLabel: 'Top 8',
        before: { eventType: 'os_ruling_pending_primary', description: 'Official Scorer Ruling Pending' },
        after: null, score: { away: 2, home: 1 },
      },
    ],
  };

  await check('rows() return newest first and split pending / change', () => {
    const rows = SL.rows(bucket);
    assert(rows.length === 2, 'rows ' + rows.length);
    assert(rows[0].kind === 'scoring_change', 'newest first');
    assert(SL.pending(rows).length === 1, 'pending split');
    assert(SL.changes(rows).length === 1, 'changes split');
    assert(SL.openPending(rows).length === 1, 'open pending');
  });

  await check('summary() counts both kinds, games and the last timestamp', () => {
    const s = SL.summary(SL.rows(bucket));
    assert(s.total === 2 && s.pending === 1 && s.openPending === 1 && s.changes === 1, JSON.stringify(s));
    assert(s.games === 2, 'games ' + s.games);
    assert(s.lastAt === t0, 'lastAt');
  });

  await check('fieldDiff() quotes both official wordings field by field', () => {
    const row = SL.rows(bucket).find((r) => r.kind === 'scoring_change');
    const diffs = SL.fieldDiff(row.before, row.after);
    const fields = diffs.map((d) => d.field);
    ['eventType', 'description', 'rbi'].forEach((f) => assert(fields.includes(f), 'missing ' + f + ' in ' + fields));
    const evt = diffs.find((d) => d.field === 'eventType');
    assert(evt.before === 'single' && evt.after === 'field_error', 'eventType before/after');
    assert(SL.changeText(row).includes('→'), 'changeText should show the arrow');
  });

  await check('csv() exports every row with both sides quoted', () => {
    const lines = SL.csv(SL.rows(bucket)).split('\n');
    assert(lines.length === 3, 'expected a header + 2 rows, got ' + lines.length);
    assert(lines[0].includes('before_event_type') && lines[0].includes('after_event_type'), 'header');
    assert(lines[1].includes('"single"') && lines[1].includes('"field_error"'), 'row values');
  });

  await check('json() export is parseable and fileStamp() names the file by date', () => {
    const parsed = JSON.parse(SL.json(SL.rows(bucket)));
    assert(parsed.rows.length === 2 && parsed.exportedAt, 'json export');
    assert(SL.fileStamp(bucket) === 'official-scoring-2026-08-28', 'file stamp ' + SL.fileStamp(bucket));
  });

  dom.window.close();
}

console.log('\n[3] alert-sound.js — the ~3 s raindrop, shared by every surface');
{
  const { dom, w, calls } = makeWindow();
  const A = w.AlertSound;

  await check('is off by default and remembers the choice', () => {
    assert(A.isEnabled() === false, 'default should be muted');
    A.setEnabled(true);
    assert(A.isEnabled() === true, 'toggle on');
    assert(w.localStorage.getItem('mlbp.pref.sound') === '1', 'preference not persisted');
    A.setEnabled(false);
    assert(w.localStorage.getItem('mlbp.pref.sound') === '0', 'preference not persisted off');
  });

  await check('preview() always plays, even while alerts are muted', () => {
    const before = calls.oscillators;
    assert(A.preview() === true, 'preview should play');
    assert(calls.oscillators > before, 'no oscillator was created');
  });

  await check('play() is silent while muted', () => {
    const before = calls.oscillators;
    assert(A.play('alert') === false, 'muted play must return false');
    assert(calls.oscillators === before, 'muted play created audio');
  });

  await check('the sound lasts about three seconds and stays below a shrill range', () => {
    A.setEnabled(true);
    calls.starts.length = 0;
    const before = calls.oscillators;
    assert(A.play('alert', { force: true }) === true, 'unmuted play should sound');
    const created = calls.oscillators - before;
    assert(created >= 5, 'expected the drop figure (>=5 oscillators), got ' + created);
    assert(A.state().lengthMs === 3000, 'documented length ' + A.state().lengthMs);
    assert(A.state().contextState === 'running', 'context should be resumed on play');
  });

  await check('the alert path has a cooldown so a burst is one sound', () => {
    A.setEnabled(true);
    A.play('alert', { force: true });
    const state = A.state();
    assert(state.cooldownMs >= 1000, 'cooldown ' + state.cooldownMs);
    assert(state.played >= 1, 'play count');
  });

  await check('state() reports a blocked/missing AudioContext instead of throwing', () => {
    const { dom: d2, w: w2 } = makeWindow();
    w2.AudioContext = undefined;
    w2.webkitAudioContext = undefined;
    w2.eval(readFileSync(path.join(ROOT, 'assets/js/alert-sound.js'), 'utf8'));
    w2.AlertSound.setEnabled(true);
    assert(w2.AlertSound.preview() === false, 'preview without a context must return false, not throw');
    assert(w2.AlertSound.state().blocked === true, 'blocked flag');
    d2.window.close();
    dom.window.close();
  });
}

console.log('\n[4] api.js — the request budget that bounds every poll cadence');
{
  const { dom, w } = makeWindow();
  const MLB = w.MLB;

  await check('each request class has a documented per-minute ceiling', () => {
    const profiles = MLB.BUDGET_PROFILES;
    ['live', 'idle', 'dormant'].forEach((name) => {
      assert(profiles[name], 'missing profile ' + name);
      ['status', 'pbp', 'feed', 'other'].forEach((cls) => {
        assert(typeof profiles[name][cls] === 'number' && profiles[name][cls] > 0, name + '.' + cls);
      });
    });
    assert(profiles.live.status >= profiles.live.pbp, 'status should be the fastest class');
    assert(profiles.live.pbp > profiles.dormant.pbp, 'dormant must be slower');
  });

  await check('the bucket refuses past the burst and reports it as a deferral, not an error', async () => {
    MLB.setBudgetProfile('live');
    const snap = MLB.budgetSnapshot();
    const burst = snap.classes.pbp.burst;
    let granted = 0;
    for (let i = 0; i < burst + 6; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      if (await MLB.budget('pbp', { waitMs: 0 })) granted += 1;
    }
    assert(granted <= burst + 1, 'burst granted ' + granted + ' of a documented ' + burst);
    assert(granted >= 1, 'no token was ever granted');
  });

  await check('deferrals surface as DeferredError and are never treated as failures', () => {
    const err = { deferred: true, name: 'DeferredError' };
    assert(MLB.isDeferred(err) === true, 'deferred flag not recognised');
    const real = new Error('boom');
    real.status = 500;
    assert(MLB.isDeferred(real) === false, 'a real error must not look deferred');
  });

  await check('a profile switch re-fills the buckets with the new ceiling', () => {
    MLB.setBudgetProfile('dormant');
    assert(MLB.budgetSnapshot().profile === 'dormant', 'profile');
    assert(MLB.budgetSnapshot().classes.status.perMinute === MLB.BUDGET_PROFILES.dormant.status, 'ceiling did not change');
    MLB.setBudgetProfile('live');
    assert(MLB.budgetSnapshot().classes.status.perMinute === MLB.BUDGET_PROFILES.live.status, 'ceiling did not come back');
  });

  await check('a 304 revalidation answers from the remembered body', async () => {
    MLB.resetBudget();
    const url = 'https://statsapi.mlb.com/api/v1/game/1/playByPlay';
    const body = { allPlays: [{ about: { atBatIndex: 0 } }] };
    let calls = 0;
    w.fetch = () => {
      calls += 1;
      if (calls === 1) {
        return Promise.resolve({
          ok: true, status: 200,
          headers: { get: (k) => (k === 'ETag' ? '"v1"' : null) },
          json: async () => JSON.parse(JSON.stringify(body)),
        });
      }
      return Promise.resolve({ ok: false, status: 304, headers: { get: () => null }, json: async () => ({}) });
    };
    const first = await MLB.getJSON(url, { cls: 'pbp', revalidate: true });
    assert(first.allPlays.length === 1, 'first body');
    const second = await MLB.getJSON(url, { cls: 'pbp', revalidate: true });
    assert(second.allPlays.length === 1, '304 should replay the cached body');
    assert(calls === 2, 'expected exactly two requests, got ' + calls);
  });

  await check('HTTP 429 drops the whole page to the idle ceiling', async () => {
    MLB.setBudgetProfile('live');
    w.fetch = () => Promise.resolve({ ok: false, status: 429, headers: { get: () => '2' }, json: async () => ({}) });
    await MLB.getJSON('https://statsapi.mlb.com/api/v1/schedule?x=1', { cls: 'other', retries: 0 })
      .then(() => { throw new Error('a 429 must reject'); })
      .catch((err) => { assert(err.status === 429, 'expected a 429 ApiError, got ' + err.message); });
    assert(MLB.budgetSnapshot().profile === 'idle', 'profile after a 429 should be idle');
    assert(MLB.quietRemainingMs() > 0, 'a quiet window should be set');
    MLB.setBudgetProfile('live');
  });

  dom.window.close();
}

console.log('\n========== summary ==========');
console.log(`${passes.length} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.error(' - ' + f);
  process.exit(1);
}
