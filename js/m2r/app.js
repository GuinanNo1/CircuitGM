// MIDI2Rhythm page: load a MIDI file, choose and reduce the parts, check the arrangement,
// hear it, build a Circuit Rhythm pack. The work is done in js/m2r/engine.js (parts and
// tracks), js/m2r/arrange.js (patterns, scenes, projects) and js/m2r/build.js (pack).
import { parseMidi } from '../midifile.js';
import { setupMode } from '../mode.js';
import { projectColours, PROJECT_COLOURS } from '../convert.js';
import { Player } from '../player.js';
import { planTracks, METHODS, ADV_ONLY_METHODS, INST_SLOTS, KIT_FIRST, isUnpitched, rootFromName, drumMap } from './engine.js?v=20261114m2r6';
import { arrangeRhythm, playOrder, MAX_PROJECTS } from './arrange.js?v=20261114m2r6';
import { buildRhythmProjects, buildRhythmPack, openPack, fetchBuf, usedSamples, shortName } from './build.js?v=20261114m2r6';

const $ = (s) => document.querySelector(s);
const DRUM_KITS = ['Std', 'Room', 'Power', 'Elec', '808', 'Jazz', 'Brush', 'Orch'];
const LATIN_KITS = ['Std', 'Room', 'Power', 'Elec', '808', 'Dance', 'Jazz', 'Brush'];
const NAME_MAX = 16;
const PLAY_ICON = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 1l9 5-9 5z"/></svg>';
const STOP_ICON = '<svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="2" width="8" height="8"/></svg>';
const state = {
  midi: null, fileName: '',
  inst: null, packs: {}, meta: {}, template: null,
  parts: new Map(),          // source id -> { on, method, sample }
  res: null, arr: null,
  solo: -1,
  mutes: new Set(),          // muted track indices (preview and pack); cleared when the tracks change
  barMutes: new Map(),       // 't<track>' or 'p:<part id>' -> Set of bars (from the start of the file) muted
  playingPart: null,
};
const player = new Player();
const mode = setupMode('m2r');

init();

async function init() {
  wireLoad();
  for (const id of ['#kit', '#range', '#drum-tracks', '#arp-rate', '#share', '#autosplit']) $(id).addEventListener('change', recompute);
  for (const id of ['#rate', '#section-bars', '#tempo-div', '#match', '#align', '#trimstart']) $(id).addEventListener('change', rearrange);
  $('#play').addEventListener('click', togglePlay);
  $('#build').addEventListener('click', build);
  $('#title').addEventListener('input', () => { if (!state.packTouched) $('#packname').value = $('#title').value; });
  $('#packname').addEventListener('input', () => { state.packTouched = true; });
  $('#grid').addEventListener('click', onGridClick);
  $('#advanced').addEventListener('change', () => { if (state.res) renderParts(); });
  player.onPosition = (t) => { $('#time').textContent = mmss(t); markNow(t); };
  player.onEnd = () => setPlayButton(false);
  fillKitSelect();
  const status = $('#base-status');
  try {
    const [inst, drum, tpl, dmeta, lmeta] = await Promise.all([
      fetchBuf('../rhythmgm/RhythmInstGM.circuitrhythmpack').then(openPack),
      fetchBuf('../rhythmgm/RhythmDrumGM.circuitrhythmpack').then(openPack),
      fetchBuf('../data/RhythmEmpty.ncs?v=20261114m2r6'),
      fetch('../rhythmgm/rhythmdrumgm_samples.json').then((r) => r.json()),
      fetch('../rhythmgm/rhythmlatingm_samples.json').then((r) => r.json()),
    ]);
    state.inst = inst;
    state.packs.drum = drum;
    state.template = tpl;
    state.meta.drum = dmeta.samples;
    state.meta.latin = lmeta.samples;
    status.textContent = 'Ready: 112 GM instruments, 16 drum kits.';
    if (state.midi) recompute();
  } catch (e) {
    status.textContent = `The RhythmGM packs could not be loaded: ${e.message}`;
    status.classList.add('error');
  }
}

function fillKitSelect() {
  const sel = $('#kit');
  const add = (group, items) => {
    const g = document.createElement('optgroup');
    g.label = group;
    for (const [value, label] of items) g.append(new Option(label, value));
    sel.append(g);
  };
  add('RhythmDrumGM', DRUM_KITS.map((k, i) => [`drum:${i}`, `${k} kit`]));
  add('RhythmLatinGM', LATIN_KITS.map((k, i) => [`latin:${i}`, `Latin ${k}`]));
  sel.value = 'drum:1';
}

