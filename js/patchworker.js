// PatchWorker: a synth patch editor for the Novation Circuit Tracks.
// Pages and parameters follow Novation Components' Synth editor (Main / Effects / Modulation).
import { P, PATCH_SIZE, OSC_WAVES, FILTER_TYPES, DRIVE_TYPES, LFO_WAVES, POLY_MODES, ROUTINGS,
  FADE_MODES, CATEGORIES, GENRES, MOD_SOURCES, MOD_DESTS, MACRO_DESTS, MOD_SLOTS, FMT, modAddr,
  macroPosAddr, macroAddr, macroRows, initPatch, getName, setName, parseSyx, toSyx, sanitise,
  cutoffHz, eqDb, eqHz, syncName } from './pw/params.js?v=20261112b';
import { PatchSynth, waveTable, lfoShape, envelopePoints } from './pw/engine.js?v=20261112b';
import { TracksLink } from './pw/midi.js?v=20261112b';
import { openPack, buildPack, bankSyx, slotEdited, editedSlots, projectsFollowing, download,
  fileSafe, session, PATCH_SLOTS } from './pw/packio.js?v=20261112b';

const DEFAULT_PACK = '../tracksgm/TracksGM_final.circuittrackspack';
const $ = (s) => document.querySelector(s);
const NS = 'http://www.w3.org/2000/svg';

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
function svg(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.append(...kids);
  return el;
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const pad3 = (n) => String(n).padStart(3, '0');

// ------------------------------------------------------------------ state
const S = {
  pack: null,
  slot: 0,
  bytes: initPatch(),          // the patch being edited: the pack's own array for the slot
  undo: new Map(),             // slot -> { past: [], future: [], key, at }
  macro: 0,                    // macro shown on the Modulation page
  synth: 0,                    // Circuit Tracks synth the link talks to
  hear: 'browser',
  octave: 3,
  velocity: 100,
  hold: false,
  held: new Map(),             // key note -> true (sounding notes)
  restored: false,
};
const link = new TracksLink();
let ctx = null;
let synth = null;

// Controls register here so one change repaints only what shows it.
const watchers = new Map();    // address -> [fn]
const always = [];             // repainted on every change
const watch = (addrs, fn) => { for (const a of [].concat(addrs)) { if (!watchers.has(a)) watchers.set(a, []); watchers.get(a).push(fn); } };
function repaint(addr = null) {
  if (addr == null) { for (const fns of watchers.values()) for (const fn of fns) fn(); } else for (const fn of watchers.get(addr) ?? []) fn();
  for (const fn of always) fn();
}

// ------------------------------------------------------------------ audio
function audio() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    synth = new PatchSynth(ctx);
    synth.bpm = +$('#bpm').value;
    synth.setVolume($('#vol').value / 100);
    synth.setPatch(S.bytes);
    drawScope();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return synth;
}
const hearBrowser = () => S.hear !== 'tracks' || !link.connected;
const hearTracks = () => S.hear !== 'browser' && link.connected;

function noteOn(note, velocity = S.velocity) {
  if (note < 0 || note > 127) return;
  if (S.held.has(note)) noteOff(note, true);
  S.held.set(note, true);
  if (hearBrowser()) audio().noteOn(note, velocity);
  if (hearTracks()) link.noteOn(S.synth, note, velocity);
  paintKeys();
}
function noteOff(note, force = false) {
  if (!S.held.has(note)) return;
  if (S.hold && !force) return;
  S.held.delete(note);
  synth?.noteOff(note);
  if (link.connected) link.noteOff(S.synth, note);
  paintKeys();
}
function panic() {
  for (const n of [...S.held.keys()]) noteOff(n, true);
  synth?.allNotesOff();
  if (link.connected) link.allNotesOff(S.synth);
}

// ------------------------------------------------------------------ editing
function hist() {
  if (!S.undo.has(S.slot)) S.undo.set(S.slot, { past: [], future: [], key: null, at: 0 });
  return S.undo.get(S.slot);
}
// Remember the patch before a change. Changes to the same control within a second are one step.
function checkpoint(key) {
  const u = hist();
  const now = performance.now();
  if (key != null && key === u.key && now - u.at < 1000) { u.at = now; return; }
  u.past.push(S.bytes.slice());
  if (u.past.length > 200) u.past.shift();
  u.future.length = 0;
  u.key = key;
  u.at = now;
}

function setByte(addr, value, key = addr) {
  if (S.bytes[addr] === value) return;
  checkpoint(key);
  S.bytes[addr] = value;
  changed(addr);
}

// The whole patch was replaced (undo, import, init, revert).
function replacePatch(bytes, note = null) {
  S.bytes.set(bytes);
  changed(null);
  if (note) toast(note);
}

let saveTimer = null;
let sendTimer = null;
function changed(addr) {
  synth?.refresh();
  repaint(addr);
  paintSlot(S.slot);
  paintBar();
  sendLive(addr);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveSession, 500);
}

const PARAM_AT = new Map(Object.values(P).map((p) => [p.a, p]));
function sendWhole(delay = 180) {
  clearTimeout(sendTimer);
  sendTimer = setTimeout(() => link.sendPatch(S.bytes, S.synth), delay);
}
function sendLive(addr) {
  if (!link.connected || !$('#hw-live').checked) return;
  if (addr == null) { sendWhole(0); return; }
  const p = PARAM_AT.get(addr);
  if (p && (p.cc != null || p.nrpn)) { link.sendParam(S.synth, p.id, S.bytes[addr]); return; }
  for (let k = 0; k < 8; k++) if (addr === macroPosAddr(k)) { link.macro(S.synth, k, S.bytes[addr]); return; }
  if (p && /^lfo[12]_flags$/.test(p.id)) {
    // LFO switches share two NRPNs: 0:122 takes an on/off code per switch, 0:123 the fade mode.
    const n = p.id === 'lfo1_flags' ? 0 : 1;
    const f = S.bytes[addr];
    for (let bit = 0; bit < 4; bit++) link.nrpn(S.synth, 0, 122, 12 + n * 10 + bit * 2 + ((f >> bit) & 1));
    link.nrpn(S.synth, 0, 123, n * 4 + ((f >> 4) & 3));
    return;
  }
  sendWhole();
}

function undo() {
  const u = hist();
  if (!u.past.length) return;
  u.future.push(S.bytes.slice());
  u.key = null;
  replacePatch(u.past.pop());
}
function redo() {
  const u = hist();
  if (!u.future.length) return;
  u.past.push(S.bytes.slice());
  u.key = null;
  replacePatch(u.future.pop());
}

function selectSlot(slot, { send = true } = {}) {
  panic();
  S.slot = clamp(slot, 0, PATCH_SLOTS - 1);
  if (!S.pack.patches[S.slot]) S.pack.patches[S.slot] = initPatch();   // an empty slot edits as the Initial Patch
  S.bytes = S.pack.patches[S.slot];
  synth?.setPatch(S.bytes);
  repaint();
  paintList();
  paintBar();
  if (send && link.connected && $('#hw-live').checked) sendWhole(0);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveSession, 500);
}

// ------------------------------------------------------------------ controls
// A binding says where a control's value lives: { addr, lo, hi, def, fmt, label }.
const bindParam = (id, extra = {}) => ({ addr: P[id].a, lo: P[id].lo, hi: P[id].hi, def: P[id].d, fmt: FMT[P[id].fmt], label: P[id].label, id, ...extra });
const NOT_IN_BROWSER = new Set(['filter_q_normalise', 'osc1_bend', 'osc2_bend', 'lfo1_slew', 'lfo2_slew']);

