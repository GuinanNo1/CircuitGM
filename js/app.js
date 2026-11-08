import { parseMidi, GM_NAMES } from './midifile.js';
import { arrange, playOrder, laneOf, partOf, patternBars, projectColours, PROJECT_COLOURS, RATES, TRACKS, KITS, KIT_PARTS, MELODIC_ROLES } from './convert.js';
import { loadBase, loadBaseFromBuffers, buildProjects, buildPack, composePack, SAMPLE_CAP_S } from './build.js';
import { loadPack, PRODUCTS } from './pack.js';
import { packSong, projectChoices } from './packsong.js';
import { Player } from './player.js';

const $ = (s) => document.querySelector(s);
const ROLES = ['S1', 'S2', 'M1', 'M2', 'DR'];
const ROLE_LABEL = { S1: 'Synth 1', S2: 'Synth 2', M1: 'MIDI 1', M2: 'MIDI 2', DR: 'Drums' };
const ROLE_TRACK = { S1: 0, S2: 1, M1: 2, M2: 3 };
const TRACK_VAR = ['--s1', '--s2', '--m1', '--m2', '--dr', '--dr', '--dr', '--dr'];
const TRACK_NAMES = ['Synth 1', 'Synth 2', 'MIDI 1', 'MIDI 2', 'Kick', 'Snare/Tom', 'Hi-hats', 'Perc'];
const PLAY_ICON = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 1l9 5-9 5z"/></svg>';
const STOP_ICON = '<svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="2" width="8" height="8"/></svg>';

const DEFAULT_PACK = 'TracksGM_final';
const state = {
  base: null,
  defaultBase: null,
  baseName: DEFAULT_PACK,
  midi: null,               // the song: parsed MIDI, or a pack project (js/packsong.js)
  fileName: '',
  songPack: null,           // the loaded Circuit pack when the song comes from one
  songPackName: '',
  roleOf: new Map(),        // source id -> role
  patchTouched: [false, false],
  transpose: { S1: 0, S2: 0, M1: 0, M2: 0 },
  plan: null,
  playingSource: null,
  mutes: { all: new Set(), bars: new Map() },
  barCache: new Map(),
  gridRows: [],
  lastPlan: null,
};
const player = new Player();

// ---------- startup ----------
init();

async function init() {
  wireLoad();
  try {
    state.defaultBase = await loadBase();
    setBase(state.defaultBase, DEFAULT_PACK);
  } catch (e) {
    $('#base-status').textContent = `Could not load the TracksGM Pack: ${e.message}. If you opened index.html straight from disk, serve the folder instead (see README).`;
    $('#base-status').classList.add('error');
  }
  for (const id of ['#section-bars', '#rate', '#tempo-div', '#match', '#quantize', '#align', '#trim']) $(id).addEventListener('change', rearrange);
  $('#patch-s1').addEventListener('change', () => { state.patchTouched[0] = true; });
  $('#patch-s2').addEventListener('change', () => { state.patchTouched[1] = true; });
  $('#kit').addEventListener('change', rearrange);
  $('#play').addEventListener('click', () => togglePlanPlay());
  $('#grid').addEventListener('click', onGridClick);
  $('#build').addEventListener('click', build);
  $('#projcolors').addEventListener('change', () => state.plan && renderGrid(state.plan));
  $('#project').addEventListener('change', () => selectProject(Number($('#project').value)));
  $('#shrink-on').addEventListener('change', updateShrinkInfo);
  $('#patch-s1').addEventListener('change', updateShrinkInfo);
  $('#patch-s2').addEventListener('change', updateShrinkInfo);
  player.onEnd = () => { setPlanButton(false); setSourceButton(null); };
}

const isPack = (f) => /\.(circuittrackspack|circuitrhythmpack|zip)$/i.test(f.name);
function routeFile(f) { if (isPack(f)) loadSongPack(f); else loadFile(f); }
const fromPack = () => state.midi?.format === 'pack';

function wireLoad() {
  const drop = $('#drop');
  const input = $('#file');
  input.addEventListener('change', () => { if (input.files[0]) routeFile(input.files[0]); input.value = ''; });
  for (const zone of [drop, $('#basepack')]) {
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('over'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('over');
      const f = e.dataTransfer.files[0];
      if (!f) return;
      if (zone === drop) routeFile(f); else loadBaseFile(f);
    });
  }
  const bf = $('#base-file');
  bf.addEventListener('change', () => { if (bf.files[0]) loadBaseFile(bf.files[0]); bf.value = ''; });
  $('#base-reset').addEventListener('click', () => state.defaultBase && setBase(state.defaultBase, DEFAULT_PACK));
}

// ---------- base pack ----------
async function loadBaseFile(file) {
  const status = $('#base-status');
  if (!state.defaultBase) return;
  if (/\.circuitrhythmpack$/i.test(file.name)) {
    status.textContent = `${file.name} is a Circuit Rhythm pack, which has no synth patches, so it can't be the base pack. Drop it on the song box below to convert one of its projects. Still using ${state.baseName}.`;
    status.classList.add('error');
    return;
  }
  status.classList.remove('error');
  status.textContent = `Reading ${file.name}…`;
  try {
    const base = await loadBaseFromBuffers(await file.arrayBuffer(), state.defaultBase.template);
    setBase(base, file.name.replace(/\.(circuittrackspack|zip)$/i, ''));
  } catch (e) {
    status.textContent = `Could not use ${file.name}: ${e.message} Still using ${state.baseName}.`;
    status.classList.add('error');
  }
}

