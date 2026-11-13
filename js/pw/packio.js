// PatchWorker: reading and writing Circuit Tracks packs and patch files, and keeping the working
// session in the browser between visits.
import { readZip, writeZipDeflate } from '../vendor/zip.js';
import { PATCH_SIZE, SYX_SIZE, parseSyx, toSyx, getName, initPatch } from './params.js?v=20261114l';

export const PATCH_SLOTS = 128;
const NCS_SIZE = 160780;
const NCS_PATCH_SLOT = [0xcd64, 0xcd6c];       // Synth 1 / Synth 2: which pack slot the project loads
const NCS_PATCH_COPY = [0x26d14, 0x26e68];     // the project's own 340-byte copy of each patch

const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

// Open a .circuittrackspack. Every file is kept as it is; only patches are parsed.
export async function openPack(buffer, fileName = '') {
  let zip;
  try { zip = readZip(buffer); } catch { throw new Error('This file could not be opened as a pack (it is not a zip).'); }
  const getIndex = zip.get('index.json');
  if (!getIndex) throw new Error('This file has no index.json, so it is not a Novation Components pack.');
  let index;
  try { index = JSON.parse(new TextDecoder().decode(await getIndex())); } catch { throw new Error('The pack\'s index.json could not be read.'); }
  if (index.product && index.product !== 'circuit-tracks') {
    throw new Error(index.product === 'circuit-rhythm'
      ? 'This is a Circuit Rhythm pack. The Circuit Rhythm has no synth patches to edit.'
      : `This pack is for "${index.product}". PatchWorker edits Circuit Tracks packs.`);
  }
  const files = new Map();
  for (const [name, get] of zip) files.set(name, new Uint8Array(await get()));

  const patches = [];
  const names = [];
  for (let i = 0; i < PATCH_SLOTS; i++) {
    const entry = index.patches?.[i];
    const raw = entry?.url ? files.get(entry.url) : null;
    const parsed = raw ? parseSyx(raw) : [];
    patches.push(parsed.length ? parsed[0].data : null);
    names.push(entry?.name ?? '');
  }
  return {
    fileName, index, files, name: index.name ?? '', color: index.color ?? 'green',
    patches, original: patches.map((p) => (p ? p.slice() : null)),
    projects: (index.projects ?? []).filter((p) => p?.url && files.has(p.url)).length,
    samples: (index.samples ?? []).filter((s) => s?.url && files.has(s.url)).length,
  };
}

export const slotPatch = (pack, slot) => pack.patches[slot] ?? initPatch();
const INIT = initPatch();
// A slot the pack left empty, still holding nothing but the Initial Patch.
export const slotBlank = (pack, slot) => !pack.original[slot] && (!pack.patches[slot] || same(pack.patches[slot], INIT));
export const slotEdited = (pack, slot) => {
  const a = pack.patches[slot];
  const b = pack.original[slot];
  if (!b) return !slotBlank(pack, slot);
  return !a || !same(a, b);
};
export const editedSlots = (pack) => Array.from({ length: PATCH_SLOTS }, (_, i) => i).filter((i) => slotEdited(pack, i));

