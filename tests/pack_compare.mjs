// Convert every project of a Circuit Tracks or Circuit Rhythm pack with MIDI2Circuit (default
// parts, step rate per track, shrunk), then play the built pack back with Circuit2MIDI's reader
// and compare every hit with the original: time, sample name (drums) or note (synths).
// node tests/pack_compare.mjs <pack> [rate: track|auto|16|8|4] [save.circuittrackspack]
import { readFileSync, writeFileSync } from 'node:fs';
import { loadPack } from '../js/pack.js';
import { packSong, projectChoices } from '../js/packsong.js';
import { arrange } from '../js/convert.js';
import { loadBaseFromBuffers, buildProjects, buildPack, composePack } from '../js/build.js';
import { songOf, renderSong, sceneOrder, defaultOrderKind } from '../js/song.js';

const ab = (p) => { const b = readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); };
const [file, rate = 'track', save] = process.argv.slice(2);
const buf = ab(file);
const pack = await loadPack(buf, file);
const tpl = ab('data/Empty.ncs');
let base = await loadBaseFromBuffers(ab('data/TracksGM_final.circuittrackspack'), tpl);
if (pack.product === 'circuit-tracks') { base = await loadBaseFromBuffers(buf, tpl); base.fromSong = true; }
let bad = 0;

for (const entry of projectChoices(pack)) {
  const midi = packSong(pack, entry);
  const a = { S1: [], S2: [], M1: [], M2: [], DR: [] };
  if (midi.sources.some((s) => s.role)) for (const s of midi.sources) { if (s.role) a[s.role].push(s.id); }
  const plan = arrange(midi, a, { rate: rate === 'track' || rate === 'auto' ? rate : Number(rate), kit: 0 });
  if (plan.error) { console.log(`${entry.name}: ${plan.error}`); bad++; continue; }
  const drumIds = new Set(a.DR);
  const slots = [...new Set(midi.sources.filter((s) => drumIds.has(s.id)).flatMap((s) => s.notes.map((n) => n.slot)))].filter((x) => x != null);
  const synthPatch = [0, 1].map((t) => midi.sources.find((s) => a[['S1', 'S2'][t]].includes(s.id))?.patchSlot ?? midi.sources.find((s) => a[['S1', 'S2'][t]].includes(s.id))?.program ?? 0);
  const c = await composePack(base, pack, { slots, shrink: true, keepPatches: synthPatch });
  const projs = buildProjects(plan, base, { title: entry.name.slice(0, 24), synthPatch, kit: 0, sampleMap: c.sampleMap, color: 3 });
  const outBuf = await (await buildPack(c.base, projs, { name: 'Compare', color: 'blue' })).arrayBuffer();
  if (save) writeFileSync(save, Buffer.from(outBuf));
  const out = await loadPack(outBuf, 'out.circuittrackspack');

  // Original: hits of the parts that were placed, by the role they were given.
  const roleOf = new Map(Object.entries(a).flatMap(([r, ids]) => ids.map((id) => [id, r])));
  const want = [];
  for (const s of midi.sources) {
    const r = roleOf.get(s.id);
    if (!r) continue;
    for (const n of s.notes) want.push(r === 'DR' ? `${n.tick - plan.startTick}:D:${pack.samples[n.slot]?.name}` : `${n.tick - plan.startTick}:${r}:${n.note}`);
  }
  // Built: every project in order, laid end to end.
  const got = [];
  let at = 0;
  for (const e of projectChoices(out)) {
    const song = songOf(out, e);
    const rr = renderSong(song, { order: sceneOrder(song, defaultOrderKind(song)) });
    for (const h of rr.hits) {
      const r = ['S1', 'S2', 'M1', 'M2'][h.track];
      got.push(r ? `${at + h.tick}:${r}:${h.note}` : `${at + h.tick}:D:${out.samples[h.sample]?.name}`);
    }
    at += rr.length;
  }
  const g = new Map(); for (const k of got) g.set(k, (g.get(k) ?? 0) + 1);
  let ok = 0; const missing = [];
  for (const k of want) { if (g.get(k)) { g.set(k, g.get(k) - 1); ok++; } else missing.push(k); }
  const extra = [...g].flatMap(([k, n]) => Array(n).fill(k));
  const dropped = plan.warnings.drumDropped + plan.warnings.dropped + plan.warnings.merged;
  const rates = plan.trackRates.map((x, t) => (plan.active[t] ? x.label.replace(' steps', '') : '-')).join(' ');
  console.log(`${entry.slot + 1}. ${entry.name}: ${plan.projects.length} project(s), ${plan.projects.map((p) => p.scenes.length).join('+')} scenes, rates ${rates}; ${ok}/${want.length} hits match, ${missing.length} missing (${dropped} reported dropped), ${extra.length} extra`);
  for (const k of missing.slice(0, 5)) console.log('   missing', k);
  for (const k of extra.slice(0, 5)) console.log('   extra', k);
  if (missing.length !== dropped || extra.length) bad++;
}
console.log(bad ? `${bad} project(s) differ beyond the reported drops` : 'all hits accounted for');
process.exit(bad ? 1 : 0);
