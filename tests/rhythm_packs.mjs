// RhythmInstGM and RhythmDrumGM read back like Components-saved Rhythm packs: product
// circuit-rhythm, 128 named samples all present, 64 empty projects (slot 0 "User Session"),
// 16 default Grid FX (effectType 127, 7f 00 00 00 00 00 00), compact index.json.
// Run from the repo root after building: node tests/rhythm_packs.mjs
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { loadPack } from '../js/pack.js';

const EMPTY_MD5 = 'e1c697f7b24fba4531716cbc02af5b2a';   // Components' blank project slot
let errors = 0;
const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) errors++; };

for (const name of ['RhythmInstGM', 'RhythmDrumGM']) {
  const b = readFileSync(`rhythmgm/${name}.circuitrhythmpack`);
  const pack = await loadPack(b.buffer.slice(b.byteOffset, b.byteOffset + b.length), `${name}.circuitrhythmpack`);
  ok(pack.product === 'circuit-rhythm' && pack.name === name, `${name}: product and name`);
  ok(pack.samples.length === 128 && pack.samples.every((s) => s.present && s.name), `${name}: 128 named samples, all present`);
  ok(pack.samples.every((s) => s.name.length <= 18), `${name}: sample names 18 characters or fewer`);
  ok(pack.projects.length === 64 && pack.projects.every((p) => p.empty && !p.error), `${name}: 64 empty projects`);
  ok(pack.index.projects[0].name === 'User Session' && pack.index.projects.slice(1).every((p) => p.name === ''), `${name}: project names as Components writes them`);
  const md5s = new Set();
  for (const p of pack.index.projects) md5s.add(createHash('md5').update(Buffer.from(await pack.zip.get(p.url)())).digest('hex'));
  ok(md5s.size === 1 && md5s.has(EMPTY_MD5), `${name}: every project is Components' blank template`);
  const ge = pack.index.gridEffects ?? [];
  let geOk = ge.length === 16 && ge.every((g) => g.effectType === 127);
  for (const g of ge) geOk &&= Buffer.from(await pack.zip.get(g.url)()).equals(Buffer.from([0x7f, 0, 0, 0, 0, 0, 0]));
  ok(geOk, `${name}: 16 default Grid FX`);
  const raw = new TextDecoder().decode(await pack.zip.get('index.json')());
  ok(!/\n/.test(raw) && raw.startsWith(`{"name":"${name}"`), `${name}: compact index.json in Components' key order`);
  for (const s of pack.samples.slice(0, 128)) {
    const w = Buffer.from(await pack.zip.get(s.url)());
    if (!(w.readUInt16LE(22) === 1 && w.readUInt32LE(24) === 48000 && w.readUInt16LE(34) === 16)) { ok(false, `${name}: ${s.name} is not 48 kHz 16-bit mono`); break; }
  }
}
console.log(errors ? `${errors} failed` : 'all passed');
process.exit(errors ? 1 : 0);