function knob(b, { small = false } = {}) {
  const A0 = -135;
  const SW = 270;
  const arc = (from, to) => {
    const pt = (deg) => { const r = (deg - 90) * Math.PI / 180; return [24 + 19 * Math.cos(r), 24 + 19 * Math.sin(r)]; };
    const [a, bb] = from <= to ? [from, to] : [to, from];
    const [x0, y0] = pt(a);
    const [x1, y1] = pt(bb);
    return `M${x0.toFixed(2)} ${y0.toFixed(2)}A19 19 0 ${bb - a > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  };
  const track = svg('path', { class: 'k-track', d: arc(A0, A0 + SW) });
  const val = svg('path', { class: 'k-val', d: '' });
  const ptr = svg('line', { class: 'k-ptr', x1: 24, y1: 24, x2: 24, y2: 10 });
  const dial = svg('svg', { viewBox: '0 0 48 48', class: 'k-svg' }, track, val, svg('circle', { class: 'k-body', cx: 24, cy: 24, r: 14.5 }), ptr);
  const out = h('output', { class: 'k-out' });
  const el = h('div', { class: `knob${small ? ' small' : ''}${b.id && NOT_IN_BROWSER.has(b.id) ? ' hwonly' : ''}`, tabindex: 0, role: 'slider',
    'aria-label': b.aria ?? b.label, 'aria-valuemin': b.lo, 'aria-valuemax': b.hi,
    title: `${b.aria ?? b.label}: drag up or down (Shift = fine), scroll, arrow keys, double-click to reset${b.id && NOT_IN_BROWSER.has(b.id) ? '. Heard on the Circuit Tracks only.' : ''}` },
  dial, h('span', { class: 'k-label', text: b.label }), out);
  const get = () => S.bytes[b.addr];
  const set = (v) => setByte(b.addr, clamp(Math.round(v), b.lo, b.hi));
  const bipolar = b.def === 64 && b.lo < 64 && b.hi > 64 && b.fmt !== FMT.raw;
  const paint = () => {
    const v = get();
    const t = (v - b.lo) / (b.hi - b.lo || 1);
    const deg = A0 + SW * t;
    val.setAttribute('d', bipolar ? arc(A0 + SW * ((64 - b.lo) / (b.hi - b.lo)), deg) : arc(A0, deg));
    ptr.setAttribute('transform', `rotate(${deg} 24 24)`);
    out.textContent = (b.fmt ?? FMT.raw)(v);
    el.setAttribute('aria-valuenow', v);
    el.setAttribute('aria-valuetext', out.textContent);
    el.classList.toggle('moved', v !== b.def);
  };
  watch(b.addr, paint);

  let drag = null;
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target === out) return;
    el.setPointerCapture(e.pointerId);
    drag = { y: e.clientY, v: get() };
    el.classList.add('drag');
    e.preventDefault();
    el.focus();
  });
  el.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const span = b.hi - b.lo;
    const per = (e.shiftKey ? 0.25 : 1) * Math.max(span / 150, 0.12);
    set(drag.v + (drag.y - e.clientY) * per);
  });
  const end = () => { drag = null; el.classList.remove('drag'); };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('dblclick', (e) => { if (e.target !== out) set(b.def); });
  el.addEventListener('wheel', (e) => { e.preventDefault(); set(get() + (e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 5 : 1)); }, { passive: false });
  el.addEventListener('keydown', (e) => {
    const step = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 10, PageDown: -10 }[e.key];
    if (step) { set(get() + step); e.preventDefault(); } else if (e.key === 'Home') { set(b.lo); e.preventDefault(); } else if (e.key === 'End') { set(b.hi); e.preventDefault(); } else if (e.key === 'Delete' || e.key === 'Backspace') { set(b.def); e.preventDefault(); }
  });
  // Click the readout to type an exact value (the stored 0-127 number).
  out.addEventListener('click', () => {
    const input = h('input', { type: 'number', class: 'k-type', min: b.lo, max: b.hi, value: get() });
    out.replaceWith(input);
    input.focus();
    input.select();
    const done = (commit) => { if (commit && input.value !== '') set(+input.value); input.replaceWith(out); paint(); };
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); });
    input.addEventListener('blur', () => done(true));
  });
  return el;
}

function optionList(items, groups = false) {
  if (!groups) return items.map((it) => h('option', { value: it.v, text: it.label }));
  const out = [];
  let grp = null;
  for (const it of items) {
    if (!it.group) { out.push(h('option', { value: it.v, text: it.label })); continue; }
    if (!grp || grp.label !== it.group) { grp = h('optgroup', { label: it.group }); out.push(grp); }
    grp.append(h('option', { value: it.v, text: it.label }));
  }
  return out;
}
const numbered = (names) => names.map((label, v) => ({ v, label }));

// A drop-down bound to one byte, with optional previous / next arrows (as in Components).
function picker(addr, items, { arrows = false, groups = false, label, key } = {}) {
  const sel = h('select', { 'aria-label': label }, optionList(items, groups));
  const values = items.map((it) => it.v);
  sel.addEventListener('change', () => setByte(addr, +sel.value, key));
  watch(addr, () => {
    const v = S.bytes[addr];
    if (!values.includes(v)) { sel.append(h('option', { value: v, text: `Value ${v}` })); values.push(v); }
    sel.value = v;
  });
  if (!arrows) return sel;
  const step = (d) => {
    const i = values.indexOf(S.bytes[addr]);
    setByte(addr, values[(i + d + values.length) % values.length], key);
  };
  return h('div', { class: 'picker' }, sel,
    h('button', { type: 'button', class: 'icon', 'aria-label': 'Previous', onclick: () => step(-1), text: '‹' }),
    h('button', { type: 'button', class: 'icon', 'aria-label': 'Next', onclick: () => step(1), text: '›' }));
}

// Radio-style segment bound to a byte (or to bits of it through get / set).
function segment(labels, get, set, cls = '') {
  const btns = labels.map((label, v) => h('button', { type: 'button', text: label, onclick: () => set(v) }));
  const el = h('span', { class: `seg ${cls}`, role: 'radiogroup' }, btns);
  const paint = () => btns.forEach((bt, v) => bt.classList.toggle('on', get() === v));
  return [el, paint];
}

function checkbox(label, get, set, title) {
  const input = h('input', { type: 'checkbox' });
  input.addEventListener('change', () => set(input.checked));
  return [h('label', { class: 'check', title }, input, ` ${label}`), () => { input.checked = get(); }];
}

// A slider for signed depths (-64..+63 stored as 0..127, 64 = none).
function depthSlider(addr, label) {
  const input = h('input', { type: 'range', min: 0, max: 127, 'aria-label': label, class: 'depth' });
  const out = h('output', { class: 'depth-out' });
  input.addEventListener('input', () => setByte(addr, +input.value));
  input.addEventListener('dblclick', () => setByte(addr, 64));
  watch(addr, () => {
    const v = S.bytes[addr];
    input.value = v;
    out.textContent = FMT.bi(v);
    input.style.setProperty('--fill', `${(Math.min(v, 64) / 127) * 100}%`);
    input.style.setProperty('--fill-end', `${(Math.max(v, 64) / 127) * 100}%`);
    input.classList.toggle('zero', v === 64);
  });
  return h('span', { class: 'depthwrap' }, input, out);
}

function panel(title, cls, ...kids) {
  return h('section', { class: `panel ${cls}` }, typeof title === 'string' ? h('h3', { text: title }) : title, ...kids);
}
const knobs = (...ks) => h('div', { class: 'knobs' }, ...ks);

function graph(w, hgt, cls = '') {
  const path = svg('path', { class: 'g-line' });
  const fill = svg('path', { class: 'g-fill' });
  // Drawn at a fixed shape: the picture grows and shrinks with its panel but is never stretched.
  const el = svg('svg', { viewBox: `0 0 ${w} ${hgt}`, class: `graph ${cls}`, style: `--ar:${(w / hgt).toFixed(3)}` }, fill, path);
  const draw = (pts, base = hgt) => {
    const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');
    path.setAttribute('d', d);
    fill.setAttribute('d', `${d}L${pts[pts.length - 1][0].toFixed(1)} ${base}L${pts[0][0].toFixed(1)} ${base}Z`);
  };
  return [el, draw];
}

// ------------------------------------------------------------------ Main page
function oscPanel(n) {
  const id = (s) => `osc${n}_${s}`;
  const [g, draw] = graph(200, 76);
  watch([P[id('wave')].a, P[id('pw')].a, P[id('interpolate')].a, P[id('vsync')].a], () => {
    const t = waveTable(S.bytes[P[id('wave')].a], S.bytes[P[id('pw')].a], S.bytes[P[id('interpolate')].a], S.bytes[P[id('vsync')].a]);
    const pts = [];
    for (let i = 0; i <= 200; i++) pts.push([i, 38 - t[Math.floor((i / 200) * (t.length - 1))] * 31]);
    draw(pts, 38);
  });
  return panel(`Osc ${n}`, 'osc',
    picker(P[id('wave')].a, numbered(OSC_WAVES), { arrows: true, label: `Oscillator ${n} wave` }), g,
    knobs(knob(bindParam(id('pw'))), knob(bindParam(id('interpolate'))), knob(bindParam(id('vsync'))),
      knob(bindParam(id('cents'))), knob(bindParam(id('semitones'))), knob(bindParam(id('density'))),
      knob(bindParam(id('density_detune'))), knob(bindParam(id('bend'), { label: 'Bend' }))));
}

function mixerPanel() {
  return panel('Mixer', 'mixer', knobs(knob(bindParam('osc1_level')), knob(bindParam('osc2_level')),
    knob(bindParam('noise_level')), knob(bindParam('ring_level')), knob(bindParam('pre_fx_level')),
    knob(bindParam('post_fx_level'))));
}

function filterPanel() {
  const [g, draw] = graph(260, 64);
  const A = ['filter_type', 'filter_frequency', 'filter_resonance'].map((k) => P[k].a);
  watch(A, () => {
    const type = S.bytes[A[0]];
    const fc = cutoffHz(S.bytes[A[1]]);
    const r = S.bytes[A[2]] / 127;
    const stages = type % 2 ? 2 : 1;
    const q = stages > 1 ? 0.6 + r * r * 9 : 0.707 + r * r * 20;
    const pts = [];
    for (let i = 0; i <= 260; i += 2) {
      const f = 20 * 1000 ** (i / 260);
      const w = f / fc;
      const den = Math.sqrt((1 - w * w) ** 2 + (w / q) ** 2);
      const mag = (type <= 1 ? 1 / den : type <= 3 ? (w / q) / den : (w * w) / den) ** stages;
      pts.push([i, clamp(40 - 20 * Math.log10(Math.max(mag, 1e-4)) * 1.1, 2, 64)]);
    }
    draw(pts);
  });
  const [route, paintRoute] = segment(ROUTINGS, () => S.bytes[P.filter_routing.a], (v) => setByte(P.filter_routing.a, v), 'stack');
  watch(P.filter_routing.a, paintRoute);
  return panel('Filter', 'filter',
    picker(P.filter_type.a, numbered(FILTER_TYPES), { arrows: true, label: 'Filter type' }), g,
    h('div', { class: 'cols' },
      h('div', {}, h('p', { class: 'eyebrow', text: 'Bypass' }), route,
        h('p', { class: 'eyebrow', text: 'Drive type' }), picker(P.filter_drive_type.a, numbered(DRIVE_TYPES), { arrows: true, label: 'Drive type' })),
      knobs(knob(bindParam('filter_frequency')), knob(bindParam('filter_resonance')), knob(bindParam('filter_q_normalise')),
        knob(bindParam('filter_tracking')), knob(bindParam('env2_to_filter')), knob(bindParam('filter_drive')))));
}

function tabbed(title, names, build, cls) {
  const bodies = names.map((_, i) => build(i));
  const btns = names.map((name, i) => h('button', { type: 'button', text: name, onclick: () => show(i) }));
  function show(i) {
    bodies.forEach((bd, k) => { bd.hidden = k !== i; });
    btns.forEach((bt, k) => bt.classList.toggle('on', k === i));
  }
  show(0);
  return panel(h('h3', {}, title, h('span', { class: 'seg tabseg' }, btns)), cls, ...bodies);
}

function envBody(i) {
  const n = i + 1;
  const [g, draw] = graph(260, 72);
  const ids = [n === 3 ? 'env3_delay' : `env${n}_velocity`, `env${n}_attack`, `env${n}_decay`, `env${n}_sustain`, `env${n}_release`];
  watch(ids.map((k) => P[k].a), () => {
    const e = envelopePoints(S.bytes, n);
    const wid = (t) => 6 + 52 * Math.log10(1 + t * 25) / Math.log10(1 + 25 * 12);   // short stages stay visible
    const y = (lv) => 68 - lv * 62;
    let x = 4;
    const pts = [[x, y(0)]];
    if (e.delay > 0) { x += wid(e.delay); pts.push([x, y(0)]); }
    x += wid(e.attack); pts.push([x, y(1)]);
    const dw = wid(e.decay);
    for (let k = 1; k <= 8; k++) pts.push([x + (dw * k) / 8, y(e.sustain + (1 - e.sustain) * Math.exp(-4 * k / 8))]);
    x += dw + 36; pts.push([x, y(e.sustain)]);
    const rw = wid(e.release);
    for (let k = 1; k <= 8; k++) pts.push([x + (rw * k) / 8, y(e.sustain * Math.exp(-4 * k / 8))]);
    draw(pts, 68);
  });
  return h('div', { class: 'tabbody' }, g, knobs(...ids.map((k) => knob(bindParam(k)))));
}

// A rate knob with a Sync box: unticked it sets the free rate, ticked it picks a note length.
function syncedKnob(rateId, syncId, label) {
  const free = knob(bindParam(rateId, { label }));
  const synced = knob(bindParam(syncId, { label, lo: 1, def: 10, fmt: FMT.sync, aria: `${label} (synced)` }));
  let last = 10;
  const [box, paintBox] = checkbox('Sync', () => S.bytes[P[syncId].a] > 0, (on) => {
    if (on) setByte(P[syncId].a, last); else { last = S.bytes[P[syncId].a] || last; setByte(P[syncId].a, 0); }
  }, 'Lock to the tempo');
  watch(P[syncId].a, () => { const on = S.bytes[P[syncId].a] > 0; free.hidden = on; synced.hidden = !on; paintBox(); });
  return h('div', { class: 'synced' }, free, synced, box);
}

function lfoBody(i) {
  const n = i + 1;
  const id = (s) => `lfo${n}_${s}`;
  const fa = P[id('flags')].a;
  const [g, draw] = graph(260, 64);
  watch([P[id('wave')].a, P[id('phase')].a], () => {
    const t = lfoShape(S.bytes[P[id('wave')].a], 256);
    const off = Math.round((S.bytes[P[id('phase')].a] / 120) * 256);
    const pts = [];
    for (let k = 0; k <= 256; k++) pts.push([(k / 256) * 260, 32 - t[(k + off) % 256] * 26]);
    draw(pts, 32);
  });
  const flag = (bit) => [() => !!(S.bytes[fa] & (1 << bit)), (on) => setByte(fa, on ? S.bytes[fa] | (1 << bit) : S.bytes[fa] & ~(1 << bit))];
  const [oneShot, p1] = checkbox('One Shot', ...flag(0), 'Run through the wave once per note');
  const [common, p2] = checkbox('Common Sync', ...flag(2), 'All voices share one LFO phase');
  const [style, p3] = segment(['Free', 'Key Sync'], () => (S.bytes[fa] >> 1) & 1, (v) => flag(1)[1](!!v));
  const [trig, p4] = segment(['Single', 'Multi'], () => (S.bytes[fa] >> 3) & 1, (v) => flag(3)[1](!!v));
  const [fade, p5] = segment(FADE_MODES, () => (S.bytes[fa] >> 4) & 3, (v) => setByte(fa, (S.bytes[fa] & 0x0f) | (v << 4)), 'stack');
  watch(fa, () => { p1(); p2(); p3(); p4(); p5(); });
  return h('div', { class: 'tabbody lfo' },
    h('div', { class: 'lfo-wave' }, picker(P[id('wave')].a, numbered(LFO_WAVES), { arrows: true, label: `LFO ${n} wave` }), g,
      h('div', { class: 'knobs' }, knob(bindParam(id('slew'))), knob(bindParam(id('phase'))), h('div', { class: 'checks' }, oneShot, common))),
    h('div', { class: 'lfo-rate' },
      h('div', { class: 'knobs' }, syncedKnob(id('rate'), id('rate_sync'), 'Rate'), syncedKnob(id('delay'), id('delay_sync'), 'Delay')),
      h('div', { class: 'cols' }, h('div', {}, h('p', { class: 'eyebrow', text: 'Sync style' }), style),
        h('div', {}, h('p', { class: 'eyebrow', text: 'Delay trigger' }), trig))),
    h('div', { class: 'lfo-fade' }, h('p', { class: 'eyebrow', text: 'Fade mode' }), fade));
}

function buildMain() {
  $('#page-main').append(
    h('div', { class: 'grid top' }, oscPanel(1), oscPanel(2), mixerPanel(), filterPanel()),
    h('div', { class: 'grid bottom' },
      tabbed('Envelope', ['1 Amp', '2 Filter', '3 Mod'], envBody, 'env'),
      tabbed('LFO', ['1', '2'], lfoBody, 'lfopanel')));
}

// ------------------------------------------------------------------ Effects page
function buildFx() {
  const [ctype, paintC] = segment(['Phaser', 'Chorus'], () => S.bytes[P.chorus_type.a], (v) => setByte(P.chorus_type.a, v), 'big');
  watch(P.chorus_type.a, paintC);
  const chorus = panel('Chorus / Phaser', 'chorus', ctype,
    knobs(syncedKnob('chorus_rate', 'chorus_rate_sync', 'Rate'), knob(bindParam('chorus_feedback')), knob(bindParam('chorus_depth')),
      knob(bindParam('chorus_delay')), knob(bindParam('chorus_level'))));

  const [g, draw] = graph(300, 110);
  const ids = ['eq_bass_freq', 'eq_bass_level', 'eq_mid_freq', 'eq_mid_level', 'eq_treble_freq', 'eq_treble_level'];
  watch(ids.map((k) => P[k].a), () => {
    const v = (k) => S.bytes[P[k].a];
    const lf = eqHz('bass', v('eq_bass_freq')); const lg = eqDb('bass', v('eq_bass_level'));
    const mf = eqHz('mid', v('eq_mid_freq')); const mg = eqDb('mid', v('eq_mid_level'));
    const tf = eqHz('treble', v('eq_treble_freq')); const tg = eqDb('treble', v('eq_treble_level'));
    const pts = [];
    for (let i = 0; i <= 300; i += 3) {
      const f = 20 * 1000 ** (i / 300);
      const dbv = lg / (1 + (f / lf) ** 2) + mg * Math.exp(-(Math.log2(f / mf) ** 2) / 0.35) + tg * ((f / tf) ** 2 / (1 + (f / tf) ** 2));
      pts.push([i, clamp(55 - dbv * 2.6, 2, 108)]);
    }
    draw(pts, 55);
  });
  const eq = panel('Equaliser', 'eq', g, knobs(knob(bindParam('eq_bass_level')), knob(bindParam('eq_mid_level')), knob(bindParam('eq_treble_level')),
    knob(bindParam('eq_bass_freq')), knob(bindParam('eq_mid_freq')), knob(bindParam('eq_treble_freq'))));

  const dist = panel('Distortion', 'dist', knobs(knob(bindParam('distortion_level')), knob(bindParam('distortion_compensation'))),
    h('p', { class: 'eyebrow', text: 'Distortion type' }), picker(P.distortion_type.a, numbered(DRIVE_TYPES), { arrows: true, label: 'Distortion type' }));

  const [mode, paintM] = segment(POLY_MODES, () => S.bytes[P.poly_mode.a], (v) => setByte(P.poly_mode.a, v), 'big');
  watch(P.poly_mode.a, paintM);
  const voice = panel('Voice', 'voice', mode, knobs(knob(bindParam('portamento')), knob(bindParam('pre_glide')), knob(bindParam('octave'))));
  $('#page-fx').append(h('div', { class: 'grid fx' }, chorus, eq, dist, voice));
}

// ------------------------------------------------------------------ Modulation page
function buildMod() {
  // Macro assignments: the selected macro's four destinations.
  const title = h('h3', {});
  const rows = h('div', { class: 'macro-slots' });
  const macroPanel = panel(title, 'macro-edit', rows);
  const slots = [];
  for (let r = 0; r < 4; r++) {
    const sel = h('select', { 'aria-label': `Destination ${r + 1}` }, optionList(MACRO_DESTS, true));
    const start = h('input', { type: 'number', min: 0, max: 127, 'aria-label': 'Start' });
    const end = h('input', { type: 'number', min: 0, max: 127, 'aria-label': 'End' });
    const depth = h('input', { type: 'range', min: 0, max: 127, class: 'depth', 'aria-label': 'Depth' });
    const out = h('output', { class: 'depth-out' });
    const addr = (f) => macroAddr(S.macro, r, f);
    sel.addEventListener('change', () => {
      const was = S.bytes[addr(0)];
      checkpoint(null);
      S.bytes[addr(0)] = +sel.value;
      // A fresh destination starts with a useful depth; clearing one resets the row.
      if (+sel.value && !was && S.bytes[addr(3)] === 64) S.bytes[addr(3)] = 96;
      if (!+sel.value) { S.bytes[addr(1)] = 0; S.bytes[addr(2)] = 127; S.bytes[addr(3)] = 64; }
      changed(null);
    });
    start.addEventListener('change', () => setByte(addr(1), clamp(+start.value || 0, 0, 127)));
    end.addEventListener('change', () => setByte(addr(2), clamp(+end.value || 0, 0, 127)));
    depth.addEventListener('input', () => setByte(addr(3), +depth.value));
    depth.addEventListener('dblclick', () => setByte(addr(3), 64));
    const range = svg('path', { class: 'g-line' });
    const mark = svg('circle', { class: 'm-mark', r: 3 });
    const viz = svg('svg', { viewBox: '0 0 100 40', class: 'macro-viz', preserveAspectRatio: 'none' }, range, mark);
    slots.push({ sel, start, end, depth, out, range, mark });
    rows.append(h('div', { class: 'macro-slot' }, sel,
      h('div', { class: 'cols' }, h('div', { class: 'fields' }, h('label', {}, 'Start ', start), h('label', {}, 'End ', end)), viz),
      h('span', { class: 'depthwrap' }, depth, out), h('p', { class: 'eyebrow center', text: 'Depth' })));
  }
  const paintMacro = () => {
    title.textContent = `Selected: Macro ${S.macro + 1}`;
    const pos = S.bytes[macroPosAddr(S.macro)];
    macroRows(S.bytes, S.macro).forEach((row, r) => {
      const s = slots[r];
      s.sel.value = row.dest;
      s.start.value = row.start;
      s.end.value = row.end;
      s.depth.value = row.depth + 64;
      s.out.textContent = FMT.bi(row.depth + 64);
      s.depth.style.setProperty('--fill', `${(Math.min(row.depth + 64, 64) / 127) * 100}%`);
      s.depth.style.setProperty('--fill-end', `${(Math.max(row.depth + 64, 64) / 127) * 100}%`);
      s.depth.classList.toggle('zero', row.depth === 0);
      const x0 = (row.start / 127) * 100;
      const x1 = (row.end / 127) * 100;
      const y1 = 20 - (row.depth / 64) * 17;
      s.range.setAttribute('d', `M0 20L${x0} 20L${Math.max(x0, x1)} ${row.end > row.start ? y1 : 20}L100 ${row.end > row.start ? y1 : 20}`);
      const t = row.end > row.start ? clamp((pos - row.start) / (row.end - row.start), 0, 1) : 0;
      s.mark.setAttribute('cx', (pos / 127) * 100);
      s.mark.setAttribute('cy', 20 - (row.depth / 64) * 17 * t);
    });
  };
  always.push(paintMacro);
  S.paintMacro = paintMacro;

  // Mod matrix: 20 routings.
  const table = h('div', { class: 'matrix' },
    h('div', { class: 'mrow head' }, h('span', {}), h('span', { text: 'Source 1' }), h('span', { text: 'Source 2' }), h('span', { text: 'Depth' }), h('span', { text: 'Destination' })));
  for (let s = 0; s < MOD_SLOTS; s++) {
    const row = h('div', { class: 'mrow' }, h('span', { class: 'mnum', text: s + 1 }),
      picker(modAddr(s, 0), MOD_SOURCES, { groups: true, label: `Slot ${s + 1} source 1` }),
      picker(modAddr(s, 1), MOD_SOURCES, { groups: true, label: `Slot ${s + 1} source 2` }),
      depthSlider(modAddr(s, 2), `Slot ${s + 1} depth`),
      picker(modAddr(s, 3), MOD_DESTS, { groups: true, label: `Slot ${s + 1} destination` }));
    watch(modAddr(s, 2), () => row.classList.toggle('live', S.bytes[modAddr(s, 2)] !== 64));
    table.append(row);
  }
  $('#page-mod').append(macroPanel, panel('Mod matrix', 'matrix-panel',
    h('p', { class: 'hint', text: 'Each row sends Source 1 × Source 2 to a destination. Leave a source on Direct to ignore it. A row with zero depth does nothing. Macros can also move a row\'s depth.' }), table));
}

// Macro strip (shown on every page): knob positions are stored in the patch.
function buildMacros() {
  const row = $('#macro-row');
  for (let k = 0; k < 8; k++) {
    const caption = h('span', { class: 'm-cap' });
    const kn = knob({ addr: macroPosAddr(k), lo: 0, hi: 127, def: 0, label: String(k + 1), aria: `Macro ${k + 1}` });
    const cell = h('div', { class: 'macro', title: `Macro ${k + 1}: click to choose what it controls` }, kn, caption);
    cell.addEventListener('pointerdown', () => { if (S.macro !== k) { S.macro = k; paintMacroSel(); S.paintMacro?.(); } });
    caption.addEventListener('click', () => showPage('mod'));
    always.push(() => {
      const live = macroRows(S.bytes, k).filter((r) => r.dest && r.depth);
      caption.textContent = live.length ? `${MACRO_DESTS[live[0].dest]?.label ?? '?'}${live.length > 1 ? ` +${live.length - 1}` : ''}` : 'Not assigned';
      cell.classList.toggle('unused', !live.length);
    });
    row.append(cell);
  }
}
function paintMacroSel() { [...$('#macro-row').children].forEach((c, k) => c.classList.toggle('sel', k === S.macro)); }

function showPage(page) {
  for (const p of ['main', 'fx', 'mod']) $(`#page-${p}`).hidden = p !== page;
  document.querySelectorAll('.tabs [role=tab]').forEach((t) => t.setAttribute('aria-selected', t.dataset.page === page));
}

// ------------------------------------------------------------------ pack list and patch bar
function paintList() {
  const list = $('#patchlist');
  const q = $('#search').value.trim().toLowerCase();
  const filter = $('#filter').value;
  list.textContent = '';
  for (let i = 0; i < PATCH_SLOTS; i++) {
    const b = S.pack.patches[i];
    const name = b ? getName(b) : 'Initial Patch';
    const edited = slotEdited(S.pack, i);
    if (q && !name.toLowerCase().includes(q) && !pad3(i + 1).includes(q)) continue;
    if (filter === 'edited' && !edited) continue;
    if (filter.startsWith('c') && (b?.[P.category.a] ?? 0) !== +filter.slice(1)) continue;
    const li = h('li', { class: `${i === S.slot ? 'sel' : ''}${b ? '' : ' empty'}${edited ? ' edited' : ''}`, 'data-slot': i, tabindex: 0, role: 'option', 'aria-selected': i === S.slot },
      h('span', { class: 'n', text: pad3(i + 1) }), h('span', { class: 'nm', text: name || '(no name)' }),
      h('span', { class: 'dot', title: 'Changed since the pack was opened' }));
    list.append(li);
  }
  if (!list.children.length) list.append(h('li', { class: 'none', text: 'No patches match.' }));
}
function paintSlot(i) {
  const li = $(`#patchlist li[data-slot="${i}"]`);
  if (!li) return;
  li.querySelector('.nm').textContent = getName(S.pack.patches[i]) || '(no name)';
  li.classList.toggle('edited', slotEdited(S.pack, i));
  li.classList.remove('empty');
}
function paintBar() {
  $('#slot-no').textContent = pad3(S.slot + 1);
  if (document.activeElement !== $('#patch-name')) $('#patch-name').value = getName(S.bytes);
  $('#category').value = S.bytes[P.category.a];
  $('#genre').value = S.bytes[P.genre.a];
  const u = hist();
  $('#undo').disabled = !u.past.length;
  $('#redo').disabled = !u.future.length;
  $('#compare').hidden = !(S.pack.original[S.slot] && slotEdited(S.pack, S.slot));
  paintPack();
}
function paintPack() {
  const n = editedSlots(S.pack).length;
  $('#pack-info').textContent = `128 patches · ${S.pack.samples} samples · ${S.pack.projects} projects${n ? ` · ${n} patch${n > 1 ? 'es' : ''} changed` : ''}`;
  if (document.activeElement !== $('#pack-name')) $('#pack-name').value = S.pack.name;
}

// ------------------------------------------------------------------ dialogs, toasts
let toastTimer = null;
function toast(msg, ms = 3200) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}
function ask(title, body, ok = 'OK') {
  const dlg = $('#dlg');
  $('#dlg-title').textContent = title;
  $('#dlg-body').replaceChildren(...[].concat(body).map((b) => (typeof b === 'string' ? h('p', { text: b }) : b)));
  $('#dlg-ok').textContent = ok;
  dlg.returnValue = 'cancel';
  dlg.showModal();
  return new Promise((resolve) => dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true }));
}
function slotSelect(selected) {
  return h('select', { class: 'wide' }, Array.from({ length: PATCH_SLOTS }, (_, i) =>
    h('option', { value: i, selected: i === selected, text: `${pad3(i + 1)}  ${S.pack.patches[i] ? getName(S.pack.patches[i]) : 'Initial Patch (empty)'}` })));
}