function setBase(base, name) {
  player.stop();
  setPlanButton(false);
  setSourceButton(null);
  state.base = base;
  state.baseName = name;
  const isDefault = base === state.defaultBase;
  const nPatch = base.patches.filter((p) => p.data).length;
  const nSamp = base.samples.filter((s) => s.present).length;
  const nProj = (base.index.projects || []).filter((p) => p && p.name).length;
  $('#base-name').textContent = name;
  const status = $('#base-status');
  status.classList.remove('error');
  status.textContent = isDefault
    ? `TracksGM Pack: ${nPatch} patches, ${nSamp} drum samples.`
    : base.fromSong
      ? `The loaded pack's own ${nPatch} patches. Its projects are not copied; the converted project replaces them.`
      : `${base.index.name ? `“${base.index.name}”: ` : ''}${nPatch} patches, ${nSamp} drum samples.`
        + (nProj ? ` Its ${nProj} project${nProj > 1 ? 's' : ''} will be replaced by the converted song.` : '');
  $('#base-reset').hidden = isDefault;
  fillPatchSelects();
  fillKitSelect();
  loadedKit = -1;
  updateBaseSummary();
  if (state.midi) { rolesChanged(); }
}

function updateBaseSummary() {
  if (!state.base) return;
  const base = state.base;
  const nPatch = base.patches.filter((p) => p.data).length;
  const nSamp = base.samples.filter((s) => s.present).length;
  const label = base === state.defaultBase ? 'TracksGM Pack' : state.baseName;
  $('#base-summary').textContent = fromPack()
    ? `${label}'s ${nPatch} patches, with the drum samples of ${state.songPackName}`
    : `${label}: ${nPatch} patches, ${nSamp} drum samples`;
}

function fillPatchSelects() {
  for (const [i, id] of ['#patch-s1', '#patch-s2'].entries()) {
    const sel = $(id);
    const prev = sel.value;
    sel.innerHTML = '';
    for (const p of state.base.patches) {
      if (!p.data) continue;
      const o = document.createElement('option');
      o.value = p.slot;
      o.textContent = `${String(p.slot + 1).padStart(3, '0')}  ${p.name || '(no name)'}`;
      sel.append(o);
    }
    setPatch(sel, prev !== '' ? prev : String(i === 0 ? 0 : 32));
  }
}

// Select a patch slot, or the nearest slot below it that has a patch.
function setPatch(sel, slot) {
  const opts = [...sel.options].map((o) => Number(o.value));
  if (!opts.length) return;
  const want = Number(slot);
  const pick = opts.filter((v) => v <= want).pop() ?? opts[0];
  sel.value = String(pick);
}

function fillKitSelect() {
  const sel = $('#kit');
  const prev = sel.value;
  sel.innerHTML = '';
  const isDefault = state.base === state.defaultBase;
  const nKits = Math.min(Math.floor(state.base.samples.length / 8), 8);
  for (let i = 0; i < nKits; i++) {
    const o = document.createElement('option');
    o.value = i;
    const names = state.base.samples.slice(i * 8, i * 8 + 8).map((s) => s.name || '—');
    o.textContent = isDefault && KITS[i]
      ? `${KITS[i]} kit (samples ${i * 8 + 1}–${i * 8 + 8})`
      : `Samples ${i * 8 + 1}–${i * 8 + 8}: ${names[0]}, ${names[1]}…`;
    o.title = names.map((n, j) => `${KIT_PARTS[j]}: ${n}`).join('\n');
    sel.append(o);
  }
  sel.value = prev !== '' && Number(prev) < nKits ? prev : String(Math.min(1, nKits - 1));
}

let loadedKit = -1;
async function loadKitSamples() {
  if (fromPack()) {
    // Preview with the loaded pack's own samples, keyed '#<slot>' as in the arrangement.
    const key = `pack:${state.midi.entry.slot}`;
    if (loadedKit === key) return;
    loadedKit = key;
    const map = new Map();
    const pk = state.songPack;
    for (const slot of state.midi.sampleSlots) {
      const s = pk.index.samples?.[slot];
      const get = s?.url && pk.zip.get(s.url);
      if (get) map.set(`#${slot}`, await get());
    }
    try { await player.setDrumSamples(map); } catch { /* audio not available yet */ }
    return;
  }
  if (!state.base) return;
  const kit = Number($('#kit').value);
  if (kit === loadedKit) return;
  loadedKit = kit;
  const map = new Map();
  for (const [i, part] of KIT_PARTS.entries()) {
    const s = state.base.index.samples[kit * 8 + i];
    const get = s && state.base.zip.get(s.url);
    if (get) map.set(part, await get());
  }
  try { await player.setDrumSamples(map); } catch { /* audio not available yet */ }
}

// ---------- step 1: file ----------
const STEPS_AFTER = ['#step-tracks', '#step-sounds', '#step-arrange', '#step-build'];
function loadError(msg) {
  const info = $('#fileinfo');
  info.hidden = false;
  info.innerHTML = `<span class="status error">${esc(msg)}</span>`;
  $('#projpick').hidden = true;
  for (const id of STEPS_AFTER) $(id).hidden = true;
}

async function loadFile(file) {
  player.stop();
  setPlanButton(false);
  try {
    const midi = parseMidi(await file.arrayBuffer());
    if (!midi.sources.length) throw new Error('The file has no notes.');
    await leavePackSong();
    state.midi = midi;
    state.fileName = file.name.replace(/\.(mid|midi|rmi|kar)$/i, '');
  } catch (e) {
    loadError(e.message);
    return;
  }
  $('#projpick').hidden = true;
  songLoaded([['File', esc(file.name)]]);
}

