/* ============================================================================
 * alert-sound.js — the alert sound (one pleasant raindrop, ~3 s, all day long)
 *
 * Why this file exists: the alert sound is heard every time a tracked event
 * lands, all season, for hours at a stretch. A short bright chime is fatiguing
 * at that exposure; a soft rain-droplet figure decays away and can be ignored
 * between alerts without becoming irritating.
 *
 * The sound is synthesised (no audio file to download, cache or license):
 *
 *   0.0 s  soft rain bed fades in   (filtered noise, -32 dBFS, no hiss on top)
 *   0.0 s  droplet 1  ~1.4 kHz plink
 *   0.14 s droplet 2  ~1.1 kHz
 *   0.31 s droplet 3  ~1.6 kHz
 *   0.52 s droplet 4  ~0.85 kHz  ─┐ two droplets bloom into the warm
 *   0.60 s droplet 5  ~1.25 kHz  ─┘ "landing" pair, then everything decays
 *   3.0 s  silence
 *
 * Every droplet is a sine with a fast downward pitch glide (a drip, not a
 * beep), a 20 ms attack and an exponential tail, run through a resonant
 * band-pass so the transient stays round, then through a low-pass at 6 kHz so
 * there is no piercing high end on small laptop speakers. A short damped
 * feedback delay gives the "in a garden" tail without a convolution cost.
 *
 * Contract (also relied on by tools/smoke-test.mjs):
 *   - nothing here throws when WebAudio is missing or blocked; every audio
 *     path is optional and the alert pipeline must never depend on it
 *   - `play()` always records `stats.plays` / `stats.lastPlayAt`, so "did the
 *     alert fire?" is testable without an audio device
 *   - the user's on/off choice is remembered per browser
 * ==========================================================================*/
