// Reading Circuit Tracks and Circuit Rhythm packs, finding which patches and samples their
// projects use, and writing a compacted copy.
//
// Compacting keeps every slot number, so no project has to be rewritten: an unused slot keeps
// its index.json entry with a blank name, and its file is left out of the zip. That is how
// Components itself stores an empty slot.
import { readZip, writeZipDeflate } from './vendor/zip.js';
import { parseNCS, NCS_FILE_SIZE } from './vendor/ncs.js';
import { parseRhythm, rhythmSampleRefs, RHYTHM_FILE_SIZE } from './rhythm.js';

const TRACKS_PATCH_SLOTS = [0xcd64, 0xcd6c];   // Synth 1 / Synth 2 patch slot
const TRACKS_DEFAULT_DRUMS = 0x1a278;          // 4 bytes: default sample per drum track

export const PRODUCTS = {
  'circuit-tracks': { label: 'Circuit Tracks', ext: '.circuittrackspack', size: NCS_FILE_SIZE },
  'circuit-rhythm': { label: 'Circuit Rhythm', ext: '.circuitrhythmpack', size: RHYTHM_FILE_SIZE },
};

export async function loadPack(buffer, fileName = '') {
  let zip;
  try { zip = readZip(buffer); } catch { throw new Error('This file could not be opened as a pack (it is not a zip).'); }
  const getIndex = zip.get('index.json');
  if (!getIndex) throw new Error('This file has no index.json, so it is not a Novation Components pack.');
  let index;
  try { index = JSON.parse(new TextDecoder().decode(await getIndex())); } catch { throw new Error('The pack\'s index.json could not be read.'); }
  let product = index.product;
  if (!PRODUCTS[product]) {
    product = /rhythm/i.test(fileName) ? 'circuit-rhythm' : /tracks/i.test(fileName) ? 'circuit-tracks' : null;
    if (!product) throw new Error(`This pack is for "${index.product ?? 'an unknown product'}". Circuit2MIDI reads Circuit Tracks and Circuit Rhythm packs.`);
  }
  const has = (url) => !!(url && zip.get(url));
  const samples = (index.samples ?? []).map((s, i) => ({ slot: i, name: s?.name ?? '', url: s?.url, present: has(s?.url) }));
  const patches = (index.patches ?? []).map((p, i) => ({ slot: i, name: p?.name ?? '', url: p?.url, present: has(p?.url) }));

  const projects = [];
  for (const [i, p] of (index.projects ?? []).entries()) {
    const entry = { slot: i, name: p?.name ?? '', url: p?.url, empty: true, project: null, error: null };
    const get = p?.url ? zip.get(p.url) : null;
    if (get) {
      const buf = await get();
      try {
        entry.project = readProject(product, buf);
        entry.empty = isEmpty(product, entry.project);
        if (!entry.name) entry.name = entry.project.name;
      } catch (e) { entry.error = e.message; }
    }
    projects.push(entry);
  }
  const pack = { product, info: PRODUCTS[product], zip, index, name: index.name ?? '', samples, patches, projects, size: buffer.byteLength };
  pack.usage = findUsage(pack);
  return pack;
}

function readProject(product, buf) {
  if (product === 'circuit-rhythm') return parseRhythm(buf);
  const d = new Uint8Array(buf);
  const magic = String.fromCharCode(d[0], d[1], d[2], d[3]);
  if (magic !== 'USER') return { empty: true, magic, name: '' };
  const proj = parseNCS(buf);
  proj.magic = magic;
  proj.patchSlots = TRACKS_PATCH_SLOTS.map((o) => d[o]);
  proj.defaultDrums = Array.from(d.subarray(TRACKS_DEFAULT_DRUMS, TRACKS_DEFAULT_DRUMS + 4));
  return proj;
}

// A project is empty when it is Components' blank slot, or when nothing in it plays.
function isEmpty(product, proj) {
  if (proj.empty) return true;
  for (const pats of proj.patterns) for (const p of pats) for (const s of p.steps) {
    if (product === 'circuit-rhythm' ? s.mask : (s.active || s.mask)) return false;
  }
  return true;
}

