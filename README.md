# TracksGM
Could General MIDI files be converted to play on a Novation Circuit Tracks? Research, and public projects

## Projects

### TracksGM Pack Builder: Standard MIDI file converter (alpha 0.1)
A web page that turns a General MIDI file (`.mid`) into a Circuit Tracks pack for Novation Components. You choose the parts for Synth 1/2, MIDI 1/2 and the four drum tracks, preview and mute them, and download a `.circuittrackspack` built on the TracksGM sound set. It runs in the browser, with nothing uploaded.

- **Try it:** https://guinanno1.github.io/TracksGM/
- **Code and documentation:** [`web-converter` branch](https://github.com/GuinanNo1/TracksGM/tree/web-converter)

Alpha 0.1 is for testing. Please report problems in [Issues](https://github.com/GuinanNo1/TracksGM/issues).

### TracksGM pack build
**TracksGM_final** is the sound set behind the converter: 128 synth patches in General MIDI order, voiced and loudness-matched on hardware, plus 64 drum samples (8 kits) from GeneralUser GS. The branch holds the pack, the code that generates every patch from calibrated settings, the drum renderer, and a write-up of the calibration method and file-format research.

- **Pack, code and method:** [`pack-build` branch](https://github.com/GuinanNo1/TracksGM/tree/pack-build) (see `PACK.md`)
- **Download the pack:** [TracksGM_final.circuittrackspack](https://github.com/GuinanNo1/TracksGM/raw/pack-build/TracksGM_final.circuittrackspack)

## Credits
Drum samples: [GeneralUser GS](https://github.com/mrbumpy409/GeneralUser-GS) by S. Christian Collins. Project-format code and research: [circuit-tracks-tools](https://github.com/namirsab/circuit-tracks-tools) by Namir Sayed-Ahmad Baraza, and [ncstool](https://github.com/Ondrysak/ncstool). Not affiliated with Novation or Focusrite; "Circuit Tracks" and "Components" are their trademarks.
