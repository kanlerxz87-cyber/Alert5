/* ============================================================================
 * api.js — MLB StatsAPI client
 *
 * One place for every network call the site makes:
 *   1. fetch wrapper with timeout, retry, revalidation, HTTP-429 handling and
 *      an explicit per-class request budget (see §0 below)
 *   2. endpoint helpers (schedule, feed/live, playByPlay, gameStatus, people stats)
 *   3. small date/number formatters shared by the pages
 *
 * The StatsAPI is keyless and sends CORS headers, so a static GitHub Pages site
 * can call it straight from the browser.  Endpoint list + `fields` projections
 * follow the ones documented in README.md §"How it works".
 *
 * §0 REQUEST BUDGET — every request is charged to exactly one class, and each
 * class has a documented requests-per-minute ceiling from BUDGET_PROFILES.  The
 * bucket is a plain token bucket: when a class is full the call either waits for
 * its turn or is skipped for that cycle (`err.deferred = true`, never an error
 * the UI shows).  That is what keeps a fast poll cadence from ever becoming an
 * unbounded number of requests, and it is the enforcement point named in
 * docs/api-latency-and-terms.md.  The bucket also backs off hard on HTTP 429
 * (honouring Retry-After) and on repeated 5xx/timeouts.
 * ==========================================================================*/
