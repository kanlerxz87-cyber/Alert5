/* ============================================================================
 * reviews-feed.js — the all-games Replay Feed (reviews.html)
 *
 * Scans every game on the slate for review events and renders them as a live,
 * chat-style feed:
 *   - manager challenges (M*), umpire/crew-chief reviews (N*), instant replay
 *     (IH), boundary calls (umpire-side home run / fair-foul / stadium-boundary
 *     reviews; charged manager challenges of those plays stay challenges)
 *   - ABS pitch challenges (MJ/NJ) with count before/after
 *   - official-scorer pending rulings (os_ruling_pending_*)
 *   - official scoring changes, detected by diffing each completed play's
 *     classification between polls
 *
 * It also owns the two things that must keep working when everything else is
 * slow, so they are delegated to small, separately tested modules:
 *   - live game state (assets/js/game-state.js): a complete, second-stamped
 *     snapshot of every game on every capture, diffed against the previous one
 *     so each transition is recorded with its before/after wording;
 *   - alert sound (assets/js/alert-sound.js): the ~3 s raindrop chime, with its
 *     own mute preference and a test button;
 *   - the separate Official Scoring section (assets/js/scoring-log.js): pending
 *     rulings and scoring changes, persisted independently of the alert feed.
 *
 * Latency policy (see docs/api-latency-and-terms.md): the scan never runs
 * faster than the StatsAPI budget in assets/js/api.js allows. Games whose
 * official status is a review are promoted to the front of every cycle and
 * polled at REVIEW_REFRESH_MS; other live games are polled on a per-game due
 * time (LIVE_REFRESH_MS, slowing to LIVE_RELAXED_MS when the slate is busy) so
 * no game can be starved, and a game that flips into a review during a cycle is
 * fetched out of band immediately. A hidden tab drops to a slow "dormant"
 * budget instead of stopping dead, so returning to it is instant.
 *
 * Every tracked entry is persisted through feed-log.js (localStorage + the
 * optional server store) and restored on the next visit.
 * ==========================================================================*/
