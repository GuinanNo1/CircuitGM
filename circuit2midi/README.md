# CircuitGM Circuit to MIDI Converter (Circuit2MIDI), alpha 0.1

**Try it:** https://guinanno1.github.io/CircuitGM/circuit2midi/

**Help:** [Quickstart](https://guinanno1.github.io/CircuitGM/circuit2midi/help.html#quickstart) · [User guide](https://guinanno1.github.io/CircuitGM/circuit2midi/help.html)

The reverse of MIDI2Circuit. A web page that opens a Novation Components pack for the **Circuit Tracks** (`.circuittrackspack`) or **Circuit Rhythm** (`.circuitrhythmpack`), and:

1. **Hands the pack to PackTrim** for trimming: *Trim this pack in PackTrim* in step 1 (trimming used to be a step here; it now lives in [PackTrim](../packtrim/), including *Keep: only project N*).
2. **Converts one project at a time** to a type 1 Standard MIDI file:
   - **Scenes:** the saved scene chain, every used scene in order, or a custom order (`1-4, 2, 5x2`). Each scene lasts as long as its longest pattern chain; shorter chains repeat.
   - **Patterns:** start and end steps, step length (1/32 to 1/4, triplets included), direction, micro-step timing, gates, velocities, ties, rolls and swing. Steps with a chance below 100% can be kept or left out.
   - **Tracks:** each Circuit track becomes a MIDI track. Melodic tracks get a channel, a GM program and an octave shift; drum tracks get one note per sample, guessed from the sample names and editable.
   - A grid shows each scene's pattern chains per track, with track mutes and solo, and a preview that plays the pack's own samples.
3. **Opens a project in MIDI2Circuit** (step 2): from a Circuit Rhythm pack, *Convert to Circuit Tracks (MIDI2Circuit)*; from a Circuit Tracks pack, *Rebuild in MIDI2Circuit* (Advanced mode only), which rebuilds the project from its notes as a new Tracks pack. Packs are passed between pages through the browser's IndexedDB (`js/handoff.js`).

It runs entirely in the browser. The Circuit Rhythm project format was worked out for this page from a hardware-saved project; see [`docs/circuit-rhythm-format.md`](../docs/circuit-rhythm-format.md).

**Still to confirm on hardware:** the triplet step lengths, what the per-track bit mask in each Circuit Rhythm scene does (offered as an unconfirmed option), and that scene length follows the longest chain.

Part of [CircuitGM](../README.md). The page is `index.html` and `help.html` in this folder; its code is shared with MIDI2Circuit in [`../js/`](../js/) (see the file list in the main README).