(function (global) {
  'use strict';

  var PREF_KEY = 'mlbp.pref.sound';
  var DURATION_S = 3.0;
  var COOLDOWN_MS = 1200;      /* two alerts inside this window share one sound */
  var MAX_QUEUE = 3;           /* never stack more than this; extra alerts are
                                * coalesced into the row animation instead       */
  var MASTER_LEVEL = 0.34;     /* deliberately gentle: this plays all season     */

  var stats = {
    plays: 0,
    lastPlayAt: 0,
    lastKind: '',
    suppressed: 0,
    queued: 0,
    engineErrors: 0,
    contextState: 'none',
  };

  var enabled = false;
  var ctx = null;
  var master = null;
  var reverb = null;
  var noiseBuffer = null;
  var queue = [];
  var playing = 0;
  var drainTimer = null;
  var lastPlayAt = 0;
  var listeners = [];

  function now() { return Date.now(); }

  function readPref() {
    try {
      var raw = global.localStorage.getItem(PREF_KEY);
      return raw === null ? false : raw === '1';
    } catch (e) { return false; }
  }

  function writePref(value) {
    try { global.localStorage.setItem(PREF_KEY, value ? '1' : '0'); } catch (e) { /* ignore */ }
  }

  function emit(kind, detail) {
    listeners.forEach(function (fn) {
      try { fn(kind, detail); } catch (e) { /* a listener must never break audio */ }
    });
  }

  function onEvent(fn) {
    if (typeof fn === 'function') listeners.push(fn);
  }

  function AudioCtor() {
    return global.AudioContext || global.webkitAudioContext || null;
  }

  /* ------------------------------------------------------------------ graph */

  function ensureContext() {
    var Ctx = AudioCtor();
    if (!Ctx) return null;
    if (!ctx) {
      try {
        ctx = new Ctx();
      } catch (e) {
        stats.engineErrors += 1;
        return null;
      }
    }
    if (ctx.state === 'suspended' && ctx.resume) {
      try { ctx.resume(); } catch (e) { /* ignore */ }
    }
    stats.contextState = ctx.state || 'unknown';
    if (!master) buildGraph();
    return ctx;
  }

  function buildGraph() {
    if (!ctx) return;
    try {
      master = ctx.createGain();
      master.gain.value = MASTER_LEVEL;

      /* Gentle ceiling so five droplets at once cannot clip. */
      var shaper = ctx.createWaveShaper();
      shaper.curve = softCurve();
      shaper.oversample = '2x';

      var tone = ctx.createBiquadFilter();
      tone.type = 'lowpass';
      tone.frequency.value = 6200;
      tone.Q.value = 0.4;

      master.connect(shaper);
      shaper.connect(tone);
      tone.connect(ctx.destination);

      /* Damped feedback delay = the "open air" tail. Cheap and stable. */
      reverb = ctx.createGain();
      reverb.gain.value = 0.32;
      var delay = ctx.createDelay(1.0);
      delay.delayTime.value = 0.17;
      var damp = ctx.createBiquadFilter();
      damp.type = 'lowpass';
      damp.frequency.value = 2600;
      var feedback = ctx.createGain();
      feedback.gain.value = 0.26;
      reverb.connect(delay);
      delay.connect(damp);
      damp.connect(feedback);
      feedback.connect(delay);
      damp.connect(tone);
    } catch (e) {
      master = null;
      stats.engineErrors += 1;
    }
  }

  function softCurve() {
    var n = 1024;
    var curve = new Float32Array(n);
    for (var i = 0; i < n; i += 1) {
      var x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 1.25) * 0.92;
    }
    return curve;
  }

  function noise() {
    if (noiseBuffer || !ctx) return noiseBuffer;
    try {
      var seconds = 2;
      var len = Math.floor(ctx.sampleRate * seconds);
      noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
      var data = noiseBuffer.getChannelData(0);
      for (var i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
    } catch (e) {
      noiseBuffer = null;
    }
    return noiseBuffer;
  }

  /* --------------------------------------------------------------- elements */

  /* One raindrop: filtered noise transient + a sine "plink" that glides down. */
  function droplet(at, freq, level, decay) {
    if (!ctx || !master) return;

    /* The wet transient: 12 ms of band-passed noise. */
    var buf = noise();
    if (buf) {
      var src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      var bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = freq * 1.7;
      bp.Q.value = 6;
      var nGain = ctx.createGain();
      nGain.gain.setValueAtTime(0.0001, at);
      nGain.gain.exponentialRampToValueAtTime(level * 0.5, at + 0.004);
      nGain.gain.exponentialRampToValueAtTime(0.0001, at + 0.09);
      src.connect(bp); bp.connect(nGain); nGain.connect(master);
      try {
        src.start(at, Math.random() * 1.5);
        src.stop(at + 0.12);
      } catch (e) { /* ignore */ }
    }

    /* The drop itself. */
    var osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, at);
    /* A drip falls in pitch; the glide is short so it reads as a droplet, not
     * a slide whistle. */
    osc.frequency.exponentialRampToValueAtTime(Math.max(120, freq * 0.62), at + decay * 0.85);

    var body = ctx.createBiquadFilter();
    body.type = 'lowpass';
    body.frequency.setValueAtTime(freq * 2.6, at);
    body.frequency.exponentialRampToValueAtTime(Math.max(300, freq * 0.9), at + decay);
    body.Q.value = 1.1;

    var gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(level, at + 0.012);
    gain.gain.exponentialRampToValueAtTime(level * 0.28, at + decay * 0.42);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + decay);

    osc.connect(body);
    body.connect(gain);
    gain.connect(master);
    if (reverb) gain.connect(reverb);

    try {
      osc.start(at);
      osc.stop(at + decay + 0.08);
    } catch (e) { /* ignore */ }
  }

  /* The rain bed: low, slow, filtered noise that keeps the figure from feeling
   * like a bare beep and gives it a natural 3 s envelope. */
  function rainBed(at, seconds, level) {
    if (!ctx || !master) return;
    var buf = noise();
    if (!buf) return;
    var src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1500;
    lp.Q.value = 0.3;
    var hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 380;
    var gain = ctx.createGain();
    var peak = level;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(peak, at + 0.45);
    gain.gain.setValueAtTime(peak, at + seconds * 0.45);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
    src.connect(hp); hp.connect(lp); lp.connect(gain);
    gain.connect(master);
    if (reverb) gain.connect(reverb);
    try {
      src.start(at, Math.random());
      src.stop(at + seconds + 0.05);
    } catch (e) { /* ignore */ }
  }

  /* ---------------------------------------------------------------- render */

  function render(kind) {
    var at = ctx.currentTime + 0.02;

    /* Softer and slightly higher for routine events, fuller for the ones that
     * matter most — same instrument, different touch. */
    var soft = kind === 'abs' || kind === 'state' || kind === 'preview';
    var weight = kind === 'risk' || kind === 'scoring' ? 1.25 : 1;

    rainBed(at, DURATION_S, soft ? 0.012 : 0.02);

    var level = (soft ? 0.16 : 0.24) * weight;
    droplet(at + 0.00, 1420, level, 0.30);
    droplet(at + 0.14, 1100, level * 0.9, 0.34);
    droplet(at + 0.31, 1620, level * 0.82, 0.30);
    droplet(at + 0.52, 880, level * 0.95, 0.52);
    droplet(at + 0.60, 1240, level * 0.72, 0.46);
  }

  /* --------------------------------------------------------------- control */

  function drain() {
    if (drainTimer) return;
    drainTimer = setTimeout(function () {
      drainTimer = null;
      var next = queue.shift();
      if (!next) return;
      fire(next.kind);
      if (queue.length) drain();
    }, COOLDOWN_MS);
  }

  function fire(kind) {
    stats.plays += 1;
    stats.lastPlayAt = now();
    stats.lastKind = kind || 'alert';
    lastPlayAt = stats.lastPlayAt;
    emit('play', { kind: kind || 'alert', at: stats.lastPlayAt });
    var c = ensureContext();
    if (!c) return;
    try {
      render(kind || 'alert');
    } catch (e) {
      stats.engineErrors += 1;
    }
  }

  /**
   * play(kind)
   *   kind is only a tone hint ('review' | 'abs' | 'pending' | 'scoring' |
   *   'risk' | 'state' | 'preview' | 'alert').  Returns true when a sound was
   *   started or queued, false when sound is off or was coalesced.
   */
  function play(kind) {
    if (!enabled) return false;
    if (playing > 0 || queue.length > 0) {
      /* Inside the cooldown: coalesce rather than stack. */
      var since = now() - lastPlayAt;
      if (since < COOLDOWN_MS) { stats.suppressed += 1; return false; }
      if (queue.length >= MAX_QUEUE) { stats.suppressed += 1; return false; }
      queue.push({ kind: kind });
      stats.queued += 1;
      drain();
      return true;
    }
    playing += 1;
    setTimeout(function () { playing = Math.max(0, playing - 1); }, COOLDOWN_MS);
    fire(kind);
    return true;
  }

  function setEnabled(value, opts) {
    var next = !!value;
    var changed = next !== enabled;
    enabled = next;
    writePref(enabled);
    if (enabled) {
      ensureContext();
      if (changed && !(opts && opts.silent)) play('preview');
    }
    emit('toggle', { enabled: enabled });
    return enabled;
  }

  function isEnabled() { return enabled; }

  /* Manual test: always audible (even if the user just switched sound off we
   * still want to prove the browser can make a sound) and always counted. */
  function test() {
    ensureContext();
    playing = 0;
    queue = [];
    fire('preview');
    return stats.lastPlayAt;
  }

  function unlock() {
    /* Browsers start the context suspended until a gesture. */
    ensureContext();
  }

  function init() {
    enabled = readPref();
    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('pointerdown', unlock, { once: true, passive: true });
      document.addEventListener('keydown', unlock, { once: true });
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden && enabled) ensureContext();
      });
    }
    return enabled;
  }

  global.AlertSound = {
    init: init,
    play: play,
    test: test,
    unlock: unlock,
    setEnabled: setEnabled,
    isEnabled: isEnabled,
    onEvent: onEvent,
    stats: stats,
    DURATION_S: DURATION_S,
    COOLDOWN_MS: COOLDOWN_MS,
    MASTER_LEVEL: MASTER_LEVEL,
  };
}(window));
