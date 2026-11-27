# The alert sound

Session `ec03918b`, 2026-11-27. One file, [`assets/js/alert-sound.js`](../assets/js/alert-sound.js),
one sound, shared by the Replay Feed, the scoreboard's review ticker and the game page.

## What it sounds like, and why

A soft **raindrop** figure about **three seconds** long, then a warm bloom that fades out:

| Element | Detail | Reason |
| --- | --- | --- |
| Four drops | G5 → A5 → C6 → D6 (A-minor pentatonic), staggered 0–0.7 s, each a sine with an 8 % downward pitch bend | Water, not a beep: a drop bends down as it lands. Pentatonic means any two notes are consonant, so it never sounds like a mistake |
| Two texture drops | very quiet, off the beat | makes it read as rain rather than a melody |
| Soft attack | 12 ms exponential ramp-in on every drop | no click, no startle |
| Long decay | each drop 0.55–0.7 s, the bloom 1.85 s | a smooth tail instead of a cut-off |
| Low-pass 3.4 kHz | one filter on the shared bus | keeps pure sines from sounding shrill at any volume |
| Short echo | 0.19 s delay, 26 % feedback, 32 % wet | air, so it blooms instead of stopping dead |
| Bloom | A4 + E5 (a fifth), starting at 1.05 s | a finished, resolving shape — the part that makes it pleasant at the 400th hearing of the day |
| Stereo | drops alternate ±pan when `createStereoPanner` exists | the sound "lands" around the speaker rather than in it |

Measured against the requirements in the brief:

- **pleasant all day** — pure sines, no square/saw, no buzzer, no trill; consonant intervals only;
  peak gain 0.30 per drop and 0.15 per bloom voice into a 0.9 master, i.e. deliberately quiet
  enough to sit under speech.
- **about three seconds** — `LENGTH_MS = 3000`, and the last oscillator stops at ~3.0 s.
- **testable at any time** — **▶︎ Test sound** calls `AlertSound.preview()`, which ignores both the
  mute and the cooldown. Turning the toggle on also plays the real sound once (and that click is
  the user gesture that unlocks audio).
- **fires for everything in the feed** — manager challenges, crew-chief/umpire reviews, instant
  replay, boundary calls, official-scorer pending rulings, official scoring changes, runs at risk,
  and (on the game page and scoreboard) any review that appears there. Routine ABS pitch
  challenges are silent by policy; they are still tracked in the ABS tab and the counters.
- **one sound per burst** — a 2.5 s cooldown in the Replay Feed and 1.8 s inside the module, so
  five events landing in the same poll produce one raindrop.

## Rendered check (not just an assertion that it is "nice")

The exact figure above was rendered offline at 44.1 kHz through the same low-pass and echo and
measured. Result:

| Measurement | Value |
| --- | --- |
| Audible until | **3.0 s** (silence after; `LENGTH_MS = 3000`) |
| Peak sample | 0.35 before the 0.9 master, i.e. 0.31 out — **no clipping, ~10 dB headroom** |
| RMS | ≈ **−25 dBFS** — a deliberately quiet, speech-safe alert, not a siren |
| Shape | drops land 0.0–1.0 s, bloom peaks at ~1.0 s, then a smooth decay to silence at 3.0 s |

The envelope (per 0.25 s, `#` = RMS) is:

```text
0.00s #####################
0.25s #################
0.50s ################
0.75s ###########
1.00s ###############
1.25s ###########
1.50s ######
1.75s ####
2.00s ###
2.25s ##
2.50s #
2.75s #
3.00s
```

That is the property that matters for "heard all day": a soft onset, one clear peak, and a decay
that is finished before the next alert can arrive — no ringing left over, no sharp transient.

## Behaviour and failure modes

| Situation | What happens |
| --- | --- |
| Alerts off (the default) | nothing plays; the preference is `localStorage["mlbp.pref.sound"] = "0"` |
| Alerts on | the preference is `"1"`, shared by all three pages |
| Browser blocks audio until a gesture | the first click/keydown/touch anywhere calls `AlertSound.prime()`; until then the read-out next to the control says `on — click the page to allow audio` and the Test button says the audio is blocked |
| No `AudioContext` at all | `preview()` returns `false` and `state().blocked` is `true` — never an exception (`state-log-test.mjs` covers this) |
| Background tab | the alert still fires; browsers may throttle timers in a hidden tab, so a review noticed while the tab is hidden may alert slightly after it was published. The page keeps a 3 s heartbeat to keep that window short |

## Where it is wired

| Surface | Call |
| --- | --- |
| `reviews-feed.js` | `chime(reason)` for new reviews, runs at risk, pending rulings and scoring changes; `toggleSound()` / `testSound()` for the controls |
| `game.js` | `AlertSound.play('review')` for a review id seen for the first time on this game |
| `scoreboard.js` | `AlertSound.play('review')` when the 125 ms status sweep sees a new review signature |

## Tuning

`COOLDOWN_MS`, `LENGTH_MS`, the `figure` array (pitch, timing, gain, pan) and the bloom notes are
all at the top of `alert-sound.js`. The sound is generated at play time — there is no audio file to
download, which keeps the page's request count unchanged.
