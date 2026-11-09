// MIDI2Circuit with a Circuit pack as the song.
//  1. Circuit Tracks: a pack built from a MIDI file -> load it as the song -> build again on
//     its own patches and samples, shrunk -> every note and drum sample must match.
//  2. Circuit Rhythm: a synthetic Rhythm pack (stereo 44.1 kHz and 48 kHz samples in slots
//     above 64) -> build on the TracksGM Pack's patches -> drum hits land on the right drum
//     tracks with the right (renumbered, converted) samples, and the pitched track plays its
//     notes on Synth 1.
// Run from the repo root: node tests/pack2pack.mjs [save-dir]
import { readFileSync, writeFileSync } from 'node:fs';
import { writeSMF } from '../js/midiwrite.js';
import { parseMidi } from '../js/midifile.js';
import { arrange } from '../js/convert.js';
import { loadBaseFromBuffers, buildProjects, buildPack, composePack } from '../js/build.js';
import { loadPack } from '../js/pack.js';
import { packSong, projectChoices } from '../js/packsong.js';
import { songOf, renderSong, sceneOrder, defaultOrderKind } from '../js/song.js';
import { writeZip } from '../js/vendor/zip.js';

const ab = (p) => { const b = readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); };
const tpl = ab('data/Empty.ncs');
const tracksGM = await loadBaseFromBuffers(ab('tracksgm/TracksGM_final.circuittrackspack'), tpl);
const saveDir = process.argv[2];
let errors = 0;
const fail = (m) => { errors++; if (errors <= 12) console.log('  FAIL ' + m); };

// Roles as the page sets them: a part's own track, or drums / busiest melodic first.
function roles(midi) {
  const a = { S1: [], S2: [], M1: [], M2: [], DR: [] };
  if (midi.sources.some((s) => s.role)) { for (const s of midi.sources) if (s.role) a[s.role].push(s.id); return a; }
  for (const s of midi.sources) if (s.isDrum) a.DR.push(s.id);
  midi.sources.filter((s) => !s.isDrum).sort((x, y) => y.notes.length - x.notes.length).slice(0, 4).forEach((s, i) => a[['S1', 'S2', 'M1', 'M2'][i]].push(s.id));
  return a;
}
// The page's pack-song build, without the page.
async function convert(pack, base, { shrink, synthPatch, name }) {
  const midi = packSong(pack, projectChoices(pack)[0]);
  const asg = roles(midi);
  const plan = arrange(midi, asg, { rate: 16, kit: 0 });
  if (plan.error) throw new Error(plan.error);
  const slots = [...new Set(midi.sources.filter((s) => asg.DR.includes(s.id)).flatMap((s) => s.notes.map((n) => n.slot)))].filter((x) => x != null);
  const c = await composePack(base, pack, { slots, shrink, keepPatches: shrink ? synthPatch : null });
  const projs = buildProjects(plan, base, { title: name, synthPatch, kit: 0, sampleMap: c.sampleMap, color: 3 });
  const buf = await (await buildPack(c.base, projs, { name, color: 'blue' })).arrayBuffer();
  if (saveDir) writeFileSync(`${saveDir}/${name}.circuittrackspack`, Buffer.from(buf));
  return { midi, plan, c, out: await loadPack(buf, `${name}.circuittrackspack`) };
}
// Every hit of a pack's first project: "tick:track:note-or-sample name".
function hitsOf(pack, nameOf = (p, s) => p.samples[s]?.name) {
  const e = projectChoices(pack)[0];
  const song = songOf(pack, e);
  const r = renderSong(song, { order: sceneOrder(song, defaultOrderKind(song)) });
  return r.hits.map((h) => `${Math.round(h.tick / 360)}:${h.track}:${h.sample != null ? nameOf(pack, h.sample) : h.note}${h.sample == null ? `/${Math.round(h.dur / 60)}` : ''}`).sort();
}
function same(label, want, got) {
  const g = new Map(); for (const k of got) g.set(k, (g.get(k) ?? 0) + 1);
  let ok = 0;
  for (const k of want) { if (g.get(k)) { g.set(k, g.get(k) - 1); ok++; } else fail(`${label}: missing ${k}`); }
  for (const [k, n] of g) if (n) fail(`${label}: extra ${k}`);
  console.log(`${label}: ${ok}/${want.length} hits match`);
}

