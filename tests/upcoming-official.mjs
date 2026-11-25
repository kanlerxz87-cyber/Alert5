// Live integration: real official MLB responses, no fixture substitution.
// Run on GitHub Actions (the Arena sandbox cannot directly reach StatsAPI).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const year = new Date().getUTCFullYear() + 1;
const date = process.env.MLB_TEST_DATE || `${year}-04-01`;
const source = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}&hydrate=review,probablePitcher,decisions,linescore`;
const cache = new Map();
async function official(url) {
  const u = new URL(url);
  assert.equal(u.origin, 'https://statsapi.mlb.com');
  if (!cache.has(u.href)) cache.set(u.href, (async () => {
    const response = await fetch(u, { signal: AbortSignal.timeout(30000) });
    assert.equal(response.status, 200, u.href);
    return response.json();
  })());
  return cache.get(u.href);
}
const schedule = await official(source);
const games = (schedule.dates || []).flatMap(d => d.games || []);
assert(games.length > 0, `No official games returned for ${date}; select a published upcoming slate`);
for (const game of games) {
  assert.equal(game.officialDate, date);
  assert(Number.isInteger(game.gamePk));
  assert(game.teams.away.team.name && game.teams.home.team.name);
  assert(game.status.abstractGameState);
  console.log(JSON.stringify({ date, gamePk: game.gamePk, away: game.teams.away.team.name,
    home: game.teams.home.team.name, status: game.status.detailedState, source }));
}

for (const page of ['index.html', 'reviews.html']) {
  const html = readFileSync(page, 'utf8');
  const scripts = [...html.matchAll(/<script\b[^>]*src="([^"]+)"[^>]*><\/script>/gi)].map(m => m[1]);
  const dom = new JSDOM(html.replace(/<script\b[^>]*src="[^"]+"[^>]*><\/script>/gi, ''), {
    url: `https://kanlerxz87-cyber.github.io/Alert5/${page}?date=${date}`,
    runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const errors = [];
  const pending = new Set();
  try {
    const w = dom.window;
    w.scrollTo = () => {};
    w.addEventListener('error', e => errors.push(e.message));
    w.fetch = async url => {
      if (!String(url).startsWith('https://statsapi.mlb.com/')) {
        return { ok: false, status: 404, json: async () => ({}) };
      }
      const task = official(String(url));
      pending.add(task);
      try {
        const body = await task;
        return { ok: true, status: 200, headers: { get: () => null }, json: async () => body };
      } finally { pending.delete(task); }
    };
    for (const script of scripts) w.eval(readFileSync(script, 'utf8'));
    w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 100));
      const loaded = page === 'index.html'
        ? w.document.querySelector('#game-list')?.textContent.includes(games[0].teams.away.team.name)
        : w.document.querySelector('#status-line')?.textContent.includes(`${games.length} game`);
      if (loaded && pending.size === 0) break;
    }
    assert.equal(w.document.querySelector('#date-picker').value, date);
    const text = w.document.body.textContent;
    if (page === 'index.html') {
      for (const game of games) {
        assert(text.includes(game.teams.away.team.name), `Missing ${game.teams.away.team.name}`);
        assert(text.includes(game.teams.home.team.name), `Missing ${game.teams.home.team.name}`);
      }
    } else {
      assert(text.includes(`${games.length} game(s)`), 'Replay feed did not finish official slate scan');
    }
    assert.deepEqual(errors, []);
    console.log(`PASS ${page}?date=${date}: official slate rendered without script errors`);
  } finally { dom.window.close(); }
}
