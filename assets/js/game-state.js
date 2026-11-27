/* ============================================================================
 * game-state.js — official live game state, captured as it happens
 *
 * Every value here is read from the official feed payload; nothing is derived,
 * guessed or filled in.  A snapshot is the whole baseball state of one game at
 * one official timestamp:
 *
 *   score · hits · errors · inning + half + inning state · balls · strikes ·
 *   outs · bases (with runner names) · batter · pitcher · on-deck · in-hole ·
 *   current at-bat (index, official description, event type, complete) ·
 *   official game status + review status (code + reason, from the API's own
 *   gameStatus registry) · official manager/ABS challenge counters
 *
 * Time is recorded three ways, all of them kept:
 *   apiTimeStamp   the API's own `metaData.timeStamp` — "YYYYMMDD_HHMMSS",
 *                  second precision, the official moment the feed was written.
 *                  This is the authority for "when did this happen".
 *   capturedAt     the browser clock when the payload was received (ms).
 *   latencyMs      capturedAt − apiTimeStamp, i.e. how far behind the API's own
 *                  clock we were when we saw it.  Recorded, never hidden.
 *
 * `diff(prev, next)` turns two snapshots into the individual changes that
 * happened between them, each with the official wording before AND after.  The
 * feed turns those into rows; scoring-log.js keeps the two ruling-related
 * kinds (pending / reclassified) in its own persistent store.
 *
 * Verified shapes (live StatsAPI, 2026-11-27):
 *   GET /api/v1.1/game/824638/feed/live?fields=metaData,timeStamp,wait,gameEvents
 *     → {"metaData":{"wait":10,"timeStamp":"20260828_212805",
 *        "gameEvents":["field_out","game_finished"],
 *        "logicalEvents":["midInning","countChange",...]}}            (~150 B)
 *   GET /api/v1.1/game/824638/feed/live?timecode=20260828_182358      → the
 *     official snapshot of THAT second (the pre-game state), so a "before"
 *     state can be re-read from the API rather than reconstructed by us.
 * ==========================================================================*/
