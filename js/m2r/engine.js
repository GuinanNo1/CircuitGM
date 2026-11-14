// MIDI2Rhythm: turning a General MIDI file into eight one-note-at-a-time lines for the
// Circuit Rhythm. See the plan in the project docs (plan-midi2rhythm.md).
//
// The Circuit Rhythm stores one note per step per track, but every step also carries its own
// sample slot and pitch. So the Rhythm is eight mono voices, each able to play any sample at
// any pitch on any step. This module:
//   1. labels each MIDI part: mono, mostly mono (only legato overlaps), chords, or drums;
//   2. turns chord parts into one line (Smart line by default, or top, bottom, root, guide
//      tones, arpeggio), or splits it into voices, one track each, when tracks are free;
//   3. octave-shifts each pitched line towards its sample's root note, and folds stray notes
//      an octave towards it (a single-note sample sounds wrong far from its root);
//   4. packs drum sounds that never hit on the same step onto shared tracks;
//   5. gives out the eight tracks: drums, bass, melody, then the rest by note count. Lines
//      that never play at the same time can share a track.
// The result feeds js/m2r/arrange.js.

export const TRACK_COUNT = 8;
export const INST_SLOTS = 112;                 // RhythmInstGM slots 1-112 keep their GM programs
export const KIT_FIRST = 112;                  // slots 113-128 hold the chosen drum kit

export const METHODS = {
  auto: 'Auto: split if tracks are free, else Smart line',
  smart: 'Smart line',
  top: 'Top note',
  bottom: 'Bottom note',
  root: 'Chord root',
  guide: 'Guide tones (3rd / 7th)',
  arp: 'Arpeggio',
  split2: 'Split into 2 voices',
  split3: 'Split into 3 voices',
  splitall: 'Split into all its voices',
};
export const MAX_SPLIT = 6;                    // voices one part can take
export const ADV_ONLY_METHODS = new Set(['arp']);

// GM programs 113-128 are replaced by the drum kit. The pitched percussion among them is
// played on the nearest instrument that stays; the sound effects have no stand-in.
const STAND_IN = { 112: 9, 113: 13, 114: 12, 115: 13, 116: 47, 117: 47, 118: 47 };

