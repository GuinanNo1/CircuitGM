import { parseMidi, GM_NAMES } from './midifile.js';
import { arrange, playOrder, gmDrum, TRACKS, KITS, KIT_PARTS, MELODIC_ROLES } from './convert.js';
import { loadBase, buildProjects, buildPack } from './build.js';
import { Player } from './player.js';

const $ = (s) => document.querySelector(s);
const ROLES = ['S1', 'S2', 'M1', 'M2', 'DR'];
const ROLE_LABEL = { S1: 'Synth 1', S2: 'Synth 2', M1: 'MIDI 1', M2: 'MIDI 2', DR: 'Drums' };
const ROLE_TRACK = { S1: 0, S2: 1, M1: 2, M2: 3 };
const TRACK_VAR = ['--s1', '--s2', '--m1', '--m2', '--dr', '--dr', '--dr', '--dr'];
const TRACK_NAMES = ['Synth 1', 'Synth 2', 'MIDI 1', 'MIDI 2', 'Kick', 'Snare/Tom', 'Hi-hats', 'Perc'];
const PLAY_ICON = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 1l9 5-9 5z"/></svg>';
const STOP_ICON = '<svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="2" width="8" height="8"/></svg>';

const state = {
  base: null,
  midi: null,
  fileName: '',
  roleOf: new Map(),        // source id -> role
  patchTouched: [false, false],
  transpose: { S1: 0, S2: 0, M1: 0, M2: 0 },
  plan: null,
  playingSource: null,
};
const player = new Player();

// ---------- startup ----------
init();

async function init() {
  wireLoad();
  try {
    state.base = await loadBase();
    fillPatchSelects();
    fillKitSelect();
    $('#base-status').textContent = `TracksGM sound set ready: ${state.base.patches.filter((p) => p.data).length} patches, ${state.base.samples.filter((s) => s.name).length} drum samples.`;
  } catch (e) {
    $('#base-status').textContent = `Could not load the TracksGM sound set: ${e.message}. If you opened index.html straight from disk, serve the folder instead (see README).`;
    $('#base-status').classList.add('error');
  }
  for (const id of ['#section-bars', '#rate', '#match', '#trim']) $(id).addEventListener('change', rearrange);
  $('#patch-s1').addEventListener('change', () => { state.patchTouched[0] = true; });
  $('#patch-s2').addEventListener('change', () => { state.patchTouched[1] = true; });
  $('#kit').addEventListener('change', rearrange);
  $('#play').addEventListener('click', togglePlanPlay);
  $('#build').addEventListener('click', build);
  player.onEnd = () => { setPlanButton(false); setSourceButton(null); };
}

function wireLoad() {
  const drop = $('#drop');
  const input = $('#file');
  input.addEventListener('change', () => input.files[0] && loadFile(input.files[0]));
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    const f = e.dataTransfer.files[0];
    if (f) loadFile(f);
  });
}

function fillPatchSelects() {
  for (const id of ['#patch-s1', '#patch-s2']) {
    const sel = $(id);
    sel.innerHTML = '';
    for (const p of state.base.patches) {
      if (!p.data) continue;
      const o = document.createElement('option');
      o.value = p.slot;
      o.textContent = `${String(p.slot + 1).padStart(3, '0')}  ${p.name}`;
      sel.append(o);
    }
  }
  $('#patch-s1').value = '0';
  $('#patch-s2').value = '32';
}

function fillKitSelect() {
  const sel = $('#kit');
  sel.innerHTML = '';
  KITS.forEach((k, i) => {
    const o = document.createElement('option');
    o.value = i;
    const kick = state.base.samples[i * 8]?.name ?? '';
    o.textContent = `${k} kit (samples ${i * 8 + 1}–${i * 8 + 8})`;
    o.title = kick;
    sel.append(o);
  });
  sel.value = '1';
}

