// Projects needed per song under different repeat-finding settings.
import { readFileSync, readdirSync } from 'node:fs';
import { parseMidi } from '../js/midifile.js';
import { arrange } from '../js/convert.js';
const dir = process.argv[2];
const configs = [
  ['old', { align: false, sectionBars: 8 }],
  ['+chain/aln', { sectionBars: 8 }],
  ['+autoSec', { sectionBars: 'auto' }],
  ['+q1/16', { sectionBars: 'auto', quantize: 0.25 }],
  ['sim90', { sectionBars: 'auto', match: 'similar90' }],
  ['sim75', { sectionBars: 'auto', match: 'similar75' }],
  ['sim75+q', { sectionBars: 'auto', match: 'similar75', quantize: 0.25 }],
  ['8bar', { rate: 4, sectionBars: 'auto' }],
  ['8bar sim75', { rate: 4, sectionBars: 'auto', match: 'similar75' }],
  ['÷2 sim75', { tempoDiv: 2, sectionBars: 'auto', match: 'similar75' }],
];
console.log('song'.padEnd(14), configs.map(([n]) => n.padStart(11)).join(''));
const t0 = Date.now();
for (const f of readdirSync(dir).filter((x) => /\.mid$/i.test(x))) {
  const b = readFileSync(`${dir}/${f}`);
  const m = parseMidi(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
  const mel = m.sources.filter((s) => !s.isDrum);
  const asg = { S1: [mel[0]?.id], S2: [mel[1]?.id], M1: [mel[2]?.id], M2: [mel[3]?.id], DR: m.sources.filter((s) => s.isDrum).map((s) => s.id) };
  const cells = configs.map(([, o]) => {
    const p = arrange(m, asg, o);
    if (p.error) return 'ERR'.padStart(11);
    const w = p.warnings;
    const chg = w.similarNotes ? `~${Math.round(100 * w.similarNotes / w.total)}%` : '';
    return `${p.projects.length}p${p.leadBars ? '+' + p.leadBars : ''}${chg}`.padStart(11);
  });
  console.log(f.slice(0, 14).padEnd(14), cells.join(''));
}
console.log(`time ${Date.now() - t0} ms`);