function kitChoice() {
  const [pack, i] = $('#kit').value.split(':');
  return { pack, index: Number(i) };
}

async function kitPack() {
  const { pack } = kitChoice();
  if (!state.packs[pack]) {
    $('#base-status').textContent = 'Loading RhythmLatinGM…';
    state.packs[pack] = await openPack(await fetchBuf('../rhythmgm/RhythmLatinGM.circuitrhythmpack'));
    $('#base-status').textContent = 'Ready: 112 GM instruments, 16 drum kits.';
  }
  return state.packs[pack];
}

function kitEntries() {
  const { pack, index } = kitChoice();
  const all = state.meta[pack] ?? [];
  return all.slice(index * 16, index * 16 + 16);
}

// ---------- loading ----------
function wireLoad() {
  const drop = $('#drop');
  const input = $('#file');
  input.addEventListener('change', () => { if (input.files[0]) loadFile(input.files[0]); input.value = ''; });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
  });
}

async function loadFile(file) {
  player.stop();
  setPlayButton(false);
  const info = $('#fileinfo');
  info.hidden = false;
  try {
    const midi = parseMidi(await file.arrayBuffer());
    if (!midi.sources.length) throw new Error('This MIDI file has no notes.');
    state.midi = midi;
    state.fileName = file.name;
    state.parts = new Map(midi.sources.map((s) => [s.id, { on: true }]));
    const base = file.name.replace(/\.[^.]+$/, '');
    $('#title').value = shortName(base, NAME_MAX);
    if (!state.packTouched) $('#packname').value = $('#title').value;
    const bars = midi.lengthTicks / (midi.ppq * 4 * midi.timeSig.num / midi.timeSig.den);
    info.innerHTML = `<span><span class="k">File</span><b>${esc(file.name)}</b></span> <span><span class="k">Tempo</span><b>${Math.round(midi.tempo)} BPM</b></span> <span><span class="k">Time</span><b>${midi.timeSig.num}/${midi.timeSig.den}</b></span> <span><span class="k">Length</span><b>${Math.ceil(bars)} bars</b></span> <span><span class="k">Parts</span><b>${midi.sources.length}</b></span>`;
    for (const id of ['#step-parts', '#step-sounds', '#step-arrange', '#step-build']) $(id).hidden = false;
    recompute();
  } catch (e) {
    info.innerHTML = `<span class="status error">${esc(e.message)}</span>`;
    for (const id of ['#step-parts', '#step-sounds', '#step-arrange', '#step-build']) $(id).hidden = true;
  }
}

// ---------- parts and tracks ----------
function recompute() {
  if (!state.midi || !state.inst) return;
  player.stop();
  setPlayButton(false);
  const names = state.inst.index.samples.map((s) => s.name);
  state.mutes.clear();
  for (const k of [...state.barMutes.keys()]) if (k[0] === 't') state.barMutes.delete(k);   // track numbers change
  state.res = planTracks(state.midi, names, kitEntries(), {
    parts: state.parts,
    range: Number($('#range').value),
    maxDrumTracks: Number($('#drum-tracks').value),
    arpRate: Number($('#arp-rate').value),
    share: $('#share').checked,
    autoSplit: $('#autosplit').checked,
  });
  renderParts();
  renderBudget();
  rearrange();
}

const TYPE_LABEL = { mono: 'Mono', mostly: 'Mostly mono', chords: 'Chords', drums: 'Drums' };
function trackTag(i, role) {
  return `<span class="tracktag"><span class="sw" style="background:var(--t${i})"></span>Track ${i + 1}${role ? ` <span class="psub">${esc(role)}</span>` : ''}</span>`;
}

