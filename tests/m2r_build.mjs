// MIDI2Rhythm end to end without a browser: MIDI -> tracks -> arrangement -> pack, then the
// pack read back with Circuit2MIDI's reader (js/pack.js, js/rhythm.js) and every built step
// checked against the arrangement.
// Run from the repo root: node tests/m2r_build.mjs <file.mid>... [--out dir]
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { parseMidi } from '../js/midifile.js';
import { planTracks, METHODS } from '../js/m2r/engine.js';
import { arrangeRhythm } from '../js/m2r/arrange.js';
import { buildRhythmProjects, buildRhythmPack, openPack, usedSamples } from '../js/m2r/build.js';
import { loadPack } from '../js/pack.js';

const args = process.argv.slice(2);
const outAt = args.indexOf('--out');
const outDir = outAt >= 0 ? args.splice(outAt, 2)[1] : null;
const ab = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
const inst = await openPack(ab(readFileSync('rhythmgm/RhythmInstGM.circuitrhythmpack')));
const drums = await openPack(ab(readFileSync('rhythmgm/RhythmDrumGM.circuitrhythmpack')));
const meta = JSON.parse(readFileSync('rhythmgm/rhythmdrumgm_samples.json', 'utf8'));
const template = ab(readFileSync('data/RhythmEmpty.ncs'));
const KIT = 3; // Elec
const kit = meta.samples.slice(KIT * 16, KIT * 16 + 16);
const names = inst.index.samples.map((s) => s.name);
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } };

for (const f of args) {
  const midi = parseMidi(ab(readFileSync(f)));
  const t0 = Date.now();
  const res = planTracks(midi, names, kit, {});
  const plan = arrangeRhythm(midi, res.tracks, {});
  if (plan.error) { console.log(basename(f), 'ERROR', plan.error); fails++; continue; }
  const projects = buildRhythmProjects(plan, res.tracks, template, { title: basename(f, '.mid'), colors: [] });
  const blob = await buildRhythmPack(inst, drums, KIT, projects, { name: 'Test', used: usedSamples(plan, res.tracks) });
  const zip = new Uint8Array(await blob.arrayBuffer());
  const ms = Date.now() - t0;
  const pack = await loadPack(zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength), 'x.circuitrhythmpack');
  ok(pack.product === 'circuit-rhythm', 'product');
  ok(pack.samples.length === 128 && pack.samples.every((s) => s.present), '128 samples present');
  ok(pack.samples.slice(112).every((s, i) => s.name === kit[i].name), 'kit in 113-128');
  const built = pack.projects.filter((p) => !p.empty);
  ok(built.length === plan.projects.length, `projects ${built.length} vs ${plan.projects.length}`);
  // every step of every pattern as arranged
  let steps = 0, bad = 0;
  plan.projects.forEach((p, pi) => {
    const proj = pack.projects[pi].project;
    ok(proj.tempo === plan.tempo, 'tempo');
    for (let t = 0; t < 8; t++) {
      if (!plan.active[t]) continue;
      p.patterns[t].forEach((c, i) => {
        const pat = proj.patterns[t][i];
        ok(pat.settings.syncRate === plan.trackRates[t].syncRate && pat.settings.playbackEnd === plan.trackRates[t].patLen - 1, 'pattern settings');
        for (const st of c?.steps ?? []) {
          steps++;
          const s = pat.steps[st.step];
          const sample = s.sample === 0xff ? proj.defaultSamples[t] : s.sample;
          if (s.note !== st.byte || s.mask !== st.mask || sample !== st.sample || s.velocity !== st.vel) bad++;
        }
      });
    }
    p.scenes.forEach((sc, s) => ok(proj.scenes[s].flags === 1 && proj.scenes[s].trackChains.every((ch, t) => ch.start === sc.chains[t].start && ch.end === sc.chains[t].end), 'scene chains'));
  });
  ok(bad === 0, `${bad} steps differ`);
  const kinds = res.parts.map((r) => `${r.name.slice(0, 18)}:${r.kind}${r.method ? '/' + r.method : ''}${r.shift ? ' ' + (r.shift > 0 ? '+' : '') + r.shift : ''}${r.folded ? ' f' + r.folded : ''}${r.dropped ? ' DROPPED' : ''}`);
  console.log(`${basename(f)}: ${res.tracks.length} tracks [${res.tracks.map((t) => t.label.slice(0, 22)).join(' | ')}], ${plan.projects.length} project(s), ${steps} steps, rates ${plan.trackRates.map((r) => r.rate).join('/')}, lost ${plan.warnings.lost}/${plan.warnings.total}, ${(zip.length / 1e6).toFixed(1)} MB, ${ms} ms`);
  console.log('   ', kinds.join('; '));
  if (res.dropped.length) console.log('    dropped:', res.dropped.map((d) => d.label).join(', '));
  if (outDir) writeFileSync(`${outDir}/${basename(f, '.mid')}.circuitrhythmpack`, zip);
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
