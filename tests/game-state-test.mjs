#!/usr/bin/env node
/* ============================================================================
 * game-state-test.mjs — the captured official state, checked against a real
 * StatsAPI payload.
 *
 * Fixture: tests/fixtures/feed-824638-capture.json — copied verbatim from
 *   GET /api/v1.1/game/824638/feed/live?timecode=20260828_203856&fields=<...>
 * (see the _provenance block inside it).  No hand-written expectations about
 * the API shape live in this file: every value is read back from the fixture.
 * ==========================================================================*/
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const sandbox = { window: {}, console, Date, Math, JSON, Object, Array, Number, String, parseInt, isNaN };
sandbox.window = sandbox;
sandbox.global = sandbox;
vm.createContext(sandbox);
for (const f of ['assets/js/ui.js', 'assets/js/reviews.js', 'assets/js/game-state.js']) {
  vm.runInContext(read(f), sandbox, { filename: f });
}
const GS = sandbox.GameState;
if (!GS) fail('GameState did not load');

const feed = JSON.parse(read('tests/fixtures/feed-824638-capture.json'));
const ls = feed.liveData.linescore;

let failures = 0;
const ok = (cond, label) => {
  if (cond) console.log('  ok  ' + label);
  else { failures += 1; console.log('  FAIL ' + label); }
};
function fail(msg) { console.log('FAIL ' + msg); process.exit(1); }

console.log('game-state: capture from the official payload');

const snap = GS.snapshot(feed, { capturedAt: 1000, latencyMs: 42 });

/* 1. the stamp is the API's own, not the browser's */
ok(snap.apiTimeStamp === feed.metaData.timeStamp,
  `apiTimeStamp is metaData.timeStamp (${snap.apiTimeStamp})`);
ok(snap.apiTimeStampIso === '2026-08-28T20:38:56.000Z',
  `...and converts to an ISO second (${snap.apiTimeStampIso}) — the timezone is the API's, not the browser's`);
ok(GS.timeStampToMs('20260828_203856') === Date.parse('2026-08-28T20:38:56Z'),
  'timeStampToMs round-trips a DST-free UTC second');
ok(GS.timeStampToMs('not-a-stamp') === null, 'a malformed stamp is null, never NaN');

/* 2. every captured value comes from the payload */
ok(snap.score.away === ls.teams.away.runs && snap.score.home === ls.teams.home.runs,
  `score is the official running score (${snap.score.away}-${snap.score.home}), not the at-bat's score`);
ok(snap.score.away !== feed.liveData.plays.allPlays.slice(-1)[0].result.awayScore,
  'the last at-bat\'s score is deliberately NOT used as the running score');
ok(snap.score.awayHits === 12 && snap.score.homeErrors === 2,
  'hits and errors come from the same official linescore block');
ok(snap.score.source === 'liveData.linescore.teams', 'the capture records where the score came from');
ok(snap.inning.number === ls.currentInning && snap.inning.half === ls.inningState,
  `inning (${snap.inning.number} ${snap.inning.half}) is the official linescore value`);
ok(snap.count.balls === ls.balls && snap.count.strikes === ls.strikes && snap.count.outs === ls.outs,
  `count ${snap.count.balls}-${snap.count.strikes}, ${snap.count.outs} out(s)`);
ok(snap.batter.name === ls.offense.batter.fullName, `batter (${snap.batter.name})`);
ok(snap.pitcher.name === ls.offense.pitcher.fullName, `pitcher (${snap.pitcher.name})`);
ok(snap.onDeck.name === ls.offense.onDeck.fullName, `on deck (${snap.onDeck.name})`);
ok(snap.inHole.name === ls.offense.inHole.fullName, `in the hole (${snap.inHole.name})`);
ok(snap.bases.first && snap.bases.first.name === ls.offense.first.fullName,
  `runner on first (${snap.bases.first.name})`);
ok(snap.bases.second === null && snap.bases.third && snap.bases.third.name === ls.offense.third.fullName,
  'second empty, third occupied — the diamonds are read, not guessed');
ok(snap.status.codedGameState === 'I' && snap.status.abstractGameState === 'Live',
  `status is the official coded state (${snap.status.codedGameState}), not a rendered string`);
ok(snap.review === null,
  'a game merely In Progress carries no review — the capture does not invent one');

/* A review is only open when the API says so in statusCode: M*, N* or IH. */
const reviewing = JSON.parse(JSON.stringify(feed));
reviewing.gameData.status = { abstractGameState: 'Live', codedGameState: 'I', detailedState: 'Manager challenge',
  statusCode: 'MA', reason: 'CIN manager challenged the safe call at first base' };
