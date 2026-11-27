/* ============================================================================
 * scoring-log.js — the persistent Official Scoring Log (its own store)
 *
 * This is deliberately a SEPARATE module with its OWN storage keys, its own
 * server endpoint and its own render path.  The alert feed (reviews-feed.js)
 * reads it only to *offer* rows; nothing here can break, slow down or block an
 * alert, and nothing in the alert path writes here synchronously.
 *
 * What is logged, straight from the official payload:
 *
 *   1. pending   — a completed at-bat whose official eventType is
 *                  `os_ruling_pending_primary` / `os_ruling_pending_prior`
 *                  (GET /api/v1/eventTypes: "Official Scorer Ruling Pending").
 *                  Opened the second it is first observed, with the exact
 *                  official wording as the "before" record.
 *   2. change    — the official scorer reclassified a play that had already
 *                  been scored (hit↔error, single↔double, out↔hit, …).  The
 *                  API publishes no change marker, so this is detected by
 *                  diffing consecutive observations; both wordings are kept.
 *   3. edit      — the wording / RBI / score of a scored play changed without a
 *                  reclassification.  Flagged for review, never "corrected".
 *   4. unresolved — a pending ruling that never resolved in the payload while
 *                  we were watching.  Kept and flagged; never guessed.
 *
 * Persistence, so a refresh does not lose it:
 *   - localStorage, one key per date (`mlbp.scoringlog.<date>`), newest 30
 *     dates kept, each capped (MAX_ENTRIES) with the oldest *resolved* rows
 *     dropped first
 *   - an optional server store (`POST/GET /api/scoring-log`) so several
 *     browsers/tabs share one log; the static GitHub Pages build has no server
 *     and quietly uses localStorage alone
 *   - never touched by the alert system's store (feed-log.js), so a bug in one
 *     cannot corrupt the other
 * ==========================================================================*/
