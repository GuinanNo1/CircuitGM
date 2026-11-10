// Circuit2MIDI: a Circuit Tracks or Circuit Rhythm project -> one song model -> timed hits ->
// MIDI events (and preview events). The reverse of js/convert.js + js/build.js.
import { GM_NAMES } from './midifile.js';
import { TRACKS } from './convert.js';

export const PPQ = 1440;
// Step length in ticks for each sync rate (0-7: 1/32T, 1/32, 1/16T, 1/16, 1/8T, 1/8, 1/4T, 1/4).
// 3, 5 and 7 are confirmed on hardware; the triplet values follow the same ladder.
export const STEP_TICKS = [120, 180, 240, 360, 480, 720, 960, 1440];
export const RATE_LABELS = ['1/32T', '1/32', '1/16T', '1/16', '1/8T', '1/8', '1/4T', '1/4'];
const stepTicks = (rate) => STEP_TICKS[rate] ?? 360;
const STORED_NOTE_OFFSET = 12;        // stored note = MIDI note + 12
const UNPITCHED = 60;                 // a sample step that hasn't been transposed (stored 72)
export const DIRECTIONS = ['forward', 'reverse', 'ping-pong', 'random'];

// ---------- Song model ----------

export function songOf(pack, entry) {
  const p = entry.project;
  const rhythm = pack.product === 'circuit-rhythm';
  const sampleName = (slot) => pack.samples[slot]?.name || `Sample ${slot + 1}`;
  const tracks = [];
  for (let t = 0; t < 8; t++) {
    const kind = rhythm ? 'sample' : t < 2 ? 'synth' : t < 4 ? 'midi' : 'drum';
    const defaultSample = rhythm ? p.defaultSamples[t] : t >= 4 ? p.defaultDrums[t - 4] : null;
    const patchSlot = kind === 'synth' ? p.patchSlots[t] : null;
    const patterns = p.patterns[t].map((pat) => ({
      start: Math.min(pat.settings.playbackStart, pat.settings.playbackEnd),
      end: Math.max(pat.settings.playbackStart, pat.settings.playbackEnd),
      rate: pat.settings.syncRate,
      dir: pat.settings.direction,
      steps: pat.steps.map((s) => ({ prob: s.probability, hits: hitsOf(kind, s, defaultSample) })),
    }));
    const label = rhythm ? `Track ${t + 1}` : TRACKS[t];
    // The track's sound: its patch, or its default sample; if that slot is empty, the
    // sample its steps play most.
    let sound = '';
    if (kind === 'synth') sound = pack.patches[patchSlot]?.name || `Patch ${patchSlot + 1}`;
    else if (defaultSample != null) {
      let slot = defaultSample;
      if (!pack.samples[slot]?.present) {
        const count = new Map();
        for (const pat of patterns) for (const s of pat.steps) for (const h of s.hits) count.set(h.sample, (count.get(h.sample) ?? 0) + 1);
        const best = [...count].filter(([s]) => pack.samples[s]?.present).sort((a, b) => b[1] - a[1])[0];
        if (best) slot = best[0];
      }
      sound = sampleName(slot);
    }
    // The synth's amp envelope, from the patch saved in the project (what the hardware plays).
    const env = kind === 'synth' ? ampEnvelope(t === 0 ? p.synth1Patch : p.synth2Patch) : null;
    tracks.push({ index: t, label, kind, defaultSample, patchSlot, sound, patterns, env });
  }
  const scenes = p.scenes.map((s, i) => ({
    index: i,
    used: i === 0 || s.flags !== 0,
    mask: s.mask ?? 0,
    chains: s.trackChains.map((c) => ({ start: Math.min(c.start, c.end, 7), end: Math.min(Math.max(c.start, c.end), 7) })),
  }));
  return {
    product: pack.product, name: entry.name || p.name || `Project ${entry.slot + 1}`,
    tempo: p.tempo, swing: p.swing, swingRate: p.swingSyncRate,
    // Tracks projects store Mute Recall Mode; when it is off the hardware keeps the mixer mutes
    // as they are on a scene change. (Not known for Rhythm projects: undefined.)
    muteRecall: pack.product === 'circuit-tracks' ? p.muteRecall : undefined,
    scenes, sceneChain: { start: Math.min(p.sceneChain.start, p.sceneChain.end), end: Math.max(p.sceneChain.start, p.sceneChain.end) },
    tracks, sampleName,
  };
}