function renderParts() {
  const tb = $('#parts tbody');
  const names = state.inst.index.samples.map((s) => s.name);
  tb.innerHTML = '';
  for (const r of state.res.parts) {
    const tr = document.createElement('tr');
    tr.className = r.on ? '' : 'off';
    const cfg = state.parts.get(r.id);
    const type = r.kind === 'chords' ? `<span class="ptype chords">Chords</span><span class="small-note">up to ${r.maxPoly} at once</span>` : `<span class="ptype ${r.kind}">${TYPE_LABEL[r.kind]}</span>`;
    let method = '<span class="psub">–</span>';
    if (r.kind === 'chords') {
      const opts = Object.entries(METHODS).map(([k, v]) => `<option value="${k}"${(cfg.method ?? 'auto') === k ? ' selected' : ''}${ADV_ONLY_METHODS.has(k) ? ' class="adv-opt"' : ''}>${k === 'splitall' ? `${v} (${r.voices})` : v}</option>`).join('');
      // What it became: one line, or n voices on their own tracks.
      const n = r.on ? r.lines : 0;
      const result = !r.on ? '' : n > 1 ? `Split into ${n} voices (${n} tracks)` : METHODS[r.method] ?? '';
      const lost = r.chordDropped ? `, ${r.chordDropped} notes over` : '';
      method = `<span class="simple-only">${esc(result)}</span><select class="adv" data-method="${r.id}" aria-label="How ${esc(r.name)}'s chords are handled">${opts}</select>${r.on && (cfg.method ?? 'auto') === 'auto' ? `<span class="small-note adv">${esc(result)}${lost}</span>` : r.chordDropped ? `<span class="small-note">${r.chordDropped} notes over the voices</span>` : ''}`;
    }
    let sound;
    if (r.isDrum) sound = `<span class="psub">${esc($('#kit').selectedOptions[0]?.textContent ?? '')}</span>`;
    else {
      const cur = r.sample;
      const label = cur == null ? '<span class="tracktag none">No stand-in (sound effect)</span>' : esc(names[cur]);
      const opts = [`<option value="">GM program ${r.program + 1}${cur == null ? ' (none)' : ''}</option>`]
        .concat(names.slice(0, INST_SLOTS).map((n, i) => `<option value="${i}"${cfg.sample === i ? ' selected' : ''}>${esc(n)}</option>`)).join('');
      sound = `<span class="simple-only">${label}</span><select class="adv" data-sample="${r.id}" aria-label="Sound for ${esc(r.name)}">${opts}</select>${cfg.sample == null && cur != null ? `<span class="small-note adv">${esc(names[cur])}</span>` : ''}`;
    }
    let range = '<span class="psub">–</span>';
    if (!r.isDrum && r.on && r.sample != null) {
      const bits = [];
      if (isUnpitched(r.sample)) bits.push('own pitch');
      else {
        if (r.shift) bits.push(`${r.shift > 0 ? 'up' : 'down'} ${Math.abs(r.shift / 12)} oct`);
        if (r.folded) bits.push(`${r.folded} folded`);
        if (r.outside) bits.push(`${r.outside} out of range`);
        if (!bits.length) bits.push('in range');
      }
      range = `<span class="psub">${bits.join(', ')}</span>`;
    }
    let track = '';
    if (!r.on) track = '<span class="psub">Left out</span>';
    else if (r.tracks.length) {
      track = r.tracks.map((i) => trackTag(i, state.res.tracks[i].roles.join(', '))).join('<br>');
      if (r.dropped) track += `<span class="tracktag none">${r.dropped} voice${r.dropped > 1 ? 's' : ''}: no track left</span>`;
    } else track = '<span class="tracktag none">No track left</span>';
    tr.innerHTML = `<td class="c-play"><button class="playbtn" type="button" data-play="${r.id}" aria-label="Play ${esc(r.name)}" title="Hear this part as the Rhythm will play it">${PLAY_ICON}</button></td><td class="c-on"><input type="checkbox" data-on="${r.id}" ${cfg.on !== false ? 'checked' : ''} aria-label="Use ${esc(r.name)}"></td>
      <td><div class="pname">${esc(r.name)}</div><div class="psub">${esc(r.instrument)}</div></td>
      <td class="c-num">${r.notes}</td><td class="c-roll"><canvas class="roll" width="400" height="56" data-roll="${r.id}" aria-label="When ${esc(r.name)} plays"></canvas></td><td>${type}</td><td>${method}</td><td>${sound}</td><td class="adv">${range}</td><td>${track}</td>`;
    tb.append(tr);
  }
  const len = Math.max(1, state.midi.lengthTicks);
  tb.querySelectorAll('canvas[data-roll]').forEach((cv) => drawRoll(cv, state.midi.sources.find((x) => x.id === cv.dataset.roll), len));
  tb.querySelectorAll('[data-play]').forEach((b) => b.addEventListener('click', () => togglePartPlay(b.dataset.play, b)));
  tb.querySelectorAll('[data-on]').forEach((el) => el.addEventListener('change', () => { state.parts.get(el.dataset.on).on = el.checked; recompute(); }));
  tb.querySelectorAll('[data-method]').forEach((el) => el.addEventListener('change', () => { state.parts.get(el.dataset.method).method = el.value; recompute(); }));
  tb.querySelectorAll('[data-sample]').forEach((el) => el.addEventListener('change', () => { state.parts.get(el.dataset.sample).sample = el.value === '' ? undefined : Number(el.value); recompute(); }));
  // Arpeggio only in Advanced mode.
  if (!mode.isAdvanced()) tb.querySelectorAll('option.adv-opt').forEach((o) => { if (!o.selected) o.disabled = true; });
}

