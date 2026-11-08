// Circuit2MIDI page: load a Circuit Tracks / Circuit Rhythm pack, compact it, pick a project,
// check its scenes, map its tracks to MIDI, preview it and save a .mid file.
import { loadPack, compactPack } from './pack.js';
import {
  songOf, renderSong, sceneOrder, defaultOrderKind, usedScenes, sceneTicks, defaultMapping,
  ensureDrumNotes, midiTracks, samplesByTrack, trackHasNotes, ticksToSeconds, PPQ, GM_DRUMS,
} from './song.js';
import { writeSMF } from './midiwrite.js';
import { GM_NAMES } from './midifile.js';
import { PROJECT_COLOURS } from './convert.js';
import { Player } from './player.js';

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
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = (n) => `${NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 1}`;
const mb = (n) => `${(n / 1e6).toFixed(n < 1e7 ? 2 : 1)} MB`;
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const TRACK_COLOURS = {
  'circuit-tracks': ['--s1', '--s2', '--m1', '--m2', '--dr', '--dr', '--dr', '--dr'],
  'circuit-rhythm': ['--r1', '--r2', '--r3', '--r4', '--r5', '--r6', '--r7', '--r8'],
};

const state = { pack: null, entry: null, song: null, mapping: null, rendered: null, order: [] };
const player = new Player();

// ---------- 1. Load ----------

const drop = $('drop');
$('file').addEventListener('change', (e) => { if (e.target.files[0]) openFile(e.target.files[0]); e.target.value = ''; });
for (const ev of ['dragenter', 'dragover']) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); });
for (const ev of ['dragleave', 'drop']) drop.addEventListener(ev, () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) openFile(f); });

async function openFile(file) {
  player.stop();
  setStatus('load-status', `Reading ${file.name}…`);
  let pack;
  try {
    pack = await loadPack(await file.arrayBuffer(), file.name);
  } catch (err) {
    setStatus('load-status', err.message, true);
    return;
  }
  pack.fileName = file.name;
  state.pack = pack;
  state.entry = null;
  setStatus('load-status', '');
  showPackInfo(pack);
  await showCompact(pack);
  showProjects(pack);
  for (const id of ['step-scenes', 'step-map', 'step-save']) $(id).hidden = true;
  const withContent = pack.projects.filter((p) => !p.empty);
  if (withContent.length === 1) selectProject(withContent[0]);
}

function showPackInfo(pack) {
  const box = $('packinfo');
  box.replaceChildren();
  const item = (k, v) => box.append(el('span', {}, el('span', { class: 'k', text: k }), el('b', { text: v })));
  item('Pack', pack.name || '(no name)');
  item('For', pack.info.label);
  item('Projects', `${pack.usage.projectsWithContent} with content, of ${pack.projects.length}`);
  item('Samples', `${pack.samples.filter((s) => s.present).length}`);
  if (pack.product === 'circuit-tracks') item('Patches', `${pack.patches.filter((p) => p.present).length}`);
  item('Size', mb(pack.size));
  box.hidden = false;
}

// ---------- 2. Compact ----------

async function showCompact(pack) {
  const u = pack.usage;
  const tracks = pack.product === 'circuit-tracks';
  const sum = $('compact-summary');
  sum.replaceChildren();
  const stat = (v, k) => sum.append(el('div', { class: 'stat' }, el('div', { class: 'v', text: v }), el('div', { class: 'k', text: k })));
  const usedSamples = pack.samples.filter((s) => s.present && u.samples.has(s.slot)).length;
  stat(String(usedSamples), 'samples in use');
  stat(String(u.unusedSamples.length), 'unused samples');
  if (tracks) {
    stat(String(pack.patches.filter((p) => p.present && u.patches.has(p.slot)).length), 'patches in use');
    stat(String(u.unusedPatches.length), 'unused patches');
  }
  const freed = await u.unusedBytes();
  stat(mb(freed), 'unpacked size removed');

  const body = $('unused-body');
  body.replaceChildren();
  const list = (title, items) => {
    if (!items.length) return;
    body.append(el('h4', { text: title }), el('ul', {}, ...items.map((x) => el('li', { text: `${x.slot + 1}. ${x.name || '(no name)'}` }))));
  };
  list('Samples', u.unusedSamples);
  list('Patches', u.unusedPatches);
  $('unused-list').hidden = !(u.unusedSamples.length || u.unusedPatches.length);

  $('compact-name').value = asciiName(pack.name, 16).trim();     // Components allows 16 characters
  const btn = $('compact');
  const nothing = !u.unusedSamples.length && !u.unusedPatches.length;
  btn.disabled = !u.projectsWithContent || nothing;
  $('compact-options').hidden = btn.disabled;
  setStatus('compact-status', !u.projectsWithContent
    ? 'This pack has no projects with content, so every sample and patch counts as unused. Compacting is off for packs like this.'
    : nothing ? 'Nothing to remove: every sample and patch is used by a project.' : '');
  $('step-compact').hidden = false;
}

