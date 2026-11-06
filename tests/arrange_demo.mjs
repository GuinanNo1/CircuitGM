import { readFileSync, readdirSync } from 'node:fs';
import { parseMidi } from '../js/midifile.js';
import { arrange, playOrder } from '../js/convert.js';
const dir = process.argv[2];
for (const f of readdirSync(dir).filter((x) => /\.mid$/i.test(x))) {
  const b = readFileSync(`${dir}/${f}`);
  const m = parseMidi(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
  const mel = m.sources.filter((s) => !s.isDrum);
  const asg = { S1: [mel[0]?.id], S2: [mel[1]?.id], M1: [mel[2]?.id], M2: [mel[3]?.id], DR: m.sources.filter((s) => s.isDrum).map((s) => s.id) };
  for (const [rate, match] of [['auto','exact'],['auto','loose']]) {
    const p = arrange(m, asg, { rate, match });
    if (p.error) { console.log(f, rate, p.error); continue; }
    const counts = p.projects.map((pr) => `${pr.scenes.length}sc[${pr.patternCounts.join('')}]`).join(' ');
    console.log(`${f.slice(0, 22).padEnd(22)} ${match.padEnd(5)} -> ${p.rateLabel}, ${p.chunkBars}-bar patterns, ${p.nSections} sections, ${p.projects.length} projects: ${counts} | warn ${JSON.stringify(p.warnings)} | play ${playOrder(p).length} chunks`);
  }
}
