// Arrangement -> .ncs projects -> .circuittrackspack (the base pack's patches and samples,
// TracksGM_v1 by default, plus the new projects).
import { fitName, numbered } from './names.js';
import { parseNCS, serializeNCS } from './vendor/ncs.js';
import { readZip, writeZip } from './vendor/zip.js';
import { KIT_PARTS, MAX_NOTES, MICRO } from './convert.js';

const STEPS = 32;
const MAX_GATE = 96;                 // 16 steps; longer notes continue with a tied note
const DRUM0_HEADER = 0xcd64;         // byte 0 = Synth 1 patch slot, byte 8 = Synth 2 patch slot
const DEFAULT_DRUM_CHOICES = 0x1a278; // 4 bytes: default sample slot per drum track
const CHROMATIC = 15;
export const NAME_MAX = 16;          // pack and project names: Components allows 16 characters

export async function loadBase(url = '../tracksgm/TracksGM_v1.circuittrackspack', templateUrl = '../data/Empty.ncs') {
  const [packBuf, tplBuf] = await Promise.all([fetchBuf(url), fetchBuf(templateUrl)]);
  return loadBaseFromBuffers(packBuf, tplBuf);
}

export async function loadBaseFromBuffers(packBuf, tplBuf) {
  let zip;
  try { zip = readZip(packBuf); } catch { throw new Error('This is not a .circuittrackspack file (it could not be opened as a zip).'); }
  const getIndex = zip.get('index.json');
  if (!getIndex) throw new Error('This pack has no index.json, so it is not a Circuit Tracks pack.');
  let index;
  try { index = JSON.parse(new TextDecoder().decode(await getIndex())); } catch { throw new Error('The pack\'s index.json could not be read.'); }
  if (!Array.isArray(index.patches) || !Array.isArray(index.samples)) throw new Error('The pack\'s index.json has no patch or sample list.');
  const patches = [];
  for (const [i, p] of index.patches.entries()) {
    const get = p && p.url ? zip.get(p.url) : null;
    const raw = get ? new Uint8Array(await get()) : null;
    patches.push({ slot: i, name: (p && p.name) || '', data: raw && raw.length === 350 ? raw.slice(9, 349) : null });
  }
  const samples = index.samples.map((s, i) => ({ slot: i, name: (s && s.name) || '', present: !!(s && s.url && zip.get(s.url)) }));
  if (!patches.some((p) => p.data)) throw new Error('The pack has no synth patches.');
  if (samples.length < 8) throw new Error('The pack needs at least 8 drum sample slots.');
  return { zip, index, patches, samples, template: tplBuf };
}

