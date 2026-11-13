// PatchWorker's TRACKS face: a panel laid out like the Circuit Tracks front panel (track
// buttons, view buttons, 32 pads, transport). The layout and views follow Web Tracks by Namir
// Sayed-Ahmad Baraza (circuit-tracks-tools, MIT); the code is CircuitGM's own.
//
// Steps of the plan (claude/plan-patchworker-tracks-panel.md) built so far:
// 1. The shell. The track buttons choose the synth being edited, and Note view plays it from the
//    bottom two rows of pads.
// 2. Preset view. Synth tracks: the pack's 128 patches as four pages of 32 pads; the lit pad is
//    the patch being edited, pressing a pad edits that patch and plays it while held. Drum tracks:
//    the pack's 64 samples as two pages; pressing a pad picks the track's sample and plays it.
// The other views are placeholders until their step is built.

export const TRACKS = [
  { id: 's1', label: 'Synth 1', kind: 'synth' }, { id: 's2', label: 'Synth 2', kind: 'synth' },
  { id: 'm1', label: 'MIDI 1', kind: 'midi' }, { id: 'm2', label: 'MIDI 2', kind: 'midi' },
  { id: 'd1', label: 'Drum 1', kind: 'drum' }, { id: 'd2', label: 'Drum 2', kind: 'drum' },
  { id: 'd3', label: 'Drum 3', kind: 'drum' }, { id: 'd4', label: 'Drum 4', kind: 'drum' },
];
// View buttons: the step views on the left, the project views on the right, as on the hardware.
export const VIEWS = [
  { id: 'note', label: 'Note', step: 1 }, { id: 'velocity', label: 'Velocity', step: 4 },
  { id: 'gate', label: 'Gate', step: 4 }, { id: 'probability', label: 'Probability', step: 4 },
  { id: 'micro', label: 'Micro step', step: 4 }, { id: 'pattern', label: 'Pattern settings', step: 4 },
  { id: 'preset', label: 'Preset', step: 1, group: 'project' }, { id: 'projects', label: 'Projects', step: 3 },
  { id: 'patterns', label: 'Patterns', step: 3 }, { id: 'mixer', label: 'Mixer', step: 3 },
  { id: 'fx', label: 'FX', step: 4 }, { id: 'sidechain', label: 'Sidechain', step: 4 },
  { id: 'scales', label: 'Scales', step: 4 }, { id: 'tempo', label: 'Tempo', step: 3 },
];
const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
// Note view keyboard on the bottom two rows of pads: white keys on the bottom row, the black
// keys above them (null = no key), from C to the next C.
const WHITE = [0, 2, 4, 5, 7, 9, 11, 12];
const BLACK = [null, 1, 3, null, 6, 8, 10, null];

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null) el.append(kid);
  return el;
}

// Drum tracks start on these sample slots (TracksGM's Std Kick, Snare, CH, OH) until a project
// sets them (step 3).
const DRUM_DEFAULT = [0, 1, 3, 4];
const pad3 = (n) => String(n).padStart(3, '0');