(function (global) {
  'use strict';

  var MLB = global.MLB;
  var UI = global.UI;
  var Reviews = global.Reviews;
  var FeedLog = global.FeedLog;
  var GameState = global.GameState;
  var AlertSound = global.AlertSound;
  var ScoringLog = global.ScoringLog;

  /* Cycle cadence (how soon the next scan may start) and the per-game refresh
   * cadences. A game under review is re-read at REVIEW_REFRESH_MS — the fastest
   * in-game cadence the request budget allows — while the cycle itself can
   * start a new pass sooner than that, because each game has its own due time
   * and nothing is fetched before it is due. */
  var SCAN_MS = 250;
  var REVIEW_REFRESH_MS = 250;
  var LIVE_REFRESH_MS = 750;
  var LIVE_RELAXED_MS = 1200;
  var STATUS_SWEEP_MS = 125;
  var FETCH_CONCURRENCY = 6;
  var FINAL_GRACE_MS = 30 * 60 * 1000;
  var COUNTER_REFRESH_MS = 15000;
  /* A hidden tab keeps a slow heartbeat instead of stopping: the first paint
   * after the operator comes back is then current, not stale. */
  var HIDDEN_SCAN_MS = 3000;
  /* Minimum gap between two alert sounds (an event burst = one sound). */
  var SOUND_COOLDOWN_MS = 2500;
  /* How many live-state transitions per game are repeated in the main feed. */
  var STATE_ROWS_PER_GAME = 12;

  var PLAYBYPLAY_FIELDS = 'allPlays,about,atBatIndex,hasReview,isComplete,inning,halfInning,isTopInning,isScoringPlay,' +
    'result,eventType,description,isOut,rbi,awayScore,homeScore,count,balls,strikes,outs,matchup,batter,id,fullName,pitcher,' +
    'playEvents,details,call,reviewDetails,isOverturned,inProgress,reviewType,challengeTeamId,runners,' +
    'isScoringEvent,playIndex,movement,index,isPitch,pitchNumber,type,startTime,endTime,hasOutcome';

  var COUNTERS_FIELDS = 'gameData,review,absChallenges,hasChallenges,away,home,used,remaining,usedSuccessful,usedFailed';

  var FILTERS = [
    { id: 'all', label: 'All' },
    { id: 'abs', label: 'ABS' },
    { id: 'challenges', label: 'Challenges' },
    { id: 'reviews', label: 'Reviews' },
    { id: 'boundary', label: 'Boundary Calls' },
    { id: 'under', label: 'Under Review' },
    { id: 'risk', label: '⚠️ Runs at Risk' },
    { id: 'scoring', label: '✏️ Official Scoring' },
    { id: 'state', label: '📡 Game State' },
  ];

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
    lastChimeAt: 0,
    notifyOn: false,
    /* per-game next due time (ms) and the cadence last chosen for it */
    dueAt: Object.create(null),
    refreshMs: Object.create(null),
    lastScanAt: 0,
    timers: { scan: null, sweep: null, countdown: null },
    nextScanAt: 0,
    lastRenderSignature: '',
    counterCache: Object.create(null),
    countersFetchedAt: Object.create(null),
    lastGameDate: undefined,
    lookingForRecent: false,
    /* live game state + the separate official-scoring ledger */
    persistence: null,
    gameLog: null,
    liveStates: Object.create(null),
    stateCount: 0,
    lastSnapshotAt: 0,
    lastGameSaveAt: 0,
    lastStateError: null,
    /* scan bookkeeping */
    lastCycle: { fetched: 0, deferred: 0, total: 0, at: 0 },
    /* separate official-scoring section */
    scoringFilter: 'open',
    alertAudioBlocked: false,
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
    state.log.savedAt = Date.now();
    FeedLog.save(state.date, state.log);
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
  }

  /* ------------------------------------------------------------- scan cycle */

  function flattenGames(payload) {
    var out = [];
    ((payload && payload.dates) || []).forEach(function (d) {
      (d.games || []).forEach(function (g) { out.push(g); });
    });
    return out;
  }

  function teamsOf(game) {
    return {
      away: {
        id: game.teams && game.teams.away && game.teams.away.team ? game.teams.away.team.id : null,
        name: game.teams && game.teams.away && game.teams.away.team ? game.teams.away.team.name : '',
      },
      home: {
        id: game.teams && game.teams.home && game.teams.home.team ? game.teams.home.team.id : null,
        name: game.teams && game.teams.home && game.teams.home.team ? game.teams.home.team.name : '',
      },
    };
  }

  /* Post-final re-scan tiers: the official scorer usually publishes a ruling
   * within minutes of the last out, so the first five minutes are watched
   * closely and the remaining 25 minutes of the grace window slowly. */
  function finalGraceDelay(elapsed) {
    if (elapsed < 2 * 60 * 1000) return 2000;
    if (elapsed < 5 * 60 * 1000) return 5000;
    return 15000;
  }

  /* Is the official status a review right now? Answered from the lean status
   * sweep's own payload — MLB flips it the instant a review is *called*, which
   * is earlier than any play text exists. */
  function isReviewStatus(game) {
    var status = game && game.status;
    if (!status) return false;
    return !!Reviews.statusReview(status);
  }

  /**
   * dueGames(now) — which games this cycle should fetch, in priority order.
   *
   * Priority is what makes the feed feel instant without raising the request
   * rate: a game already under review, then a game whose at-bat is in progress,
   * then anything else that is due. Per-game due times (rather than one flat
   * timer) mean a busy slate slows every game down a little instead of starving
   * the ones at the bottom of the list.
   */
  function dueGames(now) {
    var live = [];
    var final = [];
    var liveCount = 0;

    state.games.forEach(function (game) {
      var status = (game.status && game.status.abstractGameState) || '';
      if (status === 'Live') liveCount += 1;
    });

    var liveCadence = liveCount > 8 ? LIVE_RELAXED_MS : LIVE_REFRESH_MS;

    state.games.forEach(function (game) {
      var pk = game.gamePk;
      var status = (game.status && game.status.abstractGameState) || '';
      var review = isReviewStatus(game);

      if (status === 'Live' || review) {
        var cadence = review ? REVIEW_REFRESH_MS : liveCadence;
        state.refreshMs[pk] = cadence;
        var due = state.dueAt[pk] || 0;
        if (now >= due) {
          state.dueAt[pk] = now + cadence;
          live.push(game);
        }
        return;
      }

      if (status === 'Final') {
        if (!state.finalSeen[pk]) state.finalSeen[pk] = now;
        var elapsed = now - state.finalSeen[pk];
        if (elapsed > FINAL_GRACE_MS) return;
        var fDue = state.dueAt[pk] || 0;
        if (now < fDue) return;
        var grace = finalGraceDelay(elapsed);
        state.dueAt[pk] = now + grace;
        state.refreshMs[pk] = grace;
        final.push(game);
      }
    });

    live.sort(function (a, b) {
      var ra = isReviewStatus(a) ? 0 : 1;
      var rb = isReviewStatus(b) ? 0 : 1;
      if (ra !== rb) return ra - rb;
      return (state.dueAt[a.gamePk] || 0) - (state.dueAt[b.gamePk] || 0);
    });

    state.lastCycle.total = live.length + final.length;
    return live.concat(final);
  }

  /** Counters (manager/ABS challenge counters) refresh on their own, slower clock. */
  function wantsCounters(game, status, now) {
    var pk = game.gamePk;
    var last = state.countersFetchedAt[pk];
    if (status === 'Preview') return false;
    if (last === undefined) return true;
    if (status === 'Live' && now - last >= COUNTER_REFRESH_MS) return true;
    if (status === 'Final' && !state.counterCache[pk] && now - last >= COUNTER_REFRESH_MS) return true;
    return false;
  }

  /**
   * fetchGame(game)
   * One request per game per cycle: the projected play-by-play (which carries
   * every review, pending ruling and official classification), conditionally
   * revalidated so an unchanged game costs headers only. The full feed is
   * pulled only when the challenge counters are actually stale.
   */
  function fetchGame(game) {
    var status = (game.status && game.status.abstractGameState) || '';
    var now = Date.now();
    var wantCounters = wantsCounters(game, status, now);
    if (wantCounters) state.countersFetchedAt[game.gamePk] = now;

    var pbpPromise = MLB.playByPlay(game.gamePk, {
      fields: PLAYBYPLAY_FIELDS, retries: 0, cls: 'pbp',
    });
    var countersPromise = wantCounters
      ? MLB.gameFeed(game.gamePk, { fields: COUNTERS_FIELDS, retries: 0, cls: 'feed' })
        .catch(function () { return null; })
      : Promise.resolve(null);

    return Promise.all([pbpPromise, countersPromise])
      .then(function (parts) {
        return { game: game, payload: parts[0], countersPayload: parts[1] };
      })
      .catch(function (err) {
        return { game: game, payload: null, countersPayload: null, error: err };
      });
  }

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
          });
        }
      }
      next();
    });
  }

  /* ------------------------------------------------------------ game state */

  function persistence() {
    if (!state.persistence) {
      state.persistence = GameState.createPersistence(state.date, {
        store: GameState.createStore({ local: true }),
      });
    }
    return state.persistence;
  }

  function ensureGameLog() {
    if (!state.gameLog) state.gameLog = GameState.emptyBucket(state.date);
    return state.gameLog;
  }

  /* Persist the live-state bucket (localStorage + optional server mirror). The
   * render is already done by the time this runs; a storage failure only
   * degrades the history, never the feed. */
  var SAVE_GAME_LOG_MS = 1500;

  function saveGameLog(force) {
    if (!state.gameLog) return;
    var now = Date.now();
    if (!force && now - (state.lastGameSaveAt || 0) < SAVE_GAME_LOG_MS) return;
    state.lastGameSaveAt = now;
    try {
      persistence().save(state.gameLog);
    } catch (e) {
      state.lastStateError = e;
      global.console && global.console.warn && global.console.warn('[game-state] could not save', e);
    }
  }

  function sourceUrlFor(gamePk, endpoint) {
    return 'https://statsapi.mlb.com/api/v1/game/' + gamePk + '/' + endpoint;
  }

  /**
   * captureState(game, feed, plays, capturedAt)
   * Snapshots the official state, diffs it against the previous capture of the
   * same game, records every transition, and returns the diff rows so the feed
   * can surface them.
   */
  /* The play-by-play projection carries no gameData/linescore. Build the
   * smallest official-shaped wrapper from the schedule row so a play-by-play
   * capture still knows the teams, status and score — and never invents one:
   * every field here is copied from the schedule response. */
  function captureFeed(feed, game, plays) {
    var base = feed || {};
    var hasGameData = !!(base.gameData && base.gameData.game);
    var gd = base.gameData || {};
    var ls = (base.liveData && base.liveData.linescore) || game.linescore || null;
    if (!hasGameData) {
      var scheduleTeams = game.teams || {};
      gd = {
        game: { pk: game.gamePk },
        status: game.status || {},
        teams: scheduleTeams,
        datetime: { officialDate: state.date, dateTime: game.gameDate || '' },
        review: game.review || null,
      };
    }
    if (!ls) ls = null;
    return {
      gameData: gd,
      liveData: {
        plays: { allPlays: plays },
        linescore: ls || {},
        boxscore: (base.liveData && base.liveData.boxscore) || null,
      },
    };
  }

  function captureState(game, feed, plays, capturedAt) {
    if (!GameState) return { snap: null, rows: [] };
    var snap;
    try {
      snap = GameState.snapshot(captureFeed(feed, game, plays), plays, {
        at: capturedAt,
        gamePk: game.gamePk,
        officialDate: state.date,
        gameDate: game.gameDate,
        source: (feed && feed.gameData && feed.gameData.game) ? 'feed/live + playByPlay' : 'playByPlay + schedule',
        sourceUrl: sourceUrlFor(game.gamePk, 'playByPlay'),
        hasPlays: true,
      });
    } catch (e) {
      state.lastStateError = e;
      return { snap: null, rows: [] };
    }
    if (!snap || !snap.gamePk) return { snap: null, rows: [] };

    var prev = state.liveStates[game.gamePk] || null;
    var rows = GameState.diff(prev, snap);
    state.liveStates[game.gamePk] = snap;
    state.stateCount += 1;
    state.lastSnapshotAt = capturedAt;

    /* The baseline survives a refresh: a page reopened mid-game diffs against
     * the last capture of the previous visit instead of starting from blank
     * (loadGameLog already seeded state.liveStates from the stored bucket). */
    ensureGameLog();
    GameState.record({
      read: function () { return state.gameLog; },
      write: function () { /* saved in bulk, throttled, at the end of the cycle */ },
    }, state.date, snap, rows, null);

    return { snap: snap, rows: rows };
  }

  /* --------------------------------------------------- official scoring ledger */

  function pendingLedgerRow(gamePk, label, row, at) {
    var wording = row.wording || {
      eventType: row.eventType || '',
      description: row.description || '',
    };
    return GameState.ledgerRow({
      kind: 'pending',
      basis: row.eventType === Reviews.PENDING_RULING_TYPES[0] ? 'primary event ruling pending' : 'prior event ruling pending',
      gamePk: gamePk,
      atBatIndex: row.atBatIndex,
      at: at,
      label: label,
      inningLabel: row.inningLabel,
      batter: row.batter,
      pitcher: row.pitcher,
      before: wording,
      after: null,
      state: 'pending',
      score: row.score,
      source: row.source,
      sourceUrl: sourceUrlFor(gamePk, 'playByPlay'),
    });
  }

  function changeLedgerRow(gamePk, label, change, at) {
    return GameState.ledgerRow({
      kind: 'scoring_change',
      basis: change.basis || 'reclassified',
      gamePk: gamePk,
      atBatIndex: change.atBatIndex,
      at: at,
      label: label,
      inningLabel: change.inningLabel,
      batter: change.batter || '',
      before: change.from,
      after: change.to,
      state: 'observed',
      score: change.scoreAfter,
      source: 'playByPlay result.eventType/description diffed between polls',
      sourceUrl: sourceUrlFor(gamePk, 'playByPlay'),
      history: change.basis ? [{ at: at, basis: change.basis }] : [],
    });
  }

  /* Mark a pending record resolved once MLB publishes the ruling. The wording
   * that replaced the placeholder is stored as `resolved`, so the section keeps
   * both the pending state and what it became. */
  function resolvePendingRows(gamePk, plays, at) {
    var bucket = ensureGameLog();
    var byIndex = Object.create(null);
    (plays || []).forEach(function (play) {
      if (!play || !play.about) return;
      byIndex[Number(play.about.atBatIndex)] = play;
    });
    bucket.ledger.forEach(function (row) {
      if (!row || row.gamePk !== Number(gamePk) || row.kind !== 'pending') return;
      if (row.state === 'resolved') return;
      var play = byIndex[row.atBatIndex];
      if (!play) return;
      var type = (play.result && play.result.eventType) || '';
      if (Reviews.PENDING_RULING_TYPES.indexOf(type) !== -1) return;
      if (!type) return;
      row.state = 'resolved';
      row.resolved = GameState.officialWording(play);
      row.resolvedAt = at;
      row.resolvedAtISO = new Date(at).toISOString();
    });
  }

  function ingestGame(result, expectedSeq, expectedDate) {
    if (expectedSeq !== undefined && expectedSeq !== state.dateSeq) return;
    if (expectedDate !== undefined && expectedDate !== state.date) return;
    if (!result || !result.payload) {
      if (result && result.error && !(result.error && result.error.quiet) && !MLB.isDeferred(result.error)) {
        state.scanError = result.error;
      }
      return;
    }
    var game = result.game;
    var plays = Reviews.playsOf(result.payload);
    var teams = teamsOf(game);
    var capturedAt = Date.now();
    var feed = result.feed || result.payload;
    var meta = { gamePk: game.gamePk, teams: teams, feed: feed };
    var label = UI.abbr(teams.away) + ' @ ' + UI.abbr(teams.home);

    /* ---- 1. live game state (recorded before anything is alerted, so the
     *         ledger holds the exact state the alert was raised from) */
    var captured = captureState(game, feed, plays, capturedAt);
    var ledgerRows = [];

    /* ---- 2. reviews */
    var reviews = Reviews.extractReviews(plays, meta);
    reviews.forEach(function (review) {
      var existing = state.entries.find(function (e) { return e.id === review.id; });
      var before = existing && existing.scoreTracker && existing.scoreTracker.before ? existing.scoreTracker.before : null;

      var scoreTracker = {
        before: before,
        possible: null,
        actual: null,
      };

      if (review.inProgress) {
        /* Call-on-field score while the review is still open = the score the
         * review is deciding on.  Taken from the official linescore/result. */
        scoreTracker.before = review.score || before;
      } else {
        scoreTracker.actual = review.scoreAfter || null;
        if (!scoreTracker.before) {
          /* Never infer or fill in the pre-ruling score when the page opened
           * after resolution (README §"Before / Possible / Actual score tracker"). */
          noteIrregularity(game.gamePk, 'Before-review score was not observed for ' + review.id + ' (page opened after the ruling).');
        }
      }
      if (scoreTracker.before && review.runsAtRiskCount > 0) {
        scoreTracker.possible = {
          away: scoreTracker.before.away,
          home: scoreTracker.before.home,
        };
        scoreTracker.possible[review.battingSide] = Math.max(0, scoreTracker.possible[review.battingSide] - review.runsAtRiskCount);
      }

      var entry = {
        id: review.id,
        kind: 'review',
        gamePk: game.gamePk,
        matchupLabel: label,
        teams: teams,
        review: review,
        scoreTracker: scoreTracker,
        firstSeenLabel: captured.snap ? captured.snap.capturedAtISO : null,
        firstSeenISO: captured.snap ? captured.snap.capturedAtISO : null,
      };

      var isNew = upsertEntry(entry);
      /* Always operate on the stored entry: upsertEntry merges into the
       * existing object, so flags like `warned` live there. */
      entry = state.entries.find(function (e) { return e.id === entry.id; }) || entry;

      /* Uploaded reviews.html button title (aef1a74c L39): "a gentle raindrop
       * chime for new challenges/reviews/boundary calls, official-scorer
       * pending rulings and official scoring changes (not ABS), and the same
       * chime whenever an active review could remove a run already on the
       * scoreboard". */
      if (isNew && !review.isABS) chime('review');
      if (review.runsAtRiskCount > 0 && !entry.warned) {
        /* "whenever an active review could remove a run" — chime the moment
         * the condition first becomes visible (including mid-review), then
         * mark the entry so it never re-chimes. Restored rows are pre-marked
         * in adoptLog (not observed live). */
        entry.warned = true;
        chime('risk');
        notifyRunAtRisk(review, teams);
      }
    });

    /* ---- 3. official-scorer pending rulings (also into the separate ledger) */
    var pending = Reviews.pendingRulings(plays, meta);
    pending.forEach(function (row) {
      var play = null;
      (plays || []).some(function (p) {
        if (p && p.about && Number(p.about.atBatIndex) === Number(row.atBatIndex)) { play = p; return true; }
        return false;
      });
      row.wording = GameState.officialWording(play);

      var isNewPending = upsertEntry({
        id: row.id,
        kind: 'pending',
        gamePk: game.gamePk,
        matchupLabel: label,
        teams: teams,
        pending: row,
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
        firstSeenISO: captured.snap ? captured.snap.capturedAtISO : null,
      });
      var pendingRow = pendingLedgerRow(game.gamePk, label, row, capturedAt);
      /* Re-observing a pending ruling refreshes lastSeen and history but keeps
       * the first observation's wording (addLedgerRow merges by key). */
      if (!isNewPending) pendingRow.firstSeen = pendingRow.at;
      ledgerRows.push(pendingRow);
      if (isNewPending) chime('pending');
    });

    resolvePendingRows(game.gamePk, plays, capturedAt);

    /* ---- 4. official scoring changes */
    var snapshot = Reviews.snapshotPlays(plays);
    var previous = state.snapshots[game.gamePk];
    var diff = Reviews.diffSnapshots(previous, snapshot);
    state.snapshots[game.gamePk] = snapshot;

    diff.changes.forEach(function (change) {
      var isNewChange = upsertEntry({
        id: game.gamePk + ':' + change.atBatIndex + ':scoring-change:' + (change.basis || 'reclassified'),
        kind: 'scoring_change',
        gamePk: game.gamePk,
        matchupLabel: label,
        teams: teams,
        change: change,
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
        firstSeenISO: captured.snap ? captured.snap.capturedAtISO : null,
      });
      ledgerRows.push(changeLedgerRow(game.gamePk, label, change, capturedAt));
      if (isNewChange) chime('scoring');
      if (state.log) {
        state.log.grace = state.log.grace || {};
        state.log.grace[game.gamePk] = Date.now();
      }
    });

    diff.edits.forEach(function (edit) {
      noteIrregularity(game.gamePk, 'Play ' + edit.atBatIndex + ' edited without reclassification (' +
        edit.inningLabel + ') — flagged, not corrected.');
    });
    diff.vanished.forEach(function (gone) {
      noteIrregularity(game.gamePk, 'Play ' + gone.atBatIndex + ' (' + gone.inningLabel +
        ') disappeared from the payload after being observed — flagged, not corrected.');
    });

    /* ---- 5. official MGR / ABS counters (from the slower counters fetch) */
    state.counterCache = state.counterCache || Object.create(null);
    var prevCached = state.counterCache[game.gamePk] || null;
    var gdCounters = (result.countersPayload && result.countersPayload.gameData) || null;
    var rawMgr = (gdCounters && gdCounters.review) || result.payload.review || (game.review || null);
    var rawAbs = (gdCounters && gdCounters.absChallenges) || result.payload.absChallenges || null;
    var reviewCounters = Reviews.managerCounters(rawMgr) || (prevCached && prevCached.manager) || null;
    var absCounters = Reviews.absCounters(rawAbs) || (prevCached && prevCached.abs) || null;

    var regression = Reviews.counterRegression(prevCached, {
      manager: reviewCounters, abs: absCounters,
    });
    if (regression) {
      regression.forEach(function (note) {
        noteIrregularity(game.gamePk, 'Official counter ' + note + ' — flagged, not corrected.');
      });
    }
    state.counterCache[game.gamePk] = {
      manager: reviewCounters,
      abs: absCounters,
      awayAbbr: UI.abbr(teams.away),
      homeAbbr: UI.abbr(teams.home),
    };

    /* ---- 6. write the ledger rows + transitions once, for this game */
    if (ledgerRows.length) {
      var bucket = ensureGameLog();
      ledgerRows.forEach(function (row) { GameState.addLedgerRow(bucket, row); });
    }
    return { captured: captured, label: label };
  }

  /* ------------------------------------------------------------- scan cycle */

  function scan() {
    if (state.scanning) return;
    if (document.hidden) { scheduleScan(HIDDEN_SCAN_MS); return; }
    var scanSeq = state.dateSeq;
    var scanDate = state.date;
    state.scanning = true;
    state.nextScanAt = Date.now() + SCAN_MS;

    MLB.schedule(scanDate, { ttl: 0, retries: 0 })
      .then(function (payload) {
        if (scanSeq !== state.dateSeq || scanDate !== state.date) return null;
        state.games = flattenGames(payload);
        var now = Date.now();
        var due = dueGames(now);
        state.scanError = null;
        state.lastCycle.fetched = 0;
        state.lastCycle.deferred = 0;
        state.lastCycle.at = now;
        if (!due.length) {
          updateChrome();
          renderIfChanged();
          return null;
        }
        return runLimited(due, FETCH_CONCURRENCY, function (game) {
          if (scanSeq !== state.dateSeq || scanDate !== state.date) return Promise.resolve();
          return fetchGame(game).then(function (result) {
            if (result && result.error && MLB.isDeferred(result.error)) {
              state.lastCycle.deferred += 1;
              /* Budget spent for this cycle: try this game again next cycle
               * rather than leaving it waiting on a stale due time. */
              state.dueAt[game.gamePk] = 0;
              return;
            }
            state.lastCycle.fetched += 1;
            ingestGame(result, scanSeq, scanDate);
          });
        }).then(function () {
          if (scanSeq !== state.dateSeq || scanDate !== state.date) return;
          if (state.gameLog) saveGameLog();
          persist(scanSeq, scanDate);
          renderIfChanged();
          updateChrome();
        });
      })
      .catch(function (err) {
        if (scanSeq !== state.dateSeq || scanDate !== state.date) return;
        if (!MLB.isDeferred(err)) state.scanError = err;
        updateChrome();
      })
      .then(function () {
        if (scanSeq !== state.dateSeq || scanDate !== state.date) return;
        state.scanning = false;
        state.lastScanAt = Date.now();
        scheduleScan(SCAN_MS);
      });
  }

  function scheduleScan(delay) {
    clearTimeout(state.timers.scan);
    state.nextScanAt = Date.now() + delay;
    state.timers.scan = setTimeout(scan, delay);
  }

  /* 125 ms official status sweep: catches a review the moment MLB flips it. */
  function sweep() {
    if (document.hidden) return;
    var sweepSeq = state.dateSeq;
    var sweepDate = state.date;
    if (!state.games.some(function (g) { return g.status && g.status.abstractGameState === 'Live'; })) return;
    MLB.slateStatus(sweepDate, { budgetWait: 0 })
      .then(function (payload) {
        if (sweepSeq !== state.dateSeq || sweepDate !== state.date) return;
        var games = flattenGames(payload);
        games.forEach(function (g) {
          var review = Reviews.statusReview(g.status);
          var prev = state.statusByPk[g.gamePk];
          var nextKey = review ? review.code + '|' + review.reason : '';
          /* Keep the sweep's status on the game we already render, so the
           * review banner is painted from the lean probe before the full
           * payload lands. */
          state.games.forEach(function (known) {
            if (known.gamePk !== g.gamePk) return;
            if (known.status && g.status) {
              known.status = Object.assign({}, known.status, g.status);
            } else if (g.status) {
              known.status = g.status;
            }
          });
          if (prev !== nextKey) {
            state.statusByPk[g.gamePk] = nextKey;
            if (review) {
              /* Out-of-band fetch: don't wait for the current scan to finish,
               * and don't make the scan wait for this either. */
              state.dueAt[g.gamePk] = 0;
              var known = state.games.filter(function (x) { return x.gamePk === g.gamePk; })[0] || g;
              fetchGame(known).then(function (result) {
                if (sweepSeq !== state.dateSeq || sweepDate !== state.date) return;
                if (result && result.error && MLB.isDeferred(result.error)) return;
                ingestGame(result, sweepSeq, sweepDate);
                if (state.gameLog) saveGameLog();
                persist(sweepSeq, sweepDate);
                renderIfChanged();
                updateChrome();
              });
            }
          }
        });
      }).catch(function () { /* the scan owns error reporting */ });
  }

  /* ------------------------------------------------------------- sound/notify */

  /* The alert sound lives in assets/js/alert-sound.js so every surface (and the
   * test button) plays exactly the same ~3 s raindrop. This wrapper only
   * decides *when* an alert is warranted; it never invents a sound of its own.
   *
   * chime(reason) is called for every event that appears in the feed:
   *   review   a new manager challenge / crew-chief or umpire review /
   *            instant replay / boundary call
   *   risk     an active review that could remove a run already on the board
   *   pending  an official-scorer ruling pending for an unscored at-bat
   *   scoring  the official scorer reclassified an already-scored play
   *   state    a tracked live-state transition (score, count, pitcher, review)
   * ABS pitch challenges stay silent by policy (they are routine — dozens a
   * game), exactly as the original button title documented; they are still
   * tracked in the ABS tab and the counters.
   */
  function chime(reason) {
    if (!state.soundOn) return;
    var now = Date.now();
    /* One sound per event burst: five events landing in the same poll produce
     * one raindrop, not five overlapping ones. */
    if (now - state.lastChimeAt < SOUND_COOLDOWN_MS) return;
    var played = AlertSound.play(reason, { force: true });
    /* The timestamp is set even when audio could not start (a blocked or
     * missing AudioContext): "an alert was raised" and "the speaker worked" are
     * different facts, and the UI reports the second one separately. */
    state.lastChimeAt = now;
    if (!played) state.alertAudioBlocked = true;
  }

  /* Turning the alert on/off is the test: on -> the real sound plays once. */
  function toggleSound() {
    var on = AlertSound.setEnabled(!state.soundOn);
    state.soundOn = on;
    syncSoundButton();
    return on;
  }

  function syncSoundButton() {
    var btn = $('sound-toggle-btn');
    if (btn) {
      btn.textContent = state.soundOn ? '🔊 Alert sound on' : '🔇 Alert sound off';
      btn.classList.toggle('btn-on', state.soundOn);
      btn.setAttribute('aria-pressed', state.soundOn ? 'true' : 'false');
    }
    var hint = $('sound-state');
    if (hint) {
      var st = AlertSound.state();
      hint.textContent = state.soundOn
        ? (st.blocked ? 'on — click the page to allow audio' : 'on — ' + (st.lengthMs / 1000).toFixed(0) + 's raindrop')
        : 'off';
      hint.classList.toggle('is-warn', !!st.blocked && state.soundOn);
    }
    var test = $('sound-test-btn');
    if (test) test.disabled = false;
  }

  /* Explicit test button: plays the same sound even while alerts are muted, so
   * the audio path can be verified without waiting for a real challenge. */
  function testSound() {
    var ok = AlertSound.preview();
    if (!ok) {
      var hint = $('sound-state');
      if (hint) {
        hint.textContent = 'audio blocked by the browser — click anywhere, then test again';
        hint.classList.add('is-warn');
      }
    }
    return ok;
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
    if (filter === 'all') return (entry.kind === 'review' || entry.kind === 'pending' || entry.kind === 'scoring_change') && !(entry.review && entry.review.isABS);
    if (filter === 'abs') return entry.review && entry.review.isABS;
    if (filter === 'challenges') return entry.review && entry.review.family === 'manager';
    if (filter === 'reviews') return entry.review && (entry.review.family === 'umpire' || entry.review.family === 'replay');
    if (filter === 'boundary') return entry.review && entry.review.isBoundary;
    if (filter === 'under') return entry.review && entry.review.inProgress;
    if (filter === 'risk') return entry.review && entry.review.runsAtRiskCount > 0;
    if (filter === 'scoring') return entry.kind === 'scoring_change';
    if (filter === 'state') return entry.kind === 'state_event';
    return true;
  }

  /* Live-state transitions from the current captures, folded into the main feed
   * so everything that was captured is in the replay feed — not only challenges
   * and rulings. Bounded to the newest few per game so a long game cannot flood
   * the list; the full history stays in the 📡 Game State tab. */
  /* Which state transitions are worth a row in the main feed. Score, outs and
   * review state are the events an operator acts on; the count and the batter
   * change several times per at-bat and belong in the 📡 Game State tab, where
   * every transition is listed. Nothing is dropped from the record — only from
   * this projection. */
  var FEED_STATE_FIELDS = { score: true, outs: true, review: true, status: true };

  function stateEntries() {
    var seenGames = Object.create(null);
    var out = [];
    var bucket = state.gameLog;
    var transitions = bucket && Array.isArray(bucket.transitions) ? bucket.transitions : [];
    transitions.forEach(function (t) {
      if (!t || !t.gamePk) return;
      if (!FEED_STATE_FIELDS[t.field]) return;
      var count = seenGames[t.gamePk] || 0;
      if (count >= STATE_ROWS_PER_GAME) return;
      seenGames[t.gamePk] = count + 1;
      out.push({
        id: 'state:' + t.gamePk + ':' + t.at + ':' + t.field,
        kind: 'state_event',
        gamePk: t.gamePk,
        matchupLabel: t.label,
        transition: t,
        lastSeen: t.at,
        firstSeen: t.at,
        review: {
          typeLabel: 'Live state',
          reason: t.field,
          inningLabel: '',
          description: t.text,
          outcome: '',
          isABS: false,
          family: 'state',
          runsAtRiskCount: 0,
        },
      });
    });
    return out;
  }

  function visibleEntries() {
    var pool = state.filter === 'state' || state.filter === 'all'
      ? state.entries.concat(stateEntries())
      : state.entries;
    return pool.filter(function (e) { return entryMatches(e, state.filter); })
      .sort(function (a, b) { return (b.lastSeen || 0) - (a.lastSeen || 0); });
  }

  function statsFor() {
    var s = {
      total: 0, manager: 0, umpire: 0, abs: 0, boundary: 0, under: 0, risk: 0,
      scoring: 0, pending: 0, games: state.games.length, state: state.stateCount,
    };
    state.entries.forEach(function (e) {
      if (e.kind === 'scoring_change') { s.scoring += 1; return; }
      if (e.kind === 'pending') { s.pending += 1; return; }
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
    return s;
  }

  function renderTabs() {
    var nav = $('feed-tabs');
    if (!nav) return;
    var pool = state.entries.concat(stateEntries());
    nav.innerHTML = FILTERS.map(function (f) {
      var count = pool.filter(function (e) { return entryMatches(e, f.id); }).length;
      return '<button class="tab-btn' + (state.filter === f.id ? ' tab-on' : '') + '" data-filter="' + f.id + '">' +
        UI.esc(f.label) + (count ? ' <span class="tab-badge">' + count + '</span>' : '') + '</button>';
    }).join('');
  }

  function renderStats() {
    var el = $('feed-stats');
    if (!el) return;
    var s = statsFor();
    var tiles = [
      { n: s.total, label: 'Reviews', cls: '' },
      { n: s.manager, label: 'Challenges', cls: '' },
      { n: s.umpire, label: 'Umpire reviews', cls: '' },
      { n: s.abs, label: 'ABS challenges', cls: '' },
      { n: s.boundary, label: 'Boundary calls', cls: '' },
      { n: s.under, label: 'Under review', cls: '' },
      { n: s.risk, label: 'Runs at risk', cls: 'is-risk' },
      { n: s.pending, label: 'Ruling pending', cls: '' },
      { n: s.scoring, label: 'Scoring changes', cls: '' },
      { n: s.games, label: 'Games tracked', cls: '' },
      { n: s.state, label: 'State captures', cls: '' },
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

  function renderRow(entry) {
    if (entry && entry.kind === 'state_event') return renderStateRow(entry);
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
    /* README counter examples prefix the challenging team's abbreviation
     * ("CIN: 2 ABS challenges left now (…)" / "PIT: 1 manager challenge left
     * now (0 used)"). */
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
      if (!counterText && counterSummaryTitle) {
        counterText = counterSummaryTitle;
      }
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

    /* Irregularity notes that name this entry's id belong on this row only —
     * never repeat a game's first note on every row. Game-level notes (no
     * entry id) render once as flagged rows in renderList. */
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
        absLine + changeHtml + pendingHtml +
        (trackerHtml ? trackerHtml : '') +
        (counterText ? '<div class="counter-note"' + (counterSummaryTitle ? ' title="' + UI.esc(counterSummaryTitle) + '"' : '') + '>' + UI.esc(counterText) + '</div>' : '') +
        (irregularity ? '<div class="feed-irregular">⚠️ ' + UI.esc(irregularity) + '</div>' : '') +
        '<div class="feed-chips">' + chips.join('') + '</div>' +
      '</div>' +
    '</div>';
  }

  /* Same idea as the scoreboard: only touch the DOM when the tracked data
   * actually changed, so a 250 ms scan does not re-create identical rows. */
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

  /* ------------------------------------------------- live state rendering */

  function clockLabel(msOrIso) {
    var d = typeof msOrIso === 'number' ? new Date(msOrIso) : new Date(String(msOrIso));
    if (isNaN(d.getTime())) return '';
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }

  function stateRowChips(t) {
    var chips = [];
    if (t.field === 'score') chips.push(UI.chip('Score', 'chip-review'));
    if (t.field === 'review') chips.push(UI.chip('Review state', 'chip-warn'));
    if (t.field === 'status' || t.field === 'statusCode') chips.push(UI.chip('Official status', 'chip-review'));
    if (t.field === 'pitchCount') chips.push(UI.chip('Pitch count', ''));
    if (t.field === 'batter' || t.field === 'pitcher') chips.push(UI.chip('Matchup', ''));
    if (t.field === 'outs' || t.field === 'count' || t.field === 'bases') chips.push(UI.chip('Game state', ''));
    return chips.join('');
  }

  function renderStateRow(entry) {
    var t = entry.transition || {};
    return '<div class="feed-row state-row">' +
      '<div class="feed-avatar">📡</div>' +
      '<div class="feed-body">' +
        '<div class="feed-top">' +
          '<a href="game.html?gamePk=' + encodeURIComponent(entry.gamePk) + '&date=' + encodeURIComponent(state.date) + '"><b>' + UI.esc(entry.matchupLabel || '') + '</b></a>' +
          '<span>' + UI.esc(t.atISO ? clockLabel(t.at) : '') + '</span>' +
          '<span class="state-ts" title="Capture timestamp (UTC ' + UI.esc(t.atISO || '') + ')">' + UI.esc(t.atISO || '') + '</span>' +
          '<a href="' + UI.esc(t.sourceUrl || ('https://statsapi.mlb.com/api/v1/game/' + entry.gamePk + '/playByPlay')) + '" target="_blank" rel="noopener" title="Official MLB StatsAPI source for this observation">MLB API ↗</a>' +
        '</div>' +
        '<div class="feed-sub">' + UI.esc(t.text || '') + '</div>' +
        '<div class="feed-chips">' + stateRowChips(t) + '</div>' +
      '</div>' +
    '</div>';
  }

  /* One card per game with the newest capture, plus a compact score/outs
   * timeline drawn from the persisted snapshot ring. */
  function renderGameState() {
    var el = $('state-panel');
    if (!el) return;
    var bucket = state.gameLog;
    var games = (bucket && bucket.games) || {};
    var pks = Object.keys(games);
    var head = '<div class="section-head">' +
      '<h2>📡 Live game state <span class="section-sub">score · count · outs · pitcher · batter — timestamped to the second</span></h2>' +
      '<div class="section-note">' + (state.stateCount || 0) + ' capture(s) this session · last ' +
      (state.lastSnapshotAt ? clockLabel(state.lastSnapshotAt) : '—') +
      ' · ' + (state.persistence && state.persistence.serverAvailable() ? 'shared state store connected' : 'this browser’s storage only') +
      '</div></div>';
    if (!pks.length) {
      el.innerHTML = head + '<div class="panel state-empty">No game state captured yet for ' +
        UI.esc(MLB.formatDateLabel(state.date)) +
        '. Every live game is snapshot on each capture; the newest state and its history appear here.</div>';
      return;
    }
    pks.sort(function (a, b) {
      return (Number(games[b].at) || 0) - (Number(games[a].at) || 0);
    });
    el.innerHTML = head + pks.map(function (pk) {
      var snap = games[pk];
      var ring = (bucket.snapshots && bucket.snapshots[pk]) || [];
      var tail = ring.slice(-40);
      var scores = tail.map(function (r) {
        if (!r.score || r.score.away === null || r.score.home === null) return '—';
        return r.score.away + '-' + r.score.home;
      });
      var outs = tail.map(function (r) { return r.outs === null || r.outs === undefined ? '?' : r.outs; });
      var transitions = (bucket.transitions || []).filter(function (t) { return String(t.gamePk) === String(pk); }).slice(0, 6);
      return '<div class="panel state-card">' +
        '<div class="state-card-top">' +
          '<a href="game.html?gamePk=' + encodeURIComponent(pk) + '&date=' + encodeURIComponent(state.date) + '"><b>' + UI.esc(snap.label || '') + '</b></a>' +
          '<span class="state-detail">' + UI.esc(snap.status.detailed || snap.status.abstract || '') + '</span>' +
          (snap.inReview ? UI.chip('Under review', 'chip-warn') : '') +
          '<span class="state-ts">captured ' + UI.esc(clockLabel(snap.at)) + '</span>' +
        '</div>' +
        '<dl class="state-grid">' +
          '<dt>Score</dt><dd>' + UI.esc(snap.teams.away + ' ' + (snap.score.away === null ? '—' : snap.score.away) +
            ' – ' + snap.teams.home + ' ' + (snap.score.home === null ? '—' : snap.score.home)) + '</dd>' +
          '<dt>Inning</dt><dd>' + UI.esc((snap.inning.half || '—') + ' ' + (snap.inning.number === null ? '—' : snap.inning.number)) + '</dd>' +
          '<dt>Count</dt><dd>' + UI.esc((snap.count.balls === null ? '—' : snap.count.balls) + '-' +
            (snap.count.strikes === null ? '—' : snap.count.strikes)) + '</dd>' +
          '<dt>Outs</dt><dd>' + UI.esc(snap.count.outs === null ? '—' : snap.count.outs) + '</dd>' +
          '<dt>Pitch count</dt><dd>' + UI.esc(snap.pitchCount.total === null ? '—' : snap.pitchCount.total) + '</dd>' +
          '<dt>Batter</dt><dd>' + UI.esc(GameState.nameOf(snap.batter) || '—') + '</dd>' +
          '<dt>Pitcher</dt><dd>' + UI.esc(GameState.nameOf(snap.pitcher) || '—') + '</dd>' +
          '<dt>Runners</dt><dd>' + UI.esc(GameState.baseText(snap.bases)) + '</dd>' +
        '</dl>' +
        '<div class="state-history" title="Newest last: score, then outs, from the stored snapshot ring">' +
          '<div class="state-hist-row"><span class="state-hist-label">Score</span>' + UI.esc(scores.join(' · ')) + '</div>' +
          '<div class="state-hist-row"><span class="state-hist-label">Outs</span>' + UI.esc(outs.join(' ')) + '</div>' +
        '</div>' +
        (transitions.length
          ? '<ul class="state-changes">' + transitions.map(function (t) {
            return '<li><span class="state-ts">' + UI.esc(clockLabel(t.at)) + '</span> ' + UI.esc(t.text) + '</li>';
          }).join('') + '</ul>'
          : '') +
      '</div>';
    }).join('');
  }

  /* ------------------------------------- separate Official Scoring section */

  function scoringRowHtml(row) {
    var isPending = row.kind === 'pending';
    var diffs = ScoringLog.fieldDiff(row.before, row.after);
    var resolvedNote = '';
    if (isPending && row.state === 'resolved' && row.resolved) {
      resolvedNote = '<div class="score-resolved"><b>Resolved</b> as official ' +
        UI.esc(row.resolved.eventType || '—') + ' — ' + UI.esc(row.resolved.description || '') + '</div>';
    }
    var wording = '<div class="feed-sub"><b>Before (official):</b> ' +
      UI.esc(ScoringLog.sv(row.before && row.before.eventType)) +
      (row.before && row.before.description ? ' — ' + UI.esc(row.before.description) : '') + '</div>';
    if (row.after) {
      wording += '<div class="feed-sub"><b>After (official):</b> ' +
        UI.esc(ScoringLog.sv(row.after.eventType)) +
        (row.after.description ? ' — ' + UI.esc(row.after.description) : '') + '</div>';
    }
    if (diffs.length) {
      wording += '<div class="score-diff">' + diffs.map(function (d) {
        return '<span class="score-diff-item">' + UI.esc(d.label) + ': ' +
          UI.esc(ScoringLog.sv(d.before)) + ' → ' + UI.esc(ScoringLog.sv(d.after)) + '</span>';
      }).join('') + '</div>';
    }
    return '<div class="feed-row score-row' + (isPending && row.state !== 'resolved' ? ' is-open' : '') + '">' +
      '<div class="feed-avatar">' + (isPending ? '📝' : '✏️') + '</div>' +
      '<div class="feed-body">' +
        '<div class="feed-top">' +
          '<a href="game.html?gamePk=' + encodeURIComponent(row.gamePk) + '&date=' + encodeURIComponent(state.date) + '"><b>' + UI.esc(row.label || '') + '</b></a>' +
          '<span>' + UI.esc(row.inningLabel || '') + '</span>' +
          (row.atBatIndex !== null && row.atBatIndex !== undefined ? '<span>at-bat ' + UI.esc(row.atBatIndex) + '</span>' : '') +
          '<span class="state-ts" title="First observed">' + UI.esc(row.firstSeenISO || '') + '</span>' +
          '<a href="' + UI.esc(row.sourceUrl || '') + '" target="_blank" rel="noopener" title="Official MLB StatsAPI source">MLB API ↗</a>' +
        '</div>' +
        '<div class="feed-title">' + UI.esc(row.batter || '') + (row.pitcher ? ' vs ' + UI.esc(row.pitcher) : '') + '</div>' +
        wording + resolvedNote +
        '<div class="feed-chips">' +
          UI.chip(isPending ? 'Ruling pending' : 'Scoring change', isPending ? 'chip-warn' : 'chip-review') +
          UI.chip(row.basis || '', '') +
          (row.score ? UI.chip('Score ' + ScoringLog.sv(row.score.away) + '–' + ScoringLog.sv(row.score.home), '') : '') +
          (isPending && row.state === 'resolved' ? UI.chip('Resolved', 'chip-ok') : '') +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function renderScoring() {
    var el = $('scoring-panel');
    if (!el) return;
    var bucket = state.gameLog;
    var all = ScoringLog.rows(bucket);
    var sum = ScoringLog.summary(all);
    var show = state.scoringFilter === 'open'
      ? all.filter(function (r) { return r.kind === 'scoring_change' || r.state !== 'resolved'; })
      : all;
    var head = '<div class="section-head">' +
      '<h2>✏️ Official scoring log <span class="section-sub">pending rulings and scoring changes, kept separately from the alerts</span></h2>' +
      '<div class="section-tools">' +
        '<span class="section-note">' + sum.pending + ' pending (' + sum.openPending + ' open) · ' +
          sum.changes + ' change(s) · ' + sum.games + ' game(s) · ' +
          (sum.lastAt ? 'last ' + clockLabel(sum.lastAt) : 'nothing logged yet') + '</span>' +
        '<button class="btn btn-ghost btn-sm" id="scoring-filter-toggle">' +
          (state.scoringFilter === 'open' ? 'Show all' : 'Open only') + '</button>' +
        '<button class="btn btn-ghost btn-sm" id="scoring-export-csv"' + (all.length ? '' : ' disabled') + '>Export CSV</button>' +
        '<button class="btn btn-ghost btn-sm" id="scoring-export-json"' + (all.length ? '' : ' disabled') + '>Export JSON</button>' +
      '</div>' +
      '<div class="section-note">Persisted independently of the alert feed (site refresh safe): ' +
        (state.persistence && state.persistence.serverAvailable() ? 'localStorage + the shared server store' : 'this browser’s localStorage') +
        '. Every row quotes the official wording before and after, with the source endpoint linked.' +
      '</div></div>';
    var body = show.length
      ? show.map(scoringRowHtml).join('')
      : '<div class="panel state-empty">' +
        (all.length
          ? 'No open items — switch to “Show all” to read the full log.'
          : 'No official-scoring pending rulings or scoring changes observed on ' +
            UI.esc(MLB.formatDateLabel(state.date)) + ' yet. An at-bat MLB flags as <code>os_ruling_pending_*</code>, ' +
            'or a play whose official classification changes between polls, is logged here and kept through a refresh.') +
        '</div>';
    el.innerHTML = head + body;
    var filterBtn = $('scoring-filter-toggle');
    if (filterBtn) filterBtn.addEventListener('click', function () {
      state.scoringFilter = state.scoringFilter === 'open' ? 'all' : 'open';
      renderScoring();
    });
    var csvBtn = $('scoring-export-csv');
    if (csvBtn) csvBtn.addEventListener('click', function () { exportScoring('csv'); });
    var jsonBtn = $('scoring-export-json');
    if (jsonBtn) jsonBtn.addEventListener('click', function () { exportScoring('json'); });
  }

  function exportScoring(format) {
    var bucket = state.gameLog;
    var rows = ScoringLog.rows(bucket);
    if (!rows.length) return false;
    var text = format === 'json' ? ScoringLog.json(rows) : ScoringLog.csv(rows);
    var type = format === 'json' ? 'application/json' : 'text/csv';
    try {
      var blob = new global.Blob([text], { type: type + ';charset=utf-8' });
      var url = global.URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = ScoringLog.fileStamp(bucket) + '.' + format;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { global.URL.revokeObjectURL(url); }, 2000);
    } catch (e) {
      global.console && global.console.warn && global.console.warn('[scoring-log] export failed', e);
      return false;
    }
    return true;
  }

  function entriesSignature() {
    var bucket = state.gameLog;
    var ledgerSig = bucket ? (bucket.ledger || []).map(function (r) {
      return [r.gamePk, r.kind, r.atBatIndex, r.state, r.lastSeen].join(':');
    }).join(',') : '';
    var transSig = bucket ? (bucket.transitions || []).length + ':' +
      ((bucket.transitions || [])[0] || {}).at : '';
    return state.filter + '|' + state.scoringFilter + '|' + state.games.length + '|' +
      (state.lastGameDate || '') + '|' + state.stateCount + '|' + ledgerSig + '|' + transSig + '|' +
      state.entries.map(function (e) {
      return [e.id, e.lastSeen, e.review && e.review.outcome, e.review && e.review.inProgress,
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

  function render() {
    renderBanner();
    renderTabs();
    renderStats();
    renderActiveStrip();
    renderGameState();
    renderScoring();
    var list = $('feed-list');
    if (!list) return;
    var rows = visibleEntries();
    if (!rows.length) {
      var emptyNote = 'No tracked events for this date and filter yet. New challenges, reviews, boundary calls, ABS challenges, official-scorer pending rulings, official scoring changes and live game-state transitions appear here live.';
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
      label.textContent = document.hidden
        ? 'background · ' + (left / 1000).toFixed(1) + 's'
        : (left / 1000).toFixed(1) + 's';
    }
    var dot = $('live-dot');
    if (dot) dot.style.opacity = state.scanError ? '0.3' : '1';

    /* Latency read-out: which cadence the scheduler is actually holding, what
     * the request budget still allows, and how many calls were deferred. This
     * is the operator's proof that "as fast as possible" is bounded and honest
     * rather than a claim. */
    var lat = $('latency-readout');
    if (lat) {
      var refreshes = Object.keys(state.refreshMs).map(function (pk) { return state.refreshMs[pk]; });
      var fastest = refreshes.length ? Math.min.apply(null, refreshes) : null;
      var snapMs = MLB.budgetSnapshot();
      var statusBucket = snapMs.classes && snapMs.classes.status;
      lat.textContent = (fastest === null ? 'waiting for a live game' :
        'refreshing every ' + (fastest / 1000).toFixed(2) + 's while a review is open · ' +
        'status sweep ' + STATUS_SWEEP_MS + 'ms') +
        ' · budget ' + (statusBucket ? statusBucket.perMinute + '/min status · ' : '') +
        (snapMs.classes && snapMs.classes.pbp ? snapMs.classes.pbp.perMinute + '/min play-by-play' : '') +
        ' · deferred ' + (state.lastCycle.deferred || 0) +
        (state.lastCycle.fetched ? ' · fetched ' + state.lastCycle.fetched : '');
      lat.title = 'Request classes and ceilings: ' + JSON.stringify(snapMs.classes);
    }

    if (state.scanError) {
      statusLine('Scan problem: ' + (state.scanError.message || 'network error') + ' — retrying.', true);
    } else {
      var live = state.games.filter(function (g) { return g.status && g.status.abstractGameState === 'Live'; }).length;
      var under = Object.keys(state.refreshMs).filter(function (pk) {
        return state.refreshMs[pk] === REVIEW_REFRESH_MS;
      }).length;
      statusLine(state.games.length + ' game(s) on ' + MLB.formatDateLabel(state.date) +
        ' · ' + live + ' live' + (under ? ' · ' + under + ' under review' : '') +
        ' · ' + state.entries.length + ' tracked entr' + (state.entries.length === 1 ? 'y' : 'ies') +
        ' · ' + state.stateCount + ' state capture(s)' +
        ' · scanned ' + new Date(state.lastScanAt || Date.now()).toLocaleTimeString() +
        (FeedLog.state.available ? ' · shared log connected' : ' · local log only') +
        (state.persistence && !state.persistence.serverAvailable() ? ' · state kept in this browser' : ''));
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
    state.irregularities = Object.create(null);
    state.finalSeen = Object.create(null);
    state.dueAt = Object.create(null);
    state.refreshMs = Object.create(null);
    state.statusByPk = Object.create(null);
    state.counterCache = Object.create(null);
    state.countersFetchedAt = Object.create(null);
    state.lastGameDate = undefined;
    state.lookingForRecent = false;
    state.log = null;
    state.gameLog = null;
    state.liveStates = Object.create(null);
    state.persistence = null;
    state.stateCount = 0;
    state.lastSnapshotAt = 0;
    state.lastRenderSignature = '';
    syncNav();
    render();
    FeedLog.closeStream();
    Promise.all([
      FeedLog.load(clean),
      loadGameLog(clean, seq),
    ]).then(function (parts) {
      if (seq !== state.dateSeq || state.date !== clean) return;
      adoptLog(parts[0]);
      render();
      FeedLog.openStream(clean);
      scan();
    });
  }

  function setFilter(filter) { state.filter = filter; render(); }

  /* Restore the live-state / official-scoring bucket for a date before the
   * first scan runs, so a refresh never loses the before/after record. */
  function loadGameLog(date, seq) {
    state.gameLog = GameState.emptyBucket(date);
    return persistence().load().then(function (bucket) {
      if (seq !== undefined && (seq !== state.dateSeq || date !== state.date)) return null;
      state.gameLog = GameState.normalizeBucket(bucket, date);
      /* Seed the diff baseline from the restored bucket: a page reopened
       * mid-game compares against the last capture, not against nothing. */
      Object.keys(state.gameLog.games).forEach(function (pk) {
        state.liveStates[pk] = state.gameLog.games[pk];
      });
      renderScoring();
      return state.gameLog;
    }).catch(function (err) {
      state.lastStateError = err;
      return state.gameLog;
    });
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
    state.soundOn = AlertSound.isEnabled();
    state.notifyOn = loadPref('notify', false);

    FeedLog.onChange(function (pushed) {
      if (pushed && pushed.date === state.date) {
        adoptLog(FeedLog.mergePayloads(state.log, pushed, state.date));
        render();
      }
    });

    /* Browsers suspend audio until a gesture: prime the shared context on the
     * first click/keydown anywhere, so a later alert is never silent. */
    ['pointerdown', 'keydown', 'touchstart'].forEach(function (type) {
      global.addEventListener(type, function once() {
        AlertSound.prime();
        global.removeEventListener(type, once);
      }, { passive: true });
    });

    var soundBtn = $('sound-toggle-btn');
    if (soundBtn) soundBtn.addEventListener('click', toggleSound);
    syncSoundButton();
    var testBtn = $('sound-test-btn');
    if (testBtn) testBtn.addEventListener('click', testSound);
    [['scoring-export-csv', 'csv'], ['scoring-export-json', 'json']].forEach(function (pair) {
      var btn = $(pair[0]);
      if (btn) btn.addEventListener('click', function () { exportScoring(pair[1]); });
    });
    var clearBtn = $('scoring-filter-toggle');
    if (clearBtn) clearBtn.addEventListener('click', function () {
      state.scoringFilter = state.scoringFilter === 'open' ? 'all' : 'open';
      renderScoring();
    });
    var notifyBtn = $('notify-toggle-btn');
    if (notifyBtn) {
      notifyBtn.textContent = state.notifyOn ? '🔴 Run Alerts On' : '⚪ Run Alerts Off';
      notifyBtn.classList.toggle('btn-on', state.notifyOn);
      notifyBtn.addEventListener('click', toggleNotify);
    }
    var refreshBtn = $('refresh-btn');
    if (refreshBtn) refreshBtn.addEventListener('click', function () { scan(); });

    var tabs = $('feed-tabs');
    if (tabs) {
      tabs.addEventListener('click', function (evt) {
        var btn = evt.target.closest('[data-filter]');
        if (btn) setFilter(btn.getAttribute('data-filter'));
      });
    }

    /* A hidden tab keeps polling, slowly (dormant budget), so coming back to it
     * paints fresh data immediately instead of after a cold cycle. */
    /* Flush the in-memory state bucket before the tab goes away, so the last
     * capture is not lost between the write cadence and the unload. */
    ['pagehide', 'beforeunload'].forEach(function (type) {
      global.addEventListener(type, function () {
        if (state.gameLog) saveGameLog(true);
      });
    });

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        MLB.setBudgetProfile('dormant');
        scheduleScan(HIDDEN_SCAN_MS);
      } else {
        MLB.setBudgetProfile('live');
        Object.keys(state.dueAt).forEach(function (pk) { state.dueAt[pk] = 0; });
        scan();
      }
    });

    Reviews.loadRegistry();

    var initSeq = state.dateSeq;
    var initDate = state.date;
    Promise.all([
      FeedLog.load(initDate),
      loadGameLog(initDate, initSeq),
    ]).then(function (parts) {
      if (initSeq !== state.dateSeq || state.date !== initDate) return;
      adoptLog(parts[0]);
      render();
      FeedLog.openStream(initDate);
      scan();
    });

    state.timers.sweep = setInterval(sweep, STATUS_SWEEP_MS);
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
    toggleSound: toggleSound,
    testSound: testSound,
    toggleNotify: toggleNotify,
    scan: scan,
    setScoringFilter: function (value) { state.scoringFilter = value || 'all'; renderScoring(); },
    exportScoring: exportScoring,
    captureNow: function () { scan(); },
    saveState: function () { saveGameLog(true); },
    state: state,
    SCAN_MS: SCAN_MS,
    REVIEW_REFRESH_MS: REVIEW_REFRESH_MS,
    LIVE_REFRESH_MS: LIVE_REFRESH_MS,
    STATUS_SWEEP_MS: STATUS_SWEEP_MS,
    FETCH_CONCURRENCY: FETCH_CONCURRENCY,
    HIDDEN_SCAN_MS: HIDDEN_SCAN_MS,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}(window));