async function fetchBuf(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Could not load ${url} (${r.status})`);
  return r.arrayBuffer();
}

// settings: { title, synthPatch: [slot, slot], kit, colors: [0-13 per project] | color: 0-13 }
export function buildProjects(plan, base, settings) {
  const out = [];
  const n = plan.projects.length;
  for (const p of plan.projects) {
    const proj = parseNCS(base.template.slice(0));
    // Names of up to 16 characters, as Components allows, shortened without cutting words
    // (js/names.js); a numbered project keeps its number.
    proj.name = n > 1 ? numbered(settings.title, p.index + 1) : fitName(settings.title);
    // settings.colors: one project colour (0-13) per project, or settings.color for all.
    proj.color = (settings.colors?.[p.index] ?? settings.color ?? 8) % 14;
    proj.tempo = plan.tempo;
    proj.swing = 50;
    proj.scaleRoot = 0;
    proj.scaleType = CHROMATIC;

    const [s1, s2] = settings.synthPatch;
    proj.synth1Patch = base.patches[s1].data;
    proj.synth2Patch = base.patches[s2].data;

    // Drum sounds: a kit part (MIDI files) or '#<slot>', a sample slot of the loaded Circuit
    // pack, which settings.sampleMap renumbers into the built pack (missing = left out).
    const kitBase = settings.kit * 8;
    const map = settings.sampleMap;
    const firstSlot = map ? Math.min(...map.values()) : 0;
    const slotOf = (part) => {
      if (typeof part === 'string' && part[0] === '#') return map ? map.get(Number(part.slice(1))) : Number(part.slice(1));
      return map ? firstSlot : kitBase + KIT_PARTS.indexOf(part);
    };
    const drumDefault = plan.drumDefaults.map((p) => slotOf(p) ?? firstSlot);

    for (let t = 0; t < 8; t++) {
      if (!plan.active[t]) continue;
      for (let i = 0; i < 8; i++) {
        const content = p.patterns[t][i];
        const tr = plan.trackRates?.[t] ?? plan;     // each track's own step rate and pattern length
        const settingsBlock = { playbackEnd: tr.patLen - 1, playbackStart: 0, syncRate: tr.syncRate, direction: 0 };
        proj.patterns[t][i] = t < 4
          ? { kind: 'synth', steps: synthSteps(content), settings: settingsBlock }
          : { kind: 'drum', steps: drumSteps(content, slotOf, drumDefault[t - 4]), settings: settingsBlock };
      }
    }

    proj.scenes = Array.from({ length: 16 }, (_, s) => {
      const sc = p.scenes[s];
      if (!sc) return { flags: 0, trackChains: Array.from({ length: 8 }, () => ({ start: 0, end: 0 })) };
      // Every scene the song uses is stored (flag 1) with no tracks muted; the flag and mutes
      // live in the 8 bytes after the scene's chains, as Components saves them.
      return { flags: 1, mask: 0, trackChains: sc.chains.map((c) => ({ start: c.start, end: c.end })) };
    });
    // Mute Recall on, so scenes recall their saved mutes as soon as the pack is loaded.
    proj.muteRecall = 1;
    proj.sceneChain = { start: 0, end: p.scenes.length - 1 };
    proj.patternChains = p.scenes[0].chains.map((c) => ({ start: c.start, end: c.end }));

    if (plan.active[4]) {
      proj.drumConfigs = proj.drumConfigs.map((c, i) => ({ ...c, patchSelect: drumDefault[i] }));
    }

    const bytes = serializeNCS(proj, base.template, { freshScenes: true });
    bytes[DRUM0_HEADER] = s1;
    bytes[DRUM0_HEADER + 8] = s2;
    if (plan.active[4]) for (let i = 0; i < 4; i++) bytes[DEFAULT_DRUM_CHOICES + i] = drumDefault[i];
    out.push({ name: proj.name.trim(), bytes });
  }
  return out;
}

function synthSteps(content) {
  const steps = Array.from({ length: STEPS }, () => ({ mask: 0, probability: 7, notes: [] }));
  if (!content) return steps;
  const slots = Array.from({ length: STEPS }, () => []);
  for (const s of content.steps) {
    for (const n of s.notes) slots[s.step].push({ note: n.note, delay: n.delay, velocity: n.vel, len: n.len });
  }
  // Notes longer than 16 steps: gate 96 with the tie flag, continued 16 steps later.
  for (let i = 0; i < STEPS; i++) {
    for (const n of slots[i]) {
      if (n.len <= MAX_GATE || n.cont) continue;
      let rest = n.len - MAX_GATE;
      let at = i;
      let prev = n;
      while (rest > 0 && at + 16 < STEPS && slots[at + 16].length < MAX_NOTES) {
        at += 16;
        prev.tie = true;
        const c = { note: n.note, delay: n.delay, velocity: n.velocity, len: rest, cont: true };
        slots[at].push(c);
        prev = c;
        rest -= MAX_GATE;
      }
    }
  }
  for (let i = 0; i < STEPS; i++) {
    const list = slots[i].slice(0, MAX_NOTES);
    steps[i].mask = (1 << list.length) - 1;
    steps[i].notes = list.map((n) => ({
      note: n.note,
      gate: Math.min(MAX_GATE, Math.max(1, n.len)) | (n.tie ? 0x80 : 0),
      delay: n.delay,
      velocity: n.velocity,
    }));
  }
  return steps;
}

function drumSteps(content, slotOf, defaultSlot) {
  const steps = Array.from({ length: STEPS }, () => ({ active: false, velocity: 0, probability: 7, drumChoice: 0xff }));
  if (!content) return steps;
  for (const s of content.steps) {
    const slot = slotOf(s.part);
    if (slot == null) continue;
    steps[s.step] = {
      active: true,
      velocity: s.vel,
      probability: 7,
      drumChoice: slot === defaultSlot ? 0xff : slot,
      micro: s.mask === 1 ? null : Array.from({ length: MICRO }, (_, m) => ((s.mask >> m) & 1) === 1),
    };
  }
  return steps;
}

// Pack = the base pack (patches + samples, untouched) + the new projects in slots 0..n-1.
export async function buildPack(base, projects, { name, color }) {
  const index = JSON.parse(JSON.stringify(base.index));
  index.name = fitName(name) || 'TracksGM';
  index.color = color;
  index.projects = Array.from({ length: 64 }, (_, i) => ({
    name: projects[i]?.name ?? '',
    url: `projects/project_${i}.ncs`,
  }));
  const entries = [{ name: 'index.json', data: new TextEncoder().encode(JSON.stringify(index, null, 2)) }];
  for (const dir of ['projects/', 'samples/', 'patches/']) entries.push({ name: dir, data: new Uint8Array(0) });
  for (const p of index.patches) {
    const get = base.zip.get(p.url);
    if (get) entries.push({ name: p.url, data: new Uint8Array(await get()) });
  }
  for (const s of index.samples) {
    const get = base.zip.get(s.url);
    if (get) entries.push({ name: s.url, data: new Uint8Array(await get()) });
  }
  projects.forEach((p, i) => entries.push({ name: `projects/project_${i}.ncs`, data: p.bytes }));
  return writeZip(entries);
}

// ---------- Building on a loaded Circuit pack ----------

export const SAMPLE_CAP_S = 196.6;       // Circuit Tracks: total sample time in a pack
export const SAMPLE_MAX_S = 98.3;        // and the longest single sample
const RATE = 48000;

// The pack to build: the base pack's patches with the loaded Circuit pack's samples.
//   src: the loaded pack (js/pack.js); slots: the sample slots the song plays.
//   shrink: keep only the samples the song plays and the patches in keepPatches.
// A Circuit Tracks pack's samples keep their slot numbers. A Circuit Rhythm pack has 128
// slots and the Tracks 64, so its samples are renumbered: the song's own first, then (when
// not shrinking) the others while slots and sample time last. Samples not already 48 kHz,
// 16-bit mono are converted. Returns { base, sampleMap (old slot -> new), seconds, warnings }.
export async function composePack(base, src, { slots, shrink = false, keepPatches = null }) {
  const N = base.index.samples.length || 64;
  const rhythm = src.product === 'circuit-rhythm';
  const srcSamples = src.index.samples ?? [];
  const present = (s) => !!(srcSamples[s]?.url && src.zip.get(srcSamples[s].url));
  const used = slots.filter(present);
  const warnings = [];
  const missing = slots.filter((s) => !present(s));
  if (missing.length) warnings.push(`${missing.length} sample slot${missing.length > 1 ? 's' : ''} the song plays ${missing.length > 1 ? 'are' : 'is'} empty in the loaded pack (${missing.map((s) => s + 1).join(', ')}).`);

  const data = new Map();     // src slot -> { bytes, seconds }
  const read = async (s) => {
    if (!data.has(s)) data.set(s, toTracksWav(new Uint8Array(await src.zip.get(srcSamples[s].url)())));
    return data.get(s);
  };
  const sampleMap = new Map();
  let seconds = 0;
  const take = async (s, dst, onlyIfFits) => {
    const w = await read(s);
    if (!w) { warnings.push(`Sample ${s + 1} (${srcSamples[s]?.name || 'no name'}) could not be read as a WAV file and was left out.`); return false; }
    if (onlyIfFits && seconds + w.seconds > SAMPLE_CAP_S) return false;
    sampleMap.set(s, dst);
    seconds += w.seconds;
    return true;
  };
  if (!rhythm) {
    for (const s of used) if (s < N) await take(s, s, false);
    if (!shrink) for (let s = 0; s < N; s++) if (!sampleMap.has(s) && present(s)) await take(s, s, false);
  } else {
    let dst = 0;
    const over = [];
    for (const s of used) {
      if (dst >= N) { over.push(s); continue; }
      if (await take(s, dst, false)) dst++;
    }
    if (over.length) warnings.push(`The song plays ${used.length} different samples, and a Circuit Tracks pack holds ${N}. The hits of ${over.length} sample${over.length > 1 ? 's' : ''} (${over.map((s) => srcSamples[s]?.name || `slot ${s + 1}`).join(', ')}) are left out.`);
    if (!shrink) for (let s = 0; s < srcSamples.length && dst < N; s++) if (!sampleMap.has(s) && present(s) && await take(s, dst, true)) dst++;
  }
  const errors = [];
  if (seconds > SAMPLE_CAP_S) errors.push(`The samples add up to ${seconds.toFixed(1)} s, more than the ${SAMPLE_CAP_S} s a Circuit Tracks pack holds. Components does not warn about this: check the pack on the Tracks, or use shorter samples.`);
  const long = [...sampleMap.keys()].filter((s) => data.get(s).seconds > SAMPLE_MAX_S);
  if (long.length) warnings.push(`${long.length} sample${long.length > 1 ? 's are' : ' is'} longer than the ${SAMPLE_MAX_S} s the Tracks plays.`);

  const index = JSON.parse(JSON.stringify(base.index));
  const byDst = new Map([...sampleMap].map(([s, d]) => [d, s]));
  const files = new Map();
  index.samples = Array.from({ length: N }, (_, d) => {
    const url = base.index.samples[d]?.url ?? `samples/sample_${d}.wav`;
    const s = byDst.get(d);
    if (s == null) return { name: '', url };
    files.set(url, data.get(s).bytes);
    return { name: srcSamples[s].name ?? '', url };
  });
  const sampleUrls = new Set(index.samples.map((x) => x.url));
  const dropPatch = new Set();
  if (keepPatches) {
    const keep = new Set(keepPatches);
    index.patches.forEach((p, i) => { if (p && !keep.has(i)) { p.name = ''; dropPatch.add(p.url); } });
  }
  const zip = {
    get(url) {
      if (sampleUrls.has(url)) return files.has(url) ? async () => files.get(url).slice().buffer : null;
      if (dropPatch.has(url)) return null;
      return base.zip.get(url);
    },
  };
  return { base: { ...base, index, zip }, sampleMap, seconds, warnings, errors };
}

// A WAV file as the Circuit Tracks stores it (48 kHz, 16-bit, mono), plus its length.
// Returns null for anything that isn't PCM or float WAV.
export function toTracksWav(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  if (bytes.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
  let fmt = null, data = null;
  for (let o = 12; o + 8 <= bytes.length;) {
    const id = tag(o), size = dv.getUint32(o + 4, true);
    if (id === 'fmt ') fmt = { format: dv.getUint16(o + 8, true), ch: dv.getUint16(o + 10, true), rate: dv.getUint32(o + 12, true), bits: dv.getUint16(o + 22, true), sub: size >= 26 ? dv.getUint16(o + 32, true) : null };
    if (id === 'data') data = { at: o + 8, size: Math.min(size, bytes.length - o - 8) };
    o += 8 + size + (size & 1);
  }
  if (!fmt || !data || !fmt.ch || !fmt.rate) return null;
  const format = fmt.format === 0xfffe ? fmt.sub : fmt.format;   // WAVE_FORMAT_EXTENSIBLE: sub-format GUID
  if (format !== 1 && format !== 3) return null;
  const bps = fmt.bits / 8;
  const frames = Math.floor(data.size / (bps * fmt.ch));
  if (format === 1 && fmt.bits === 16 && fmt.ch === 1 && fmt.rate === RATE) {
    return { bytes: bytes.slice(), seconds: frames / RATE };
  }
  const read = (i) => {
    const o = data.at + i * bps;
    if (format === 3) return bps === 8 ? dv.getFloat64(o, true) : dv.getFloat32(o, true);
    if (fmt.bits === 8) return (bytes[o] - 128) / 128;
    if (fmt.bits === 16) return dv.getInt16(o, true) / 32768;
    if (fmt.bits === 24) return ((bytes[o] | bytes[o + 1] << 8 | bytes[o + 2] << 16) << 8 >> 8) / 8388608;
    return dv.getInt32(o, true) / 2147483648;
  };
  const mono = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let v = 0;
    for (let c = 0; c < fmt.ch; c++) v += read(f * fmt.ch + c);
    mono[f] = v / fmt.ch;
  }
  const outFrames = Math.max(1, Math.round(frames * RATE / fmt.rate));
  const out = new Uint8Array(44 + outFrames * 2);
  const ov = new DataView(out.buffer);
  const put = (o, s) => { for (let i = 0; i < 4; i++) out[o + i] = s.charCodeAt(i); };
  put(0, 'RIFF'); ov.setUint32(4, 36 + outFrames * 2, true); put(8, 'WAVE');
  put(12, 'fmt '); ov.setUint32(16, 16, true); ov.setUint16(20, 1, true); ov.setUint16(22, 1, true);
  ov.setUint32(24, RATE, true); ov.setUint32(28, RATE * 2, true); ov.setUint16(32, 2, true); ov.setUint16(34, 16, true);
  put(36, 'data'); ov.setUint32(40, outFrames * 2, true);
  const step = fmt.rate / RATE;
  for (let i = 0; i < outFrames; i++) {
    const x = i * step, i0 = Math.floor(x), fr = x - i0;
    const a = mono[Math.min(i0, frames - 1)] ?? 0, b = mono[Math.min(i0 + 1, frames - 1)] ?? a;
    const v = Math.max(-1, Math.min(1, a + (b - a) * fr));
    ov.setInt16(44 + i * 2, Math.round(v * 32767), true);
  }
  return { bytes: out, seconds: outFrames / RATE };
}