// ------------------------------------------------------------------ files
async function loadPackBuffer(buffer, fileName, { remember = true, edits = null } = {}) {
  const pack = await openPack(buffer, fileName);
  panic();
  S.pack = pack;
  S.undo.clear();
  if (edits) {
    for (const [slot, data] of Object.entries(edits.patches ?? {})) if (data?.length === PATCH_SIZE) pack.patches[+slot] = sanitise(new Uint8Array(data));
    if (typeof edits.name === 'string') pack.name = edits.name;
  }
  if (remember) { await session.savePack(buffer, fileName); await session.saveEdits(null); }
  selectSlot(edits?.slot ?? 0, { send: false });
  paintPack();
}

function saveSession() {
  if (!S.pack) return;
  const patches = {};
  for (const i of editedSlots(S.pack)) if (S.pack.patches[i]) patches[i] = S.pack.patches[i].slice();
  session.saveEdits({ patches, name: S.pack.name, slot: S.slot });
}

// The default pack is fetched each visit, so only edits to it are stored (not the pack file).
async function loadDefault(edits = null) {
  const res = await fetch(DEFAULT_PACK);
  if (!res.ok) throw new Error(`The TracksGM pack could not be loaded (${res.status}).`);
  if (!edits) await session.clear();
  await loadPackBuffer(await res.arrayBuffer(), 'TracksGM_final.circuittrackspack', { remember: false, edits });
}