// Envelope 1 (amp) of a 340-byte Circuit Tracks patch, in seconds and 0-1 sustain. Times use
// the curve calibrated on hardware (tracksgm/tools/ctpatch.py env_seconds): value 64 is 0.18 s
// for attack and 0.38 s for decay and release, and every 31.5 steps is a factor of ten.
const ENV1 = 70; // attack, decay, sustain, release at 70-73
export function ampEnvelope(patch) {
  if (!patch || patch.length < ENV1 + 4) return null;
  const secs = (v, ref) => ref * 10 ** ((v - 64) / 31.5);
  return {
    attack: secs(patch[ENV1], 0.18),
    decay: secs(patch[ENV1 + 1], 0.38),
    sustain: patch[ENV1 + 2] / 127,
    release: secs(patch[ENV1 + 3], 0.38),
  };
}

function microTicks(mask) {
  const out = [];
  for (let m = 0; m < 6; m++) if ((mask >> m) & 1) out.push(m);
  return out;
}

function hitsOf(kind, s, defaultSample) {
  if (kind === 'synth' || kind === 'midi') {
    const out = [];
    s.notes.forEach((n, j) => {
      if (!((s.mask >> j) & 1)) return;
      out.push({ micro: n.delay % 6, note: n.note - STORED_NOTE_OFFSET, vel: n.velocity, gate: n.gate & 0x7f, tie: (n.gate & 0x80) !== 0, sample: null });
    });
    return out;
  }
  if (kind === 'drum') {
    if (!s.active) return [];
    const ticks = s.micro ? s.micro.flatMap((on, m) => (on ? [m] : [])) : [0];
    const sample = s.drumChoice === 0xff ? defaultSample : s.drumChoice;
    return ticks.map((m) => ({ micro: m, note: null, vel: s.velocity, gate: null, tie: false, sample, multi: ticks.length > 1 }));
  }
  // Circuit Rhythm sample step
  if (!s.mask) return [];
  const ticks = microTicks(s.mask);
  const sample = s.sample === 0xff ? defaultSample : s.sample;
  return ticks.map((m) => ({ micro: m, note: s.note - STORED_NOTE_OFFSET, vel: s.velocity, gate: s.gate, tie: false, sample, multi: ticks.length > 1 }));
}

// ---------- Scene order ----------

export function usedScenes(song) { return song.scenes.filter((s) => s.used).map((s) => s.index); }

export function defaultOrderKind(song) {
  const c = song.sceneChain;
  if (c.end > c.start) return 'chain';
  return usedScenes(song).length > 1 ? 'used' : 'chain';
}

// kind: 'chain' (the saved scene chain), 'used' (every used scene in order) or 'custom'
// ("1-4, 2, 5x2", scene numbers as on the hardware, from 1).
export function sceneOrder(song, kind, custom = '') {
  if (kind === 'used') return usedScenes(song);
  if (kind === 'custom') return parseOrder(custom);
  const out = [];
  for (let s = song.sceneChain.start; s <= song.sceneChain.end; s++) out.push(s);
  return out;
}

export function parseOrder(text) {
  const out = [];
  for (const part of String(text).split(/[\s,;]+/).filter(Boolean)) {
    const m = part.match(/^(\d+)(?:-(\d+))?(?:[x×*](\d+))?$/i);
    if (!m) throw new Error(`"${part}" is not a scene number, range (2-5) or repeat (3x2).`);
    const a = Number(m[1]), b = m[2] ? Number(m[2]) : a, times = m[3] ? Number(m[3]) : 1;
    if (a < 1 || a > 16 || b < 1 || b > 16) throw new Error(`Scenes are numbered 1 to 16 ("${part}").`);
    if (times < 1 || times > 64) throw new Error(`Repeat counts go from 1 to 64 ("${part}").`);
    for (let r = 0; r < times; r++) {
      if (a <= b) for (let s = a; s <= b; s++) out.push(s - 1);
      else for (let s = a; s >= b; s--) out.push(s - 1);
    }
  }
  if (!out.length) throw new Error('Enter at least one scene number.');
  if (out.length > 1024) throw new Error('That order is too long (more than 1024 scenes).');
  return out;
}

// ---------- Rendering ----------

function stepOrder(pat) {
  const fwd = [];
  for (let i = pat.start; i <= pat.end; i++) fwd.push(i);
  if (pat.dir === 1) return fwd.reverse();
  if (pat.dir === 2 && fwd.length > 2) return [...fwd, ...fwd.slice(1, -1).reverse()];
  return fwd; // forward; random is rendered forward
}