const reviewSnap = GS.snapshot(reviewing);
ok(reviewSnap.review && reviewSnap.review.code === 'MA',
  `statusCode MA opens a review (${reviewSnap.review && reviewSnap.review.typeLabel})`);
ok(reviewSnap.review.isABS === false, 'a manager challenge is not an ABS challenge');
const openDiff = GS.diff(snap, reviewSnap);
ok(openDiff.changes.some((c) => c.kind === 'reviewOpen'),
  'differential: review opening is a reviewOpen change');
ok(openDiff.changes.some((c) => c.kind === 'reviewClose') === false, 'with nothing to close');
const closed = GS.snapshot(feed);
const closeDiff = GS.diff(reviewSnap, closed);
ok(closeDiff.changes.some((c) => c.kind === 'reviewClose'),
  'differential: returning to the live state is a reviewClose change with the resolution wording');
const closeChange = closeDiff.changes.find((c) => c.kind === 'reviewClose');
ok(/resolved/.test(closeChange.text) && closeChange.before.code === 'MA',
  `close change keeps both wordings: "${closeChange.text}"`);
ok(snap.counters.abs.away.remaining === 2 && snap.counters.manager.home.remaining === 1,
  'the official challenge counters are captured (ABS counter is flat: absChallenges.away)');
ok(snap.counters.manager.away.used === 0 && snap.counters.manager.home.used === 0,
  'manager challenge usage captured per team');
ok(snap.progress.playsComplete === 38, `all ${snap.progress.playsComplete} completed at-bats seen`);

/* 3. the feed itself is not trusted for time or the pitcher */
const noPitcher = JSON.parse(JSON.stringify(feed));
delete noPitcher.liveData.linescore.offense.pitcher;
noPitcher.liveData.linescore.defense = { pitcher: { id: 1, fullName: 'Archive Pitcher' } };
ok(GS.snapshot(noPitcher).pitcher.name === 'Archive Pitcher',
  'an archived payload falls back to linescore.defense.pitcher, never to the batting matchup');

/* 4. the diff is what the alert layer acts on */
const next = JSON.parse(JSON.stringify(feed));
next.metaData.timeStamp = '20260828_203910';
next.liveData.linescore.balls = 2;
next.liveData.linescore.outs = 2;
next.liveData.linescore.offense.pitcher = { id: 650644, fullName: 'Aaron Civale' };
next.liveData.linescore.offense.first = null;
next.liveData.linescore.offense.third = null;
next.gameData.status.detailedState = 'In Progress';
const snap2 = GS.snapshot(next, { capturedAt: 3000 });
const d = GS.diff(snap, snap2);
ok(d.changes.some((c) => c.kind === 'count' && /2-1/.test(c.text + c.after)),
  'a ball in the count produces a count change with before and after');
ok(d.changes.some((c) => c.kind === 'bases'), 'a stolen base / runner removal produces a bases change');
ok(d.changes.every((c) => c.apiTimeStamp === '20260828_203910'),
  'every change is stamped with the API second it was observed at');
ok(GS.signatureOf(snap) !== GS.signatureOf(snap2), 'the render signature changes with the state');
ok(GS.diff(snap, snap).changes.length === 0, 'no change between two reads of the same second');

/* 5. wording helpers never invent a value — each takes its own official slice */
ok(GS.scoreText(snap.score) === '9–3', `scoreText(score) → ${GS.scoreText(snap.score)}`);
ok(GS.scoreText(null) === '—', 'no score renders an em dash, never "undefined"');
ok(GS.inningText(snap.inning) === 'Bot 7 (7th)', `inningText(inning) → ${GS.inningText(snap.inning)}`);
ok(GS.countText(snap.count) === '1-1, 2 outs', `countText(count) → ${GS.countText(snap.count)}`);
ok(GS.countText({ balls: 3, strikes: 2, outs: 1 }) === '3-2, 1 out', 'one out is singular');
ok(GS.basesText(snap.bases) === '1B Pete Crow-Armstrong · 3B Carson Kelly',
  `basesText(bases) → ${GS.basesText(snap.bases)}`);
ok(GS.basesText(snap2.bases) === 'bases empty', 'an emptied diamond says so instead of listing nothing');
ok(GS.describe(snap) === 'Bot 7 (7th) · 9–3 · 1-1, 2 outs · AB: Pete Crow-Armstrong · P: Aaron Civale',
  `describe() reads as one line: ${GS.describe(snap)}`);

console.log(failures ? `\ngame-state-test: ${failures} FAILURE(S)` : '\ngame-state-test: OK');
process.exit(failures ? 1 : 0);