$('compact').addEventListener('click', async () => {
  const pack = state.pack;
  const btn = $('compact');
  btn.disabled = true;
  setStatus('compact-status', 'Compacting…');
  try {
    const name = $('compact-name').value.trim() || pack.name;
    const blob = await compactPack(pack, { name: asciiName(name, 16).trim() });
    download(blob, `${fileSafe(name)}${pack.info.ext}`);
    setStatus('compact-status', `Saved ${fileSafe(name)}${pack.info.ext} (${mb(blob.size)}, was ${mb(pack.size)}).`);
  } catch (err) {
    setStatus('compact-status', err.message, true);
  }
  btn.disabled = false;
});

// ---------- 3. Project ----------

function showProjects(pack) {
  const box = $('projects');
  box.replaceChildren();
  const list = pack.projects.filter((p) => !p.empty);
  const broken = pack.projects.filter((p) => p.error);
  for (const e of list) {
    let sub = '';
    try {
      const song = songOf(pack, e);
      const used = usedScenes(song);
      const bars = used.reduce((n, s) => n + sceneTicks(song, s), 0) / (PPQ * 4);
      sub = `${used.length} scene${used.length === 1 ? '' : 's'} · ${fmtBars(bars)} · ${song.tempo} BPM`;
    } catch { sub = 'could not be read'; }
    const colour = PROJECT_COLOURS[e.project.color]?.[1];
    const b = el('button', {
      class: 'proj', type: 'button', role: 'radio', 'aria-checked': 'false', 'data-slot': e.slot,
      onclick: () => selectProject(e),
    }, el('span', { class: 'pn', text: String(e.slot + 1) }), el('span', { class: 'pt', text: e.name || `Project ${e.slot + 1}` }), el('span', { class: 'ps', text: sub }));
    if (colour) b.querySelector('.pn').style.setProperty('--pc', `rgb(${colour.join(',')})`);
    box.append(b);
  }
  const empty = pack.projects.length - list.length;
  $('project-hint').textContent = list.length
    ? `One project is converted at a time. ${empty ? `${empty} empty project slot${empty === 1 ? ' isn\'t' : 's aren\'t'} listed.` : ''}${broken.length ? ` ${broken.length} project${broken.length === 1 ? '' : 's'} could not be read.` : ''}`
    : 'This pack has no projects with notes in them, so there is nothing to convert.';
  $('step-project').hidden = false;
}

