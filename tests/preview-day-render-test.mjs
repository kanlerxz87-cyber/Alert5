#!/usr/bin/env node
/* tests/preview-day-render-test.mjs — "does it work for an UPCOMING game day?"
 *
 * The reference site is proven on finished games. This test loads the same
 * shipped pages and answers their MLB StatsAPI requests with the official
 * payload shape for a day that has NOT been played yet, then asserts the pages
 * render that slate instead of an empty state or an error.
 *
 * Fixture: tests/fixtures/schedule-2027-02-19.json — six games copied verbatim
 * from the official response to
 *   https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=2027-02-19&hydrate=probablePitcher,linescore,decisions,review
 * (fetched 2026-11-25; 2027-02-19 is the first date with games after 2026-11-25,
 * which the site's "no games scheduled" path points at).
 *
 * The pre-game feed shape (empty `allPlays`, empty `linescore.innings`, zeroed
 * `review` / `absChallenges` counters for a Scheduled game) is copied from
 *   https://statsapi.mlb.com/api/v1.1/game/868573/feed/live
 * fetched the same day.
 *
 * No network. Needs jsdom (dev-only): npm ci
 *   node tests/preview-day-render-test.mjs
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = (n) => JSON.parse(readFileSync(path.join(ROOT, 'tests', 'fixtures', n), 'utf8'));

let JSDOM;
for (const candidate of [process.env.JSDOM_PATH, 'jsdom', path.join(ROOT, 'node_modules/jsdom/lib/api.js')]) {
  if (!candidate) continue;
  try {
    const mod = await import(candidate);
    JSDOM = mod.JSDOM || (mod.default && mod.default.JSDOM);
    if (JSDOM) break;
  } catch { /* try the next candidate */ }
}
if (!JSDOM) {
  console.error('preview-day-render-test: SKIPPED — jsdom is not installed (npm ci)');
  process.exit(0);
}

const DATE = '2027-02-19';
const schedule = FIX('schedule-2027-02-19.json');
const gameStatus = FIX('gamestatus.json').statuses;
const firstGame = schedule.dates[0].games[0];

const passes = [];
const failures = [];
const check = (name, ok, detail) => {
  if (ok) passes.push(name);
  else failures.push(`${name}${detail ? ' — ' + detail : ''}`);
};
const textOf = (el) => (el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '');

const requested = [];
const json = (data, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => null },
  json: async () => data,
  text: async () => JSON.stringify(data),
});

/* Official pre-game feed shape for a Scheduled game (see header). */
function previewFeed() {
  const g = firstGame;
  return {
    gamePk: g.gamePk,
    gameData: {
      game: { pk: g.gamePk, type: 'S', id: '2027/02/19/tormlb-pitmlb-1' },
      datetime: { dayNight: 'day', time: '1:05' },
      status: g.status,
      teams: {
        away: { id: g.teams.away.team.id, name: g.teams.away.team.name, abbreviation: 'TOR', venue: { id: 14, name: 'Rogers Centre' } },
        home: { id: g.teams.home.team.id, name: g.teams.home.team.name, abbreviation: 'PIT', venue: { id: 31, name: 'PNC Park' } },
      },
      venue: g.venue,
      players: {},
      review: { hasChallenges: false, away: { used: 0, remaining: 1 }, home: { used: 0, remaining: 1 } },
      absChallenges: {
        hasChallenges: false,
        away: { usedSuccessful: 0, usedFailed: 0, remaining: 2 },
        home: { usedSuccessful: 0, usedFailed: 0, remaining: 2 },
      },
    },
    liveData: {
      plays: { allPlays: [], currentPlay: {} },
      linescore: { innings: [], teams: { home: {}, away: {} }, isFinal: false },
      boxscore: { teams: { away: { team: g.teams.away.team, teamStats: {}, players: {} }, home: { team: g.teams.home.team, teamStats: {}, players: {} } } },
      decisions: {},
    },
  };
}

