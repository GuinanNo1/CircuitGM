# RhythmGM (beta)

A General MIDI sample pack for the Novation Circuit Rhythm, filling all 128 sample slots:

- **Slots 1–64:** the 64 [TracksGM](../tracksgm/) drum hits, unchanged and in the same order (8 kits × kick, snare, rim/clap, closed hat, open hat, tom, cymbal, percussion: Std, Room, Power, Elec, 808, Jazz, Brush, Orch).
- **Slots 65–128:** 64 pitched General MIDI instruments, four from each GM family, in GM order. Each is one note rendered from GeneralUser GS, about two seconds long. The name ends with the root note (`Grand Piano C4`, `Finger Bass C2`): a step at that note plays the sample at its own pitch.

Total sample time 208.3 s of the Circuit Rhythm's 228.1 s; every sample is 48 kHz, 16-bit, mono.

**Page and sample list:** https://guinanno1.github.io/CircuitGM/rhythmgm/

Beta: built and checked in software (the site's own pack reader loads it; pitch and level checked per sample), not yet loaded in Components or on a Circuit Rhythm.

## Files

| Path | What it is |
|---|---|
| `RhythmGM.circuitrhythmpack` | The pack for Novation Components. Samples only: the 64 project slots are empty (blank name, no file) and there are no Grid FX files. |
| `RhythmGM_SD.zip` | The same 128 samples in Novation's manual SD-card layout: `Rhythm/0/PCM/NN__Name.wav`, empty `meta/` and `Sessions/`. Rename `0` to a free pack number. The Rhythm makes default Grid FX itself. |
| `rhythmgm_samples.json` | Every slot: name, drum or instrument, source, GM program, root note, length. |
| `index.html` | The pack's web page. |
| `tools/make_rhythmgm.py` | Builds everything above (and `samples/`, not committed) from `../tracksgm/drums` and the GeneralUser GS soundfont. |
| `tools/make_site_lists.py` | Refreshes the kit and instrument lists on the web page from `rhythmgm_samples.json`. |
| `LICENSE-GeneralUser-GS.txt` | Licence for the samples. Keep it with any shared copy of the pack. |

## Rebuild

```sh
python3 rhythmgm/tools/make_rhythmgm.py path/to/GeneralUser-GS.sf2   # from the repo root
python3 rhythmgm/tools/make_site_lists.py
```

Needs the system `libfluidsynth`, Python 3 with NumPy, and the soundfont from [github.com/mrbumpy409/GeneralUser-GS](https://github.com/mrbumpy409/GeneralUser-GS). To change an instrument or its root note, edit `INSTRUMENTS` at the top of `make_rhythmgm.py`; keep four per family so the slot ranges on the page stay right.

## Rendering

Each instrument: GeneralUser GS bank 0, FluidSynth at 48 kHz, velocity 100, reverb and chorus off, left and right summed to mono. Sustained sounds are held 2 s and keep their release; decaying sounds ring out. Lead-in trimmed, tail cut where it falls 60 dB below peak (at most 2.6 s, with a fade when cut), level matched to −17 dB RMS over the first second with the peak held at or below −0.5 dBFS.

## Credits

- Samples: [GeneralUser GS](https://github.com/mrbumpy409/GeneralUser-GS) by S. Christian Collins (`LICENSE-GeneralUser-GS.txt`). Credit "Samples: GeneralUser GS by S. Christian Collins" wherever the pack is shared.
- Pack layout: RhythmGM by Ian Guinan.
- Limits and SD-card layout: Novation's Circuit Rhythm Components guide and "Manually setting up Circuit Rhythm SD card packs".
