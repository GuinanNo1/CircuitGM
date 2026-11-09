// Round trip: a known MIDI file -> MIDI2Circuit (arrange, build pack) -> Circuit2MIDI
// (load pack, render, write MIDI) -> compare every note with the original.
// Run from the repo root: node tests/roundtrip.mjs [save-built-pack-to.circuittrackspack]
import { readFileSync, writeFileSync } from 'node:fs';
import { writeSMF } from '../js/midiwrite.js';
import { parseMidi } from '../js/midifile.js';
import { arrange } from '../js/convert.js';
import { loadBaseFromBuffers, buildProjects, buildPack } from '../js/build.js';
import { loadPack, compactPack } from '../js/pack.js';
import { songOf, renderSong, sceneOrder, defaultOrderKind, defaultMapping, midiTracks } from '../js/song.js';

const ab = (p) => { const b = readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); };
const PPQ = 480, S16 = PPQ / 4;

// 8 bars at 112 BPM: a lead with a 40-step note (tied over two gates), a bass, and drums.
const lead = [], bass = [], drums = [];
const leadNotes = [60, 64, 67, 72, 71, 67, 64, 62];
for (let bar = 0; bar < 6; bar++) {
  for (let q = 0; q < 4; q++) {
    lead.push({ tick: (bar * 16 + q * 4) * S16, dur: 2 * S16, note: leadNotes[(bar + q) % 8] + (bar % 2 ? 0 : 12), vel: 90 });
  }
}
lead.push({ tick: 96 * S16, dur: 24 * S16, note: 65, vel: 80 });     // 24 steps: gate 16 + tie
lead.push({ tick: 120 * S16, dur: 6 * S16, note: 69, vel: 70 });
for (let bar = 0; bar < 8; bar++) {
  bass.push({ tick: bar * 16 * S16, dur: 3 * S16, note: 36 + (bar % 4) * 2, vel: 100 });
  bass.push({ tick: (bar * 16 + 8) * S16, dur: 3 * S16, note: 43, vel: 96 });
  for (let q = 0; q < 4; q++) drums.push({ tick: (bar * 16 + q * 4) * S16, dur: S16, note: 36, vel: 110 });
  for (const q of [1, 3]) drums.push({ tick: (bar * 16 + q * 4) * S16, dur: S16, note: 38, vel: 100 });
  for (let e = 0; e < 8; e++) drums.push({ tick: (bar * 16 + e * 2) * S16, dur: S16, note: 42, vel: e % 2 ? 60 : 90 });
}
const src = writeSMF({ ppq: PPQ, tempo: 112, name: 'Round trip', end: 128 * S16, tracks: [
  { name: 'Lead', ch: 1, program: 80, events: lead },
  { name: 'Bass', ch: 2, program: 38, events: bass },
  { name: 'Drums', ch: 10, program: null, events: drums },
] });

// MIDI2Circuit
const midi = parseMidi(src.buffer);
const ids = Object.fromEntries(midi.sources.map((s) => [s.isDrum ? 'drums' : s.program, s.id]));
const asg = { S1: [ids[80]], S2: [ids[38]], M1: [], M2: [], DR: [ids.drums] };
// 1/16 steps, so every length here is a whole number of gate ticks and the trip is exact.
const plan = arrange(midi, asg, { kit: 3, rate: 16 });
const base = await loadBaseFromBuffers(ab('tracksgm/TracksGM_final.circuittrackspack'), ab('data/Empty.ncs'));
const projs = buildProjects(plan, base, { title: 'Round trip', synthPatch: [80, 38], kit: 3, color: 5 });
const packBuf = await (await buildPack(base, projs, { name: 'TracksGM Round', color: 'green' })).arrayBuffer();

if (process.argv[2]) writeFileSync(process.argv[2], Buffer.from(packBuf));   // optional: keep the built pack

// Circuit2MIDI
const pack = await loadPack(packBuf, 'round.circuittrackspack');
const entry = pack.projects.find((p) => !p.empty);
const song = songOf(pack, entry);
const map = defaultMapping(song, pack);
const r = renderSong(song, { order: sceneOrder(song, defaultOrderKind(song)) });
const tracks = midiTracks(song, r, map);
const back = parseMidi(writeSMF({ ppq: r.ppq, tempo: song.tempo, name: song.name, end: r.length, tracks }).buffer);

let errors = 0;
const fail = (msg) => { errors++; if (errors <= 8) console.log('  ' + msg); };
if (plan.projects.length !== 1) fail(`expected 1 project, got ${plan.projects.length}`);
if (song.tempo !== 112) fail(`tempo ${song.tempo}`);
const key = (n, ppq) => `${Math.round((n.start ?? n.tick) * 4 / ppq)}:${n.note}`;
const notesOf = (m, pred) => m.sources.filter(pred).flatMap((s) => s.notes.map((n) => ({ ...n, ppq: m.ppq })));
function compare(label, want, got, checkDur) {
  const g = new Map(got.map((n) => [key(n, n.ppq), n]));
  let ok = 0;
  for (const n of want) {
    const k = key(n, n.ppq);
    const x = g.get(k);
    if (!x) { fail(`${label}: missing ${k}`); continue; }
    const dw = (n.dur ?? n.end - n.start) / n.ppq, dg = (x.dur ?? x.end - x.start) / x.ppq;
    if (checkDur && Math.abs(dw - dg) > 1e-6) fail(`${label}: ${k} length ${dw} became ${dg}`);
    else ok++;
    g.delete(k);
  }
  for (const k of g.keys()) fail(`${label}: extra ${k}`);
  console.log(`${label}: ${ok}/${want.length} notes match`);
}
compare('Synth 1 (lead)', notesOf(midi, (s) => s.program === 80), notesOf(back, (s) => s.channel === 0), true);
compare('Synth 2 (bass)', notesOf(midi, (s) => s.program === 38), notesOf(back, (s) => s.channel === 1), true);
compare('Drums', notesOf(midi, (s) => s.isDrum), notesOf(back, (s) => s.isDrum), false);
const progs = back.sources.filter((s) => !s.isDrum).map((s) => s.program);
if (progs.join() !== '80,38') fail(`programs ${progs}`);

// Compacting the built pack keeps exactly the two patches and three samples in use.
const small = await loadPack(await (await compactPack(pack)).arrayBuffer(), 'round.circuittrackspack');
const keptP = small.patches.filter((p) => p.present).map((p) => p.slot);
const keptS = small.samples.filter((s) => s.present).map((s) => small.samples[s.slot].name);
console.log(`compacted: patches ${keptP}, samples ${keptS.join(', ')}`);
if (keptP.join() !== '38,80' || small.usage.unusedSamples.length || small.usage.unusedPatches.length) fail('compacting kept the wrong slots');

console.log(errors ? `${errors} errors` : 'round trip OK');
process.exit(errors ? 1 : 0);
