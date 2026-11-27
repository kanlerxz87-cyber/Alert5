/* ============================================================================
 * game-state.js — official live game state, captured as it happens
 *
 * One module, three jobs:
 *
 *   1. SNAPSHOT  — turn one official payload (feed/live, or the lean
 *      playByPlay) into a compact, complete, second-stamped game state:
 *      score, inning/half, outs, balls/strikes, pitch count, the batter at
 *      bat, the pitcher, base runners, the official status wording, and the
 *      review/official-scoring state of every event.
 *
 *   2. DIFF      — compare two consecutive snapshots and name what changed in
 *      the API's own words ("Score: SEA 3 – MIN 4 → SEA 4 – MIN 4",
 *      "Status: Manager challenge: Tag play → Umpire review: Home run").
 *      Every state transition is therefore recoverable from the log, not just
 *      the final values.
 *
 *   3. LEDGER    — append an immutable, persistently stored record of the two
 *      things the Replay Feed must never lose: an official-scoring ruling
 *      that is still PENDING for an at-bat, and an official scoring CHANGE
 *      (the official scorer reclassifying a play). Each record keeps the exact
 *      official wording before and after (eventType + description), all
 *      timestamps, the official score, and the evidence URL.
 *
 * Nothing here renders, chimes or notifies. It is pure data: the alerting
 * surfaces (reviews-feed.js) read it, so a bug in the ledger can never stop an
 * alert, and a bug in the alert path can never lose a ledger row.
 *
 * Storage: localStorage, key `mlbp.state.v1.<YYYY-MM-DD>`, capped per date.
 * On the optional server (server.mjs) the same bucket is also mirrored through
 * /api/game-state so it survives a different browser. Static hosting (GitHub
 * Pages) uses localStorage only and says so in the UI.
 * ==========================================================================*/
