// End-to-end: MIDI -> plan -> .ncs -> pack; then read everything back and compare.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { parseMidi } from '../js/midifile.js';
import { arrange, playOrder, KIT_PARTS } from '../js/convert.js';
import { loadBaseFromBuffers, buildProjects, buildPack } from '../js/build.js';
import { parseNCS } from '../js/vendor/ncs.js';
import { readZip } from '../js/vendor/zip.js';
const ab = (p) => { const b = readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); };
const file = process.argv[2], outDir = process.argv[3] ?? '/tmp/out';
mkdirSync(outDir, { recursive: true });
const m = parseMidi(ab(file));
const mel = m.sources.filter((s) => !s.isDrum);
const asg = { S1: [mel[0].id], S2: [mel[1].id, mel[2].id], M1: [mel[3]?.id], M2: [mel[4]?.id], DR: m.sources.filter((s) => s.isDrum).map((s) => s.id) };
const plan = arrange(m, asg, { rate: process.argv[4] ?? 'auto', kit: 3 });
const base = await loadBaseFromBuffers(ab('data/TracksGM_final.circuittrackspack'), ab('data/Empty.ncs'));
const projs = buildProjects(plan, base, { title: 'Test Song', synthPatch: [mel[0].program, mel[1].program], kit: 3, color: 5 });
const blob = await buildPack(base, projs, { name: 'TracksGM Test', color: 'green' });
const packBuf = await blob.arrayBuffer();
writeFileSync(`${outDir}/test.circuittrackspack`, Buffer.from(packBuf));
projs.forEach((p, i) => writeFileSync(`${outDir}/project_${i}.ncs`, p.bytes));
// read back
const zip = readZip(packBuf);
const idx = JSON.parse(new TextDecoder().decode(await zip.get('index.json')()));
let errors = 0, notesChecked = 0, hitsChecked = 0;
for (const [pi, p] of plan.projects.entries()) {
  const pr = parseNCS(await zip.get(`projects/project_${pi}.ncs`)());
  if (pr.tempo !== plan.tempo || pr.scaleType !== 15) { errors++; console.log('header mismatch'); }
  for (let t = 0; t < 8; t++) {
    if (!plan.active[t]) continue;
    for (let i = 0; i < p.patterns[t].length; i++) {
      const want = p.patterns[t][i];
      const got = pr.patterns[t][i];
      if (got.settings.playbackEnd !== plan.patLen - 1 || got.settings.syncRate !== plan.syncRate) { errors++; }
      if (t < 4) {
        for (const s of want.steps) for (const n of s.notes) {
          notesChecked++;
          const st = got.steps[s.step];
          const k = st.notes.findIndex((x, j) => (st.mask >> j & 1) && x.note === n.note && x.delay === n.delay && x.velocity === n.vel && !x.cont);
          const g = k < 0 ? -1 : st.notes[k].gate;
          if (k < 0 || (g & 0x7f) !== Math.min(96, n.len) || ((g & 0x80) && n.len <= 96)) { errors++; if (errors < 5) console.log('note mismatch', t, i, s.step, n, st); }
        }
      } else {
        for (const s of want.steps) {
          hitsChecked++;
          const st = got.steps[s.step];
          const mask = st.micro ? st.micro.reduce((a, on, b) => a | (on ? 1 << b : 0), 0) : (st.active ? 1 : 0);
          if (!st.active || st.velocity !== s.vel || mask !== s.mask) { errors++; if (errors < 5) console.log('hit mismatch', t, i, s, st); }
        }
      }
    }
  }
  for (const [si, sc] of p.scenes.entries()) {
    const g = pr.scenes[si];
    if (g.flags !== (si === 0 ? 0 : 1) || sc.chains.some((c, t) => g.trackChains[t].start !== c.start || g.trackChains[t].end !== c.end)) { errors++; console.log('scene mismatch', si); }
  }
  if (pr.sceneChain.start !== 0 || pr.sceneChain.end !== p.scenes.length - 1) errors++;
}
console.log(`plan: ${plan.rateLabel}, ${plan.projects.length} projects, tempo ${plan.tempo}; pack projects ${idx.projects.filter((x) => x.name).map((x) => x.name).join(', ')}; patches ${idx.patches.length}, samples ${idx.samples.filter((s) => s.name).length}`);
console.log(`checked ${notesChecked} notes, ${hitsChecked} drum hits: ${errors} errors; pack ${packBuf.byteLength} bytes`);
