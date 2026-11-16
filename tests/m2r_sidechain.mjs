// MIDI2Rhythm sidechain: write each preset/source with applyFx and compare with Ian's
// hardware save (Ian_SC_test pack, 16 Nov 2026: projects 2-8 = presets 1-7 on pairs of
// tracks, 10-16 = preset 1 on tracks 5-6 with the source stepped through tracks 2-8).
// Usage: node tests/m2r_sidechain.mjs <Ian_SC_test.circuitrhythmpack>
import { readFileSync } from 'fs';
import { readZip } from '../js/vendor/zip.js';
import { applyFx } from '../js/m2r/build.js';
const TAIL = 0x28ce4;
const buf = readFileSync(process.argv[2]);
const zip = readZip(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
const proj = async (n) => new Uint8Array(await zip.get(`projects/project_${n - 1}.ncs`)());
const cases = [  // project: the sidechain settings it holds, per track (absent = off)
  [2, { 0: [1, 0], 1: [1, 0] }], [3, { 0: [2, 0], 1: [2, 0], 2: [2, 0], 3: [2, 0] }], [4, { 2: [3, 0], 3: [3, 0] }],
  [5, { 4: [4, 0], 5: [4, 0] }], [6, { 4: [5, 0], 5: [5, 0] }], [7, { 4: [6, 0], 5: [6, 0] }], [8, { 4: [7, 0], 5: [7, 0] }],
  [10, { 4: [1, 1], 5: [1, 1] }], [11, { 4: [1, 2], 5: [1, 2] }], [12, { 4: [1, 3], 5: [1, 3] }],
  [13, { 4: [1, 0], 5: [1, 4] }], [14, { 4: [1, 0], 5: [1, 5] }], [15, { 4: [1, 0], 5: [1, 6] }], [16, { 4: [1, 0], 5: [1, 7] }],
];
const base = await proj(1);   // no sidechain anywhere
let bad = 0;
for (const [n, set] of cases) {
  const want = await proj(n), d = base.slice();
  applyFx(d, { sidechain: Array.from({ length: 8 }, (_, t) => (set[t] ? { preset: set[t][0], source: set[t][1] } : { preset: 0, source: 0 })) });
  const diffs = [];
  for (let t = 0; t < 8; t++) {
    const offs = [TAIL + 42 + t, ...[0, 1, 2, 3, 4].map((k) => TAIL + 82 + 41 * t + k)];
    for (const o of offs) if (d[o] !== want[o]) diffs.push(`track ${t + 1} tail+${o - TAIL}: ours ${d[o]} save ${want[o]}`);
  }
  console.log(diffs.length ? `FAIL project ${n}: ${diffs.join('; ')}` : `ok   project ${n}`); bad += diffs.length > 0;
}
process.exit(bad);