export function patternTicks(pat) { return stepOrder(pat).length * stepTicks(pat.rate); }

// Length of a scene: its longest track chain. Shorter chains loop until the scene ends.
export function sceneTicks(song, sceneIndex) {
  const sc = song.scenes[sceneIndex];
  let len = 0;
  for (const tr of song.tracks) {
    const c = sc.chains[tr.index];
    let n = 0;
    for (let p = c.start; p <= c.end; p++) n += patternTicks(tr.patterns[p]);
    len = Math.max(len, n);
  }
  return len;
}

// opts: { order: [scene indices], swing: bool, chance: 'keep' | 'drop', sceneMutes: bool }
// Returns hits in ticks at PPQ: { tick, dur, track, note, vel, sample }.
export function renderSong(song, opts = {}) {
  const order = opts.order ?? sceneOrder(song, defaultOrderKind(song));
  const hits = [];
  const sceneStarts = [];
  let at = 0;
  for (const si of order) {
    const sc = song.scenes[si];
    if (!sc) continue;
    const len = sceneTicks(song, si);
    sceneStarts.push({ scene: si, tick: at, length: len });
    for (const tr of song.tracks) {
      if (opts.sceneMutes && ((sc.mask >> tr.index) & 1)) continue;
      const c = sc.chains[tr.index];
      let t = 0;
      while (t < len) {
        for (let p = c.start; p <= c.end && t < len; p++) {
          const pat = tr.patterns[p];
          const st = stepTicks(pat.rate);
          const micro = st / 6;
          for (const i of stepOrder(pat)) {
            if (t >= len) break;
            const step = pat.steps[i];
            if (!(opts.chance === 'drop' && step.prob < 7)) {
              for (const h of step.hits) {
                let dur;
                if (h.gate == null) dur = h.multi ? micro : st / 2;
                else dur = Math.max(1, h.gate) * micro;
                if (h.multi) dur = Math.min(dur, micro);
                hits.push({ tick: at + t + h.micro * micro, dur, track: tr.index, note: h.note, vel: Math.max(1, Math.min(127, h.vel)), sample: h.sample, tie: h.tie });
              }
            }
            t += st;
          }
        }
      }
    }
    at += len;
  }
  mergeTies(hits);
  if (opts.swing !== false && song.swing !== 50 && song.swing >= 20 && song.swing <= 80) {
    const unit = stepTicks(song.swingRate);
    const shift = Math.round(((song.swing - 50) / 50) * unit);
    for (const h of hits) if (h.tick % (2 * unit) === unit) h.tick += shift;
  }
  const out = hits.filter((h) => !h.dead).sort((a, b) => a.tick - b.tick || a.track - b.track);
  return { ppq: PPQ, hits: out, sceneStarts, length: at };
}