// Write the pack back out. Patch files and their names in index.json follow the edits; all other
// files are byte-for-byte the originals. With syncProjects, a project that plays an edited slot
// gets the edited patch too, but only where its own copy still matched the pack's original (a
// project that had already drifted from the pack keeps its own sound).
export async function buildPack(pack, { name = pack.name, syncProjects = true } = {}) {
  const index = JSON.parse(JSON.stringify(pack.index));
  index.name = name;
  index.patches = Array.from({ length: PATCH_SLOTS }, (_, i) => ({
    name: pack.patches[i] && !slotBlank(pack, i) ? getName(pack.patches[i]) : 'Initial Patch',
    url: index.patches?.[i]?.url ?? `patches/patch_${i}.syx`,
  }));
  const files = new Map(pack.files);
  for (let i = 0; i < PATCH_SLOTS; i++) {
    const url = index.patches[i].url;
    if (pack.patches[i] && !slotBlank(pack, i)) files.set(url, toSyx(pack.patches[i]));
    else files.delete(url);
  }
  let synced = 0;
  if (syncProjects) {
    for (const p of index.projects ?? []) {
      const data = p?.url ? files.get(p.url) : null;
      if (!data || data.length !== NCS_SIZE || String.fromCharCode(...data.subarray(0, 4)) !== 'USER') continue;
      let copy = null;
      for (let s = 0; s < 2; s++) {
        const slot = data[NCS_PATCH_SLOT[s]];
        const orig = pack.original[slot];
        const now = pack.patches[slot];
        if (slot >= PATCH_SLOTS || !orig || !now || same(orig, now)) continue;
        if (!same(data.subarray(NCS_PATCH_COPY[s], NCS_PATCH_COPY[s] + PATCH_SIZE), orig)) continue;
        copy ??= data.slice();
        copy.set(now, NCS_PATCH_COPY[s]);
        synced++;
      }
      if (copy) files.set(p.url, copy);
    }
  }
  files.set('index.json', new TextEncoder().encode(JSON.stringify(index, null, 2)));
  const entries = [{ name: 'index.json', data: files.get('index.json') }];
  for (const dir of ['projects/', 'samples/', 'patches/']) entries.push({ name: dir, data: new Uint8Array(0) });
  for (const [n, data] of files) if (n !== 'index.json') entries.push({ name: n, data });
  const blob = await writeZipDeflate(entries);
  return { blob, synced };
}

// How many project patch copies a download would update (for the note beside the button).
export function projectsFollowing(pack) {
  let n = 0;
  for (const p of pack.index.projects ?? []) {
    const data = p?.url ? pack.files.get(p.url) : null;
    if (!data || data.length !== NCS_SIZE) continue;
    for (let s = 0; s < 2; s++) {
      const slot = data[NCS_PATCH_SLOT[s]];
      const orig = pack.original[slot];
      if (slot < PATCH_SLOTS && orig && slotEdited(pack, slot) && pack.patches[slot]
        && same(data.subarray(NCS_PATCH_COPY[s], NCS_PATCH_COPY[s] + PATCH_SIZE), orig)) n++;
    }
  }
  return n;
}

// All patches as one .syx bank: "Replace Patch" messages that write flash slots 1-128 in order.
export function bankSyx(pack) {
  const out = new Uint8Array(PATCH_SLOTS * SYX_SIZE);
  for (let i = 0; i < PATCH_SLOTS; i++) out.set(toSyx(slotPatch(pack, i), { command: 1, location: i }), i * SYX_SIZE);
  return out;
}

export function download(data, fileName, type = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export const fileSafe = (s) => (String(s).replace(/[^\w .()+-]/g, '').trim() || 'Patch');

// ------------------------------------------------------------------ session (IndexedDB)
const DB = 'circuitgm-patchworker';
function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function kv(mode, fn) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', mode);
    const req = fn(tx.objectStore('kv'));
    tx.oncomplete = () => { db.close(); resolve(req?.result); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
export const session = {
  // The opened pack file (once per pack) ...
  async savePack(buffer, fileName) { try { await kv('readwrite', (s) => s.put({ buffer, fileName }, 'pack')); } catch { /* private mode */ } },
  // ... and the small part that changes: edited patches, pack name, selected slot.
  async saveEdits(state) { try { await kv('readwrite', (s) => s.put(state, 'edits')); } catch { /* private mode */ } },
  async load() {
    try {
      const pack = await kv('readonly', (s) => s.get('pack'));
      const edits = await kv('readonly', (s) => s.get('edits'));
      if (!pack && !edits) return null;
      return { buffer: pack?.buffer ?? null, fileName: pack?.fileName ?? '', edits: edits ?? null };
    } catch { return null; }
  },
  async clear() { try { await kv('readwrite', (s) => s.clear()); } catch { /* private mode */ } },
};
