// Circuit Rhythm project (.ncs) parser. Reverse-engineered on 2026-11-07 from a hardware-saved
// project ("TEARDROP Final", project 0) against Components' empty template; see
// docs/circuit-rhythm-format.md. Shapes match js/vendor/ncs.js (Circuit Tracks) where the
// two formats overlap, so js/song.js can treat both alike.
//
// Layout (169092 bytes):
//   0x00  magic 'RUSE' (hardware-saved) or 'INIT' (Components' empty slot), u32 file size,
//         u32 1, u32 colour, then the 32-byte name at 0x10.
//   0x34  tempo, 0x35 swing, 0x36 swing sync rate (same as the Tracks).
//   0x38  16 scenes x 40 bytes: 8 chain entries [start, end, 0, 0] (tracks 1-8) at base+8,
//         then the scene's header at base+40 (byte 0 stored flag, byte 1 the mixer mutes
//         saved with the scene, bit t = track t muted), as on the Tracks.
//   0x2C0 scene chain [start, end, 0, 0]; 0x2C4 8 pattern chains (the live selection).
//   0x2E4 64 pattern blocks of 2600 bytes, block = track * 8 + pattern:
//         32 steps x 8 bytes [note, gate, micro mask, velocity, probability, sample, 0, 0],
//         then 40 bytes of settings [end, start, sync rate, direction, ...],
//         then 2304 bytes of automation (0xFF = no lock).
//   0x28CE4 tail: +8..15 default sample slot per track; the rest (mixer, FX) is not used here.

export const RHYTHM_FILE_SIZE = 169092;
const SC_BASE = 0x38;
const BLOCK_BASE = 0x2e4;
const BLOCK_SIZE = 2600;
const STEP_SIZE = 8;
const STEPS = 32;
const TAIL = BLOCK_BASE + 64 * BLOCK_SIZE; // 0x28ce4
const T_DEFAULT_SAMPLES = 8;
export const NO_SAMPLE = 0xff;           // step sample byte: use the track's default sample

export function rhythmMagic(bytes) {
  const d = new Uint8Array(bytes);
  return String.fromCharCode(d[0], d[1], d[2], d[3]);
}

export function parseRhythm(buffer) {
  const d = new Uint8Array(buffer);
  if (d.length !== RHYTHM_FILE_SIZE) throw new Error(`Not a Circuit Rhythm project (size ${d.length}, expected ${RHYTHM_FILE_SIZE}).`);
  const magic = rhythmMagic(d);
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const proj = {
    magic,
    empty: magic === 'INIT',
    name: new TextDecoder('ascii').decode(d.subarray(0x10, 0x30)).replace(/[\s\0]+$/, ''),
    color: dv.getUint32(12, true),
    tempo: d[0x34],
    swing: d[0x35],
    swingSyncRate: d[0x36],
    scenes: [],
    sceneChain: { start: d[SC_BASE + 648], end: d[SC_BASE + 649] },
    patternChains: [],
    patterns: [],
    defaultSamples: Array.from(d.subarray(TAIL + T_DEFAULT_SAMPLES, TAIL + T_DEFAULT_SAMPLES + 8)),
  };
  for (let s = 0; s < 16; s++) {
    const base = SC_BASE + s * 40;
    const trackChains = [];
    for (let t = 0; t < 8; t++) trackChains.push({ start: d[base + 8 + t * 4], end: d[base + 9 + t * 4] });
    proj.scenes.push({ flags: d[base + 40], mask: d[base + 41], trackChains });
  }
  for (let t = 0; t < 8; t++) proj.patternChains.push({ start: d[SC_BASE + 652 + t * 4], end: d[SC_BASE + 653 + t * 4] });
  for (let t = 0; t < 8; t++) {
    const pats = [];
    for (let p = 0; p < 8; p++) {
      const o = BLOCK_BASE + (t * 8 + p) * BLOCK_SIZE;
      const steps = [];
      for (let i = 0; i < STEPS; i++) {
        const s = o + i * STEP_SIZE;
        steps.push({
          note: d[s], gate: d[s + 1], mask: d[s + 2] & 0x3f, velocity: d[s + 3],
          probability: d[s + 4], sample: d[s + 5],
        });
      }
      const st = o + STEPS * STEP_SIZE;
      pats.push({
        kind: 'sample',
        steps,
        settings: { playbackEnd: d[st], playbackStart: d[st + 1], syncRate: d[st + 2], direction: d[st + 3] },
      });
    }
    proj.patterns.push(pats);
  }
  return proj;
}

// Every sample slot a project refers to: each track's default sample and every step's own sample.
export function rhythmSampleRefs(proj) {
  const used = new Set(proj.defaultSamples);
  for (const pats of proj.patterns) for (const p of pats) for (const s of p.steps) {
    if (s.sample !== NO_SAMPLE) used.add(s.sample);
  }
  return used;
}
