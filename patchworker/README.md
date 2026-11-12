# CircuitGM Patch Editor (PatchWorker), alpha 0.1

**Try it:** https://guinanno1.github.io/CircuitGM/patchworker/

**Help:** https://guinanno1.github.io/CircuitGM/patchworker/help.html

A web page that edits the synth patches of a Novation Circuit Tracks. It opens with the [TracksGM](../tracksgm/) pack, plays patches in the browser, links to a Circuit Tracks over Web MIDI when one is connected, and saves single `.syx` patches or a complete `.circuittrackspack`. Nothing is uploaded, and there is no server.

## What it does

- **Pages as in Novation Components:** Main (oscillators, mixer, filter, envelopes, LFOs), Effects (chorus / phaser, EQ, distortion, voice) and Modulation (macro destinations, 20-row mod matrix), with the eight macros above every page.
- **Every parameter of the 340-byte patch** is editable, and bytes the page does not show are kept as they are.
- **Hardware units:** cutoff in Hz, envelope times, LFO rate, EQ and levels are shown using CircuitGM's measurements of a real Circuit Tracks.
- **Browser synth** for working without the hardware (an approximation, see below).
- **Circuit Tracks link:** sends the patch to Synth 1 or 2, sends each edit live (CC / NRPN for single parameters, the whole patch for mod matrix and macro assignments), plays notes on the hardware, follows the hardware's macro knobs, fetches a synth's current patch, and can write a patch to a slot on the Circuit Tracks.
- **Files:** open and download `.circuittrackspack` packs, single patches and banks as `.syx`. Samples and projects pass through untouched; a project's own copy of an edited patch can be updated when it still matched the pack.
- **Undo / redo per patch**, hold-to-compare with the original, revert, copy to another slot, and a session that survives closing the tab.

## How it is built

| Path | What it is |
|---|---|
| `patchworker/index.html`, `patchworker/help.html` | The page and its help. |
| `css/patchworker.css` | Styles (PatchWorker has its own dark panel look). |
| `js/patchworker.js` | The page: controls, pack list, files, keyboard, Circuit Tracks link. |
| `js/pw/params.js` | The patch as a parameter table: addresses, ranges, defaults, CC / NRPN numbers, display units, SysEx. |
| `js/pw/engine.js` | The browser synth (Web Audio). |
| `js/pw/midi.js` | Web MIDI link to the Circuit Tracks. |
| `js/pw/packio.js` | Reading and writing packs and `.syx` files, and the saved session. |
| `tests/ui_patchworker.cjs` | Browser test: renders all 128 TracksGM patches, edits, saves, reloads, and drives a stand-in MIDI port. |

The patch layout and MIDI numbers are from the Circuit Tracks Programmer's Reference Guide v3; see [`docs/circuit-tracks-file-formats.md`](../docs/circuit-tracks-file-formats.md).

## The browser synth

`js/pw/engine.js` is adapted from the Web Audio synth in [circuit-tracks-tools](https://github.com/namirsab/circuit-tracks-tools) by Namir Sayed-Ahmad Baraza (MIT licence, `js/vendor/LICENSE-circuit-tracks-tools.txt`): its voice structure, buffer LFOs, envelope handling and voice stealing. PatchWorker's version reads the patch bytes directly and uses curves measured on the hardware:

- filter cutoff (about one octave per 11.5 steps, 64 = 650 Hz), with key tracking;
- envelope times (+32 steps = 10×);
- LFO rate (3.39 Hz at 64, one octave per 12 steps);
- mod depth to pitch (cubic: +32 = +16 semitones) and to filter frequency;
- EQ gains and corner frequencies, Pre / Post FX level (1 dB per step, +12 dB maximum).

It adds wavetable shapes, ring modulation, density, virtual sync, filter drive and bypass routing, mod matrix source 1 × source 2, LFO delay with the four fade modes, and a phaser.

Pitch: the Circuit Tracks sounds MIDI note 60 at 523 Hz (one octave above concert pitch for the note number), and ignores the patch's Keyboard Octave for notes arriving over MIDI (that setting is the pads' and patch preview's starting octave). The browser synth does the same.

Not emulated: Q normalise, pitch-bend range, LFO slew and common sync, and mod matrix destinations V-Sync, Pulse Width, Drive, LFO Rate and envelope Decay. The vocal and random wavetables are stand-ins. Macro depth scaling is an estimate (not yet measured).

## Testing

```sh
python3 -m http.server 8765 &
node tests/ui_patchworker.cjs tests/out
```

Not yet checked on hardware: the live CC / NRPN stream, Get, and Store. They follow the Programmer's Reference Guide.