(function (global) {
  'use strict';

  var MLB = global.MLB;

  var KEY_PREFIX = 'mlbp.state.v1.';
  var INDEX_SUFFIX = '#index';
  var KEEP_DATES = 10;
  var MAX_SNAPSHOTS_PER_GAME = 400;
  var MAX_STATE_BYTES = 3200 * 1024;   /* per-date guard before we trim history */
  var STATE_VERSION = 1;

  /* API status -> the short abstract state we compare against. */
  function abstractOf(status) {
    var s = status || {};
    if (s.abstractGameState) return s.abstractGameState;
    if (s.codedGameState === 'F' || s.statusCode === 'F') return 'Final';
    if (s.codedGameState === 'L' || s.codedGameState === 'M' || s.codedGameState === 'N' ||
      s.codedGameState === 'I' || s.codedGameState === 'P') return 'Live';
    return '';
  }

  /* ------------------------------------------------------------- snapshot */

  function playersOf(feed) {
    var box = feed && feed.liveData && feed.liveData.boxscore;
    if (box && box.teams) {
      return {
        away: (box.teams.away && box.teams.away.team) || null,
        home: (box.teams.home && box.teams.home.team) || null,
      };
    }
    var gd = (feed && feed.gameData) || {};
    function teamNode(side) {
      var t = (gd.teams && gd.teams[side]) || {};
      return t.team || t || null;
    }
    return { away: teamNode('away'), home: teamNode('home') };
  }

  function abbrOf(team, fallback) {
    if (global.UI && global.UI.abbr) {
      var a = global.UI.abbr(team);
      if (a) return a;
    }
    return fallback || '';
  }

  function countPitches(plays) {
    var total = 0;
    (plays || []).forEach(function (play) {
      ((play && play.playEvents) || []).forEach(function (ev) {
        if (ev && ev.isPitch === true) total += 1;
      });
    });
    return total;
  }

  /* The at-bat happening right now. The last play flagged `isComplete: false`
   * is preferred over `currentPlay`, which can lag behind the play list by one
   * pitch; `currentPlay` is the fallback when the projection omits the flag. */
  function currentPlayOf(feed, list) {
    var plays = (feed && feed.liveData && feed.liveData.plays) || {};
    var all = list || plays.allPlays || [];
    for (var i = all.length - 1; i >= 0; i -= 1) {
      if (all[i] && all[i].about && all[i].about.isComplete === false) return all[i];
    }
    if (plays.currentPlay) return plays.currentPlay;
    return null;
  }

  function matchupOf(play) {
    if (!play) return { batter: null, pitcher: null };
    var m = play.matchup || {};
    var ls = play.__linescore || null;
    function person(node) {
      if (!node) return null;
      if (typeof node !== 'object') return { id: Number(node) || null, name: '' };
      return { id: node.id !== undefined ? node.id : null, name: node.fullName || node.name || '' };
    }
    var batter = person(m.batter);
    var pitcher = person(m.pitcher);
    if (!batter && ls && ls.offense && ls.offense.batter) batter = person(ls.offense.batter);
    if (!pitcher && ls && ls.defense && ls.defense.pitcher) pitcher = person(ls.defense.pitcher);
    if (batter && !batter.name && ls && ls.offense && ls.offense.batter) {
      batter = { id: batter.id, name: ls.offense.batter.fullName || '' };
    }
    return { batter: batter, pitcher: pitcher };
  }

  function basesFrom(linescore) {
    var off = (linescore && linescore.offense) || {};
    function runner(node) {
      if (!node) return null;
      return { id: node.id !== undefined ? node.id : null, name: node.fullName || '' };
    }
    return { first: runner(off.first), second: runner(off.second), third: runner(off.third) };
  }

  /* Review state of the game, read from the payload's own fields. */
  function reviewStateOf(feed) {
    var gd = (feed && feed.gameData) || {};
    var status = gd.status || {};
    var code = String(status.statusCode || '').toUpperCase();
    var inReview = /^[MN]/.test(code) || code === 'IH';
    return {
      statusCode: code || '',
      detailedState: status.detailedState || '',
      reason: status.reason || '',
      inReview: inReview,
      reviewCode: inReview ? code : '',
      manager: gd.review || null,
      abs: gd.absChallenges || null,
    };
  }

  /**
   * snapshot(feed, plays, opts)
   * Compact, complete, second-stamped official state. `at` is the capture time
   * (ms) and is the timestamp every diff/log record is stamped with.
   */
  function snapshot(feed, plays, opts) {
    opts = opts || {};
    var at = typeof opts.at === 'number' ? opts.at : Date.now();
    var list = plays || ((feed && feed.liveData && feed.liveData.plays && feed.liveData.plays.allPlays) || []);
    var gd = (feed && feed.gameData) || {};
    var ls = (feed && feed.liveData && feed.liveData.linescore) || (opts.linescore || {});
    var teams = playersOf(feed);
    var status = gd.status || {};
    var away = abbrOf(teams.away, 'AWAY');
    var home = abbrOf(teams.home, 'HOME');
    var lsTeams = ls.teams || {};
    var score = {
      away: Number((lsTeams.away && lsTeams.away.runs) !== undefined ? lsTeams.away.runs
        : (gd.teams && gd.teams.away && gd.teams.away.score)),
      home: Number((lsTeams.home && lsTeams.home.runs) !== undefined ? lsTeams.home.runs
        : (gd.teams && gd.teams.home && gd.teams.home.score)),
    };
    if (!isFinite(score.away)) score.away = null;
    if (!isFinite(score.home)) score.home = null;

    var cp = currentPlayOf(feed, list);
    if (cp && !cp.__linescore && opts.linescore) cp.__linescore = opts.linescore;
    var matchup = matchupOf(cp);
    var counts = {
      balls: typeof ls.balls === 'number' ? ls.balls : (cp && cp.count ? cp.count.balls : null),
      strikes: typeof ls.strikes === 'number' ? ls.strikes : (cp && cp.count ? cp.count.strikes : null),
      outs: typeof ls.outs === 'number' ? ls.outs : (cp && cp.count ? cp.count.outs : null),
    };
    Object.keys(counts).forEach(function (k) {
      if (counts[k] === undefined) counts[k] = null;
    });

    var state = {
      v: STATE_VERSION,
      gamePk: Number((gd.game && gd.game.pk) || opts.gamePk || 0) || null,
      at: at,
      capturedAtISO: new Date(at).toISOString(),
      officialDate: (gd.datetime && gd.datetime.officialDate) || opts.officialDate || '',
      gameDate: (gd.datetime && gd.datetime.dateTime) || opts.gameDate || '',
      label: away + ' @ ' + home,
      teams: { away: away, home: home },
      status: {
        abstract: abstractOf(status),
        coded: status.codedGameState || '',
        detailed: status.detailedState || '',
        code: status.statusCode || '',
        reason: status.reason || '',
      },
      inReview: reviewStateOf(feed).inReview,
      score: score,
      inning: {
        number: ls.currentInning || (cp && cp.about ? cp.about.inning : null) || null,
        ordinal: ls.currentInningOrdinal || '',
        half: ls.inningState || ls.inningHalf || (cp && cp.about ? cp.about.halfInning : '') || '',
        isTop: typeof ls.isTopInning === 'boolean' ? ls.isTopInning
          : (cp && cp.about && typeof cp.about.isTopInning === 'boolean' ? cp.about.isTopInning : null),
      },
      count: counts,
      batter: matchup.batter,
      pitcher: matchup.pitcher,
      bases: basesFrom(ls),
      pitchCount: {
        /* Total pitches thrown in the game, counted from the official
         * playEvents (isPitch === true). Null when no play-by-play was part of
         * this capture, so a lean status probe can never report a fake 0. */
        total: opts.hasPlays === false ? null : countPitches(list),
      },
      lineScore: {
        balls: typeof ls.balls === 'number' ? ls.balls : null,
        strikes: typeof ls.strikes === 'number' ? ls.strikes : null,
        outs: typeof ls.outs === 'number' ? ls.outs : null,
      },
      plays: list.length,
      source: opts.source || '',
      sourceUrl: opts.sourceUrl || '',
    };
    return state;
  }

  /* ---------------------------------------------------------------- diff */

  function scoreText(score) {
    if (!score || score.away === null || score.home === null) return '—';
    return score.away + '–' + score.home;
  }

  function sideScoreText(score, label) {
    if (!score || score.away === null || score.home === null) return '—';
    return label + ' ' + score.away + ' – ' + label + ' ' + score.home;
  }

  function nameOf(person) {
    return person && person.name ? person.name : '';
  }

  function baseText(bases) {
    var on = [];
    if (bases && bases.first) on.push('1B');
    if (bases && bases.second) on.push('2B');
    if (bases && bases.third) on.push('3B');
    return on.length ? on.join(', ') : 'empty';
  }

  /**
   * diff(prev, next) -> [{ field, before, after, text }]
   * Both arguments are snapshots from snapshot(). The first observation of a
   * game (prev === null) yields no diff rows: there is nothing to compare to,
   * and inventing a "before" would be inference.
   */
  function diff(prev, next) {
    var rows = [];
    if (!next) return rows;
    if (!prev) return rows;

    function push(field, before, after, text) {
      if (String(before) === String(after)) return;
      rows.push({ field: field, before: before, after: after, text: text });
    }

    var scoreChanged = scoreText(prev.score) !== scoreText(next.score);
    if (scoreChanged) {
      push('score', scoreText(prev.score), scoreText(next.score),
        'Score: ' + sideScoreText(prev.score, next.teams.away) + ' → ' + sideScoreText(next.score, next.teams.away));
    }

    push('status', prev.status.detailed, next.status.detailed,
      'Status: ' + (prev.status.detailed || '—') + ' → ' + (next.status.detailed || '—'));

    if (prev.status.code !== next.status.code && prev.status.detailed === next.status.detailed) {
      push('statusCode', prev.status.code, next.status.code,
        'Official status code: ' + (prev.status.code || '—') + ' → ' + (next.status.code || '—'));
    }

    push('inning', [prev.inning.number, prev.inning.half].join(' '),
      [next.inning.number, next.inning.half].join(' '),
      'Inning: ' + (prev.inning.half || '—') + ' ' + (prev.inning.number || '—') +
      ' → ' + (next.inning.half || '—') + ' ' + (next.inning.number || '—'));

    push('outs', prev.count.outs, next.count.outs,
      'Outs: ' + (prev.count.outs === null ? '—' : prev.count.outs) +
      ' → ' + (next.count.outs === null ? '—' : next.count.outs));

    push('count', prev.count.balls + '-' + prev.count.strikes, next.count.balls + '-' + next.count.strikes,
      'Count: ' + (prev.count.balls === null ? '—' : prev.count.balls + '-' + prev.count.strikes) +
      ' → ' + (next.count.balls === null ? '—' : next.count.balls + '-' + next.count.strikes));

    push('pitchCount', prev.pitchCount.total, next.pitchCount.total,
      'Pitch count: ' + (prev.pitchCount.total === null ? '—' : prev.pitchCount.total) +
      ' → ' + (next.pitchCount.total === null ? '—' : next.pitchCount.total));

    push('batter', nameOf(prev.batter), nameOf(next.batter),
      'Batter: ' + (nameOf(prev.batter) || '—') + ' → ' + (nameOf(next.batter) || '—'));

    push('pitcher', nameOf(prev.pitcher), nameOf(next.pitcher),
      'Pitcher: ' + (nameOf(prev.pitcher) || '—') + ' → ' + (nameOf(next.pitcher) || '—'));

    push('bases', baseText(prev.bases), baseText(next.bases),
      'Runners: ' + baseText(prev.bases) + ' → ' + baseText(next.bases));

    push('review', prev.inReview ? 'under review' : 'in play', next.inReview ? 'under review' : 'in play',
      next.inReview ? 'Review opened (official status)' : 'Review resolved (official status)');

    push('plays', prev.plays, next.plays,
      'Completed plays: ' + prev.plays + ' → ' + next.plays);

    return rows;
  }

  /* --------------------------------------------------------------- ledger */

  /** Storage adapter: localStorage always, plus an optional server mirror. */
  function createStore(options) {
    options = options || {};
    var mem = Object.create(null);
    var useLocal = options.local !== false;

    function lsKey(date) { return KEY_PREFIX + date; }

    function readIndex() {
      if (!useLocal) return mem[INDEX_SUFFIX] ? mem[INDEX_SUFFIX].slice() : [];
      try {
        var raw = global.localStorage.getItem(lsKey('#index'));
        var parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
      } catch (e) { return []; }
    }

    function writeIndex(dates) {
      var sorted = dates.slice().sort();
      while (sorted.length > KEEP_DATES) {
        var drop = sorted.shift();
        if (useLocal) {
          try { global.localStorage.removeItem(lsKey(drop)); } catch (e) { /* ignore */ }
        }
        delete mem[drop];
      }
      if (useLocal) {
        try { global.localStorage.setItem(lsKey('#index'), JSON.stringify(sorted)); } catch (e) { /* ignore */ }
      } else {
        mem[INDEX_SUFFIX] = sorted;
      }
    }

    function read(date) {
      if (!useLocal) return mem[date] || null;
      try {
        var raw = global.localStorage.getItem(lsKey(date));
        return raw ? JSON.parse(raw) : null;
      } catch (e) { return null; }
    }

    function write(date, bucket) {
      if (write.ok === false) return false;
      var payload;
      try {
        payload = JSON.stringify(bucket);
      } catch (e) { return false; }
      if (useLocal) {
        try {
          global.localStorage.setItem(lsKey(date), payload);
        } catch (e) {
          /* Quota: shed snapshot history first (it is the largest and least
           * critical part), then retry once. Ledger rows are never dropped. */
          write.ok = false;
          try {
            bucket.snapshots = {};
            bucket.games = {};
            global.localStorage.setItem(lsKey(date), JSON.stringify(bucket));
            write.ok = true;
          } catch (e2) {
            global.console && global.console.warn &&
              global.console.warn('[game-state] storage full; keeping the in-memory ledger for ' + date);
            return false;
          }
        }
      } else {
        mem[date] = bucket;
      }
      var index = readIndex();
      if (index.indexOf(date) === -1) {
        index.push(date);
        writeIndex(index);
      }
      return true;
    }

    return { read: read, write: write, index: readIndex, prefix: KEY_PREFIX };
  }

  function emptyBucket(date) {
    return {
      v: STATE_VERSION,
      date: date,
      savedAt: Date.now(),
      /* last snapshot per gamePk — the baseline the next diff compares to */
      games: {},
      /* per-game ring of recent snapshots (bounded) */
      snapshots: {},
      /* immutable ledger of pending rulings + official scoring changes */
      ledger: [],
      /* every observed state transition, newest first (bounded) */
      transitions: [],
      /* games already promoted into the ledger, so a reload cannot duplicate */
      seen: {},
    };
  }

  function normalizeBucket(bucket, date) {
    if (!bucket || typeof bucket !== 'object') return emptyBucket(date);
    if (bucket.v !== STATE_VERSION) return emptyBucket(date);
    return {
      v: STATE_VERSION,
      date: bucket.date || date,
      savedAt: Number(bucket.savedAt) || Date.now(),
      games: (bucket.games && typeof bucket.games === 'object') ? bucket.games : {},
      snapshots: (bucket.snapshots && typeof bucket.snapshots === 'object') ? bucket.snapshots : {},
      ledger: Array.isArray(bucket.ledger) ? bucket.ledger.filter(Boolean) : [],
      transitions: Array.isArray(bucket.transitions) ? bucket.transitions.filter(Boolean) : [],
      seen: (bucket.seen && typeof bucket.seen === 'object') ? bucket.seen : {},
    };
  }

  function ledgerKey(row) {
    if (!row) return '';
    return [row.gamePk, row.kind, row.atBatIndex, row.basis].join(':');
  }

  function pushTransition(bucket, row) {
    bucket.transitions.unshift(row);
    if (bucket.transitions.length > 600) bucket.transitions.length = 600;
  }

  /**
   * record(store, date, snap, diffRows, extra)
   * Persists the new baseline, appends the transitions and returns the bucket.
   * Idempotent per snapshot: recording the same `at` twice changes nothing.
   *
   * The *baseline* and the transitions are written on every capture (that is
   * what makes the diff exact), but the snapshot ring is throttled
   * (`extra.ringMinMs`, default 1000) and also forced whenever the score, the
   * outs or the review state changed — so a 250 ms scan cannot turn the stored
   * history into megabytes, while the timeline still shows every scoring play.
   */
  function record(store, date, snap, diffRows, extra) {
    if (!snap || !snap.gamePk) return null;
    var bucket = normalizeBucket(store.read(date), date);
    var pk = String(snap.gamePk);
    var prevAt = bucket.games[pk] ? bucket.games[pk].at : null;
    if (prevAt !== null && prevAt === snap.at) return bucket;

    (diffRows || []).forEach(function (row) {
      pushTransition(bucket, {
        gamePk: snap.gamePk,
        at: snap.at,
        atISO: snap.capturedAtISO,
        label: snap.label,
        field: row.field,
        before: row.before === undefined ? null : row.before,
        after: row.after === undefined ? null : row.after,
        text: row.text,
        source: snap.source,
        sourceUrl: snap.sourceUrl,
      });
    });

    bucket.games[pk] = snap;
    var ring = bucket.snapshots[pk] || [];
    var ringMinMs = extra && typeof extra.ringMinMs === 'number' ? extra.ringMinMs : 1000;
    var lastRing = ring.length ? ring[ring.length - 1] : null;
    var material = (diffRows || []).some(function (r) {
      return r.field === 'score' || r.field === 'outs' || r.field === 'review' || r.field === 'status';
    });
    if (lastRing && !material && (snap.at - (Number(lastRing.at) || 0)) < ringMinMs) {
      bucket.savedAt = Date.now();
      store.write(date, bucket);
      return bucket;
    }
    ring.push({
      at: snap.at,
      atISO: snap.capturedAtISO,
      score: snap.score,
      outs: snap.count.outs,
      count: { balls: snap.count.balls, strikes: snap.count.strikes },
      inning: snap.inning,
      pitchCount: snap.pitchCount.total,
      batter: snap.batter && snap.batter.name || '',
      pitcher: snap.pitcher && snap.pitcher.name || '',
      status: snap.status,
      inReview: snap.inReview,
    });
    if (ring.length > MAX_SNAPSHOTS_PER_GAME) ring.splice(0, ring.length - MAX_SNAPSHOTS_PER_GAME);
    bucket.snapshots[pk] = ring;

    if (extra && extra.ledgerRows) {
      extra.ledgerRows.forEach(function (row) { addLedgerRow(bucket, row); });
    }

    bucket.savedAt = Date.now();
    trim(bucket);
    store.write(date, bucket);
    return bucket;
  }

  function addLedgerRow(bucket, row) {
    var key = ledgerKey(row);
    if (!key) return false;
    for (var i = 0; i < bucket.ledger.length; i += 1) {
      if (ledgerKey(bucket.ledger[i]) === key) {
        /* Same observation, newer evidence: extend history instead of
         * replacing the first-seen wording. */
        var existing = bucket.ledger[i];
        existing.lastSeen = row.lastSeen || Date.now();
        existing.lastSeenISO = row.lastSeenISO || existing.lastSeenISO;
        if (row.after && !existing.after) existing.after = row.after;
        if (row.state) existing.state = row.state;
        existing.history = (existing.history || []).concat(row.history || []).slice(-40);
        return false;
      }
    }
    bucket.ledger.unshift(row);
    bucket.seen[key] = row.firstSeen || Date.now();
    if (bucket.ledger.length > 800) bucket.ledger.length = 800;
    return true;
  }

  function trim(bucket) {
    var bytes = 0;
    try { bytes = JSON.stringify(bucket).length; } catch (e) { return; }
    if (bytes <= MAX_STATE_BYTES) return;
    /* Shed the oldest half of the snapshot rings first — ledger and
     * transitions (the reviewable record) survive. */
    Object.keys(bucket.snapshots).forEach(function (pk) {
      var ring = bucket.snapshots[pk];
      if (ring.length > 20) bucket.snapshots[pk] = ring.slice(Math.floor(ring.length / 2));
    });
    if (bucket.transitions.length > 200) bucket.transitions.length = 200;
  }

  /**
   * ledgerRow(...) — the one shape every pending/change record uses, so the
   * separate scoring section renders exactly what was captured.
   */
  function ledgerRow(fields) {
    var at = fields.at || Date.now();
    return {
      v: STATE_VERSION,
      kind: fields.kind,                     /* 'pending' | 'scoring_change' */
      basis: fields.basis || '',             /* why it is a record: pending / reclassified / outs / rbi … */
      gamePk: fields.gamePk || null,
      atBatIndex: fields.atBatIndex === undefined ? null : fields.atBatIndex,
      at: at,
      firstSeen: fields.firstSeen || at,
      firstSeenISO: new Date(fields.firstSeen || at).toISOString(),
      lastSeen: fields.lastSeen || at,
      lastSeenISO: new Date(fields.lastSeen || at).toISOString(),
      atISO: new Date(at).toISOString(),
      label: fields.label || '',
      inningLabel: fields.inningLabel || '',
      batter: fields.batter || '',
      pitcher: fields.pitcher || '',
      /* exact official wording, before and after */
      before: fields.before || null,
      after: fields.after || null,
      state: fields.state || 'observed',     /* 'pending' | 'resolved' | 'observed' */
      resolved: fields.resolved || null,
      score: fields.score || null,
      source: fields.source || '',
      sourceUrl: fields.sourceUrl || '',
      history: fields.history || [],
    };
  }

  /* Union two buckets without losing a ledger row or a transition. */
  function mergeBuckets(a, b, date) {
    var base = normalizeBucket(a, date);
    var add = normalizeBucket(b, date);
    var ledgerMap = Object.create(null);
    var order = [];
    var transitions = [];
    var transKeys = Object.create(null);

    base.ledger.concat(add.ledger).forEach(function (row) {
      var key = ledgerKey(row);
      if (!key) return;
      if (!ledgerMap[key]) {
        ledgerMap[key] = row;
        order.push(key);
        return;
      }
      var prev = ledgerMap[key];
      var merged = Object.assign({}, prev, row);
      merged.firstSeen = Math.min(Number(prev.firstSeen) || 0, Number(row.firstSeen) || 0) || row.firstSeen;
      merged.lastSeen = Math.max(Number(prev.lastSeen) || 0, Number(row.lastSeen) || 0);
      merged.history = (prev.history || []).concat(row.history || []).slice(-40);
      if (prev.state === 'resolved' && row.state !== 'resolved') merged.state = prev.state;
      ledgerMap[key] = merged;
    });
    var ledger = order.map(function (key) { return ledgerMap[key]; }).filter(Boolean);

    base.transitions.concat(add.transitions).forEach(function (t) {
      var key = [t.gamePk, t.at, t.field].join('|');
      if (transKeys[key]) return;
      transKeys[key] = true;
      transitions.push(t);
    });
    transitions.sort(function (x, y) { return (y.at || 0) - (x.at || 0); });

    var games = Object.assign({}, base.games);
    Object.keys(add.games).forEach(function (pk) {
      var mine = games[pk];
      var theirs = add.games[pk];
      if (!mine || (Number(theirs.at) || 0) > (Number(mine.at) || 0)) games[pk] = theirs;
    });

    var snapshots = Object.assign({}, base.snapshots);
    Object.keys(add.snapshots).forEach(function (pk) {
      if (!snapshots[pk] || snapshots[pk].length < add.snapshots[pk].length) snapshots[pk] = add.snapshots[pk];
    });

    return {
      v: STATE_VERSION,
      date: date,
      savedAt: Math.max(Number(base.savedAt) || 0, Number(add.savedAt) || 0),
      games: games,
      snapshots: snapshots,
      ledger: ledger.slice(0, 800),
      transitions: transitions.slice(0, 600),
      seen: Object.assign({}, base.seen, add.seen),
    };
  }

  /* --------------------------------------------------- persistence (local + server) */

  var serverState = { checked: false, available: false };

  function isStaticHost() {
    var host = (global.location && global.location.hostname) || '';
    return /\.github\.io$/i.test(host);
  }

  /**
   * createPersistence(date) -> { load(), save(bucket), streamDate }
   * localStorage is always used. The optional server (server.mjs:
   * GET/POST /api/game-state) is probed once and mirrored when present; on
   * static hosting every server call is skipped, never retried in a loop.
   */
  function createPersistence(date, options) {
    options = options || {};
    var store = options.store || createStore({ local: true });
    var coalesceMs = options.coalesceMs || 1200;
    var timer = null;
    var pending = null;

    function serverFetch(path, opts) {
      return global.fetch(path, Object.assign({ cache: 'no-store', credentials: 'same-origin' }, opts || {}))
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        });
    }

    function loadRemote() {
      if (isStaticHost() || options.server === false) return Promise.resolve(null);
      if (serverState.checked && !serverState.available) return Promise.resolve(null);
      return serverFetch('/api/game-state?date=' + encodeURIComponent(date))
        .then(function (data) {
          serverState.checked = true;
          serverState.available = true;
          return data && data.v === STATE_VERSION ? normalizeBucket(data, date) : null;
        })
        .catch(function () {
          serverState.checked = true;
          serverState.available = false;
          return null;
        });
    }

    function postNow() {
      var bucket = pending;
      pending = null;
      if (!bucket || isStaticHost() || (serverState.checked && !serverState.available)) return;
      serverFetch('/api/game-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bucket),
      }).then(function () { serverState.available = true; })
        .catch(function () { /* stays local-only; the UI says so */ });
    }

    return {
      store: store,
      load: function () {
        var local = store.read(date);
        return loadRemote().then(function (remote) {
          if (!remote) return normalizeBucket(local, date);
          if (!local) {
            store.write(date, remote);
            return remote;
          }
          var merged = mergeBuckets(remote, local, date);
          store.write(date, merged);
          return merged;
        });
      },
      save: function (bucket) {
        store.write(date, bucket);
        if (isStaticHost() || options.server === false) return;
        pending = bucket;
        if (timer) return;
        timer = setTimeout(function () { timer = null; postNow(); }, coalesceMs);
      },
      serverAvailable: function () { return serverState.available; },
      serverChecked: function () { return serverState.checked; },
    };
  }

  /* Describe a play's official classification in the API's own words. Used for
   * both sides of a scoring change so "before" and "after" quote MLB, not us. */
  function officialWording(play) {
    if (!play) return null;
    var res = play.result || {};
    var count = play.count || {};
    return {
      eventType: res.eventType || '',
      description: res.description || '',
      isOut: res.isOut === true,
      rbi: typeof res.rbi === 'number' ? res.rbi : null,
      outs: typeof count.outs === 'number' ? count.outs : null,
      awayScore: typeof res.awayScore === 'number' ? res.awayScore : null,
      homeScore: typeof res.homeScore === 'number' ? res.homeScore : null,
    };
  }

  global.GameState = {
    snapshot: snapshot,
    diff: diff,
    record: record,
    createStore: createStore,
    createPersistence: createPersistence,
    mergeBuckets: mergeBuckets,
    emptyBucket: emptyBucket,
    normalizeBucket: normalizeBucket,
    addLedgerRow: addLedgerRow,
    ledgerRow: ledgerRow,
    ledgerKey: ledgerKey,
    officialWording: officialWording,
    scoreText: scoreText,
    nameOf: nameOf,
    baseText: baseText,
    abstractOf: abstractOf,
    /* exported for tests */
    countPitches: countPitches,
    playersOf: playersOf,
    reviewStateOf: reviewStateOf,
    KEEP_DATES: KEEP_DATES,
    MAX_SNAPSHOTS_PER_GAME: MAX_SNAPSHOTS_PER_GAME,
  };
}(window));
