# TracksGM
Could General MIDI files be converted to play on a Novation Circuit Tracks? Research, and public projects

TracksGM is two projects:

1. **[TracksGM Universal Circuit Tracks Pack](#1-tracksgm-universal-circuit-tracks-pack)**: a General MIDI sound set for the Circuit Tracks.
2. **[TracksGM MIDI to Circuit Tracks Converter](#2-tracksgm-midi-to-circuit-tracks-converter)**: a web page that turns Standard MIDI files into Circuit Tracks projects using that pack.

## 1. TracksGM Universal Circuit Tracks Pack
A Novation Components pack with 128 synth patches in General MIDI order, voiced and loudness-matched on hardware, plus 64 drum samples (8 kits) from GeneralUser GS. It works as a general-purpose pack on its own.

- **Download:** [TracksGM_final.circuittrackspack](https://github.com/GuinanNo1/TracksGM/raw/pack-build/TracksGM_final.circuittrackspack)
- **How it was made:** [`pack-build` branch](https://github.com/GuinanNo1/TracksGM/tree/pack-build). It holds the pack, the code that generates every patch from calibrated settings, the drum renderer, and a write-up of the calibration method and file-format research (start with `PACK.md`).

## 2. TracksGM MIDI to Circuit Tracks Converter (alpha 0.1)
A web page that turns a Standard MIDI file (`.mid`) into a Circuit Tracks pack built on the TracksGM Universal Circuit Tracks Pack. You choose the parts for Synth 1/2, MIDI 1/2 and the four drum tracks, preview and mute them, and download a `.circuittrackspack` for Novation Components. It runs in the browser, with nothing uploaded.

- **Try it:** https://guinanno1.github.io/TracksGM/
- **Code and documentation:** [`web-converter` branch](https://github.com/GuinanNo1/TracksGM/tree/web-converter)

Alpha 0.1 is for testing. Please report problems in [Issues](https://github.com/GuinanNo1/TracksGM/issues).

## Credits
Drum samples: [GeneralUser GS](https://github.com/mrbumpy409/GeneralUser-GS) by S. Christian Collins. Project-format code and research: [circuit-tracks-tools](https://github.com/namirsab/circuit-tracks-tools) by Namir Sayed-Ahmad Baraza, and [ncstool](https://github.com/Ondrysak/ncstool). Not affiliated with Novation or Focusrite; "Circuit Tracks" and "Components" are their trademarks.
