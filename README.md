# CircuitGM
General MIDI for the Novation Circuit Tracks and Circuit Rhythm: sound packs, and browser tools that convert MIDI files to Circuit packs and back, edit synth patches and trim packs.

**Website: https://guinanno1.github.io/CircuitGM/**

| | What it is | Status | Links |
|---|---|---|---|
| **TracksGM** | General MIDI pack for the Circuit Tracks: 128 synth patches in GM order, 64 drum samples in 8 kits | Ready | [Page and patch list](https://guinanno1.github.io/CircuitGM/tracksgm/) · [Download](https://github.com/GuinanNo1/CircuitGM/raw/main/tracksgm/TracksGM_v1.circuittrackspack) · [Code](tracksgm/) |
| **RhythmGM** | General MIDI sample packs for the Circuit Rhythm: RhythmInstGM (all 128 GM instruments, slot = GM program) and RhythmDrumGM (8 kits × 16 hits, same order in every kit) | Beta | [Page and sample lists](https://guinanno1.github.io/CircuitGM/rhythmgm/) · Download [RhythmInstGM](https://github.com/GuinanNo1/CircuitGM/raw/main/rhythmgm/RhythmInstGM.circuitrhythmpack), [RhythmDrumGM](https://github.com/GuinanNo1/CircuitGM/raw/main/rhythmgm/RhythmDrumGM.circuitrhythmpack) · [Code](rhythmgm/) |
| **PatchWorker** | Synth patch editor for the Circuit Tracks: edit any patch in a pack, hear it in the browser or live on a linked Circuit Tracks, save `.syx` patches and whole packs | For testing | [Open](https://guinanno1.github.io/CircuitGM/patchworker/) · [Help](https://guinanno1.github.io/CircuitGM/patchworker/help.html) · [Code](patchworker/) |
| **PackTrim** | Trims a Circuit Tracks or Circuit Rhythm pack to the samples and patches its projects use | Alpha 0.1 | [Open](https://guinanno1.github.io/CircuitGM/packtrim/) · [Code](packtrim/) |
| **MIDI2Circuit** | MIDI files, or Circuit Tracks and Circuit Rhythm projects, to Circuit Tracks packs | Alpha 0.1 | [Open](https://guinanno1.github.io/CircuitGM/midi2circuit/) · [Help](https://guinanno1.github.io/CircuitGM/midi2circuit/help.html) · [Code](midi2circuit/) |
| **Circuit2MIDI** | A project from a Circuit Tracks or Circuit Rhythm pack to a Standard MIDI file | Alpha 0.1 | [Open](https://guinanno1.github.io/CircuitGM/circuit2midi/) · [Help](https://guinanno1.github.io/CircuitGM/circuit2midi/help.html) · [Code](circuit2midi/) |

Everything runs in the browser: nothing is uploaded, and there is no server. Each folder has its own README with the details. The alpha tools are for testing: please report problems in [Issues](https://github.com/GuinanNo1/CircuitGM/issues).

## Hosting on GitHub Pages

The site is static (HTML, CSS and JavaScript modules), with no build step. In **Settings → Pages**, set **Source** to *Deploy from a branch*, choose `main` and the `/ (root)` folder, then **Save**. After a minute or two it is live at `https://guinanno1.github.io/CircuitGM/`.

## Running it on your own computer

Browsers block JavaScript modules and file loading when a page is opened straight from disk, so serve the folder instead:

```sh
cd CircuitGM
python3 -m http.server 8765
```

Then open <http://localhost:8765/>.

## Files

| Path | What it is |
|---|---|
| `index.html` | The CircuitGM landing page. |
| `css/app.css` | Styles shared by every page, including the site navigation. |
| `tracksgm/` | The TracksGM pack, its web page, drum samples, build tools and patch data (see [`tracksgm/PACK.md`](tracksgm/PACK.md)). |
| `rhythmgm/` | The RhythmInstGM and RhythmDrumGM packs, their SD-card versions, web page, build scripts and sample data (see [`rhythmgm/README.md`](rhythmgm/README.md)). |
| `patchworker/`, `css/patchworker.css`, `js/patchworker.js`, `js/pw/` | PatchWorker: page, help, styles, and its patch table, browser synth, MIDI link and pack code (see [`patchworker/README.md`](patchworker/README.md)). |
| `packtrim/`, `js/packtrim.js`, `css/packtrim.css` | PackTrim's page, logic and styles. |
| `midi2circuit/index.html`, `midi2circuit/help.html` | MIDI2Circuit's page and help. |
| `circuit2midi/index.html`, `circuit2midi/help.html`, `css/c2m.css` | Circuit2MIDI's page and help. |
| `js/app.js` | The page logic: loading, part picker, sounds, arrangement view, build. |
| `js/midifile.js` | MIDI file reader. |
| `js/convert.js` | Quantising, drum mapping, and laying the song out as patterns, scenes and projects. |
| `js/build.js` | Writes the `.ncs` projects and the pack; with a Circuit pack as the song, combines its samples with the base pack's patches, shrinks and converts them. |
| `js/player.js` | Preview playback (Web Audio), for both pages. |
| `js/c2m.js` | Circuit2MIDI's page logic. |
| `js/pack.js` | Reads Circuit Tracks and Circuit Rhythm packs, finds the samples and patches in use, writes compacted packs. |
| `js/rhythm.js` | Circuit Rhythm project reader. |
| `js/song.js` | Turns a project into scenes, chains and timed notes, and maps them to MIDI. |
| `js/packsong.js` | MIDI2Circuit: a Circuit Tracks or Circuit Rhythm project as converter parts. |
| `js/midiwrite.js` | Standard MIDI file writer. |
| `docs/circuit-rhythm-format.md` | The Circuit Rhythm project format, as far as it is known. |
| `js/vendor/ncs.js`, `js/vendor/zip.js` | Project file reader/writer and zip code from circuit-tracks-tools (MIT licence, see `js/vendor/LICENSE-circuit-tracks-tools.txt`). |
| `docs/` | File-format research: Circuit Tracks packs, patches and projects; Circuit Rhythm projects. |
| `data/Empty.ncs` | Blank project used as the template (from circuit-tracks-tools). |
| `tests/` | Node scripts: parse MIDI files, plan arrangements, build packs and read them back, and check projects against the Components validator's ranges. |

Running the tests needs Node.js 18 or later and some MIDI files, for example GeneralUser GS's `demo MIDIs` folder:

```sh
node tests/build_test.mjs "path/to/song.mid" out     # build a pack, read every note back
node tests/validate.mjs out/project_*.ncs            # range checks
node tests/roundtrip.mjs                             # MIDI -> MIDI2Circuit -> Circuit2MIDI -> MIDI, every note compared
node tests/pack2pack.mjs [out-dir]                   # Circuit Tracks / Rhythm pack -> MIDI2Circuit -> pack, every hit compared
node tests/pack_compare.mjs <pack> [track|auto|16|8|4] # any pack: convert each project, play it back, account for every hit
node tests/compact_only.mjs [save-two-project-pack]  # PackTrim: Keep only project N
```

The browser tests use Playwright with the page served on port 8765: `tests/ui_test.cjs` and `tests/ui_mutes.cjs` for MIDI2Circuit, `node tests/ui_p2p.cjs <screenshot dir> <rhythm pack> <tracks pack> <midi file>` for MIDI2Circuit with a Circuit pack (`tests/pack2pack.mjs <out-dir>` writes suitable packs), `node tests/ui_c2m.cjs <screenshot dir> <pack> [<pack> ...]` for Circuit2MIDI (single-project packs), and `node tests/ui_handoff.cjs <two-project tracks pack> <rhythm pack>` for Convert to Circuit Tracks.

## Credits and licences

- **TracksGM:** Ian Guinan. How it was made: [`tracksgm/PACK.md`](tracksgm/PACK.md).
- **Drum samples:** [GeneralUser GS](https://github.com/mrbumpy409/GeneralUser-GS) by S. Christian Collins. Licence in [`tracksgm/LICENSE-GeneralUser-GS.txt`](tracksgm/LICENSE-GeneralUser-GS.txt); keep it with any shared pack and credit "Drum samples: GeneralUser GS by S. Christian Collins".
- **Project-format code and blank project:** [circuit-tracks-tools](https://github.com/namirsab/circuit-tracks-tools) by Namir Sayed-Ahmad Baraza (MIT).
- **Format research:** circuit-tracks-tools and [ncstool](https://github.com/Ondrysak/ncstool).
- **Other code:** this repository's licence (MPL-2.0, see `LICENSE`).
- Not affiliated with Novation or Focusrite; "Circuit Tracks", "Circuit Rhythm" and "Components" are their trademarks.