// root: the panel's container. api: { synth() -> 0/1 being edited, chooseSynth(i),
// noteOn(note), noteOff(note), octave() -> keyboard octave (C3 = 3),
// slot() -> pack slot being edited, slotCount() -> 128, slotInfo(i) -> { name, empty, edited, fetched },
// selectSlot(i), copyTo(i) (asks before replacing a patch), revert(),
// sampleCount() -> 64, sampleName(i) -> name or '' for an empty slot, audition(i), stopAudition() }.
export function buildPanel(root, api) {
  const st = { track: api.synth(), view: 'note', pads: [], page: [0, 0, 0, 0, 0, 0, 0, 0], drum: DRUM_DEFAULT.slice(), copying: false, hover: null, lastSlot: null };

  const trackBtns = TRACKS.map((t, i) => h('button', {
    type: 'button', class: `trk ${t.kind}`, 'data-track': i, 'aria-pressed': 'false', text: t.label,
    title: t.kind === 'synth' ? `${t.label}: edit and play its patch` : `${t.label}: comes with the Projects view`,
    onclick: () => selectTrack(i),
  }));
  const viewBtns = VIEWS.map((v) => h('button', {
    type: 'button', class: `view${v.group ? ` ${v.group}` : ''}`, 'data-view': v.id, 'aria-pressed': 'false', text: v.label,
    title: v.step > 1 ? `${v.label} view (not built yet)` : `${v.label} view`,
    onclick: () => selectView(v.id),
  }));
  const lcd = h('p', { class: 'panel-lcd', role: 'status' });
  const hint = h('p', { class: 'panel-hint' });
  const pages = h('div', { class: 'pages seg', role: 'group', 'aria-label': 'Pages' });
  const copyBtn = h('button', { type: 'button', class: 'btn small', 'aria-pressed': 'false', title: 'Copy the patch being edited onto another pad: press this, then the pad', onclick: () => { st.copying = !st.copying; paint(); } });
  const revertBtn = h('button', { type: 'button', class: 'btn small', text: 'Revert', title: 'Put back the patch the pack had in this slot', onclick: () => api.revert() });
  const tools = h('div', { class: 'pad-tools' }, pages, h('span', { class: 'grow' }), copyBtn, revertBtn);
  const grid = h('div', { class: 'pads', role: 'group', 'aria-label': 'Pads' });
  for (let i = 0; i < 32; i++) {
    const pad = h('button', { type: 'button', class: 'pad', 'data-pad': i, tabindex: '-1' });
    st.pads.push(pad);
    grid.append(pad);
  }
  const transport = h('div', { class: 'transport' },
    h('button', { type: 'button', class: 'tbtn play', disabled: true, title: 'Play the project (comes with the Projects view)', 'aria-label': 'Play', text: '▶' }),
    h('button', { type: 'button', class: 'tbtn rec', disabled: true, title: 'Record (comes with step editing)', 'aria-label': 'Record', text: '●' }),
    h('button', { type: 'button', class: 'tbtn', disabled: true, title: 'Clear (comes with step editing)', text: 'Clear' }),
    h('button', { type: 'button', class: 'tbtn', disabled: true, title: 'Duplicate (comes with step editing)', text: 'Duplicate' }),
  );

  root.append(
    h('div', { class: 'panel-top' }, h('div', { class: 'tracks-row', role: 'group', 'aria-label': 'Tracks' }, trackBtns), transport),
    h('div', { class: 'panel-mid' },
      h('div', { class: 'views', role: 'group', 'aria-label': 'Views' }, viewBtns),
      h('div', { class: 'padzone' }, lcd, tools, grid, hint)),
  );

  // Pads: pointer down plays, up / leave releases. In Preset view a pad picks a patch (and plays
  // it at the keyboard's C while held) or a drum sample (and plays it).
  const down = new Map();   // pointerId -> note
  const hold = (e, pad, n) => {
    pad.setPointerCapture?.(e.pointerId);
    down.set(e.pointerId, n);
    pad.classList.add('down');
    api.noteOn(n);
  };
  grid.addEventListener('pointerdown', (e) => {
    const pad = e.target.closest('.pad');
    if (!pad) return;
    if (pad.dataset.slot != null) {
      e.preventDefault();
      const i = +pad.dataset.slot;
      if (st.copying) { st.copying = false; paint(); if (i !== api.slot()) api.copyTo(i); return; }
      if (i !== api.slot()) api.selectSlot(i);
      hold(e, pad, (api.octave() + 1) * 12);
      return;
    }
    if (pad.dataset.sample != null) {
      e.preventDefault();
      st.drum[st.track - 4] = +pad.dataset.sample;
      api.audition(+pad.dataset.sample);
      paint();
      return;
    }
    if (pad.dataset.note == null) return;
    e.preventDefault();
    hold(e, pad, +pad.dataset.note);
  });
  const up = (e) => {
    const n = down.get(e.pointerId);
    if (n == null) return;
    down.delete(e.pointerId);
    for (const p of st.pads) p.classList.remove('down');
    api.noteOff(n);
  };
  // Hovering a preset pad shows its name on the LCD.
  grid.addEventListener('pointerover', (e) => {
    const pad = e.target.closest('.pad');
    const k = pad?.dataset.slot ?? pad?.dataset.sample ?? null;
    if (k === st.hover) return;
    st.hover = k;
    paintLcd();
  });
  grid.addEventListener('pointerleave', () => { st.hover = null; paintLcd(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && st.copying) { st.copying = false; paint(); } });
  grid.addEventListener('pointerup', up);
  grid.addEventListener('pointercancel', up);

  function selectTrack(i) {
    st.track = i;
    st.copying = false;
    if (TRACKS[i].kind === 'synth' && i !== api.synth()) api.chooseSynth(i);
    paint();
  }
  function selectView(id) {
    st.view = id;
    st.copying = false;
    if (id === 'preset') followSlot();
    paint();
  }
  // Turn the synth tracks' preset page to the one holding the patch being edited.
  function followSlot() { st.lastSlot = api.slot(); st.page[0] = st.page[1] = Math.floor(st.lastSlot / 32); }
  const presetKind = () => (st.view !== 'preset' ? null : TRACKS[st.track].kind);
  const pageCount = () => (presetKind() === 'synth' ? Math.ceil(api.slotCount() / 32) : presetKind() === 'drum' ? Math.ceil(api.sampleCount() / 32) : 0);

  function paintPages() {
    const n = pageCount();
    tools.hidden = !n;
    if (!n) return;
    st.page[st.track] = Math.min(st.page[st.track], n - 1);
    if (pages.children.length !== n) {
      pages.textContent = '';
      for (let k = 0; k < n; k++) pages.append(h('button', { type: 'button', 'data-page': k, onclick: () => { st.page[st.track] = k; paint(); } }));
    }
    [...pages.children].forEach((b, k) => {
      b.textContent = `${k * 32 + 1}–${(k + 1) * 32}`;
      const on = k === st.page[st.track];
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    const synth = presetKind() === 'synth';
    copyBtn.hidden = revertBtn.hidden = !synth;
    if (synth) {
      const info = api.slotInfo(api.slot());
      copyBtn.textContent = st.copying ? 'Cancel copy' : 'Copy to pad…';
      copyBtn.classList.toggle('on', st.copying);
      copyBtn.setAttribute('aria-pressed', String(st.copying));
      revertBtn.disabled = !info.edited;
    }
  }

  function paintPresetPads() {
    const kind = presetKind();
    const base = st.page[st.track] * 32;
    const cur = kind === 'synth' ? api.slot() : st.drum[st.track - 4];
    st.pads.forEach((p, k) => {
      const i = base + k;
      delete p.dataset.note; delete p.dataset.slot; delete p.dataset.sample;
      let cls = 'pad preset';
      let name;
      if (kind === 'synth') {
        if (i >= api.slotCount()) { p.className = 'pad off'; p.textContent = ''; return; }
        const info = api.slotInfo(i);
        name = info.empty ? 'Initial Patch' : info.name || '(no name)';
        if (info.empty) cls += ' empty';
        if (info.edited) cls += ' edited';
        if (info.fetched) cls += ' fetched';
        p.dataset.slot = i;
      } else {
        if (i >= api.sampleCount()) { p.className = 'pad off'; p.textContent = ''; return; }
        name = api.sampleName(i);
        if (!name) cls += ' empty';
        p.dataset.sample = i;
      }
      if (i === cur) cls += ' lit';
      if (st.copying && i !== cur) cls += ' target';
      p.className = cls;
      p.textContent = String(i + 1);
      p.title = `${pad3(i + 1)} ${name || '(empty)'}`;
      p.setAttribute('aria-label', p.title);
      p.setAttribute('aria-pressed', String(i === cur));
    });
  }

  function paintLcd() {
    const t = TRACKS[st.track], v = VIEWS.find((x) => x.id === st.view);
    let text = `${t.label} · ${v.label}`;
    const kind = presetKind();
    if (kind === 'synth') {
      const i = st.hover != null ? +st.hover : api.slot();
      const info = api.slotInfo(i);
      text += ` · ${pad3(i + 1)} ${info.empty ? 'Initial Patch' : info.name || '(no name)'}`;
    } else if (kind === 'drum') {
      const i = st.hover != null ? +st.hover : st.drum[st.track - 4];
      text += ` · ${pad3(i + 1)} ${api.sampleName(i) || '(empty)'}`;
    }
    lcd.textContent = text;
  }

  function paintPads() {
    const synthTrack = TRACKS[st.track].kind === 'synth';
    const oct = api.octave();
    st.pads.forEach((p, i) => {
      const row = Math.floor(i / 8), col = i % 8;
      let note = null, cls = 'pad', label = '';
      if (st.view === 'note' && synthTrack) {
        if (row < 2) cls += ' step';                       // the 16 steps: step editing comes later
        else {
          const semi = row === 3 ? WHITE[col] : BLACK[col];
          if (semi != null) {
            note = (oct + 1) * 12 + semi;
            cls += row === 3 ? ' key white' : ' key black';
            if (semi % 12 === 0) { cls += ' root'; label = `${NOTE_NAMES[0]}${Math.floor(note / 12) - 1}`; }
          } else cls += ' off';
        }
      } else cls += ' off';
      p.className = cls;
      p.textContent = label;
      delete p.dataset.slot; delete p.dataset.sample; p.removeAttribute('title'); p.removeAttribute('aria-pressed');
      if (note == null) { delete p.dataset.note; p.removeAttribute('aria-label'); p.tabIndex = -1; }
      else { p.dataset.note = note; p.setAttribute('aria-label', `${NOTE_NAMES[note % 12]}${Math.floor(note / 12) - 1}`); }
    });
  }

  function paint() {
    st.track = TRACKS[st.track].kind === 'synth' ? api.synth() : st.track;
    trackBtns.forEach((b, i) => { const on = i === st.track; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    viewBtns.forEach((b) => { const on = b.dataset.view === st.view; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    const t = TRACKS[st.track], v = VIEWS.find((x) => x.id === st.view);
    root.dataset.track = t.kind;
    root.dataset.copying = st.copying ? 'yes' : 'no';
    paintLcd();
    paintPages();
    if (v.id === 'preset') {
      if (t.kind === 'synth') hint.textContent = st.copying
        ? 'Press the pad to copy the patch being edited onto. Esc cancels.'
        : 'Press a pad to edit that patch; it plays while you hold the pad. An orange dot marks a patch changed since the pack was opened, a ring one fetched from the Circuit Tracks.';
      else if (t.kind === 'drum') hint.textContent = `Press a pad to choose ${t.label}'s sample and hear it. A project sets each drum's sample when the Projects view comes (step 3).`;
      else hint.textContent = 'MIDI tracks have no presets here.';
      if (t.kind === 'midi') { st.pads.forEach((p) => { p.className = 'pad off'; p.textContent = ''; delete p.dataset.note; delete p.dataset.slot; delete p.dataset.sample; }); } else paintPresetPads();
      return;
    }
    if (v.step > 1) hint.textContent = `${v.label} view is not built yet (step ${v.step} of the Tracks panel plan).`;
    else if (t.kind !== 'synth') hint.textContent = `${t.label} comes with the Projects view. Choose Synth 1 or Synth 2 to play its patch.`;
    else hint.textContent = 'Play the patch from the bottom two rows of pads. The keyboard octave and velocity come from the controls at the bottom.';
    paintPads();
  }

  // Repaint after a patch changes or another slot is chosen elsewhere (cheap when hidden).
  function refresh() {
    if (root.hidden || st.view !== 'preset') return;
    if (api.slot() !== st.lastSlot) followSlot();   // another patch was chosen: show its page
    paint();
  }

  paint();
  // selectTrack: a track chosen on the Circuit Tracks itself (0 Synth 1 … 7 Drum 4).
  // selectView: a view chosen on the Circuit Tracks itself (an id from VIEWS).
  return { paint, refresh, selectTrack: (i) => { if (i >= 0 && i < TRACKS.length) selectTrack(i); }, selectView: (id) => { if (VIEWS.some((v) => v.id === id) && id !== st.view) selectView(id); }, state: st };
}
