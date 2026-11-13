// Circuit2MIDI compacting with "Keep: only project N": a two-project Circuit Tracks pack
// (different kits and patches) -> keep project 2 -> only its sounds remain, project 1's slot
// is emptied, and project 2 is copied byte for byte and plays the same.
// Run from the repo root: node tests/compact_only.mjs
import { readFileSync } from 'node:fs';
import { writeSMF } from '../js/midiwrite.js';
import { parseMidi } from '../js/midifile.js';
import { arrange } from '../js/convert.js';
import { loadBaseFromBuffers, buildProjects, buildPack } from '../js/build.js';
import { loadPack, compactPack, findUsage } from '../js/pack.js';
import { songOf, renderSong, sceneOrder, defaultOrderKind } from '../js/song.js';

const ab = (p) => { const b = readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); };
const base = await loadBaseFromBuffers(ab('tracksgm/TracksGM_v1.circuittrackspack'), ab('data/Empty.ncs'));
let errors = 0;
const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) errors++; };

const S = 120;
const song = (prog, drumNotes) => parseMidi(writeSMF({ ppq: 480, tempo: 110, name: 'x', end: 32 * S, tracks: [
  { name: 'Lead', ch: 1, program: prog, events: Array.from({ length: 8 }, (_, i) => ({ tick: i * 4 * S, dur: 2 * S, note: 60 + i, vel: 90 })) },
  { name: 'Drums', ch: 10, program: null, events: Array.from({ length: 16 }, (_, i) => ({ tick: i * 2 * S, dur: S, note: drumNotes[i % drumNotes.length], vel: 100 })) },
] }).buffer);
const one = (midi, kit, synthPatch, title) => {
  const a = { S1: [midi.sources.find((s) => !s.isDrum).id], S2: [], M1: [], M2: [], DR: [midi.sources.find((s) => s.isDrum).id] };
  return buildProjects(arrange(midi, a, { rate: 16, kit }), base, { title, synthPatch, kit, color: 1 })[0];
};
const p1 = one(song(0, [36, 42]), 0, [0, 32], 'First');
const p2 = one(song(80, [36, 38, 42, 46]), 3, [80, 38], 'Second');
const packBuf = await (await buildPack(base, [p1, p2], { name: 'Two', color: 'red' })).arrayBuffer();
if (process.argv[2]) (await import('node:fs')).writeFileSync(process.argv[2], Buffer.from(packBuf));
const pack = await loadPack(packBuf, 'two.circuittrackspack');
ok(pack.projects.filter((p) => !p.empty).length === 2, 'fixture has two projects');

const u2 = findUsage(pack, 1);
const used = [...u2.samples.keys()].sort((a, b) => a - b);
const usedP = [...u2.patches.keys()].sort((a, b) => a - b);
console.log(`  project 2 uses samples ${used.map((s) => s + 1).join(', ')}, patches ${usedP.map((p) => p + 1).join(', ')}`);
ok(used.every((s) => s >= 24 && s < 32) && usedP.join() === '38,80', 'usage of project 2 alone: Elec kit samples, patches 39 and 81');

const out = await loadPack(await (await compactPack(pack, { name: 'Two only 2', only: 1 })).arrayBuffer(), 'out.circuittrackspack');
ok(out.projects[0].empty && !out.index.projects[0].name && !out.zip.get(out.index.projects[0].url), 'project 1 slot emptied (blank name, no file)');
ok(out.index.projects[1].name === 'Second', 'project 2 kept in its own slot');
const a = new Uint8Array(await pack.zip.get('projects/project_1.ncs')()), b = new Uint8Array(await out.zip.get('projects/project_1.ncs')());
ok(a.length === b.length && a.every((x, i) => x === b[i]), 'project 2 copied byte for byte');
const keptS = out.samples.filter((s) => s.present).map((s) => s.slot);
const keptP = out.patches.filter((p) => p.present).map((p) => p.slot);
ok(keptS.join() === used.join() && keptP.join() === usedP.join(), `only project 2's sounds kept (${keptS.length} samples, ${keptP.length} patches)`);
ok(out.index.samples.length === 64 && out.index.patches.length === 128, 'every slot keeps its number');
const hits = (pk) => { const e = pk.projects[1]; const s = songOf(pk, e); return renderSong(s, { order: sceneOrder(s, defaultOrderKind(s)) }).hits.map((h) => `${h.tick}:${h.track}:${h.note}:${pk.samples[h.sample]?.name ?? ''}`).join(); };
ok(hits(pack) === hits(out), 'project 2 plays the same');
const all = await loadPack(await (await compactPack(pack, { name: 'Two all' })).arrayBuffer(), 'all.circuittrackspack');
ok(all.projects.filter((p) => !p.empty).length === 2, 'Every project: both projects kept');

console.log(errors ? `${errors} failed` : 'compact only OK');
process.exit(errors ? 1 : 0);
