# TracksGM
Could General MIDI files be converted to play on a Novation Circuit Tracks? Research, and public projects

TracksGM is three projects:

1. **[TracksGM Universal Circuit Tracks Pack](https://github.com/GuinanNo1/TracksGM/tree/pack-build)**: a General MIDI sound set for the Circuit Tracks. [Download the pack](https://github.com/GuinanNo1/TracksGM/raw/pack-build/TracksGM_final.circuittrackspack) · [details below](#1-tracksgm-universal-circuit-tracks-pack)
2. **[TracksGM MIDI to Circuit Tracks Converter (MIDI2Circuit)](https://github.com/GuinanNo1/TracksGM/tree/web-converter)**: a web page that turns Standard MIDI files into Circuit Tracks projects using that pack. [Open the converter](https://guinanno1.github.io/TracksGM/) · [details below](#2-tracksgm-midi-to-circuit-tracks-converter-midi2circuit-alpha-01)
3. **[TracksGM Circuit Tracks to MIDI Converter (Circuit2MIDI)](https://github.com/GuinanNo1/TracksGM/tree/web-converter/circuit2midi)**: the reverse, a web page that turns a project from a Circuit Tracks or Circuit Rhythm pack into a Standard MIDI file, and can compact the pack. [Open Circuit2MIDI](https://guinanno1.github.io/TracksGM/circuit2midi/) · [details below](#3-tracksgm-circuit-tracks-to-midi-converter-circuit2midi-alpha-01)

## 1. TracksGM Universal Circuit Tracks Pack
A Novation Components pack with 128 synth patches in General MIDI order, voiced and loudness-matched on hardware, plus 64 drum samples (8 kits) from GeneralUser GS. It works as a general-purpose pack on its own.

The final pack will be further manually tuned to improve the patches. The final pack is used in the [TracksGM MIDI to Circuit Tracks Converter (MIDI2Circuit)](https://guinanno1.github.io/TracksGM/) (though alternate packs can be uploaded into the converter).

- **Download:** [TracksGM_final.circuittrackspack](https://github.com/GuinanNo1/TracksGM/raw/pack-build/TracksGM_final.circuittrackspack)
- **How it was made:** [`pack-build` branch](https://github.com/GuinanNo1/TracksGM/tree/pack-build). It holds the pack, the code that generates every patch from calibrated settings, the drum renderer, and a write-up of the calibration method and file-format research (start with `PACK.md`).

## 2. TracksGM MIDI to Circuit Tracks Converter (MIDI2Circuit) (alpha 0.1)
A web page that turns a Standard MIDI file (`.mid`) into a Circuit Tracks pack built on the TracksGM Universal Circuit Tracks Pack (or another pack you upload). You choose the parts for Synth 1/2, MIDI 1/2 and the four drum tracks, preview and mute them, and download a `.circuittrackspack` for Novation Components. It runs in the browser, with nothing uploaded.

- **Try it:** https://guinanno1.github.io/TracksGM/
- **Help:** [Quickstart](https://guinanno1.github.io/TracksGM/help.html#quickstart) · [User guide](https://guinanno1.github.io/TracksGM/help.html)
- **Code and documentation:** [`web-converter` branch](https://github.com/GuinanNo1/TracksGM/tree/web-converter)

Alpha 0.1 is for testing. Please report problems in [Issues](https://github.com/GuinanNo1/TracksGM/issues).

## 3. TracksGM Circuit Tracks to MIDI Converter (Circuit2MIDI) (alpha 0.1)
A web page that opens a Novation Components pack for the Circuit Tracks (`.circuittrackspack`) or Circuit Rhythm (`.circuitrhythmpack`). It can save a compacted copy of the pack, without the samples and patches none of its projects use, and it turns one project at a time into a Standard MIDI file: scenes in order, pattern chains, step timing, gates and velocities, on the MIDI channels and instruments you choose, with drum samples mapped to notes. A preview plays the pack's own samples. It runs in the browser, with nothing uploaded.

- **Try it:** https://guinanno1.github.io/TracksGM/circuit2midi/
- **Help:** [Quickstart](https://guinanno1.github.io/TracksGM/circuit2midi/help.html#quickstart) · [User guide](https://guinanno1.github.io/TracksGM/circuit2midi/help.html)
- **Code and documentation:** [`web-converter` branch](https://github.com/GuinanNo1/TracksGM/tree/web-converter), in `circuit2midi/` and `js/`; the Circuit Rhythm project format is written up in [`docs/circuit-rhythm-format.md`](https://github.com/GuinanNo1/TracksGM/blob/web-converter/docs/circuit-rhythm-format.md)

Alpha 0.1 is for testing. Please report problems in [Issues](https://github.com/GuinanNo1/TracksGM/issues).

## Credits
Drum samples: [GeneralUser GS](https://github.com/mrbumpy409/GeneralUser-GS) by S. Christian Collins. Project-format code and research: [circuit-tracks-tools](https://github.com/namirsab/circuit-tracks-tools) by Namir Sayed-Ahmad Baraza, and [ncstool](https://github.com/Ondrysak/ncstool). Not affiliated with Novation or Focusrite; "Circuit Tracks", "Circuit Rhythm" and "Components" are their trademarks.