async function selectProject(e) {
  player.stop();
  setPlayButton(false);
  state.entry = e;
  for (const b of document.querySelectorAll('.proj')) b.setAttribute('aria-checked', String(Number(b.dataset.slot) === e.slot));
  const song = songOf(state.pack, e);
  state.song = song;
  state.mapping = defaultMapping(song, state.pack);
  player.mutes.fill(false);
  player.solo = -1;

  const order = $('order');
  order.replaceChildren();
  const c = song.sceneChain;
  const used = usedScenes(song);
  order.append(el('option', { value: 'chain', text: c.start === c.end ? `Saved scene chain: scene ${c.start + 1} only` : `Saved scene chain: scenes ${c.start + 1}–${c.end + 1}` }));
  order.append(el('option', { value: 'used', text: `Every used scene in order (${rangeText(used)})` }));
  order.append(el('option', { value: 'custom', text: 'Custom order…' }));
  order.value = defaultOrderKind(song);
  $('custom').value = used.map((s) => s + 1).join(', ');
  $('custom-field').hidden = order.value !== 'custom';

  const hasSwing = song.swing !== 50;
  $('swing').disabled = !hasSwing;
  $('swing').checked = hasSwing;
  $('swing-label').textContent = hasSwing ? `Apply the project's swing (${song.swing}%)` : 'No swing in this project';
  $('mutes-field').hidden = !song.scenes.some((s) => s.used && s.mask);
  $('scene-mutes').checked = false;
  $('midname').value = fileSafe(song.name);
  $('preview-hint').textContent = state.pack.product === 'circuit-rhythm'
    ? 'The preview plays the pack\'s own samples, at the pitch each step sets.'
    : 'The preview plays the pack\'s drum samples; Synth 1, Synth 2 and the MIDI tracks are sketched with simple tones.';
  for (const id of ['step-scenes', 'step-map', 'step-save']) $(id).hidden = false;
  update();
  loadSamples(song);
}

async function loadSamples(song) {
  const want = new Set(samplesByTrack(song).flat());
  const map = new Map();
  for (const slot of want) {
    const s = state.pack.samples[slot];
    if (!s?.present) continue;
    map.set(`s${slot}`, await state.pack.zip.get(s.url)());
  }
  if (state.song !== song) return;
  try { await player.setDrumSamples(map); } catch { /* audio not available until the page is used */ }
}

// ---------- 4. Scenes ----------

for (const id of ['order', 'chance', 'swing', 'scene-mutes']) $(id).addEventListener('change', () => {
  $('custom-field').hidden = $('order').value !== 'custom';
  update();
});
$('custom').addEventListener('input', debounce(update, 300));

function options() {
  return {
    order: state.order,
    chance: $('chance').value,
    swing: $('swing').checked,
    sceneMutes: !$('mutes-field').hidden && $('scene-mutes').checked,
  };
}

function update() {
  const song = state.song;
  if (!song) return;
  const resumeAt = player.playing ? player.position : null;
  player.stop();
  try {
    state.order = sceneOrder(song, $('order').value, $('custom').value);
    setStatus('order-status', '');
  } catch (err) {
    setStatus('order-status', err.message, true);
    return;
  }
  state.rendered = renderSong(song, options());
  ensureDrumNotes(song, state.mapping);
  drawSummary();
  drawGrid();
  drawWarnings();
  drawMapping();
  if (resumeAt != null && resumeAt < ticksToSeconds(state.rendered.length, song.tempo)) play(resumeAt);
  else setPlayButton(false);
}

function drawSummary() {
  const { song, rendered } = state;
  const box = $('song-summary');
  box.replaceChildren();
  const stat = (v, k) => box.append(el('div', { class: 'stat' }, el('div', { class: 'v', text: v }), el('div', { class: 'k', text: k })));
  const notes = midiTracks(song, rendered, state.mapping).reduce((n, t) => n + t.events.length, 0);
  stat(String(rendered.sceneStarts.length), rendered.sceneStarts.length === 1 ? 'scene played' : 'scenes played');
  stat(fmtBars(rendered.length / (PPQ * 4)), 'long');
  stat(clock(ticksToSeconds(rendered.length, song.tempo)), `at ${song.tempo} BPM`);
  stat(String(notes), 'notes in the MIDI file');
}

