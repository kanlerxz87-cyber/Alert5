/* ============================================================================
 * scoring-log.js — the separate Official Scoring section
 *
 * Two things are logged here and nowhere else:
 *   PENDING   an at-bat MLB itself has flagged as an undecided official-scorer
 *             ruling (`os_ruling_pending_primary` / `os_ruling_pending_prior`,
 *             GET /api/v1/eventTypes, description "Official Scorer Ruling
 *             Pending") — the at-bat has not been scored yet.
 *   CHANGE    the official scorer has reclassified a play that was already
 *             scored: hit ↔ error, single → double, out → hit, an RBI added or
 *             removed, a description rewritten.
 *
 * The rows come from GameState's persistent ledger, so they survive a page
 * refresh, a new tab and (when server.mjs is running) a different browser. This
 * module only formats and exports them: it never talks to the network, never
 * chimes and never writes, which is what keeps this section from being able to
 * disturb the alert path.
 *
 * Public API
 *   ScoringLog.rows(bucket)          -> sorted rows (newest first)
 *   ScoringLog.pending(rows)         -> only still-pending rows
 *   ScoringLog.changes(rows)         -> only reclassifications
 *   ScoringLog.summary(rows)         -> counters for the section header
 *   ScoringLog.fieldDiff(before, after) -> [{field, before, after}]
 *   ScoringLog.csv(rows) / json(rows)   -> export payloads
 *   ScoringLog.fileStamp(bucket)     -> filename-safe label
 * ==========================================================================*/
(function (global) {
  'use strict';

  var FIELDS = ['eventType', 'description', 'isOut', 'rbi', 'outs', 'awayScore', 'homeScore'];

  var FIELD_LABEL = {
    eventType: 'Official event type',
    description: 'Official description',
    isOut: 'Out recorded',
    rbi: 'RBI credited',
    outs: 'Outs after the play',
    awayScore: 'Away score',
    homeScore: 'Home score',
  };

  function sv(value) {
    if (value === null || value === undefined || value === '') return '—';
    if (value === true) return 'yes';
    if (value === false) return 'no';
    return String(value);
  }

  function fieldDiff(before, after) {
    var out = [];
    if (!before || !after) return out;
    FIELDS.forEach(function (field) {
      var a = before[field];
      var b = after[field];
      if (a === undefined && b === undefined) return;
      if (String(a) === String(b)) return;
      out.push({ field: field, label: FIELD_LABEL[field] || field, before: a, after: b });
    });
    return out;
  }

  function rows(bucket) {
    if (!bucket || !Array.isArray(bucket.ledger)) return [];
    return bucket.ledger.slice().sort(function (a, b) {
      return (Number(b.firstSeen) || 0) - (Number(a.firstSeen) || 0);
    });
  }

  function pending(list) {
    return (list || []).filter(function (r) { return r && r.kind === 'pending'; });
  }

  function openPending(list) {
    return pending(list).filter(function (r) { return r.state !== 'resolved'; });
  }

  function changes(list) {
    return (list || []).filter(function (r) { return r && r.kind === 'scoring_change'; });
  }

  function summary(list) {
    var all = list || [];
    var s = {
      total: all.length,
      pending: 0,
      openPending: 0,
      changes: 0,
      games: 0,
      lastAt: 0,
    };
    var games = Object.create(null);
    all.forEach(function (r) {
      if (!r) return;
      if (r.gamePk) games[r.gamePk] = true;
      if (r.kind === 'pending') {
        s.pending += 1;
        if (r.state !== 'resolved') s.openPending += 1;
      }
      if (r.kind === 'scoring_change') s.changes += 1;
      s.lastAt = Math.max(s.lastAt, Number(r.lastSeen) || Number(r.firstSeen) || 0);
    });
    s.games = Object.keys(games).length;
    return s;
  }

  /* CSV of every logged row, quoting everything — the file is meant to be
   * opened in a spreadsheet and read by a human reviewer. */
  function csv(list) {
    var head = ['logged_first_seen_utc', 'logged_last_seen_utc', 'kind', 'basis', 'gamePk',
      'matchup', 'inning', 'atBatIndex', 'batter', 'pitcher',
      'before_event_type', 'before_description', 'before_rbi', 'before_is_out',
      'after_event_type', 'after_description', 'after_rbi', 'after_is_out',
      'state', 'score', 'source_url'];
    function q(v) {
      var text = sv(v);
      return '"' + text.replace(/"/g, '""') + '"';
    }
    var lines = [head.join(',')];
    (list || []).forEach(function (r) {
      var b = r.before || {};
      var a = r.after || {};
      lines.push([
        r.firstSeenISO || '', r.lastSeenISO || '', r.kind || '', r.basis || '', r.gamePk || '',
        r.label || '', r.inningLabel || '', r.atBatIndex === null || r.atBatIndex === undefined ? '' : r.atBatIndex,
        r.batter || '', r.pitcher || '',
        b.eventType, b.description, b.rbi, b.isOut,
        a.eventType, a.description, a.rbi, a.isOut,
        r.state || '', r.score ? (r.score.away + '-' + r.score.home) : '', r.sourceUrl || '',
      ].map(q).join(','));
    });
    return lines.join('\n');
  }

  function json(list) {
    return JSON.stringify({
      exportedAt: new Date().toISOString(),
      rows: list || [],
    }, null, 2);
  }

  function fileStamp(bucket) {
    var date = (bucket && bucket.date) || 'unknown';
    return 'official-scoring-' + date;
  }

  /* One-line human summary of a change, quoting both sides. */
  function changeText(row) {
    if (!row) return '';
    var diffs = fieldDiff(row.before, row.after);
    if (!diffs.length) return 'recorded';
    return diffs.map(function (d) {
      if (d.field === 'description') return 'description rewritten';
      return d.label + ': ' + sv(d.before) + ' → ' + sv(d.after);
    }).join(' · ');
  }

  global.ScoringLog = {
    rows: rows,
    pending: pending,
    openPending: openPending,
    changes: changes,
    summary: summary,
    fieldDiff: fieldDiff,
    csv: csv,
    json: json,
    fileStamp: fileStamp,
    changeText: changeText,
    FIELD_LABEL: FIELD_LABEL,
    FIELDS: FIELDS,
    sv: sv,
  };
}(window));
