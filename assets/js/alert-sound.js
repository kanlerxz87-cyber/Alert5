/* ============================================================================
 * alert-sound.js — the alert sound, in one place
 *
 * Requirements it is built to meet:
 *   - pleasant enough to hear all season, all day: no square/saw waves, no
 *     buzzer, no hard attacks. Soft sine "raindrops" in a pentatonic scale with
 *     a gentle low-pass, a long decay tail and a short stereo bloom — the same
 *     sound a rain stick makes, not a beep.
 *   - about three seconds long, and every one is the same shape, so it is
 *     recognisable across a room without being startling.
 *   - one audio graph for the whole page and a hard cooldown, so five events
 *     in one poll produce one sound rather than five overlapping blips.
 *   - always previewable: `AlertSound.preview()` plays the exact same sound on
 *     a button press, so the alert path can be tested without waiting for a
 *     real challenge.
 *   - never a failure path: no AudioContext, blocked autoplay, or a suspended
 *     context degrades to a documented "audio blocked" state instead of an
 *     exception.
 *
 * Public API
 *   AlertSound.play(reason)      -> boolean  (false when muted / cooling down)
 *   AlertSound.preview()         -> boolean  (ignores the mute + cooldown)
 *   AlertSound.setEnabled(bool)  -> persists the preference
 *   AlertSound.isEnabled()       -> boolean
 *   AlertSound.prime()           -> call from a user gesture (click/keydown)
 *   AlertSound.state()           -> { enabled, contextState, blocked, played }
 * ==========================================================================*/