// A small piano roll of the whole part across the song: how busy it is and where it plays
// (as in MIDI2Circuit).
function drawRoll(canvas, s, len) {
  if (!s) return;
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

function renderBudget() {
  const box = $('#budget');
  const t = state.res.tracks;
  box.innerHTML = Array.from({ length: 8 }, (_, i) => {
    const tr = t[i];
    if (!tr) return `<div class="slot empty"><div class="tn"><span>Track ${i + 1}</span></div><div class="tr">Free</div></div>`;
    const role = tr.kind === 'drum' ? 'Drums' : tr.roles.join(', ');
    return `<div class="slot" style="border-left-color:var(--t${i})"><div class="tn"><span>Track ${i + 1}</span><span>${esc(role)}</span></div><div class="tl">${esc(tr.label)}</div><div class="tr">${tr.notes.length} notes${tr.drum?.dropped ? `, ${tr.drum.dropped} hits clash` : ''}</div></div>`;
  }).join('');
  const d = state.res.dropped;
  $('#dropped').innerHTML = d.length
    ? `<li>No track left for ${d.length} part${d.length > 1 ? 's' : ''}: ${d.map((x) => esc(x.label)).join(', ')}. Untick a part above to make room for one of these.</li>`
    : '';
}

// ---------- arrangement ----------
function rearrange() {
  if (!state.res) return;
  player.stop();
  setPlayButton(false);
  // Bar mutes take those notes out before arranging, so they change the preview and the pack.
  const bt = barTicksOf();
  const off = (key, tick) => !!state.barMutes.get(key)?.has(Math.floor(tick / bt + 1e-9));
  const tracks = state.barMutes.size
    ? state.res.tracks.map((tr, t) => ({ ...tr, notes: tr.notes.filter((n) => !off(`t${t}`, n.tick) && !off(`p:${n.part}`, n.tick)) }))
    : state.res.tracks;
  state.arr = arrangeRhythm(state.midi, tracks, {
    rate: $('#rate').value === 'track' || $('#rate').value === 'auto' ? $('#rate').value : Number($('#rate').value),
    sectionBars: $('#section-bars').value,
    tempoDiv: Number($('#tempo-div').value),
    match: $('#match').value,
    align: $('#align').checked,
    trimStart: $('#trimstart').checked,
    mutes: state.mutes,
  });
  const a = state.arr;
  const errors = [];
  if (a.error) errors.push(a.error);
  else if (a.tooLong) errors.push(`The song needs ${a.projects.length} projects, more than the ${MAX_PROJECTS} a pack holds. Try a longer pattern length or tempo ÷2 in Advanced.`);
  $('#errors').innerHTML = errors.map((e) => `<li>${esc(e)}</li>`).join('');
  $('#build').disabled = !!errors.length;
  $('#play').disabled = !!a.error;
  if (a.error) {
    $('#summary').innerHTML = ''; $('#warnings').innerHTML = '';
    // Everything muted: keep the grid's labels so tracks can be unmuted.
    if (state.mutes.size || state.barMutes.size) {
      renderGrid({ ...a, projects: [], mixed: false, chunkBars: 1, barTicks: 1, startTick: 0, trackRates: [] });
      $('#grid').insertAdjacentHTML('beforeend', '<div style="padding:8px"><button class="btn small" id="unmute-all" type="button">Unmute everything</button></div>');
    } else $('#grid').innerHTML = '';
    return;
  }
  renderSummary(a);
  renderGrid(a);
  renderWarnings(a);
}

function barTicksOf() {
  const m = state.midi;
  return m.ppq * 4 * m.timeSig.num / m.timeSig.den;
}

// Mute state of a key over some bars: { has (notes there), muted (all muted), partial }.
function muteState(key, bars) {
  const set = state.barMutes.get(key);
  const n = bars.filter((b) => set?.has(b)).length;
  return { muted: n === bars.length && n > 0, partial: n > 0 && n < bars.length };
}

function toggleBars(key, bars) {
  const set = state.barMutes.get(key) ?? new Set();
  const all = bars.every((b) => set.has(b));
  for (const b of bars) { if (all) set.delete(b); else set.add(b); }
  if (set.size) state.barMutes.set(key, set); else state.barMutes.delete(key);
  rearrange();
}

function renderSummary(a) {
  const scenes = a.projects.reduce((n, p) => n + p.scenes.length, 0);
  const rates = [...new Set(a.trackRates.filter((_, t) => a.active[t]).map((r) => r.label))];
  const bars = playOrder(a).length * a.chunkBars;
  const secs = bars * a.barTicks / state.midi.ppq * 60 / state.midi.tempo;
  const stat = (v, k) => `<div class="stat"><div class="v">${v}</div><div class="k">${k}</div></div>`;
  $('#summary').innerHTML = [
    stat(a.projects.length, a.projects.length === 1 ? 'project' : 'projects'),
    stat(scenes, 'scenes'),
    stat(a.active.filter(Boolean).length, 'tracks used'),
    stat(rates.length === 1 ? rates[0].replace(' steps', '') : 'Per track', 'step rate'),
    stat(`${a.tempo}`, `BPM${a.tempoDiv > 1 ? ` (÷${a.tempoDiv})` : ''}`),
    stat(mmss(secs), 'length'),
  ].join('');
}

// The arrangement grid, laid out as in MIDI2Circuit (same classes): a row per Rhythm track
// with its dot (mute, preview and pack), name, step-rate tag and S (solo, preview only,
// Advanced), then a row per MIDI part feeding it (dot = use the part or leave it out).
function renderGrid(a) {
  const grid = $('#grid');
  grid.className = 'grid';
  grid.style.gridTemplateColumns = '';
  grid.innerHTML = '';
  const order = playOrder(a);
  const rows = [];
  state.res.tracks.forEach((tr, t) => {
    rows.push({ kind: 'track', t, name: `${t + 1} ${tr.label}` });
    for (const id of tr.parts) {
      const r = state.res.parts.find((x) => x.id === id);
      if (r) rows.push({ kind: 'src', t, id, name: r.name, sub: r.instrument });
    }
  });
  const labels = document.createElement('div');
  labels.className = 'labels';
  labels.innerHTML = '<div class="row-label head">Project</div><div class="row-label head">Scene · bar</div>';
  for (const row of rows) {
    const d = document.createElement('div');
    d.className = `row-label ${row.kind === 'src' ? 'src' : ''}`;
    const off = row.kind === 'track' ? state.mutes.has(row.t) : state.parts.get(row.id)?.on === false;
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = `dot${off ? ' off' : ''}`;
    dot.style.setProperty('--c', `var(--t${row.t})`);
    dot.setAttribute('aria-pressed', String(!off));
    dot.title = row.kind === 'track' ? `${off ? 'Unmute' : 'Mute'} track ${row.t + 1} (preview and pack)` : `Leave ${row.name} out (its track goes to another part)`;
    if (row.kind === 'track') dot.dataset.mute = row.t; else dot.dataset.part = row.id;
    const name = document.createElement('span');
    name.className = 'nm';
    name.textContent = row.name;
    name.title = row.sub ? `${row.name} · ${row.sub}` : row.name;
    if (row.kind === 'track' && a.mixed) {
      const tag = document.createElement('small');
      tag.className = 'rtag';
      tag.textContent = a.trackRates[row.t].label.replace(' steps', '');
      name.append(' ', tag);
    }
    d.append(dot, name);
    if (row.kind === 'track') {
      const sb = document.createElement('button');
      sb.type = 'button'; sb.textContent = 'S';
      sb.className = `solo adv${state.solo === row.t ? ' on' : ''}`;
      sb.title = `Solo track ${row.t + 1} in the preview`;
      sb.dataset.solo = row.t;
      d.append(sb);
    }
    labels.append(d);
  }
  grid.append(labels);

  // Which chunks each part has notes in (for its row).
  const chunkTicks = a.chunkBars * a.barTicks;
  const partChunks = new Map();
  state.res.tracks.forEach((tr, t) => {
    for (const n of tr.notes) {
      const key = `${t}|${n.part}`;
      if (!partChunks.has(key)) partChunks.set(key, new Set());
      partChunks.get(key).add(Math.floor((n.tick - a.startTick) / chunkTicks));
    }
  });
  const trackChunks = new Map();
  state.res.tracks.forEach((tr, t) => {
    const set = new Set();
    for (const n of tr.notes) set.add(Math.floor((n.tick - a.startTick) / chunkTicks));
    trackChunks.set(t, set);
  });
  const colours = projectColours(a.projects.length, 'rainbow');
  const startBar = Math.round(a.startTick / a.barTicks);
  order.forEach((o, k) => {
    const col = document.createElement('div');
    col.className = 'col';
    const prev = order[k - 1];
    if (prev && prev.project !== o.project) col.classList.add('proj-start');
    else if (prev && prev.section !== o.section) col.classList.add('sec-start');
    const proj = a.projects[o.project];
    const projHead = !prev || prev.project !== o.project
      ? `<span class="pdot" style="background:rgb(${PROJECT_COLOURS[colours[o.project]][1].join(',')})" title="${PROJECT_COLOURS[colours[o.project]][0]}"></span>P${o.project + 1}` : '';
    const bar = startBar + o.chunk * a.chunkBars;
    const sceneHead = !prev || prev.section !== o.section ? `${o.scene + 1}·${bar + 1}` : '';
    let html = `<div class="hd">${projHead}</div><div class="hd">${sceneHead}</div>`;
    for (const row of rows) {
      const bars = Array.from({ length: a.chunkBars }, (_, i) => bar + i);
      const range = a.chunkBars > 1 ? `bars ${bar + 1}–${bar + a.chunkBars}` : `bar ${bar + 1}`;
      if (row.kind === 'src') {
        const has = partChunks.get(`${row.t}|${row.id}`)?.has(o.chunk);
        const ms = muteState(`p:${row.id}`, bars);
        const cls = !has ? 'empty' : ms.muted ? 'muted' : ms.partial ? 'on part' : 'on';
        html += `<button type="button" class="cell src ${cls}" data-key="p:${esc(row.id)}" data-bars="${bars.join(',')}" style="--c:var(--t${row.t})" title="${esc(row.name)}, ${range}${has ? (ms.muted ? ' (muted): click to unmute' : ms.partial ? ' (partly muted): click to mute all' : ': click to mute') : ' (no notes)'}"${has ? '' : ' disabled'}></button>`;
        continue;
      }
      const subs = o.sub[row.t];
      const p = subs[0];
      const ms = muteState(`t${row.t}`, bars);
      const has = trackChunks.get(row.t)?.has(o.chunk);
      const muted = state.mutes.has(row.t) || (has && ms.muted);
      const empty = subs.every((i) => !proj.patterns[row.t]?.[i]?.steps?.length);
      const mix = 100 - (p % 8) * 8;
      const same = subs.every((i) => i === p);
      const txt = same ? `${p + 1}` : subs.every((i, j) => i === p + j) ? `${p + 1}–${subs[subs.length - 1] + 1}` : subs.map((i) => i + 1).join('·');
      const what = `Track ${row.t + 1}: pattern ${subs.map((i) => i + 1).join(', ')}, ${range}`;
      html += `<button type="button" class="cell ${muted ? 'muted' : empty ? 'empty' : ''}${txt.length > 2 ? ' multi' : ''}" data-key="t${row.t}" data-bars="${bars.join(',')}" style="${empty || muted ? '' : `background:color-mix(in srgb, var(--t${row.t}) ${mix}%, #000)`}" title="${what}${muted ? ' (muted): click to unmute' : has ? ': click to mute these bars' : ' (empty)'}"${has && !state.mutes.has(row.t) ? '' : ' disabled'}>${muted || empty ? '' : txt}</button>`;
    }
    col.innerHTML = html;
    grid.append(col);
  });
}

function onGridClick(e) {
  const cell = e.target.closest('.cell[data-key]');
  if (cell && !cell.disabled) { toggleBars(cell.dataset.key, cell.dataset.bars.split(',').map(Number)); return; }
  if (e.target.closest('#unmute-all')) { state.mutes.clear(); state.barMutes.clear(); rearrange(); return; }
  const m = e.target.closest('[data-mute]');
  if (m) {
    const t = Number(m.dataset.mute);
    if (state.mutes.has(t)) state.mutes.delete(t); else state.mutes.add(t);
    rearrange();
    return;
  }
  const pd = e.target.closest('[data-part]');
  if (pd) {
    const cfg = state.parts.get(pd.dataset.part);
    cfg.on = cfg.on === false;
    recompute();
    return;
  }
  const b = e.target.closest('[data-solo]');
  if (!b) return;
  const t = Number(b.dataset.solo);
  state.solo = state.solo === t ? -1 : t;
  player.setSolo(t);
  $('#grid').querySelectorAll('[data-solo]').forEach((x) => x.classList.toggle('on', Number(x.dataset.solo) === state.solo));
}

let nowCol = -1;
function markNow(t) {
  if (!state.chunkTimes) return;
  const i = state.chunkTimes.findIndex((x, k) => t >= x && t < (state.chunkTimes[k + 1] ?? Infinity));
  if (i === nowCol) return;
  nowCol = i;
  const cols = $('#grid').querySelectorAll('.col');
  cols.forEach((c) => c.classList.remove('now'));
  cols[i]?.classList.add('now');
}

function renderWarnings(a) {
  const w = a.warnings, out = [];
  if (w.lost) out.push(`${w.lost} note${w.lost > 1 ? 's' : ''} fell on a step another note of the same track already had, and ${w.lost > 1 ? 'were' : 'was'} left out. A finer pattern length keeps more.`);
  if (w.moved) out.push(`${w.moved} of ${w.total} notes (${Math.round(w.movedRatio * 100)}%) moved to the nearest step.`);
  if (w.cut) out.push(`${w.cut} note${w.cut > 1 ? 's' : ''} held past the end of a pattern ${w.cut > 1 ? 'are' : 'is'} cut there.`);
  if (w.beforeStart) out.push(`${w.beforeStart} notes before the first bar were left out.`);
  if (a.tempoClamped) out.push(`The tempo is outside the Rhythm's 40–240 BPM, so it is set to ${a.tempo}.`);
  if (state.midi.tempoChanges) out.push(`The file changes tempo ${state.midi.tempoChanges} time${state.midi.tempoChanges > 1 ? 's' : ''}; the pack uses the first tempo throughout.`);
  if (state.midi.timeSigChanges) out.push('The file changes time signature; the pack uses the first one throughout.');
  const folded = state.res.parts.reduce((n, r) => n + (r.on ? r.folded : 0), 0);
  if (folded) out.push(`${folded} note${folded > 1 ? 's were' : ' was'} folded an octave towards the sample's own pitch.`);
  const clash = state.res.tracks.reduce((n, t) => n + (t.drum?.dropped ?? 0), 0);
  if (clash) out.push(`${clash} drum hit${clash > 1 ? 's' : ''} clashed with another drum on its shared track and ${clash > 1 ? 'were' : 'was'} left out. Allow more drum tracks to keep them.`);
  $('#warnings').innerHTML = out.map((x) => `<li>${esc(x)}</li>`).join('');
}

// ---------- preview ----------
async function sampleBytes(slot) {
  if (slot < KIT_FIRST) {
    const s = state.inst.index.samples[slot];
    return new Uint8Array(await state.inst.zip.get(s.url)());
  }
  const pack = await kitPack();
  const s = pack.index.samples[kitChoice().index * 16 + slot - KIT_FIRST];
  return new Uint8Array(await pack.zip.get(s.url)());
}

function previewEvents(a) {
  const events = [];
  const secPerTick = 60 / state.midi.tempo / state.midi.ppq;
  const order = playOrder(a);
  const chunkTicks = a.chunkBars * a.barTicks;
  state.chunkTimes = order.map((_, i) => i * chunkTicks * secPerTick);
  order.forEach((o, i) => {
    const proj = a.projects[o.project];
    for (let t = 0; t < 8; t++) {
      if (!a.active[t]) continue;
      const r = a.trackRates[t];
      o.sub[t].forEach((p, j) => {
        const c = proj.patterns[t][p];
        if (!c) return;
        for (const st of c.steps) {
          for (let m = 0; m < 6; m++) {
            if (!(st.mask >> m & 1)) continue;
            const tick = i * chunkTicks + j * r.patLen * r.stepTicks + (st.step + m / 6) * r.stepTicks;
            events.push({ t: tick * secPerTick, d: st.gate / 6 * r.stepTicks * secPerTick, track: t, vel: st.vel, part: `#${st.sample}`, rate: 2 ** ((st.byte - 72) / 12), choke: true });
          }
        }
      });
    }
  });
  return events.sort((x, y) => x.t - y.t);
}

// The player's samples: '#slot' -> file bytes, decoded together. Kit slots are dropped when
// the kit changes.
async function ensureSamples(slots) {
  const kit = $('#kit').value;
  state.sampleBytes ??= new Map();
  if (state.kitLoaded !== kit) {
    for (const k of [...state.sampleBytes.keys()]) if (Number(k.slice(1)) >= KIT_FIRST) state.sampleBytes.delete(k);
    state.kitLoaded = kit;
    state.samplesDirty = true;
  }
  for (const s of slots) {
    if (state.sampleBytes.has(`#${s}`)) continue;
    state.sampleBytes.set(`#${s}`, (await sampleBytes(s)).buffer);
    state.samplesDirty = true;
  }
  if (state.samplesDirty) { await player.setDrumSamples(state.sampleBytes); state.samplesDirty = false; }
}

// One part as the Rhythm will play it: its converted line(s) on their tracks, or (left out or
// with no track) its MIDI notes on its sound, unquantised.
async function togglePartPlay(id, btn) {
  if (state.playingPart === id) { player.stop(); setPartButton(null); return; }
  player.stop();
  setPlayButton(false);
  const m = state.midi;
  const sec = (tick) => (tick / m.ppq) * (60 / m.tempo);
  const ev = [];
  state.res.tracks.forEach((t, i) => {
    for (const n of t.notes) if (n.part === id) ev.push({ t: sec(n.tick), d: sec(n.dur), track: i, vel: n.vel, part: `#${n.sample}`, rate: 2 ** ((n.byte - 72) / 12), choke: true });
  });
  if (!ev.length) {
    const src = m.sources.find((x) => x.id === id);
    const rep = state.res.parts.find((r) => r.id === id);
    if (src.isDrum) {
      const map = drumMap(kitEntries());
      for (const n of src.notes) ev.push({ t: sec(n.tick), d: 0.1, track: 0, vel: n.vel, part: `#${KIT_FIRST + map(n.note)}`, choke: false });
    } else if (rep?.sample != null) {
      const root = rootFromName(state.inst.index.samples[rep.sample].name);
      for (const n of src.notes) ev.push({ t: sec(n.tick), d: sec(n.dur), track: 0, vel: n.vel, part: `#${rep.sample}`, rate: 2 ** ((n.note - root) / 12), choke: false });
    }
  }
  if (!ev.length) return;
  ev.sort((a, b) => a.t - b.t);
  btn.disabled = true;
  try {
    await ensureSamples(new Set(ev.map((e) => Number(e.part.slice(1)))));
    const saved = player.mutes.slice(), savedSolo = player.solo;
    player.mutes.fill(false); player.solo = -1;
    player.onPosition = null;
    player.onEnd = () => setPartButton(null);
    await player.play(ev, { from: Math.max(0, ev[0].t - 0.2) });
    player.mutes = saved; player.solo = savedSolo;
    state.playingPart = id;
    setPartButton(btn);
  } finally { btn.disabled = false; }
}

function setPartButton(btn) {
  for (const b of document.querySelectorAll('.playbtn')) { b.classList.remove('on'); b.innerHTML = PLAY_ICON; }
  if (btn) { btn.classList.add('on'); btn.innerHTML = STOP_ICON; } else state.playingPart = null;
}

async function togglePlay() {
  if (player.playing && !state.playingPart) { player.stop(); setPlayButton(false); return; }
  player.stop();
  const a = state.arr;
  if (!a || a.error) return;
  $('#play').disabled = true;
  $('#play').textContent = 'Loading sounds…';
  try {
    await ensureSamples(usedSamples(a, state.res.tracks));
    setPartButton(null);
    player.onPosition = (t) => { $('#time').textContent = mmss(t); markNow(t); };
    player.onEnd = () => setPlayButton(false);
    await player.play(previewEvents(a));
    setPlayButton(true);
  } catch (e) {
    setPlayButton(false);
    $('#errors').innerHTML = `<li>The preview could not play: ${esc(e.message)}</li>`;
  } finally {
    $('#play').disabled = false;
  }
}

function setPlayButton(on) {
  $('#play').textContent = on ? 'Stop' : 'Play preview';
  if (!on && state.playingPart) setPartButton(null);
  if (!on) { nowCol = -1; $('#grid').querySelectorAll('.col.now').forEach((c) => c.classList.remove('now')); }
}

// ---------- build ----------
async function build() {
  const a = state.arr;
  if (!a || a.error || a.tooLong) return;
  const status = $('#build-status');
  status.classList.remove('error');
  status.textContent = 'Building…';
  try {
    const title = ascii($('#title').value).trim() || 'MIDI2Rhythm';
    const packName = ascii($('#packname').value).trim() || title;
    const projects = buildRhythmProjects(a, state.res.tracks, state.template, { title, colors: projectColours(a.projects.length, 'rainbow') });
    const blob = await buildRhythmPack(state.inst, await kitPack(), kitChoice().index, projects, {
      name: packName, color: $('#packcolor').value, trim: $('#trim').checked, used: usedSamples(a, state.res.tracks),
    });
    const el = document.createElement('a');
    el.href = URL.createObjectURL(blob);
    el.download = `${packName.replace(/[^A-Za-z0-9 _-]+/g, '').trim() || 'MIDI2Rhythm'}.circuitrhythmpack`;
    document.body.append(el);
    el.click();
    el.remove();
    setTimeout(() => URL.revokeObjectURL(el.href), 30000);
    status.textContent = `Saved ${el.download}: ${projects.length} project${projects.length > 1 ? 's' : ''}, ${(blob.size / 1e6).toFixed(1)} MB.`;
  } catch (e) {
    status.textContent = `Could not build the pack: ${e.message}`;
    status.classList.add('error');
  }
}

// ---------- helpers ----------
function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function ascii(s) { return (s || '').normalize('NFKD').replace(/[^\x20-\x7e]/g, ''); }
function mmss(s) { const m = Math.floor(s / 60); return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`; }
