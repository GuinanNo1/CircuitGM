// PackTrim page: load a Circuit Tracks / Circuit Rhythm pack, show which samples and patches
// its projects use, and save a copy without the rest. Every project is kept, or (Advanced,
// "Keep: only project N") just one project and its sounds. The trimming itself is
// compactPack (js/pack.js). Circuit2MIDI and MIDI2Circuit can hand a pack over (js/handoff.js).
import { setupMode } from './mode.js';
import { fitName } from './names.js';
import { loadPack, compactPack, findUsage } from './pack.js';
import { takeHandoff } from './handoff.js';
import { PROJECT_COLOURS } from './convert.js';

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids) if (k != null) e.append(k);
  return e;
};
const mb = (n) => `${(n / 1e6).toFixed(n < 1e7 ? 2 : 1)} MB`;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const projName = (p) => p.name || `Project ${p.slot + 1}`;

let pack = null;
let only = null;              // Keep: null = every project, else the one project slot kept
const usage = () => (only == null ? pack.usage : findUsage(pack, only));
setupMode('packtrim');

// ---------- 1. Load ----------

const drop = $('drop');
$('file').addEventListener('change', (e) => { if (e.target.files[0]) openFile(e.target.files[0]); e.target.value = ''; });
for (const ev of ['dragenter', 'dragover']) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); });
for (const ev of ['dragleave', 'drop']) drop.addEventListener(ev, () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) openFile(f); });

// Opened from "Trim this pack in PackTrim" (Circuit2MIDI or MIDI2Circuit): take the pack it handed over.
const FROM = { circuit2midi: 'Circuit2MIDI', midi2circuit: 'MIDI2Circuit' };
const from = new URLSearchParams(location.search).get('from');
if (FROM[from]) {
  history.replaceState(null, '', location.pathname);
  (async () => {
    let item = null;
    try { item = await takeHandoff('packtrim'); } catch { /* storage blocked */ }
    if (item) openFile(new File([item.buffer], item.fileName));
    else setStatus('load-status', `The pack from ${FROM[from]} could not be found (it is only kept for a few minutes, in this browser). Drop the pack here instead.`, true);
  })();
}

async function openFile(file) {
  setStatus('load-status', `Reading ${file.name}…`);
  for (const id of ['step-projects', 'step-sounds', 'step-save']) $(id).hidden = true;
  $('packinfo').hidden = true;
  try {
    const buffer = await file.arrayBuffer();
    pack = await loadPack(buffer, file.name);
  } catch (err) {
    pack = null;
    setStatus('load-status', err.message, true);
    return;
  }
  setStatus('load-status', '');
  only = null;
  $('name').value = fitName(pack.name);     // Components allows 16 characters
  showPackInfo();
  fillKeep();
  showAll();
}

function showAll() {
  showProjects();
  showSounds();
  showSave();
}

// Keep: every project, or only one (Advanced).
function fillKeep() {
  const sel = $('keep');
  const list = pack.projects.filter((p) => !p.empty);
  sel.replaceChildren(el('option', { value: 'all', text: 'Every project' }),
    ...list.map((p) => el('option', { value: String(p.slot), text: `Only project ${p.slot + 1}: ${projName(p)}` })));
  sel.value = 'all';
  $('keep-options').hidden = list.length < 2;
}

$('keep').addEventListener('change', () => {
  if (!pack) return;
  only = $('keep').value === 'all' ? null : Number($('keep').value);
  showAll();
});

function showPackInfo() {
  const box = $('packinfo');
  box.replaceChildren();
  const item = (k, v) => box.append(el('span', {}, el('span', { class: 'k', text: k }), el('b', { text: v })));
  item('Pack', pack.name || '(no name)');
  item('For', pack.info.label);
  item('Projects', `${pack.usage.projectsWithContent} with content, of ${pack.projects.length}`);
  item('Samples', String(pack.samples.filter((s) => s.present).length));
  if (pack.product === 'circuit-tracks') item('Patches', String(pack.patches.filter((p) => p.present).length));
  item('Size', mb(pack.size));
  box.hidden = false;
}

// ---------- 2. Projects ----------

function showProjects() {
  const tracks = pack.product === 'circuit-tracks';
  const u = usage();
  // Sounds each project uses, from the pack-wide usage map (slot -> Set of project slots).
  const usedBy = (map, slot) => [...map].filter(([, ps]) => ps.has(slot)).map(([s]) => s).sort((a, b) => a - b);
  const listed = pack.projects.filter((p) => !p.empty || p.error);
  const table = $('projects');
  table.replaceChildren(el('thead', {}, el('tr', {},
    el('th', { text: 'Slot' }), el('th', { text: 'Project' }), el('th', { class: 'n', text: 'Samples' }),
    tracks ? el('th', { class: 'n', text: 'Patches' }) : null)));
  const body = el('tbody');
  for (const p of listed) {
    const colour = PROJECT_COLOURS[p.project?.color]?.[1];
    const pn = el('span', { class: 'pn', text: String(p.slot + 1) });
    if (colour) pn.style.setProperty('--pc', `rgb(${colour.join(',')})`);
    if (p.error) {
      body.append(el('tr', { class: 'bad' }, el('td', {}, pn), el('td', {}, el('b', { text: projName(p) }), el('div', { class: 'err', text: `Could not be read: ${p.error}` })),
        el('td', { class: 'n', text: '?' }), tracks ? el('td', { class: 'n', text: '?' }) : null));
      continue;
    }
    if (only != null && p.slot !== only) {
      body.append(el('tr', { class: 'gone' }, el('td', {}, pn), el('td', {}, el('b', { text: projName(p) }), el('div', { class: 'sub', text: 'Slot emptied: only project ' + (only + 1) + ' is kept' })),
        el('td', { class: 'n', text: '–' }), tracks ? el('td', { class: 'n', text: '–' }) : null));
      continue;
    }
    const s = usedBy(u.samples, p.slot).filter((i) => pack.samples[i]?.present);
    const pt = usedBy(u.patches, p.slot).filter((i) => pack.patches[i]?.present);
    const names = (list, items) => list.map((i) => `${i + 1}. ${items[i].name || '(no name)'}`).join('\n');
    body.append(el('tr', {}, el('td', {}, pn), el('td', { class: 'pname', text: projName(p) }),
      el('td', { class: 'n', text: String(s.length), title: names(s, pack.samples) || 'none' }),
      tracks ? el('td', { class: 'n', text: String(pt.length), title: names(pt, pack.patches) || 'none' }) : null));
  }
  table.append(body);
  const empty = pack.projects.length - listed.length;
  $('projects-hint').textContent = listed.length
    ? `${only == null ? 'Every project below is kept' : `Only project ${only + 1} is kept`}, with all the sounds it uses. ${empty ? `${plural(empty, 'empty project slot')} ${empty === 1 ? "isn't" : "aren't"} listed.` : ''} Hover a count to see the sounds.`
    : 'This pack has no projects with notes in them.';
  $('step-projects').hidden = false;
}