(function (global) {
  'use strict';

  var PREFIX = 'mlbp.scoringlog.';
  var INDEX_KEY = 'mlbp.scoringlog.index';
  var PREF_KEY = 'mlbp.scoringlog.prefs';
  var KEEP_DATES = 30;
  var MAX_ENTRIES = 400;
  var MAX_NOTES = 8;
  var VERSION = 1;
  var SERVER_PATH = '/api/scoring-log';
  var WRITE_COALESCE_MS = 1500;

  var apiState = { checked: false, available: false, lastError: null };
  var pendingWrites = Object.create(null);
  var writeTimers = Object.create(null);
  var listeners = [];

  /* ------------------------------------------------------------- utilities */

  function now() { return Date.now(); }

  function storageGet(key) {
    try { return global.localStorage.getItem(key); } catch (e) { return null; }
  }
  function storageSet(key, value) {
    try { global.localStorage.setItem(key, value); return true; } catch (e) { return false; }
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function isIsoDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')); }

  function isoSecond(ms) {
    if (!ms) return null;
    var d = new Date(ms);
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()) + 'T' +
      pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()) + ':' + pad2(d.getUTCSeconds()) + 'Z';
  }

  function empty(date) {
    return { v: VERSION, date: date || null, savedAt: now(), entries: [], baselines: {}, notes: [] };
  }

  function readIndex() {
    try {
      var raw = storageGet(INDEX_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter(isIsoDate) : [];
    } catch (e) { return []; }
  }

  function writeIndex(dates) {
    var sorted = dates.slice().sort();
    while (sorted.length > KEEP_DATES) {
      var drop = sorted.shift();
      try { global.localStorage.removeItem(PREFIX + drop); } catch (e) { /* ignore */ }
    }
    storageSet(INDEX_KEY, JSON.stringify(sorted));
  }

  function entryKey(e) {
    if (!e) return null;
    if (e.id) return String(e.id);
    if (e.gamePk !== undefined && e.atBatIndex !== undefined) return e.gamePk + ':' + e.atBatIndex + ':' + (e.kind || '');
    return null;
  }

  function normalizeEntry(e) {
    if (!e || typeof e !== 'object') return null;
    var key = entryKey(e);
    if (!key) return null;
    if (!isIsoDate(e.date)) return null;
    var out = {
      id: key,
      kind: e.kind === 'change' || e.kind === 'edit' || e.kind === 'unresolved' ? e.kind : 'pending',
      date: e.date,
      gamePk: e.gamePk === null || e.gamePk === undefined ? null : String(e.gamePk),
      gamePkNumber: Number(e.gamePk) || null,
      matchup: typeof e.matchup === 'string' ? e.matchup : '',
      atBatIndex: Number.isFinite(Number(e.atBatIndex)) ? Number(e.atBatIndex) : null,
      inningLabel: typeof e.inningLabel === 'string' ? e.inningLabel : '',
      batter: typeof e.batter === 'string' ? e.batter : '',
      pitcher: typeof e.pitcher === 'string' ? e.pitcher : '',
      status: e.status === 'resolved' || e.status === 'unresolved' ? e.status : 'open',
      firstSeenAt: Number(e.firstSeenAt) || now(),
      firstSeenIso: typeof e.firstSeenIso === 'string' ? e.firstSeenIso : isoSecond(Number(e.firstSeenAt) || now()),
      firstSeenApiTimeStamp: typeof e.firstSeenApiTimeStamp === 'string' ? e.firstSeenApiTimeStamp : null,
      firstSeenLatencyMs: Number.isFinite(Number(e.firstSeenLatencyMs)) ? Number(e.firstSeenLatencyMs) : null,
      lastSeenAt: Number(e.lastSeenAt) || now(),
      lastSeenApiTimeStamp: typeof e.lastSeenApiTimeStamp === 'string' ? e.lastSeenApiTimeStamp : null,
      resolvedAt: Number(e.resolvedAt) || null,
      resolvedIso: typeof e.resolvedIso === 'string' ? e.resolvedIso : (e.resolvedAt ? isoSecond(Number(e.resolvedAt)) : null),
      resolvedApiTimeStamp: typeof e.resolvedApiTimeStamp === 'string' ? e.resolvedApiTimeStamp : null,
      resolutionLagMs: Number.isFinite(Number(e.resolutionLagMs)) ? Number(e.resolutionLagMs) : null,
      before: sanitizeSide(e.before),
      after: sanitizeSide(e.after),
      attribution: typeof e.attribution === 'string' ? e.attribution : '',
      sources: Array.isArray(e.sources) ? e.sources.slice(0, 12) : [],
      notes: Array.isArray(e.notes) ? e.notes.filter(function (n) { return typeof n === 'string'; }).slice(-MAX_NOTES) : [],
      observations: Array.isArray(e.observations) ? e.observations.slice(-8) : [],
      verified: e.verified && typeof e.verified === 'object' ? e.verified : null,
    };
    return out;
  }

  function sanitizeSide(side) {
    if (!side || typeof side !== 'object') return null;
    var out = {};
    ['eventType', 'description', 'isOut', 'outs', 'rbi', 'awayScore', 'homeScore',
      'isHit', 'errors', 'official', 'statusCode', 'detailedState', 'reason', 'source'].forEach(function (k) {
      if (side[k] !== undefined) out[k] = side[k];
    });
    if (side.apiTimeStamp) out.apiTimeStamp = String(side.apiTimeStamp);
    if (side.capturedAt) out.capturedAt = Number(side.capturedAt) || null;
    if (side.capturedIso) out.capturedIso = String(side.capturedIso);
    return out;
  }

  function normalize(payload, date) {
    if (!payload || typeof payload !== 'object') return empty(date);
    var entries = Array.isArray(payload.entries) ? payload.entries.map(normalizeEntry).filter(Boolean) : [];
    return {
      v: VERSION,
      date: isIsoDate(payload.date) ? payload.date : date,
      savedAt: Number(payload.savedAt) || now(),
      entries: entries.slice(-MAX_ENTRIES),
      baselines: payload.baselines && typeof payload.baselines === 'object' ? payload.baselines : {},
      notes: Array.isArray(payload.notes) ? payload.notes.filter(function (n) { return typeof n === 'string'; }).slice(-40) : [],
    };
  }

  /* Keep the newest rows; drop the oldest resolved ones first so an open
   * pending ruling is never evicted by a day of routine reclassifications. */
  function trimEntries(entries) {
    if (entries.length <= MAX_ENTRIES) return entries;
    var keep = entries.slice();
    var over = keep.length - MAX_ENTRIES;
    for (var i = 0; i < keep.length && over > 0; i += 1) {
      if (keep[i].status === 'resolved') { keep.splice(i, 1); i -= 1; over -= 1; }
    }
    while (keep.length > MAX_ENTRIES) keep.shift();
    return keep;
  }

  /* --------------------------------------------------------------- merge */

  function mergePayloads(a, b, date) {
    var base = normalize(a, date);
    var add = normalize(b, date);
    var map = Object.create(null);
    var order = [];

    function take(entry) {
      var key = entryKey(entry);
      if (!key) return;
      if (!map[key]) { map[key] = entry; order.push(key); return; }
      var prev = map[key];
      var merged = Object.assign({}, prev, entry);
      merged.firstSeenAt = Math.min(prev.firstSeenAt || entry.firstSeenAt, entry.firstSeenAt || prev.firstSeenAt);
      merged.firstSeenIso = isoSecond(merged.firstSeenAt);
      merged.lastSeenAt = Math.max(prev.lastSeenAt || 0, entry.lastSeenAt || 0);
      /* The before-side is the historical record: never let a later observation
       * overwrite an earlier one. */
      merged.before = prev.before || entry.before || null;
      merged.after = entry.after || prev.after || null;
      merged.status = prev.status === 'resolved' || entry.status === 'resolved' ? 'resolved'
        : (prev.status === 'unresolved' || entry.status === 'unresolved' ? 'unresolved' : 'open');
      merged.resolvedAt = prev.resolvedAt || entry.resolvedAt || null;
      merged.verified = entry.verified || prev.verified || null;
      var notes = [];
      (prev.notes || []).concat(entry.notes || []).forEach(function (n) {
        if (typeof n === 'string' && notes.indexOf(n) === -1) notes.push(n);
      });
      merged.notes = notes.slice(-MAX_NOTES);
      var obs = (prev.observations || []).concat(entry.observations || []);
      merged.observations = obs.slice(-8);
      var sources = [];
      (prev.sources || []).concat(entry.sources || []).forEach(function (s) {
        if (s && sources.indexOf(s) === -1) sources.push(s);
      });
      merged.sources = sources.slice(0, 12);
      map[key] = merged;
    }

    base.entries.forEach(take);
    add.entries.forEach(take);

    var mergedEntries = order.map(function (k) { return map[k]; })
      .sort(function (x, y) { return (y.lastSeenAt || 0) - (x.lastSeenAt || 0); });

    return {
      v: VERSION,
      date: date || base.date || add.date,
      savedAt: now(),
      entries: trimEntries(mergedEntries.reverse()).reverse(),
      baselines: Object.assign({}, base.baselines, add.baselines),
      notes: base.notes.concat(add.notes).filter(function (n, i, arr) { return arr.indexOf(n) === i; }).slice(-40),
    };
  }

  /* --------------------------------------------------------------- storage */

  function loadLocal(date) {
    if (!isIsoDate(date)) return null;
    var raw = storageGet(PREFIX + date);
    if (!raw) return null;
    try {
      var parsed = JSON.parse(raw);
      if (!parsed || parsed.v !== VERSION) return null;
      return normalize(parsed, date);
    } catch (e) {
      if (global.console && global.console.warn) {
        global.console.warn('[scoring-log] dropping malformed local log for ' + date);
      }
      return null;
    }
  }

  function saveLocal(date, payload) {
    if (!isIsoDate(date)) return false;
    var ok = storageSet(PREFIX + date, JSON.stringify(payload));
    if (ok) {
      var index = readIndex();
      if (index.indexOf(date) === -1) {
        index.push(date);
        writeIndex(index);
      }
    }
    return ok;
  }

  function isStaticHost() {
    var host = (global.location && global.location.hostname) || '';
    return /\.github\.io$/i.test(host);
  }

  function serverFetch(path, opts) {
    return global.fetch(path, Object.assign({ cache: 'no-store', credentials: 'same-origin' }, opts || {}))
      .then(function (res) {
        if (!res.ok) {
          var err = new Error('HTTP ' + res.status);
          err.status = res.status;
          throw err;
        }
        return res.json();
      });
  }

  function loadServer(date) {
    if (isStaticHost()) {
      apiState.checked = true;
      apiState.available = false;
      return Promise.resolve(null);
    }
    if (typeof global.fetch !== 'function') return Promise.resolve(null);
    if (apiState.checked && !apiState.available) return Promise.resolve(null);
    return serverFetch(SERVER_PATH + '?date=' + encodeURIComponent(date))
      .then(function (data) {
        apiState.checked = true;
        apiState.available = true;
        return normalize(data, date);
      })
      .catch(function (err) {
        apiState.checked = true;
        apiState.available = false;
        apiState.lastError = err;
        return null;
      });
  }

  function load(date) {
    var local = loadLocal(date);
    return loadServer(date).then(function (remote) {
      if (!remote) return local || empty(date);
      if (!local) { saveLocal(date, remote); return remote; }
      var merged = mergePayloads(remote, local, date);
      saveLocal(date, merged);
      return merged;
    });
  }

  function postNow(date) {
    var payload = pendingWrites[date];
    if (!payload) return Promise.resolve(null);
    pendingWrites[date] = null;
    if (apiState.checked && !apiState.available) return Promise.resolve(null);
    if (typeof global.fetch !== 'function') return Promise.resolve(null);
    return serverFetch(SERVER_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(function (res) {
      apiState.available = true;
      return res;
    }).catch(function (err) {
      apiState.available = false;
      apiState.lastError = err;
      return null;
    });
  }

  function save(date, payload) {
    var normalized = normalize(payload, date);
    saveLocal(date, normalized);
    pendingWrites[date] = normalized;
    if (writeTimers[date]) return;
    writeTimers[date] = setTimeout(function () {
      writeTimers[date] = null;
      postNow(date);
    }, WRITE_COALESCE_MS);
  }

  /* ------------------------------------------------------------ entry API */

  function findEntry(payload, key) {
    if (!payload || !Array.isArray(payload.entries)) return null;
    for (var i = 0; i < payload.entries.length; i += 1) {
      if (payload.entries[i] && payload.entries[i].id === key) return payload.entries[i];
    }
    return null;
  }

  /**
   * upsert(payload, entry) -> { entry, created }
   *   Merges into the stored row, keeping the first observation as the
   *   record's "before" side.  Mutates `payload`.
   */
  function upsert(payload, entry) {
    if (!payload || !entry) return { entry: null, created: false };
    payload.entries = Array.isArray(payload.entries) ? payload.entries : [];
    var normalized = normalizeEntry(entry);
    if (!normalized) return { entry: null, created: false };
    var existing = findEntry(payload, normalized.id);
    if (!existing) {
      payload.entries.push(normalized);
      payload.savedAt = now();
      return { entry: normalized, created: true };
    }
    var wasOpen = existing.status === 'open';
    var merged = Object.assign({}, existing, normalized);
    merged.firstSeenAt = existing.firstSeenAt || normalized.firstSeenAt;
    merged.firstSeenIso = isoSecond(merged.firstSeenAt);
    merged.firstSeenApiTimeStamp = existing.firstSeenApiTimeStamp || normalized.firstSeenApiTimeStamp;
    merged.firstSeenLatencyMs = Number.isFinite(existing.firstSeenLatencyMs)
      ? existing.firstSeenLatencyMs : normalized.firstSeenLatencyMs;
    merged.before = existing.before || normalized.before || null;
    merged.after = normalized.after || existing.after || null;
    merged.resolvedAt = normalized.resolvedAt || existing.resolvedAt || null;
    if (normalized.status === 'resolved' || (normalized.status === 'unresolved' && wasOpen)) {
      merged.status = normalized.status;
    } else if (existing.status === 'resolved') {
      merged.status = 'resolved';
    } else {
      merged.status = normalized.status || existing.status;
    }
    if (merged.resolvedAt) {
      merged.resolvedIso = isoSecond(merged.resolvedAt);
      merged.resolutionLagMs = merged.firstSeenAt ? Math.max(0, merged.resolvedAt - merged.firstSeenAt) : null;
    }
    var notes = (existing.notes || []).concat(normalized.notes || []).filter(function (n, i, arr) {
      return arr.indexOf(n) === i;
    });
    merged.notes = notes.slice(-MAX_NOTES);
    var obs = (existing.observations || []).concat(normalized.observations || []);
    merged.observations = obs.slice(-8);
    var sources = (existing.sources || []).concat(normalized.sources || []).filter(function (s, i, arr) {
      return s && arr.indexOf(s) === i;
    });
    merged.sources = sources.slice(0, 12);
    merged.verified = normalized.verified || existing.verified || null;
    var idx = payload.entries.indexOf(existing);
    payload.entries[idx] = merged;
    payload.savedAt = now();
    return { entry: merged, created: false };
  }

  function setBaseline(payload, gamePk, atBatIndex, value) {
    if (!payload) return;
    payload.baselines = payload.baselines || {};
    var gk = String(gamePk);
    payload.baselines[gk] = payload.baselines[gk] || {};
    payload.baselines[gk][String(atBatIndex)] = value;
  }

  function getBaseline(payload, gamePk, atBatIndex) {
    if (!payload || !payload.baselines) return null;
    var g = payload.baselines[String(gamePk)];
    if (!g) return null;
    return g[String(atBatIndex)] || null;
  }

  function pruneBaselines(payload, keepAtBatIndexes) {
    if (!payload || !payload.baselines) return;
    var keepSet = Object.create(null);
    (keepAtBatIndexes || []).forEach(function (k) { keepSet[String(k)] = true; });
    Object.keys(payload.baselines).forEach(function (gk) {
      var map = payload.baselines[gk] || {};
      Object.keys(map).forEach(function (ab) {
        if (!keepSet[ab]) delete map[ab];
      });
    });
  }

  /* Quick counts for the section header / the alert feed's summary chip. */
  function summarize(payload) {
    var s = { total: 0, open: 0, resolved: 0, changes: 0, edits: 0, unresolved: 0, pendingResolved: 0 };
    if (!payload || !Array.isArray(payload.entries)) return s;
    payload.entries.forEach(function (e) {
      s.total += 1;
      if (e.kind === 'change') s.changes += 1;
      if (e.kind === 'edit') s.edits += 1;
      if (e.status === 'open') s.open += 1;
      if (e.status === 'unresolved') s.unresolved += 1;
      if (e.status === 'resolved') {
        s.resolved += 1;
        if (e.kind === 'pending') s.pendingResolved += 1;
      }
    });
    return s;
  }

  /* Live push from the optional server (SSE), exactly like the alert feed's
   * stream: another tab's write shows up here without waiting for this tab's
   * own next write.  Absent on static hosting; the local store keeps working. */
  var stream = null;

  function openStream(date) {
    if (typeof global.EventSource !== 'function') return null;
    if (isStaticHost()) return null;
    if (apiState.checked && !apiState.available) return null;
    closeStream();
    try {
      stream = new global.EventSource(SERVER_PATH + '/stream?date=' + encodeURIComponent(date));
    } catch (e) {
      return null;
    }
    stream.addEventListener('scoring-log', function (evt) {
      try {
        var payload = JSON.parse(evt.data);
        apiState.available = true;
        emit(normalize(payload, date));
      } catch (e) {
        if (global.console && global.console.warn) global.console.warn('[scoring-log] ignoring malformed push frame');
      }
    });
    stream.addEventListener('error', function () { apiState.available = false; });
    return stream;
  }

  function closeStream() {
    if (stream) {
      try { stream.close(); } catch (e) { /* ignore */ }
      stream = null;
    }
  }

  function onChange(fn) {
    if (typeof fn === 'function') listeners.push(fn);
  }

  function emit(payload) {
    listeners.forEach(function (fn) {
      try { fn(payload); } catch (e) {
        if (global.console && global.console.warn) global.console.warn('[scoring-log] listener failed', e);
      }
    });
  }

  /* --------------------------------------------------------------- prefs */

  function readPrefs() {
    try {
      var raw = storageGet(PREF_KEY);
      var parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) { return {}; }
  }

  function writePrefs(patch) {
    var next = Object.assign(readPrefs(), patch || {});
    storageSet(PREF_KEY, JSON.stringify(next));
    return next;
  }

  global.ScoringLog = {
    VERSION: VERSION,
    KEEP_DATES: KEEP_DATES,
    MAX_ENTRIES: MAX_ENTRIES,
    empty: empty,
    normalize: normalize,
    normalizeEntry: normalizeEntry,
    mergePayloads: mergePayloads,
    load: load,
    save: save,
    loadLocal: loadLocal,
    saveLocal: saveLocal,
    upsert: upsert,
    findEntry: findEntry,
    setBaseline: setBaseline,
    getBaseline: getBaseline,
    pruneBaselines: pruneBaselines,
    summarize: summarize,
    entryKey: entryKey,
    isoSecond: isoSecond,
    isIsoDate: isIsoDate,
    onChange: onChange,
    emit: emit,
    openStream: openStream,
    closeStream: closeStream,
    readPrefs: readPrefs,
    writePrefs: writePrefs,
    state: apiState,
  };
}(window));