function drawGrid() {
  const { song, rendered, mapping } = state;
  const grid = $('grid');
  grid.replaceChildren();
  const colours = TRACK_COLOURS[song.product];
  const labels = el('div', { class: 'labels' }, el('div', { class: 'row-label head', text: 'Scene' }));
  song.tracks.forEach((tr, t) => {
    const m = mapping.tracks[t];
    const dot = el('button', {
      class: `dot${m.on ? '' : ' off'}`, type: 'button', 'aria-pressed': String(m.on),
      'aria-label': `${m.on ? 'Leave out' : 'Include'} ${tr.label}`, title: m.on ? 'Click to leave this track out' : 'Click to include this track',
      onclick: () => { m.on = !m.on; update(); },
    });
    dot.style.setProperty('--c', `var(${colours[t]})`);
    const solo = el('button', {
      class: `solo${player.solo === t ? ' on' : ''}`, type: 'button', text: 'S', title: 'Solo in the preview',
      'aria-pressed': String(player.solo === t), onclick: () => { player.setSolo(t); drawGrid(); },
    });
    labels.append(el('div', { class: 'row-label' }, dot,
      el('span', { class: 'nm', text: tr.label }), el('span', { class: 'snd', text: tr.sound }), solo));
  });
  grid.append(labels);

  const muteBits = options().sceneMutes;
  rendered.sceneStarts.forEach((sc, i) => {
    const scene = song.scenes[sc.scene];
    const col = el('div', { class: 'col scene', 'data-i': i },
      el('div', { class: 'hd', text: String(sc.scene + 1), title: `Scene ${sc.scene + 1}: ${fmtBars(sc.length / (PPQ * 4))}` }));
    song.tracks.forEach((tr, t) => {
      const c = scene.chains[t];
      const text = c.start === c.end ? String(c.start + 1) : `${c.start + 1}–${c.end + 1}`;
      let sounding = false;
      for (let p = c.start; p <= c.end; p++) if (tr.patterns[p].steps.some((s) => s.hits.length)) sounding = true;
      const masked = muteBits && ((scene.mask >> t) & 1);
      const off = !mapping.tracks[t].on || masked;
      const cell = el('div', {
        class: `cell${text.length > 2 ? ' chain' : ''}${off ? ' muted' : sounding ? '' : ' quiet'}`,
        title: `${tr.label}, scene ${sc.scene + 1}: pattern${c.start === c.end ? ` ${c.start + 1}` : `s ${c.start + 1} to ${c.end + 1}`}${sounding ? '' : ' (no notes)'}${masked ? ', masked in this scene' : ''}`,
        text,
      });
      if (!off && sounding) cell.style.background = `var(${colours[t]})`;
      col.append(cell);
    });
    grid.append(col);
  });
}

function drawWarnings() {
  const { song, rendered } = state;
  const w = [];
  const order = state.order;
  const playedPatterns = new Set();
  for (const si of order) song.scenes[si]?.chains.forEach((c, t) => { for (let p = c.start; p <= c.end; p++) playedPatterns.add(`${t}:${p}`); });
  const random = [], chance = new Set(), unusedScene = order.filter((s) => !song.scenes[s].used);
  for (const tr of song.tracks) tr.patterns.forEach((p, i) => {
    if (!playedPatterns.has(`${tr.index}:${i}`)) return;
    if (p.dir === 3) random.push(`${tr.label} pattern ${i + 1}`);
    if (p.steps.some((s) => s.hits.length && s.prob < 7)) chance.add(tr.label);
  });
  if (random.length) w.push(`Random playback order is set on ${random.join(', ')}; it is written in forward order.`);
  if (chance.size && $('chance').value === 'keep') w.push(`${[...chance].join(', ')} ${chance.size === 1 ? 'has' : 'have'} steps that play only some of the time; all of them are in the MIDI file. Choose "Leave them out" to drop them.`);
  if (unusedScene.length) w.push(`Scene${unusedScene.length === 1 ? '' : 's'} ${[...new Set(unusedScene)].map((s) => s + 1).join(', ')} ${unusedScene.length === 1 ? 'is' : 'are'} empty on the Circuit; ${unusedScene.length === 1 ? 'it plays' : 'they play'} pattern 1 on every track.`);
  if (song.product === 'circuit-rhythm') {
    const used = samplesByTrack(song);
    song.tracks.forEach((tr, t) => {
      const m = state.mapping.tracks[t];
      if (m.on && m.mode === 'melodic' && used[t].length > 1) w.push(`${tr.label} plays ${used[t].length} different samples; as a melodic track they all use one instrument. Play it as drums to give each sample its own note.`);
    });
  }
  if (song.product === 'circuit-tracks' && song.tracks.slice(2, 4).some((tr, i) => state.mapping.tracks[i + 2].on && trackHasNotes(tr))) {
    w.push('MIDI 1 and 2 notes are written at the pitch stored in the project. Which octave the Circuit Tracks sends them at is not yet confirmed, so use the Octave setting if they come out wrong.');
  }
  if (!rendered.hits.length) w.push('Nothing plays in these scenes.');
  $('warnings').replaceChildren(...w.map((t) => el('li', { text: t })));
}