// A tied synth note carries on into the same note where it ends.
function mergeTies(hits) {
  const byKey = new Map();
  for (const h of hits) {
    if (h.note == null) continue;
    const k = `${h.track}:${h.note}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(h);
  }
  for (const list of byKey.values()) {
    list.sort((a, b) => a.tick - b.tick);
    for (let i = 0; i < list.length; i++) {
      let h = list[i];
      if (!h.tie || h.dead) continue;
      for (let j = i + 1; j < list.length && h.tie; j++) {
        const n = list[j];
        if (n.tick > h.tick + h.dur) break;
        if (n.tick === h.tick + h.dur) { h.dur += n.dur; h.tie = n.tie; n.dead = true; }
      }
    }
  }
}

// ---------- Mapping to MIDI ----------

export const GM_DRUMS = {
  35: 'Acoustic Bass Drum', 36: 'Bass Drum 1', 37: 'Side Stick', 38: 'Acoustic Snare', 39: 'Hand Clap',
  40: 'Electric Snare', 41: 'Low Floor Tom', 42: 'Closed Hi-Hat', 43: 'High Floor Tom', 44: 'Pedal Hi-Hat',
  45: 'Low Tom', 46: 'Open Hi-Hat', 47: 'Low-Mid Tom', 48: 'Hi-Mid Tom', 49: 'Crash Cymbal 1', 50: 'High Tom',
  51: 'Ride Cymbal 1', 52: 'Chinese Cymbal', 53: 'Ride Bell', 54: 'Tambourine', 55: 'Splash Cymbal',
  56: 'Cowbell', 57: 'Crash Cymbal 2', 58: 'Vibraslap', 59: 'Ride Cymbal 2', 60: 'Hi Bongo', 61: 'Low Bongo',
  62: 'Mute Hi Conga', 63: 'Open Hi Conga', 64: 'Low Conga', 65: 'High Timbale', 66: 'Low Timbale',
  67: 'High Agogo', 68: 'Low Agogo', 69: 'Cabasa', 70: 'Maracas', 71: 'Short Whistle', 72: 'Long Whistle',
  73: 'Short Guiro', 74: 'Long Guiro', 75: 'Claves', 76: 'Hi Wood Block', 77: 'Low Wood Block',
  78: 'Mute Cuica', 79: 'Open Cuica', 80: 'Mute Triangle', 81: 'Open Triangle',
};

const DRUM_GUESS = [
  [/kick|\bbd\b|bass ?drum|bassdrum/, [36, 35]],
  [/snare|\bsd\b|\bsn\b/, [38, 40]],
  [/rim|stick/, [37]],
  [/clap|\bcp\b/, [39]],
  [/open|\boh\b/, [46]],
  [/pedal/, [44]],
  [/closed|\bch\b|hat|\bhh\b/, [42, 44]],
  [/crash/, [49, 57]],
  [/ride/, [51, 59, 53]],
  [/splash/, [55]],
  [/china/, [52]],
  [/cym/, [49, 57, 55]],
  [/low ?tom|floor/, [41, 43]],
  [/hi(gh)? ?tom/, [50, 48]],
  [/tom/, [45, 47, 48, 43, 41, 50]],
  [/cowbell/, [56]],
  [/tamb/, [54]],
  [/shak|maraca/, [70, 82]],
  [/conga/, [63, 62, 64]],
  [/bongo/, [60, 61]],
  [/timbale/, [65, 66]],
  [/agogo/, [67, 68]],
  [/cabasa/, [69]],
  [/whistle/, [71, 72]],
  [/guiro/, [73, 74]],
  [/clave/, [75]],
  [/block/, [76, 77]],
  [/cuica/, [78, 79]],
  [/triangle/, [81, 80]],
  [/vibra/, [58]],
];
const DRUM_POOL = [75, 76, 77, 67, 68, 73, 74, 69, 70, 80, 81, 58, 71, 72, 78, 79, 54, 56, 60, 61, 62, 63, 64, 65, 66, 82, 83, 84, 85, 86, 87];

const PROGRAM_GUESS = [
  [/e\.? ?piano|rhodes|wurli|epiano/, 4], [/piano/, 0], [/harpsi/, 6], [/clav/, 7], [/celest/, 8],
  [/glock/, 9], [/music ?box/, 10], [/vibes?\b|vibraphone/, 11], [/marimba/, 12], [/xylo/, 13],
  [/dulc/, 15], [/bell|chime/, 14], [/organ/, 16], [/accord/, 21], [/harmonica/, 22],
  [/nylon|acoustic gu?i?ta?r/, 24], [/guitar|gtr/, 26], [/finger bass|bass guitar|bass gtr/, 33],
  [/acoustic bass|upright/, 32], [/808|sub/, 38], [/bass/, 38], [/violin/, 40], [/viola/, 41],
  [/cello/, 42], [/harp/, 46], [/timpani/, 47], [/string/, 48], [/choir|vox|voice|aah|ooh/, 52],
  [/trumpet/, 56], [/trombone/, 57], [/horn/, 60], [/brass/, 61], [/sax/, 65], [/flute/, 73],
  [/pad|swell/, 88], [/lead/, 80], [/pluck/, 45],
];

export function guessProgram(name, fallback = 0) {
  const n = (name || '').toLowerCase();
  for (const [re, p] of PROGRAM_GUESS) if (re.test(n)) return p;
  return fallback;
}

// Sample slot -> GM drum note, spread so that different samples get different notes.
export function guessDrumNotes(slots, nameOf) {
  const taken = new Set();
  const out = {};
  const later = [];
  for (const slot of slots) {
    const n = (nameOf(slot) || '').toLowerCase();
    const hit = DRUM_GUESS.find(([re]) => re.test(n));
    if (!hit) { later.push(slot); continue; }
    const note = hit[1].find((x) => !taken.has(x)) ?? hit[1][0];
    out[slot] = note;
    taken.add(note);
  }
  for (const slot of later) {
    const note = DRUM_POOL.find((x) => !taken.has(x)) ?? 75;
    out[slot] = note;
    taken.add(note);
  }
  return out;
}

// Which samples each track plays, over every pattern (sorted by slot).
export function samplesByTrack(song) {
  return song.tracks.map((tr) => {
    const set = new Set();
    for (const p of tr.patterns) for (const s of p.steps) for (const h of s.hits) if (h.sample != null) set.add(h.sample);
    return [...set].sort((a, b) => a - b);
  });
}

export function trackHasNotes(tr) {
  return tr.patterns.some((p) => p.steps.some((s) => s.hits.length));
}

// Default MIDI mapping. Per track: { on, mode: 'melodic' | 'drums', ch (1-16), program (-1 = none), transpose }.
export function defaultMapping(song, pack) {
  const tracksGM = /tracksgm/i.test(pack.name);
  const used = samplesByTrack(song);
  let nextCh = 1;
  const takeCh = () => { const c = nextCh; nextCh = nextCh === 9 ? 11 : Math.min(16, nextCh + 1); return c; };
  const tracks = song.tracks.map((tr) => {
    let mode;
    if (tr.kind === 'drum') mode = 'drums';
    else if (tr.kind === 'sample') {
      const pitched = tr.patterns.some((p) => p.steps.some((s) => s.hits.some((h) => h.note !== UNPITCHED)));
      mode = pitched ? 'melodic' : 'drums';
    } else mode = 'melodic';
    let program = -1;
    if (mode === 'melodic') {
      if (tr.kind === 'synth') program = tracksGM && tr.patchSlot < 128 ? tr.patchSlot : guessProgram(tr.sound, 80);
      else if (tr.kind === 'sample') program = guessProgram(tr.sound, 0);
    }
    return {
      on: trackHasNotes(tr),
      mode,
      ch: mode === 'drums' ? 10 : takeCh(),
      program,
      transpose: 0,
    };
  });
  const drumSlots = [...new Set(tracks.flatMap((m, t) => (m.mode === 'drums' ? used[t] : [])))].sort((a, b) => a - b);
  return { tracks, drumNotes: guessDrumNotes(drumSlots, song.sampleName) };
}

// The drum notes needed by the current mapping (fills in any sample that has none yet).
export function ensureDrumNotes(song, mapping) {
  const used = samplesByTrack(song);
  const need = [...new Set(mapping.tracks.flatMap((m, t) => (m.on && m.mode === 'drums' ? used[t] : [])))].sort((a, b) => a - b);
  const missing = need.filter((s) => mapping.drumNotes[s] == null);
  if (missing.length) {
    const taken = new Set(Object.values(mapping.drumNotes));
    const guessed = guessDrumNotes([...need.filter((s) => !missing.includes(s)), ...missing], song.sampleName);
    for (const s of missing) {
      let n = guessed[s];
      if (taken.has(n)) n = DRUM_POOL.find((x) => !taken.has(x)) ?? n;
      mapping.drumNotes[s] = n;
      taken.add(n);
    }
  }
  return need;
}

// Rendered hits -> MIDI tracks for js/midiwrite.js.
export function midiTracks(song, rendered, mapping) {
  const out = [];
  for (const tr of song.tracks) {
    const m = mapping.tracks[tr.index];
    if (!m.on) continue;
    const events = [];
    for (const h of rendered.hits) {
      if (h.track !== tr.index) continue;
      const note = noteFor(h, m, mapping);
      if (note == null) continue;
      events.push({ tick: h.tick, dur: Math.max(1, Math.round(h.dur)), note, vel: h.vel });
    }
    if (!events.length) continue;
    const prog = m.mode === 'melodic' && m.program >= 0 ? m.program : null;
    const what = m.mode === 'drums' ? 'drums' : prog != null ? GM_NAMES[prog] : tr.sound;
    out.push({ name: `${tr.label}${tr.sound ? `: ${tr.sound}` : ''}`, ch: m.ch, program: prog, events, what });
  }
  return out;
}

export function noteFor(h, m, mapping) {
  let note;
  if (m.mode === 'drums') {
    note = h.sample != null ? mapping.drumNotes[h.sample] : null;
    if (note == null) return null;
  } else {
    note = (h.note ?? UNPITCHED) + (m.transpose || 0);
  }
  return note >= 0 && note <= 127 ? note : null;
}

export const ticksToSeconds = (tick, tempo) => (tick / PPQ) * (60 / tempo);