// ---------- 3. Samples and patches ----------

function showSounds() {
  const tracks = pack.product === 'circuit-tracks';
  const u = usage();
  // With a project unreadable nothing will be left out, so don't show sounds as if they would be.
  if (u.unreadable.length || !u.projectsWithContent) { $('step-sounds').hidden = true; return; }
  const sizes = pack.zip.sizes ?? new Map();
  const sum = $('summary');
  sum.replaceChildren();
  const stat = (v, k) => sum.append(el('div', { class: 'stat' }, el('div', { class: 'v', text: v }), el('div', { class: 'k', text: k })));
  const kept = (items, map) => items.filter((x) => x.present && map.has(x.slot)).length;
  stat(`${kept(pack.samples, u.samples)} / ${pack.samples.filter((s) => s.present).length}`, 'samples kept');
  if (tracks) stat(`${kept(pack.patches, u.patches)} / ${pack.patches.filter((p) => p.present).length}`, 'patches kept');
  const removed = [...u.unusedSamples, ...u.unusedPatches].reduce((n, x) => n + (sizes.get(x.url) ?? 0), 0);
  stat(`about ${mb(Math.max(0, pack.size - removed))}`, `trimmed size (now ${mb(pack.size)})`);

  const grid = (box, items, map, kind) => {
    box.replaceChildren();
    for (const x of items) {
      const users = map.get(x.slot);
      const state = !x.present ? 'empty' : users ? 'keep' : 'out';
      const title = !x.present ? `${kind} ${x.slot + 1}: empty`
        : `${kind} ${x.slot + 1}: ${x.name || '(no name)'}\n${users ? `Kept: used by project ${[...users].sort((a, b) => a - b).map((s) => s + 1).join(', ')}` : only == null ? 'Left out: no project uses it' : `Left out: project ${only + 1} doesn't use it`}`;
      box.append(el('div', { class: `slot ${state}`, title },
        el('span', { class: 'sn', text: String(x.slot + 1) }), el('span', { class: 'st', text: x.present ? (x.name || '(no name)') : '' })));
    }
  };
  grid($('samples'), pack.samples, u.samples, 'Sample');
  $('patches-block').hidden = !tracks;
  if (tracks) grid($('patches'), pack.patches, u.patches, 'Patch');
  $('step-sounds').hidden = false;
}

// ---------- 4. Save ----------

function showSave() {
  const u = usage();
  const others = only != null && pack.projects.some((p) => !p.empty && p.slot !== only);
  const nothing = !u.unusedSamples.length && !u.unusedPatches.length && !others;
  const why = u.unreadable.length
    ? `Project ${u.unreadable.map((e) => e.slot + 1).join(', ')} could not be read, so it isn't known which sounds ${u.unreadable.length === 1 ? 'it uses' : 'they use'}. PackTrim won't trim this pack, so that no project loses its sounds.`
    : !u.projectsWithContent ? 'This pack has no projects with notes in them, so every sample and patch would count as unused. PackTrim leaves packs like this alone.'
      : nothing ? 'Nothing to trim: every sample and patch in this pack is used by a project.' : '';
  $('save').disabled = !!why;
  setStatus('save-status', why, !!u.unreadable.length);
  $('step-save').hidden = false;
}

$('save').addEventListener('click', async () => {
  if (!pack) return;
  const btn = $('save');
  btn.disabled = true;
  setStatus('save-status', 'Trimming…');
  try {
    const name = fitName($('name').value.trim() || pack.name);
    const blob = await compactPack(pack, { name, only });
    const file = `${fileSafe(name)} trimmed${pack.info.ext}`;
    download(blob, file);
    setStatus('save-status', `Saved ${file}: ${mb(blob.size)}, was ${mb(pack.size)}.`);
  } catch (err) {
    setStatus('save-status', err.message, true);
  }
  btn.disabled = false;
});

// ---------- Helpers ----------

function setStatus(id, text, error = false) {
  const s = $(id);
  s.textContent = text;
  s.classList.toggle('error', !!error);
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

function fileSafe(s) { return (s || 'Circuit').replace(/[\\/:*?"<>|]+/g, '').trim() || 'Circuit'; }
