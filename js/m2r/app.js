// MIDI2Rhythm page: load a MIDI file, choose and reduce the parts, check the arrangement,
// hear it, build a Circuit Rhythm pack. The work is done in js/m2r/engine.js (parts and
// tracks), js/m2r/arrange.js (patterns, scenes, projects) and js/m2r/build.js (pack).
import { parseMidi } from '../midifile.js';
import { setupMode } from '../mode.js';
import { projectColours } from '../convert.js';
import { Player } from '../player.js';
import { planTracks, METHODS, ADV_ONLY_METHODS, INST_SLOTS, KIT_FIRST, isUnpitched } from './engine.js?v=20261114m2r3';
import { arrangeRhythm, playOrder, MAX_PROJECTS } from './arrange.js?v=20261114m2r3';
import { buildRhythmProjects, buildRhythmPack, openPack, fetchBuf, usedSamples, shortName } from './build.js?v=20261114m2r3';

const $ = (s) => document.querySelector(s);
const DRUM_KITS = ['Std', 'Room', 'Power', 'Elec', '808', 'Jazz', 'Brush', 'Orch'];
const LATIN_KITS = ['Std', 'Room', 'Power', 'Elec', '808', 'Dance', 'Jazz', 'Brush'];
const NAME_MAX = 16;
const state = {
  midi: null, fileName: '',
  inst: null, packs: {}, meta: {}, template: null,
  parts: new Map(),          // source id -> { on, method, sample }
  res: null, arr: null,
  solo: -1,
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
      fetchBuf('../data/RhythmEmpty.ncs'),
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
    tr.innerHTML = `<td class="c-on"><input type="checkbox" data-on="${r.id}" ${cfg.on !== false ? 'checked' : ''} aria-label="Use ${esc(r.name)}"></td>
      <td><div class="pname">${esc(r.name)}</div><div class="psub">${esc(r.instrument)}</div></td>
      <td class="c-num">${r.notes}</td><td class="c-roll"><canvas class="roll" width="400" height="56" data-roll="${r.id}" aria-label="When ${esc(r.name)} plays"></canvas></td><td>${type}</td><td>${method}</td><td>${sound}</td><td class="adv">${range}</td><td>${track}</td>`;
    tb.append(tr);
  }
  const len = Math.max(1, state.midi.lengthTicks);
  tb.querySelectorAll('canvas[data-roll]').forEach((cv) => drawRoll(cv, state.midi.sources.find((x) => x.id === cv.dataset.roll), len));
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
  state.arr = arrangeRhythm(state.midi, state.res.tracks, {
    rate: $('#rate').value === 'track' || $('#rate').value === 'auto' ? $('#rate').value : Number($('#rate').value),
    sectionBars: $('#section-bars').value,
    tempoDiv: Number($('#tempo-div').value),
    match: $('#match').value,
    align: $('#align').checked,
    trimStart: $('#trimstart').checked,
  });
  const a = state.arr;
  const errors = [];
  if (a.error) errors.push(a.error);
  else if (a.tooLong) errors.push(`The song needs ${a.projects.length} projects, more than the ${MAX_PROJECTS} a pack holds. Try a longer pattern length or tempo ÷2 in Advanced.`);
  $('#errors').innerHTML = errors.map((e) => `<li>${esc(e)}</li>`).join('');
  $('#build').disabled = !!errors.length;
  $('#play').disabled = !!a.error;
  if (a.error) { $('#summary').innerHTML = ''; $('#grid').innerHTML = ''; $('#warnings').innerHTML = ''; return; }
  renderSummary(a);
  renderGrid(a);
  renderWarnings(a);
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

function renderGrid(a) {
  const order = playOrder(a);
  const rows = [...Array(8).keys()].filter((t) => a.active[t]);
  const g = $('#grid');
  g.style.gridTemplateColumns = `minmax(120px, 190px) repeat(${order.length}, 26px)`;
  let html = '<div class="lab"></div>';
  order.forEach((o, i) => {
    const first = i === 0 || order[i - 1].project !== o.project;
    html += `<div class="hd${first ? ' proj' : ''}">${first ? `P${o.project + 1}` : ''}</div>`;
  });
  for (const t of rows) {
    const tr = state.res.tracks[t];
    html += `<div class="lab"><button class="solo${state.solo === t ? ' on' : ''}" data-solo="${t}" title="Solo this track in the preview">S</button><span class="sw" style="width:9px;height:9px;border-radius:2px;background:var(--t${t})"></span><span class="nm" title="${esc(tr.label)}">${t + 1} ${esc(tr.label)}</span></div>`;
    order.forEach((o, i) => {
      const proj = a.projects[o.project];
      const subs = o.sub[t];
      const has = subs.some((p) => proj.patterns[t][p]?.key);
      const first = i > 0 && order[i - 1].project !== o.project;
      html += `<div class="c${first ? ' proj' : ''}" data-i="${i}" style="${has ? `background:var(--t${t})` : ''}" title="Project ${o.project + 1}, scene ${o.scene + 1}, pattern ${subs.map((p) => p + 1).join('+')}">${has ? subs[0] + 1 : ''}</div>`;
    });
  }
  g.innerHTML = html;
}

function onGridClick(e) {
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
  $('#grid').querySelectorAll('.c.now').forEach((c) => c.classList.remove('now'));
  $('#grid').querySelectorAll(`.c[data-i="${i}"]`).forEach((c) => c.classList.add('now'));
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

async function togglePlay() {
  if (player.playing) { player.stop(); setPlayButton(false); return; }
  const a = state.arr;
  if (!a || a.error) return;
  $('#play').disabled = true;
  $('#play').textContent = 'Loading sounds…';
  try {
    const used = usedSamples(a, state.res.tracks);
    const key = `${$('#kit').value}|${[...used].sort((x, y) => x - y).join(',')}`;
    if (state.loadedKey !== key) {
      const map = new Map();
      for (const s of used) map.set(`#${s}`, (await sampleBytes(s)).buffer);
      await player.setDrumSamples(map);
      state.loadedKey = key;
    }
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
  if (!on) { nowCol = -1; $('#grid').querySelectorAll('.c.now').forEach((c) => c.classList.remove('now')); }
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
