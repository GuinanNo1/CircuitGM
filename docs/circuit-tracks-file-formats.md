# Circuit Tracks file formats — key facts for the converter/pack builder (researched 2026-11-04)

## .circuittrackspack (CONFIRMED against real packs "Born Slippy DL" and "I Feel Love DL", 2026-11-04)
- ZIP (DEFLATE), with directory entries projects/, samples/, patches/. Entries: index.json, projects/project_N.ncs, patches/patch_N.syx, samples/sample_N.wav.
- index.json top level: {"name", "color" (e.g. "orange", "red"), "product": "circuit-tracks", "version": "2.0", "projects"[64], "samples"[64], "patches"[128]}. Each entry {name, url}; array position = slot. Empty slots still listed (projects name "", patches "Initial Patch", samples "") but have NO file in the ZIP.
- Patch slots per pack = 128 (not 64).
- patch_N.syx = single 350-byte "Replace Current Patch" message: F0 00 20 29 01 64 00 00 00 <340> F7.
- Projects reference patches/samples by slot index only — reorder => remap. Projects can reference EMPTY patch and sample slots (seen: patch slots 6, 32, 40, 121, 127; sample slots 2, 4, 5, 8, 10, 11, 28, 50).
- The 340-byte patch embedded in .ncs (0x26D14 / 0x26E68) is the project's own working copy. It CAN differ from the pack .syx it points at (I Feel Love: edited Moroder Strings; projects pointing at empty "Initial Patch" slots still embed real patches like "Epic Trance Poly"). In Born Slippy they were identical. The embedded copy is what the project actually plays; extract both when harvesting presets. Builder: write the patch into both places unless deliberately diverging.
- Example pack total sample time 189.6 s (near 196.6 s cap).

## SD card (Novation-documented)
Tracks/0<N> <Pack name>/{meta (empty), Patches (8 "hexbanks" = 128 patches, undocumented format), PCM (00_Name.wav, 0..63), Sessions (.ncs 0..63)}. FAT32.

## .ncs (reverse-engineered: namirsab/circuit-tracks-tools docs/ncs-format.md; Ondrysak/ncstool FORMAT_MAP.md + ncs.ksy)
- 160,780 bytes fixed, magic "USER", little-endian.
- Header: 0x08 uint32 = 1; 0x0C uint32 = project colour 0-13 (CONFIRMED: 11 and 8 in example, not name length); 0x10 name 32B space-padded (16-char names seen, so the "<=13" limit is wrong); 0x30 4B zero.
- Timing @0x34 (CONFIRMED): 0x34 tempo (1 byte, whole BPM 40-240), 0x35 swing (50 = none), 0x36 swing sync rate, 0x37 spare.
- Scenes @0x38 (CONFIRMED layout): 16 x 40 B. Each = 8-byte header (byte0 = "scene stored" flag; byte1 varies 0x03/0x0C/0x0F/0x7C/0x83/0xDC/0xFC — UNKNOWN, possibly a track mask) + 8 x 4-byte chain entries [start, end, 0, 0] (0-based pattern numbers) in track order S1, S2, M1, M2, D1, D2, D3, D4.
- 0x2B8 scene state 8 B (unknown); 0x2C0 scene chain [first scene, last scene, 0, 0] = song order (0-based, plays scenes first..last); 0x2C4 current pattern chains, 8 x 4 B (what plays when no scene is selected; equals the last scene loaded).
- Mixer is project-wide, NOT stored per scene: levels/pans/sends/FX/sidechain in tail. Scenes only hold pattern ranges.
- 0x2E4 synth patterns 2x8x3240; 0xCD64 synth track info, 8B per synth, byte0 = patch slot 0-127; 0xCD74 drum patterns 4x8x1704 (planes velocity/prob/choice/rhythm at 0xCD74/94/B4/D4, stride track 0x3540 pattern 0x6A8; choice 0xFF = track default); 0x1A274 drum mutes; 0x1A278 default drum choices (sample slot per drum track); 0x1A27C MIDI patterns (same 28-byte step format as synth; empty in example); 0x26CFC MIDI track info; 0x26D0C scale root/type, delay/reverb preset; 0x26D14 Synth1 patch 340B; 0x26E68 Synth2 patch; 0x26FBC drum configs (11B each, byte1 level, byte6 pan, byte8/9 sends), reverb sends @0x26FE8 (8 tracks), reverb params @0x26FF0, delay sends @0x26FF8, delay params @0x27000, FX bypass @0x27007, sidechain @0x27008, levels S1,S2,M1,M2 @0x2701C, pans @0x27020; 0x27024 1000B zero pad.
- Pattern block address: settings_offset = step_start + 896 (synth/MIDI) ; synth block = 0x2E4 + track*0x6540 + pattern*0xCA8.
- OPEN: drum config byte0 (0x26FBC + 11*t) does NOT always match default drum choices (0x1A278): mismatched in Born Slippy ([16,23,37,4] vs [16,22,58,57]) and I Feel Love projects 0/62/63, matched in I Feel Love's "User Session" projects. Which one the unit loads as the track's sample is unconfirmed.
- Synth step 28B: mask, probability(0-7), 2 reserved, 6x{note(+12 vs MIDI), gate(ticks, 6/step, bit7 tie), delay 0-5, velocity}. Pattern settings 40B: end, start, syncRate (reversed, 3=1/16, 5=1/8), direction.