// ---------- 1. Circuit Tracks ----------
{
  const PPQ = 480, S = PPQ / 4;
  const lead = [], bass = [], drums = [];
  for (let bar = 0; bar < 4; bar++) {
    for (let q = 0; q < 4; q++) lead.push({ tick: (bar * 16 + q * 4) * S, dur: 2 * S, note: [60, 64, 67, 71][q] + bar, vel: 90 });
    bass.push({ tick: bar * 16 * S, dur: 3 * S, note: 36 + bar, vel: 100 });
    for (let q = 0; q < 4; q++) drums.push({ tick: (bar * 16 + q * 4) * S, dur: S, note: 36, vel: 110 });
    for (const q of [1, 3]) drums.push({ tick: (bar * 16 + q * 4) * S, dur: S, note: 38, vel: 100 });
    for (let e = 0; e < 8; e++) drums.push({ tick: (bar * 16 + e * 2) * S, dur: S, note: e === 7 ? 46 : 42, vel: 80 });
  }
  const midi = parseMidi(writeSMF({ ppq: PPQ, tempo: 100, name: 'P2P', end: 64 * S, tracks: [
    { name: 'Lead', ch: 1, program: 80, events: lead }, { name: 'Bass', ch: 2, program: 38, events: bass },
    { name: 'Drums', ch: 10, program: null, events: drums }] }).buffer);
  const plan = arrange(midi, roles(midi), { rate: 16, kit: 3 });
  const projs = buildProjects(plan, tracksGM, { title: 'P2P', synthPatch: [80, 38], kit: 3, color: 5 });
  const srcBuf = await (await buildPack(tracksGM, projs, { name: 'P2P src', color: 'green' })).arrayBuffer();
  if (saveDir) writeFileSync(`${saveDir}/P2P source.circuittrackspack`, Buffer.from(srcBuf));
  const first = await loadPack(srcBuf, 'src.circuittrackspack');

  const own = await loadBaseFromBuffers(await (await buildPack(tracksGM, projs, { name: 'P2P src', color: 'green' })).arrayBuffer(), tpl);
  own.fromSong = true;
  const { midi: m2, out, c } = await convert(first, own, { shrink: true, synthPatch: [80, 38], name: 'P2P tracks' });
  const roleList = m2.sources.map((s) => `${s.name}=${s.role}`).join(', ');
  if (!/Synth 1.*=S1/.test(roleList) || !/Drum 1.*=DR/.test(roleList)) fail(`roles: ${roleList}`);
  same('Tracks -> Tracks', hitsOf(first), hitsOf(out));
  const keptS = out.samples.filter((s) => s.present).map((s) => `${s.slot}:${s.name}`);
  const keptP = out.patches.filter((p) => p.present).map((p) => p.slot);
  console.log(`  shrunk: samples ${keptS.join(', ')}; patches ${keptP.join(', ')}; ${c.seconds.toFixed(2)} s`);
  if (keptS.length !== 4 || keptP.join() !== '38,80') fail('shrink kept the wrong slots');
  if (!keptS.every((s) => Number(s.split(':')[0]) >= 24 && Number(s.split(':')[0]) < 32)) fail('Tracks sample slots should keep their numbers (Elec kit 24-31)');
  const { out: full } = await convert(first, own, { shrink: false, synthPatch: [80, 38], name: 'P2P tracks full' });
  if (full.samples.filter((s) => s.present).length !== 64 || full.patches.filter((p) => p.present).length !== 128) fail('not shrinking should keep all 64 samples and 128 patches');
  same('Tracks -> Tracks, not shrunk', hitsOf(first), hitsOf(full));
}

