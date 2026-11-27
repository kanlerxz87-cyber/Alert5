/* ============================================================================
 * reviews-feed.js — the all-games Replay Feed (reviews.html)
 *
 * Three jobs, in this order of priority:
 *
 * 1. ALERT (fastest path, never blocked by anything else)
 *    Every game on the slate is captured, and a new challenge / manager
 *    challenge / umpire review / instant replay / boundary call / ABS challenge /
 *    official-scorer pending ruling / official scoring change / milestone game
 *    state change raises a row and an alert sound.
 *
 * 2. CAPTURE (the official live game state, second by second)
 *    Each game's whole baseball state is captured from the official feed with
 *    the API's own second-precision `metaData.timeStamp`: score, hits, errors,
 *    inning/half/state, count, outs, bases + runners, batter, pitcher, on-deck,
 *    in-hole, current at-bat, official game + review status and the official
 *    challenge counters.  Consecutive captures are diffed into individual
 *    transitions, each with the official wording before and after.
 *
 * 3. LOG (separate store, see scoring-log.js)
 *    Official-scoring pending rulings and reclassifications go to their own
 *    persistent log with their own storage keys, rendered in their own section,
 *    so nothing in that path can break or delay an alert.
 *
 * ── How the fast path works ────────────────────────────────────────────────
 * Two loops, deliberately different in cost:
 *
 *   PROBE  (every PROBE_MS, per live game)   1 tiny request  (~150 B, verified)
 *          GET /api/v1.1/game/{pk}/feed/live?fields=metaData,timeStamp,wait,
 *              gameEvents,logicalEvents
 *          → the API's own clock and event names.  Unchanged timeStamp = the
 *          game did not move; no capture is spent.
 *
 *   CAPTURE (250 ms in burst mode, else only when the probe says the feed
 *          moved, plus a slow floor CAPTURE_FLOOR_MS)   1 projected feed/live
 *          request carrying the whole state — score, count, outs, bases,
 *          batter, pitcher, on deck/in hole, official status, the current
 *          at-bat's startTime/endTime — in ~1.7 KB, measured.  Burst mode
 *          re-arms on event-level changes only (BURST_KINDS), so a ball or a
 *          strike alone never holds a slate on the expensive path.
 *
 *   PLAYS  (seed, then every PLAYLOG_SWEEP_MS / 4 s while a ruling is pending)
 *          the play log, on its own cadence, purely for review rows and the
 *          official-scoring diff.  It is the large part of the payload
 *          (~16 KB), so it is deliberately not on the fast path.
 *
 *   SLATE  (every SWEEP_MS = 125 ms)  the existing whole-slate status
 *          projection (~2.4 KB) that catches a review the instant MLB flips
 *          `status.statusCode`, before any play text exists.
 *
 * That is the fastest honest path available: the StatsAPI is pull-only, so
 * the floor on latency is one probe interval + one round trip.  Nothing here
 * polls faster than the documented budget (see README §"Notes & etiquette").
 * ==========================================================================*/
