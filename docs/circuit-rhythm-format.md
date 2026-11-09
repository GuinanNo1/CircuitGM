# Circuit Rhythm project format (.ncs inside a .circuitrhythmpack)

Worked out on 2026-11-07 for Circuit2MIDI, by comparing a hardware-saved project ("TEARDROP Final", project 0 "User Session") with the empty template Components writes into unused slots. Nothing public documented it at the time. The layout follows the Circuit Tracks `.ncs` closely: the header, timing bytes, scene table and pattern settings are the same; the step and track data differ because every Rhythm track is a sample track.

Confidence: **confirmed** means the values in the test project make sense against what it plays (tempo, sample names, chains); **unconfirmed** means it is a reading of the bytes not yet checked on hardware.

## Pack (`.circuitrhythmpack`)

A zip, as for the Circuit Tracks, written by Components with deflate compression.

- `index.json`: `name`, `color`, `product: "circuit-rhythm"`, `version: "2.0"`, `projects` (64 × `{name, url}`), `samples` (128 × `{name, url}`), `gridEffects` (16 × `{effectType, url}`).
- `projects/project_N.ncs` (64 files, 169092 bytes each).
- `samples/sample_N.wav`: only the slots that hold a sample. An empty slot keeps its `index.json` entry, with a blank name and a `url` to a file that is not in the zip.
- `grid_effects/grid_effect_N.grideffect` (16 files, 7 bytes in the test pack: `effectType` then zeros).

## Project file (169092 bytes)

| Offset | Size | Content | Status |
|---|---|---|---|
| 0x00 | 4 | Magic: `RUSE` for a hardware-saved project, `INIT` for Components' empty slot (the rest of an `INIT` file is zero) | confirmed |
| 0x04 | 4 | File size, u32 LE (0x29484) | confirmed |
| 0x08 | 4 | 1 | |
| 0x0C | 4 | Project colour, u32 LE (same table as the Tracks) | likely |
| 0x10 | 32 | Name, ASCII, space padded | confirmed |
| 0x34 | 1 | Tempo, BPM | confirmed |
| 0x35 | 1 | Swing (50 = none) | confirmed |
| 0x36 | 1 | Swing sync rate | as Tracks |
| 0x38 | 16 × 40 | Scenes | confirmed |
| 0x2C0 | 4 | Scene chain `[start, end, 0, 0]` (the chain playing when saved) | confirmed |
| 0x2C4 | 8 × 4 | Pattern chains, tracks 1-8 (the live selection) | confirmed |
| 0x2E4 | 64 × 2600 | Pattern blocks | confirmed |
| 0x28CE4 | 1952 | Tail: track settings, mixer, FX | partly |

### Scenes (0x38, 16 × 40 bytes)

- Byte 0: used flag (1 = a scene with something saved). Scene 1's byte 0 is the timing section's spare byte and stays 0, as on the Tracks.
- Byte 1: **a per-track bit mask (bit t = track t+1), meaning unconfirmed.** In the test project, scene 2 has tracks 3, 4 and 7 set, scenes 3-5 track 7, and scene 8 tracks 3 and 4. It may mute those tracks in that scene. Circuit2MIDI offers it as an option, off by default.
- Bytes 2-7: 0.
- Bytes 8-39: 8 chain entries `[start pattern, end pattern, 0, 0]`, tracks 1-8, patterns numbered from 0.

### Pattern blocks (0x2E4, 64 × 2600 bytes)

Block index = track × 8 + pattern (track 0-7, pattern 0-7). Each block:

| Offset | Size | Content |
|---|---|---|
| 0 | 32 × 8 | Steps |
| 256 | 40 | Settings: `[end step, start step, sync rate, direction, 0…]` |
| 296 | 2304 | Automation (parameter locks); 0xFF = no lock. Not decoded. |

A step is 8 bytes:

| Byte | Content | Empty step |
|---|---|---|
| 0 | Note: MIDI note + 12. A sample at its own pitch is 72 (MIDI 60) | 0 |
| 1 | Gate in micro-steps (6 per step) | 6 |
| 2 | Micro-step mask: bit m = a hit at micro-step m (1 = on the beat, 9 = micro-steps 0 and 3) | 0 |
| 3 | Velocity | 0 |
| 4 | Probability (7 = always) | 7 |
| 5 | Sample slot for this step (sample flip); 0xFF = the track's default sample | 0xFF |
| 6-7 | 0 | 0 |

Sync rates seen: 3 (1/16), 5 (1/8), 7 (1/4), with the same meaning as on the Tracks. Values 0-2, 4 and 6 are assumed to be 1/32T, 1/32, 1/16T, 1/8T and 1/4T, which is not yet confirmed. Direction is as on the Tracks: 0 forward, 1 reverse, 2 ping-pong, 3 random.

### Tail (0x28CE4)

| Offset | Content | Status |
|---|---|---|
| +0 | 8 bytes, 1 for tracks 1-7 and 0 for track 8 in the test project | unknown |
| +8 | 8 bytes: default sample slot per track | confirmed (matches each track's steps and sample names) |
| +16 | 8 bytes, mostly 72 (0x48): probably the last note played per track | unknown |
| +44 | 8 × 41 bytes: per-track settings (levels 0x7F, pans 0x40 and similar) | not decoded |
| +440 | 128 × 4 bytes `[0xFF, 3, 0, n]`: probably per-sample settings | not decoded |

Everything after that (FX and mixer) is not decoded.

## What counts as a used sample

For compacting: each track's default sample (tail +8), plus every step's sample byte that isn't 0xFF, in all 64 blocks of every project whose magic is `RUSE`. Slots stay at their numbers, so the projects need no changes.