// ---------- 5. Mapping ----------

const CHANNELS = Array.from({ length: 16 }, (_, i) => i + 1);

function drawMapping() {
  const { song, mapping, rendered } = state;
  const colours = TRACK_COLOURS[song.product];
  const count = new Array(8).fill(0);
  for (const h of rendered.hits) count[h.track]++;
  const body = $('maptable').querySelector('tbody');
  body.replaceChildren();
  song.tracks.forEach((tr, t) => {
    const m = mapping.tracks[t];
    const on = el('input', { type: 'checkbox', 'aria-label': `Include ${tr.label}`, onchange: (e) => { m.on = e.target.checked; update(); } });
    on.checked = m.on;
    const sw = el('span', { class: 'sw' });
    sw.style.background = `var(${colours[t]})`;
    const mode = select([['melodic', 'Melodic'], ['drums', 'Drums']], m.mode, (v) => {
      m.mode = v;
      if (v === 'drums') m.ch = 10;
      else if (m.ch === 10) m.ch = freeChannel(t);
      if (v === 'melodic' && m.program < 0 && tr.kind !== 'midi') m.program = 0;
      update();
    }, `${tr.label}: play as`);
    const ch = select(CHANNELS.map((c) => [c, c === 10 ? '10 (drums)' : String(c)]), m.ch, (v) => { m.ch = Number(v); update(); }, `${tr.label}: channel`);
    const inst = m.mode === 'melodic'
      ? select([[-1, 'No program change'], ...GM_NAMES.map((n, i) => [i, `${i + 1} ${n}`])], m.program, (v) => { m.program = Number(v); update(); }, `${tr.label}: instrument`)
      : el('span', { class: 'na', text: 'Notes per sample, below' });
    const oct = m.mode === 'melodic'
      ? select([-3, -2, -1, 0, 1, 2, 3].map((o) => [o * 12, o > 0 ? `+${o}` : String(o)]), m.transpose, (v) => { m.transpose = Number(v); update(); }, `${tr.label}: octave`)
      : el('span', { class: 'na', text: '–' });
    body.append(el('tr', { class: m.on ? '' : 'off' },
      el('td', {}, on),
      el('td', {}, el('div', { class: 'trk' }, sw, el('div', {}, el('div', { class: 'pname', text: tr.label }), el('div', { class: 'psub', text: soundLabel(tr) })))),
      el('td', { class: 'c-num', text: String(count[t]) }),
      el('td', {}, mode), el('td', {}, ch), el('td', {}, inst), el('td', {}, oct)));
  });

  const need = ensureDrumNotes(song, mapping);
  const used = samplesByTrack(song);
  const dbody = $('drumtable').querySelector('tbody');
  dbody.replaceChildren();
  for (const slot of need) {
    const who = song.tracks.filter((tr, t) => mapping.tracks[t].on && mapping.tracks[t].mode === 'drums' && used[t].includes(slot)).map((tr) => tr.label);
    const opts = [];
    for (let n = 0; n < 128; n++) opts.push([n, `${n} ${GM_DRUMS[n] ?? noteName(n)}`]);
    dbody.append(el('tr', {},
      el('td', { class: 'pname', text: song.sampleName(slot) }),
      el('td', { text: String(slot + 1) }),
      el('td', { text: who.join(', ') }),
      el('td', {}, select(opts, mapping.drumNotes[slot], (v) => { mapping.drumNotes[slot] = Number(v); update(); }, `${song.sampleName(slot)}: note`))));
  }
  $('drum-wrap').hidden = !need.length;
}

function soundLabel(tr) {
  const kind = { synth: 'synth', midi: 'MIDI track', drum: 'drum track', sample: 'sample track' }[tr.kind];
  return tr.sound ? `${kind} · ${tr.sound}` : kind;
}

