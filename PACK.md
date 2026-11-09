# TracksGM Universal Circuit Tracks Pack (TracksGM Pack)

A General MIDI sound set for the Novation Circuit Tracks, as a Novation Components pack (`TracksGM_final.circuittrackspack`): **128 synth patches in General MIDI order** and **64 drum samples** (8 kits of 8). It works as a general-purpose pack on its own, and it is the sound set the [TracksGM MIDI to Circuit Tracks Converter (MIDI2Circuit)](https://guinanno1.github.io/TracksGM/) builds on. This is the master copy until it is revised.

The final TracksGM Pack will be further manually tuned to improve the patches. The final pack is used in the [TracksGM MIDI to Circuit Tracks Converter (MIDI2Circuit)](https://guinanno1.github.io/TracksGM/) (though alternate packs can be uploaded into the converter).

When a retuned version replaces `TracksGM_final.circuittrackspack` here, copy it to `data/TracksGM_final.circuittrackspack` on the [`web-converter` branch](https://github.com/GuinanNo1/TracksGM/tree/web-converter) too, so the converter's default base pack stays current.

| | |
|---|---|
| Pack name / colour | TracksGMfinal / green |
| Patches | 128, slots 1-128 = GM programs 1-128 (Grand Piano … Gunshot) |
| Samples | 64, 48 kHz 16-bit mono, 64.9 s of the 196.6 s limit |
| Projects | none (empty slots) |
| SHA-256 | `052c3ee2df1db3e676e34b243fbabe4cfc3c6e25b46af1180de6ada8ac53b578` |

## What's in this folder

| Path | What it is |
|---|---|
| `TracksGM_final.circuittrackspack` | The TracksGM Pack. Load it in Novation Components. |
| `tracksgm_patches.json` | The 128 patches as data: slot, name and the 340 patch bytes (hex), plus the 64 sample names. |
| `drums/` | The 64 drum WAVs exactly as stored in the pack, named by slot. |
| `tools/ctpatch.py` | Patch builder: the 340-byte patch map, parameter names, and calibrated helpers that work in real units (`cutoff(hz)`, `env_time(seconds)`, `eq_level(db, band)`, `lfo_rate(hz)`, `vib_depth(cents)` …). |
| `tools/gm_patches.py` | Generates the 128 GM patches, including every filter, EQ and loudness adjustment from the hardware tests. |
| `tools/revoice_tracksgm_wt.py` | Second pass: wavetable re-voice, vibrato macro depth and the loudness trims measured after it. |
| `tools/make_drums.py` | Renders the 64 drum hits from GeneralUser GS with FluidSynth. |
| `tools/extract_sf2.py` | Dumps every sample and every drum-kit hit in GeneralUser GS to WAV, with index CSVs, for picking substitutes. |
| `tools/make_pack.py` | Writes a `.circuittrackspack` from a folder of `.syx` patches and WAVs. |
| `tools/make_tracksgm.py` | Rebuilds a pack from `tracksgm_patches.json` and lets you edit patches as `.syx` and fold them back. |
| `tools/build_from_source.py` | Runs the whole chain and checks the result against the master. |
| `docs/circuit-tracks-file-formats.md` | Research notes on the pack, patch and project (`.ncs`) formats. |
| `LICENSE-GeneralUser-GS.txt` | Licence for the drum samples. Keep it with any shared copy of the pack. |

## Rebuild

```sh
cd tools
python3 build_from_source.py                          # drums from ../drums
python3 build_from_source.py --sf2 GeneralUser-GS.sf2  # also re-render the drums
```

Output goes to `build/`. The script stops with an error unless all 128 generated patches match `tracksgm_patches.json` byte for byte (they do as of 2026-11-06). Rendering the drums needs the system `libfluidsynth` and the soundfont from [github.com/mrbumpy409/GeneralUser-GS](https://github.com/mrbumpy409/GeneralUser-GS) (`git clone` works where raw downloads are blocked). Patch generation needs only Python 3.

To change a patch: `python3 make_tracksgm.py --syx-only` writes `tracksgm/NNN Name.syx`; edit one with `ctpatch.read_syx()` / `.set()` / `.write()`; then `python3 make_tracksgm.py --update-json --samples ../drums` folds it back into the json and rebuilds the pack. (`make_tracksgm.py` expects `tracksgm_patches.json` next to it; copy it into `tools/` first.)

## How the patches were made

### 1. Generator
`gm_patches.py` describes each GM program as a short recipe (waveforms, levels, filter, envelopes, modulation, effects) and builds it with `ctpatch.py`, which follows the official 340-byte patch map from Novation's Programmer's Reference Guide v3. All patches share one macro layout, stored at knob position 0 so a patch loads exactly as designed:

| Macro | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|
| Does | Thicken (density + detune) | Edge (virtual sync) | Longer attack + release | Filter envelope amount | Cutoff (opens dark sounds, closes bright ones) | Resonance | Vibrato depth | Chorus |

LFO 2 is the vibrato on every patch (delayed, fading in, mod slot 20 → pitch). A few patches replace macro 1 or 7 with something more useful (tremolo on Electric Piano 1, wavetable morph on the vocal patches).

### 2. Hardware calibration (method)
The first drafts were written from the reference guide alone and sounded dull and uneven, because the guide gives parameter ranges but not what they do in Hz, seconds or dB. So the synth was measured:

- **Rig.** Circuit Tracks on USB MIDI; its stereo out into a Behringer Flow 8 (inputs 5/6), recorded over USB at 48 kHz. A small Python tool sent each test patch to Synth 1 over SysEx, played a set of notes (usually C2–C5), recorded them, and wrote WAVs plus a manifest. Test project: empty, Synth 1 at default level and pan, FX sends at 0, master compressor off.
- **Test sets.** Batches of patches that each vary one parameter from a neutral reference: Post/Pre FX level, filter cutoff for each filter type (on white noise), EQ bands, amp-envelope times, filter-envelope amount, mod-matrix depth into pitch and filter, LFO rate (via tremolo), macro behaviour, distortion and drive types, chorus/phaser, and every wavetable at each of its 9 positions.
- **Analysis.** Spectra, -3 dB points, envelope times to -60 dB, K-weighted loudness and pitch, computed with numpy (ignoring mains hum on the input). The results became the helper functions in `ctpatch.py`.

Findings that shaped the set:
- Post FX level is exactly 1 dB per step from 64 and tops out at +12 dB (76); Pre FX is about 1 dB per step too.
- Filter cutoff: about one octave per 11.5 steps above ~40 (64 ≈ 650 Hz, 96 ≈ 4 kHz). The first drafts sat at 150–400 Hz, which is why they were dull.
- EQ levels are gentle near the centre (±6 steps ≈ 1 dB); envelope times change 10× per 32 steps.
- Band-pass filters lose 3 dB (BP6) or 6 dB (BP12), and a band-pass far from the played pitch makes a sine-based patch almost silent.
- Mod depth into pitch is strongly non-linear (≈ depth³ / 2048 semitones), so small vibrato depths are barely audible.
- Wavetables hold 9 single-cycle waveforms chosen by **Index**; Interpolate only smooths between them. The "digital vocal" tables have no fixed formants.
- Macro destination values start with 0 = none; an early table was off by one, and all macros were re-pointed.
- Oscillators restart phase-locked on every note, so same-pitch layering is safe.

### 3. Voicing in real units
With the calibration in hand, `gm_patches.py` sets tone in Hz, seconds and dB:
- **Family EQ** (`FAMILY_EQ`): a bass shelf, mid peak and treble shelf per GM family, following the usual mix EQ for that instrument group.
- **Family cutoff** (`FAMILY_CUTOFF` and `retune()`): every low-pass patch in a family is shifted together so the family's median cutoff hits a target (e.g. basses ~1 kHz, strings ~5 kHz), keeping their relative brightness. Macro 5 is then pointed at a sensible sweep from there.
- **Decay times** (`t60=`): plucked and struck sounds get real decay times.
- **Filter overrides** (`FILTER_OVERRIDE`): pipe-family breath noise was coming through unfiltered; the filters were set by ear on hardware (around 80 ≈ 1.8 kHz on Piccolo).
- Redesigns from listening: Agogo and Woodblock moved from band-pass to low-pass, and the basses moved up an octave with longer releases.

### 4. Loudness matching
Every patch was recorded on hardware and its loudness measured (K-weighted, over the held note, and over the first 400 ms for percussive sounds). Targets: about -26 LUFS for sustained sounds and -29 for percussive ones. `LOUD_TRIM` stores the correction per patch in dB: cuts use Post FX, boosts use Pre FX (up to +12). Changed patches were re-recorded to confirm.

### 5. Wavetable re-voice and final trims
`revoice_tracksgm_wt.py` fixes the nine wavetable patches (Choir Aahs, Voice Oohs, Synth Voice, Voice Lead, Choir Pad, Halo Pad, FX Soundtrack, FX Goblins, FX Sci-fi). Each now uses Index to choose its waveform, with Interpolate at 127, and macro 1 morphs Index. The positions were chosen from the measured spectra: dark, fundamental-heavy shapes for "ooh", peaks near 670 Hz and 1.1–1.4 kHz for "aah". The same pass raises the vibrato macro depth from +4 to +6 on every patch. Then those patches were loudness-checked again on hardware: Voice Oohs came down 13 dB because its boost was distorting, Voice Lead -3, FX Goblins +3, Synth Voice +1.

## Drum samples
The 64 samples come from **GeneralUser GS 2.0** by S. Christian Collins, a free General MIDI soundfont whose licence allows use in music and repackaging. `make_drums.py` renders each hit through FluidSynth (the synth GeneralUser GS is voiced for): drum channel, velocity 110, reverb and chorus off, left and right summed to mono, 48 kHz 16-bit, silent lead-in removed, tail cut where it falls 60 dB below its peak (cymbals up to 4 s; open hats, toms and percussion 2 s; the rest 1.5 s), peak-normalised to -0.5 dBFS. Where GeneralUser kits share a sample, a different hit was chosen so nothing appears twice, and a few hits were swapped by ear.

Sample slots, two kits per page on the Tracks (one per row). Each kit's slots run kick, snare, rim/clap, closed hat, open hat, tom, cymbal, percussion:

| Slots | Kit | Hits |
|---|---|---|
| 1-8 | Std | Kick, Snare, Clap, CH, OH, Tom, Crash, Tamb |
| 9-16 | Room | Kick, Snare, Stick, CH, OH, Tom, China, Conga |
| 17-24 | Power | Kick, Snare, Snare2, CH, OH, Tom, Crash2, Cowbell |
| 25-32 | Elec | Kick, Snare, Clap, Closed HH, Open HH, Tom, RevCym, GateSD |
| 33-40 | 808 | Kick, Snare, Rim, CH, OH, Tom, Cymbal, Cowbell |
| 41-48 | Jazz | Kick, Snare, Stick, PedalHH, Shaker, Tom, Ride, Bell |
| 49-56 | Brush | Kick, Tap, Slap, Swirl, Cabasa, Tom, Ride2, Splash |
| 57-64 | Orch | Kick, Snare, Castanet, WoodBlk, Triangle, TimpLo, Cymbal, TimpHi |

Hits picked by ear (2026-11-06): the Elec kick is the Dance kit's Kick 2, the Elec snare is the 808/909 kit's Snare 2, the Elec hats are the Electronic kit's closed and open hats, the Brush kick is GeneralUser's note 36, and the Orch kick is note 35. GeneralUser GS has no 909 hat samples; the Electronic and Dance kit hats are its 808 hat samples with longer envelopes.

`extract_sf2.py` writes out every one of GeneralUser's 920 samples and all 795 drum-kit hits (210 distinct sounds), so substitutes can be auditioned and dropped into a slot.

## Credits and licences
- Patches: TracksGM Pack by Ian Guinan.
- Drum samples: GeneralUser GS by S. Christian Collins (`LICENSE-GeneralUser-GS.txt`). Credit "Drum samples: GeneralUser GS by S. Christian Collins" wherever the pack is shared.
- Patch format: Novation Circuit Tracks Programmer's Reference Guide v3; macro destination names from the CIRCUIT-HACKS-RC wiki.
- Not affiliated with Novation or Focusrite. "Circuit Tracks" and "Components" are their trademarks.
