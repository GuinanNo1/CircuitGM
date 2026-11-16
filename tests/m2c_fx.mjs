// MIDI2Circuit effects: build a project with each preset and compare its FX bytes with Ian's
// hardware save of every preset (Circuit_FX_test pack: projects 1-16 = Delay 1-16, 17-24 =
// Reverb 1-8, 25 = sidechain off, 26-32 = sidechain presets 1-7).
// Usage: node tests/m2c_fx.mjs <Circuit_FX_test.circuittrackspack>
import { readFileSync } from 'fs';
import { readZip } from '../js/vendor/zip.js';
import { parseNCS, serializeNCS } from '../js/vendor/ncs.js';
import { applyFx } from '../js/build.js';
const tpl = readFileSync(new URL('../data/Empty.ncs', import.meta.url));
const tplBuf = tpl.buffer.slice(tpl.byteOffset, tpl.byteOffset + tpl.length);
const packBuf = readFileSync(process.argv[2]);
const zip = readZip(packBuf.buffer.slice(packBuf.byteOffset, packBuf.byteOffset + packBuf.length));
const saved = [];
for (let n = 1; n <= 32; n++) saved[n] = new Uint8Array(await zip.get(`projects/project_${n - 1}.ncs`)());
const ian = (n) => saved[n];
const build = (fx) => { const p = parseNCS(tplBuf.slice(0)); applyFx(p, fx); return serializeNCS(p, tplBuf); };
// regions: delay/reverb preset numbers, reverb params, delay params, sidechain S1/S2 values, sidechain preset bytes
const regions = [[0x26D0E, 2], [0x26FF0, 3], [0x27000, 6], [0x27008, 10], [0xCD64 + 3, 1], [0xCD64 + 11, 1]];
let bad = 0;
const check = (label, fx, n) => {
  const a = build(fx), b = ian(n); const diffs = [];
  for (const [o, len] of regions) for (let i = o; i < o + len; i++) if (a[i] !== b[i]) diffs.push(`0x${i.toString(16)}: ours ${a[i]} save ${b[i]}`);
  console.log(diffs.length ? `FAIL ${label}: ${diffs.join('; ')}` : `ok   ${label}`); bad += diffs.length > 0;
};
// Delay presets: project n = Delay n, reverb untouched (fresh = preset 0, 2/64/64)
// Delay 1: the Tracks stores a fresh project's values (re-save, FX_test_0.11_2 project 17)
{ const a = build({ delay: 0 }), f = build(null); console.log([...a.subarray(0x27000, 0x27006)].join() === [...f.subarray(0x27000, 0x27006)].join() && a[0x26D0E] === 0 ? 'ok   Delay 1 = fresh values' : 'FAIL Delay 1'); }
for (let d = 2; d <= 16; d++) check(`Delay ${d} vs project ${d}`, d === 11 ? { delay: 10, reverb: 0 } : { delay: d - 1 }, d);  // project 11 also has Reverb 1
// Reverb presets: project 16+r = Reverb r, delay 16 already set there
for (let r = 1; r <= 8; r++) check(`Reverb ${r} vs project ${16 + r}`, { delay: 15, reverb: r - 1 }, 16 + r);
// Sidechain: project 25 off, 26-32 preset 1-7 with sources from the save
const src = [0, 1, 2, 3, 0, 0, 3];
check('Sidechain off vs project 25', { sidechain: [{ preset: 0, source: 0 }, { preset: 0, source: 0 }] }, 25);
for (let k = 1; k <= 7; k++) check(`Sidechain ${k} (S2 from Drum ${src[k - 1] + 1}) vs project ${25 + k}`, { sidechain: [{ preset: k, source: 0 }, { preset: k, source: src[k - 1] }] }, 25 + k);
// Sends land in the tail bytes for S1,S2,D1-4
const s = build({ reverbSends: [1, 2, 3, 4, 5, 6], delaySends: [7, 8, 9, 10, 11, 12] });
console.log('reverb sends', [...s.subarray(0x26FE8, 0x26FF0)], 'delay sends', [...s.subarray(0x26FF8, 0x27000)]);
// nothing else changes vs the template
const plain = build(null), withFx = build({ delay: 3, reverb: 2, reverbSends: [9,9,9,9,9,9], delaySends: [9,9,9,9,9,9], sidechain: [{preset:4,source:1},{preset:2,source:3}] });
const changed = []; for (let i = 0; i < plain.length; i++) if (plain[i] !== withFx[i]) changed.push(i);
console.log('bytes changed by fx:', changed.length, changed.map(i => '0x' + i.toString(16)).join(' '));
process.exit(bad);
