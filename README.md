# TracksGM
Could General MIDI files be converted to play on a Novation Circuit Tracks? Research, and public projects

## TracksGM MIDI to Circuit Tracks Converter (alpha 0.1)

**Try it:** https://guinanno1.github.io/TracksGM/

**Help:** [Quickstart](https://guinanno1.github.io/TracksGM/help.html#quickstart) · [User guide](https://guinanno1.github.io/TracksGM/help.html)

A web page that turns a General MIDI file (`.mid`) into a Circuit Tracks pack (`.circuittrackspack`) you can load with Novation Components. It runs entirely in the browser: nothing is uploaded, and there is no server.

The pack it makes contains:
- a **base pack**'s patches and drum samples. By default this is the **TracksGM Universal Circuit Tracks Pack** (`TracksGM_final.circuittrackspack`): 128 synth patches in General MIDI order, and 64 drum samples (8 kits) from GeneralUser GS. You can drop in another pack instead (see below);
- one or more **projects** holding the converted song, in project slots 1 onwards.

Sending the pack to the Tracks replaces the pack in that slot, so send it to a spare pack slot.

### Using it

1. **Load a MIDI file.** The **Base pack** box at the top shows the pack the song is built on (*TracksGM_final* unless you change it). Then drop a `.mid` file on the page or choose one. Type 0 and type 1 files both work. Each MIDI track and channel becomes a separate part.
2. **Choose the parts.** Give each part a Circuit Tracks track:
   - **S1 / S2** play on Synth 1 and Synth 2.
   - **M1 / M2** play external gear through MIDI 1 and MIDI 2.
   - **Drums** takes the General MIDI drum part (channel 10).
   
   Send several parts to the same track to combine them. Parts that share a name (as in type 0 files) are named by instrument and channel. The ▶ button plays a single part on its own. By default, the two busiest parts go to Synth 1 and Synth 2, the next two to MIDI 1 and MIDI 2, and channel 10 to Drums.
3. **Pick the sounds.**
   - **Synth patches:** choose a TracksGM patch for each synth. The default is the GM instrument of the first part on that track (TracksGM slot = GM program number).
   - **Drum kit:** choose a kit (Std, Room, Power, Elec, 808, Jazz, Brush, Orch).
   - **Octave:** each melodic track can be shifted up or down an octave.
4. **Check the arrangement.**
   - **Grid:** each Circuit Tracks track has a row showing which pattern it plays, section by section and across projects if the song needs more than one. Under it is a row for each MIDI part feeding that track.
   - **Muting:** click a coloured dot to mute or unmute a whole row, or a box to mute or unmute those bars. On a drum row (Kick, Snare/Tom, Hi-hats, Perc) the dot mutes just that sound. Mutes apply to both the preview and the pack, and muting can bring the number of projects down.
   - **Options:**
     - **Section length:** Auto, or 4 to 32 bars.
     - **Pattern length:** Auto, or 1/16, 1/8 or 1/4 steps.
     - **Tempo:** original, ÷2 or ÷4.
     - **Repeats:** exact, ignoring velocity, or ≥90% / ≥75% similar.
     - **Quantise:** off, 1/16, 1/8 or 1/16 triplet.
     - **Line up sections with repeats** and **Skip empty bars at the start** (on/off).
     
     The sections below explain each one.
   
   **Play preview** plays the converted parts:
   - melodic parts use simple synth voices, as a sketch of the part rather than the Tracks patch;
   - drums use the real samples of the chosen kit.
   
   S solos a track in the preview only. Changing a mute or option while the preview plays carries on from the same spot. Notes about anything that had to change (dropped or moved notes, tempo changes and so on) appear under the grid.
5. **Build the pack.** Name the project and the pack, choose the project colours, then **Download pack**.
   - **Rainbow** (the default) colours the projects Red, Orange, Yellow, Green, Cyan, Blue, Purple, then repeats.
   - **Graduated** steps through all 12 shades from red to purple.
   - **One colour** gives every project the same colour.

   Open the pack in Novation Components and send it to your Circuit Tracks.

### Using a different base pack

Click **Use another pack…** in step 1, or drop a `.circuittrackspack` on the Base pack box or the MIDI box, to build on another pack (an edited TracksGM, or any pack exported from Components). **Back to TracksGM_final** switches back.

- **Patches:** the synth lists show the pack's own patch names. Defaults still assume General MIDI order (slot = GM program, or the nearest filled slot below).
- **Drums:** the 64 samples are read as 8 kits of 8, each in the order kick, snare, rim/clap, closed hat, open hat, tom, cymbal, percussion.
- **Projects:** the pack's own projects are replaced by the converted song; its patches and samples are copied unchanged.
- **Checks:** the file must open as a pack with at least one patch and 8 sample slots, otherwise the page keeps the previous pack.

### How a song becomes Circuit Tracks projects

- **Steps and patterns.** A Circuit Tracks pattern has up to 32 steps, and the converter places every note on a step plus one of 6 micro-steps. Two settings decide how much of the song (in 4/4) a pattern holds:
  - **Pattern length**, the pattern's step rate: 1/16 steps hold 2 bars, 1/8 steps 4 bars, 1/4 steps 8 bars.
  - **Tempo:** ÷2 or ÷4 lowers the project tempo, so each step covers 2× or 4× as much of the song (up to 32 bars per pattern).

  Longer patterns mean fewer projects but coarser timing:

  | Song per step | Timing grid |
  |---|---|
  | 1/16 note | 1/96 note |
  | 1/8 note | 1/48 note (16ths and 16th triplets exact) |
  | 1/4 note | 1/24 note (16ths fall between micro-steps) |
  | 1/2 note | 1/12 note |
  | whole note | 1/6 note |

  The page reports how many notes moved by more than a 64th.
  - **Tempo division side effects:** the project tempo must stay at 40 BPM or above. The song plays at its own speed, but tempo-synced effects, arpeggios and MIDI clock run slower.
  - **Auto** picks the step rate that needs the fewest projects without moving more than 2% of notes.
- **Sections and scenes.** The song is cut into sections, and each section becomes a scene; the scenes are chained in song order. *Auto* tries three layouts and keeps whichever needs the fewest projects:
  - 8-bar sections;
  - one-pattern sections, which let any pattern be reused anywhere but use up the 16 scenes faster;
  - variable scenes, where consecutive patterns share a scene whenever that costs no extra patterns.
- **Reusing repeats.**
  - **Within a section:** a track that repeats a cycle (A A A A, or A B A B) loops just those patterns. Otherwise it chains the section's patterns.
  - **Repeated sections** reuse their patterns.
  - **Repeats setting:** *Match ignoring velocity* (the default) treats parts that differ only in velocity as repeats. The *similar* settings also treat a pattern that shares at least 90% or 75% of its notes with an earlier one as a repeat. That changes a few notes, and the page reports how many.
  - **Line up sections with repeats** tries starting sections up to 8 bars earlier, to catch phrases that begin after a pickup or intro. It only does this when it saves a project, since the song then starts after a few empty bars.
  - **Quantise** snaps notes to a grid first, so loosely played repeats match.
- **How far repeats go:** on the GeneralUser GS demo songs, most sections are genuinely different (fills, variations, new parts). At 4-bar patterns, 8 of 9 songs already reach the smallest project count their number of different patterns allows. Longer patterns, muting parts, or the *similar* settings are the ways to go lower.
- **Projects.** Each track holds 8 patterns per project, and a project has 16 scenes. When the song has more distinct material than that, it carries on in the next project (up to 64).
- **Drums.** The GM drum part is spread across the four drum tracks, using the chosen kit's samples:

  | Track | Plays | Samples used |
  |---|---|---|
  | Drum 1 | Kick | kick |
  | Drum 2 | Snare / Tom | snare and tom, chosen per step |
  | Drum 3 | Hi-hats | closed and open hat, chosen per step |
  | Drum 4 | Percussion | rim/clap, cymbals and other percussion, chosen per step |

  Each drum step plays one sample. Where two sounds land on the same step of one track, the louder one is kept. Repeated hits within a step become flams and rolls.
- **Limits.** These apply on top of the Tracks' own rules:
  - At most 6 notes can start on one step; the top and bottom notes are always kept.
  - Notes longer than 16 steps are tied.
  - Notes that run past the end of a pattern are struck again at the start of the next one.
  - The project uses the file's first tempo (40–240 BPM) and first time signature.
- **Project settings.** Projects use the Chromatic scale so notes play exactly as written. Synth 1 and Synth 2 point at the chosen pack patches, and also carry their own copies of them. MIDI 1 and MIDI 2 send on the MIDI channels set on the Tracks (Setup view).

### Still to confirm on hardware

The project format is reverse-engineered. Confirmed on a Circuit Tracks (alpha 0.1): packs load, synth and drum parts play, and long held notes sustain correctly. Still to check:
- the octave of notes sent on MIDI 1 and MIDI 2;
- scenes playing through the song in order, each lasting as long as its longest pattern chain.

### Hosting on GitHub Pages

The page is static (HTML, CSS and JavaScript modules), with no build step.

1. Make the repository public. GitHub Pages on a private repository needs a paid plan.
2. In the repository, open **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to *Deploy from a branch*, choose the branch that holds the page (`web-converter`, or `main` once it's merged) and the `/ (root)` folder, then click **Save**.
4. After a minute or two the page is live at `https://<your-user-name>.github.io/TracksGM/`.

### Running it on your own computer

Browsers block JavaScript modules and file loading when a page is opened straight from disk, so serve the folder instead:

```sh
cd TracksGM
python3 -m http.server 8765
```

Then open <http://localhost:8765/>.

### Files

| Path | What it is |
|---|---|
| `index.html`, `css/app.css` | The page. |
| `js/app.js` | The page logic: loading, part picker, sounds, arrangement view, build. |
| `js/midifile.js` | MIDI file reader. |
| `js/convert.js` | Quantising, drum mapping, and laying the song out as patterns, scenes and projects. |
| `js/build.js` | Writes the `.ncs` projects and the pack. |
| `js/player.js` | Preview playback (Web Audio). |
| `js/vendor/ncs.js`, `js/vendor/zip.js` | Project file reader/writer and zip code from circuit-tracks-tools (MIT licence, see `js/vendor/LICENSE-circuit-tracks-tools.txt`). |
| `data/TracksGM_final.circuittrackspack` | The TracksGM Universal Circuit Tracks Pack, the default base pack. Replace this file to update the default when the pack is retuned. |
| `data/Empty.ncs` | Blank project used as the template (from circuit-tracks-tools). |
| `tests/` | Node scripts: parse MIDI files, plan arrangements, build packs and read them back, and check projects against the Components validator's ranges. |

Running the tests needs Node.js 18 or later and some MIDI files, for example GeneralUser GS's `demo MIDIs` folder:

```sh
node tests/build_test.mjs "path/to/song.mid" out     # build a pack, read every note back
node tests/validate.mjs out/project_*.ncs            # range checks
```

### Credits and licences

- **TracksGM Universal Circuit Tracks Pack:** Ian Guinan. How it was made is described on the [`pack-build` branch](https://github.com/GuinanNo1/TracksGM/tree/pack-build).
- **Drum samples:** [GeneralUser GS](https://github.com/mrbumpy409/GeneralUser-GS) by S. Christian Collins. Licence in `data/LICENSE-GeneralUser-GS.txt`; keep it with any shared pack and credit "Drum samples: GeneralUser GS by S. Christian Collins".
- **Project-format code and blank project:** [circuit-tracks-tools](https://github.com/namirsab/circuit-tracks-tools) by Namir Sayed-Ahmad Baraza (MIT).
- **Format research:** circuit-tracks-tools and [ncstool](https://github.com/Ondrysak/ncstool).
- **Other code:** this repository's licence (MPL-2.0, see `LICENSE`).
- Not affiliated with Novation or Focusrite. "Circuit Tracks" and "Components" are their trademarks.