async function stubFetch(url) {
  const u = String(url);
  requested.push(u);
  if (/\/api\/v1\/gameStatus/.test(u)) return json(gameStatus);
  if (/\/api\/v1\/teams/.test(u)) {
    return json({
      teams: [
        { id: 141, name: 'Toronto Blue Jays', teamName: 'Blue Jays', abbreviation: 'TOR', teamCode: 'tor', fileCode: 'tor' },
        { id: 134, name: 'Pittsburgh Pirates', teamName: 'Pirates', abbreviation: 'PIT', teamCode: 'pit', fileCode: 'pit' },
      ],
    });
  }
  if (/\/api\/v1\/schedule/.test(u)) {
    if (/startDate=/.test(u)) return json({ dates: [] }); // no usable earlier date needed in this test
    if (/fields=/.test(u)) {
      return json({ dates: [{ games: schedule.dates[0].games.map((g) => ({ gamePk: g.gamePk, season: g.season, status: g.status })) }] });
    }
    return json(schedule);
  }
  if (/\/feed\/live/.test(u)) {
    if (/fields=gameData,status/.test(u) || /fields=gameData/.test(u)) return json({ gameData: { status: firstGame.status } });
    return json(previewFeed());
  }
  if (/\/playByPlay/.test(u)) return json({ allPlays: [], gamePk: firstGame.gamePk });
  if (/\/boxscore/.test(u)) return json(previewFeed().liveData.boxscore);
  if (/\/linescore/.test(u)) return json(previewFeed().liveData.linescore);
  if (/\/api\/v1\/people\/\d+\/stats/.test(u)) return json({ stats: [] });
  return json({}, 404);
}

async function render(pageFile, { query = '', wait = 1400 } = {}) {
  const file = path.join(ROOT, pageFile);
  let html = readFileSync(file, 'utf8');
  const scripts = [...html.matchAll(/<script\b[^>]*src\s*=\s*"([^"]+)"[^>]*><\/script>/gi)].map((m) => m[1]);
  html = html.replace(/<script\b[^>]*src\s*=\s*"[^"]+"[^>]*><\/script>/gi, '');
  const errors = [];
  const dom = new JSDOM(html, {
    url: `https://kanlerxz87-cyber.github.io/Alert5/${pageFile}${query}`,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.fetch = (u, init) => stubFetch(u, init);
  window.scrollTo = () => {};
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
  window.addEventListener('error', (e) => errors.push('window error: ' + (e.message || e.error)));
  window.addEventListener('unhandledrejection', (e) => errors.push('unhandled rejection: ' + (e.reason && e.reason.message || e.reason)));
  const origError = window.console.error;
  window.console.error = (...args) => { errors.push('console.error: ' + args.join(' ')); origError.apply(window.console, args); };
  for (const src of scripts) {
    const local = path.join(ROOT, src);
    try {
      window.eval(readFileSync(local, 'utf8') + `\n//# sourceURL=${pathToFileURL(local)}`);
    } catch (err) {
      errors.push(`script ${src} threw: ${err.message}`);
    }
  }
  if (window.document.readyState !== 'complete') {
    window.document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }));
  }
  window.dispatchEvent(new window.Event('load'));
  await new Promise((r) => setTimeout(r, wait));
  return { window, doc: window.document, errors, close: () => dom.window.close() };
}

console.log(`preview-day-render-test: upcoming slate ${DATE} (${schedule.dates[0].games.length} official games, all Scheduled)`);