async function openPackFile(file) {
  try {
    if (editedSlots(S.pack).length && !(await ask('Open another pack?', `You have changed ${editedSlots(S.pack).length} patch(es) in "${S.pack.name}". Opening another pack replaces them. Download the pack first if you want to keep them.`, 'Open pack'))) return;
    await loadPackBuffer(await file.arrayBuffer(), file.name);
    toast(`Opened "${S.pack.name || file.name}".`);
  } catch (e) { toast(e.message, 6000); }
}

async function savePack() {
  const follow = projectsFollowing(S.pack);
  const sync = h('input', { type: 'checkbox', checked: true });
  const body = [`Downloads "${S.pack.name || 'pack'}" with your patch edits. Samples and projects are copied unchanged. Load it onto the Circuit Tracks with Novation Components.`];
  if (follow) body.push(h('label', { class: 'check' }, sync, ` Also update ${follow} project patch cop${follow > 1 ? 'ies' : 'y'}. Projects keep their own copy of each patch; this updates the ones that still matched the pack.`));
  if (!(await ask('Download pack', body, 'Download'))) return;
  const { blob } = await buildPack(S.pack, { name: S.pack.name, syncProjects: sync.checked });
  download(blob, `${fileSafe(S.pack.name || 'Pack')}.circuittrackspack`, 'application/zip');
}