(function (global) {
  'use strict';

  var MLB = global.MLB;
  var UI = global.UI;
  var Reviews = global.Reviews;
  var FeedLog = global.FeedLog;
  var GameState = global.GameState;
  var ScoringLog = global.ScoringLog;
  var AlertSound = global.AlertSound;

  /* ------------------------------------------------------------- cadences */
  var PROBE_MS = 250;              /* per-game change probe while live        */
  var PROBE_MS_HOT = 150;          /* … while that game is in a review        */
  var CAPTURE_FLOOR_MS = 5000;     /* probe-mode: capture at least this often    */
  var CAPTURE_FLOOR_HOT_MS = 500;
  var CAPTURE_BURST_MS = 250;      /* direct capture interval while the game moves */
  var CAPTURE_HOT_MS = 150;        /* … and while it is in a review / has a ruling */
  var BURST_WINDOW_MS = 12000;     /* stay in direct-capture mode this long     */
  /* Changes that re-arm the fast path.  A ball or a strike on its own does not:
   * consecutive pitches change only the count, and paying a 1.7 KB capture for
   * each one all day is exactly the load this design exists to avoid.  The
   * probe still catches the next pitch inside one interval, so the observable
   * delay is the probe RTT — and every genuine event (score, outs, bases,
   * batter, pitcher, inning, review, official status) keeps the 250 ms path. */
  var BURST_KINDS = ['score', 'reviewOpen', 'reviewClose', 'status', 'outs', 'bases',
    'batter', 'pitcher', 'inning', 'atBat'];
  var STATUS_SWEEP_MS = 125;       /* whole-slate official status projection  */
  var SLATE_MS = 5000;             /* hydrated slate refresh (teams, records) */
  var SLATE_MS_IDLE = 30000;
  var FINAL_GRACE_MS = 30 * 60 * 1000;
  var FINAL_PROBE_MS = 3000;
  var FETCH_CONCURRENCY = 6;
  var SOUND_COOLDOWN_MS = 1200;
  var TICK_MS = 100;               /* scheduler resolution                   */

  var TIMELINE_MAX = 40;           /* transitions kept per game              */
  var STATE_ROWS_MAX = 60;         /* milestone rows kept in the feed        */

  var FILTERS = [
    { id: 'all', label: 'All' },
    { id: 'state', label: '⚾ Live state' },
    { id: 'abs', label: 'ABS' },
    { id: 'challenges', label: 'Challenges' },
    { id: 'reviews', label: 'Reviews' },
    { id: 'boundary', label: 'Boundary Calls' },
    { id: 'under', label: 'Under Review' },
    { id: 'risk', label: '⚠️ Runs at Risk' },
    { id: 'scoring', label: '✏️ Scoring Changes' },
  ];

  /* Kinds of captured transition that deserve their own feed row.  Count /
   * balls-strikes / bases / batter churn is captured in full on the state
   * timeline (and the Live state section) but does not become a row — otherwise
   * one game would push 300 rows an hour through the alert feed. */
  var MILESTONE_KINDS = ['score', 'reviewOpen', 'reviewClose', 'status', 'pitcher', 'inning'];

  var state = {
    date: MLB.todayISO(),
    dateSeq: 0,
    filter: 'all',
    games: [],
    log: null,
    entries: [],
    snapshots: Object.create(null),
    irregularities: Object.create(null),
    finalSeen: Object.create(null),
    nextDue: Object.create(null),
    statusByPk: Object.create(null),
    scanning: false,
    scanError: null,
    soundOn: false,
    notifyOn: false,
    lastChimeAt: 0,
    lastScanAt: 0,
    timers: { scan: null, sweep: null, countdown: null, tick: null, probe: null },
    nextScanAt: 0,
    lastRenderSignature: '',
    counterCache: Object.create(null),
    absFetchedRevCount: Object.create(null),
    lastGameDate: undefined,
    lookingForRecent: false,
    /* capture */
    capture: Object.create(null),      /* gamePk -> { snap, timeline[], ... } */
    slatesAt: 0,
    slateInFlight: false,
    probesInFlight: 0,
    capturing: Object.create(null),
    net: {
      lastProbeRttMs: null, lastCaptureRttMs: null, lastLatencyMs: null,
      lastApiTimeStamp: null, probes: 0, captures: 0, skipped: 0,
      playLogFetches: 0,
    },
    playCache: Object.create(null),
    /* scoring log (separate store) */
    scoring: null,
    scoringFilter: 'all',
    scoringSignature: '',
    scoringSeeded: false,
    stateSectionOpen: true,
  };

  function $(id) { return document.getElementById(id); }

  function statusLine(text, isError) {
    var el = $('status-line');
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('is-error', !!isError);
  }

  function urlDate() {
    try {
      var params = new URLSearchParams(global.location.search || '');
      var d = params.get('date');
      return MLB.isValidISODate(d) ? d : null;
    } catch (e) { return null; }
  }

  /* Keep the address bar in step with the selected date (shareable links).
   * Guarded: history.replaceState is not writable in every embedding context. */
  function syncUrl() {
    try {
      var url = new URL(global.location.href);
      if (url.searchParams.get('date') === state.date) return;
      url.searchParams.set('date', state.date);
      global.history.replaceState(null, '', url.toString());
    } catch (e) { /* ignore */ }
  }

  function syncNav() {
    var picker = $('date-picker');
    if (picker && picker.value !== state.date) picker.value = state.date;
    var label = $('date-label');
    if (label) label.textContent = MLB.formatDateLabel(state.date);
    var backLink = document.querySelector('a.btn[href^="index.html"]');
    if (backLink) backLink.setAttribute('href', 'index.html?date=' + encodeURIComponent(state.date));
    syncUrl();
  }

  function parseDate() {
    /* A ?date=YYYY-MM-DD deep link (reviews.html?date=2026-10-28) wins over the
     * picker, so a shared or bookmarked URL always opens the date it names. */
    var fromUrl = urlDate();
    if (fromUrl) return fromUrl;
    var input = $('date-picker');
    var value = input && input.value;
    return MLB.isValidISODate(value) ? value : MLB.todayISO();
  }

  /* ------------------------------------------------------------ log helpers */

  function upsertEntry(entry) {
    if (!entry || !entry.id) return false;
    var index = -1;
    for (var i = 0; i < state.entries.length; i += 1) {
      if (state.entries[i].id === entry.id) { index = i; break; }
    }
    var now = Date.now();
    if (index === -1) {
      entry.firstSeen = entry.firstSeen || now;
      entry.lastSeen = now;
      state.entries.push(entry);
      return true;
    }
    var prev = state.entries[index];
    var merged = Object.assign({}, prev, entry);
    merged.firstSeen = prev.firstSeen || now;
    merged.lastSeen = now;
    if (prev.scoreTracker && entry.scoreTracker) {
      merged.scoreTracker = Object.assign({}, prev.scoreTracker, entry.scoreTracker);
      /* Never overwrite an observed "before" score with a later guess. */
      if (prev.scoreTracker.before && !entry.scoreTracker.before) {
        merged.scoreTracker.before = prev.scoreTracker.before;
      }
    }
    state.entries[index] = merged;
    return false;
  }

  function noteIrregularity(gamePk, text) {
    if (!gamePk || !text) return;
    var list = state.irregularities[gamePk] || [];
    if (list.indexOf(text) === -1) {
      list.push(text);
      state.irregularities[gamePk] = list.slice(-30);
    }
  }

  function persist(expectedSeq, expectedDate) {
    if (expectedSeq !== undefined && expectedSeq !== state.dateSeq) return;
    if (expectedDate !== undefined && expectedDate !== state.date) return;
    if (!state.log) state.log = FeedLog.emptyPayload(state.date);
    state.log.entries = state.entries.slice();
    state.log.snapshots = state.snapshots;
    state.log.irregularities = state.irregularities;
    state.log.observations = state.log.observations || {};
    state.log.timelines = timelinesForPersist();
    state.log.captures = capturesForPersist();
    state.log.savedAt = Date.now();
    FeedLog.save(state.date, state.log);
  }

  /* Only the fields the Live state section re-renders after a refresh. */
  function timelinesForPersist() {
    var out = Object.create(null);
    Object.keys(state.capture).forEach(function (pk) {
      var g = state.capture[pk];
      if (!g) return;
      if (g.timeline && g.timeline.length) out[pk] = g.timeline.slice(-TIMELINE_MAX);
    });
    return out;
  }

  function capturesForPersist() {
    var out = Object.create(null);
    Object.keys(state.capture).forEach(function (pk) {
      var g = state.capture[pk];
      if (!g || !g.snap) return;
      out[pk] = {
        snap: g.snap,
        matchupLabel: g.matchupLabel || '',
        lastCaptureAt: g.lastCaptureAt || null,
      };
    });
    return out;
  }

  function adoptLog(log) {
    if (!log) return;
    if (log.date && MLB.isValidISODate(log.date) && log.date !== state.date) return;
    state.log = log;
    state.entries = Array.isArray(log.entries)
      ? log.entries.filter(function (e) {
          return !e || !e.officialDate || e.officialDate === state.date;
        })
      : [];
    state.snapshots = log.snapshots || Object.create(null);
    state.irregularities = log.irregularities || Object.create(null);
    /* Restored rows were not observed live: pre-mark runs-at-risk rows so the
     * warning state stays visible but the chime does not fire on restore. */
    state.entries.forEach(function (e) {
      if (e && e.review && e.review.runsAtRiskCount > 0) e.warned = true;
    });
    /* Restore the captured game state so the Live state section survives a
     * refresh before the first probe lands.  A restored snapshot keeps its
     * official timestamp, so nothing here pretends to be live. */
    if (log.timelines || log.captures) {
      var caps = log.captures || {};
      Object.keys(caps).forEach(function (pk) {
        var saved = caps[pk] || {};
        var g = ensureGame(pk);
        if (saved.snap && !g.snap) g.snap = saved.snap;
        if (saved.matchupLabel && !g.matchupLabel) g.matchupLabel = saved.matchupLabel;
        g.restoredAt = Date.now();
      });
      var tls = log.timelines || {};
      Object.keys(tls).forEach(function (pk) {
        var g = ensureGame(pk);
        if (!g.timeline.length && Array.isArray(tls[pk])) g.timeline = tls[pk].slice(-TIMELINE_MAX);
      });
    }
  }

  /* --------------------------------------------------------------- scoring */

  function scoringPayload() {
    if (!state.scoring) state.scoring = ScoringLog.empty(state.date);
    return state.scoring;
  }

  function saveScoring() {
    if (state.scoring) ScoringLog.save(state.date, state.scoring);
  }

  function scoringSignature() {
    var p = state.scoring;
    if (!p || !Array.isArray(p.entries)) return '0';
    return state.scoringFilter + '|' + p.entries.map(function (e) {
      return [e.id, e.status, e.kind, e.lastSeenAt, e.resolvedAt || ''].join(':');
    }).join('|');
  }

  /* ------------------------------------------------------------- scan cycle */

  function flattenGames(payload) {
    var out = [];
    ((payload && payload.dates) || []).forEach(function (d) {
      (d.games || []).forEach(function (g) { out.push(g); });
    });
    return out;
  }

  /* Official team node from either feed shape (gameData.teams.away is the team
   * object in feed/live; schedule rows nest it under `.team`). */
  function teamOf(node) {
    var t = (node && node.team) || node || {};
    return { id: t.id === undefined ? null : Number(t.id), name: t.name || '', abbr: t.abbreviation || '' };
  }

  function teamsOf(game) {
    return {
      away: teamOf(game && game.teams && game.teams.away),
      home: teamOf(game && game.teams && game.teams.home),
    };
  }

  function matchupLabel(teams) {
    return UI.abbr(teams.away) + ' @ ' + UI.abbr(teams.home);
  }

  function ensureGame(pk) {
    var key = String(pk);
    if (!state.capture[key]) {
      state.capture[key] = {
        gamePk: Number(pk),
        snap: null,
        timeline: [],
        matchupLabel: '',
        teams: null,
        lastCaptureAt: 0,
        lastProbeAt: 0,
        lastTimeStamp: null,
        nextProbeDue: 0,
        nextCaptureDue: 0,
        probeFails: 0,
        captureFails: 0,
        restoredAt: null,
      };
    }
    return state.capture[key];
  }

  function gameStatusOf(game) {
    return (game && game.status && game.status.abstractGameState) || '';
  }

  function finalGraceDelay(elapsed) {
    if (elapsed < 2 * 60 * 1000) return 1000;
    if (elapsed < 5 * 60 * 1000) return 2500;
    return 15000;
  }

  function isHot(pk) {
    var g = state.capture[String(pk)];
    if (!g || !g.snap) return false;
    if (g.snap.review) return true;
    var pending = (state.scoring && state.scoring.entries) || [];
    for (var i = 0; i < pending.length; i += 1) {
      var e = pending[i];
      if (e && e.status === 'open' && String(e.gamePk) === String(pk)) return true;
    }
    return false;
  }

  function shouldFetch(game, now) {
    var status = gameStatusOf(game);
    var pk = game.gamePk;
    if (status === 'Live') {
      state.nextDue[pk] = now + PROBE_MS;
      return true;
    }
    if (status === 'Final') {
      if (!state.finalSeen[pk]) state.finalSeen[pk] = now;
      var elapsed = now - state.finalSeen[pk];
      if (elapsed > FINAL_GRACE_MS) return false;
      var due = state.nextDue[pk] || 0;
      if (now < due) return false;
      state.nextDue[pk] = now + finalGraceDelay(elapsed);
      return true;
    }
    return false;
  }

  /* ------------------------------------------------------------- one capture */

  /**
   * fetchState(game) — ONE request, the live state (~1.7 KB projected).
   *
   * This is the only request the fast path makes.  It carries the official
   * clock, the running state and the current at-bat, which is everything the
   * alert layer needs; the play LOG is fetched separately (fetchPlayLog) and
   * only to seed the official-scoring baseline and to diff completed at-bats.
   */
  /* Bounded concurrency: never more than `limit` requests in flight, so a
   * fifteen-game slate cannot open fifteen sockets at once and the browser's
   * per-host connection budget is respected. */
  function runLimited(items, limit, worker) {
    var index = 0;
    var active = 0;
    return new Promise(function (resolve) {
      if (!items.length) { resolve(); return; }
      function next() {
        if (index >= items.length && active === 0) { resolve(); return; }
        while (active < limit && index < items.length) {
          var item = items[index];
          index += 1;
          active += 1;
          worker(item).then(function () {
            active -= 1;
            next();
          }, function () {
            active -= 1;
            next();
          });
        }
      }
      next();
    });
  }

  function fetchState(game) {
    var started = Date.now();
    return MLB.gameStateCapture(game.gamePk)
      .then(function (payload) {
        return { game: game, payload: payload, rttMs: Date.now() - started };
      })
      .catch(function (err) {
        /* v1.1 answers everything current; the v1 path is the documented
         * fallback and costs one extra request only when v1.1 refuses. */
        if (err && (err.status === 404 || err.status === 400)) {
          var url = MLB.API_ROOT + '/v1/game/' + game.gamePk + '/feed/live?fields=' + encodeURIComponent(MLB.STATE_FIELDS);
          return MLB.getJSON(url, { retries: 0 }).then(function (payload) {
            return { game: game, payload: payload, rttMs: Date.now() - started, fellBackToV1: true };
          }).catch(function (err2) {
            return { game: game, payload: null, rttMs: Date.now() - started, error: err2 };
          });
        }
        return { game: game, payload: null, rttMs: Date.now() - started, error: err };
      });
  }

  /**
   * fetchPlayLog(game) — the official play log, fetched when the scoring
   * baseline needs establishing and then at most once per few seconds while an
   * at-bat is pending.  Keeping this off the fast path is what lets the state
   * poll run every 250 ms without moving megabytes.
   */
  function fetchPlayLog(game) {
    return MLB.gameFeedCapture(game.gamePk, { fields: MLB.FEED_FIELDS })
      .then(function (payload) { return { game: game, payload: payload }; })
      .catch(function (err) {
        return { game: game, payload: null, error: err };
      });
  }

  function ingestCapture(result, expectedSeq, expectedDate) {
    if (expectedSeq !== undefined && expectedSeq !== state.dateSeq) return;
    if (expectedDate !== undefined && expectedDate !== state.date) return;
    if (!result) return;
    if (!result.payload) {
      if (result.error && !(result.error && result.error.quiet)) state.scanError = result.error;
      var failed = ensureGame(result.game && result.game.gamePk);
      failed.captureFails = (failed.captureFails || 0) + 1;
      return;
    }

    var game = result.game || {};
    var pk = game.gamePk;
    var g = ensureGame(pk);
    var teams = teamsOf(game);
    var label = matchupLabel(teams);
    g.matchupLabel = label;
    g.teams = teams;
    g.lastCaptureAt = Date.now();
    g.captureFails = 0;
    if (result.rttMs !== undefined) {
      state.net.lastCaptureRttMs = result.rttMs;
      state.net.captures += 1;
    }

    var snap = GameState.snapshot(result.payload, { capturedAt: Date.now() });
    if (!snap) return;
    if (snap.teams && snap.teams.away && snap.teams.away.id) {
      teams = {
        away: { id: snap.teams.away.id, name: snap.teams.away.name, abbr: snap.teams.away.abbr },
        home: { id: snap.teams.home.id, name: snap.teams.home.name, abbr: snap.teams.home.abbr },
      };
      g.teams = teams;
      label = matchupLabel(teams);
      g.matchupLabel = label;
    }
    snap.matchupLabel = label;

    var prev = g.snap;
    var d = GameState.diff(prev, snap);
    g.snap = snap;
    g.lastTimeStamp = snap.apiTimeStamp || g.lastTimeStamp;
    state.net.lastApiTimeStamp = snap.apiTimeStamp || state.net.lastApiTimeStamp;
    state.net.lastLatencyMs = snap.latencyMs === null ? state.net.lastLatencyMs : snap.latencyMs;

    /* An event-level change → stay on the single-round-trip path for a while,
     * so the follow-up pitches of this at-bat are captured in the same request
     * instead of costing a probe first. */
    if (d.changes.some(function (c) { return BURST_KINDS.indexOf(c.kind) !== -1; })) {
      g.burstUntil = Date.now() + BURST_WINDOW_MS;
    }

    /* Whole-state transitions onto the timeline (every one, second-stamped). */
    if (d.changes.length) {
      d.changes.forEach(function (c) {
        g.timeline.push({
          at: c.capturedAt,
          iso: new Date(c.capturedAt).toISOString(),
          apiTimeStamp: c.apiTimeStamp,
          kind: c.kind,
          text: c.text,
          official: c.official || '',
        });
      });
      if (g.timeline.length > TIMELINE_MAX) g.timeline = g.timeline.slice(-TIMELINE_MAX);
    }

    /* Milestone transitions become feed rows + alerts (one row per game+kind,
     * updated in place, so a 12–4 game does not create 40 score rows). */
    d.changes.forEach(function (c) {
      if (MILESTONE_KINDS.indexOf(c.kind) === -1) return;
      var entryId = pk + ':' + (c.kind === 'performance' ? 'state' : c.kind) + ':state';
      var created = upsertEntry({
        id: entryId,
        kind: 'state',
        stateKind: c.kind,
        gamePk: pk,
        matchupLabel: label,
        teams: teams,
        officialDate: snap.officialDate,
        capturedAt: c.capturedAt,
        apiTimeStamp: c.apiTimeStamp,
        apiTimeStampIso: snap.apiTimeStampIso,
        latencyMs: snap.latencyMs,
        stateChange: {
          kind: c.kind,
          before: c.before,
          after: c.after,
          text: c.text,
          official: c.official,
        },
        snapshotSummary: GameState.describe(snap),
        firstSeenLabel: MLB.formatGameTime(game.gameDate),
      });
      if (created) chime(c.kind === 'score' ? 'state' : (c.kind === 'reviewOpen' ? 'review' : 'state'));
      else if (c.kind === 'score') chime('state');
    });

    /* ---- play log: seeded once, refreshed on its own slow cadence ---- */
    var cache = playCacheOf(pk);
    var plays = cache.plays && cache.plays.length
      ? cache.plays
      : Reviews.playsOf(result.payload);   /* a whole-feed payload still carries it */

    /* A ruling is pending → the play log has to stay close behind the state. */
    cache.pending = Reviews.pendingRulings(plays, { gamePk: pk }).length > 0;

    /* Cheap signals that the play LOG must have moved even though the fast
     * state payload does not carry it: a new at-bat, a completed at-bat, or a
     * review/status code.  Any of these puts the log re-read on its short
     * cadence instead of the three-minute sweep. */
    var atBatNow = snap.atBat && snap.atBat.index !== undefined ? snap.atBat.index : null;
    var statusNow = snap.status && snap.status.statusCode ? String(snap.status.statusCode) : '';
    if (cache.atBatSeen !== atBatNow || cache.statusSeen !== statusNow ||
        (snap.atBat && snap.atBat.isComplete)) {
      cache.dirty = true;
    }
    cache.atBatSeen = atBatNow;
    cache.statusSeen = statusNow;
    maybeFetchPlayLog(game, snap, cache.fetchedAt ? 'refresh' : 'seed');

    var meta = { gamePk: pk, teams: teams, feed: result.payload };
    var reviews = Reviews.extractReviews(plays, meta);
    reviews.forEach(function (review) {
      var existing = state.entries.find(function (e) { return e.id === review.id; });
      var before = existing && existing.scoreTracker && existing.scoreTracker.before
        ? existing.scoreTracker.before : null;

      var scoreTracker = { before: before, possible: null, actual: null };

      if (review.inProgress) {
        /* Call-on-field score while the review is still open = the score the
         * review is deciding on.  Taken from the official linescore/result. */
        scoreTracker.before = review.score || before;
      } else {
        scoreTracker.actual = review.scoreAfter || null;
        if (!scoreTracker.before && before) scoreTracker.before = before;
        if (!scoreTracker.before) {
          /* Never infer or fill in the pre-ruling score when the page opened
           * after resolution (README §"Before / Possible / Actual score tracker"). */
          noteIrregularity(pk, 'Before-review score was not observed for ' + review.id + ' (page opened after the ruling).');
        }
      }
      if (scoreTracker.before && review.runsAtRiskCount > 0) {
        scoreTracker.possible = { away: scoreTracker.before.away, home: scoreTracker.before.home };
        scoreTracker.possible[review.battingSide] = Math.max(0, scoreTracker.possible[review.battingSide] - review.runsAtRiskCount);
      }

      /* The official wording before/after this review: the status the API
       * reported while it was open, and the status it reports now. */
      var openStatus = existing && existing.openStatus ? existing.openStatus : null;
      var openStatusNow = review.inProgress
        ? { statusCode: snap.status.statusCode, detailedState: snap.status.detailedState, reason: snap.status.reason, apiTimeStamp: snap.apiTimeStamp }
        : openStatus;
      var resolvedStatus = review.inProgress ? null
        : { statusCode: snap.status.statusCode, detailedState: snap.status.detailedState, reason: snap.status.reason, apiTimeStamp: snap.apiTimeStamp };

      var entry = {
        id: review.id,
        kind: 'review',
        gamePk: pk,
        matchupLabel: label,
        teams: teams,
        officialDate: snap.officialDate,
        review: review,
        scoreTracker: scoreTracker,
        openStatus: openStatusNow,
        resolvedStatus: resolvedStatus,
        firstSeenLabel: MLB.formatGameTime(game.gameDate),
        apiTimeStamp: snap.apiTimeStamp,
        latencyMs: snap.latencyMs,
      };

      var isNew = upsertEntry(entry);
      /* Always operate on the stored entry: upsertEntry merges into the
       * existing object, so flags like `warned` live there. */
      entry = state.entries.find(function (e) { return e.id === entry.id; }) || entry;

      if (isNew && !review.isABS) chime('review');
      if (review.runsAtRiskCount > 0 && !entry.warned) {
        /* "whenever an active review could remove a run" — chime the moment the
         * condition first becomes visible (including mid-review), then mark the
         * entry so it never re-chimes. Restored rows are pre-marked in adoptLog. */
        entry.warned = true;
        chime('risk');
        notifyRunAtRisk(review, teams);
      }
    });

    /* ---- official scoring: pending rulings + reclassifications ---- */
    ingestScoring(game, plays, meta, snap, label, teams);

    /* ---- counter regressions & official MGR / ABS counters ---- */
    state.counterCache = state.counterCache || Object.create(null);
    var prevCached = state.counterCache[pk] || null;
    var gd = result.payload.gameData || {};
    var reviewCounters = Reviews.managerCounters(gd.review) || (prevCached && prevCached.manager) || null;
    var absCounters = Reviews.absCounters(gd.absChallenges) || (prevCached && prevCached.abs) || null;
    state.absFetchedRevCount[pk] = reviews.length;

    var regression = Reviews.counterRegression(prevCached, { manager: reviewCounters, abs: absCounters });
    if (regression) {
      regression.forEach(function (note) {
        noteIrregularity(pk, 'Official counter ' + note + ' — flagged, not corrected.');
      });
    }
    state.counterCache[pk] = {
      manager: reviewCounters,
      abs: absCounters,
      awayAbbr: UI.abbr(teams.away),
      homeAbbr: UI.abbr(teams.home),
    };
  }

  /* ------------------------------------------------------- play-log seeds
   * The live state is captured every 250 ms from the projected STATE payload.
   * That payload carries the running state and the CURRENT at-bat but not the
   * historical play log, which two things need:
   *
   *   · review rows (a review is recorded on the at-bat it happened in)
   *   · the official-scoring baseline + reclassification diff
   *
   * So the play log is fetched on its own, much slower cadence, and merged:
   *   seed    one full play-log read per game, on its first capture
   *   top-up  re-read only when the official status says a review is open, or
   *           when an at-bat is awaiting an official ruling
   *   sweep   one bounded re-read per game every few minutes, which is what
   *           catches a scoring change made after the play left the screen
   *
   * Cache is per game, bounded, and independent of the state path: if a
   * play-log read fails, the state capture and its alerts are unaffected.
   */
  var PLAYLOG_SWEEP_MS = 180000;     /* re-read every 3 min per game              */
  var PLAYLOG_PENDING_MS = 4000;     /* … 4 s while a ruling is pending/under review */
  var PLAYLOG_MIN_GAP_MS = 2500;     /* never two reads of one game closer than this */

  function playCacheOf(pk) {
    var key = String(pk);
    if (!state.playCache) state.playCache = Object.create(null);
    if (!state.playCache[key]) {
      state.playCache[key] = {
        plays: [], fetchedAt: 0, atBatIndex: null, pending: false,
        epoch: 0, inFlight: false, lastError: null,
      };
    }
    return state.playCache[key];
  }

  function maybeFetchPlayLog(game, snap, reason) {
    var pk = game.gamePk;
    var cache = playCacheOf(pk);
    if (cache.inFlight) return null;
    var now = Date.now();
    var since = now - (cache.fetchedAt || 0);
    var hot = !!cache.pending || !!(snap && snap.review) ||
      (snap && snap.status && /^(M|N|IH)/i.test(String(snap.status.statusCode || '')));
    var cadence = hot ? PLAYLOG_PENDING_MS : PLAYLOG_SWEEP_MS;
    var floor = cache.dirty ? PLAYLOG_MIN_GAP_MS : cadence;
    if (cache.fetchedAt && since < Math.max(PLAYLOG_MIN_GAP_MS, floor)) return null;
    if (!cache.fetchedAt && reason !== 'seed') return null;

    cache.inFlight = true;
    var epoch = cache.epoch;
    return fetchPlayLog(game).then(function (result) {
      cache.inFlight = false;
      if (!result || !result.payload) {
        cache.lastError = (result && result.error && result.error.message) || 'play-log read failed';
        return;
      }
      if (epoch !== cache.epoch) return;          /* date/game switched underneath */
      cache.lastError = null;
      cache.plays = Reviews.playsOf(result.payload);
      cache.fetchedAt = Date.now();
      cache.dirty = false;
      var last = null;
      for (var i = cache.plays.length - 1; i >= 0; i -= 1) {
        var p = cache.plays[i];
        if (p && p.about && p.about.atBatIndex !== undefined) { last = p; break; }
      }
      cache.atBatIndex = last && last.about ? Number(last.about.atBatIndex) : null;
      cache.pending = !!(last && last.result &&
        /^os_ruling_pending/.test(String(last.result.eventType || '')));
      state.net.playLogFetches += 1;
      ingestPlayLog(result.game, result.payload, snap, 'playlog');
      persist(state.dateSeq, state.date);
      renderIfChanged();
      updateChrome();
    }).catch(function (err) {
      cache.inFlight = false;
      cache.lastError = (err && err.message) || 'play-log read failed';
    });
  }

  /**
   * ingestPlayLog(game, payload, snap) — the play log has changed under us, so
   * run the parts of the ingest that need it.  Everything here is idempotent:
   * the review rows are upserted by their own id and the scoring log merges on
   * its own key, so a re-read never duplicates a row or re-fires an alert.
   */
  function ingestPlayLog(game, payload, snap, reason) {
    var pk = game.gamePk;
    if (state.dateSeq === undefined) return;
    var plays = Reviews.playsOf(payload);
    if (!plays.length) return;
    var node = state.capture[String(pk)];
    var teams = (node && node.teams) ||
      (snap && snap.teams && { away: snap.teams.away, home: snap.teams.home }) || teamsOf(game);
    var label = (node && node.matchupLabel) || matchupLabel(teams);
    var meta = { gamePk: pk, teams: teams, feed: payload };
    var effective = snap || (node && node.snap) || null;

    /* Reviews: re-derived from the fresh play log.  Uses the same parser and
     * the same entry keys as before, so this is a refresh, not a new source. */
    var reviews = Reviews.extractReviews(plays, meta);
    reviews.forEach(function (review) {
      var existing = state.entries.find(function (e) { return e.id === review.id; });
      var before = existing && existing.scoreTracker && existing.scoreTracker.before
        ? existing.scoreTracker.before : null;
      var scoreTracker = { before: before, possible: null, actual: null };
      if (review.inProgress) {
        if (scoreTracker.before && review.runsAtRiskCount > 0) {
          scoreTracker.possible = { away: scoreTracker.before.away, home: scoreTracker.before.home };
          scoreTracker.possible[review.battingSide] = Math.max(0,
            scoreTracker.possible[review.battingSide] - review.runsAtRiskCount);
        }
      }
      var openStatus = existing && existing.openStatus ? existing.openStatus : null;
      var openStatusNow = review.inProgress
        ? { statusCode: effective.status.statusCode, detailedState: effective.status.detailedState, reason: effective.status.reason, apiTimeStamp: effective.apiTimeStamp }
        : openStatus;
      var resolvedStatus = review.inProgress ? null
        : { statusCode: effective.status.statusCode, detailedState: effective.status.detailedState, reason: effective.status.reason, apiTimeStamp: effective.apiTimeStamp };
      var entry = {
        id: review.id,
        kind: 'review',
        gamePk: pk,
        matchupLabel: label,
        teams: teams,
        officialDate: effective.officialDate || (payload.gameData && payload.gameData.datetime && payload.gameData.datetime.officialDate) || null,
        review: review,
        scoreTracker: scoreTracker,
        openStatus: openStatusNow,
        resolvedStatus: resolvedStatus,
        firstSeenLabel: MLB.formatGameTime(game.gameDate),
        apiTimeStamp: effective.apiTimeStamp,
        latencyMs: effective.latencyMs,
      };
      var created = upsertEntry(entry);
      if (!created) return;
      /* Same discipline as the state path: an alert for a row that was not
       * on screen before, once.  ABS pitch challenges stay silent. */
      if (!review.isABS) chime(review.runsAtRiskCount > 0 ? 'risk' : 'review');
      else if (review.runsAtRiskCount > 0) chime('risk');
    });

    /* Official scoring: pending rulings + reclassifications. */
    ingestScoring(game, plays, meta, effective, label, teams);
    void reason;
  }

  /* ------------------------------------------------- observation archive
   * The alert feed's store keeps, per game, the last official classification of
   * every completed at-bat.  `diffSnapshots` can then always answer "did the
   * official scorer change this play?" — across refreshes, tabs and browser
   * restarts — without piling every observation into storage (one row per
   * at-bat, replaced in place).  Bounded so a doubleheader cannot bloat it.
   */
  var ARCHIVE_MAX_PLAYS = 400;

  function archiveOf() {
    if (!state.log) state.log = FeedLog.emptyPayload(state.date);
    if (!state.log.observations || typeof state.log.observations !== 'object') state.log.observations = {};
    return state.log.observations;
  }

  function archiveRead(pk) {
    var map = null;
    try { map = archiveOf()[String(pk)]; } catch (e) { map = null; }
    if (map) {
      state.snapshots[String(pk)] = map;
      return map;
    }
    return state.snapshots[String(pk)] || null;
  }

  function archiveWrite(pk, snapshot) {
    state.snapshots[String(pk)] = snapshot;
    var all = archiveOf();
    var keys = Object.keys(snapshot || {});
    if (keys.length > ARCHIVE_MAX_PLAYS) {
      var trimmed = Object.create(null);
      keys.slice(-ARCHIVE_MAX_PLAYS).forEach(function (k) { trimmed[k] = snapshot[k]; });
      snapshot = trimmed;
      state.snapshots[String(pk)] = snapshot;
    }
    all[String(pk)] = snapshot;
    /* Post-Final re-scans can run for 30 minutes per game; keep the archive
     * from outgrowing the log on a 15-game day. */
    var games = Object.keys(all);
    if (games.length > 40) {
      games.slice(0, games.length - 40).forEach(function (k) { delete all[k]; });
    }
  }

  /* ------------------------------------------------- official scoring log */

  function sameSide(a, b) {
    if (!a || !b) return true;
    return a.eventType === b.eventType && a.description === b.description &&
      a.isOut === b.isOut && a.outs === b.outs && a.rbi === b.rbi &&
      a.awayScore === b.awayScore && a.homeScore === b.homeScore;
  }

  /**
   * ingestScoring(...) — everything that belongs to the separate Official
   * Scoring Log.  Reads the same official payload; writes ONLY to
   * ScoringLog (its own storage), never to the alert feed's store.
   */
  function ingestScoring(game, plays, meta, snap, label, teams) {
    var pk = game.gamePk;
    var payload = scoringPayload();
    var seenAtBat = [];

    /* 1. pending rulings — official eventType from the API's own registry */
    var pending = Reviews.pendingRulings(plays, meta);
    pending.forEach(function (row) {
      seenAtBat.push(row.atBatIndex);
      var key = pk + ':' + row.atBatIndex + ':pending';
      var existing = ScoringLog.findEntry(payload, key);
      var res = ScoringLog.upsert(payload, {
        id: key,
        kind: 'pending',
        date: state.date,
        gamePk: pk,
        matchup: label,
        atBatIndex: row.atBatIndex,
        inningLabel: row.inningLabel,
        batter: row.batter,
        pitcher: row.pitcher,
        status: 'open',
        firstSeenAt: existing ? existing.firstSeenAt : Date.now(),
        firstSeenIso: existing ? existing.firstSeenIso : ScoringLog.isoSecond(Date.now()),
        firstSeenApiTimeStamp: (existing && existing.firstSeenApiTimeStamp) || snap.apiTimeStamp,
        firstSeenLatencyMs: (existing && Number.isFinite(existing.firstSeenLatencyMs)) ? existing.firstSeenLatencyMs : snap.latencyMs,
        lastSeenAt: Date.now(),
        lastSeenApiTimeStamp: snap.apiTimeStamp,
        before: {
          eventType: row.eventType,
          description: row.description,
          official: row.description,
          statusCode: snap.status.statusCode,
          detailedState: snap.status.detailedState,
          reason: snap.status.reason,
          awayScore: row.score ? row.score.away : null,
          homeScore: row.score ? row.score.home : null,
          apiTimeStamp: (existing && existing.before && existing.before.apiTimeStamp) || snap.apiTimeStamp,
          capturedAt: (existing && existing.before && existing.before.capturedAt) || Date.now(),
          capturedIso: ScoringLog.isoSecond((existing && existing.before && existing.before.capturedAt) || Date.now()),
          source: row.source,
        },
        after: existing ? existing.after : null,
        attribution: 'Official Scorer ruling pending — the API publishes no ruling yet; nothing is inferred.',
        sources: [
          'https://statsapi.mlb.com/api/v1/game/' + pk + '/playByPlay',
          'https://statsapi.mlb.com/api/v1/eventTypes',
        ],
        notes: existing ? [] : ['Opened ' + (snap.apiTimeStamp || 'at capture') + ' — official eventType ' + row.eventType + '.'],
        observations: [{ at: Date.now(), apiTimeStamp: snap.apiTimeStamp, eventType: row.eventType }],
        verified: existing ? existing.verified : { eventTypeVerified: 'eventTypes registry', on: 'GET /api/v1/eventTypes' },
        verifiedAtBat: null,
      });
      void res;

      /* Mirror the row into the alert feed.  The LOG is the separate store
       * above; this is only what the operator reads, so a failure here cannot
       * lose the log entry.  The alert fires on a new FEED row — a restored
       * log never re-chimes, a row that appears in front of you always does. */
      if (upsertEntry({
        id: pk + ':' + row.atBatIndex + ':pending',
        kind: 'pending',
        gamePk: pk,
        matchupLabel: label,
        teams: teams,
        officialDate: snap.officialDate,
        pending: row,
        apiTimeStamp: snap.apiTimeStamp,
        latencyMs: snap.latencyMs,
        review: {
          typeLabel: 'Official Scorer Ruling Pending',
          reason: row.eventType === 'os_ruling_pending_primary' ? 'Primary event ruling pending' : 'Prior event ruling pending',
          inningLabel: row.inningLabel,
          description: row.description,
          batter: { name: row.batter },
          pitcher: { name: row.pitcher },
          outcome: 'Pending',
          isABS: false,
          isBoundary: false,
          runsAtRiskCount: 0,
          family: 'pending',
        },
      })) chime('pending');
    });

    /* 2. pending resolutions + reclassifications, from the snapshot diff.
     * The previous observation comes from the ARCHIVE in this feed's own store
     * (see observationsFor), so a refresh, a reload or a second tab still
     * compares against what was actually observed — and a first-ever
     * observation records a baseline instead of inventing changes. */
    var snapshot = Reviews.snapshotPlays(plays);
    var previous = archiveRead(pk);
    var diff = Reviews.diffSnapshots(previous, snapshot);
    archiveWrite(pk, snapshot);

    diff.changes.forEach(function (change) {
      var key = pk + ':' + change.atBatIndex + ':change';
      var existing = ScoringLog.findEntry(payload, key);
      var wasPending = ScoringLog.findEntry(payload, pk + ':' + change.atBatIndex + ':pending');
      ScoringLog.upsert(payload, {
        id: key,
        kind: 'change',
        date: state.date,
        gamePk: pk,
        matchup: label,
        atBatIndex: change.atBatIndex,
        inningLabel: change.inningLabel,
        batter: change.batter,
        status: 'resolved',
        firstSeenAt: existing ? existing.firstSeenAt : Date.now(),
        firstSeenIso: existing ? existing.firstSeenIso : ScoringLog.isoSecond(Date.now()),
        firstSeenApiTimeStamp: snap.apiTimeStamp,
        lastSeenAt: Date.now(),
        lastSeenApiTimeStamp: snap.apiTimeStamp,
        resolvedAt: existing && existing.resolvedAt ? existing.resolvedAt : Date.now(),
        resolvedApiTimeStamp: snap.apiTimeStamp,
        before: Object.assign({}, change.from, {
          official: change.from.description,
          capturedAt: Date.now(),
          capturedIso: ScoringLog.isoSecond(Date.now()),
          apiTimeStamp: (previous && previous.__ts) || (existing && existing.before && existing.before.apiTimeStamp) || null,
          source: 'consecutive official observations of /playByPlay',
        }),
        after: Object.assign({}, change.to, {
          official: change.to.description,
          capturedAt: Date.now(),
          capturedIso: ScoringLog.isoSecond(Date.now()),
          apiTimeStamp: snap.apiTimeStamp,
          source: 'https://statsapi.mlb.com/api/v1/game/' + pk + '/playByPlay',
        }),
        attribution: change.attribution,
        sources: ['https://statsapi.mlb.com/api/v1/game/' + pk + '/playByPlay'],
        notes: wasPending
          ? ['Pending ruling at-bat ' + change.atBatIndex + ' resolved to ' + (change.to.eventType || '—') + '.']
          : [],
        observations: [{ at: Date.now(), apiTimeStamp: snap.apiTimeStamp, eventType: change.to.eventType }],
      });
      if (upsertEntry({
        id: pk + ':' + change.atBatIndex + ':scoring-change',
        kind: 'scoring_change',
        gamePk: pk,
        matchupLabel: label,
        teams: teams,
        officialDate: snap.officialDate,
        change: change,
        apiTimeStamp: snap.apiTimeStamp,
        latencyMs: snap.latencyMs,
        review: {
          typeLabel: 'Official Scoring Change',
          reason: '',
          inningLabel: change.inningLabel,
          description: 'Initial call: ' + (change.from.description || '') + ' → Final: ' + (change.to.description || ''),
          batter: { name: change.batter },
          pitcher: { name: '' },
          outcome: 'Reclassified',
          isABS: false,
          isBoundary: false,
          runsAtRiskCount: 0,
          family: 'scoring',
        },
      })) chime('scoring');
      /* The pending row for the same at-bat is now answered: close it with the
       * official final wording rather than deleting it. */
      if (wasPending && wasPending.status !== 'resolved') {
        ScoringLog.upsert(payload, Object.assign({}, wasPending, {
          id: wasPending.id,
          status: 'resolved',
          resolvedAt: Date.now(),
          resolvedApiTimeStamp: snap.apiTimeStamp,
          after: wasPending.after || {
            eventType: change.to.eventType,
            description: change.to.description,
            official: change.to.description,
            isOut: change.to.isOut,
            outs: change.to.outs,
            awayScore: change.to.awayScore,
            homeScore: change.to.homeScore,
            apiTimeStamp: snap.apiTimeStamp,
            source: 'https://statsapi.mlb.com/api/v1/game/' + pk + '/playByPlay',
          },
          notes: ['Resolved by official reclassification observed at ' + (snap.apiTimeStamp || 'capture') + '.'],
        }));
      }
    });

    diff.edits.forEach(function (edit) {
      noteIrregularity(pk, 'Play ' + edit.atBatIndex + ' edited without reclassification (' +
        edit.inningLabel + ') — flagged, not corrected.');
      var key = pk + ':' + edit.atBatIndex + ':edit';
      var existing = ScoringLog.findEntry(payload, key);
      ScoringLog.upsert(payload, {
        id: key,
        kind: 'edit',
        date: state.date,
        gamePk: pk,
        matchup: label,
        atBatIndex: edit.atBatIndex,
        inningLabel: edit.inningLabel,
        batter: edit.batter,
        status: 'resolved',
        firstSeenAt: existing ? existing.firstSeenAt : Date.now(),
        lastSeenAt: Date.now(),
        lastSeenApiTimeStamp: snap.apiTimeStamp,
        resolvedAt: existing && existing.resolvedAt ? existing.resolvedAt : Date.now(),
        resolvedApiTimeStamp: snap.apiTimeStamp,
        before: Object.assign({}, edit.before, { official: edit.before.description, apiTimeStamp: existing && existing.before ? existing.before.apiTimeStamp : null }),
        after: Object.assign({}, edit.after, { official: edit.after.description, apiTimeStamp: snap.apiTimeStamp }),
        attribution: 'Payload edited without a reclassification — flagged for review, never corrected.',
        sources: ['https://statsapi.mlb.com/api/v1/game/' + pk + '/playByPlay'],
        notes: [edit.note],
      });
      if (upsertEntry({
        id: pk + ':' + edit.atBatIndex + ':scoring-edit',
        kind: 'scoring_change',
        gamePk: pk,
        matchupLabel: label,
        teams: teams,
        officialDate: snap.officialDate,
        change: {
          atBatIndex: edit.atBatIndex,
          inningLabel: edit.inningLabel,
          batter: edit.batter,
          from: edit.before,
          to: edit.after,
          attribution: edit.note,
        },
        apiTimeStamp: snap.apiTimeStamp,
        latencyMs: snap.latencyMs,
        review: {
          typeLabel: 'Official Scoring Edit',
          reason: '',
          inningLabel: edit.inningLabel,
          description: edit.note,
          batter: { name: edit.batter },
          pitcher: { name: '' },
          outcome: 'Flagged',
          isABS: false,
          isBoundary: false,
          runsAtRiskCount: 0,
          family: 'scoring',
        },
      })) chime('scoring');
    });

    diff.vanished.forEach(function (gone) {
      noteIrregularity(pk, 'Play ' + gone.atBatIndex + ' (' + gone.inningLabel +
        ') disappeared from the payload after being observed — flagged, not corrected.');
    });

    /* 3. open pending rulings that are no longer pending and never showed a
     * reclassification stay open but are flagged: never guess a ruling. */
    (payload.entries || []).forEach(function (e) {
      if (!e || e.status !== 'open' || String(e.gamePk) !== String(pk)) return;
      if (e.kind !== 'pending') return;
      if (seenAtBat.indexOf(e.atBatIndex) !== -1) return;
      var still = snapshot[e.atBatIndex];
      if (!still) return;
      if (still.eventType === 'os_ruling_pending_primary' || still.eventType === 'os_ruling_pending_prior') return;
      var note = 'No longer events-type pending in the payload; official wording now "' +
        (still.description || still.eventType) + '". Logged, not inferred.';
      if ((e.notes || []).indexOf(note) === -1) {
        e.notes = (e.notes || []).concat([note]).slice(-8);
        e.lastSeenAt = Date.now();
        e.status = 'unresolved';
      }
    });

    /* 4. a bounded rule: pending rows never survive the next day's log. */
    ScoringLog.pruneBaselines(payload, Object.keys(snapshot).map(Number));
    state.scoring = payload;
    saveScoring();
    refreshScoringSection();
  }

  /* ------------------------------------------------------------- the loops */

  function scan() {
    if (state.scanning) return;
    if (typeof document !== 'undefined' && document.hidden) { scheduleScan(1000); return; }
    var scanSeq = state.dateSeq;
    var scanDate = state.date;
    state.scanning = true;
    state.nextScanAt = Date.now() + PROBE_MS;

    MLB.schedule(scanDate, { ttl: 0, retries: 0 })
      .then(function (payload) {
        if (scanSeq !== state.dateSeq || scanDate !== state.date) return null;
        state.games = flattenGames(payload);
        state.slatesAt = Date.now();
        var now = Date.now();
        var due = state.games.filter(function (g) { return shouldFetch(g, now); });
        state.games.forEach(function (g) {
          var node = ensureGame(g.gamePk);
          node.status = g.status || node.status || null;
          if (!node.teams || !node.teams.away.name) node.teams = teamsOf(g);
          if (!node.matchupLabel) node.matchupLabel = matchupLabel(node.teams || teamsOf(g));
          node.gameDate = g.gameDate || node.gameDate || null;
        });
        state.scanError = null;
        if (!due.length) {
          updateChrome();
          renderIfChanged();
          return null;
        }
        return runLimited(due, FETCH_CONCURRENCY, function (game) {
          if (scanSeq !== state.dateSeq || scanDate !== state.date) return Promise.resolve();
          /* One capture in flight per game: the status sweep and the probe
           * both want the same payload, and asking twice would both waste a
           * request and race two ingests of the same state. */
          if (state.capturing[game.gamePk]) return Promise.resolve();
          state.capturing[game.gamePk] = true;
          return fetchState(game).then(function (result) {
            state.capturing[game.gamePk] = false;
            ingestCapture(result, scanSeq, scanDate);
          });
        }).then(function () {
          if (scanSeq !== state.dateSeq || scanDate !== state.date) return;
          persist(scanSeq, scanDate);
          renderIfChanged();
          updateChrome();
        });
      })
      .catch(function (err) {
        if (scanSeq !== state.dateSeq || scanDate !== state.date) return;
        state.scanError = err;
        updateChrome();
      })
      .then(function () {
        if (scanSeq !== state.dateSeq || scanDate !== state.date) return;
        state.scanning = false;
        state.lastScanAt = Date.now();
        scheduleScan(slateDelay());
      });
  }

  function slateDelay() {
    var live = state.games.some(function (g) { return gameStatusOf(g) === 'Live'; });
    if (live) return SLATE_MS;
    var preview = state.games.some(function (g) { return gameStatusOf(g) === 'Preview'; });
    return preview ? SLATE_MS : SLATE_MS_IDLE;
  }

  function scheduleScan(delay) {
    clearTimeout(state.timers.scan);
    state.nextScanAt = Date.now() + delay;
    state.timers.scan = setTimeout(scan, delay);
  }

  /* 125 ms official status sweep: catches a review the moment MLB flips it. */
  function sweep() {
    var sweepSeq = state.dateSeq;
    var sweepDate = state.date;
    if (!state.games.some(function (g) { return gameStatusOf(g) === 'Live'; })) return;
    MLB.slateStatus(sweepDate).then(function (payload) {
      if (sweepSeq !== state.dateSeq || sweepDate !== state.date) return;
      var games = flattenGames(payload);
      games.forEach(function (g) {
        var node = ensureGame(g.gamePk);
        if (g.status) node.status = g.status;
        var review = Reviews.statusReview(g.status);
        var prev = state.statusByPk[g.gamePk];
        var nextKey = review ? review.code + '|' + review.reason + '|' + ((g.status && g.status.detailedState) || '') : '';
        if (prev !== nextKey) {
          var wasReview = typeof prev === 'string' && prev !== '';
          state.statusByPk[g.gamePk] = nextKey;
          /* Out-of-band capture: don't wait for the current scan to finish, and
           * don't wait for the next probe tick either — this is the earliest
           * official signal MLB publishes that a review has been called. */
          if (review) {
            captureNow(g, sweepSeq, sweepDate, 'status-sweep');
          } else if (wasReview) {
            captureNow(g, sweepSeq, sweepDate, 'review-resolved');
          }
        }
      });
    }).catch(function () { /* the scan owns error reporting */ });
  }

  function captureNow(game, seq, date, reason) {
    var pk = game.gamePk;
    if (state.capturing[pk]) return;
    state.capturing[pk] = true;
    fetchState(game).then(function (result) {
      state.capturing[pk] = false;
      if (seq !== state.dateSeq || date !== state.date) return;
      result.reason = reason;
      ingestCapture(result, seq, date);
      persist(seq, date);
      renderIfChanged();
      updateChrome();
    }).catch(function () {
      state.capturing[pk] = false;
    });
  }

  /**
   * captureTick() — the fast path.
   *
   * Two ways to stay current, chosen per game per tick:
   *
   *  DIRECT  the projected live state, one round trip (~1.7 KB).  Used while the game is
   *          visibly moving (`node.burstUntil`), while it is in a review or has
   *          an open ruling, and for the very first capture.  This is the
   *          shortest possible path to a new event: capture interval + RTT.
   *          Measured cost on a 7th-inning snapshot: ~1.7 KB, against ~16 KB
   *          for the same game's whole feed — the play log is simply not part
   *          of the fast path.
   *  PROBE   a 150-byte change probe whenever the game has gone quiet; only a
   *          moved official timestamp is followed by a capture.  This keeps a
   *          fifteen-game slate from pulling megabytes a second while nothing
   *          is happening, so the bytes we do spend land where they matter.
   *
   * Either way the official `metaData.timeStamp` of every capture is recorded,
   * so the feed can state how far behind the API's own clock it was.
   */
  function captureTick() {
    if (typeof document !== 'undefined' && document.hidden) return;
    var now = Date.now();
    var seq = state.dateSeq;
    var date = state.date;
    var list = state.games.filter(function (g) {
      var status = gameStatusOf(g);
      if (status === 'Live') return true;
      if (status === 'Final') {
        var seen = state.finalSeen[g.gamePk];
        return seen !== undefined && now - seen < FINAL_GRACE_MS;
      }
      return false;
    });
    if (!list.length) return;

    var budget = Math.max(0, FETCH_CONCURRENCY * 2 - state.probesInFlight);
    if (!budget) return;

    var ready = list.filter(function (g) {
      return !state.capturing[g.gamePk];
    });
    var direct = [];
    var probe = [];
    ready.forEach(function (g) {
      var node = ensureGame(g.gamePk);
      var hot = isHot(g.gamePk);
      var bursting = (node.burstUntil || 0) > now || !node.snap;
      if (hot || bursting) {
        if (now >= (node.nextCaptureDue || 0)) direct.push(g);
      } else if (now >= (node.nextProbeDue || 0)) {
        probe.push(g);
      }
    });

    direct.slice(0, budget).forEach(function (g) {
      var node = ensureGame(g.gamePk);
      var hot = isHot(g.gamePk);
      node.nextCaptureDue = now + (hot ? CAPTURE_HOT_MS : CAPTURE_BURST_MS);
      captureNow(g, seq, date, hot ? 'review-capture' : 'burst-capture');
    });

    var probeBudget = Math.max(0, budget - direct.length);
    probe.slice(0, probeBudget).forEach(function (g) {
      var node = ensureGame(g.gamePk);
      var hot = isHot(g.gamePk);
      node.nextProbeDue = now + (hot ? PROBE_MS_HOT : PROBE_MS);
      node.lastProbeAt = now;
      state.probesInFlight += 1;
      var started = Date.now();
      MLB.feedProbe(g.gamePk)
        .then(function (probePayload) {
          state.probesInFlight = Math.max(0, state.probesInFlight - 1);
          if (seq !== state.dateSeq || date !== state.date) return;
          node.probeFails = 0;
          state.net.lastProbeRttMs = Date.now() - started;
          state.net.probes += 1;
          var meta = (probePayload && probePayload.metaData) || {};
          var ts = meta.timeStamp || null;
          if (ts) state.net.lastApiTimeStamp = ts;
          var moved = !!ts && ts !== node.lastTimeStamp;
          var floor = hot ? CAPTURE_FLOOR_HOT_MS : CAPTURE_FLOOR_MS;
          var stale = now - (node.lastCaptureAt || 0) > floor;
          if (moved || stale || !node.snap) {
            captureNow(g, seq, date, moved ? 'probe-timestamp' : 'capture-floor');
          } else {
            state.net.skipped += 1;
          }
        })
        .catch(function (err) {
          state.probesInFlight = Math.max(0, state.probesInFlight - 1);
          node.probeFails = (node.probeFails || 0) + 1;
          if (err && err.quiet) return;
          /* Two failed probes and the clock is no longer trustworthy: capture
           * directly so the feed keeps its data even if metaData changes. */
          if (node.probeFails >= 2) captureNow(g, seq, date, 'probe-failed');
        });
    });
  }

  /* ------------------------------------------------------------- sound/notify */

  var SOUND_COOLDOWN_MS = 1200;

  /* Every alert in the feed goes through here — nothing reaches the speaker
   * except from a row the operator can also see.  The audio engine has its own
   * 1.2 s coalescing; this one keeps `state.lastChimeAt` meaningful for the
   * "did it fire?" checks and for the latency chip. */
  function chime(kind) {
    if (!state.soundOn) return false;
    var now = Date.now();
    if (now - state.lastChimeAt < SOUND_COOLDOWN_MS) return false;
    state.lastChimeAt = now;
    if (global.AlertSound) global.AlertSound.play(kind || 'alert');
    return true;
  }

  function notifyRunAtRisk(review, teams) {
    if (!state.notifyOn) return;
    if (typeof global.Notification !== 'function') return;
    if (global.Notification.permission !== 'granted') return;
    try {
      var title = '⚠️ Run at risk — ' + UI.abbr(teams.away) + ' @ ' + UI.abbr(teams.home);
      var body = review.typeLabel + (review.reason ? ' (' + review.reason + ')' : '') +
        ' · ' + review.inningLabel + ' — ' + review.runsAtRiskCount + ' run(s) credited to the reviewed play.';
      new global.Notification(title, { body: body, tag: review.id });
    } catch (e) { /* ignore */ }
  }

  function loadPref(key, fallback) {
    try {
      var raw = global.localStorage.getItem('mlbp.pref.' + key);
      return raw === null ? fallback : raw === '1';
    } catch (e) { return fallback; }
  }

  function savePref(key, value) {
    try { global.localStorage.setItem('mlbp.pref.' + key, value ? '1' : '0'); } catch (e) { /* ignore */ }
  }

  /* ------------------------------------------------------------------ render */

  function entryMatches(entry, filter) {
    if (!entry) return false;
    if (filter === 'all') {
      return (entry.kind === 'review' || entry.kind === 'pending' ||
        entry.kind === 'scoring_change' || entry.kind === 'state') &&
        !(entry.review && entry.review.isABS);
    }
    if (filter === 'state') return entry.kind === 'state';
    if (filter === 'abs') return entry.review && entry.review.isABS;
    if (filter === 'challenges') return entry.review && entry.review.family === 'manager';
    if (filter === 'reviews') return entry.review && (entry.review.family === 'umpire' || entry.review.family === 'replay');
    if (filter === 'boundary') return entry.review && entry.review.isBoundary;
    if (filter === 'under') return entry.review && entry.review.inProgress;
    if (filter === 'risk') return entry.review && entry.review.runsAtRiskCount > 0;
    if (filter === 'scoring') return entry.kind === 'scoring_change';
    return true;
  }

  function visibleEntries() {
    return state.entries.filter(function (e) { return entryMatches(e, state.filter); })
      .sort(function (a, b) { return (b.lastSeen || 0) - (a.lastSeen || 0); });
  }

  function statsFor() {
    var s = { total: 0, manager: 0, umpire: 0, abs: 0, boundary: 0, under: 0, risk: 0, scoring: 0, state: 0, live: 0 };
    state.entries.forEach(function (e) {
      if (e.kind === 'scoring_change') { s.scoring += 1; return; }
      if (e.kind === 'state') { s.state += 1; return; }
      if (e.kind !== 'review') return;
      var r = e.review;
      if (!r) return;
      if (r.isABS) s.abs += 1; else s.total += 1;
      if (r.family === 'manager') s.manager += 1;
      if (r.family === 'umpire' || r.family === 'replay') s.umpire += 1;
      if (r.isBoundary) s.boundary += 1;
      if (r.inProgress) s.under += 1;
      if (r.runsAtRiskCount > 0) s.risk += 1;
    });
    s.live = Object.keys(state.capture).filter(function (pk) {
      var g = state.capture[pk];
      return g && g.snap && g.snap.status && g.snap.status.abstractGameState === 'Live';
    }).length;
    return s;
  }

  function renderTabs() {
    var nav = $('feed-tabs');
    if (!nav) return;
    nav.innerHTML = FILTERS.map(function (f) {
      var count = state.entries.filter(function (e) { return entryMatches(e, f.id); }).length;
      return '<button class="tab-btn' + (state.filter === f.id ? ' tab-on' : '') + '" data-filter="' + f.id + '">' +
        UI.esc(f.label) + (count ? ' <span class="tab-badge">' + count + '</span>' : '') + '</button>';
    }).join('');
  }

  function renderStats() {
    var el = $('feed-stats');
    if (!el) return;
    var s = statsFor();
    var tiles = [
      { n: s.live, label: 'Live games', cls: '' },
      { n: s.total, label: 'Reviews', cls: '' },
      { n: s.manager, label: 'Challenges', cls: '' },
      { n: s.umpire, label: 'Umpire reviews', cls: '' },
      { n: s.abs, label: 'ABS challenges', cls: '' },
      { n: s.boundary, label: 'Boundary calls', cls: '' },
      { n: s.under, label: 'Under review', cls: '' },
      { n: s.risk, label: 'Runs at risk', cls: 'is-risk' },
      { n: s.scoring, label: 'Scoring changes', cls: '' },
      { n: s.state, label: 'State changes', cls: '' },
    ];
    el.innerHTML = tiles.map(function (t) {
      return '<div class="stat-tile ' + t.cls + '"><div class="stat-num">' + t.n + '</div>' +
        '<div class="stat-label">' + UI.esc(t.label) + '</div></div>';
    }).join('');
  }

  function renderBanner() {
    var el = $('banner');
    if (!el) return;
    var atRisk = state.entries.filter(function (e) {
      return e.review && e.review.inProgress && e.review.runsAtRiskCount > 0;
    });
    if (!atRisk.length) { el.innerHTML = ''; return; }
    el.innerHTML = atRisk.map(function (e) {
      var r = e.review;
      return '<div class="banner-item">' +
        '⚠️ <strong>' + UI.esc(r.runsAtRiskCount + ' run' + (r.runsAtRiskCount === 1 ? '' : 's') + ' at risk') + '</strong>' +
        ' — <a class="banner-link" href="game.html?gamePk=' + encodeURIComponent(e.gamePk) + '&date=' + encodeURIComponent(state.date) + '">' +
        UI.esc(e.matchupLabel || '') + '</a> · ' + UI.esc(r.typeLabel + (r.reason ? ': ' + r.reason : '')) +
        (r.inningLabel ? ' (' + UI.esc(r.inningLabel) + ')' : '') +
      '</div>';
    }).join('');
  }

  function renderActiveStrip() {
    var el = $('active-strip');
    if (!el) return;
    var active = state.entries.filter(function (e) { return e.review && e.review.inProgress; });
    if (!active.length) { el.innerHTML = ''; return; }
    el.innerHTML = '<div class="active-strip"><h3>Under review</h3><div class="active-items">' +
      active.map(function (e) {
        var r = e.review;
        var cached = state.counterCache && state.counterCache[e.gamePk];
        var bothSummary = cached ? Reviews.countersSummary(cached) : '';
        return '<div class="active-item">' +
          '<a href="game.html?gamePk=' + encodeURIComponent(e.gamePk) + '&date=' + encodeURIComponent(state.date) + '"><b>' + UI.esc(e.matchupLabel || '') + '</b></a>' +
          UI.chip(r.typeLabel + (r.reason ? ': ' + r.reason : ''), r.isABS ? 'chip-abs' : 'chip-review') +
          '<span>' + UI.esc(r.inningLabel || '') + '</span>' +
          (r.runsAtRiskCount ? UI.chip('⚠️ ' + r.runsAtRiskCount + ' run(s) at risk', 'chip-danger') : '') +
          (bothSummary ? '<span class="counter-note">' + UI.esc(bothSummary) + '</span>' : '') +
          '</div>';
      }).join('') + '</div></div>';
  }

  function scoreLine(label, score) {
    if (!score) return '';
    return '<dt>' + UI.esc(label) + '</dt><dd>' + UI.esc(score.away) + '–' + UI.esc(score.home) + '</dd>';
  }

  function clockText(apiTimeStamp, capturedAt) {
    var bits = [];
    if (apiTimeStamp) bits.push('API clock ' + GameState.timeStampToIso(apiTimeStamp).replace('T', ' ').replace('Z', 'Z'));
    if (capturedAt) bits.push('observed ' + new Date(capturedAt).toISOString().replace('T', ' '));
    return bits.join(' · ');
  }

  function stateRowHtml(entry) {
    var change = entry.stateChange || {};
    var chips = [];
    chips.push(UI.chip('⚾ Game state · ' + (change.kind || 'change'), 'chip-state'));
    if (entry.latencyMs !== null && entry.latencyMs !== undefined) {
      chips.push(UI.chip('latency ' + entry.latencyMs + ' ms', 'chip-ghost', 'Browser clock minus the official metaData.timeStamp of this capture'));
    }
    var official = change.official ? '<div class="feed-sub">Official: ' + UI.esc(change.official) + '</div>' : '';
    var summary = entry.snapshotSummary ? '<div class="feed-sub">' + UI.esc(entry.snapshotSummary) + '</div>' : '';
    return '<div class="feed-row feed-row-state">' +
      '<div class="feed-avatar">⚾</div>' +
      '<div class="feed-body">' +
        '<div class="feed-top">' +
          '<a href="game.html?gamePk=' + encodeURIComponent(entry.gamePk) + '&date=' + encodeURIComponent(state.date) + '"><b>' + UI.esc(entry.matchupLabel || '') + '</b></a>' +
          '<span class="stamp">' + UI.esc(clockText(entry.apiTimeStamp, entry.capturedAt)) + '</span>' +
        '</div>' +
        '<div class="feed-title">' + UI.esc(change.text || '') + '</div>' +
        official + summary +
        '<div class="feed-chips">' + chips.join('') + '</div>' +
      '</div>' +
    '</div>';
  }

  function renderRow(entry) {
    if (entry.kind === 'state') return stateRowHtml(entry);

    var r = entry.review || {};
    var tracker = entry.scoreTracker || {};
    var cls = 'feed-row';
    if (r.inProgress) cls += ' is-live';
    if (r.runsAtRiskCount) cls += ' is-at-risk';

    var avatar = r.isABS ? '🎯' : r.isBoundary ? '📏' : entry.kind === 'scoring_change' ? '✏️' : entry.kind === 'pending' ? '📝' : '🚨';

    var chips = [];
    chips.push(UI.chip(r.typeLabel || 'Review', r.isABS ? 'chip-abs' : 'chip-review'));
    if (r.reason) chips.push(UI.chip(r.reason, 'chip-review'));
    if (r.isBoundary) chips.push(UI.chip('Boundary call', 'chip-warn'));
    if (r.inProgress) chips.push(UI.chip('Under review', 'chip-warn'));
    else if (r.outcome) chips.push(UI.chip(r.outcome, r.outcome === 'Overturned' ? 'chip-ok' : ''));
    if (r.runsAtRiskCount) chips.push(UI.chip('⚠️ ' + r.runsAtRiskCount + ' run(s) at risk', 'chip-danger'));
    if (entry.apiTimeStamp) chips.push(UI.chip('API clock ' + entry.apiTimeStamp, 'chip-ghost'));

    var trackerHtml = '';
    if (entry.kind === 'review' && (tracker.before || tracker.possible || tracker.actual)) {
      trackerHtml = '<dl class="score-track">' +
        (tracker.before ? scoreLine('Before review', tracker.before) : '<dt>Before review</dt><dd>— (not observed before ruling)</dd>') +
        (tracker.possible ? scoreLine('Possible after (conditional)', tracker.possible)
          : (r.isBoundary && !(r.runsAtRiskCount > 0)
            /* README: "A boundary review with no currently credited run says
             * 'score impact pending' and does not invent an alternate score." */
            ? '<dt>Possible after (conditional)</dt><dd>score impact pending</dd>'
            : (r.runsAtRiskCount > 0
              ? '<dt>Possible after (conditional)</dt><dd>— (not observed before ruling)</dd>'
              : ''))) +
        scoreLine('Actual after (official)', tracker.actual) +
        '</dl>';
    }

    var absLine = '';
    if (r.isABS && r.absCountBefore) {
      absLine = '<div class="feed-sub">Pitch ' + UI.esc(r.absPitchNumber) +
        ' · count before ' + r.absCountBefore.balls + '-' + r.absCountBefore.strikes +
        (r.absCountAfter ? ' · after ' + r.absCountAfter.balls + '-' + r.absCountAfter.strikes : '') + '</div>';
    }

    var counterText = '';
    var counterSummaryTitle = '';
    var cached = state.counterCache && state.counterCache[entry.gamePk];
    /* README counter examples prefix the challenging team's abbreviation. */
    var challengerLabel = (r.challengerSide && entry.teams && entry.teams[r.challengerSide])
      ? UI.abbr(entry.teams[r.challengerSide]) : '';
    if (cached) {
      counterSummaryTitle = Reviews.countersSummary(cached);
      if (r.family === 'manager' && r.challengerSide && cached.manager && cached.manager[r.challengerSide]) {
        counterText = Reviews.counterLine({ manager: cached.manager, side: r.challengerSide, label: challengerLabel });
      }
      if (r.isABS && r.challengerSide && cached.abs && cached.abs[r.challengerSide]) {
        counterText = Reviews.counterLine({ abs: cached.abs, side: r.challengerSide, label: challengerLabel });
      }
      if (!counterText && counterSummaryTitle) counterText = counterSummaryTitle;
    }

    var changeHtml = '';
    if (entry.kind === 'scoring_change' && entry.change) {
      changeHtml = '<div class="feed-sub">Initial call: ' + UI.esc(entry.change.from && entry.change.from.description ? entry.change.from.description : '') +
        '</div><div class="feed-sub">Final ruling: ' + UI.esc(entry.change.to && entry.change.to.description ? entry.change.to.description : '') + '</div>' +
        (entry.change.scoreAfter ? '<div class="feed-sub">Official score after the play: ' +
          UI.esc(entry.change.scoreAfter.away) + '–' + UI.esc(entry.change.scoreAfter.home) + '</div>' : '') +
        '<div class="feed-irregular">Attribution: ' + UI.esc(entry.change.attribution || '') + '</div>';
    }

    var pendingHtml = '';
    if (entry.kind === 'pending' && entry.pending) {
      pendingHtml = '<div class="feed-sub">' + UI.esc(entry.pending.description || '') + '</div>' +
        '<div class="feed-irregular">Source: ' + UI.esc(entry.pending.source || '') + '</div>';
    }

    /* Official status before / after the review, exactly as the API worded it. */
    var statusHtml = '';
    if (entry.kind === 'review' && (entry.openStatus || entry.resolvedStatus)) {
      var rows = [];
      if (entry.openStatus) {
        rows.push('<dt>Official status while under review</dt><dd>' +
          UI.esc((entry.openStatus.detailedState || '—') + (entry.openStatus.reason ? ' — ' + entry.openStatus.reason : '') +
            (entry.openStatus.statusCode ? ' (' + entry.openStatus.statusCode + ')' : '')) + '</dd>');
      }
      if (entry.resolvedStatus) {
        rows.push('<dt>Official status after the ruling</dt><dd>' +
          UI.esc((entry.resolvedStatus.detailedState || '—') +
            (entry.resolvedStatus.statusCode ? ' (' + entry.resolvedStatus.statusCode + ')' : '')) + '</dd>');
      }
      if (rows.length) statusHtml = '<dl class="status-track">' + rows.join('') + '</dl>';
    }

    /* Irregularity notes that name this entry's id belong on this row only —
     * never repeat a game's first note on every row. */
    var irregularity = '';
    (state.irregularities[entry.gamePk] || []).some(function (n) {
      if (entry.id && n.indexOf(entry.id) !== -1) { irregularity = n; return true; }
      return false;
    });

    return '<div class="' + cls + '">' +
      '<div class="feed-avatar">' + avatar + '</div>' +
      '<div class="feed-body">' +
        '<div class="feed-top">' +
          '<a href="game.html?gamePk=' + encodeURIComponent(entry.gamePk) + '&date=' + encodeURIComponent(state.date) + '"><b>' + UI.esc(entry.matchupLabel || '') + '</b></a>' +
          '<span>' + UI.esc(r.inningLabel || '') + '</span>' +
          (r.challengerSide && r.challengerSide !== 'unknown' && r.challenger
            ? '<span>Challenged by ' + UI.esc(r.challenger) + (r.challengerRole ? ' (' + UI.esc(r.challengerRole) + ')' : '') + '</span>' : '') +
          '<span>' + new Date(entry.lastSeen || Date.now()).toLocaleTimeString() + '</span>' +
          '<a href="https://statsapi.mlb.com/api/v1/game/' + encodeURIComponent(entry.gamePk) + '/playByPlay" target="_blank" rel="noopener" title="Official MLB StatsAPI play-by-play source">MLB API ↗</a>' +
        '</div>' +
        '<div class="feed-title">' + UI.esc((r.batter && r.batter.name) || '') +
          (r.pitcher && r.pitcher.name ? ' vs ' + UI.esc(r.pitcher.name) : '') + '</div>' +
        (r.description ? '<div class="feed-sub">' + UI.esc(r.description) + '</div>' : '') +
        absLine + changeHtml + pendingHtml + statusHtml +
        (trackerHtml ? trackerHtml : '') +
        (counterText ? '<div class="counter-note"' + (counterSummaryTitle ? ' title="' + UI.esc(counterSummaryTitle) + '"' : '') + '>' + UI.esc(counterText) + '</div>' : '') +
        (irregularity ? '<div class="feed-irregular">⚠️ ' + UI.esc(irregularity) + '</div>' : '') +
        '<div class="feed-chips">' + chips.join('') + '</div>' +
      '</div>' +
    '</div>';
  }

  /* Same idea as the scoreboard: only touch the DOM when the tracked data
   * actually changed, so a fast loop does not re-create identical rows. */
  function offerRecentDate() {
    if (state.lastGameDate !== undefined || state.lookingForRecent) return;
    state.lookingForRecent = true;
    var reqSeq = state.dateSeq;
    var reqDate = state.date;
    var from = MLB.shiftISODate(reqDate, -180);
    MLB.scheduleRange(from, reqDate)
      .then(function (payload) {
        if (reqSeq !== state.dateSeq || reqDate !== state.date) return;
        var dates = ((payload && payload.dates) || []).filter(function (d) {
          return d && d.totalGames > 0;
        });
        state.lastGameDate = dates.length ? dates[dates.length - 1].date : null;
      })
      .catch(function () {
        if (reqSeq === state.dateSeq && reqDate === state.date) state.lastGameDate = null;
      })
      .then(function () {
        if (reqSeq !== state.dateSeq || reqDate !== state.date) return;
        state.lookingForRecent = false;
        if (state.lastGameDate) render();
      });
  }

  function entriesSignature() {
    var capSig = Object.keys(state.capture).map(function (pk) {
      var g = state.capture[pk];
      if (!g || !g.snap) return pk + ':0';
      return pk + ':' + (g.snap.signature || '') + ':' + (g.timeline.length) + ':' + (g.snap.apiTimeStamp || '');
    }).join(';');
    return state.filter + '|' + state.games.length + '|' + (state.lastGameDate || '') + '|' + capSig + '|' +
      state.entries.map(function (e) {
        return [e.id, e.lastSeen, e.review && e.review.outcome, e.review && e.review.inProgress,
          e.stateChange && e.stateChange.text,
          e.scoreTracker && e.scoreTracker.actual ? e.scoreTracker.actual.away + '-' + e.scoreTracker.actual.home : '',
          e.scoreTracker && e.scoreTracker.before ? e.scoreTracker.before.away + '-' + e.scoreTracker.before.home : ''].join(':');
      }).join('|');
  }

  function renderIfChanged() {
    var sig = entriesSignature();
    if (sig === state.lastRenderSignature) return;
    state.lastRenderSignature = sig;
    render();
  }

  /* One flagged row for a game-level irregularity (a note that names no
   * entry). Rendered once per note above the entry rows: flagged for review,
   * never corrected or hidden (uploaded reviews.html footer). */
  function flaggedRowHtml(entry, note) {
    return '<div class="feed-row flagged-row">' +
      '<div class="feed-avatar">🚩</div>' +
      '<div class="feed-body">' +
        '<div class="feed-top">' +
          '<a href="game.html?gamePk=' + encodeURIComponent(entry.gamePk) + '&date=' + encodeURIComponent(state.date) + '"><b>' + UI.esc(entry.matchupLabel || '') + '</b></a>' +
          '<span>Flagged for review</span>' +
          '<a href="https://statsapi.mlb.com/api/v1/game/' + encodeURIComponent(entry.gamePk) + '/playByPlay" target="_blank" rel="noopener" title="Official MLB StatsAPI play-by-play source">MLB API ↗</a>' +
        '</div>' +
        '<div class="feed-irregular">⚠️ ' + UI.esc(note) + '</div>' +
        '<div class="feed-chips">' + UI.chip('Irregularity', 'chip-warn') + UI.chip('Source data', 'chip-review') + '</div>' +
      '</div>' +
    '</div>';
  }

  /* --------------------------------------------------- live state section */

  function latencyChipHtml() {
    var n = state.net;
    var bits = [];
    if (n.lastLatencyMs !== null) bits.push('API clock lag ' + n.lastLatencyMs + ' ms');
    if (n.lastProbeRttMs !== null) bits.push('probe ' + n.lastProbeRttMs + ' ms');
    if (n.lastCaptureRttMs !== null) bits.push('capture ' + n.lastCaptureRttMs + ' ms');
    if (n.captures) bits.push(n.captures + ' capture' + (n.captures === 1 ? '' : 's'));
    if (n.probes) bits.push(n.probes + ' probe' + (n.probes === 1 ? '' : 's'));
    if (!bits.length) return '';
    return '<span class="latency-chip" title="API clock lag = browser clock at capture minus the payload\'s own metaData.timeStamp. Probe = the 250 ms change probe round trip. Capture = the full-state request round trip. These are measured, not estimated.">' +
      UI.esc(bits.join(' · ')) + '</span>';
  }

  function gameStateCard(pk) {
    var g = state.capture[pk];
    if (!g || !g.snap) return '';
    var s = g.snap;
    var status = UI.statusMeta({
      abstractGameState: s.status.abstractGameState,
      detailedState: s.status.detailedState,
      statusCode: s.status.statusCode,
      codedGameState: s.status.codedGameState,
    });
    var review = s.review;
    var score = s.score;
    var bases = s.bases || {};
    var count = s.count || {};
    var timeline = (g.timeline || []).slice(-5).reverse();

    return '<div class="state-card">' +
      '<div class="state-card-top">' +
        '<a href="game.html?gamePk=' + encodeURIComponent(pk) + '&date=' + encodeURIComponent(state.date) + '"><b>' + UI.esc(g.matchupLabel || '') + '</b></a>' +
        UI.chip(status.label || '—', status.live ? 'chip-review' : '') +
        (review ? UI.chip('🚨 ' + review.typeLabel + (review.reason ? ': ' + review.reason : ''), 'chip-warn') : '') +
      '</div>' +
      '<div class="state-line">' +
        '<span class="state-score">' + (score ? UI.esc(score.away + '–' + score.home) : '—') + '</span>' +
        '<span>' + UI.esc(GameState.inningText(s.inning) || '—') + '</span>' +
        '<span>' + UI.esc((count.balls === null ? '—' : count.balls + '-' + count.strikes) + ' · ' +
          (count.outs === null ? '—' : count.outs + ' out' + (count.outs === 1 ? '' : 's'))) + '</span>' +
        UI.baseDiamond({
          first: !!bases.first,
          second: !!bases.second,
          third: !!bases.third,
          scoring: false,
        }) +
      '</div>' +
      '<div class="state-line state-people">' +
        '<span>AB: ' + UI.esc((s.batter && s.batter.name) || '—') + '</span>' +
        '<span>P: ' + UI.esc((s.pitcher && s.pitcher.name) || '—') + '</span>' +
        (s.onDeck && s.onDeck.name ? '<span>On deck: ' + UI.esc(s.onDeck.name) + '</span>' : '') +
      '</div>' +
      (s.atBat && s.atBat.description
        ? '<div class="feed-sub">' + UI.esc(s.atBat.description) + '</div>'
        : '') +
      '<div class="state-clock">' +
        (s.apiTimeStamp
          ? 'Official API clock ' + UI.esc(s.apiTimeStamp) + ' (' + UI.esc(s.apiTimeStampIso || '') + ')'
          : 'API clock not published in this capture') +
        (s.latencyMs !== null ? ' · seen ' + s.latencyMs + ' ms later' : '') +
        (g.restoredAt && !g.lastCaptureAt ? ' · restored from the local log' : '') +
      '</div>' +
      (timeline.length
        ? '<ul class="state-timeline">' + timeline.map(function (t) {
            return '<li><span class="stamp">' + UI.esc((t.apiTimeStamp || '') + (t.apiTimeStamp ? ' · ' : '') +
              new Date(t.iso || t.at).toISOString().slice(11, 19) + 'Z') + '</span> ' + UI.esc(t.text) + '</li>';
          }).join('') + '</ul>'
        : '') +
    '</div>';
  }

  function renderStateSection() {
    var el = $('state-section');
    if (!el) return;
    var pks = Object.keys(state.capture).filter(function (pk) {
      var g = state.capture[pk];
      return g && g.snap;
    }).sort(function (a, b) {
      var ga = state.capture[a].snap;
      var gb = state.capture[b].snap;
      var la = ga.status.abstractGameState === 'Live' ? 0 : 1;
      var lb = gb.status.abstractGameState === 'Live' ? 0 : 1;
      if (la !== lb) return la - lb;
      return String(a).localeCompare(String(b));
    });
    if (!state.stateSectionOpen) {
      el.innerHTML = '<button class="btn btn-ghost state-toggle" id="state-toggle">📊 Show captured live game state (' + pks.length + ')</button>';
      return;
    }
    el.innerHTML =
      '<div class="section-head">' +
        '<h2>📊 Official live game state — captured</h2>' +
        '<button class="btn btn-ghost state-toggle" id="state-toggle">Hide</button>' +
      '</div>' +
      '<p class="section-note">Every game on the slate, read straight from the official feed. The stamp on each card is the API\'s own <code>metaData.timeStamp</code> (second precision), not the browser clock; the lag figure is how far behind that clock this page was when it saw the payload. Transitions below each card are the official changes since the last capture, with the wording before and after.</p>' +
      (pks.length
        ? '<div class="state-grid">' + pks.map(gameStateCard).join('') + '</div>'
        : '<div class="feed-empty">No game state captured yet. The first capture lands within one probe interval of the slate loading.</div>');
  }

  /* ---------------------------------------------- scoring log (own section) */

  var SCORING_FILTERS = [
    { id: 'all', label: 'All logged' },
    { id: 'open', label: 'Pending now' },
    { id: 'change', label: 'Reclassifications' },
    { id: 'edit', label: 'Edits (flagged)' },
  ];

  function scoringMatches(entry, filter) {
    if (!entry) return false;
    if (filter === 'open') return entry.status === 'open';
    if (filter === 'change') return entry.kind === 'change';
    if (filter === 'edit') return entry.kind === 'edit';
    return true;
  }

  function scoringRow(entry) {
    var before = entry.before || {};
    var after = entry.after || {};
    var chips = [];
    chips.push(UI.chip(entry.kind === 'change' ? 'Official scoring change'
      : entry.kind === 'edit' ? 'Payload edit — flagged'
        : 'Official Scorer ruling pending',
    entry.kind === 'change' ? 'chip-ok' : entry.kind === 'edit' ? 'chip-warn' : 'chip-pending'));
    chips.push(UI.chip(entry.status === 'open' ? 'Open' : entry.status === 'unresolved' ? 'Still open at last observation' : 'Resolved',
      entry.status === 'open' ? 'chip-warn' : 'chip-ghost'));
    if (entry.inningLabel) chips.push(UI.chip(entry.inningLabel, 'chip-ghost'));

    var beforeText = before.description || before.official || '—';
    var afterText = after.description || after.official || '';

    return '<div class="feed-row scoring-row">' +
      '<div class="feed-avatar">📝</div>' +
      '<div class="feed-body">' +
        '<div class="feed-top">' +
          '<a href="game.html?gamePk=' + encodeURIComponent(entry.gamePk) + '&date=' + encodeURIComponent(state.date) + '"><b>' + UI.esc(entry.matchup || '') + '</b></a>' +
          '<span>At-bat #' + UI.esc(entry.atBatIndex === null ? '—' : entry.atBatIndex + 1) + '</span>' +
          '<span class="stamp">first observed ' + UI.esc(entry.firstSeenIso || '') + '</span>' +
          (Number.isFinite(entry.firstSeenLatencyMs)
            ? '<span title="Browser clock at first observation minus the payload\'s own metaData.timeStamp">lag ' + entry.firstSeenLatencyMs + ' ms</span>'
            : '') +
          '<a href="https://statsapi.mlb.com/api/v1/game/' + encodeURIComponent(entry.gamePk) + '/playByPlay" target="_blank" rel="noopener" title="Official MLB StatsAPI play-by-play source">MLB API ↗</a>' +
        '</div>' +
        '<div class="feed-title">' + UI.esc(entry.batter || '') +
          (entry.pitcher ? ' vs ' + UI.esc(entry.pitcher) : '') + '</div>' +
        '<div class="feed-sub"><b>Before:</b> ' + UI.esc(beforeText) +
          (before.eventType ? ' <span class="muted">(' + UI.esc(before.eventType) + ')</span>' : '') + '</div>' +
        (afterText ? '<div class="feed-sub"><b>After:</b> ' + UI.esc(afterText) +
          (after.eventType ? ' <span class="muted">(' + UI.esc(after.eventType) + ')</span>' : '') + '</div>' : '') +
        (entry.firstSeenApiTimeStamp || after.apiTimeStamp
          ? '<div class="state-clock">API clock ' + UI.esc(entry.firstSeenApiTimeStamp || '—') +
            (after.apiTimeStamp ? ' → ' + UI.esc(after.apiTimeStamp) : '') +
            (Number.isFinite(entry.resolutionLagMs) ? ' · resolved ' + MLB.formatClock(entry.resolutionLagMs) + ' after we first saw it' : '') + '</div>'
          : '') +
        (entry.verified
          ? '<div class="feed-irregular">' +
            (entry.verified.error
              ? 'Re-read at ' + UI.esc(entry.verified.requestedTimecode) + ' failed: ' + UI.esc(entry.verified.error)
              : 'Re-read at ' + UI.esc(entry.verified.requestedTimecode) +
                (entry.verified.answeredTimecode && entry.verified.answeredTimecode !== entry.verified.requestedTimecode
                  ? ' (API answered with ' + UI.esc(entry.verified.answeredTimecode) + ')' : '') +
                ' — ' + UI.esc(entry.verified.note || '') +
                (entry.verified.official
                  ? ' Official wording then: “' + UI.esc(entry.verified.official.description || entry.verified.official.eventType || '') +
                    '”' + (entry.verified.official.eventType ? ' (' + UI.esc(entry.verified.official.eventType) + ')' : '')
                  : '')) +
            '</div>'
          : '') +
        (entry.attribution ? '<div class="feed-irregular">' + UI.esc(entry.attribution) + '</div>' : '') +
        ((entry.notes || []).length ? '<ul class="scoring-notes">' + entry.notes.map(function (n) {
          return '<li>' + UI.esc(n) + '</li>';
        }).join('') + '</ul>' : '') +
        '<div class="feed-chips">' + chips.join('') +
          '<button class="btn btn-ghost btn-tiny" data-trace="' + UI.esc(entry.id) + '">Re-read official state at this timestamp</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function refreshScoringSection() {
    var el = $('scoring-section');
    if (!el) return;
    var payload = state.scoring || ScoringLog.empty(state.date);
    var sum = ScoringLog.summarize(payload);
    var rows = (payload.entries || []).filter(function (e) { return scoringMatches(e, state.scoringFilter); })
      .sort(function (a, b) { return (b.lastSeenAt || 0) - (a.lastSeenAt || 0); });

    el.innerHTML =
      '<div class="section-head">' +
        '<h2>✏️ Official scoring log — pending rulings &amp; scoring changes</h2>' +
        '<div class="section-actions">' +
          '<button class="btn btn-ghost btn-tiny" id="scoring-export">Export JSON</button>' +
          '<button class="btn btn-ghost btn-tiny" id="scoring-clear-open">Clear empty log</button>' +
        '</div>' +
      '</div>' +
      '<p class="section-note">Kept in its own store (<code>' + UI.esc('mlbp.scoringlog.' + state.date) + '</code> in this browser, plus <code>/api/scoring-log</code> when the optional server is running), so a page refresh, a reload or a different tab restores it. This path is deliberately separate from the alert feed: nothing here can delay or break an alert. Every row is the official wording, the official API clock of the observation, and — where the API answered — the final ruling. Nothing is inferred: a ruling the API has not published yet stays <b>Open</b>.</p>' +
      '<div class="scoring-summary">' +
        '<span><b>' + sum.open + '</b> open now</span>' +
        '<span><b>' + sum.pendingResolved + '</b> pending → resolved</span>' +
        '<span><b>' + sum.changes + '</b> reclassifications</span>' +
        '<span><b>' + sum.edits + '</b> flagged edits</span>' +
        '<span><b>' + sum.total + '</b> logged today</span>' +
        (ScoringLog.state.available ? '<span class="ok">shared store connected</span>' : '<span class="muted">local store only</span>') +
      '</div>' +
      '<div class="tabs scoring-tabs">' + SCORING_FILTERS.map(function (f) {
        var n = (payload.entries || []).filter(function (e) { return scoringMatches(e, f.id); }).length;
        return '<button class="tab-btn' + (state.scoringFilter === f.id ? ' tab-on' : '') + '" data-scoring-filter="' + f.id + '">' +
          UI.esc(f.label) + (n ? ' <span class="tab-badge">' + n + '</span>' : '') + '</button>';
      }).join('') + '</div>' +
      '<div class="feed-list scoring-list">' +
        (rows.length ? rows.map(scoringRow).join('')
          : '<div class="feed-empty">Nothing logged for this date and filter yet. A pending official-scorer ruling or a reclassification appears here the second this page observes it.</div>') +
      '</div>';

    wireScoringSection();
  }

  function wireScoringSection() {
    var el = $('scoring-section');
    if (!el) return;
    el.querySelectorAll('[data-scoring-filter]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.scoringFilter = btn.getAttribute('data-scoring-filter');
        refreshScoringSection();
      });
    });
    el.querySelectorAll('[data-trace]').forEach(function (btn) {
      btn.addEventListener('click', function () { traceEntry(btn.getAttribute('data-trace'), btn); });
    });
    var exportBtn = $('scoring-export');
    if (exportBtn) exportBtn.addEventListener('click', exportScoringLog);
    var clearBtn = $('scoring-clear-open');
    if (clearBtn) clearBtn.addEventListener('click', clearEmptyScoringLog);
  }

  /* Re-read the official state at the exact second we logged, from the API
   * itself (`?timecode=`), and show what the official feed said then.  This
   * turns "before" into something the API can confirm rather than a value we
   * claim. */
  function traceEntry(id, btn) {
    var payload = scoringPayload();
    var entry = ScoringLog.findEntry(payload, id);
    if (!entry) return;
    var timecode = entry.firstSeenApiTimeStamp || (entry.before && entry.before.apiTimeStamp);
    if (!timecode) {
      if (btn) btn.textContent = 'No API clock recorded for this row';
      return;
    }
    if (btn) btn.textContent = 'Re-reading…';
    MLB.gameFeedCapture(entry.gamePk, { timecode: timecode })
      .then(function (feed) {
        var plays = Reviews.playsOf(feed);
        var play = null;
        plays.forEach(function (p) {
          if (!p) return;
          if (Number(p.about && p.about.atBatIndex) === Number(entry.atBatIndex)) play = p;
        });
        var official = play && play.result ? {
          eventType: play.result.eventType || '',
          description: play.result.description || '',
          awayScore: play.result.awayScore,
          homeScore: play.result.homeScore,
          capturedApiTimeStamp: (feed.metaData && feed.metaData.timeStamp) || null,
        } : null;
        entry.verified = {
          requestedTimecode: timecode,
          answeredTimecode: (feed.metaData && feed.metaData.timeStamp) || null,
          at: Date.now(),
          official: official,
          note: official
            ? 'The official feed answered with this play at that timestamp.'
            : 'The official feed answered, but this at-bat is not in the payload at that timestamp (it had not happened yet).',
        };
        saveScoring();
        refreshScoringSection();
      })
      .catch(function (err) {
        entry.verified = { requestedTimecode: timecode, at: Date.now(), error: err && err.message ? err.message : 'request failed' };
        saveScoring();
        refreshScoringSection();
      });
  }

  function exportScoringLog() {
    try {
      var payload = JSON.stringify(state.scoring || ScoringLog.empty(state.date), null, 2);
      var blob = new global.Blob([payload], { type: 'application/json' });
      var url = global.URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'scoring-log-' + state.date + '.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { global.URL.revokeObjectURL(url); }, 2000);
    } catch (e) {
      statusLine('Could not export the scoring log: ' + (e && e.message ? e.message : 'browser refused the download'), true);
    }
  }

  function clearEmptyScoringLog() {
    var payload = scoringPayload();
    var before = (payload.entries || []).length;
    payload.entries = (payload.entries || []).filter(function (e) { return e && e.status === 'open'; });
    saveScoring();
    refreshScoringSection();
    statusLine('Removed ' + (before - payload.entries.length) + ' closed row(s) from today\'s scoring log; open rulings were kept.');
  }

  function render() {
    renderBanner();
    renderStateSection();
    renderTabs();
    renderStats();
    renderActiveStrip();
    refreshScoringSection();
    var list = $('feed-list');
    if (!list) return;
    var rows = visibleEntries();
    if (!rows.length) {
      var emptyNote = 'No tracked events for this date and filter yet. New challenges, reviews, boundary calls, ABS challenges, official-scorer pending rulings and official scoring changes appear here live.';
      if (!state.games.length && !state.entries.length) {
        list.innerHTML = '<div class="panel" style="text-align:center;color:var(--muted)">' +
          'No games scheduled for ' + UI.esc(MLB.formatDateLabel(state.date)) + '.' +
          '<div class="feed-empty">' + UI.esc(emptyNote) + '</div>' +
          (state.lastGameDate
            ? '<div style="margin-top:10px">Most recent date with games: ' +
              UI.esc(MLB.formatDateLabel(state.lastGameDate)) + ' ' +
              '<button class="btn" onclick="ReplayFeed.setDate(\'' + state.lastGameDate + '\')">Show it</button></div>'
            : '') +
          '</div>';
        offerRecentDate();
      } else {
        list.innerHTML = '<div class="feed-empty">' + UI.esc(emptyNote) + '</div>';
      }
      return;
    }
    var flagged = [];
    var seenGames = Object.create(null);
    rows.forEach(function (e) {
      if (!e || seenGames[e.gamePk]) return;
      seenGames[e.gamePk] = true;
      (state.irregularities[e.gamePk] || []).forEach(function (n) {
        var namesEntry = state.entries.some(function (x) {
          return x && x.gamePk === e.gamePk && x.id && n.indexOf(x.id) !== -1;
        });
        if (!namesEntry) flagged.push(flaggedRowHtml(e, n));
      });
    });
    list.innerHTML = flagged.join('') + rows.map(renderRow).join('');
  }

  function updateChrome() {
    var label = $('countdown');
    if (label) {
      var left = Math.max(0, state.nextScanAt - Date.now());
      label.textContent = document.hidden ? 'paused' : (left / 1000).toFixed(1) + 's';
    }
    var dot = $('live-dot');
    if (dot) dot.style.opacity = state.scanError ? '0.3' : '1';
    var lat = $('latency-chip-slot');
    if (lat) lat.innerHTML = latencyChipHtml();
    if (state.scanError) {
      statusLine('Scan problem: ' + (state.scanError.message || 'network error') + ' — retrying.', true);
    } else {
      var live = state.games.filter(function (g) { return gameStatusOf(g) === 'Live'; }).length;
      var sum = ScoringLog.summarize(state.scoring);
      statusLine(state.games.length + ' game(s) on ' + MLB.formatDateLabel(state.date) +
        ' · ' + live + ' live · ' + state.entries.length + ' tracked entr' + (state.entries.length === 1 ? 'y' : 'ies') +
        ' · ' + sum.open + ' open scoring ruling' + (sum.open === 1 ? '' : 's') +
        ' · probe ' + state.net.probes + ' / capture ' + state.net.captures + ' requests' +
        (state.net.lastLatencyMs !== null ? ' · API clock lag ' + state.net.lastLatencyMs + ' ms' : '') +
        ' · scanned ' + new Date(state.lastScanAt || Date.now()).toLocaleTimeString() +
        (FeedLog.state.available ? ' · shared log connected' : ' · local log only'));
    }
  }

  /* -------------------------------------------------------------------- nav */

  function setDate(date) {
    var clean = MLB.isValidISODate(date) ? date : MLB.todayISO();
    if (clean === state.date) return;
    state.dateSeq += 1;
    var seq = state.dateSeq;
    clearTimeout(state.timers.scan);
    state.scanning = false;
    state.date = clean;
    state.games = [];
    state.entries = [];
    state.snapshots = Object.create(null);
    /* Play-log cache is keyed by gamePk, not date, so it can stay across a
     * date switch — but any read in flight belongs to the old slate. */
    Object.keys(state.playCache || {}).forEach(function (pk) {
      var c = state.playCache[pk];
      if (c) { c.epoch += 1; c.inFlight = false; }
    });
    state.irregularities = Object.create(null);
    state.finalSeen = Object.create(null);
    state.nextDue = Object.create(null);
    state.statusByPk = Object.create(null);
    state.counterCache = Object.create(null);
    state.absFetchedRevCount = Object.create(null);
    state.lastGameDate = undefined;
    state.lookingForRecent = false;
    state.log = null;
    state.capture = Object.create(null);
    state.scoring = null;
    state.scoringSeeded = false;
    state.scoringSignature = '';
    state.lastRenderSignature = '';
    state.slatesAt = 0;
    syncNav();
    render();
    FeedLog.closeStream();
    if (ScoringLog.closeStream) ScoringLog.closeStream();
    var logPromise = FeedLog.load(clean);
    var scoringPromise = ScoringLog.load(clean);
    Promise.all([logPromise, scoringPromise]).then(function (parts) {
      if (seq !== state.dateSeq || state.date !== clean) return;
      adoptLog(parts[0]);
      state.scoring = parts[1] || ScoringLog.empty(clean);
      render();
      FeedLog.openStream(clean);
      if (ScoringLog.openStream) ScoringLog.openStream(clean);
      scan();
    });
  }

  function setFilter(filter) { state.filter = filter; render(); }

  function setScoringFilter(filter) { state.scoringFilter = filter; refreshScoringSection(); }

  function toggleSound() {
    state.soundOn = !state.soundOn;
    savePref('sound', state.soundOn);
    if (AlertSound) AlertSound.setEnabled(state.soundOn, { silent: true });
    applySoundUi();
    if (state.soundOn) {
      /* Prove it on the way on: the same raindrop the alerts use. */
      state.lastChimeAt = 0;
      chime('preview');
    }
    return state.soundOn;
  }

  function applySoundUi() {
    var btn = $('sound-toggle-btn');
    if (btn) {
      btn.textContent = state.soundOn ? '🔊 Sound On' : '🔇 Sound Off';
      btn.classList.toggle('btn-on', state.soundOn);
    }
    var test = $('sound-test-btn');
    if (test) test.disabled = false;
  }

  /* Play the alert sound on demand, whatever the toggle says, and say so — this
   * is the "is the alert system actually working" button. */
  function testSound() {
    state.lastChimeAt = 0;
    var played = false;
    if (AlertSound) {
      AlertSound.unlock();
      AlertSound.test();
      played = true;
    }
    if (played) {
      var note = $('sound-test-note');
      if (note) {
        note.textContent = 'Alert sound played at ' + new Date().toLocaleTimeString() +
          (state.soundOn ? ' — alerts are ON' : ' — alerts are OFF (test only)');
        note.classList.remove('is-hidden');
      }
    }
    statusLine(played
      ? 'Alert sound fired. If you heard nothing, the browser has not been unlocked (click the page once) or the tab is muted.'
      : 'This browser cannot synthesise the alert sound (no WebAudio).', !played);
    return played;
  }

  function toggleNotify() {
    state.notifyOn = !state.notifyOn;
    savePref('notify', state.notifyOn);
    var btn = $('notify-toggle-btn');
    if (btn) {
      btn.textContent = state.notifyOn ? '🔴 Run Alerts On' : '⚪ Run Alerts Off';
      btn.classList.toggle('btn-on', state.notifyOn);
    }
    if (state.notifyOn && typeof global.Notification === 'function' &&
      global.Notification.permission === 'default') {
      global.Notification.requestPermission();
    }
  }

  function init() {
    state.date = urlDate() || parseDate();
    syncNav();
    state.soundOn = AlertSound ? AlertSound.init() : loadPref('sound', false);
    if (AlertSound) {
      AlertSound.setEnabled(state.soundOn, { silent: true });
      AlertSound.onEvent(function (kind, detail) {
        if (kind === 'play' && detail) state.lastChimeAt = detail.at;
      });
    }
    state.notifyOn = loadPref('notify', false);
    state.stateSectionOpen = loadPref('stateSection', true);

    FeedLog.onChange(function (pushed) {
      if (pushed && pushed.date === state.date) {
        adoptLog(FeedLog.mergePayloads(state.log, pushed, state.date));
        render();
      }
    });
    /* The scoring log is its own store: a pushed log from another tab merges
     * here without touching the alert feed's rows. */
    ScoringLog.onChange(function (pushed) {
      if (!pushed || pushed.date !== state.date) return;
      state.scoring = ScoringLog.mergePayloads(state.scoring, pushed, state.date);
      refreshScoringSection();
    });

    applySoundUi();
    var soundBtn = $('sound-toggle-btn');
    if (soundBtn) soundBtn.addEventListener('click', toggleSound);
    var testBtn = $('sound-test-btn');
    if (testBtn) testBtn.addEventListener('click', testSound);
    var notifyBtn = $('notify-toggle-btn');
    if (notifyBtn) {
      notifyBtn.textContent = state.notifyOn ? '🔴 Run Alerts On' : '⚪ Run Alerts Off';
      notifyBtn.classList.toggle('btn-on', state.notifyOn);
      notifyBtn.addEventListener('click', toggleNotify);
    }
    var refreshBtn = $('refresh-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', function () {
        state.slatesAt = 0;
        scan();
      });
    }

    var tabs = $('feed-tabs');
    if (tabs) {
      tabs.addEventListener('click', function (evt) {
        var btn = evt.target.closest('[data-filter]');
        if (btn) setFilter(btn.getAttribute('data-filter'));
      });
    }

    var stateSection = $('state-section');
    if (stateSection) {
      stateSection.addEventListener('click', function (evt) {
        if (!evt.target.closest('#state-toggle')) return;
        state.stateSectionOpen = !state.stateSectionOpen;
        savePref('stateSection', state.stateSectionOpen);
        renderStateSection();
      });
    }

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) {
        scan();
        sweep();
        captureTick();
      }
    });

    Reviews.loadRegistry();

    var initSeq = state.dateSeq;
    var initDate = state.date;
    Promise.all([FeedLog.load(initDate), ScoringLog.load(initDate)]).then(function (parts) {
      if (initSeq !== state.dateSeq || state.date !== initDate) return;
      adoptLog(parts[0]);
      state.scoring = parts[1] || ScoringLog.empty(initDate);
      render();
      FeedLog.openStream(initDate);
      if (ScoringLog.openStream) ScoringLog.openStream(initDate);
      scan();
    });

    /* Three loops, three costs (see the header): status sweep, change probe,
     * scheduler.  Each is independent so one slow request cannot stall the
     * others. */
    state.timers.sweep = setInterval(sweep, STATUS_SWEEP_MS);
    state.timers.probe = setInterval(captureTick, Math.min(PROBE_MS_HOT, TICK_MS + 50));
    state.timers.countdown = setInterval(updateChrome, 200);
  }

  global.ReplayFeed = {
    init: init,
    prevDay: function () { setDate(MLB.shiftISODate(state.date, -1)); },
    nextDay: function () { setDate(MLB.shiftISODate(state.date, 1)); },
    today: function () { setDate(MLB.todayISO()); },
    pickDate: function () {
      /* The picker is the user's own choice; a ?date= deep link seeds the first
       * view but must not override a later pick. */
      var input = $('date-picker');
      var value = input && input.value;
      setDate(MLB.isValidISODate(value) ? value : state.date);
    },
    setDate: setDate,
    setFilter: setFilter,
    setScoringFilter: setScoringFilter,
    toggleSound: toggleSound,
    toggleNotify: toggleNotify,
    testSound: testSound,
    traceEntry: traceEntry,
    scan: scan,
    probe: captureTick,
    captureTick: captureTick,
    capture: captureNow,
    state: state,
    PROBE_MS: PROBE_MS,
    PROBE_MS_HOT: PROBE_MS_HOT,
    CAPTURE_FLOOR_MS: CAPTURE_FLOOR_MS,
    CAPTURE_BURST_MS: CAPTURE_BURST_MS,
    PLAYLOG_SWEEP_MS: PLAYLOG_SWEEP_MS,
    PLAYLOG_MIN_GAP_MS: PLAYLOG_MIN_GAP_MS,
    CAPTURE_HOT_MS: CAPTURE_HOT_MS,
    BURST_WINDOW_MS: BURST_WINDOW_MS,
    BURST_KINDS: BURST_KINDS,
    SCAN_MS: PROBE_MS,
    STATUS_SWEEP_MS: STATUS_SWEEP_MS,
    SLATE_MS: SLATE_MS,
    FETCH_CONCURRENCY: FETCH_CONCURRENCY,
    MILESTONE_KINDS: MILESTONE_KINDS,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}(window));
