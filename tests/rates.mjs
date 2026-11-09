import { readFileSync, readdirSync } from 'node:fs';
import { parseMidi } from '../js/midifile.js';
import { arrange } from '../js/convert.js';
const dir = process.argv[2];
for (const f of readdirSync(dir).filter((x) => /\.mid$/i.test(x))) {
  const b = readFileSync(`${dir}/${f}`);
  const m = parseMidi(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
  const mel = m.sources.filter((s) => !s.isDrum);
  const asg = { S1: [mel[0]?.id], S2: [mel[1]?.id], M1: [mel[2]?.id], M2: [mel[3]?.id], DR: m.sources.filter((s) => s.isDrum).map((s) => s.id) };
  const row = [];
  for (const [rate, div] of [['auto', 1], [16, 1], [8, 1], [4, 1], [4, 2], [4, 4]]) {
    const p = arrange(m, asg, { rate, tempoDiv: div, sectionBars: 'auto' });
    row.push(p.error ? `${rate}/${div}:ERR` : `${rate}:${p.projects.length}p ${p.tempo}bpm ${(p.warnings.movedRatio * 100).toFixed(0)}%mv${rate === 'auto' ? `(=${p.rate})` : ''}`);
  }
  console.log(f.slice(0, 18).padEnd(18), row.join(' | '));
}
// mute test
const b = readFileSync(`${dir}/Dance.mid`); const m = parseMidi(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
const mel = m.sources.filter((s) => !s.isDrum), dr = m.sources.filter((s) => s.isDrum);
const asg = { S1: [mel[0].id], S2: [mel[1].id], DR: dr.map((s) => s.id) };
const base = arrange(m, asg, {});
const mutes = { all: new Set([mel[1].id]), bars: new Map([['lane6', new Set([...Array(200).keys()])], [mel[0].id, new Set([8, 9, 10, 11])]]) };
const mp = arrange(m, asg, { mutes });
const count = (p, t) => p.contents[t].reduce((a, c) => a + c.steps.length, 0);
console.log('mute test: S2 steps', count(base, 1), '->', count(mp, 1), '| hats', count(base, 6), '->', count(mp, 6), '| S1', count(base, 0), '->', count(mp, 0), '| projects', base.projects.length, '->', mp.projects.length);