// Bring patches from a .syx file or the hardware into pack slots (the user picks where).
async function importPatches(patches, source) {
  if (!patches.length) { toast('No Circuit Tracks patch was found in that file.', 5000); return; }
  const sel = slotSelect(S.slot);
  const many = patches.length > 1;
  const names = patches.slice(0, 6).map((p) => getName(p.data)).join(', ') + (patches.length > 6 ? '…' : '');
  const fit = () => Math.min(patches.length, PATCH_SLOTS - +sel.value);
  const note = h('p', { class: 'hint' });
  const paintNote = () => { note.textContent = many ? `${fit()} patch(es) will replace slots ${pad3(+sel.value + 1)} to ${pad3(+sel.value + fit())}. You can undo each slot.` : 'This replaces the patch in that slot. Undo brings it back.'; };
  sel.addEventListener('change', paintNote);
  paintNote();
  const ok = await ask(many ? `Load ${patches.length} patches` : `Load "${getName(patches[0].data)}"`,
    [`From ${source}: ${names}`, h('label', { class: 'field' }, many ? 'Starting at slot ' : 'Into slot ', sel), note], 'Load');
  if (!ok) return;
  const first = +sel.value;
  const count = fit();
  for (let k = count - 1; k >= 0; k--) {
    S.slot = first + k;
    if (!S.pack.patches[S.slot]) S.pack.patches[S.slot] = initPatch();
    S.bytes = S.pack.patches[S.slot];
    checkpoint(null);
    S.bytes.set(patches[k].data);
  }
  selectSlot(first);
  toast(many ? `Loaded ${count} patches from ${source}.` : `Loaded "${getName(S.bytes)}" into slot ${pad3(first + 1)}.`);
}