// A Circuit Tracks or Circuit Rhythm pack as the song: pick one of its projects. Its drum
// samples go into the converted pack; a Circuit Tracks pack also becomes the base pack, so
// its own synth patches are used (the Base pack box can still change that).
async function loadSongPack(file) {
  player.stop();
  setPlanButton(false);
  let pack;
  try {
    const buf = await file.arrayBuffer();
    pack = await loadPack(buf, file.name);
    if (!projectChoices(pack).length) throw new Error(`${file.name} has no saved projects with notes to convert.`);
    await leavePackSong();
    state.songPack = pack;
    state.songPackName = file.name.replace(/\.(circuittrackspack|circuitrhythmpack|zip)$/i, '');
    if (pack.product === 'circuit-tracks' && state.defaultBase) {
      try {
        const base = await loadBaseFromBuffers(buf, state.defaultBase.template);
        base.fromSong = true;
        setBase(base, state.songPackName);
      } catch { /* no patches: keep the current base pack */ }
    }
  } catch (e) {
    loadError(e.message.replace('Circuit2MIDI reads', 'MIDI2Circuit reads'));
    return;
  }
  const choices = projectChoices(pack);
  const sel = $('#project');
  sel.innerHTML = choices.map((p) => `<option value="${p.slot}">${p.slot + 1}. ${esc(p.name || `Project ${p.slot + 1}`)}</option>`).join('');
  $('#projpick').hidden = false;
  const label = PRODUCTS[pack.product].label;
  $('#project-hint').textContent = choices.length > 1
    ? `${choices.length} projects in this ${label} pack have notes. Changing the project starts the parts and mutes again.`
    : `This ${label} pack has one project with notes.`;
  selectProject(choices[0].slot);
}

// Back to a MIDI song (or a new pack): a base pack taken from the old song pack goes back to TracksGM.
async function leavePackSong() {
  if (fromPack()) state.midi = null;
  state.songPack = null;
  if (state.base?.fromSong && state.defaultBase) setBase(state.defaultBase, DEFAULT_PACK);
  state.songPackName = '';
  loadedKit = -1;
}

function selectProject(slot) {
  const pack = state.songPack;
  const entry = pack.projects[slot];
  player.stop();
  setPlanButton(false);
  try {
    state.midi = packSong(pack, entry);
    if (!state.midi.sources.length) throw new Error('This project has no notes to convert.');
  } catch (e) {
    state.midi = null;
    loadError(`Could not read project ${slot + 1}: ${e.message}`);
    $('#projpick').hidden = false;
    return;
  }
  $('#project').value = String(slot);
  state.fileName = state.midi.song.name;
  loadedKit = -1;
  songLoaded([
    ['Pack', `${esc(state.songPackName)} (${PRODUCTS[pack.product].label})`],
    ['Project', esc(state.midi.song.name)],
    ['Scenes', state.midi.scenes],
  ]);
}

function songLoaded(firstRows) {
  const m = state.midi;
  const bars = m.lengthTicks / (m.ppq * 4 * m.timeSig.num / m.timeSig.den);
  const info = $('#fileinfo');
  info.hidden = false;
  info.innerHTML = [
    ...firstRows,
    ['Tempo', `${round1(m.tempo)} BPM${m.tempoChanges ? ` (+${m.tempoChanges} changes)` : ''}`],
    ['Time', `${m.timeSig.num}/${m.timeSig.den}`],
    ['Length', `${Math.ceil(bars)} bars`],
    ['Parts', m.sources.length],
  ].map(([k, v]) => `<span><span class="k">${k}</span><b>${v}</b></span>`).join('');
  renderSongPackParts();

  defaultRoles();
  state.mutes = { all: new Set(), bars: new Map() };
  state.barCache = new Map();
  state.lastPlan = null;
  state.patchTouched = [false, false];
  state.transpose = { S1: 0, S2: 0, M1: 0, M2: 0 };
  $('#title').value = ascii(state.fileName).slice(0, 28);
  $('#packname').value = `TracksGM ${ascii(state.fileName)}`.slice(0, 40);
  renderTracks();
  for (const id of STEPS_AFTER) $(id).hidden = false;
  rolesChanged();
}

// Steps 3 and 4 when the song is a pack project: drums are its own samples, and the pack
// can be shrunk.
function renderSongPackParts() {
  const pk = fromPack();
  $('#kit').hidden = pk;
  $('#kit-pack').hidden = !pk;
  $('#shrink').hidden = !pk;
  $('#kit-sub').textContent = pk
    ? 'The drum tracks play the loaded pack\'s own samples. Circuit Tracks drum parts keep their drum track; other samples go to Kick, Snare/Tom, Hi-hats or Perc by their name.'
    : 'Drum 1 kick · Drum 2 snare/toms · Drum 3 hi-hats · Drum 4 percussion';
  $('label[for="kit"]').textContent = pk ? 'Drums' : 'Drum kit';
  updateBaseSummary();
}

// The sample slots the drum tracks play (unmuted parts only are not tracked: mutes can
// change bar by bar, so every sample of the parts sent to Drums is kept).
function drumSlots() {
  if (!fromPack()) return [];
  return [...new Set(sourcesFor('DR').flatMap((s) => s.notes.map((n) => n.slot)))].filter((x) => x != null).sort((a, b) => a - b);
}

let shrinkRun = 0;
async function updateShrinkInfo() {
  if (!fromPack() || !state.base) return;
  const run = ++shrinkRun;
  const slots = drumSlots();
  $('#kit-pack').textContent = slots.length
    ? `${slots.length} sample${slots.length > 1 ? 's' : ''} from ${state.songPackName}`
    : 'No part is on the drum tracks';
  const shrink = $('#shrink-on').checked;
  const patches = [Number($('#patch-s1').value), Number($('#patch-s2').value)];
  let res;
  try {
    res = await composePack(state.base, state.songPack, { slots, shrink, keepPatches: shrink ? patches : null });
  } catch (e) {
    if (run === shrinkRun) $('#shrink-info').textContent = `Could not read the pack's samples: ${e.message}`;
    return;
  }
  if (run !== shrinkRun) return;
  const nS = res.sampleMap.size;
  const nP = state.base.patches.filter((p) => p.data).length;
  const keptP = shrink ? new Set(patches).size : nP;
  const rhythm = state.songPack.product === 'circuit-rhythm';
  $('#shrink-info').textContent = `The pack will hold ${keptP} patch${keptP === 1 ? '' : 'es'} and ${nS} sample${nS === 1 ? '' : 's'} (${res.seconds.toFixed(1)} s of the ${SAMPLE_CAP_S} s a Circuit Tracks pack holds).`
    + (rhythm ? ' A Circuit Rhythm pack has 128 sample slots and the Tracks 64, so the samples are renumbered, the song\'s own first.' : '')
    + (shrink ? '' : ' Tick the box to leave out what the song doesn\'t use.');
  $('#shrink-warn').innerHTML = res.warnings.map((w) => `<li>${esc(w)}</li>`).join('');
}

