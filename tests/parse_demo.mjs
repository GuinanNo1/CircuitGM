import { readFileSync, readdirSync } from 'node:fs';
import { parseMidi } from '../js/midifile.js';
const dir = process.argv[2];
for (const f of readdirSync(dir).filter((x) => /\.mid$/i.test(x))) {
  const b = readFileSync(`${dir}/${f}`);
  const m = parseMidi(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
  const bars = m.lengthTicks / (m.ppq * 4 * m.timeSig.num / m.timeSig.den);
  console.log(`${f}: fmt ${m.format} ppq ${m.ppq} ${m.tempo.toFixed(1)} bpm (+${m.tempoChanges} changes) ${m.timeSig.num}/${m.timeSig.den} ${bars.toFixed(1)} bars`);
  for (const s of m.sources) console.log(`   ${s.index} ch${s.channel + 1} ${s.name} [${s.instrument}] ${s.notes.length} notes`);
}