async function openSyxFiles(files) {
  const patches = [];
  for (const f of files) patches.push(...parseSyx(new Uint8Array(await f.arrayBuffer())));
  await importPatches(patches, files.length > 1 ? `${files.length} files` : files[0].name);
}

async function patchAction(act) {
  if (act === 'open-syx') $('#file-syx').click();
  else if (act === 'save-syx') download(toSyx(S.bytes), `${fileSafe(getName(S.bytes))}.syx`);
  else if (act === 'init') { checkpoint(null); replacePatch(initPatch(), 'Initial Patch loaded. Undo brings the old patch back.'); } else if (act === 'revert') {
    const orig = S.pack.original[S.slot];
    checkpoint(null);
    replacePatch(orig ?? initPatch(), 'Reverted to how the pack had it.');
  } else if (act === 'copy') {
    const sel = slotSelect(Math.min(S.slot + 1, PATCH_SLOTS - 1));
    if (!(await ask(`Copy "${getName(S.bytes)}"`, [h('label', { class: 'field' }, 'To slot ', sel), h('p', { class: 'hint', text: 'This replaces the patch in that slot. Undo brings it back.' })], 'Copy'))) return;
    const src = S.bytes.slice();
    selectSlot(+sel.value, { send: false });
    checkpoint(null);
    replacePatch(src, `Copied to slot ${pad3(S.slot + 1)}.`);
  }
}

// ------------------------------------------------------------------ Circuit Tracks link
function paintLink() {
  const on = link.connected;
  $('#link-led').classList.toggle('on', on);
  $('#link-text').textContent = on ? `${link.out.name} linked` : link.error ?? (link.access ? 'No Circuit Tracks found: plug it in by USB' : 'Circuit Tracks not linked');
  $('#link-btn').hidden = on;
  $('#link-btn').textContent = link.access ? 'Look again' : 'Link Circuit Tracks';
  $('#hw').hidden = !on;
  $('#hw-get').disabled = !link.in;
  for (const b of document.querySelectorAll('#hear button')) if (b.dataset.hear !== 'browser') { b.disabled = !on; b.title = on ? '' : 'Link a Circuit Tracks first'; }
  if (!on && S.hear !== 'browser') setHear('browser');
}
function setHear(mode) {
  panic();
  S.hear = mode;
  for (const b of document.querySelectorAll('#hear button')) b.classList.toggle('on', b.dataset.hear === mode);
}
let wasLinked = false;
link.addEventListener('change', () => {
  paintLink();
  if (link.connected && !wasLinked) {
    setHear('tracks');
    if ($('#hw-live').checked) link.sendPatch(S.bytes, S.synth);
    toast(`Linked to ${link.out.name}. Edits now go to Synth ${S.synth + 1}; notes play on the Circuit Tracks.`, 5000);
  }
  wasLinked = link.connected;
});
link.onMacro = (k, value, ch) => { if (ch === S.synth && S.bytes[macroPosAddr(k)] !== value) { S.bytes[macroPosAddr(k)] = value; synth?.refresh(); repaint(macroPosAddr(k)); } };
link.onNote = (on, note, vel) => (on ? noteOn(note, vel) : noteOff(note));
link.onPatch = (bytes) => importPatches([{ data: bytes }], 'the Circuit Tracks');

