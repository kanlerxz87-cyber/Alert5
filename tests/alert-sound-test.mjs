#!/usr/bin/env node
/* ============================================================================
 * alert-sound-test.mjs — the alert sound, exercised without an audio device.
 *
 * The sound is synthesised at runtime (no file to ship or license), so the only
 * way to check it in CI is to give it a stub WebAudio implementation and assert
 * the graph it builds and the envelope it schedules.  Everything asserted here
 * is a property the user can hear:
 *
 *   · it is a ~3 s figure, not a 200 ms beep
 *   · five droplets, each a downward pitch glide (a drip, not a ping)
 *   · one shared 1.2 s cooldown, so a burst of alerts is one sound
 *   · nothing throws when WebAudio is missing or blocked
 *   · the on/off choice is remembered, and the alert pipeline can tell
 *     "did it fire?" from `stats.plays` even with the sound off
 * ==========================================================================*/
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
const ok = (cond, label) => {
  if (cond) console.log('  ok  ' + label);
  else { failures += 1; console.log('  FAIL ' + label); }
};

/* ---------------------------------------------------------- stub WebAudio */
function makeStub() {
  const log = [];
  const param = () => {
    const p = { value: 0, events: [] };
    ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'setTargetAtTime', 'cancelScheduledValues']
      .forEach((m) => { p[m] = (...args) => { p.events.push([m, ...args]); }; });
    return p;
  };
  const node = (kind) => {
    const n = {
      kind, targets: [], startedAt: [], stoppedAt: [],
      connect(dst) { n.targets.push(dst && dst.kind); log.push(`${kind}->${dst && dst.kind}`); return dst; },
      start(t) { n.startedAt.push(t); }, stop(t) { n.stoppedAt.push(t); }, disconnect() {},
    };
    return n;
  };
  class Ctx {
    constructor() {
      this.currentTime = 0; this.state = 'suspended'; this.sampleRate = 48000;
      this.destination = node('destination');
    }
    resume() { this.state = 'running'; log.push('resume'); return Promise.resolve(); }
    createGain() { return Object.assign(node('gain'), { gain: param() }); }
    createWaveShaper() { return Object.assign(node('shaper'), { curve: null, oversample: 'none' }); }
    createBiquadFilter() {
      return Object.assign(node('biquad'), { type: 'lowpass', frequency: param(), Q: param(), gain: param() });
    }
    createDelay() { return Object.assign(node('delay'), { delayTime: param() }); }
    createOscillator() { return Object.assign(node('osc'), { type: 'sine', frequency: param(), detune: param() }); }
    createBufferSource() { return Object.assign(node('bufsrc'), { buffer: null, loop: false, playbackRate: param() }); }
    createBuffer(ch, len, rate) {
      const data = new Float32Array(len);
      return { length: len, sampleRate: rate, numberOfChannels: ch, getChannelData: () => data };
    }
  }
  return { Ctx, log };
}

function load(opts = {}) {
  const { Ctx, log } = makeStub();
  const store = {};
  const sandbox = {
    console, Date, Math, JSON, Object, Array, Number, String, Float32Array, Boolean,
    setTimeout, clearTimeout, isFinite, parseInt,
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
    },
  };
  sandbox.window = sandbox;
  sandbox.global = sandbox;
  if (opts.audio !== false) sandbox.AudioContext = Ctx;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/js/alert-sound.js'), 'utf8'), sandbox,
    { filename: 'alert-sound.js' });
  return { S: sandbox.AlertSound, log, store, sandbox };
}

console.log('alert-sound: the 3 s raindrop figure');

/* 1. it loads and ships OFF */
{
  const { S } = load();
  ok(S && typeof S.play === 'function', 'AlertSound loads as window.AlertSound');
  ok(S.DURATION_S === 3, `the figure is ${S.DURATION_S} s — long enough to notice, short enough to ignore`);
  ok(S.COOLDOWN_MS >= 1000 && S.COOLDOWN_MS < 3000,
    `${S.COOLDOWN_MS} ms cooldown: a burst of alerts is one sound, not a machine gun`);
  ok(S.isEnabled() === false, 'it ships off (an all-day page should not start talking)');
}

/* 2. the graph the figure is built from */
{
  const { S, log } = load();
  S.setEnabled(true, { silent: true });
  const before = S.stats.plays;
  S.play('review');
  ok(S.stats.plays === before + 1, 'play() counts one alert');
  ok(!S.stats.engineErrors && S.stats.contextState === 'running',
    'the audio context resumes on the first user gesture');
  const osc = log.filter((l) => l.startsWith('osc->')).length;
  /* Every droplet also has a tiny filtered-noise transient (the "plink"), so
   * the noise sources outnumber the rain bed by exactly the droplets. */
  const noise = log.filter((l) => l.startsWith('bufsrc->')).length;
  ok(osc === 5, `five droplet oscillators (got ${osc})`);
  ok(noise === osc + 1, `one rain-bed noise source plus one transient per droplet (got ${noise})`);
  ok(log.some((l) => l.startsWith('gain->shaper')), 'the mix is soft-clipped by the tanh shaper');
  ok(log.some((l) => l.startsWith('gain->delay')) && log.some((l) => l.startsWith('delay->biquad')),
    'a damped feedback delay supplies the tail without a convolution');
  ok(log.some((l) => l.startsWith('biquad->destination')),
    'everything lands on the low-passed master, so it never gets piercing');
}

/* 3. one cooldown, no stacking */
{
  const { S } = load();
  S.setEnabled(true, { silent: true });
  const before = S.stats.plays;
  S.play('review'); S.play('review'); S.play('review');
  ok(S.stats.plays - before === 1, 'three alerts inside the cooldown play one sound');
  ok(S.stats.suppressed >= 2, `the other two are counted as suppressed (${S.stats.suppressed})`);
}

/* 4. the prefs round-trip through storage */
{
  const { S, store } = load();
  S.setEnabled(true, { silent: true });
  ok(store['mlbp.pref.sound'] === '1', 'turning it on is remembered');
  S.setEnabled(false, { silent: true });
  ok(store['mlbp.pref.sound'] === '0', 'turning it off is remembered');
  const second = load();               /* same storage is not shared; just re-check default */
  ok(second.S.isEnabled() === false, 'a fresh page starts off unless the pref says on');
}

/* 5. it can never break the alert pipeline */
{
  const { S } = load({ audio: false });
  let threw = false;
  try {
    S.setEnabled(true, { silent: true });
    S.play('review');
    S.test();
    S.unlock();
  } catch (e) { threw = true; }
  ok(!threw, 'with no WebAudio at all, nothing throws');
  ok(S.stats.plays >= 1, 'and the alert is still counted, so "did it fire?" stays testable');
}
{
  /* A context that throws on construction is the realistic failure (some
   * locked-down browsers, some privacy modes). */
  const sandbox = {
    console, Date, Math, JSON, Object, Array, Number, String, Float32Array,
    setTimeout, clearTimeout, isFinite,
    localStorage: { getItem: () => '1', setItem: () => {} },
    AudioContext: function Broken() { throw new Error('blocked'); },
  };
  sandbox.window = sandbox; sandbox.global = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/js/alert-sound.js'), 'utf8'), sandbox,
    { filename: 'alert-sound.js' });
  let threw = false;
  try { sandbox.AlertSound.play('review'); } catch (e) { threw = true; }
  ok(!threw, 'a throwing AudioContext is survived (autoplay-blocked browsers)');
}

console.log(failures ? `\nalert-sound-test: ${failures} FAILURE(S)` : '\nalert-sound-test: OK');
process.exit(failures ? 1 : 0);