const NOTE_NAMES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
// "001 Grand Piano C4" -> 60
export function rootFromName(name) {
  const m = /([A-G])([#b]?)(-?\d)\s*$/.exec(name || '');
  if (!m) return 60;
  return 12 * (Number(m[3]) + 1) + NOTE_NAMES[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}

// The RhythmInstGM sample that plays a GM program, or null (sound effects 120-128).
export function sampleForProgram(program) {
  if (program < INST_SLOTS) return program;
  return STAND_IN[program] ?? null;
}

// Instruments with no clear pitch: they play at their own pitch and skip range fitting.
const UNPITCHED = new Set([55, 116, 117, 118, 119, 122, 123, 124, 125, 126, 127]);
export const isUnpitched = (slot) => UNPITCHED.has(slot);

// ---------------------------------------------------------------- part analysis

// Overlap analysis of a melodic part. Legato tails (the next note starts before the last one
// ends, by a little) are trimmed; whatever polyphony is left decides the label.
//   mono: never two notes at once; mostly: under 5% of the sounding time has two or more
//   after trimming tails, chords: the rest.
export function analysePart(src, ppq) {
  const notes = src.notes.map((n) => ({ ...n })).sort((a, b) => a.tick - b.tick || b.note - a.note);
  const raw = polyStats(notes);
  const trimmed = trimLegato(notes, ppq);
  const st = polyStats(trimmed);
  let kind;
  if (raw.maxPoly <= 1) kind = 'mono';
  else if (st.polyFrac <= 0.05) kind = 'mostly';
  else kind = 'chords';
  // Voices needed to play 98% of the notes with every note sounding (a rare big chord
  // shouldn't cost a whole track).
  const counts = trimmed.map((n) => trimmed.filter((x) => x.tick <= n.tick && x.tick + x.dur > n.tick).length).sort((x, y) => x - y);
  const voices = Math.max(1, counts[Math.floor(counts.length * 0.98)] ?? 1);
  return { kind, maxPoly: raw.maxPoly, avgPoly: st.avgPoly, polyFrac: st.polyFrac, voices, trimmed };
}

// Notes cut where they overlap the next note by a little: at most half a 1/16 step, or a
// quarter of the note, when the next note starts clearly later (not part of a chord).
function trimLegato(notes, ppq) {
  const out = notes.map((n) => ({ ...n }));
  const step = ppq / 4;
  for (let i = 0; i < out.length; i++) {
    const n = out[i];
    const end = n.tick + n.dur;
    for (let j = i + 1; j < out.length && out[j].tick < end; j++) {
      const m = out[j];
      if (m.tick - n.tick < step / 2) continue;               // starts with it: a chord
      const overlap = end - m.tick;
      if (overlap <= Math.max(step / 2, n.dur * 0.25)) { n.dur = m.tick - n.tick; break; }
    }
  }
  return out;
}

function polyStats(notes) {
  const ev = [];
  for (const n of notes) { ev.push([n.tick, 1]); ev.push([n.tick + Math.max(1, n.dur), -1]); }
  ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let cur = 0, last = 0, maxPoly = 0, sounding = 0, poly = 0, weighted = 0;
  for (const [t, d] of ev) {
    const span = t - last;
    if (cur >= 1) { sounding += span; weighted += span * cur; }
    if (cur >= 2) poly += span;
    cur += d; last = t;
    maxPoly = Math.max(maxPoly, cur);
  }
  return { maxPoly, polyFrac: sounding ? poly / sounding : 0, avgPoly: sounding ? weighted / sounding : 0 };
}

// A mono line from a mostly-mono part: tails trimmed, and any overlap left goes to the newer
// note (the older one stops where the next starts, as on a mono synth).
export function monoOf(notes) {
  const out = notes.map((n) => ({ tick: n.tick, dur: n.dur, note: n.note, vel: n.vel })).sort((a, b) => a.tick - b.tick || b.note - a.note);
  const res = [];
  for (const n of out) {
    const prev = res[res.length - 1];
    if (prev && prev.tick === n.tick) continue;               // same start: keep the higher
    if (prev && prev.tick + prev.dur > n.tick) prev.dur = n.tick - prev.tick;
    res.push(n);
  }
  return res;
}

// ---------------------------------------------------------------- chords

const TEMPLATES = [
  ['', [0, 4, 7]], ['m', [0, 3, 7]], ['dim', [0, 3, 6]], ['aug', [0, 4, 8]],
  ['7', [0, 4, 7, 10]], ['maj7', [0, 4, 7, 11]], ['m7', [0, 3, 7, 10]], ['m7b5', [0, 3, 6, 10]],
  ['6', [0, 4, 7, 9]], ['m6', [0, 3, 7, 9]], ['sus4', [0, 5, 7]], ['sus2', [0, 2, 7]], ['5', [0, 7]],
];

// The chord a set of pitches makes: { root (pc), third (pc|null), seventh (pc|null) }.
export function detectChord(pitches) {
  const pcs = new Set(pitches.map((p) => ((p % 12) + 12) % 12));
  if (!pcs.size) return null;
  const bass = ((Math.min(...pitches) % 12) + 12) % 12;
  let best = null;
  for (let r = 0; r < 12; r++) {
    for (const [name, iv] of TEMPLATES) {
      const t = new Set(iv.map((x) => (x + r) % 12));
      let match = 0;
      for (const x of t) if (pcs.has(x)) match++;
      const miss = t.size - match;
      let extra = 0;
      for (const x of pcs) if (!t.has(x)) extra++;
      const score = 2 * match - miss - extra + (r === bass ? 0.5 : 0) + iv.length * 0.01;
      if (!best || score > best.score) best = { score, root: r, name, iv };
    }
  }
  const third = best.iv.includes(4) ? (best.root + 4) % 12 : best.iv.includes(3) ? (best.root + 3) % 12 : null;
  const seventh = best.iv.includes(10) ? (best.root + 10) % 12 : best.iv.includes(11) ? (best.root + 11) % 12 : null;
  return { root: best.root, name: best.name, third, seventh };
}

// The moments where something starts: onsets within a 1/64 note count as one.
function onsetEvents(notes, ppq) {
  const tol = ppq / 16;
  const sorted = notes.slice().sort((a, b) => a.tick - b.tick);
  const ev = [];
  for (const n of sorted) {
    const last = ev[ev.length - 1];
    if (last && n.tick - last.tick <= tol) continue;
    ev.push({ tick: n.tick });
  }
  for (const e of ev) {
    e.sounding = sorted.filter((n) => n.tick <= e.tick + tol && n.tick + n.dur > e.tick + tol);
    e.sounding.sort((a, b) => b.note - a.note);            // highest first
  }
  return ev.filter((e) => e.sounding.length);
}

// One chosen note (object) per event -> a mono line. A note carried over from the previous
// event continues without a new attack.
function lineFromChoices(events, choices, pitchOf = (n) => n.note) {
  const out = [];
  let open = null, openSrc = null;
  events.forEach((e, i) => {
    const c = choices[i];
    if (open) open.dur = Math.min(open.dur, e.tick - open.tick);
    if (!c) { open = null; openSrc = null; return; }
    const p = pitchOf(c, i);
    if (openSrc === c && open && open.note === p && c.tick + c.dur > e.tick && open.tick + open.dur >= e.tick) {
      open.dur = c.tick + c.dur - open.tick;                 // carries on
      return;
    }
    open = { tick: e.tick, dur: Math.max(1, c.tick + c.dur - e.tick), note: p, vel: c.vel };
    openSrc = c;
    out.push(open);
  });
  return out.filter((n) => n.dur > 0);
}

// The song's bass at a tick (lowest note of any other part): Smart line avoids doubling it.
export function bassLookup(otherParts) {
  const all = otherParts.flatMap((p) => p.notes).sort((a, b) => a.tick - b.tick);
  return (tick) => {
    let lo = null;
    for (const n of all) {
      if (n.tick > tick) break;
      if (n.tick + n.dur > tick && (lo == null || n.note < lo)) lo = n.note;
    }
    return lo;
  };
}

// Reduce a chord part to one line (or several, for split).
//   ctx: { ppq, method, root (sample root after octave shift, as MIDI note), shift, range,
//          bassAt(tick) -> MIDI note | null, arpRate (quarters) }
export function reduce(notes, ctx) {
  const ev = onsetEvents(notes, ctx.ppq);
  switch (ctx.method) {
    case 'top': return [lineFromChoices(ev, ev.map((e) => e.sounding[0]))];
    case 'bottom': return [lineFromChoices(ev, ev.map((e) => e.sounding[e.sounding.length - 1]))];
    case 'root': return [rootLine(ev)];
    case 'guide': return [guideLine(ev, ctx)];
    case 'arp': return [arpLine(notes, ctx)];
    case 'split2': return splitVoices(notes, 2, ctx.ppq);
    case 'split3': return splitVoices(notes, 3, ctx.ppq);
    case 'splitall': return splitVoices(notes, ctx.voices ?? 2, ctx.ppq);
    default: return [smartLine(ev, ctx)];
  }
}

// Smart line: one note per event chosen by a path search (Viterbi) that keeps the total cost
// lowest. Costs: big leaps (voice-leading prefers steps), re-picking when a held note could
// carry on, quiet/short/buried notes (louder, longer, higher are preferred), doubling the
// song's bass, and distance from the sample's root (the sample sounds best near it).
export function smartLine(ev, ctx) {
  if (!ev.length) return [];
  const beat = ctx.ppq;
  const local = (e, n, rank) => {
    const k = e.sounding.length;
    const height = k > 1 ? 1 - rank / (k - 1) : 1;           // 1 = top note
    let c = -0.8 * (n.vel / 127) - 0.6 * Math.min(1, n.dur / beat) - 0.9 * height;
    if (Math.abs(n.tick - e.tick) <= ctx.ppq / 16) c -= 0.4; // starts now: a clear attack
    const bass = ctx.bassAt?.(e.tick);
    if (bass != null && k > 1 && (n.note - bass) % 12 === 0) c += 0.8;
    if (ctx.root != null && ctx.range) {
      const d = Math.abs(n.note + (ctx.shift || 0) - ctx.root);
      c += 0.04 * d + (d > ctx.range ? 1.5 : 0);
    }
    return c;
  };
  const leap = (a, b) => {
    const d = Math.abs(a - b);
    if (d === 0) return 0;
    if (d <= 2) return 0.4;
    if (d <= 4) return 0.8;
    if (d <= 7) return 1.6;
    if (d === 12) return 1.8;
    return 2.4 + (d - 7) * 0.25;
  };
  let prev = ev[0].sounding.map((n, r) => ({ cost: local(ev[0], n, r), back: -1 }));
  const table = [prev];
  for (let i = 1; i < ev.length; i++) {
    const e = ev[i], pe = ev[i - 1];
    const cur = e.sounding.map((n, r) => {
      const lc = local(e, n, r);
      let best = Infinity, back = 0;
      pe.sounding.forEach((m, j) => {
        let t = prev[j].cost + leap(m.note, n.note);
        if (m === n) t -= 1.2;                                  // carry the held note on
        if (t < best) { best = t; back = j; }
      });
      return { cost: best + lc, back };
    });
    table.push(cur);
    prev = cur;
  }
  let j = prev.reduce((bi, x, i) => (x.cost < prev[bi].cost ? i : bi), 0);
  const choices = new Array(ev.length);
  for (let i = ev.length - 1; i >= 0; i--) {
    choices[i] = ev[i].sounding[j];
    j = table[i][j].back;
  }
  return lineFromChoices(ev, choices);
}

function rootLine(ev) {
  const choices = ev.map((e) => e.sounding[e.sounding.length - 1]);
  // Pitch: the chord's root, at or just below the lowest note.
  return lineFromChoices(ev, choices, (n, i) => {
    const e = ev[i];
    if (e.sounding.length < 2) return n.note;
    const ch = detectChord(e.sounding.map((x) => x.note));
    return n.note - ((((n.note - ch.root) % 12) + 12) % 12);
  });
}

function guideLine(ev, ctx) {
  let last = null;
  const choices = ev.map((e) => {
    let pick;
    if (e.sounding.length < 2) pick = e.sounding[0];
    else {
      const ch = detectChord(e.sounding.map((n) => n.note));
      const pcs = [ch.third, ch.seventh].filter((x) => x != null);
      const cands = e.sounding.filter((n) => pcs.includes(((n.note % 12) + 12) % 12));
      const pool = cands.length ? cands : [e.sounding[0]];
      const target = last ?? (ctx.root != null ? ctx.root - (ctx.shift || 0) : pool[0].note);
      pick = pool.reduce((b, n) => (Math.abs(n.note - target) < Math.abs(b.note - target) ? n : b), pool[0]);
    }
    last = pick.note;
    return pick;
  });
  return lineFromChoices(ev, choices);
}

function arpLine(notes, ctx) {
  const rate = Math.max(1, Math.round(ctx.ppq * (ctx.arpRate || 0.25)));
  const sorted = notes.slice().sort((a, b) => a.tick - b.tick);
  if (!sorted.length) return [];
  const start = Math.floor(sorted[0].tick / rate) * rate;
  const end = Math.max(...sorted.map((n) => n.tick + n.dur));
  const out = [];
  let k = 0, lastSet = '';
  for (let t = start; t < end; t += rate) {
    const s = sorted.filter((n) => n.tick <= t + rate / 2 && n.tick + n.dur > t + rate / 2).sort((a, b) => a.note - b.note);
    if (!s.length) { lastSet = ''; continue; }
    const key = s.map((n) => n.note).join(',');
    if (key !== lastSet) { k = 0; lastSet = key; }
    if (s.length === 1) {
      const prev = out[out.length - 1];
      if (prev && prev.note === s[0].note && prev.tick + prev.dur >= t) { prev.dur += rate; continue; }
      out.push({ tick: t, dur: rate, note: s[0].note, vel: s[0].vel });
      continue;
    }
    const n = s[k % s.length];
    k++;
    out.push({ tick: t, dur: rate, note: n.note, vel: n.vel });
  }
  return out;
}

// Split a chord part into `voices` mono lines, one per track, top voice first. Voices stay
// put: a held note keeps sounding on its voice, and each new note goes to a free voice whose
// last note is nearest, without crossing the voices that are holding (voice-leading). When
// more notes start than voices are free, the top and bottom notes are kept and the quietest
// inner ones dropped (counted in `dropped`).
export function splitVoices(notes, voices, ppq) {
  const tol = ppq / 16;
  const sorted = notes.map((n) => ({ ...n })).sort((a, b) => a.tick - b.tick || b.note - a.note);
  const lanes = Array.from({ length: voices }, () => ({ cur: null, last: null, out: [] }));
  let dropped = 0;
  for (let i = 0; i < sorted.length;) {
    const t0 = sorted[i].tick;
    const group = [];
    while (i < sorted.length && sorted[i].tick - t0 <= tol) group.push(sorted[i++]);
    // voices whose note has ended are free
    for (const l of lanes) if (l.cur && l.cur.tick + l.cur.dur <= t0 + tol) l.cur = null;
    const free = lanes.map((l, k) => k).filter((k) => !lanes[k].cur);
    let incoming = group.sort((a, b) => b.note - a.note);
    if (incoming.length > free.length) {
      // keep the outer notes, then the loudest inner ones
      const keep = new Set([incoming[0], incoming[incoming.length - 1]]);
      for (const n of incoming.slice(1, -1).sort((a, b) => b.vel - a.vel)) if (keep.size < free.length) keep.add(n);
      const kept = incoming.filter((n) => keep.has(n)).slice(0, free.length);
      dropped += incoming.length - kept.length;
      incoming = kept;
    }
    if (!incoming.length) continue;
    // Best order-keeping assignment of incoming notes (high to low) to free voices (top to
    // bottom): cost = distance to the voice's last note, plus crossing a holding voice.
    const held = lanes.map((l, k) => (l.cur ? { k, p: l.cur.note } : null)).filter(Boolean);
    const cost = (n, k) => {
      const l = lanes[k];
      let c = l.last == null ? 3 : Math.abs(n.note - l.last) * 0.5;
      for (const h of held) if ((h.k < k && n.note > h.p) || (h.k > k && n.note < h.p)) c += 6;
      return c;
    };
    const N = incoming.length, M = free.length;
    const dp = Array.from({ length: N + 1 }, () => new Array(M + 1).fill(Infinity));
    for (let j = 0; j <= M; j++) dp[0][j] = 0;
    for (let a = 1; a <= N; a++) for (let j = a; j <= M; j++) {
      dp[a][j] = Math.min(dp[a][j - 1], dp[a - 1][j - 1] + cost(incoming[a - 1], free[j - 1]));
    }
    for (let a = N, j = M; a > 0; j--) {
      if (dp[a][j] === dp[a][j - 1] && j > a) continue;
      const l = lanes[free[j - 1]];
      const n = incoming[a - 1];
      const prev = l.out[l.out.length - 1];
      if (prev && prev.tick + prev.dur > n.tick) prev.dur = Math.max(1, n.tick - prev.tick);
      const o = { tick: n.tick, dur: n.dur, note: n.note, vel: n.vel };
      l.out.push(o);
      l.cur = o;
      l.last = n.note;
      a--;
    }
  }
  const lines = lanes.map((l) => l.out);
  lines.dropped = dropped;
  return lines;
}

// ---------------------------------------------------------------- range fitting

const median = (xs) => { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };

// Octave shift for a part: the one that leaves fewest notes outside the comfort range, then
// puts its pitch centre (duration-weighted median) nearest the sample's root, then the
// smallest shift. An octave bass line stays whole rather than being folded.
export function octaveShift(notes, root, range = 12) {
  if (!notes.length) return 0;
  const w = [];
  for (const n of notes) { const k = Math.max(1, Math.round(n.dur / 30)); for (let i = 0; i < Math.min(k, 64); i++) w.push(n.note); }
  const mid = median(w);
  let best = 0, bestCost = Infinity;
  for (let s = -48; s <= 48; s += 12) {
    let out = 0;
    for (const n of notes) if (Math.abs(n.note + s - root) > range) out++;
    const cost = (out / notes.length) * 100 + Math.abs(mid + s - root) / 12 + Math.abs(s) / 12 * 0.3;
    if (cost < bestCost) { bestCost = cost; best = s; }
  }
  return best;
}

// Apply the shift; fold notes still outside the comfort range an octave (or more) towards the
// root. Returns { notes, folded, outside }.
export function fitRange(line, root, shift, range) {
  let folded = 0, outside = 0;
  const notes = line.map((n) => {
    let p = n.note + shift;
    if (range) {
      let moved = false;
      while (p - root > range && p - 12 >= 0) { p -= 12; moved = true; }
      while (root - p > range && p + 12 <= 127) { p += 12; moved = true; }
      if (moved) folded++;
      if (Math.abs(p - root) > range) outside++;
    }
    return { ...n, note: p };
  });
  return { notes, folded, outside };
}

// ---------------------------------------------------------------- drums

// GM drum note -> category, for finding a stand-in sound in the kit.
export function drumCategory(note) {
  if (note === 35 || note === 36) return 'kick';
  if (note === 38 || note === 40) return 'snare';
  if (note === 37 || note === 39) return 'rimclap';
  if (note === 42 || note === 44) return 'ch';
  if (note === 46) return 'oh';
  if ([41, 43, 45, 47, 48, 50].includes(note)) return 'tom';
  if ([49, 51, 52, 53, 55, 57, 59].includes(note)) return 'cymbal';
  return 'perc';
}
const CAT_ORDER = ['kick', 'snare', 'ch', 'oh', 'rimclap', 'tom', 'cymbal', 'perc'];

// kit: 16 entries { slot (0-15 within the kit), name, note (the GM note it was taken from) }.
// Returns note -> kit index (0-15).
export function drumMap(kit) {
  const byNote = new Map(kit.map((k, i) => [k.note, i]));
  return (note) => {
    if (byNote.has(note)) return byNote.get(note);
    const cat = drumCategory(note);
    const same = kit.map((k, i) => ({ i, k })).filter(({ k }) => drumCategory(k.note) === cat);
    const pool = same.length ? same : kit.map((k, i) => ({ i, k })).filter(({ k }) => drumCategory(k.note) === 'perc');
    if (!pool.length) return 0;
    return pool.reduce((b, x) => (Math.abs(x.k.note - note) < Math.abs(b.k.note - note) ? x : b), pool[0]).i;
  };
}

// Drum hits -> lanes (one per kit sound) -> shared tracks. Lanes that never hit on the same
// 1/16 step share a track (each track plays one sound at a time; an open hat cut by the next
// closed hat is what a real hi-hat does anyway). maxTracks: lanes that don't fit are merged
// into the track where they clash least, and their clashing hits are dropped.
export function packDrums(hits, kit, ppq, maxTracks = 3) {
  const map = drumMap(kit);
  const step = ppq / 4;
  const lanes = new Map();
  for (const h of hits) {
    const k = map(h.note);
    if (!lanes.has(k)) lanes.set(k, { kitIndex: k, cat: drumCategory(kit[k].note), name: kit[k].name, hits: [] });
    lanes.get(k).hits.push({ tick: h.tick, dur: h.dur, vel: h.vel, kitIndex: k, src: h.src });
  }
  const order = [...lanes.values()].sort((a, b) => CAT_ORDER.indexOf(a.cat) - CAT_ORDER.indexOf(b.cat) || b.hits.length - a.hits.length);
  const stepsOf = (lane) => new Set(lane.hits.map((h) => Math.round(h.tick / step)));
  const tracks = [];
  for (const lane of order) {
    const s = stepsOf(lane);
    let placed = false;
    for (const t of tracks) {
      let clash = 0;
      for (const x of s) if (t.steps.has(x)) clash++;
      if (clash === 0) { t.lanes.push(lane); for (const x of s) t.steps.add(x); placed = true; break; }
    }
    if (placed) continue;
    if (tracks.length < maxTracks) { tracks.push({ lanes: [lane], steps: new Set(s), dropped: 0 }); continue; }
    // Full: the track where it clashes least; the lane's clashing hits are dropped.
    let best = null, bestClash = Infinity;
    for (const t of tracks) {
      let clash = 0;
      for (const x of s) if (t.steps.has(x)) clash++;
      if (clash < bestClash) { bestClash = clash; best = t; }
    }
    const keep = lane.hits.filter((h) => !best.steps.has(Math.round(h.tick / step)));
    best.dropped += lane.hits.length - keep.length;
    best.lanes.push({ ...lane, hits: keep });
    for (const h of keep) best.steps.add(Math.round(h.tick / step));
  }
  return tracks.map((t) => ({
    label: t.lanes.map((l) => l.name.replace(/^\S+\s/, '')).join(' + '),
    lanes: t.lanes.map((l) => ({ kitIndex: l.kitIndex, name: l.name, hits: l.hits.length })),
    hits: t.lanes.flatMap((l) => l.hits).sort((a, b) => a.tick - b.tick),
    dropped: t.dropped,
    cat: t.lanes[0].cat,
  }));
}

// ---------------------------------------------------------------- the whole plan

// midi: from js/midifile.js. samples: RhythmInstGM sample names (128). kit: 16 kit entries.
// opts: {
//   parts: Map(sourceId -> { on: bool, method?: key, sample?: slot }),
//   range: 7 | 12 | 18 | 0 (off: no octave shift, no folding),
//   maxDrumTracks: 2 | 3 | 4, arpRate: quarters, share: true (lines that never overlap share)
// }
// Returns { parts: [...per source report], tracks: [8 or fewer], dropped: [...], kitSlots }
//   autoSplit: true — chord parts left on "Auto" are split into all their voices, busiest
//   first, while that fits in the free tracks without pushing another part out.
export function planTracks(midi, samples, kit, opts = {}) {
  const o = { range: 12, maxDrumTracks: 3, arpRate: 0.25, share: true, autoSplit: true, parts: new Map(), ...opts };
  let res = planCore(midi, samples, kit, o, new Map());
  if (!o.autoSplit) return res;
  const cands = res.parts.filter((r) => r.on && r.kind === 'chords' && r.method === 'smart' && r.auto && r.voices >= 2)
    .sort((a, b) => b.notes - a.notes);
  const split = new Map();          // part id -> voices
  for (const c of cands) {
    const free = TRACK_COUNT - res.tracks.length;
    if (free <= 0) break;
    // all its voices if they fit, otherwise as many as the free tracks allow (at least 2)
    for (let v = Math.min(c.voices, free + 1); v >= 2; v--) {
      const trial = planCore(midi, samples, kit, o, new Map([...split, [c.id, v]]));
      if (trial.tracks.length <= TRACK_COUNT && trial.dropped.length <= res.dropped.length) { split.set(c.id, v); res = trial; break; }
    }
  }
  return res;
}

function planCore(midi, samples, kit, o, splitSet) {
  const ppq = midi.ppq;
  const roots = samples.map((s) => rootFromName(s));
  const reports = [];
  const melodic = midi.sources.filter((s) => !s.isDrum);
  const drums = midi.sources.filter((s) => s.isDrum);

  // 1. analyse every part (excluded ones too, so the table can show them)
  const analysed = new Map();
  for (const s of melodic) analysed.set(s.id, analysePart(s, ppq));

  // Bass lookup for Smart line: each part sees the other included parts.
  const included = (s) => o.parts.get(s.id)?.on !== false;

  // 2-3. lines per melodic part
  const lines = [];
  for (const s of melodic) {
    const a = analysed.get(s.id);
    const cfg = o.parts.get(s.id) ?? {};
    const sample = cfg.sample ?? sampleForProgram(s.program ?? 0);
    const rep = {
      id: s.id, name: s.name, instrument: s.instrument, program: s.program ?? 0, notes: s.notes.length,
      kind: a.kind, maxPoly: a.maxPoly, avgPoly: a.avgPoly, voices: Math.min(MAX_SPLIT, a.voices), isDrum: false, auto: false, chordDropped: 0,
      on: included(s) && sample != null, sample, method: null, shift: 0, folded: 0, outside: 0, lines: 0,
      noSample: sample == null,
    };
    reports.push(rep);
    if (!rep.on) continue;
    const root = roots[sample];
    const pitched = !isUnpitched(sample);
    const shift = pitched && o.range ? octaveShift(a.trimmed, root, o.range) : 0;
    let raw;
    if (a.kind === 'chords') {
      const chosen = cfg.method ?? 'auto';
      rep.auto = chosen === 'auto';
      rep.method = rep.auto ? (splitSet.has(s.id) ? 'splitall' : 'smart') : chosen;
      if (rep.auto && splitSet.has(s.id)) rep.splitVoices = splitSet.get(s.id);
      const others = melodic.filter((x) => x !== s && included(x));
      raw = reduce(a.trimmed, { ppq, method: rep.method, root, shift, range: o.range, bassAt: bassLookup(others), arpRate: o.arpRate, voices: rep.splitVoices ?? rep.voices });
      rep.chordDropped = raw.dropped ?? 0;
    } else {
      raw = [monoOf(a.trimmed)];
    }
    raw.forEach((line, v) => {
      let notes = line;
      if (pitched) {
        const f = fitRange(line, root, shift, o.range);
        notes = f.notes;
        rep.folded += f.folded;
        rep.outside += f.outside;
      } else {
        notes = line.map((n) => ({ ...n, note: root }));        // unpitched: own pitch
      }
      rep.shift = shift;
      if (!notes.length) return;
      lines.push({
        kind: 'melodic', partId: s.id, voice: raw.length > 1 ? v + 1 : 0, voices: raw.length,
        label: raw.length > 1 ? `${s.name} (voice ${v + 1} of ${raw.length})` : s.name,
        program: s.program ?? 0,
        notes: notes.map((n) => ({ tick: n.tick, dur: n.dur, vel: n.vel, note: n.note, byte: clamp(72 + n.note - root, 0, 127), sample, part: s.id })),
        median: median(notes.map((n) => n.note)),
        mono: a.kind !== 'chords',
      });
    });
    rep.lines = raw.filter((l) => l.length).length;
  }

  // 4. drums
  const drumHits = [];
  for (const s of drums) {
    const cfg = o.parts.get(s.id) ?? {};
    reports.push({ id: s.id, name: s.name, instrument: 'Drums', notes: s.notes.length, kind: 'drums', isDrum: true, on: cfg.on !== false, lines: 0 });
    if (cfg.on !== false) drumHits.push(...s.notes.map((n) => ({ ...n, src: s.id })));
  }
  const drumTracks = drumHits.length ? packDrums(drumHits, kit, ppq, o.maxDrumTracks) : [];
  for (const r of reports) if (r.isDrum && r.on) r.lines = drumTracks.length;

  // 5. roles and priority
  // A split part offers its bottom voice as bass and its top voice as melody.
  const bassCand = lines.filter((l) => l.voice === 0 || l.voice === l.voices);
  const isBassProg = (p) => p >= 32 && p <= 39;
  const bass = bassCand.length
    ? bassCand.slice().sort((a, b) => (isBassProg(b.program) - isBassProg(a.program)) || a.median - b.median)[0]
    : null;
  // Melody: a mono, high, busy line, helped by its GM family and name (leads, solo
  // instruments and voices count for it; pads, ensembles and effects against).
  const family = (p) => (p >= 80 && p <= 87 ? 1.5 : p >= 56 && p <= 79 ? 1 : (p >= 48 && p <= 55) || (p >= 88 && p <= 95) ? -1.5 : p >= 96 ? -2 : 0);
  const named = (l) => (/lead|melod|vocal|voice|solo|sing/i.test(l.label) ? 2 : /pad|string|chord|comp|atmos|fx/i.test(l.label) ? -1 : 0);
  const melodyScore = (l) => (l.mono ? 2 : 0) + l.median / 24 + Math.log10(1 + l.notes.length) + family(l.program) + named(l);
  const melody = lines.filter((l) => l !== bass && l.voice <= 1).sort((a, b) => melodyScore(b) - melodyScore(a))[0] ?? null;
  if (bass) bass.role = 'Bass';
  if (melody) melody.role = 'Melody';
  const rest = lines.filter((l) => l !== bass && l !== melody).sort((a, b) => b.notes.length - a.notes.length);

  const queue = [
    ...drumTracks.map((d, i) => ({ kind: 'drum', label: d.label, role: i === 0 ? 'Drums' : 'Drums', notes: d.hits.map((h) => ({ tick: h.tick, dur: Math.max(1, Math.min(h.dur || ppq / 4, ppq / 4)), vel: h.vel, byte: 72, sample: KIT_FIRST + h.kitIndex, part: h.src })), drum: d })),
    ...[bass, melody].filter(Boolean),
    ...rest,
  ];

  // 6. tracks: each line on its own track, or (share) on a melodic track it never overlaps.
  const step = ppq / 4;
  const occupied = (l) => {
    const s = new Set();
    for (const n of l.notes) {
      const a = Math.round(n.tick / step), b = Math.max(a, Math.round((n.tick + n.dur) / step) - 1);
      for (let x = a; x <= b; x++) s.add(x);
    }
    return s;
  };
  const tracks = [];
  const dropped = [];
  for (const l of queue) {
    const occ = occupied(l);
    let home = null;
    if (o.share && l.kind === 'melodic') {
      home = tracks.find((t) => t.kind === 'melodic' && [...occ].every((x) => !t.occ.has(x)));
    }
    if (home) {
      home.lines.push(l);
      for (const x of occ) home.occ.add(x);
      continue;
    }
    if (tracks.length >= TRACK_COUNT) { dropped.push(l); continue; }
    tracks.push({ kind: l.kind, lines: [l], occ });
  }
  // Voices of a split part sit on adjacent tracks, top voice first, where the first of them
  // landed (track order doesn't change how anything plays).
  const splitOf = (t) => t.lines.find((l) => l.voices > 1);
  const ordered = [];
  const placed = new Set();
  for (const t of tracks) {
    if (placed.has(t)) continue;
    const sl = splitOf(t);
    const group = sl
      ? tracks.filter((x) => !placed.has(x) && x.lines.some((l) => l.partId === sl.partId && l.voices > 1))
        .sort((a, b) => Math.min(...a.lines.filter((l) => l.partId === sl.partId).map((l) => l.voice)) - Math.min(...b.lines.filter((l) => l.partId === sl.partId).map((l) => l.voice)))
      : [t];
    for (const x of group) { placed.add(x); ordered.push(x); }
  }
  tracks.splice(0, tracks.length, ...ordered);
  const out = tracks.map((t) => {
    const notes = t.lines.flatMap((l) => l.notes).sort((a, b) => a.tick - b.tick);
    const count = new Map();
    for (const n of notes) count.set(n.sample, (count.get(n.sample) ?? 0) + 1);
    const defaultSample = [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
    return {
      kind: t.kind,
      label: t.lines.map((l) => l.label).join(' / '),
      roles: t.lines.map((l) => l.role).filter(Boolean),
      parts: t.lines[0].drum ? [...new Set(t.lines[0].drum.hits.map((h) => h.src))] : t.lines.map((l) => l.partId).filter(Boolean),
      drum: t.lines[0].drum ?? null,
      notes,
      defaultSample,
    };
  });
  for (const r of reports) {
    r.dropped = dropped.filter((l) => l.partId === r.id).length;
    r.tracks = out.map((t, i) => (t.parts.includes(r.id) ? i : -1)).filter((i) => i >= 0);
    if (r.isDrum && r.on && !r.tracks.length) r.dropped = 1;
  }
  return { parts: reports, tracks: out, dropped: dropped.map((l) => ({ label: l.label, partId: l.partId, notes: l.notes.length })) };
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
