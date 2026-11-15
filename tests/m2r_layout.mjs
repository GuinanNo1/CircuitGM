// MIDI2Rhythm "Keep the project's layout": a Circuit pack project -> one Rhythm project with the
// same scenes, chains and patterns. Builds the pack, reads it back with js/pack.js and checks
// that every scene chain, pattern setting and hit matches the source project.
// Run from the repo root: node tests/m2r_layout.mjs <pack>[@project]... [--combine] [--out dir]
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { loadPack } from '../js/pack.js';
import { packSong, projectChoices } from '../js/packsong.js';
import { songOf, sceneOrder, defaultOrderKind } from '../js/song.js';
import { ownSamples } from '../js/m2r/engine.js';
import { layoutPlan, layoutSamples, renderLayout } from '../js/m2r/layout.js';
import { buildLayoutProject, buildRhythmPack, openPack } from '../js/m2r/build.js';

const args = process.argv.slice(2);
const combine = args.includes('--combine');
const outAt = args.indexOf('--out');
const outDir = outAt >= 0 ? args.splice(outAt, 2)[1] : null;
const files = args.filter((a) => !a.startsWith('--'));
const ab = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
const inst = await openPack(ab(readFileSync('rhythmgm/RhythmInstGM.circuitrhythmpack')));
const drums = await openPack(ab(readFileSync('rhythmgm/RhythmDrumGM.circuitrhythmpack')));
const meta = JSON.parse(readFileSync('rhythmgm/rhythmdrumgm_samples.json', 'utf8'));
const template = ab(readFileSync('data/RhythmEmpty.ncs'));
const kit = meta.samples.slice(16, 32);
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } };

for (const arg of files) {
  const [f, at] = arg.split('@');
  const src = await loadPack(ab(readFileSync(f)), f);
  const entries = at ? [src.projects[Number(at) - 1]] : projectChoices(src);
  for (const entry of entries) {
    const m = packSong(src, entry);
    const own = ownSamples(m, new Map(), src.samples.map((s) => s.name));
    const names = inst.index.samples.map((s) => s.name);
    for (const [from, to] of own.slotOf) names[to] = src.samples[from].name;
    const plan = layoutPlan(m.song, m.sources, { names, own, kit, combine, project: entry.project });
    const project = buildLayoutProject(plan, template, { title: entry.name || 'Test', color: plan.color });
    const replace = new Map([...own.slotOf].map(([from, to]) => [to, { name: src.samples[from].name, bytes: new Uint8Array(1) }]));
    const blob = await buildRhythmPack(inst, drums, 1, [project], { name: 'Test', used: layoutSamples(plan), replace });
    const zip = new Uint8Array(await blob.arrayBuffer());
    const back = await loadPack(zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength), 'x.circuitrhythmpack');
    const song = songOf(back, back.projects[0]);
    const label = `${basename(f).replace(/\.circuit\w+pack$/, '')}@${entry.slot + 1}`;
    ok(back.projects.filter((p) => !p.empty).length === 1, `${label}: one project`);
    ok(song.tempo === plan.tempo, `${label}: tempo`);
    ok(back.projects[0].project.color === entry.project.color, `${label}: colour ${back.projects[0].project.color} vs ${entry.project.color}`);
    // each Rhythm drum track's Tune carries its Tracks drum track's Pitch (Rhythm: its Tune)
    const tunes = back.projects[0].project.trackTunes;
    plan.tracks.forEach((tr, t) => {
      if (!tr || tr.kind === 'timing') return;
      const want = tr.kind !== 'drum' && m.song.product !== 'circuit-rhythm' ? 64
        : m.song.product === 'circuit-rhythm' ? entry.project.trackTunes[tr.src[0]] : entry.project.drumConfigs[tr.src[0] - 4].pitch;
      ok(tunes[t] === want, `${label}: track ${t + 1} tune ${tunes[t]} vs ${want}`);
    });
    // scenes: same used scenes, chains follow each Rhythm track's source track
    m.song.scenes.forEach((sc, s) => {
      if (!sc.used) return;
      ok(song.scenes[s].used, `${label}: scene ${s + 1} used`);
      plan.tracks.forEach((tr, t) => { if (tr) ok(song.scenes[s].chains[t].start === sc.chains[tr.src[0]].start && song.scenes[s].chains[t].end === sc.chains[tr.src[0]].end, `${label}: scene ${s + 1} track ${t + 1} chain`); });
    });
    // patterns: settings, and every source hit on its Rhythm track (drums) or voice (synths)
    let hits = 0, bad = 0;
    plan.tracks.forEach((tr, t) => {
      if (!tr || tr.kind === 'timing') return;
      for (let p = 0; p < 8; p++) {
        const a = song.tracks[t].patterns[p];
        const srcPat = m.song.tracks[tr.src[0]].patterns[p];
        ok(a.start === srcPat.start && a.end === srcPat.end && a.rate === srcPat.rate && a.dir === srcPat.dir, `${label}: track ${t + 1} pattern ${p + 1} settings`);
        for (let i = 0; i < 32; i++) {
          const want = tr.src.flatMap((x) => m.song.tracks[x].patterns[p].steps[i].hits);
          const got = a.steps[i].hits;
          if (tr.kind === 'drum') {
            hits += want.length;
            if (new Set(want.map((h) => h.micro)).size !== got.length) bad++;
            else if (want.length && got[0].vel !== want[0].vel) bad++;
          } else if (want.length > tr.voice) {
            hits++;
            if (got.length !== 1) bad++;
          }
        }
      }
    });
    ok(bad === 0, `${label}: ${bad} of ${hits} steps differ`);
    // length: the rendered layout is as long as the source played through
    const order = sceneOrder(m.song, defaultOrderKind(m.song));
    const r1 = renderLayout(plan, order).length;
    ok(Math.abs(r1 - m.lengthTicks) < 1, `${label}: length ${r1} vs ${m.lengthTicks}`);
    console.log(`${label}: ${plan.nScenes} scenes, tracks [${plan.tracks.map((t, i) => `${i + 1}:${t ? t.label.slice(0, 26) : '–'}`).join(' | ')}], ${hits} steps checked, voices ${m.sources.filter((s) => !s.isDrum).map((s) => `${s.name.slice(0, 12)} ${s._voices ?? '-'}/${s._need ?? '-'}`).join(', ')}`);
    if (outDir) writeFileSync(`${outDir}/${label.replace('@', ' ')}.circuitrhythmpack`, zip);
  }
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