function defaultRoles() {
  state.roleOf.clear();
  const src = state.midi.sources;
  // A Circuit Tracks project's parts go back to their own tracks.
  if (src.some((s) => s.role)) { for (const s of src) if (s.role) state.roleOf.set(s.id, s.role); return; }
  for (const s of src) if (s.isDrum) state.roleOf.set(s.id, 'DR');
  const mel = src.filter((s) => !s.isDrum).sort((a, b) => b.notes.length - a.notes.length);
  ['S1', 'S2', 'M1', 'M2'].forEach((r, i) => { if (mel[i]) state.roleOf.set(mel[i].id, r); });
}

// ---------- step 2: parts ----------
function renderTracks() {
  const tbody = $('#tracks tbody');
  tbody.innerHTML = '';
  const len = state.midi.lengthTicks || 1;
  for (const s of state.midi.sources) {
    const tr = document.createElement('tr');
    const ch = `ch ${s.channel + 1}`;
    const sub = s.sub ?? (s.isDrum ? `GM drums · ${ch}` : `${GM_NAMES[s.program] ?? 'Unknown'} · ${ch}`);
    tr.innerHTML = `
      <td class="c-play"><button class="playbtn" type="button" aria-label="Play ${esc(s.name)}">${PLAY_ICON}</button></td>
      <td><div class="pname">${esc(s.name)}</div><div class="psub">${esc(sub)}</div></td>
      <td class="c-num">${s.notes.length}</td>
      <td class="c-roll"><canvas class="roll" width="400" height="56"></canvas></td>
      <td class="c-roles"><div class="roles">${ROLES.map((r) => `<button type="button" class="role" data-role="${r}" title="${ROLE_LABEL[r]}" ${r === 'DR' && !s.isDrum && !s.canDrum ? 'disabled' : ''}>${r === 'DR' ? 'Drums' : r}</button>`).join('')}</div></td>`;
    tr.querySelector('.playbtn').addEventListener('click', (e) => toggleSourcePlay(s, e.currentTarget));
    for (const b of tr.querySelectorAll('.role')) {
      b.addEventListener('click', () => {
        const r = b.dataset.role;
        if (state.roleOf.get(s.id) === r) state.roleOf.delete(s.id); else state.roleOf.set(s.id, r);
        syncRoleButtons();
        rolesChanged();
      });
    }
    tr.dataset.id = s.id;
    drawRoll(tr.querySelector('canvas'), s, len);
    tbody.append(tr);
  }
  syncRoleButtons();
}

function syncRoleButtons() {
  for (const tr of $('#tracks tbody').children) {
    const r = state.roleOf.get(tr.dataset.id);
    for (const b of tr.querySelectorAll('.role')) b.setAttribute('aria-pressed', String(b.dataset.role === r));
  }
}

function drawRoll(canvas, s, len) {
  const c = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  c.clearRect(0, 0, w, h);
  const [lo, hi] = s.isDrum ? [27, 87] : s.range;
  const span = Math.max(12, hi - lo + 1);
  c.fillStyle = getComputedStyle(document.documentElement).getPropertyValue(s.isDrum ? '--dr' : '--accent').trim() || '#888';
  for (const n of s.notes) {
    const x = (n.tick / len) * w;
    const y = h - 4 - ((n.note - lo) / span) * (h - 8);
    c.fillRect(x, y - 2, Math.max(1.5, (n.dur / len) * w), 3);
  }
}

function assignment() {
  const a = { S1: [], S2: [], M1: [], M2: [], DR: [] };
  for (const s of state.midi.sources) {
    const r = state.roleOf.get(s.id);
    if (r) a[r].push(s.id);
  }
  return a;
}

function sourcesFor(role) {
  return state.midi.sources.filter((s) => state.roleOf.get(s.id) === role);
}

function rolesChanged() {
  state.barCache.delete('lane4'); state.barCache.delete('lane5'); state.barCache.delete('lane6'); state.barCache.delete('lane7');
  // Default each synth patch to the GM program of the first part on it (the TracksGM Pack is in GM order;
  // other packs are assumed to be too).
  ['S1', 'S2'].forEach((r, i) => {
    const first = sourcesFor(r)[0];
    // A Circuit Tracks synth part keeps its own patch when its pack is the base pack.
    const slot = first?.patchSlot != null && state.base?.fromSong ? first.patchSlot : first?.program;
    if (!state.patchTouched[i] && first && !first.isDrum) setPatch($(`#patch-${r.toLowerCase()}`), slot);
    const list = sourcesFor(r).map((s) => s.name);
    $(`#sub-${r.toLowerCase()}`).textContent = list.length ? `Playing: ${list.join(' + ')}` : 'No part chosen; this track stays empty.';
  });
  const m = ['M1', 'M2'].map((r) => `${ROLE_LABEL[r]}: ${sourcesFor(r).map((s) => s.name).join(' + ') || 'empty'}`).join(' · ');
  $('#sub-midi').textContent = `${m}. These send notes on the MIDI channels set on your Circuit Tracks, to play external gear.`;
  renderTranspose();
  rearrange();
  updateShrinkInfo();
}

function renderTranspose() {
  const box = $('#transpose');
  box.innerHTML = '';
  for (const r of MELODIC_ROLES) {
    if (!sourcesFor(r).length) continue;
    const f = document.createElement('div');
    f.className = 'field';
    const id = `tr-${r}`;
    f.innerHTML = `<label for="${id}">${ROLE_LABEL[r]} octave</label><select id="${id}">${[-2, -1, 0, 1, 2].map((o) => `<option value="${o * 12}" ${o * 12 === state.transpose[r] ? 'selected' : ''}>${o > 0 ? '+' : ''}${o}</option>`).join('')}</select>`;
    f.querySelector('select').addEventListener('change', (e) => { state.transpose[r] = Number(e.target.value); rearrange(); });
    box.append(f);
  }
}