(function (global) {
  'use strict';

  var Reviews = global.Reviews;

  function num(v) {
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  function person(node) {
    if (!node) return null;
    if (typeof node === 'string') return { id: null, name: node };
    return { id: num(node.id), name: node.fullName || node.name || '' };
  }

  function base(node) {
    var p = person(node);
    if (!p || (!p.id && !p.name)) return null;
    return p;
  }

  /* "YYYYMMDD_HHMMSS" -> epoch ms (UTC). The API's timeStamp is UTC. */
  function timeStampToMs(ts) {
    var m = /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$/.exec(String(ts || ''));
    if (!m) return null;
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]),
      Number(m[4]), Number(m[5]), Number(m[6]));
  }

  function timeStampToIso(ts) {
    var ms = timeStampToMs(ts);
    return ms === null ? null : new Date(ms).toISOString();
  }

  /* Current UTC second as an API timeStamp, for the one case where the API has
   * not given us one (a fallback fetch that omitted metaData): we say which
   * clock we used instead of pretending it is official. */
  function nowTimeStamp(d) {
    var t = d ? new Date(d) : new Date();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return t.getUTCFullYear() + p(t.getUTCMonth() + 1) + p(t.getUTCDate()) + '_' +
      p(t.getUTCHours()) + p(t.getUTCMinutes()) + p(t.getUTCSeconds());
  }

  function playsOf(feed) { return Reviews.playsOf(feed); }

  function currentPlayOf(feed, plays) {
    var cur = feed && feed.liveData && feed.liveData.plays && feed.liveData.plays.currentPlay;
    if (cur) return cur;
    var last = plays && plays.length ? plays[plays.length - 1] : null;
    if (last && last.about && last.about.isComplete === false) return last;
    return null;
  }

  function scoreOf(feed, play) {
    var ls = feed && feed.liveData && feed.liveData.linescore;
    var t = ls && ls.teams;
    if (t && t.away && t.home && typeof t.away.runs === 'number' && typeof t.home.runs === 'number') {
      return {
        away: t.away.runs,
        home: t.home.runs,
        awayHits: typeof t.away.hits === 'number' ? t.away.hits : null,
        homeHits: typeof t.home.hits === 'number' ? t.home.hits : null,
        awayErrors: typeof t.away.errors === 'number' ? t.away.errors : null,
        homeErrors: typeof t.home.errors === 'number' ? t.home.errors : null,
        source: 'liveData.linescore.teams',
      };
    }
    if (play && play.result &&
      typeof play.result.awayScore === 'number' && typeof play.result.homeScore === 'number') {
      return {
        away: play.result.awayScore,
        home: play.result.homeScore,
        awayHits: null, homeHits: null, awayErrors: null, homeErrors: null,
        source: 'play.result',
      };
    }
    return null;
  }

  /**
   * snapshot(feed, opts) -> state object, or null when there is no payload.
   * opts.capturedAt overrides the reception clock (tests).
   */
  function snapshot(feed, opts) {
    if (!feed) return null;
    opts = opts || {};
    var gameData = feed.gameData || {};
    var live = feed.liveData || {};
    var ls = live.linescore || {};
    var status = gameData.status || {};
    var meta = feed.metaData || {};
    var plays = playsOf(feed);
    var cur = currentPlayOf(feed, plays);
    var curAbout = (cur && cur.about) || {};
    var curResult = (cur && cur.result) || {};

    var capturedAt = opts.capturedAt || Date.now();
    var apiTimeStamp = meta.timeStamp || null;
    var apiMs = timeStampToMs(apiTimeStamp);

    var teams = gameData.teams || {};
    var awayTeam = teams.away || {};
    var homeTeam = teams.home || {};

    var offense = ls.offense || {};
    var defense = ls.defense || {};
    var review = Reviews.statusReview(status);

    var completePlays = 0;
    var lastAtBatIndex = null;
    for (var i = 0; i < plays.length; i += 1) {
      var p = plays[i];
      if (!p) continue;
      var ab = num(p.about && p.about.atBatIndex);
      if (ab !== null) lastAtBatIndex = ab;
      if (p.about && p.about.isComplete === true) completePlays += 1;
    }

    var snap = {
      gamePk: num(gameData.game && gameData.game.pk) || num(feed.gamePk) || null,
      capturedAt: capturedAt,
      capturedAtIso: new Date(capturedAt).toISOString(),
      apiTimeStamp: apiTimeStamp,
      apiTimeStampIso: timeStampToIso(apiTimeStamp),
      apiTimeStampSource: apiTimeStamp ? 'metaData.timeStamp' : 'not published in this response',
      apiWaitSeconds: num(meta.wait),
      gameEvents: Array.isArray(meta.gameEvents) ? meta.gameEvents.slice() : null,
      logicalEvents: Array.isArray(meta.logicalEvents) ? meta.logicalEvents.slice() : null,
      latencyMs: apiMs === null ? null : Math.max(0, capturedAt - apiMs),
      clockSkewMs: apiMs === null ? null : capturedAt - apiMs,

      status: {
        abstractGameState: status.abstractGameState || null,
        codedGameState: status.codedGameState || null,
        detailedState: status.detailedState || null,
        statusCode: status.statusCode || null,
        reason: status.reason || null,
        startTimeTBD: status.startTimeTBD === true,
        official: status.detailedState || status.abstractGameState || null,
      },

      teams: {
        away: { id: num(awayTeam.id), name: awayTeam.name || '', abbr: awayTeam.abbreviation || '' },
        home: { id: num(homeTeam.id), name: homeTeam.name || '', abbr: homeTeam.abbreviation || '' },
      },
      venue: (gameData.venue && gameData.venue.name) || null,
      officialDate: (gameData.datetime && gameData.datetime.officialDate) || null,
      gameDate: (gameData.datetime && gameData.datetime.dateTime) || null,

      score: scoreOf(feed, cur),

      inning: {
        number: num(ls.currentInning),
        ordinal: ls.currentInningOrdinal || null,
        half: ls.inningState || null,
        isTop: typeof ls.isTopInning === 'boolean' ? ls.isTopInning : null,
      },
      count: {
        balls: num(ls.balls),
        strikes: num(ls.strikes),
        outs: num(ls.outs),
      },
      bases: {
        first: base(offense.first),
        second: base(offense.second),
        third: base(offense.third),
      },
      batter: person(offense.batter) || person(cur && cur.matchup && cur.matchup.batter),
      /* `linescore.offense.pitcher` is available live; a finished/archived
       * snapshot only carries `linescore.defense.pitcher`.  Both are official —
       * do not fall back to the batting matchup, that is the OTHER pitcher. */
      pitcher: person(offense.pitcher) || person(defense.pitcher) || null,
      onDeck: person(offense.onDeck),
      inHole: person(offense.inHole),

      atBat: {
        index: num(curAbout.atBatIndex) === null ? lastAtBatIndex : num(curAbout.atBatIndex),
        isComplete: curAbout.isComplete === true,
        startTime: curAbout.startTime || null,
        endTime: curAbout.endTime || null,
        description: curResult.description || '',
        eventType: curResult.eventType || '',
        isOut: curResult.isOut === true,
      },

      review: review,
      counters: {
        manager: Reviews.managerCounters(gameData.review) || null,
        abs: Reviews.absCounters(gameData.absChallenges) || null,
      },

      progress: {
        playsSeen: plays.length,
        playsComplete: completePlays,
        lastAtBatIndex: lastAtBatIndex,
      },
    };

    snap.signature = signatureOf(snap);
    return snap;
  }

  /* A compact string of the baseball state — the feed re-renders only when this
   * changes, so a fast poll does not cost frames. */
  function signatureOf(snap) {
    if (!snap) return '';
    var s = snap.score ? snap.score.away + '-' + snap.score.home : '–';
    var c = snap.count || {};
    var b = snap.bases || {};
    function who(p) { return p && (p.id || p.name) ? (p.id || p.name) : ''; }
    return [
      snap.gamePk,
      snap.status && snap.status.statusCode,
      snap.status && snap.status.reason,
      s,
      (snap.inning && snap.inning.number) + '' + (snap.inning && snap.inning.half),
      (snap.inning && snap.inning.ordinal),
      c.balls + '/' + c.strikes + '/' + c.outs,
      who(b.first) + ',' + who(b.second) + ',' + who(b.third),
      who(snap.batter) + '|' + who(snap.pitcher),
      snap.atBat && snap.atBat.index,
      snap.atBat && snap.atBat.isComplete ? 1 : 0,
      snap.atBat && snap.atBat.description ? snap.atBat.description.length : 0,
      snap.review ? snap.review.code + ':' + (snap.review.isBoundary ? 'b' : '') : '',
    ].join('|');
  }

  /* --------------------------------------------------------------- diffing */

  function scoreText(s) { return s ? s.away + '–' + s.home : '—'; }

  function countText(c) {
    if (!c) return '—';
    return c.balls + '-' + c.strikes + ', ' + c.outs + ' out' + (c.outs === 1 ? '' : 's');
  }

  function basesText(b) {
    if (!b) return '—';
    var on = [];
    if (b.first) on.push('1B ' + (b.first.name || ''));
    if (b.second) on.push('2B ' + (b.second.name || ''));
    if (b.third) on.push('3B ' + (b.third.name || ''));
    return on.length ? on.join(' · ') : 'bases empty';
  }

  function inningText(i) {
    if (!i || i.number === null) return '';
    var half = String(i.half || '').toLowerCase().indexOf('top') === 0 ? 'Top' :
      (String(i.half || '').toLowerCase().indexOf('bottom') === 0 ? 'Bot' : (i.half || ''));
    return half + ' ' + i.number + (i.ordinal ? ' (' + i.ordinal + ')' : '');
  }

  function sameId(a, b) {
    var ai = a && a.id !== null && a.id !== undefined ? a.id : (a && a.name ? a.name : null);
    var bi = b && b.id !== null && b.id !== undefined ? b.id : (b && b.name ? b.name : null);
    return ai === bi;
  }

  /**
   * diff(prev, next) -> { changes: [...], signature }
   *   Each change: { kind, key, before, after, text, official }
   *   kind: score | outs | count | batter | pitcher | bases | inning |
   *         status | reviewOpen | reviewClose | atBat
   *   `before` / `after` carry the official wording, not a paraphrase.
   */
  function diff(prev, next) {
    var out = [];
    if (!next) return { changes: out, signature: '' };
    if (!prev) return { changes: out, signature: next.signature };

    function push(change) {
      change.apiTimeStamp = next.apiTimeStamp || null;
      change.capturedAt = next.capturedAt;
      out.push(change);
    }

    var before = prev.score;
    var after = next.score;
    if (before && after && (before.away !== after.away || before.home !== after.home)) {
      push({
        kind: 'score',
        key: 'score',
        before: before,
        after: after,
        text: 'Score ' + scoreText(before) + ' → ' + scoreText(after),
        official: next.atBat && next.atBat.description ? next.atBat.description : '',
      });
    }

    if (prev.status.statusCode !== next.status.statusCode ||
      prev.status.reason !== next.status.reason ||
      prev.status.detailedState !== next.status.detailedState) {
      push({
        kind: 'status',
        key: 'status',
        before: { code: prev.status.statusCode, detailedState: prev.status.detailedState, reason: prev.status.reason },
        after: { code: next.status.statusCode, detailedState: next.status.detailedState, reason: next.status.reason },
        text: 'Official status "' + (prev.status.detailedState || '—') + '" → "' +
          (next.status.detailedState || '—') + '"' +
          (next.status.statusCode ? ' (' + next.status.statusCode + ')' : ''),
        official: next.status.detailedState,
      });
    }

    /* A review opening or resolving is its own event, separate from the game
     * status change when the API reports both. */
    var prevReview = prev.review;
    var nextReview = next.review;
    var prevKey = prevReview ? prevReview.code + '|' + prevReview.reason + '|' + (prev.status.statusCode || '') : '';
    var nextKey = nextReview ? nextReview.code + '|' + nextReview.reason + '|' + (next.status.statusCode || '') : '';
    if (prevKey !== nextKey) {
      if (nextReview) {
        push({
          kind: 'reviewOpen',
          key: 'review',
          before: prevReview ? { code: prevReview.code, reason: prevReview.reason, typeLabel: prevReview.typeLabel } : null,
          after: { code: nextReview.code, reason: nextReview.reason, typeLabel: nextReview.typeLabel },
          text: nextReview.typeLabel + (nextReview.reason ? ': ' + nextReview.reason : '') +
            ' (official status ' + (next.status.statusCode || '—') + ')',
          official: next.status.reason || nextReview.reason || next.status.detailedState,
        });
      } else {
        push({
          kind: 'reviewClose',
          key: 'review',
          before: { code: prevReview.code, reason: prevReview.reason, typeLabel: prevReview.typeLabel },
          after: { code: next.status.statusCode, detailedState: next.status.detailedState },
          text: (prevReview.typeLabel + (prevReview.reason ? ': ' + prevReview.reason : '')) +
            ' resolved → official status "' + (next.status.detailedState || '—') + '"',
          official: next.status.detailedState,
        });
      }
    }

    var pc = prev.count || {};
    var nc = next.count || {};
    if (pc.outs !== nc.outs && nc.outs !== null) {
      push({
        kind: 'outs',
        key: 'outs',
        before: pc,
        after: nc,
        text: 'Outs ' + pc.outs + ' → ' + nc.outs,
        official: next.atBat && next.atBat.description ? next.atBat.description : '',
      });
    }
    if (pc.balls !== nc.balls || pc.strikes !== nc.strikes) {
      push({
        kind: 'count',
        key: 'count',
        before: pc,
        after: nc,
        text: 'Count ' + (pc.balls + '-' + pc.strikes) + ' → ' + (nc.balls + '-' + nc.strikes) +
          ' (' + countText(nc) + ')',
        official: countText(nc),
      });
    }
    if (!sameId(prev.batter, next.batter)) {
      push({
        kind: 'batter',
        key: 'batter',
        before: prev.batter,
        after: next.batter,
        text: 'Batter ' + ((prev.batter && prev.batter.name) || '—') + ' → ' +
          ((next.batter && next.batter.name) || '—'),
        official: (next.batter && next.batter.name) || '',
      });
    }
    if (!sameId(prev.pitcher, next.pitcher)) {
      push({
        kind: 'pitcher',
        key: 'pitcher',
        before: prev.pitcher,
        after: next.pitcher,
        text: 'Pitcher ' + ((prev.pitcher && prev.pitcher.name) || '—') + ' → ' +
          ((next.pitcher && next.pitcher.name) || '—'),
        official: (next.pitcher && next.pitcher.name) || '',
      });
    }
    var pb = basesText(prev.bases);
    var nb = basesText(next.bases);
    if (pb !== nb) {
      push({
        kind: 'bases',
        key: 'bases',
        before: prev.bases,
        after: next.bases,
        text: 'Runners: ' + pb + ' → ' + nb,
        official: next.atBat && next.atBat.description ? next.atBat.description : '',
      });
    }
    if (prev.inning.number !== next.inning.number || prev.inning.half !== next.inning.half) {
      push({
        kind: 'inning',
        key: 'inning',
        before: prev.inning,
        after: next.inning,
        text: 'Inning ' + (inningText(prev.inning) || '—') + ' → ' + (inningText(next.inning) || '—'),
        official: inningText(next.inning),
      });
    }
    if (prev.atBat.index !== next.atBat.index ||
      prev.atBat.isComplete !== next.atBat.isComplete ||
      (prev.atBat.description !== next.atBat.description && next.atBat.isComplete)) {
      push({
        kind: 'atBat',
        key: 'atBat',
        before: prev.atBat,
        after: next.atBat,
        text: 'At-bat ' + (next.atBat.index === null ? '—' : '#' + (next.atBat.index + 1)) +
          (next.atBat.isComplete ? ' complete' : ' in progress'),
        official: next.atBat.description || '',
      });
    }

    return { changes: out, signature: next.signature };
  }

  /* Human summary of a capture window, used on rows and in the state panel. */
  function describe(snap) {
    if (!snap) return '';
    var bits = [];
    if (snap.inning && snap.inning.number) bits.push(inningText(snap.inning));
    if (snap.score) bits.push(scoreText(snap.score));
    if (snap.count && snap.count.balls !== null) bits.push(countText(snap.count));
    if (snap.batter && snap.batter.name) bits.push('AB: ' + snap.batter.name);
    if (snap.pitcher && snap.pitcher.name) bits.push('P: ' + snap.pitcher.name);
    return bits.join(' · ');
  }

  global.GameState = {
    snapshot: snapshot,
    diff: diff,
    describe: describe,
    signatureOf: signatureOf,
    timeStampToMs: timeStampToMs,
    timeStampToIso: timeStampToIso,
    nowTimeStamp: nowTimeStamp,
    scoreText: scoreText,
    countText: countText,
    basesText: basesText,
    inningText: inningText,
  };
}(window));