// ---------- 2. Circuit Rhythm ----------
function wav({ ch = 1, rate = 48000, seconds = 0.25, freq = 200 }) {
  const n = Math.round(rate * seconds), size = n * ch * 2, b = new Uint8Array(44 + size), v = new DataView(b.buffer);
  const put = (o, s) => { for (let i = 0; i < 4; i++) b[o + i] = s.charCodeAt(i); };
  put(0, 'RIFF'); v.setUint32(4, 36 + size, true); put(8, 'WAVE'); put(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, ch, true); v.setUint32(24, rate, true); v.setUint32(28, rate * ch * 2, true);
  v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true); put(36, 'data'); v.setUint32(40, size, true);
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) v.setInt16(44 + (i * ch + c) * 2, Math.sin(i * freq * 2 * Math.PI / rate) * 12000 * (1 - i / n), true);
  return b;
}
function rhythmProject(tracks) {
  const d = new Uint8Array(169092), SC = 0x38, BLK = 0x2e4, TAIL = BLK + 64 * 2600;
  d.set([82, 85, 83, 69]);                                     // 'RUSE'
  new DataView(d.buffer).setUint32(4, 169092, true);
  d.set(new TextEncoder().encode('Rhythm test'), 0x10);
  d[0x34] = 120; d[0x35] = 50; d[0x36] = 3;
  tracks.forEach((tr, t) => {
    d[TAIL + 8 + t] = tr.sample;
    const o = BLK + (t * 8) * 2600;
    for (const s of tr.steps) d.set([s.note + 12, 6, 1, s.vel ?? 100, 7, s.sample ?? 0xff, 0, 0], o + s.step * 8);
    d.set([15, 0, 3, 0], o + 256);
  });
  for (let t = tracks.length; t < 8; t++) d[TAIL + 8 + t] = 0;
  for (let t = 0; t < 8; t++) for (let p = 0; p < 8; p++) d.set([15, 0, 3, 0], BLK + (t * 8 + p) * 2600 + 256);
  return d;
}
{
  const names = { 70: 'Kick 909', 80: 'Snare Crack', 90: 'Closed Hat', 91: 'Open Hat', 100: 'Bass Pluck', 101: 'Unused Pad' };
  const files = { 70: wav({ ch: 2, rate: 44100, freq: 60 }), 80: wav({ freq: 300 }), 90: wav({ ch: 2, rate: 44100, freq: 900, seconds: 0.1 }), 91: wav({ freq: 800 }), 100: wav({ freq: 110 }), 101: wav({ seconds: 2 }) };
  const proj = rhythmProject([
    { sample: 70, steps: [0, 4, 8, 12].map((step) => ({ step, note: 60 })) },
    { sample: 80, steps: [4, 12].map((step) => ({ step, note: 60 })) },
    { sample: 90, steps: [0, 2, 4, 6, 8, 10, 12, 14].map((step) => ({ step, note: 60, sample: step === 14 ? 91 : undefined })) },
    { sample: 100, steps: [0, 3, 6, 10].map((step, i) => ({ step, note: [48, 51, 55, 58][i] })) },
  ]);
  const index = {
    name: 'Rhythm test', color: 'red', product: 'circuit-rhythm', version: '2.0',
    projects: Array.from({ length: 64 }, (_, i) => ({ name: i ? '' : 'Rhythm test', url: `projects/project_${i}.ncs` })),
    samples: Array.from({ length: 128 }, (_, i) => ({ name: names[i] ?? '', url: `samples/sample_${i}.wav` })),
  };
  const entries = [{ name: 'index.json', data: new TextEncoder().encode(JSON.stringify(index)) }, { name: 'projects/project_0.ncs', data: proj }];
  for (const [s, b] of Object.entries(files)) entries.push({ name: `samples/sample_${s}.wav`, data: b });
  const rBuf = await writeZip(entries).arrayBuffer();
  if (saveDir) writeFileSync(`${saveDir}/Rhythm test.circuitrhythmpack`, Buffer.from(rBuf));
  const rpack = await loadPack(rBuf, 'test.circuitrhythmpack');
  if (rpack.product !== 'circuit-rhythm') fail('fixture is not read as a Rhythm pack');

  const { midi, out, c } = await convert(rpack, tracksGM, { shrink: true, synthPatch: [38, 0], name: 'P2P rhythm' });
  console.log(`  parts: ${midi.sources.map((s) => `${s.name} (${s.isDrum ? 'drums' : 'notes'})`).join(', ')}`);
  const lanes = {};
  for (const s of midi.sources) if (s.isDrum) for (const n of s.notes) lanes[names[n.slot]] = n.lane ?? null;
  const want = [];
  // One drum track per Rhythm track, busiest first: hats (8 hits) D1, kick (4) D2, snare (2) D3.
  const laneOfName = { 'Closed Hat': 4, 'Open Hat': 4, 'Kick 909': 5, 'Snare Crack': 6 };
  const rh = hitsOf(rpack);
  const rsong = songOf(rpack, projectChoices(rpack)[0]);
  const rr = renderSong(rsong, { order: sceneOrder(rsong, defaultOrderKind(rsong)) });
  for (const h of rr.hits) if (h.track === 3) want.push(`${Math.round(h.tick / 360)}:0:${h.note}/${Math.round(h.dur / 60)}`);  // pitched track -> Synth 1 notes
  for (const k of rh) {
    const [step, track, what] = k.split(':');
    if (track !== '3') want.push(`${step}:${laneOfName[what]}:${what}`);
  }

  same('Rhythm -> Tracks', want, hitsOf(out));
  const kept = out.samples.filter((s) => s.present).map((s) => `${s.slot}:${s.name}`);
  console.log(`  samples: ${kept.join(', ')}; ${c.seconds.toFixed(2)} s; warnings: ${c.warnings.length}`);
  if (kept.join() !== '0:Kick 909,1:Snare Crack,2:Closed Hat,3:Open Hat') fail(`renumbered samples: ${kept.join()}`);
  const z = out.zip;
  for (const s of out.samples.filter((x) => x.present)) {
    const b = new Uint8Array(await z.get(out.index.samples[s.slot].url)());
    const v = new DataView(b.buffer);
    if (v.getUint16(22, true) !== 1 || v.getUint32(24, true) !== 48000 || v.getUint16(34, true) !== 16) fail(`${s.name} is not 48 kHz 16-bit mono`);
  }
  const { out: full } = await convert(rpack, tracksGM, { shrink: false, synthPatch: [38, 0], name: 'P2P rhythm full' });
  const keptFull = full.samples.filter((s) => s.present).map((s) => s.name);
  if (!keptFull.includes('Unused Pad') || keptFull.includes('Bass Pluck') === false) fail(`not shrinking should add the other samples: ${keptFull.join()}`);
  if (full.patches.filter((p) => p.present).length !== 128) fail('not shrinking should keep all patches');
  same('Rhythm -> Tracks, not shrunk', want, hitsOf(full));
}

console.log(errors ? `${errors} problem(s)` : 'pack to pack OK');
process.exit(errors ? 1 : 0);