// ---------- step 4: arrangement ----------
function rearrange() {
  if (!state.midi) return;
  // Keep the preview going from the same place when a mute or option changes.
  const resumeAt = player.playing && !state.playingSource ? player.position : null;
  player.stop();
  setPlanButton(false);
  setSourceButton(null);
  updateRateLabels();
  const sec = $('#section-bars').value;
  const plan = arrange(state.midi, assignment(), {
    rate: $('#rate').value,
    tempoDiv: Number($('#tempo-div').value),
    sectionBars: sec === 'auto' ? 'auto' : Number(sec),
    match: $('#match').value,
    quantize: Number($('#quantize').value),
    align: $('#align').checked,
    trimStart: $('#trim').checked,
    kit: Number($('#kit').value),
    transpose: state.transpose,
    mutes: state.mutes,
  });
  state.plan = plan.error ? null : plan;
  $('#play').disabled = !state.plan;
  $('#build').disabled = !state.plan || !state.base;
  if (plan.error) {
    $('#summary').innerHTML = `<p class="status error">${esc(plan.error)}</p>`;
    $('#warnings').innerHTML = '';
    // Keep the grid so muted parts can be unmuted again.
    if (state.lastPlan) renderGrid(state.lastPlan, true); else $('#grid').innerHTML = '';
    return;
  }
  state.lastPlan = plan;
  renderSummary(plan);
  renderGrid(plan);
  renderWarnings(plan);
  if (resumeAt !== null) togglePlanPlay(resumeAt);
}

// Show how many bars each step rate puts in a pattern at the chosen tempo division, and the
// resulting project tempo.
function updateRateLabels() {
  const m = state.midi;
  const div = Number($('#tempo-div').value);
  for (const o of $('#rate').options) {
    if (o.value === 'auto') continue;
    const bars = patternBars(Number(o.value), div, m.timeSig);
    o.textContent = bars ? `${bars} bar${bars > 1 ? 's' : ''} · ${RATES[o.value].label}` : `${RATES[o.value].label} (doesn't fit this time signature)`;
    o.disabled = !bars;
  }
  for (const o of $('#tempo-div').options) {
    const d = Number(o.value);
    const bpm = Math.round(m.tempo / d);
    o.textContent = d === 1 ? `Original (${bpm} BPM)` : `÷${d} (${bpm} BPM)`;
    o.disabled = bpm < 40;
  }
}

function renderSummary(plan) {
  const maxPat = Math.max(...plan.projects.flatMap((p) => p.patternCounts));
  const scenes = plan.projects.map((p) => p.scenes.length);
  const tempoNote = plan.tempoDiv > 1 ? `BPM on the Tracks (${round1(plan.sourceTempo)} ÷ ${plan.tempoDiv})` : 'BPM';
  const stats = [
    [plan.projects.length, plan.projects.length === 1 ? 'project' : 'projects'],
    plan.variableScenes
      ? [scenes.reduce((a, b) => a + b, 0), 'scenes, each 1–8 patterns long']
      : [plan.nSections, `sections of ${plan.sectionBars} bars`],
    [scenes.join(' + '), 'scenes per project (max 16)'],
    plan.mixed ? patternRange(plan) : [`${plan.chunkBars} bar${plan.chunkBars > 1 ? 's' : ''}`, `per pattern (${plan.rateLabel})`],
    [`${maxPat} of 8`, 'most patterns used on a track'],
    [plan.tempo, tempoNote],
  ];
  $('#summary').innerHTML = stats.map(([v, k]) => `<div class="stat"><div class="v">${esc(String(v))}</div><div class="k">${esc(k)}</div></div>`).join('');
}

// Step rate per track: the range of pattern lengths, and each track's rate.
function patternRange(plan) {
  const act = plan.trackRates.filter((_, t) => plan.active[t]);
  const bars = act.map((x) => x.patBars);
  const lo = Math.min(...bars), hi = Math.max(...bars);
  return [`${lo === hi ? lo : `${lo}–${hi}`} bars`, `per pattern (step rate per track${plan.tempoDiv > 1 ? `, tempo ÷${plan.tempoDiv}` : ''})`];
}
function rateTag(plan, t) {
  return plan.mixed ? plan.trackRates[t].label.replace(' steps', '') : '';
}

// ---------- mutes ----------
// state.mutes = { all: Set(key), bars: Map(key -> Set(bar)) }. Keys: source ids, and
// 'lane4'..'lane7' for the drum tracks. Bars count from bar 0 of the file.
function totalBars() {
  const m = state.midi;
  return Math.ceil(m.lengthTicks / barTicks()) + 1;
}
function barTicks() {
  const m = state.midi;
  return m.ppq * 4 * m.timeSig.num / m.timeSig.den;
}
function isMuted(key, bar) {
  return state.mutes.all.has(key) || !!state.mutes.bars.get(key)?.has(bar);
}
// Bars that hold notes, per source and per drum lane (cached per file / assignment).
function notesBars(key) {
  const cache = state.barCache;
  if (cache.has(key)) return cache.get(key);
  const bt = barTicks();
  const set = new Set();
  if (key.startsWith('lane')) {
    const lane = Number(key.slice(4)) - 4;
    for (const s of sourcesFor('DR')) for (const n of s.notes) if (laneOf(n) === lane) set.add(Math.floor(n.tick / bt + 1e-9));
  } else {
    const s = state.midi.sources.find((x) => x.id === key);
    for (const n of s?.notes ?? []) set.add(Math.floor(n.tick / bt + 1e-9));
  }
  cache.set(key, set);
  return set;
}
// Muted = every bar with notes in `bars` is muted for every key (and there is something there).
function mutedState(keys, bars) {
  let on = 0, off = 0;
  for (const k of keys) {
    const nb = notesBars(k);
    for (const b of bars) {
      if (!nb.has(b)) continue;
      if (isMuted(k, b)) off++; else on++;
    }
  }
  return { has: on + off > 0, muted: on === 0 && off > 0, partial: on > 0 && off > 0 };
}
function toggleMute(keys, bars) {
  const { all, bars: byKey } = state.mutes;
  if (!bars) {
    const allMuted = keys.every((k) => all.has(k));
    for (const k of keys) {
      if (allMuted) all.delete(k);
      else { all.add(k); byKey.delete(k); }
    }
  } else {
    const { muted } = mutedState(keys, bars);
    for (const k of keys) {
      if (!byKey.has(k)) byKey.set(k, new Set());
      const set = byKey.get(k);
      if (muted) {
        if (all.has(k)) {          // whole part was muted: keep the rest muted, open these bars
          all.delete(k);
          for (let b = 0; b < totalBars(); b++) set.add(b);
        }
        for (const b of bars) set.delete(b);
      } else {
        for (const b of bars) set.add(b);
      }
    }
  }
  rearrange();
}

