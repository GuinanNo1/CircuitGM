# Tool versions

Each tool page shows its version next to its status badge, so you can tell which version a browser has loaded. GitHub Pages can take about 10 minutes to serve a new version; refresh with Shift-reload if a page shows an older one.

**Rule for every change to a tool:** bump its version here and on its page (badge in `<tool>/index.html`, and in `help.html` where it has one), add a line below, and bump the page's cache tag (`?v=…`) on the files you changed. MIDI2Rhythm takes its badge from `VERSION` in `js/m2r/app.js` and lists its versions in `midi2rhythm/help.html`.

| Tool | Current | Shown as |
|---|---|---|
| MIDI2Circuit | 0.9 | alpha 0.9 |
| MIDI2Rhythm | 0.14 | For testing · v0.14 |
| Circuit2MIDI | 0.4 | alpha 0.4 |
| PackTrim | 0.2 | alpha 0.2 |
| PatchWorker | 0.6 | For testing · v0.6 (top bar) |

Numbering started on 14 Nov 2026. Earlier changes are grouped roughly:

## MIDI2Circuit
- **0.9** (15 Nov 2026): Pack colour setting removed (Components ignores a pack file's colour on import; set it in Components).
- **0.8** (15 Nov 2026): pack colour names from Components' own list (red … pink, blue = default); 0.7's green = "teal" undone. Components seems to ignore the file's colour on import.
- **0.7** (15 Nov 2026): Pack colour written as Components stores it (Blue = no entry, Green = "teal"); the others still unmapped.
- **0.6** (15 Nov 2026): Circuit Tracks projects loaded as the song read their synth and MIDI notes relative to the project's scale root (they were off by the root, e.g. a whole tone flat with root D).
- **0.5** (14 Nov 2026): version shown on the page. Includes everything up to the PackTrim link and "Rebuild in MIDI2Circuit".
- 0.4: simple / Advanced modes, Trim the pack.
- 0.3: Circuit packs as the song; shared preview with PatchWorker's synth and mixer.
- 0.2: per-track step rates ("Per track: keep notes", the default).
- 0.1 (6 Nov 2026): first public alpha.

## MIDI2Rhythm
See `midi2rhythm/help.html` (Versions). 0.1–0.6 on 14 Nov 2026; 0.7 (15 Nov): Circuit packs as the song; 0.8: pack projects keep their layout; 0.9: drum Pitch to Tune, project colours; 0.10: scale-root fix for Tracks notes, scene mute recall copied; 0.11: pack colour names (wrong guess); 0.12: Components' real colour names; 0.13: Pack colour setting removed; 0.14: effects (presets and sends).

## Circuit2MIDI
- **0.4** (15 Nov 2026): Circuit Tracks synth and MIDI notes are read relative to the project's scale root (exports were off by the root, e.g. a whole tone flat with root D).
- **0.3** (14 Nov 2026): version shown; trimming moved to PackTrim; "Rebuild in MIDI2Circuit".
- 0.2: simple / Advanced modes, "Convert to Circuit Tracks" hand-off.
- 0.1 (8 Nov 2026): first alpha.

## PackTrim
- **0.2** (14 Nov 2026): version shown; "Keep: only project N" (Advanced); takes packs handed over from the other tools.
- 0.1 (10 Nov 2026): first alpha.

## PatchWorker
- **0.6** (14 Nov 2026): version shown in the top bar. Includes the Tracks panel, preset view, mixer panel, follow-the-Tracks, patches from the Tracks, Save to Tracks and the clearer button names.
- 0.1 (12 Nov 2026): first test version (synth patch editor).
