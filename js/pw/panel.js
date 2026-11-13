// PatchWorker's TRACKS face: a panel laid out like the Circuit Tracks front panel (track
// buttons, view buttons, 32 pads, transport). The layout and views follow Web Tracks by Namir
// Sayed-Ahmad Baraza (circuit-tracks-tools, MIT); the code is CircuitGM's own.
//
// Step 1 of the plan (claude/plan-patchworker-tracks-panel.md): the shell. The track buttons
// choose the synth being edited, and Note view plays it from the bottom two rows of pads. The
// other views are placeholders until their step is built.

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
  { id: 'preset', label: 'Preset', step: 2, group: 'project' }, { id: 'projects', label: 'Projects', step: 3 },
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

// root: the panel's container. api: { synth() -> 0/1 being edited, chooseSynth(i),
// noteOn(note), noteOff(note), octave() -> keyboard octave (C3 = 3) }.
export function buildPanel(root, api) {
  const st = { track: api.synth(), view: 'note', pads: [] };

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
      h('div', { class: 'padzone' }, lcd, grid, hint)),
  );

  // Pads: pointer down plays, up / leave releases (Note view only for now).
  const down = new Map();   // pointerId -> note
  grid.addEventListener('pointerdown', (e) => {
    const pad = e.target.closest('.pad');
    if (!pad || pad.dataset.note == null) return;
    e.preventDefault();
    pad.setPointerCapture?.(e.pointerId);
    const n = +pad.dataset.note;
    down.set(e.pointerId, n);
    pad.classList.add('down');
    api.noteOn(n);
  });
  const up = (e) => {
    const n = down.get(e.pointerId);
    if (n == null) return;
    down.delete(e.pointerId);
    for (const p of st.pads) if (+p.dataset.note === n) p.classList.remove('down');
    api.noteOff(n);
  };
  grid.addEventListener('pointerup', up);
  grid.addEventListener('pointercancel', up);

  function selectTrack(i) {
    st.track = i;
    if (TRACKS[i].kind === 'synth' && i !== api.synth()) api.chooseSynth(i);
    paint();
  }
  function selectView(id) { st.view = id; paint(); }

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
    lcd.textContent = `${t.label} · ${v.label}`;
    if (v.step > 1) hint.textContent = `${v.label} view is not built yet (step ${v.step} of the Tracks panel plan).`;
    else if (t.kind !== 'synth') hint.textContent = `${t.label} comes with the Projects view. Choose Synth 1 or Synth 2 to play its patch.`;
    else hint.textContent = 'Play the patch from the bottom two rows of pads. The keyboard octave and velocity come from the controls at the bottom.';
    paintPads();
  }

  paint();
  return { paint, state: st };
}