// ------------------------------------------------------------------ keyboard and loop
const KEY_ROW = 'awsedftgyhujkolp;';
const BLACK = new Set([1, 3, 6, 8, 10]);
function buildKeys() {
  const keys = $('#keys');
  keys.textContent = '';
  const lo = S.octave * 12 + 12;
  for (let n = lo; n < lo + 37; n++) {
    const pc = n % 12;
    const key = h('button', { type: 'button', class: `key${BLACK.has(pc) ? ' black' : ''}`, 'data-note': n, tabindex: -1, 'aria-label': `Note ${n}` });
    const k = n - lo;
    if (k < KEY_ROW.length) key.append(h('span', { text: KEY_ROW[k].toUpperCase() }));
    if (pc === 0) key.append(h('i', { text: `C${Math.floor(n / 12) - 1}` }));
    keys.append(key);
  }
  $('#oct').textContent = `C${S.octave}`;
  paintKeys();
}
function paintKeys() { for (const k of $('#keys').children) k.classList.toggle('down', S.held.has(+k.dataset.note)); }
function setOctave(o) { panic(); S.octave = clamp(o, 0, 6); buildKeys(); }

function bindKeys() {
  const keys = $('#keys');
  let mouse = null;
  const at = (e) => { const el = document.elementFromPoint(e.clientX, e.clientY); return el?.closest?.('.key') ? +el.closest('.key').dataset.note : null; };
  keys.addEventListener('pointerdown', (e) => { const n = at(e); if (n == null) return; keys.setPointerCapture(e.pointerId); mouse = n; noteOn(n); e.preventDefault(); });
  keys.addEventListener('pointermove', (e) => { if (mouse == null) return; const n = at(e); if (n != null && n !== mouse) { noteOff(mouse); mouse = n; noteOn(n); } });
  const up = () => { if (mouse != null) noteOff(mouse); mouse = null; };
  keys.addEventListener('pointerup', up);
  keys.addEventListener('pointercancel', up);

  const typing = (e) => /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) && e.target.type !== 'checkbox' && e.target.type !== 'range';
  const down = new Map();
  window.addEventListener('keydown', (e) => {
    if ($('#dlg').open) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); (e.shiftKey ? redo : undo)(); return; }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (e.metaKey || e.ctrlKey || e.altKey || typing(e)) return;
    const key = e.key.toLowerCase();
    if (key === ' ' && e.target.tagName !== 'BUTTON') { e.preventDefault(); toggleLoop(); return; }
    if (key === 'escape') { panic(); stopLoop(); return; }
    if (e.repeat) return;
    if (key === 'z') return setOctave(S.octave - 1);
    if (key === 'x') return setOctave(S.octave + 1);
    const i = KEY_ROW.indexOf(key);
    if (i < 0) return;
    const n = S.octave * 12 + 12 + i;
    down.set(key, n);
    noteOn(n);
  });
  window.addEventListener('keyup', (e) => { const key = e.key.toLowerCase(); if (down.has(key)) { noteOff(down.get(key)); down.delete(key); } });
  window.addEventListener('blur', () => { for (const n of down.values()) noteOff(n); down.clear(); });
}

// A short phrase that repeats while you edit. Steps are 16th notes; [offset from C, length in steps].
const LOOPS = {
  bass: { base: -12, steps: [[0, 1], null, [0, 1], [12, 1], null, [0, 1], [10, 1], null, [0, 1], null, [7, 1], [0, 1], null, [3, 1], [5, 1], [7, 1]] },
  arp: { base: 0, steps: [[0, 1], [3, 1], [7, 1], [12, 1], [15, 1], [12, 1], [7, 1], [3, 1], [-2, 1], [2, 1], [5, 1], [10, 1], [14, 1], [10, 1], [5, 1], [2, 1]] },
  chord: { base: 0, steps: [[[0, 3, 7, 10], 6], null, null, null, null, null, null, null, [[-2, 2, 5, 10], 6], null, null, null, null, null, null, null] },
  note: { base: 0, steps: [[0, 14], null, null, null, null, null, null, null, null, null, null, null, null, null, null, null] },
};
let loopTimer = null;
let loopStep = 0;
let loopNotes = [];
function stopLoop() {
  clearInterval(loopTimer);
  loopTimer = null;
  for (const t of loopNotes) clearTimeout(t.timer);
  for (const t of loopNotes) noteOff(t.note, true);
  loopNotes = [];
  $('#loop').textContent = '▶';
  $('#loop').classList.remove('on');
}
function toggleLoop() {
  if (loopTimer) return stopLoop();
  audio();
  loopStep = 0;
  const tick = () => {
    const pat = LOOPS[$('#loop-kind').value];
    const stepMs = 60000 / (+$('#bpm').value || 120) / 4;
    const st = pat.steps[loopStep % pat.steps.length];
    loopStep++;
    if (!st) return;
    for (const off of [].concat(st[0])) {
      const note = S.octave * 12 + 24 + pat.base + off;
      noteOn(note);
      const entry = { note, timer: setTimeout(() => { noteOff(note, true); loopNotes = loopNotes.filter((x) => x !== entry); }, stepMs * st[1] * 0.85) };
      loopNotes.push(entry);
    }
  };
  tick();
  loopTimer = setInterval(tick, 60000 / (+$('#bpm').value || 120) / 4);
  $('#loop').textContent = '■';
  $('#loop').classList.add('on');
}

function drawScope() {
  const cv = $('#scope');
  const g = cv.getContext('2d');
  const buf = new Float32Array(1024);
  const frame = () => {
    requestAnimationFrame(frame);
    if (!synth || document.hidden) return;
    synth.analyser.getFloatTimeDomainData(buf);
    g.clearRect(0, 0, cv.width, cv.height);
    // Start at a rising zero crossing so the picture holds still.
    let s = 0;
    for (let i = 1; i < 500; i++) if (buf[i - 1] < 0 && buf[i] >= 0) { s = i; break; }
    g.beginPath();
    for (let x = 0; x < cv.width; x++) {
      const y = cv.height / 2 - buf[s + Math.floor((x / cv.width) * 500)] * cv.height * 0.9;
      if (x) g.lineTo(x, y); else g.moveTo(x, y);
    }
    g.strokeStyle = '#b9a8ff';
    g.lineWidth = 1.5;
    g.stroke();
  };
  frame();
}