### Added 2026-11-06 (while building the converter)
- Byte 0x38 is the timing section's spare byte as far as Components' validator is concerned, and must be 0. Every hardware-saved project has 0 there; scene "used" flags (1) appear from the second scene block onwards.
- Validator ranges for active synth/MIDI notes: note number 1-139, gate 1-224 (so a tied gate tops out at 0x80 | 96), delay 0-5, velocity 0-127. A drum step's velocity and rhythm mask must be both zero or both non-zero.
- Scale type 15 = Chromatic; stored note = MIDI note + 12 when the scale is chromatic with root C. **More generally, stored note = MIDI note + 12 - scale root** (any scale type): Blue Monday (root D = 2, type 2) stores its F-C-D bassline as 39/34/36, i.e. D#-A#-C read with root C. Found 2026-11-15 when its converted melodies were a whole tone flat against its sampled stabs; js/song.js now adds the root.

## Effects and sidechain (CONFIRMED 2026-11-16 from Ian's Circuit_FX_test save)

Ian saved one project per preset on the Circuit Tracks: projects 1–16 = Delay 1–16, 17–24 = Reverb 1–8, 25 = sidechain off, 26–32 = sidechain presets 1–7. `tests/m2c_fx.mjs <pack>` checks MIDI2Circuit's output against it byte for byte. Names and ranges are from the Programmer's Reference v3 (project control, MIDI channel 16).

| Offset | Meaning |
|---|---|
| 0x26D0E (tail +18) | delay preset, 0–15 |
| 0x26D0F (tail +19) | reverb preset, 0–7 |
| 0x26FE8 (tail +748) | reverb sends, 8 bytes: **Synth 1, Synth 2, Drum 1, Drum 2, Drum 3, Drum 4**, then 2 bytes never set in any save (most likely MIDI 1, 2). **Confirmed on the hardware 16 Nov 2026** (a MIDI2Circuit 0.11 pack with rising reverb and falling delay sends showed both in the right direction on the Tracks). First found from 12 hardware-saved song projects: bytes 3–4 are often set although no song uses the MIDI tracks, and bytes 7–8 never are although Drum 3–4 play. The drum configs' bytes 8/9 (0x26FBC + 11·t) were 0 in every save. |
| 0x26FF0 (tail +756) | reverb values: type (0–5: Chamber, Small Room, Large Room, Small Hall, Large Hall, Great Hall), decay, damping |
| 0x26FF8 (tail +764) | delay sends, 8 bytes, same order as the reverb sends |
| 0x27000 (tail +772) | delay values: time, time sync (0–35), feedback, width, left-right ratio (0–12), slew rate |
| 0x27007 (tail +779) | FX bypass (1 = FX off) |
| 0x27008 (tail +780) | sidechain, 4 × 5 bytes for Synth 1, Synth 2, MIDI 1, MIDI 2: **source** (0–3 = Drum 1–4, 4 = off), **attack, hold, decay, depth**. Reset values 0, 0, 50, 70, 0 = the Programmer's Reference defaults. |
| 0xCD67, 0xCD6F (synth info +3, +11) | sidechain preset of Synth 1, Synth 2: 0 = off, 1–7. MIDI 1/2's are at tail +3/+11 (per `ncs.js`; not in this save). |