(function (global) {
  'use strict';

  /* 1 = MLB. 11-14 = the minor leagues (see README §Customizing). */
  var SPORT_ID = 1;
  var API_ROOT = 'https://statsapi.mlb.com/api';
  var REQUEST_TIMEOUT_MS = 15000;

  /* HTTP 429 quiet period: honour Retry-After when the host sends one, else 60s.
   * Clamped to 1s-5min so a bogus header can neither spin nor stall the page. */
  var QUIET_DEFAULT_MS = 60000;
  var QUIET_MIN_MS = 1000;
  var QUIET_MAX_MS = 300000;

  var state = {
    quietUntil: 0,
    lastError: null,
    lastOK: 0,
    requests: 0,
    cacheHits: 0,
    revalidated: 0,
    notModified: 0,
    deferred: 0,
    throttled: 0,
  };

  var cache = Object.create(null);
  var CACHE_MAX_ENTRIES = 240;

  /* --------------------------------------------------------- §0 request budget */

  /* Tokens per minute per request class.  Chosen so that the poll cadences in
   * reviews-feed.js / game.js / scoreboard.js can never exceed them: the token
   * bucket, not the timer, is the ceiling.  One page, one browser, no service
   * worker:
   *
   *   status  — the lean slate/per-game status projection (a few KB).  Fast
   *             enough to notice an official status flip (a review being
   *             *called*) within a fraction of a second.
   *   pbp     — play-by-play, the endpoint that carries reviewDetails, the
   *             official scorer pending event types and every play's official
   *             classification.  This is the "fastest in-game update" feed.
   *   feed    — the full feed/live hydration (counters, boxscore, linescore).
   *   other   — schedule hydration, registries, people stats.
   *
   * Burst is a couple of seconds of tokens so a tab that was hidden, or a page
   * that just opened, can catch up without a visible stall. */
  var BUDGET_PROFILES = {
    live:     { status: 600, pbp: 480, feed: 120, other: 120 },
    /* a game or slate that is not live, or a tab that has been hidden for a
     * while: everything slows down instead of stopping, so returning to the
     * tab still shows fresh data on the first paint */
    idle:     { status: 120, pbp: 60, feed: 30, other: 60 },
    /* backstop if the page is left open in the background for a long time */
    dormant:  { status: 20, pbp: 6, feed: 4, other: 10 },
  };

  var budget = {
    profile: 'live',
    buckets: Object.create(null),
    maxWaitSeen: 0,
  };

  function profileFor(name) {
    return BUDGET_PROFILES[name] || BUDGET_PROFILES.live;
  }

  function bucketFor(cls, profile) {
    var perMinute = profileFor(profile)[cls] || profileFor(profile).other;
    var b = budget.buckets[cls];
    if (!b || b.perMinute !== perMinute) {
      /* Refilling the bucket on a profile change keeps the burst guard but lets
       * the new ceiling take effect immediately (decreasing it never revokes
       * tokens the caller already earned). */
      b = {
        perMinute: perMinute,
        tokens: Math.min(b ? b.tokens : Math.max(4, perMinute / 10), Math.max(4, perMinute / 10)),
        at: now(),
        waiters: b ? b.waiters : [],
      };
      budget.buckets[cls] = b;
    }
    return b;
  }

  function refill(b) {
    var t = now();
    var elapsed = Math.max(0, t - b.at);
    b.at = t;
    /* Burst = a tenth of the per-minute ceiling (at least 4), so a page that
     * has just opened can make its handful of boot calls and a hidden tab that
     * comes back can catch up — without a burst large enough to look like a
     * scrape. Steady state still cannot exceed perMinute. */
    var cap = Math.max(4, b.perMinute / 10);
    b.tokens = Math.min(cap, b.tokens + (elapsed / 60000) * b.perMinute);
    return b.tokens;
  }

  function setBudgetProfile(name) {
    if (!BUDGET_PROFILES[name]) return;
    budget.profile = name;
    Object.keys(budget.buckets).forEach(function (cls) {
      bucketFor(cls, name);
    });
    var waiters = [];
    Object.keys(budget.buckets).forEach(function (cls) {
      waiters = waiters.concat(budget.buckets[cls].waiters.splice(0));
    });
    waiters.forEach(function (w) { w(); });
  }

  /**
   * take(cls, opts) -> Promise
   *   opts.waitMs  how long the caller is willing to queue (default 0 = skip)
   *   resolves `true` when a token was spent, `false` when the caller should
   *   skip this cycle (a normal, silent deferral — never an error).
   */
  function take(cls, opts) {
    opts = opts || {};
    var b = bucketFor(cls, budget.profile);
    if (refill(b) >= 1) {
      b.tokens -= 1;
      return Promise.resolve(true);
    }
    var waitMs = typeof opts.waitMs === 'number' ? opts.waitMs : 0;
    if (waitMs <= 0) {
      state.deferred += 1;
      return Promise.resolve(false);
    }
    var msToToken = Math.ceil(((1 - b.tokens) / b.perMinute) * 60000);
    var wait = Math.min(waitMs, Math.max(16, msToToken));
    budget.maxWaitSeen = Math.max(budget.maxWaitSeen, wait);
    state.deferred += 1;
    return new Promise(function (resolve) {
      var done = false;
      function finish() {
        if (done) return;
        done = true;
        clearTimeout(timer);
        var idx = b.waiters.indexOf(finish);
        if (idx !== -1) b.waiters.splice(idx, 1);
        resolve(take(cls, { waitMs: 0 }));
      }
      var timer = setTimeout(finish, wait);
      b.waiters.push(finish);
    });
  }

  /* Full refill. Used when a page resumes after being frozen (a laptop lid
   * closing can leave timers stalled far longer than the elapsed-time refill
   * accounts for) and by the tests, which need a deterministic bucket. */
  function resetBudget() {
    Object.keys(budget.buckets).forEach(function (cls) {
      var b = budget.buckets[cls];
      b.tokens = Math.max(4, b.perMinute / 10);
      b.at = now();
    });
    budget.maxWaitSeen = 0;
  }

  function budgetSnapshot() {
    var out = { profile: budget.profile, maxWaitSeen: budget.maxWaitSeen, classes: {} };
    Object.keys(BUDGET_PROFILES[budget.profile] || {}).forEach(function (cls) {
      var b = bucketFor(cls, budget.profile);
      refill(b);
      out.classes[cls] = {
        perMinute: b.perMinute,
        tokens: Math.round(b.tokens * 100) / 100,
        burst: Math.max(4, b.perMinute / 10),
      };
    });
    return out;
  }

  function now() { return Date.now(); }

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function quietRemainingMs() { return Math.max(0, state.quietUntil - now()); }

  function parseRetryAfter(value) {
    if (!value) return 0;
    var seconds = Number(value);
    if (isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
    var when = Date.parse(value); // HTTP-date form
    if (!isNaN(when)) return Math.max(0, when - now());
    return 0;
  }

  function pruneCache() {
    var keys = Object.keys(cache);
    if (keys.length <= CACHE_MAX_ENTRIES) return;
    keys.sort(function (a, b) { return cache[a].at - cache[b].at; });
    keys.slice(0, keys.length - CACHE_MAX_ENTRIES).forEach(function (k) { delete cache[k]; });
  }

  function ApiError(message, status, url) {
    var err = new Error(message);
    err.name = 'ApiError';
    err.status = status || 0;
    err.url = url || '';
    return err;
  }

  /* A caller that asked for a token it could not get, or asked for a
   * revalidation the tab is not allowed to spend yet, gets this and skips the
   * cycle.  It is never surfaced as a user-visible error. */
  function DeferredError(reason, url) {
    var err = new Error(reason || 'deferred');
    err.name = 'DeferredError';
    err.deferred = true;
    err.url = url || '';
    return err;
  }

  function isDeferred(err) {
    return !!(err && (err.deferred === true || err.name === 'DeferredError'));
  }

  /* Last cached body + its ETag/Last-Modified, for conditional requests. When
   * the host answers 304 the poll cost collapses to headers only — the cheapest
   * way to "ask again now" without re-downloading a feed that has not moved. */
  var validators = Object.create(null);
  var VALIDATOR_MAX = 400;

  function rememberValidators(url, res) {
    var etag = res.headers && res.headers.get ? res.headers.get('ETag') : null;
    var lastModified = res.headers && res.headers.get ? res.headers.get('Last-Modified') : null;
    if (!etag && !lastModified) return;
    var keys = Object.keys(validators);
    if (keys.length > VALIDATOR_MAX) {
      delete validators[keys[0]];
    }
    validators[url] = { etag: etag || null, lastModified: lastModified || null, body: null };
  }

  function attachBody(url, data) {
    var v = validators[url];
    if (v) v.body = data;
  }

  /**
   * getJSON(url, opts)
   *   opts.ttl      cache lifetime in ms (0 = no cache, the default)
   *   opts.retries  extra attempts after a failed one (default 1)
   *   opts.signal   external AbortSignal (poll loops use it to cancel)
   *   opts.keepQuiet  bypass the 429 quiet window (used by the quiet probe only)
   */
  /**
   * getJSON(url, opts)
   *   opts.ttl         cache lifetime in ms (0 = no cache, the default)
   *   opts.retries     extra attempts after a failed one (default 1)
   *   opts.signal      external AbortSignal (poll loops use it to cancel)
   *   opts.keepQuiet   bypass the 429 quiet window (used by the quiet probe only)
   *   opts.cls         request-budget class: 'status' | 'pbp' | 'feed' | 'other'
   *   opts.budgetWait  ms the caller will queue for a token (default 0 = skip the
   *                    cycle with a DeferredError instead of piling up)
   *   opts.revalidate  send If-None-Match / If-Modified-Since when this exact URL
   *                    was fetched before, and answer 304 from the last body
   */
  function getJSON(url, opts) {
    opts = opts || {};
    var ttl = opts.ttl || 0;
    var retries = typeof opts.retries === 'number' ? opts.retries : 1;
    var cls = opts.cls || 'other';

    if (ttl && cache[url] && now() - cache[url].at < cache[url].ttl) {
      state.cacheHits += 1;
      return Promise.resolve(cache[url].data);
    }

    var quiet = quietRemainingMs();
    if (quiet > 0 && !opts.keepQuiet) {
      var qerr = ApiError('StatsAPI quiet period, ' + Math.ceil(quiet / 1000) + 's remaining', 429, url);
      qerr.quiet = true;
      return Promise.reject(qerr);
    }

    var attempt = 0;

    /* Every attempt is charged to the budget, retries included: a retry storm
     * must not be able to outrun the ceiling. */
    function charge() {
      /* Boot-critical, low-frequency classes ('other': schedule, registries,
       * people stats) may queue briefly instead of skipping; the poll classes
       * never queue, they just skip the cycle and try again on the next one. */
      var defaultWait = cls === 'other' ? 3000 : 0;
      var waitMs = attempt === 0
        ? (opts.budgetWait === undefined ? defaultWait : opts.budgetWait)
        : 0;
      return take(cls, { waitMs: waitMs }).then(function (ok) {
        if (ok) return true;
        state.throttled += 1;
        throw DeferredError('Request budget for "' + cls + '" is spent; skipping this cycle', url);
      });
    }

    function once() {
      attempt += 1;

      return charge().then(function () {
        state.requests += 1;

        var controller = new AbortController();
        var timer = setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT_MS);
        var external = opts.signal;
        if (external) {
          if (external.aborted) controller.abort();
          else external.addEventListener('abort', function () { controller.abort(); }, { once: true });
        }

        var headers = { Accept: 'application/json' };
        var known = opts.revalidate ? validators[url] : null;
        if (known && known.etag) headers['If-None-Match'] = known.etag;
        else if (known && known.lastModified) headers['If-Modified-Since'] = known.lastModified;

        var request = fetch(url, {
          method: 'GET',
          mode: 'cors',
          /* 'no-cache' revalidates instead of trusting a stale HTTP cache; the
           * explicit conditional headers above are what make that cheap. */
          cache: opts.revalidate ? 'no-cache' : 'no-store',
          credentials: 'omit',
          headers: headers,
          signal: controller.signal,
        });

        return request.then(function (res) {
          clearTimeout(timer);

          if (res.status === 429) {
            var wait = parseRetryAfter(res.headers.get('Retry-After')) || QUIET_DEFAULT_MS;
            wait = Math.min(QUIET_MAX_MS, Math.max(QUIET_MIN_MS, wait));
            state.quietUntil = Math.max(state.quietUntil, now() + wait);
            state.throttled += 1;
            /* A 429 is the host's own ceiling talking: drop every class to the
             * idle profile so the page stops climbing back to full cadence on
             * a host that just asked it to slow down. */
            setBudgetProfile('idle');
            throw ApiError('StatsAPI asked to slow down (HTTP 429); pausing ' + Math.round(wait / 1000) + 's', 429, url);
          }

          if (res.status === 304) {
            state.notModified += 1;
            state.lastOK = now();
            var knownBody = known && known.body;
            if (knownBody !== null && knownBody !== undefined) return knownBody;
            throw DeferredError('HTTP 304 without a cached body for ' + url, url);
          }

          if (!res.ok) throw ApiError('HTTP ' + res.status + ' from ' + url, res.status, url);
          rememberValidators(url, res);
          return res.json();
        }).then(function (data) {
          clearTimeout(timer);
          state.lastOK = now();
          state.lastError = null;
          attachBody(url, data);
          if (ttl) {
            cache[url] = { at: now(), ttl: ttl, data: data };
            pruneCache();
          }
          return data;
        }).catch(function (err) {
          clearTimeout(timer);
          state.lastError = err;

          var status = err && err.status;
          var retryable = !status || status >= 500 || err.name === 'AbortError' || err.name === 'TypeError';
          if (retryable && attempt <= retries) {
            return sleep(300 * attempt).then(once);
          }
          if (err.name === 'AbortError') {
            throw ApiError('Request timed out after ' + REQUEST_TIMEOUT_MS + 'ms: ' + url, 0, url);
          }
          throw err;
        });
      });
    }

    return once();
  }

  /* ------------------------------------------------------------- endpoints */

  var SCHEDULE_HYDRATE = 'probablePitcher,linescore,decisions,review';

  /* Games for one date.  `fields` is deliberately open so the scoreboard can
   * ask for the full hydrated card data and the 125ms sweep can ask for the
   * lean status projection (README table, rows 1 and 2). */
  function scheduleUrl(date, opts) {
    opts = opts || {};
    var qs = ['sportId=' + SPORT_ID, 'date=' + encodeURIComponent(date)];
    if (opts.hydrate) qs.push('hydrate=' + encodeURIComponent(opts.hydrate));
    if (opts.fields) qs.push('fields=' + encodeURIComponent(opts.fields));
    return API_ROOT + '/v1/schedule?' + qs.join('&');
  }

  function schedule(date, opts) {
    opts = opts || {};
    return getJSON(scheduleUrl(date, {
      hydrate: opts.hydrate === undefined ? SCHEDULE_HYDRATE : opts.hydrate,
      fields: opts.fields || '',
    }), {
      ttl: opts.ttl || 0,
      signal: opts.signal,
      retries: opts.retries,
      cls: opts.cls || (opts.fields ? 'status' : 'other'),
      budgetWait: opts.budgetWait,
      /* the hydrated schedule carries review counters that change slowly: a
       * conditional request keeps the 500 ms scoreboard poll header-only */
      revalidate: opts.revalidate === undefined ? !opts.fields : opts.revalidate,
    });
  }

  /* Date-range game counts — used only to point at the most recent date that
   * actually had games (the scoreboard looks empty in the offseason). */
  function scheduleRange(startDate, endDate, opts) {
    opts = opts || {};
    var qs = 'sportId=' + SPORT_ID + '&startDate=' + encodeURIComponent(startDate) +
      '&endDate=' + encodeURIComponent(endDate) + '&fields=dates,date,totalGames';
    return getJSON(API_ROOT + '/v1/schedule?' + qs, {
      ttl: 300000, retries: 0, signal: opts.signal, cls: 'other',
    });
  }

  /* Lean slate status sweep: gamePk + status only (~2.4 KB for the whole day). */
  var STATUS_FIELDS = 'dates,games,gamePk,season,status,abstractGameState,codedGameState,' +
    'detailedState,statusCode,reason,startTimeTBD,abstractGameCode';

  function slateStatus(date, opts) {
    opts = opts || {};
    return schedule(date, {
      hydrate: '',
      fields: STATUS_FIELDS,
      ttl: opts.ttl === undefined ? 0 : opts.ttl,
      signal: opts.signal,
      retries: 0,
      cls: 'status',
      budgetWait: opts.budgetWait,
      /* The slate status is the one call that decides how fast everything else
       * reacts, so it is asked for unconditionally (no 304 round trip on a
       * status flip) but charged to the 'status' budget class. */
      revalidate: false,
    });
  }

  /* Full live feed (v1.1 first, v1 fallback, then /playByPlay + /boxscore + /linescore bundle). */
  function gameFeed(gamePk, opts) {
    opts = opts || {};
    var url = API_ROOT + '/v1.1/game/' + gamePk + '/feed/live';
    if (opts.fields) url += '?fields=' + encodeURIComponent(opts.fields);
    return getJSON(url, {
      signal: opts.signal,
      retries: opts.retries,
      cls: opts.cls || 'feed',
      budgetWait: opts.budgetWait,
      revalidate: opts.revalidate,
    })
      .catch(function (err) {
        if (isDeferred(err)) throw err;
        if (err && err.status === 404) {
          var v1Url = API_ROOT + '/v1/game/' + gamePk + '/feed/live';
          if (opts.fields) v1Url += '?fields=' + encodeURIComponent(opts.fields);
          return getJSON(v1Url, { signal: opts.signal }).catch(function (err2) {
            if (err2 && err2.status === 404 && !opts.fields) {
              return Promise.all([
                playByPlay(gamePk, { signal: opts.signal }),
                boxscore(gamePk, { signal: opts.signal }),
                linescore(gamePk, { signal: opts.signal }),
              ]).then(function (parts) {
                var pbp = parts[0] || {};
                var box = parts[1] || {};
                var ls = parts[2] || {};
                var awayTeam = (box.teams && box.teams.away && box.teams.away.team) || {};
                var homeTeam = (box.teams && box.teams.home && box.teams.home.team) || {};
                return {
                  gamePk: Number(gamePk),
                  gameData: {
                    game: { pk: Number(gamePk) },
                    status: { abstractGameState: ls.isFinal ? 'Final' : 'Live', detailedState: ls.isFinal ? 'Final' : '' },
                    teams: { away: awayTeam, home: homeTeam },
                    players: {},
                    venue: {},
                    datetime: {},
                  },
                  liveData: {
                    plays: { allPlays: pbp.allPlays || [], currentPlay: pbp.currentPlay || null },
                    linescore: ls,
                    boxscore: box,
                    decisions: {},
                  },
                };
              });
            }
            throw err2;
          });
        }
        throw err;
      });
  }

  /* Lean per-game status projection for the game page's 125ms watcher (~150 B). */
  function gameStatusLean(gamePk, opts) {
    opts = opts || {};
    var fields = 'gameData,status,abstractGameState,codedGameState,detailedState,statusCode,reason,startTimeTBD,abstractGameCode';
    return getJSON(API_ROOT + '/v1.1/game/' + gamePk + '/feed/live?fields=' + encodeURIComponent(fields), {
      signal: opts.signal, retries: 0, cls: 'status', budgetWait: opts.budgetWait, revalidate: false,
    });
  }

  function playByPlay(gamePk, opts) {
    opts = opts || {};
    var url = API_ROOT + '/v1/game/' + gamePk + '/playByPlay';
    if (opts.fields) url += '?fields=' + encodeURIComponent(opts.fields);
    return getJSON(url, {
      signal: opts.signal,
      retries: opts.retries,
      cls: opts.cls || 'pbp',
      budgetWait: opts.budgetWait,
      /* The play-by-play is polled at the live cadence. A conditional request
       * turns "nothing changed since 250 ms ago" into a header-only 304 while
       * still answering the instant an at-bat, review or ruling is written. */
      revalidate: opts.revalidate === undefined ? true : opts.revalidate,
    });
  }

  function boxscore(gamePk, opts) {
    opts = opts || {};
    return getJSON(API_ROOT + '/v1/game/' + gamePk + '/boxscore', {
      signal: opts.signal, retries: 0, cls: 'other', revalidate: true,
    });
  }

  function linescore(gamePk, opts) {
    opts = opts || {};
    return getJSON(API_ROOT + '/v1/game/' + gamePk + '/linescore', {
      signal: opts.signal, retries: 0, cls: 'other', revalidate: true,
    });
  }

  /* Official game-status / review-type registry (codes -> official wording).
   * Cached for an hour: it is a static reference table. */
  function gameStatusRegistry(opts) {
    opts = opts || {};
    return getJSON(API_ROOT + '/v1/gameStatus', {
      ttl: 3600000, retries: 0, signal: opts.signal, cls: 'other', revalidate: true,
    })
      .then(function (rows) {
        var byCode = Object.create(null);
        (Array.isArray(rows) ? rows : []).forEach(function (row) {
          if (row && row.statusCode) byCode[row.statusCode] = row;
        });
        return byCode;
      });
  }

  function peopleStats(personId, group, opts) {
    opts = opts || {};
    var stats = opts.stats || 'season,statSplits,gameLog,expectedStatistics';
    var season = opts.season || new Date().getUTCFullYear();
    var qs = 'stats=' + encodeURIComponent(stats) + '&group=' + encodeURIComponent(group) +
      '&season=' + encodeURIComponent(season);
    if (opts.sitCodes) qs += '&sitCodes=' + encodeURIComponent(opts.sitCodes);
    return getJSON(API_ROOT + '/v1/people/' + personId + '/stats?' + qs, {
      ttl: opts.ttl === undefined ? 120000 : opts.ttl,
      signal: opts.signal, retries: 0,
    });
  }

  function vsPlayer(batterId, pitcherId, group, opts) {
    opts = opts || {};
    var qs = 'stats=vsPlayer&group=' + encodeURIComponent(group || 'hitting') +
      '&opposingPlayerId=' + encodeURIComponent(pitcherId);
    return getJSON(API_ROOT + '/v1/people/' + batterId + '/stats?' + qs, {
      ttl: opts.ttl === undefined ? 600000 : opts.ttl,
      signal: opts.signal, retries: 0,
    });
  }

  /* ------------------------------------------------------------ formatters */

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /* Local calendar date as YYYY-MM-DD (no UTC shift surprises). */
  function toISODate(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function todayISO() { return toISODate(new Date()); }

  function shiftISODate(dateStr, deltaDays) {
    var parts = String(dateStr || '').split('-');
    if (parts.length !== 3) return todayISO();
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    d.setDate(d.getDate() + deltaDays);
    return toISODate(d);
  }

  function isValidISODate(s) {
    var str = String(s || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
    var p = str.split('-');
    var y = Number(p[0]);
    var m = Number(p[1]);
    var day = Number(p[2]);
    if (m < 1 || m > 12 || day < 1 || day > 31) return false;
    var d = new Date(Date.UTC(y, m - 1, day));
    return d.getUTCFullYear() === y && (d.getUTCMonth() + 1) === m && d.getUTCDate() === day;
  }

  function formatDateLabel(dateStr) {
    if (!isValidISODate(dateStr)) return '';
    var p = dateStr.split('-');
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    var weekday = d.toLocaleDateString(undefined, { weekday: 'short' });
    var month = d.toLocaleDateString(undefined, { month: 'short' });
    return weekday + ' ' + month + ' ' + d.getDate() + ', ' + d.getFullYear();
  }

  function formatGameTime(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  function formatClock(ms) {
    var s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return s + 's';
    var m = Math.floor(s / 60);
    return m + 'm ' + pad2(s % 60) + 's';
  }

  /* Baseball-style average: ".312" (leading zero dropped) or "—" when absent. */
  function avg3(value) {
    var n = Number(value);
    if (value === null || value === undefined || value === '' || !isFinite(n)) return '—';
    var s = n.toFixed(3);
    return s.replace(/^0/, '');
  }

  function pct(value, digits) {
    var n = Number(value);
    if (value === null || value === undefined || value === '' || !isFinite(n)) return '—';
    return (n * 100).toFixed(digits === undefined ? 0 : digits) + '%';
  }

  function ipText(value) {
    var raw = String(value === undefined || value === null ? '' : value);
    if (!raw) return '—';
    return raw;
  }

  function num(value, fallback) {
    var n = Number(value);
    return isFinite(n) ? n : (fallback === undefined ? 0 : fallback);
  }

  global.MLB = {
    SPORT_ID: SPORT_ID,
    API_ROOT: API_ROOT,
    STATUS_FIELDS: STATUS_FIELDS,
    SCHEDULE_HYDRATE: SCHEDULE_HYDRATE,
    getJSON: getJSON,
    schedule: schedule,
    scheduleRange: scheduleRange,
    slateStatus: slateStatus,
    BUDGET_PROFILES: BUDGET_PROFILES,
    setBudgetProfile: setBudgetProfile,
    budget: take,
    budgetSnapshot: budgetSnapshot,
    resetBudget: resetBudget,
    isDeferred: isDeferred,
    validators: validators,
    gameFeed: gameFeed,
    gameStatusLean: gameStatusLean,
    playByPlay: playByPlay,
    boxscore: boxscore,
    linescore: linescore,
    gameStatusRegistry: gameStatusRegistry,
    peopleStats: peopleStats,
    vsPlayer: vsPlayer,
    quietRemainingMs: quietRemainingMs,
    state: state,
    toISODate: toISODate,
    todayISO: todayISO,
    shiftISODate: shiftISODate,
    isValidISODate: isValidISODate,
    formatDateLabel: formatDateLabel,
    formatGameTime: formatGameTime,
    formatClock: formatClock,
    avg3: avg3,
    pct: pct,
    ipText: ipText,
    num: num,
  };
}(window));
