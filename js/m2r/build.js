// MIDI2Rhythm: arrangement (js/m2r/arrange.js) -> Circuit Rhythm .ncs projects ->
// .circuitrhythmpack built on RhythmInstGM, with the chosen drum kit in slots 113-128.
//
// Project template: data/RhythmEmpty.ncs, a project saved empty on the Circuit Rhythm itself
// (so its mixer and FX settings are the hardware's own defaults), with the name and tempo
// reset and the track sends at 0. Layout: docs/circuit-rhythm-format.md.
import { readZip, writeZipDeflate } from '../vendor/zip.js';
import { cleanName } from '../names.js';
import { KIT_FIRST } from './engine.js';

const SC_BASE = 0x38;
const BLOCK_BASE = 0x2e4;
const BLOCK_SIZE = 2600;
const TAIL = BLOCK_BASE + 64 * BLOCK_SIZE;   // 0x28ce4
const T_DEFAULT_SAMPLES = 8;
const T_TRACK_ROWS = 44;                       // 8 x 41 bytes; byte 6 = the track's sample again
const ROW_TUNE = 16;                           // row byte 16: the track's Tune (macro 1), 64 = no change
const TUNE_CENTRE = 64;
const NO_SAMPLE = 0xff;

export async function fetchBuf(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Could not load ${url} (${r.status})`);
  return r.arrayBuffer();
}

export async function openPack(buf) {
  const zip = readZip(buf);
  const get = zip.get('index.json');
  if (!get) throw new Error('This pack has no index.json.');
  const index = JSON.parse(new TextDecoder().decode(await get()));
  return { zip, index };
}

// plan: from arrangeRhythm; tracks: from planTracks (default samples); template: ArrayBuffer.
// settings: { title, colors: [0-13 per project] }
export function buildRhythmProjects(plan, tracks, template, settings) {
  const n = plan.projects.length;
  return plan.projects.map((p) => {
    const d = new Uint8Array(template.slice(0));
    const name = n > 1 ? shortName(settings.title, 16 - String(p.index + 1).length - 1) + ` ${p.index + 1}` : shortName(settings.title);
    const nameBytes = new TextEncoder().encode(name.padEnd(32, ' ').slice(0, 32));
    d.set(nameBytes, 0x10);
    new DataView(d.buffer).setUint32(0x0c, (settings.colors?.[p.index] ?? 8) % 14, true);
    d[0x34] = plan.tempo;
    d[0x35] = 50;
    // Scenes: zeroed, then each used scene's chains and its header (stored flag, no mutes),
    // which sits after its chains (base + 40), as on the Circuit Tracks.
    d.fill(0, SC_BASE + 1, SC_BASE + 684);
    p.scenes.forEach((sc, s) => {
      const base = SC_BASE + s * 40;
      for (let t = 0; t < 8; t++) { d[base + 8 + t * 4] = sc.chains[t].start; d[base + 9 + t * 4] = sc.chains[t].end; }
      d[base + 40] = 1;
      d[base + 41] = 0;
    });
    d[SC_BASE + 648] = 0;
    d[SC_BASE + 649] = p.scenes.length - 1;
    for (let t = 0; t < 8; t++) { d[SC_BASE + 652 + t * 4] = p.scenes[0].chains[t].start; d[SC_BASE + 653 + t * 4] = p.scenes[0].chains[t].end; }

    for (let t = 0; t < 8; t++) {
      const def = tracks[t]?.defaultSample ?? 0;
      const tr = plan.trackRates[t];
      for (let i = 0; i < 8; i++) {
        const o = BLOCK_BASE + (t * 8 + i) * BLOCK_SIZE;
        // Empty steps as the Rhythm saves them: note 0, gate 6, no hits, probability 7,
        // the track's own sample.
        for (let s = 0; s < 32; s++) d.set([0, 6, 0, 0, 7, NO_SAMPLE, 0, 0], o + s * 8);
        d.fill(0, o + 256, o + 296);
        d[o + 256] = (plan.active[t] ? tr.patLen : 16) - 1;
        d[o + 258] = plan.active[t] ? tr.syncRate : 3;
        d.fill(0xff, o + 296, o + BLOCK_SIZE);
        const content = plan.active[t] ? p.patterns[t][i] : null;
        if (!content) continue;
        for (const st of content.steps) {
          const so = o + st.step * 8;
          d[so] = st.byte;
          d[so + 1] = st.gate;
          d[so + 2] = st.mask;
          d[so + 3] = st.vel;
          d[so + 4] = 7;
          d[so + 5] = st.sample === def ? NO_SAMPLE : st.sample;
        }
      }
      d[TAIL + T_DEFAULT_SAMPLES + t] = def;
      d[TAIL + T_TRACK_ROWS + t * 41 + 6] = def;
      // Tune at centre, so every track plays its notes at the pitch the step bytes say (the
      // template's source project had track 4 tuned down 9 steps, about 1.8 semitones).
      d[TAIL + T_TRACK_ROWS + t * 41 + ROW_TUNE] = TUNE_CENTRE;
    }
    return { name, bytes: d };
  });
}

// The pack: RhythmInstGM's 128 samples, with slots 113-128 replaced by the kit (16 samples
// of a RhythmDrumGM or RhythmLatinGM kit), plus the projects. trim: keep only the samples the
// projects use (the others keep a blank name and no file, as Components stores an empty slot).
export async function buildRhythmPack(inst, drums, kitIndex, projects, { name, color = 'blue', trim = false, used = null }) {
  const index = JSON.parse(JSON.stringify(inst.index));
  index.name = shortName(name) || 'MIDI2Rhythm';
  index.color = color;
  const files = new Map();
  for (const [i, s] of index.samples.entries()) {
    if (i < KIT_FIRST) {
      const get = inst.zip.get(s.url);
      if (get) files.set(s.url, new Uint8Array(await get()));
      continue;
    }
    const src = drums.index.samples[kitIndex * 16 + (i - KIT_FIRST)];
    s.name = src?.name ?? '';
    const get = src?.url ? drums.zip.get(src.url) : null;
    if (get) files.set(s.url, new Uint8Array(await get()));
  }
  if (trim && used) {
    index.samples.forEach((s, i) => { if (!used.has(i)) { s.name = ''; files.delete(s.url); } });
  }
  index.projects = index.projects.map((p, i) => ({ name: projects[i]?.name ?? '', url: p?.url ?? `projects/project_${i}.ncs` }));
  const entries = [{ name: 'index.json', data: new TextEncoder().encode(JSON.stringify(index)) }];
  for (const dir of ['grid_effects/', 'projects/', 'samples/']) entries.push({ name: dir, data: new Uint8Array(0) });
  for (const g of index.gridEffects ?? []) {
    const get = inst.zip.get(g.url);
    if (get) entries.push({ name: g.url, data: new Uint8Array(await get()) });
  }
  for (const [i, p] of index.projects.entries()) {
    if (projects[i]) { entries.push({ name: p.url, data: projects[i].bytes }); continue; }
    const get = inst.zip.get(p.url);                       // Components' blank project slot
    if (get) entries.push({ name: p.url, data: new Uint8Array(await get()) });
  }
  for (const s of index.samples) if (files.has(s.url)) entries.push({ name: s.url, data: files.get(s.url) });
  return writeZipDeflate(entries);
}

// Sample slots the projects play (each track's default plus every step's own).
export function usedSamples(plan, tracks) {
  const used = new Set();
  tracks.forEach((t, i) => { if (plan.active[i]) used.add(t.defaultSample); });
  for (const p of plan.projects) for (const pats of p.patterns) for (const c of pats) for (const s of c?.steps ?? []) used.add(s.sample);
  return used;
}

// Names of up to 16 characters (Components' limit): whole words while they fit, otherwise
// the first word cut. No vowel-dropping.
export function shortName(s, max = 16) {
  const name = cleanName(s);
  if (name.length <= max) return name;
  let out = '';
  for (const w of name.split(' ')) {
    const t = out ? `${out} ${w}` : w;
    if (t.length > max) break;
    out = t;
  }
  return (out || name.slice(0, max)).trim();
}