function renderGrid(plan, stale = false) {
  const grid = $('#grid');
  grid.innerHTML = '';
  grid.classList.toggle('stale', stale);
  const order = playOrder(plan);
  if (!stale) state.order = order;

  // Rows: each Circuit Tracks track, then the MIDI parts feeding it.
  const rows = [];
  MELODIC_ROLES.forEach((r, t) => {
    if (!plan.active[t]) return;
    const srcs = sourcesFor(r);
    rows.push({ kind: 'track', t, name: TRACK_NAMES[t], keys: srcs.map((s) => s.id) });
    for (const s of srcs) rows.push({ kind: 'src', t, name: s.name, sub: s.instrument, keys: [s.id] });
  });
  if (plan.active[4]) {
    for (let t = 4; t < 8; t++) rows.push({ kind: 'lane', t, name: TRACK_NAMES[t], keys: [`lane${t}`] });
    for (const s of sourcesFor('DR')) rows.push({ kind: 'src', t: 4, name: s.name, sub: s.sub ?? 'GM drums', keys: [s.id] });
  }
  state.gridRows = rows;

  const labels = document.createElement('div');
  labels.className = 'labels';
  labels.innerHTML = `<div class="row-label head">Project</div><div class="row-label head">Scene · bar</div>`;
  rows.forEach((row, ri) => {
    const d = document.createElement('div');
    d.className = `row-label ${row.kind === 'src' ? 'src' : ''}`;
    const whole = row.keys.length > 0 && row.keys.every((k) => state.mutes.all.has(k));
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = `dot${whole ? ' off' : ''}`;
    dot.style.setProperty('--c', `var(${TRACK_VAR[row.t]})`);
    dot.title = `${whole ? 'Unmute' : 'Mute'} ${row.name}`;
    dot.setAttribute('aria-pressed', String(!whole));
    dot.addEventListener('click', () => toggleMute(row.keys, null));
    const name = document.createElement('span');
    name.className = 'nm';
    name.textContent = row.name;
    if (row.kind !== 'src' && rateTag(plan, row.t)) {
      const tag = document.createElement('small');
      tag.className = 'rtag';
      tag.textContent = rateTag(plan, row.t);
      tag.title = `${plan.trackRates[row.t].label}: ${plan.trackRates[row.t].patBars} bar${plan.trackRates[row.t].patBars > 1 ? 's' : ''} per pattern`;
      name.append(' ', tag);
    }
    if (row.sub) name.title = `${row.name} · ${row.sub}`;
    d.append(dot, name);
    if (row.kind !== 'src') {
      const s = document.createElement('button');
      s.type = 'button'; s.textContent = 'S'; s.className = `solo${player.solo === row.t ? ' on' : ''}`;
      s.title = `Solo ${row.name} in the preview`;
      s.dataset.solo = row.t;
      s.addEventListener('click', () => {
        player.setSolo(row.t);
        for (const b of labels.querySelectorAll('button[data-solo]')) b.classList.toggle('on', Number(b.dataset.solo) === player.solo);
      });
      d.append(s);
    }
    labels.append(d);
  });
  grid.append(labels);

  const barOf = (chunk) => plan.startBar + chunk * plan.chunkBars;
  const colours = projectColours(plan.projects.length, $('#projcolors').value);
  order.forEach((o, k) => {
    const col = document.createElement('div');
    col.className = 'col';
    const prev = order[k - 1];
    if (prev && prev.project !== o.project) col.classList.add('proj-start');
    else if (prev && prev.section !== o.section) col.classList.add('sec-start');
    const proj = plan.projects[o.project];
    const projHead = !prev || prev.project !== o.project
      ? `<span class="pdot" style="background:rgb(${PROJECT_COLOURS[colours[o.project]][1].join(',')})" title="${PROJECT_COLOURS[colours[o.project]][0]}"></span>P${o.project + 1}` : '';
    const sceneHead = !prev || prev.section !== o.section ? `${o.scene + 1}·${barOf(o.chunk) + 1}` : '';
    const b0 = barOf(o.chunk);
    const bars = Array.from({ length: plan.chunkBars }, (_, i) => b0 + i);
    let html = `<div class="hd">${projHead}</div><div class="hd">${sceneHead}</div>`;
    rows.forEach((row, ri) => {
      const ms = mutedState(row.keys, bars);
      const range = plan.chunkBars > 1 ? `bars ${b0 + 1}–${b0 + plan.chunkBars}` : `bar ${b0 + 1}`;
      if (row.kind === 'src') {
        const cls = !ms.has ? 'empty' : ms.muted ? 'muted' : ms.partial ? 'on part' : 'on';
        html += `<button type="button" class="cell src ${cls}" data-row="${ri}" data-col="${k}" style="--c:var(${TRACK_VAR[row.t]})" title="${esc(row.name)}, ${range}${ms.has ? (ms.muted ? ' (muted): click to unmute' : ms.partial ? ' (partly muted): click to mute all' : ': click to mute') : ' (no notes)'}"></button>`;
      } else {
        // A track with a shorter step rate plays several patterns in one column.
        const subs = o.sub?.[row.t] ?? [o.patterns[row.t]];
        const p = subs[0];
        const empty = subs.every((i) => !proj.patterns[row.t][i]?.steps.length);
        const mix = 100 - (p % 8) * 8;
        const cls = ms.muted ? 'muted' : empty ? 'empty' : '';
        const same = subs.every((i) => i === p);
        const txt = same ? `${p + 1}` : subs.every((i, j) => i === p + j) ? `${p + 1}–${subs[subs.length - 1] + 1}` : subs.map((i) => i + 1).join('·');
        const what = same ? `pattern ${p + 1}${subs.length > 1 ? ` ×${subs.length}` : ''}` : `patterns ${subs.map((i) => i + 1).join(', ')}`;
        html += `<button type="button" class="cell ${cls}${txt.length > 2 ? ' multi' : ''}" data-row="${ri}" data-col="${k}" style="${empty ? '' : `background:color-mix(in srgb, var(${TRACK_VAR[row.t]}) ${mix}%, #000)`}" title="${row.name}: ${what}, ${range}${ms.muted ? ' (muted): click to unmute' : ms.has ? ': click to mute' : ' (empty)'}">${txt}</button>`;
      }
    });
    col.innerHTML = html;
    col.dataset.bars = bars.join(',');
    grid.append(col);
  });
}

function onGridClick(e) {
  const cell = e.target.closest('.cell[data-row]');
  if (!cell) return;
  const row = state.gridRows[Number(cell.dataset.row)];
  const col = cell.closest('.col');
  if (!row || !col) return;
  const bars = col.dataset.bars.split(',').map(Number);
  if (!mutedState(row.keys, bars).has) return;
  toggleMute(row.keys, bars);
}

function renderWarnings(plan) {
  const w = plan.warnings;
  const out = [];
  const m = state.midi;
  if (plan.projects.length > 1) out.push(`The song needs ${plan.projects.length} projects: each track holds 8 patterns per project, and this song has more distinct material than that. On the Circuit Tracks, queue the next project to carry on (projects 1–${plan.projects.length}). Longer patterns or muting parts can bring this down.`);
  if (w.tooLong) out.push('The song is longer than 64 projects; only the first 64 fit in a pack.');
  if (w.moved) out.push(`${w.moved} of ${w.total} notes (${Math.round(w.movedRatio * 100)}%) moved by more than a 64th note to fit the step grid. Each step has 6 micro-steps, so longer patterns place notes less precisely.`);
  if (plan.tempoDiv > 1) out.push(`The project tempo is ${plan.tempo} BPM, ${plan.tempoDiv === 2 ? 'half' : 'a quarter of'} the song's ${round1(plan.sourceTempo)} BPM, so each step covers ${plan.tempoDiv}× as much of the song. The song plays at its own speed, but tempo-synced effects (delay, synced LFOs, arpeggios) and MIDI clock run ${plan.tempoDiv === 2 ? 'at half' : 'at a quarter of the'} speed.`);
  if (w.similarPatterns) out.push(`${w.similarPatterns} patterns were replaced by a similar earlier one, changing ${w.similarNotes} notes (${Math.round(100 * w.similarNotes / Math.max(1, w.total))}%).`);
  if (plan.leadBars) out.push(`Sections start ${plan.leadBars} bar${plan.leadBars > 1 ? 's' : ''} before the first note so that repeats line up, which saves a project; the song begins after ${plan.leadBars} empty bar${plan.leadBars > 1 ? 's' : ''}.`);
  if (w.dropped) out.push(`${w.dropped} notes were left out where more than 6 notes start on one step (the lowest and highest notes are kept).`);
  if (w.drumDropped) out.push(`${w.drumDropped} drum hits were left out where two sounds land on the same step of one drum track (the louder one is kept).`);
  if (w.held) out.push(`${w.held} long notes run past the end of a pattern; they are struck again at the start of the next pattern.`);
  if (m.tempoChanges) out.push(`The file has ${m.tempoChanges} tempo changes; the project uses the first tempo throughout.`);
  if (plan.tempoClamped) out.push(`The tempo was limited to the Circuit Tracks range of 40–240 BPM.`);
  if (m.timeSigChanges) out.push(`The file changes time signature; it is arranged as ${m.timeSig.num}/${m.timeSig.den} throughout.`);
  if (fromPack()) {
    const pitched = sourcesFor('DR').filter((s) => s.pitched);
    if (pitched.length) out.push(`${pitched.map((s) => s.name).join(', ')} ${pitched.length > 1 ? 'play' : 'plays'} samples at different pitches. The Circuit Tracks drum tracks play each sample at one pitch, so those steps lose their pitch. Sending ${pitched.length > 1 ? 'them' : 'it'} to Synth 1, Synth 2 or MIDI plays the pitches with a patch instead.`);
    const mel = MELODIC_ROLES.flatMap((r) => sourcesFor(r)).filter((s) => s.kind === 'sample');
    if (mel.length) out.push(`${mel.map((s) => s.name).join(', ')}: sample parts on a synth or MIDI track play the notes with a patch or external gear, not the samples.`);
  }
  $('#warnings').innerHTML = out.map((x) => `<li>${esc(x)}</li>`).join('');
}

// ---------- preview ----------
function planEvents(plan) {
  const chunkSec = plan.patLen * (60 / plan.tempo) * plan.syncQuarters;
  const programs = MELODIC_ROLES.map((r) => sourcesFor(r)[0]?.program ?? 0);
  const ev = [];
  state.order.forEach((o, k) => {
    const proj = plan.projects[o.project];
    for (let t = 0; t < 8; t++) {
      if (!plan.active[t]) continue;
      // Each track at its own step rate: k shorter patterns per column when finer.
      const tr = plan.trackRates?.[t] ?? plan;
      const stepSec = (60 / plan.tempo) * tr.syncQuarters;
      const micro = stepSec / 6;
      const subs = o.sub?.[t] ?? [o.patterns[t]];
      subs.forEach((pi, j) => {
        const pat = proj.patterns[t][pi];
        if (!pat) return;
        const t0 = k * chunkSec + j * tr.patLen * stepSec;
        for (const s of pat.steps) {
          if (t < 4) {
            for (const n of s.notes) ev.push({ t: t0 + (s.step * 6 + n.delay) * micro, d: n.len * micro, track: t, note: n.note - 12, vel: n.vel, program: programs[t] });
          } else {
            for (let b = 0; b < 6; b++) if (s.mask >> b & 1) ev.push({ t: t0 + (s.step * 6 + b) * micro, d: 0.1, track: t, part: s.part, vel: s.vel });
          }
        }
      });
    }
  });
  ev.sort((a, b) => a.t - b.t);
  return { ev, chunkSec, length: state.order.length * chunkSec };
}

async function togglePlanPlay(from = 0) {
  if (typeof from !== 'number') from = 0;
  if (player.playing && !state.playingSource && !from) { player.stop(); setPlanButton(false); return; }
  setSourceButton(null);
  const { ev, chunkSec, length } = planEvents(state.plan);
  const cols = [...$('#grid').querySelectorAll('.col')];
  let last = -1;
  player.onPosition = (pos) => {
    $('#time').textContent = mmss(pos);
    const k = Math.min(cols.length - 1, Math.floor(pos / chunkSec));
    if (k !== last) {
      cols[last]?.classList.remove('now');
      cols[k]?.classList.add('now');
      if (cols[k]) {
        const wrap = $('#gridwrap');
        const x = cols[k].offsetLeft;
        if (x < wrap.scrollLeft + 120 || x > wrap.scrollLeft + wrap.clientWidth - 60) wrap.scrollLeft = x - 120;
      }
      last = k;
    }
  };
  player.onEnd = () => { setPlanButton(false); cols[last]?.classList.remove('now'); };
  state.playingSource = null;
  await loadKitSamples();
  await player.play(ev, { from, length });
  setPlanButton(true);
}

function setPlanButton(on) {
  $('#play').textContent = on ? 'Stop' : 'Play preview';
  if (!on) for (const c of document.querySelectorAll('.col.now')) c.classList.remove('now');
}

async function toggleSourcePlay(s, btn) {
  if (state.playingSource === s.id) { player.stop(); setSourceButton(null); return; }
  setPlanButton(false);
  const m = state.midi;
  const sec = (tick) => (tick / m.ppq) * (60 / m.tempo);
  const role = state.roleOf.get(s.id);
  const track = role && role !== 'DR' ? ROLE_TRACK[role] : 0;
  const shift = role && role !== 'DR' ? state.transpose[role] : 0;
  const ev = s.notes.map((n) => {
    if (role === 'DR' || (!role && s.isDrum)) {
      return { t: sec(n.tick), d: 0.1, track: 4 + laneOf(n), part: partOf(n), vel: n.vel };
    }
    return { t: sec(n.tick), d: sec(n.dur), track, note: n.note + shift, vel: n.vel, program: s.program };
  });
  const from = ev.length ? Math.max(0, ev[0].t - 0.2) : 0;
  player.onPosition = null;
  player.onEnd = () => setSourceButton(null);
  // Solo/mute apply to the arrangement preview only.
  const savedMutes = player.mutes.slice(), savedSolo = player.solo;
  player.mutes.fill(false); player.solo = -1;
  await loadKitSamples();
  await player.play(ev, { from });
  player.mutes = savedMutes; player.solo = savedSolo;
  state.playingSource = s.id;
  setSourceButton(btn);
}

function setSourceButton(btn) {
  for (const b of document.querySelectorAll('.playbtn')) { b.classList.remove('on'); b.innerHTML = PLAY_ICON; }
  if (btn) { btn.classList.add('on'); btn.innerHTML = STOP_ICON; } else state.playingSource = null;
}

// ---------- step 5: build ----------
async function build() {
  if (!state.plan || !state.base) return;
  const status = $('#build-status');
  status.classList.remove('error');
  status.textContent = 'Building…';
  try {
    const title = ascii($('#title').value).trim() || 'TracksGM Song';
    const packName = ascii($('#packname').value).trim() || `TracksGM ${title}`;
    const synthPatch = [Number($('#patch-s1').value), Number($('#patch-s2').value)];
    // A pack project as the song: the base pack's patches with the loaded pack's samples.
    let base = state.base, sampleMap = null;
    if (fromPack()) {
      const shrink = $('#shrink-on').checked;
      ({ base, sampleMap } = await composePack(state.base, state.songPack, { slots: drumSlots(), shrink, keepPatches: shrink ? synthPatch : null }));
    }
    const projects = buildProjects(state.plan, state.base, {
      title,
      synthPatch,
      kit: Number($('#kit').value),
      sampleMap,
      colors: projectColours(state.plan.projects.length, $('#projcolors').value),
    });
    const blob = await buildPack(base, projects.slice(0, 64), { name: packName, color: $('#packcolor').value });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${packName.replace(/[^A-Za-z0-9 _-]+/g, '').trim() || 'TracksGM'}.circuittrackspack`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
    status.textContent = `Saved ${a.download}: ${projects.length} project${projects.length > 1 ? 's' : ''}, ${(blob.size / 1e6).toFixed(1)} MB.`;
  } catch (e) {
    status.textContent = `Could not build the pack: ${e.message}`;
    status.classList.add('error');
  }
}

// ---------- helpers ----------
function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function ascii(s) { return (s || '').normalize('NFKD').replace(/[^\x20-\x7e]/g, ''); }
function round1(x) { return Math.round(x * 10) / 10; }
function mmss(s) { const m = Math.floor(s / 60); return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`; }

// For tests and the console.
window.tracksgm = { state, player, TRACKS };