- **Every delay and reverb preset stores the same values as on the Circuit Rhythm** (delay 2–16, reverb 1–8 compared; Delay 1 wasn't captured because preset 1 was already selected, so the Rhythm's row is used). Tables: `js/fx.js`.
- A fresh project has delay preset 1 and reverb preset 1 selected, but values no preset uses (delay 64,20,64,127,4,5; reverb 2,64,64), as on the Rhythm.
- Sidechain preset values (attack, hold, decay, depth): off 0,50,70,0; 1 = 5,50,80,80; 2 = 5,70,70,100; 3 = 5,85,70,115; 4 = 5,90,75,123; 5 = 5,90,85,127; 6 = 5,95,95,127; 7 = 5,102,95,127.
- The Side Chain view's source pads change only the synth whose preset was pressed last (user guide p. 93; in the save only Synth 2's source varies).
- Still to test: whether the Tracks plays the stored values rather than the preset number (the Rhythm does).

## Patch (official, Programmer's Reference Guide v3)
340 bytes 7-bit; SysEx F0 00 20 29 01 64 00 <loc> 00 <340> F7 (current) / 01 <slot> 00 (flash). Bank file = 64 Replace Patch msgs. OG Circuit = product byte 0x60.
- Map (added 2026-11-04): 0-15 name ASCII space-padded; 16 category 0-14; 17 genre 0-9; 18-31 reserved; 32-35 voice (poly 0-2, portamento, pre-glide 52-76, octave 58-69); 36-44 osc1 (wave 0-29, interpolate, PW, vsync, density, density detune, semis, cents, bend 52-76); 45-53 osc2 same; 54-59 mixer (osc1, osc2, ring, noise, preFX 52-82, postFX 52-82); 60-68 filter (routing, drive, drive type 0-6, type 0-5 [lp12, lp24, bp6, bp12, hp12, hp24], freq, tracking, res, Q norm, env2->freq bipolar); 69-73 env1 (vel, A, D, S, R); 74-78 env2; 79-83 env3 (delay, A, D, S, R); 84-91 LFO1 (wave 0-37, phase 0-119, slew, delay, delay sync, rate, rate sync, flags: bit0 one-shot, bit1 key sync, bit2 common sync, bit3 delay trigger, bits4-5 fade mode); 92-99 LFO2; 100 dist level; 102 chorus level; 105-110 EQ; 116 dist type; 117 dist comp; 118-123 chorus (type 0 phaser/1 chorus, rate, rate sync, feedback, depth, delay); 124-203 mod matrix 20 x [src1, src2, depth (64=0), dest]; 204-339 macros 8 x 17 [position, 4 x (dest 0-70, start, end, depth 64=0)].
- Patch-table defaults differ from the CC table (e.g. osc wave interpolate 127, PW 64); use the patch table.
- Mod sources: 0 direct, 4 velocity, 5 keyboard, 6/7 LFO1 uni/bi, 8/9 LFO2 uni/bi, 10 amp env, 11 filter env, 12 env3. Destinations 0-17: pitch, osc1/2 pitch, osc1/2 vsync, osc1/2 PW, osc1/2 level, noise, ring, filter drive, filter freq, resonance, LFO1/2 rate, amp decay, filter decay.
- Macro destinations: 0 = none, then 1-70 in CC-parameter order (portamento, postFX, osc1, osc2, mixer, filter, env1-3, LFO rates/slew, dist, chorus), then mod matrix 1-20 depth (51-70). Names from the CIRCUIT-HACKS-RC wiki "MIDI" page; the "none" entry confirmed in Components and on hardware 2026-11-05.
- Patch builder: `tools/ctpatch.py`. Not yet measured on hardware: exact macro depth scaling; meaning of mod sources 1-3.

## Samples
48 kHz 16-bit mono WAV (confirmed in pack); 196.6 s total, 98.3 s max per sample (fw >= 1.1.5); no warning on overflow.

## SysEx file protocol
F0 00 20 29 01 64 03 <sub>; file types 03 project/04 patch/05 sample; 8192-byte blocks, MSB-interleave 7->8; size + zlib CRC32 as hex nibbles; ACK per block.