function freeChannel(t) {
  const taken = new Set(state.mapping.tracks.filter((m, i) => i !== t && m.on).map((m) => m.ch));
  return CHANNELS.find((c) => c !== 10 && !taken.has(c)) ?? 1;
}

function select(options, value, onChange, label) {
  const s = el('select', { 'aria-label': label, onchange: (e) => onChange(e.target.value) });
  for (const [v, t] of options) s.append(el('option', { value: String(v), text: t }));
  s.value = String(value);
  return s;
}

// ---------- Preview ----------

$('play').addEventListener('click', () => {
  if (player.playing) { player.stop(); setPlayButton(false); return; }
  play(0);
});

function previewEvents() {
  const { song, rendered, mapping } = state;
  const rhythm = song.product === 'circuit-rhythm';
  const ev = [];
  for (const h of rendered.hits) {
    const tr = song.tracks[h.track];
    const m = mapping.tracks[h.track];
    if (!m.on) continue;
    const t = ticksToSeconds(h.tick, song.tempo);
    const d = ticksToSeconds(h.dur, song.tempo);
    if (tr.kind === 'synth' || tr.kind === 'midi') {
      ev.push({ t, d, track: h.track, note: h.note + (m.transpose || 0), vel: h.vel, program: m.program >= 0 ? m.program : 80 });
    } else if (h.sample != null) {
      ev.push({ t, d, track: h.track, note: 60, vel: h.vel, part: `s${h.sample}`, choke: true, rate: rhythm && h.note != null ? 2 ** ((h.note - 60) / 12) : undefined });
    }
  }
  return ev;
}

async function play(from) {
  const song = state.song;
  if (!song) return;
  await player.play(previewEvents(), { from, length: ticksToSeconds(state.rendered.length, song.tempo) });
  setPlayButton(true);
}

player.onPosition = (pos) => {
  $('time').textContent = clock(pos);
  const tick = (pos / (60 / state.song.tempo)) * PPQ;
  const starts = state.rendered.sceneStarts;
  let i = starts.findIndex((s) => tick >= s.tick && tick < s.tick + s.length);
  for (const c of document.querySelectorAll('#grid .col.scene')) c.classList.toggle('now', Number(c.dataset.i) === i);
};
player.onEnd = () => {
  setPlayButton(false);
  for (const c of document.querySelectorAll('#grid .col.now')) c.classList.remove('now');
};

function setPlayButton(on) {
  $('play').textContent = on ? 'Stop' : 'Play preview';
  if (!on) $('time').textContent = '0:00';
}

// ---------- 6. Save ----------

$('save').addEventListener('click', () => {
  const { song, rendered, mapping } = state;
  const tracks = midiTracks(song, rendered, mapping);
  if (!tracks.length) { setStatus('save-status', 'No track has notes to save. Include at least one track.', true); return; }
  const bytes = writeSMF({
    ppq: rendered.ppq, tempo: song.tempo, name: song.name, end: rendered.length, tracks,
    markers: rendered.sceneStarts.map((s) => ({ tick: s.tick, text: `Scene ${s.scene + 1}` })),
  });
  const name = `${fileSafe($('midname').value.trim().replace(/\.midi?$/i, '') || song.name)}.mid`;
  download(new Blob([bytes], { type: 'audio/midi' }), name);
  setStatus('save-status', `Saved ${name}: ${tracks.length} track${tracks.length === 1 ? '' : 's'}, ${tracks.reduce((n, t) => n + t.events.length, 0)} notes.`);
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

function fmtBars(b) { const r = Math.round(b * 100) / 100; return `${r} bar${r === 1 ? '' : 's'}`; }
function fileSafe(s) { return (s || 'Circuit').replace(/[\\/:*?"<>|]+/g, '').trim() || 'Circuit'; }
function asciiName(s, n) { return (s || '').normalize('NFKD').replace(/[^\x20-\x7e]/g, '').slice(0, n); }
function rangeText(list) {
  const nums = list.map((s) => s + 1);
  const out = [];
  for (let i = 0; i < nums.length; i++) {
    let j = i;
    while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
    out.push(j > i ? `${nums[i]}–${nums[j]}` : String(nums[i]));
    i = j;
  }
  return out.join(', ');
}
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
