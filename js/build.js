// Arrangement -> .ncs projects -> .circuittrackspack (TracksGM_final patches and samples
// plus the new projects).
import { parseNCS, serializeNCS } from './vendor/ncs.js';
import { readZip, writeZip } from './vendor/zip.js';
import { KIT_PARTS, MAX_NOTES, MICRO } from './convert.js';

const STEPS = 32;
const MAX_GATE = 96;                 // 16 steps; longer notes continue with a tied note
const DRUM0_HEADER = 0xcd64;         // byte 0 = Synth 1 patch slot, byte 8 = Synth 2 patch slot
const DEFAULT_DRUM_CHOICES = 0x1a278; // 4 bytes: default sample slot per drum track
const CHROMATIC = 15;

export async function loadBase(url = 'data/TracksGM_final.circuittrackspack', templateUrl = 'data/Empty.ncs') {
  const [packBuf, tplBuf] = await Promise.all([fetchBuf(url), fetchBuf(templateUrl)]);
  return loadBaseFromBuffers(packBuf, tplBuf);
}

export async function loadBaseFromBuffers(packBuf, tplBuf) {
  const zip = readZip(packBuf);
  const index = JSON.parse(new TextDecoder().decode(await zip.get('index.json')()));
  const patches = [];
  for (const [i, p] of index.patches.entries()) {
    const get = zip.get(p.url);
    const raw = get ? new Uint8Array(await get()) : null;
    patches.push({ slot: i, name: p.name, data: raw && raw.length === 350 ? raw.slice(9, 349) : null });
  }
  const samples = index.samples.map((s, i) => ({ slot: i, name: s.name }));
  return { zip, index, patches, samples, template: tplBuf };
}

async function fetchBuf(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Could not load ${url} (${r.status})`);
  return r.arrayBuffer();
}

// settings: { title, synthPatch: [slot, slot], kit, color (0-13) }
export function buildProjects(plan, base, settings) {
  const out = [];
  const n = plan.projects.length;
  for (const p of plan.projects) {
    const proj = parseNCS(base.template.slice(0));
    const name = n > 1 ? `${settings.title} ${p.index + 1}` : settings.title;
    proj.name = asciiName(name, 32);
    proj.color = (settings.color ?? 8) % 14;
    proj.tempo = plan.tempo;
    proj.swing = 50;
    proj.scaleRoot = 0;
    proj.scaleType = CHROMATIC;

    const [s1, s2] = settings.synthPatch;
    proj.synth1Patch = base.patches[s1].data;
    proj.synth2Patch = base.patches[s2].data;

    const kitBase = settings.kit * 8;
    const slotOf = (part) => kitBase + KIT_PARTS.indexOf(part);
    const drumDefault = plan.drumDefaults.map(slotOf);

    for (let t = 0; t < 8; t++) {
      if (!plan.active[t]) continue;
      for (let i = 0; i < 8; i++) {
        const content = p.patterns[t][i];
        const settingsBlock = { playbackEnd: plan.patLen - 1, playbackStart: 0, syncRate: plan.syncRate, direction: 0 };
        proj.patterns[t][i] = t < 4
          ? { kind: 'synth', steps: synthSteps(content), settings: settingsBlock }
          : { kind: 'drum', steps: drumSteps(content, slotOf, drumDefault[t - 4]), settings: settingsBlock };
      }
    }

    proj.scenes = Array.from({ length: 16 }, (_, s) => {
      const sc = p.scenes[s];
      if (!sc) return { flags: 0, trackChains: Array.from({ length: 8 }, () => ({ start: 0, end: 0 })) };
      // Byte 0 of scene 1's block is the timing section's spare byte (must stay 0; every
      // hardware-saved project has 0 there). Later scenes carry a used flag of 1.
      return { flags: s === 0 ? 0 : 1, trackChains: sc.chains.map((c) => ({ start: c.start, end: c.end })) };
    });
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

// Pack = TracksGM_final (patches + samples, untouched) + the new projects in slots 0..n-1.
export async function buildPack(base, projects, { name, color }) {
  const index = JSON.parse(JSON.stringify(base.index));
  index.name = asciiName(name, 64).trim() || 'TracksGM';
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

function asciiName(s, n) {
  return (s || '').normalize('NFKD').replace(/[^\x20-\x7e]/g, '').slice(0, n);
}
