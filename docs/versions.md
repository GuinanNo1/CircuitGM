# Tool versions

Each tool page shows its version next to its status badge, so you can tell which version a browser has loaded. GitHub Pages can take about 10 minutes to serve a new version; refresh with Shift-reload if a page shows an older one.

**Rule for every change to a tool:** bump its version here and on its page (badge in `<tool>/index.html`, and in `help.html` where it has one), add a line below, and bump the page's cache tag (`?v=…`) on the files you changed. MIDI2Rhythm takes its badge from `VERSION` in `js/m2r/app.js` and lists its versions in `midi2rhythm/help.html`.

| Tool | Current | Shown as |
|---|---|---|
| MIDI2Circuit | 0.5 | alpha 0.5 |
| MIDI2Rhythm | 0.6 | For testing · v0.6 |
| Circuit2MIDI | 0.3 | alpha 0.3 |
| PackTrim | 0.2 | alpha 0.2 |
| PatchWorker | 0.6 | For testing · v0.6 (top bar) |

Numbering started on 14 Nov 2026. Earlier changes are grouped roughly:

## MIDI2Circuit
- **0.5** (14 Nov 2026): version shown on the page. Includes everything up to the PackTrim link and "Rebuild in MIDI2Circuit".
- 0.4: simple / Advanced modes, Trim the pack.
- 0.3: Circuit packs as the song; shared preview with PatchWorker's synth and mixer.
- 0.2: per-track step rates ("Per track: keep notes", the default).
- 0.1 (6 Nov 2026): first public alpha.

## MIDI2Rhythm
See `midi2rhythm/help.html` (Versions). 0.1–0.6 on 14 Nov 2026.

## Circuit2MIDI
- **0.3** (14 Nov 2026): version shown; trimming moved to PackTrim; "Rebuild in MIDI2Circuit".
- 0.2: simple / Advanced modes, "Convert to Circuit Tracks" hand-off.
- 0.1 (8 Nov 2026): first alpha.

## PackTrim
- **0.2** (14 Nov 2026): version shown; "Keep: only project N" (Advanced); takes packs handed over from the other tools.
- 0.1 (10 Nov 2026): first alpha.

## PatchWorker
- **0.6** (14 Nov 2026): version shown in the top bar. Includes the Tracks panel, preset view, mixer panel, follow-the-Tracks, patches from the Tracks, Save to Tracks and the clearer button names.
- 0.1 (12 Nov 2026): first test version (synth patch editor).