let loadedKit = -1;
async function loadKitSamples() {
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
async function loadFile(file) {
  player.stop();
  setPlanButton(false);
  try {
    const midi = parseMidi(await file.arrayBuffer());
    if (!midi.sources.length) throw new Error('The file has no notes.');
    state.midi = midi;
    state.fileName = file.name.replace(/\.(mid|midi|rmi|kar)$/i, '');
  } catch (e) {
    const info = $('#fileinfo');
    info.hidden = false;
    info.innerHTML = `<span class="status error">${esc(e.message)}</span>`;
    for (const id of ['#step-tracks', '#step-sounds', '#step-arrange', '#step-build']) $(id).hidden = true;
    return;
  }
  const m = state.midi;
  const bars = m.lengthTicks / (m.ppq * 4 * m.timeSig.num / m.timeSig.den);
  const info = $('#fileinfo');
  info.hidden = false;
  info.innerHTML = [
    ['File', esc(file.name)],
    ['Tempo', `${round1(m.tempo)} BPM${m.tempoChanges ? ` (+${m.tempoChanges} changes)` : ''}`],
    ['Time', `${m.timeSig.num}/${m.timeSig.den}`],
    ['Length', `${Math.ceil(bars)} bars`],
    ['Parts', m.sources.length],
  ].map(([k, v]) => `<span><span class="k">${k}</span><b>${v}</b></span>`).join('');

  defaultRoles();
  state.patchTouched = [false, false];
  state.transpose = { S1: 0, S2: 0, M1: 0, M2: 0 };
  $('#title').value = ascii(state.fileName).slice(0, 28);
  $('#packname').value = `TracksGM ${ascii(state.fileName)}`.slice(0, 40);
  renderTracks();
  for (const id of ['#step-tracks', '#step-sounds', '#step-arrange', '#step-build']) $(id).hidden = false;
  rolesChanged();
}

function defaultRoles() {
  state.roleOf.clear();
  const src = state.midi.sources;
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
    const sub = s.isDrum ? `GM drums · ${ch}` : `${GM_NAMES[s.program] ?? 'Unknown'} · ${ch}`;
    tr.innerHTML = `
      <td class="c-play"><button class="playbtn" type="button" aria-label="Play ${esc(s.name)}">${PLAY_ICON}</button></td>
      <td><div class="pname">${esc(s.name)}</div><div class="psub">${esc(sub)}</div></td>
      <td class="c-num">${s.notes.length}</td>
      <td class="c-roll"><canvas class="roll" width="400" height="56"></canvas></td>
      <td class="c-roles"><div class="roles">${ROLES.map((r) => `<button type="button" class="role" data-role="${r}" title="${ROLE_LABEL[r]}" ${r === 'DR' && !s.isDrum ? 'disabled' : ''}>${r === 'DR' ? 'Drums' : r}</button>`).join('')}</div></td>`;
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
  // Default each synth patch to the GM program of the first part on it (TracksGM is in GM order).
  ['S1', 'S2'].forEach((r, i) => {
    const first = sourcesFor(r)[0];
    if (!state.patchTouched[i] && first && !first.isDrum) $(`#patch-${r.toLowerCase()}`).value = String(first.program);
    const list = sourcesFor(r).map((s) => s.name);
    $(`#sub-${r.toLowerCase()}`).textContent = list.length ? `Playing: ${list.join(' + ')}` : 'No part chosen; this track stays empty.';
  });
  const m = ['M1', 'M2'].map((r) => `${ROLE_LABEL[r]}: ${sourcesFor(r).map((s) => s.name).join(' + ') || 'empty'}`).join(' · ');
  $('#sub-midi').textContent = `${m}. These send notes on the MIDI channels set on your Circuit Tracks, to play external gear.`;
  renderTranspose();
  rearrange();
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
  player.stop();
  setPlanButton(false);
  setSourceButton(null);
  const plan = arrange(state.midi, assignment(), {
    rate: $('#rate').value,
    sectionBars: Number($('#section-bars').value),
    match: $('#match').value,
    trimStart: $('#trim').checked,
    kit: Number($('#kit').value),
    transpose: state.transpose,
  });
  state.plan = plan.error ? null : plan;
  $('#play').disabled = !state.plan;
  $('#build').disabled = !state.plan || !state.base;
  if (plan.error) {
    $('#summary').innerHTML = `<p class="status error">${esc(plan.error)}</p>`;
    $('#grid').innerHTML = '';
    $('#warnings').innerHTML = '';
    return;
  }
  renderSummary(plan);
  renderGrid(plan);
  renderWarnings(plan);
}

function renderSummary(plan) {
  const maxPat = Math.max(...plan.projects.flatMap((p) => p.patternCounts));
  const scenes = plan.projects.map((p) => p.scenes.length);
  const stats = [
    [plan.projects.length, plan.projects.length === 1 ? 'project' : 'projects'],
    [plan.nSections, `sections of ${plan.sectionBars} bars`],
    [scenes.join(' + '), 'scenes per project (max 16)'],
    [`${plan.chunkBars} bar${plan.chunkBars > 1 ? 's' : ''}`, `per pattern (${plan.rateLabel})`],
    [`${maxPat} of 8`, 'most patterns used on a track'],
    [plan.tempo, 'BPM'],
  ];
  $('#summary').innerHTML = stats.map(([v, k]) => `<div class="stat"><div class="v">${esc(String(v))}</div><div class="k">${esc(k)}</div></div>`).join('');
}

function renderGrid(plan) {
  const grid = $('#grid');
  grid.innerHTML = '';
  const order = playOrder(plan);
  state.order = order;
  const labels = document.createElement('div');
  labels.className = 'labels';
  labels.innerHTML = `<div class="row-label head">Project</div><div class="row-label head">Scene · bar</div>`;
  TRACK_NAMES.forEach((name, t) => {
    const d = document.createElement('div');
    d.className = 'row-label';
    d.style.opacity = plan.active[t] ? '1' : '0.45';
    d.innerHTML = `<span class="sw" style="background:var(${TRACK_VAR[t]})"></span>${name}`;
    if (plan.active[t]) {
      const m = document.createElement('button');
      m.type = 'button'; m.textContent = 'M'; m.title = `Mute ${name} in the preview`;
      m.className = player.mutes[t] ? 'on' : '';
      m.addEventListener('click', () => { player.setMute(t, !player.mutes[t]); m.classList.toggle('on', player.mutes[t]); });
      const s = document.createElement('button');
      s.type = 'button'; s.textContent = 'S'; s.title = `Solo ${name} in the preview`;
      s.className = player.solo === t ? 'on' : '';
      s.addEventListener('click', () => {
        player.setSolo(t);
        for (const b of labels.querySelectorAll('button[data-solo]')) b.classList.toggle('on', Number(b.dataset.solo) === player.solo);
      });
      s.dataset.solo = t;
      d.append(m, s);
    }
    labels.append(d);
  });
  grid.append(labels);

  const barOf = (chunk) => plan.startBar + chunk * plan.chunkBars + 1;
  order.forEach((o, k) => {
    const col = document.createElement('div');
    col.className = 'col';
    const prev = order[k - 1];
    if (prev && prev.project !== o.project) col.classList.add('proj-start');
    else if (prev && prev.section !== o.section) col.classList.add('sec-start');
    const proj = plan.projects[o.project];
    const projHead = !prev || prev.project !== o.project ? `P${o.project + 1}` : '';
    const sceneHead = !prev || prev.section !== o.section ? `${o.scene + 1}·${barOf(o.chunk)}` : '';
    let html = `<div class="hd">${projHead}</div><div class="hd">${sceneHead}</div>`;
    for (let t = 0; t < 8; t++) {
      if (!plan.active[t]) { html += '<div class="cell dim"></div>'; continue; }
      const p = o.patterns[t];
      const content = proj.patterns[t][p];
      const empty = !content || !content.steps.length;
      const mix = 100 - (p % 8) * 8;
      html += `<div class="cell${empty ? ' empty' : ''}" style="${empty ? '' : `background:color-mix(in srgb, var(${TRACK_VAR[t]}) ${mix}%, #000)`}" title="${TRACK_NAMES[t]}: pattern ${p + 1}${empty ? ' (empty)' : ''}">${p + 1}</div>`;
    }
    col.innerHTML = html;
    grid.append(col);
  });
}

function renderWarnings(plan) {
  const w = plan.warnings;
  const out = [];
  const m = state.midi;
  if (plan.projects.length > 1) out.push(`The song needs ${plan.projects.length} projects: each track holds 8 patterns per project, and this song has more distinct material than that. On the Circuit Tracks, queue the next project to carry on (projects ${1}–${plan.projects.length}).`);
  if (w.tooLong) out.push('The song is longer than 64 projects; only the first 64 fit in a pack.');
  if (w.dropped) out.push(`${w.dropped} notes were left out where more than 6 notes start on one step (the lowest and highest notes are kept).`);
  if (w.drumDropped) out.push(`${w.drumDropped} drum hits were left out where two sounds land on the same step of one drum track (the louder one is kept).`);
  if (w.held) out.push(`${w.held} long notes run past the end of a pattern; they are struck again at the start of the next pattern.`);
  if (m.tempoChanges) out.push(`The file has ${m.tempoChanges} tempo changes; the project uses the first tempo (${plan.tempo} BPM) throughout.`);
  if (plan.tempoClamped) out.push(`The tempo was limited to the Circuit Tracks range of 40–240 BPM.`);
  if (m.timeSigChanges) out.push(`The file changes time signature; it is arranged as ${m.timeSig.num}/${m.timeSig.den} throughout.`);
  $('#warnings').innerHTML = out.map((x) => `<li>${esc(x)}</li>`).join('');
}

// ---------- preview ----------
function planEvents(plan) {
  const stepSec = (60 / plan.tempo) * (plan.rate === 16 ? 0.25 : 0.5);
  const micro = stepSec / 6;
  const chunkSec = plan.patLen * stepSec;
  const programs = MELODIC_ROLES.map((r) => sourcesFor(r)[0]?.program ?? 0);
  const ev = [];
  state.order.forEach((o, k) => {
    const t0 = k * chunkSec;
    const proj = plan.projects[o.project];
    for (let t = 0; t < 8; t++) {
      if (!plan.active[t]) continue;
      const pat = proj.patterns[t][o.patterns[t]];
      if (!pat) continue;
      for (const s of pat.steps) {
        if (t < 4) {
          for (const n of s.notes) ev.push({ t: t0 + (s.step * 6 + n.delay) * micro, d: n.len * micro, track: t, note: n.note - 12, vel: n.vel, program: programs[t] });
        } else {
          for (let b = 0; b < 6; b++) if (s.mask >> b & 1) ev.push({ t: t0 + (s.step * 6 + b) * micro, d: 0.1, track: t, part: s.part, vel: s.vel });
        }
      }
    }
  });
  ev.sort((a, b) => a.t - b.t);
  return { ev, chunkSec, length: state.order.length * chunkSec };
}

async function togglePlanPlay() {
  if (player.playing && !state.playingSource) { player.stop(); setPlanButton(false); return; }
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
  await player.play(ev, { length });
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
    if (s.isDrum) {
      const [dt, part] = gmDrum(n.note);
      return { t: sec(n.tick), d: 0.1, track: 4 + dt, part, vel: n.vel };
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
    const projects = buildProjects(state.plan, state.base, {
      title,
      synthPatch: [Number($('#patch-s1').value), Number($('#patch-s2').value)],
      kit: Number($('#kit').value),
      color: 8,
    });
    const blob = await buildPack(state.base, projects.slice(0, 64), { name: packName, color: $('#packcolor').value });
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