// Which patches and samples the pack's non-empty projects refer to (or just project `only`).
export function findUsage(pack, only = null) {
  const samples = new Map();   // slot -> Set of project slots
  const patches = new Map();
  const add = (map, slot, p) => { if (!map.has(slot)) map.set(slot, new Set()); map.get(slot).add(p); };
  for (const e of pack.projects) {
    if (e.empty || !e.project || (only != null && e.slot !== only)) continue;
    const proj = e.project;
    if (pack.product === 'circuit-rhythm') {
      for (const s of rhythmSampleRefs(proj)) add(samples, s, e.slot);
    } else {
      proj.patchSlots.forEach((s) => add(patches, s, e.slot));
      proj.defaultDrums.forEach((s) => add(samples, s, e.slot));
      proj.drumConfigs.forEach((c) => add(samples, c.patchSelect, e.slot));
      for (const pats of proj.patterns.slice(4)) for (const p of pats) for (const s of p.steps) {
        if (s.drumChoice !== 0xff) add(samples, s.drumChoice, e.slot);
      }
    }
  }
  const unusedSamples = pack.samples.filter((s) => s.present && !samples.has(s.slot));
  const unusedPatches = pack.patches.filter((p) => p.present && !patches.has(p.slot));
  const bytesOf = async (list) => {
    let n = 0;
    for (const x of list) n += (await pack.zip.get(x.url)()).byteLength;
    return n;
  };
  // A project that could not be read may use any sound, so nothing counts as unused then.
  const unreadable = pack.projects.filter((e) => e.error && (only == null || e.slot === only));
  return {
    samples, patches, unusedSamples, unusedPatches, unreadable,
    projectsWithContent: pack.projects.filter((p) => !p.empty && (only == null || p.slot === only)).length,
    unusedBytes: () => bytesOf([...unusedSamples, ...unusedPatches]),
  };
}

// The pack with unused samples and patches removed. Slot numbers are kept.
// only: keep just that project slot (the others are emptied, as Components stores an empty
// slot: a blank name and no file) and the samples and patches it uses.
export async function compactPack(pack, { name, only = null } = {}) {
  const usage = only == null ? pack.usage : findUsage(pack, only);
  if (!usage.projectsWithContent) throw new Error('This pack has no projects with content, so compacting it would remove every sample and patch.');
  if (usage.unreadable.length) throw new Error(`Project ${usage.unreadable.map((e) => e.slot + 1).join(', ')} could not be read, so it is not known which sounds ${usage.unreadable.length === 1 ? 'it uses' : 'they use'}. The pack has been left as it is.`);
  const index = JSON.parse(JSON.stringify(pack.index));
  const dropS = new Set(usage.unusedSamples.map((s) => s.slot));
  const dropP = new Set(usage.unusedPatches.map((p) => p.slot));
  const dropProj = new Set();
  if (only != null) {
    (index.projects ?? []).forEach((p, i) => { if (p && i !== only) { p.name = ''; if (p.url) dropProj.add(p.url); } });
  }
  if (index.samples) index.samples.forEach((s, i) => { if (dropS.has(i) && s) s.name = ''; });
  if (index.patches) index.patches.forEach((p, i) => { if (dropP.has(i) && p) p.name = ''; });
  if (name) index.name = name;
  const keep = new Set(['index.json']);
  for (const [i, s] of (index.samples ?? []).entries()) if (!dropS.has(i) && s?.url) keep.add(s.url);
  for (const [i, p] of (index.patches ?? []).entries()) if (!dropP.has(i) && p?.url) keep.add(p.url);
  const slotFiles = new Set([...(index.samples ?? []), ...(index.patches ?? [])].map((x) => x?.url));
  const files = [...pack.zip.keys()].filter((n) => n !== 'index.json' && !dropProj.has(n) && (!slotFiles.has(n) || keep.has(n)));
  // Folder entries (the zip reader skips them), then everything else as it is:
  // projects, grid effects and the samples and patches still in use.
  const dirs = new Set(files.filter((n) => n.includes('/')).map((n) => n.slice(0, n.lastIndexOf('/') + 1)));
  dirs.add('projects/');
  dirs.add('samples/');
  if (index.patches) dirs.add('patches/');
  const entries = [{ name: 'index.json', data: new TextEncoder().encode(JSON.stringify(index, null, 2)) }];
  for (const d of [...dirs].sort()) entries.push({ name: d, data: new Uint8Array(0) });
  for (const n of files) entries.push({ name: n, data: new Uint8Array(await pack.zip.get(n)()) });
  return writeZipDeflate(entries);
}