// ------------------------------------------------------------------ wiring
function bindUI() {
  document.querySelectorAll('.tabs [role=tab]').forEach((t) => t.addEventListener('click', () => showPage(t.dataset.page)));

  $('#filter').append(h('option', { value: '', text: 'All patches' }), h('option', { value: 'edited', text: 'Changed' }),
    h('optgroup', { label: 'Category' }, CATEGORIES.map((c, i) => h('option', { value: `c${i}`, text: c }))));
  $('#search').addEventListener('input', paintList);
  $('#filter').addEventListener('change', paintList);
  const list = $('#patchlist');
  list.addEventListener('click', (e) => { const li = e.target.closest('li[data-slot]'); if (li) selectSlot(+li.dataset.slot); });
  list.addEventListener('keydown', (e) => {
    const li = e.target.closest('li[data-slot]');
    if (!li) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectSlot(+li.dataset.slot); $(`#patchlist li[data-slot="${S.slot}"]`)?.focus(); }
    const next = e.key === 'ArrowDown' ? li.nextElementSibling : e.key === 'ArrowUp' ? li.previousElementSibling : null;
    if (next?.dataset.slot) { e.preventDefault(); selectSlot(+next.dataset.slot); $(`#patchlist li[data-slot="${S.slot}"]`)?.focus(); }
  });

  $('#category').append(...CATEGORIES.map((c, i) => h('option', { value: i, text: c })));
  $('#genre').append(...GENRES.map((c, i) => h('option', { value: i, text: c })));
  $('#category').addEventListener('change', (e) => { setByte(P.category.a, +e.target.value); });
  $('#genre').addEventListener('change', (e) => setByte(P.genre.a, +e.target.value));
  $('#patch-name').addEventListener('input', (e) => {
    checkpoint('name');
    setName(S.bytes, e.target.value);
    changed(0);
  });
  $('#patch-name').addEventListener('blur', paintBar);
  $('#pack-name').addEventListener('input', (e) => { S.pack.name = e.target.value.slice(0, 16); clearTimeout(saveTimer); saveTimer = setTimeout(saveSession, 500); });
  $('#dlg-cancel').addEventListener('click', () => $('#dlg').close('cancel'));
  $('#undo').addEventListener('click', undo);
  $('#redo').addEventListener('click', redo);

  // Compare: while held, the synth (and the Tracks) play the slot as the pack had it.
  const cmp = $('#compare');
  let comparing = false;
  const startCmp = (e) => {
    const orig = S.pack.original[S.slot];
    if (!orig || comparing) return;
    comparing = true;
    cmp.classList.add('on');
    synth?.setPatch(orig);
    if (link.connected) link.sendPatch(orig, S.synth);
    e.preventDefault();
  };
  const endCmp = () => { if (!comparing) return; comparing = false; cmp.classList.remove('on'); synth?.setPatch(S.bytes); if (link.connected) link.sendPatch(S.bytes, S.synth); };
  cmp.addEventListener('pointerdown', startCmp);
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel', 'blur']) cmp.addEventListener(ev, endCmp);

  const menu = $('#patch-menu');
  const menuBtn = $('#patch-menu-btn');
  const closeMenu = () => { menu.hidden = true; menuBtn.setAttribute('aria-expanded', 'false'); };
  menuBtn.addEventListener('click', (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; menuBtn.setAttribute('aria-expanded', String(!menu.hidden)); });
  menu.addEventListener('click', (e) => { const act = e.target.dataset.act; if (act) { closeMenu(); patchAction(act); } });
  document.addEventListener('click', closeMenu);

  $('#pack-open').addEventListener('click', () => $('#file-pack').click());
  $('#file-pack').addEventListener('change', (e) => { if (e.target.files[0]) openPackFile(e.target.files[0]); e.target.value = ''; });
  $('#file-syx').addEventListener('change', (e) => { if (e.target.files.length) openSyxFiles([...e.target.files]); e.target.value = ''; });
  $('#pack-save').addEventListener('click', savePack);
  $('#pack-bank').addEventListener('click', () => download(bankSyx(S.pack), `${fileSafe(S.pack.name || 'Pack')} patches.syx`));
  $('#pack-reset').addEventListener('click', async () => {
    const n = editedSlots(S.pack).length;
    if (!(await ask('Load the TracksGM pack?', n ? `This replaces the pack you have open, including ${n} changed patch(es). Download the pack first if you want to keep them.` : 'This replaces the pack you have open.', 'Load TracksGM'))) return;
    try { await loadDefault(); toast('TracksGM loaded.'); } catch (e) { toast(e.message, 6000); }
  });

  // Files can also be dropped anywhere on the page.
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    const files = [...(e.dataTransfer?.files ?? [])];
    const pack = files.find((f) => /\.(circuittrackspack|zip)$/i.test(f.name));
    const syx = files.filter((f) => /\.syx$/i.test(f.name));
    if (pack) openPackFile(pack); else if (syx.length) openSyxFiles(syx); else if (files.length) toast('Drop a .circuittrackspack or .syx file.');
  });

  $('#link-btn').addEventListener('click', async () => { await link.connect(); paintLink(); });
  document.querySelectorAll('#hw [data-synth]').forEach((b) => b.addEventListener('click', () => {
    panic();
    S.synth = +b.dataset.synth;
    document.querySelectorAll('#hw [data-synth]').forEach((x) => x.classList.toggle('on', x === b));
    if ($('#hw-live').checked) link.sendPatch(S.bytes, S.synth);
  }));
  $('#hw-send').addEventListener('click', () => { if (link.sendPatch(S.bytes, S.synth)) toast(`Sent "${getName(S.bytes)}" to Synth ${S.synth + 1}.`); });
  $('#hw-get').addEventListener('click', async () => {
    try { await importPatches([{ data: await link.requestPatch(S.synth) }], `Synth ${S.synth + 1} on the Circuit Tracks`); } catch (e) { toast(e.message, 5000); }
  });
  $('#hw-store').addEventListener('click', async () => {
    const sel = slotSelect(S.slot);
    if (!(await ask('Store on the Circuit Tracks', [`Writes "${getName(S.bytes)}" into a patch slot on the Circuit Tracks itself, replacing the patch that is there now. This cannot be undone from here.`,
      h('label', { class: 'field' }, 'Circuit Tracks patch slot ', sel), h('p', { class: 'hint', text: 'The names listed are from the pack open here, which may not be the pack on your Circuit Tracks.' })], 'Store'))) return;
    if (link.writeSlot(S.bytes, +sel.value)) toast(`Stored in Circuit Tracks patch slot ${pad3(+sel.value + 1)}.`);
  });

  document.querySelectorAll('#hear button').forEach((b) => b.addEventListener('click', () => setHear(b.dataset.hear)));
  $('#oct-down').addEventListener('click', () => setOctave(S.octave - 1));
  $('#oct-up').addEventListener('click', () => setOctave(S.octave + 1));
  $('#vel').addEventListener('input', (e) => { S.velocity = +e.target.value; $('#vel-out').textContent = S.velocity; });
  $('#vol').addEventListener('input', (e) => synth?.setVolume(e.target.value / 100));
  $('#bpm').addEventListener('change', (e) => { if (synth) { synth.bpm = clamp(+e.target.value || 120, 40, 240); synth.refresh(); } if (loopTimer) { stopLoop(); toggleLoop(); } });
  $('#hold').addEventListener('change', (e) => { S.hold = e.target.checked; if (!S.hold) panic(); });
  $('#loop').addEventListener('click', toggleLoop);
  // Keyboard size (small / medium / large), remembered between visits.
  const setKeySize = (size) => {
    document.body.dataset.keys = size;
    document.querySelectorAll('#keysize button').forEach((b) => b.classList.toggle('on', b.dataset.size === size));
    try { localStorage.setItem('circuitgm-patchworker-keys', size); } catch { /* private mode */ }
  };
  document.querySelectorAll('#keysize button').forEach((b) => b.addEventListener('click', () => setKeySize(b.dataset.size)));
  let keySize = 'm';
  try { keySize = localStorage.getItem('circuitgm-patchworker-keys') || 'm'; } catch { /* private mode */ }
  setKeySize(/^[sml]$/.test(keySize) ? keySize : 'm');
  window.addEventListener('beforeunload', saveSession);
}

async function start() {
  buildMacros();
  buildMain();
  buildFx();
  buildMod();
  bindUI();
  bindKeys();
  buildKeys();
  paintMacroSel();
  paintLink();
  try {
    const saved = await session.load();
    if (saved?.buffer) await loadPackBuffer(saved.buffer, saved.fileName, { remember: false, edits: saved.edits });
    else await loadDefault(saved?.edits ?? null);
    const n = editedSlots(S.pack).length;
    if (saved?.buffer || n) toast(`Carried on from your last visit: "${S.pack.name}"${n ? `, ${n} changed patch${n > 1 ? 'es' : ''}` : ''}.`, 5000);
  } catch (e) {
    try { await loadDefault(); } catch (e2) { $('#pack-info').textContent = e2.message; return; }
  }
  // If the browser already allows MIDI for this page, link without being asked.
  try {
    const perm = await navigator.permissions?.query({ name: 'midi', sysex: true });
    if (perm?.state === 'granted') link.connect();
  } catch { /* the permission query is optional */ }
}

// Handy when testing from the console, and for the automated tests.
window.patchworker = { S, link, audio, selectSlot, setByte, toSyx, buildPack, undo, redo };
start();