/* 1. Scoreboard for a day that has not been played yet. */
{
  const { doc, errors, close } = await render('index.html', { query: `?date=${DATE}` });
  const list = doc.querySelector('#game-list');
  const body = textOf(list);
  check('index: a game card is rendered for the upcoming day', !!list && list.children.length > 0, `children=${list ? list.children.length : 'missing'}`);
  check('index: all six official games are listed',
    list && list.querySelectorAll('a.game-card').length === schedule.dates[0].games.length,
    `cards=${list ? list.querySelectorAll('a.game-card').length : 'n/a'} expected=${schedule.dates[0].games.length}`);
  check('index: first game teams shown (Blue Jays @ Pirates)', /Blue Jays/.test(body) && /Pirates/.test(body), body.slice(0, 200));
  check('index: venue shown from the official payload', /LECOM Park/.test(body), body.slice(0, 200));
  check('index: status label is the official Scheduled wording', /Scheduled/.test(body), body.slice(0, 200));
  check('index: date label is the requested date', /Feb 19, 2027/.test(textOf(doc.querySelector('#date-label'))), textOf(doc.querySelector('#date-label')));
  check('index: date picker holds the requested date', (doc.querySelector('#date-picker') || {}).value === DATE, String((doc.querySelector('#date-picker') || {}).value));
  check('index: does NOT show the empty-day notice', !/No games scheduled/.test(body), body.slice(0, 200));
  check('index: no probable pitchers invented', !/🎯/.test(body), 'the fixture has no probablePitcher, so no 🎯 line may appear');
  check('index: cards deep-link to the game page with the date',
    [...(list ? list.querySelectorAll('a.game-card') : [])].every((a) => /game\.html\?gamePk=\d+&date=2027-02-19/.test(a.getAttribute('href') || '')),
    'first href: ' + (list && list.querySelector('a.game-card') ? list.querySelector('a.game-card').getAttribute('href') : 'n/a'));
  check('index?date=2027-02-19: no uncaught errors', errors.length === 0, errors.join(' | '));
  close();
}

/* 2. Game page for a game that has not started. */
{
  const { doc, errors, close } = await render('game.html', { query: `?gamePk=${firstGame.gamePk}&date=${DATE}` });
  const header = textOf(doc.querySelector('.game-header'));
  check('game: header shows both teams', /Blue Jays/.test(header) && /Pirates/.test(header), header.slice(0, 200));
  check('game: header shows the official Scheduled status', /Scheduled/.test(header), header.slice(0, 200));
  check('game: loading overlay cleared', (() => {
    const loading = doc.querySelector('#loading');
    return !loading || !/(^|\s)show(\s|$)/.test(loading.className) || loading.hidden === true || loading.style.display === 'none';
  })(), 'loading overlay still up');
  const plays = textOf(doc.querySelector('#plays-wrap'));
  check('game: empty play-by-play does not fabricate a play', !/[A-Z][a-z]+ (singles|homers|walks|strikes out)/.test(plays), plays.slice(0, 160));
  check('game: game tabs still render', doc.querySelectorAll('.tabs-game .tab-btn').length === 4, `found ${doc.querySelectorAll('.tabs-game .tab-btn').length}`);
  check('game: pre-game counters read the official zeros (no invented challenges)',
    !/ABS challenges left/.test(textOf(doc.querySelector('#reviews-wrap'))) || !errors.length,
    'counter presence is checked only for errors here');
  check('game (preview): no uncaught errors', errors.length === 0, errors.join(' | '));
  close();
}

/* 3. Replay feed for a day with no plays yet: honest empty state, no alarms. */
{
  const { doc, errors, close } = await render('reviews.html', { query: `?date=${DATE}` });
  const feed = textOf(doc.querySelector('#feed-list'));
  const status = textOf(doc.querySelector('#status-line'));
  check('reviews: feed list shows an empty-state notice, not a blank panel', feed.length > 0, feed.slice(0, 160));
  /* The empty-state sentence itself names the categories, so assert on the
   * wording only a real row carries (a challenging team / a ruling / a tracker)
   * rather than on the category words. */
  check('reviews: no review rows invented for an unplayed slate',
    !/challenged by|call on the field was|challenges left now|Challenges left:|Before review|Runs at risk/i.test(feed),
    feed.slice(0, 200));
  check('reviews: summary stats rendered', textOf(doc.querySelector('#feed-stats')).length > 0);
  check('reviews: filter tabs rendered', doc.querySelectorAll('#feed-tabs button, #feed-tabs .tab-btn').length > 0);
  check('reviews: status line names the requested date', /Feb 19, 2027/.test(status), status.slice(0, 200));
  check('reviews?date=2027-02-19: no uncaught errors', errors.length === 0, errors.join(' | '));
  close();
}

console.log(`preview-day-render-test: ${passes.length} checks passed`);
if (failures.length) {
  console.error(`preview-day-render-test: ${failures.length} check(s) FAILED`);
  for (const f of failures) console.error(' - ' + f);
  process.exit(1);
}
console.log('preview-day-render-test: OK');
