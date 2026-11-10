# RhythmGM (beta)

General MIDI sample packs for the Novation Circuit Rhythm, in two packs that each fill all 128 sample slots from GeneralUser GS:

- **RhythmInstGM:** all 128 General MIDI instruments, **slot = GM program** (slot 1 Grand Piano … slot 128 Gunshot). Each is one note, up to 2 s. The name is the zero-padded program number, the instrument and its root note (`001 Grand Piano C4`, `034 Finger Bass C2`): play that note and the sample sounds at its own pitch.
- **RhythmDrumGM:** the eight GS kits (Std, Room, Power, Elec, 808, Jazz, Brush, Orch), 16 hits each in two rows of eight:

  | Row | 1/9 | 2/10 | 3/11 | 4/12 | 5/13 | 6/14 | 7/15 | 8/16 |
  |---|---|---|---|---|---|---|---|---|
  | 1 (slots 1–8 of a kit) | Kick | Snare | Rim/clap | Closed hat | Open hat | Tom | Cymbal | Perc |
  | 2 (slots 9–16) | Kick 2 | Snare 2 | Rim/clap 2 | Hat 2 | Open 2 | Tom 2 | Cymbal 2 | Perc 2 |

  Row 1 is the TracksGM kit exactly (same hits, byte-identical, same order), so the 8 drums of a TracksGM kit map one-to-one onto a RhythmDrumGM kit and fill one pad row on the Rhythm. Row 2 adds a second sound for each role (`ROW2` in `tools/make_rhythmdrumgm.py`). Kit k is in slots 16k+1 to 16k+16. The Orch kit's toms are timpani.

- **RhythmLatinGM:** eight Latin kits (LatinStd, LatinRoom, LatinPower, LatinElec, Latin808, LatinDance, LatinJazz, LatinBrush). Each has its root kit's kick and snare and GM Latin percussion in the other slots, placed in the same two-row role layout as RhythmDrumGM; conga and bongo sets alternate. 40.2 s. Built by `tools/make_rhythmlatingm.py`.

**Instruments plus drums.** Slots 113–128 of RhythmInstGM are GM's Percussive and Sound Effects families. When MIDI2Circuit builds Circuit Rhythm packs (planned), it puts one RhythmDrumGM or RhythmLatinGM kit in those 16 slots, so slots 1–112 keep their GM numbers. Slots 1–112 plus the longest kit (Orch) is 211.8 s, inside the 228.1 s limit.

Sample time: RhythmInstGM 211.0 s, RhythmDrumGM 135.1 s, of the Circuit Rhythm's 228.1 s; every sample is 48 kHz, 16-bit, mono.

**Page and sample lists:** https://guinanno1.github.io/CircuitGM/rhythmgm/

Beta: built and checked in software (`tests/rhythm_packs.mjs`; pitch checked per instrument), not yet loaded in Components or on a Circuit Rhythm.

## Pack layout

Copied from Components-saved Rhythm packs (see `tools/rhythm_pack.py`): 64 project files of 169,092 bytes, slot 0 named "User Session" and every one Components' blank template; 16 Grid FX files with `effectType` 127 (the Rhythm's defaults; edited pads use 0–6 = Beat Repeat, Reverser, Gater, Auto Filter, Digitise, Phaser, Vinyl Sim); compact `index.json` written last.

## Files

| Path | What it is |
|---|---|
| `RhythmInstGM.circuitrhythmpack`, `RhythmDrumGM.circuitrhythmpack` | The packs for Novation Components. |
| `RhythmInstGM_SD.zip`, `RhythmDrumGM_SD.zip` | The same samples in Novation's manual SD-card layout: `Rhythm/0/PCM/NN__Name.wav`, empty `meta/` and `Sessions/`. Rename `0` to a free pack number. |
| `rhythminstgm_samples.json`, `rhythmdrumgm_samples.json` | Every slot: name, source, GM program and root note or kit, role and note, length. |
| `index.html` | The web page. |
| `tools/make_rhythminstgm.py` | Builds RhythmInstGM (and `inst_samples/`, not committed). Names and root notes are the `GM` list at its top. Run after `make_rhythmdrumgm.py`, which it reads to check the kit sizes. |
| `tools/make_rhythmdrumgm.py` | Builds RhythmDrumGM (and `drum_samples/`, not committed). Row 1 comes from TracksGM's `make_drums.py`; row 2 is `ROW2`. |
| `tools/rhythm_pack.py` | Writes a pack and SD zip the way Components does. |
| `tools/make_rhythmgm.py` | The rendering chain both scripts use (FluidSynth, trim, level). Run directly it still builds the old single RhythmGM pack, which these two replace. |
| `tools/make_site_lists.py` | Refreshes the kit and instrument lists on the web page. |
| `LICENSE-GeneralUser-GS.txt` | Licence for the samples. Keep it with any shared copy of a pack. |

## Rebuild

```sh
python3 rhythmgm/tools/make_rhythmdrumgm.py path/to/GeneralUser-GS.sf2   # from the repo root
python3 rhythmgm/tools/make_rhythminstgm.py path/to/GeneralUser-GS.sf2
python3 rhythmgm/tools/make_site_lists.py
node tests/rhythm_packs.mjs
```

Needs the system `libfluidsynth`, Python 3 with NumPy, and the soundfont from [github.com/mrbumpy409/GeneralUser-GS](https://github.com/mrbumpy409/GeneralUser-GS).

## Rendering

- **Instruments:** GeneralUser GS bank 0, FluidSynth at 48 kHz, velocity 100, reverb and chorus off, left and right summed to mono. Sustained sounds are held 1.4 s and keep their release; decaying sounds ring out. Lead-in trimmed, tail cut where it falls 60 dB below peak (at most 2.0 s, with a fade when cut), level matched to −17 dB RMS over the first second with the peak at or below −0.5 dBFS.
- **Drums:** `../tracksgm/tools/make_drums.py`'s chain: velocity 110, same trim, peak −0.5 dBFS, length caps cymbals 4 s, open hats, toms and extras 2 s, the rest 1.5 s.

## Credits

- Samples: [GeneralUser GS](https://github.com/mrbumpy409/GeneralUser-GS) by S. Christian Collins (`LICENSE-GeneralUser-GS.txt`). Credit "Samples: GeneralUser GS by S. Christian Collins" wherever a pack is shared.
- Pack layout: RhythmInstGM and RhythmDrumGM by Ian Guinan.
- Limits, layout and Grid FX: Novation's Circuit Rhythm Components guide, the Circuit Rhythm 2.0 firmware addendum, "Manually setting up Circuit Rhythm SD card packs", and Components-saved packs.