(function (global) {
  'use strict';

  var PREF_KEY = 'mlbp.pref.sound';
  var COOLDOWN_MS = 1800;        /* one alert sound per event burst */
  var LENGTH_MS = 3000;          /* the promised ~3 second raindrop */

  var ctx = null;
  var master = null;
  var enabled = loadPref();
  var lastPlayedAt = 0;
  var primed = false;
  var blocked = false;
  var played = 0;
  var lastError = null;

  function loadPref() {
    try {
      var raw = global.localStorage.getItem(PREF_KEY);
      return raw === null ? false : raw === '1';
    } catch (e) { return false; }
  }

  function savePref(value) {
    try { global.localStorage.setItem(PREF_KEY, value ? '1' : '0'); } catch (e) { /* ignore */ }
  }

  function AudioCtx() {
    return global.AudioContext || global.webkitAudioContext || null;
  }

  /* Build the shared graph once: master gain -> gentle low-pass -> destination,
   * plus one short feedback delay used as a "room" for the drops. */
  function ensureContext() {
    var Ctor = AudioCtx();
    if (!Ctor) { blocked = true; return null; }
    if (ctx) return ctx;
    try {
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = 0.9;

      var lowpass = ctx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = 3400;   /* keeps sines soft, never shrill */
      lowpass.Q.value = 0.4;

      master.connect(lowpass);
      lowpass.connect(ctx.destination);

      /* the tail: a quiet short echo so a drop blooms instead of stopping dead */
      var delay = ctx.createDelay(0.5);
      delay.delayTime.value = 0.19;
      var feedback = ctx.createGain();
      feedback.gain.value = 0.26;
      var wet = ctx.createGain();
      wet.gain.value = 0.32;
      lowpass.connect(delay);
      delay.connect(feedback);
      feedback.connect(delay);
      delay.connect(wet);
      wet.connect(ctx.destination);
    } catch (e) {
      lastError = e;
      blocked = true;
      return null;
    }
    return ctx;
  }

  /* One water drop: a sine that falls slightly in pitch with a soft attack and
   * an exponential decay. `gain` keeps the mix balanced at low volume. */
  function drop(at, freq, dur, gain, pan) {
    var osc = ctx.createOscillator();
    var env = ctx.createGain();
    var panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, at);
    /* a drop lands with a small downward bend — 8% over its length */
    osc.frequency.exponentialRampToValueAtTime(Math.max(60, freq * 0.92), at + dur);

    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(gain, at + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, at + dur);

    osc.connect(env);
    if (panner) {
      panner.pan.value = pan || 0;
      env.connect(panner);
      panner.connect(master);
    } else {
      env.connect(master);
    }
    osc.start(at);
    osc.stop(at + dur + 0.05);
  }

  /* The sound itself: drops landing on a soft pentatonic figure, then a warm
   * two-note bloom that rings out to ~3 s. Deterministic — the same alert sound
   * every time, so it stays recognisable. */
  function render(kind) {
    if (!ensureContext()) return false;
    if (ctx.state === 'suspended' && ctx.resume) {
      ctx.resume().catch(function () { /* still blocked; documented in state() */ });
    }
    var t0 = ctx.currentTime + 0.02;

    /* Landed drops (A minor pentatonic: A C D E G). Rises slightly in pitch —
     * a question being answered, not a siren. */
    var figure = [
      { at: 0.00, freq: 784.0, dur: 0.55, gain: 0.30, pan: -0.35 },  /* G5 */
      { at: 0.18, freq: 880.0, dur: 0.60, gain: 0.26, pan: 0.30 },   /* A5 */
      { at: 0.42, freq: 1046.5, dur: 0.65, gain: 0.24, pan: -0.15 }, /* C6 */
      { at: 0.68, freq: 1174.7, dur: 0.70, gain: 0.20, pan: 0.25 },  /* D6 */
    ];
    figure.forEach(function (d) { drop(t0 + d.at, d.freq, d.dur, d.gain, d.pan); });

    /* Soft water texture: two much quieter drops just off the beat. */
    drop(t0 + 0.30, 1568.0, 0.30, 0.06, 0.5);
    drop(t0 + 0.86, 1396.9, 0.34, 0.05, -0.5);

    /* The bloom: a fifth (A4 + E5) that fades over the last ~1.8 s. This is
     * what makes it feel finished instead of cut off. */
    var bloomAt = t0 + 1.05;
    var blooms = [
      { freq: 440.0, gain: 0.15 },
      { freq: 659.3, gain: 0.10 },
    ];
    blooms.forEach(function (b, i) {
      var osc = ctx.createOscillator();
      var env = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(b.freq, bloomAt);
      env.gain.setValueAtTime(0.0001, bloomAt);
      env.gain.exponentialRampToValueAtTime(b.gain, bloomAt + (0.16 + i * 0.05));
      env.gain.exponentialRampToValueAtTime(0.0001, bloomAt + 1.85);
      osc.connect(env);
      env.connect(master);
      osc.start(bloomAt);
      osc.stop(bloomAt + 1.95);
    });

    return true;
  }

  function state() {
    return {
      enabled: enabled,
      contextState: ctx ? ctx.state : 'none',
      blocked: blocked,
      primed: primed,
      played: played,
      lengthMs: LENGTH_MS,
      cooldownMs: COOLDOWN_MS,
      lastPlayedAt: lastPlayedAt,
      lastError: lastError ? String(lastError.message || lastError) : null,
    };
  }

  function setEnabled(value) {
    enabled = value === undefined ? !enabled : !!value;
    savePref(enabled);
    if (enabled) {
      /* Turning the alert on plays the real sound once: that is the test the
       * operator needs (and it unlocks the AudioContext while the click is
       * still a user gesture). */
      preview();
    }
    return enabled;
  }

  function isEnabled() { return enabled; }

  /**
   * The alert path. Muted, or still cooling down -> false, silently.
   * `opts.force` skips the module's own cooldown for a caller that keeps its
   * own (the Replay Feed does, per event burst) — the mute can never be
   * overridden, so force can never make a muted page audible.
   */
  function play(reason, opts) {
    if (!enabled) return false;
    var now = Date.now();
    if (!(opts && opts.force) && now - lastPlayedAt < COOLDOWN_MS) return false;
    var ok = render(reason || 'alert');
    if (ok) {
      lastPlayedAt = now;
      played += 1;
      blocked = false;
    }
    return ok;
  }

  /** The test path: ignores mute + cooldown so the toggle can be verified. */
  function preview() {
    var ok = render('preview');
    if (ok) {
      lastPlayedAt = Date.now();
      played += 1;
      blocked = false;
    }
    return ok;
  }

  /** Call from any user gesture; harmless if called repeatedly. */
  function prime() {
    if (primed) return true;
    var c = ensureContext();
    if (!c) return false;
    primed = true;
    if (c.state === 'suspended' && c.resume) c.resume().catch(function () { /* ignore */ });
    return true;
  }

  global.AlertSound = {
    play: play,
    preview: preview,
    prime: prime,
    setEnabled: setEnabled,
    isEnabled: isEnabled,
    state: state,
    PREF_KEY: PREF_KEY,
    COOLDOWN_MS: COOLDOWN_MS,
    LENGTH_MS: LENGTH_MS,
  };
}(window));
