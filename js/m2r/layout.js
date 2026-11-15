// MIDI2Rhythm: a Circuit pack project copied into one Circuit Rhythm project with its own
// layout: the same scenes, scene chain, pattern chains and patterns (length, rate, direction),
// step for step, so one project stays one project.
//
// Circuit Tracks: Drum 1-4 go to Rhythm tracks 5-8 with their own samples (or a RhythmGM kit),
// every step as written. Synth 1, Synth 2 (then MIDI 1 and 2, if there's room) share the other
// tracks from track 1: a Tracks synth plays up to six notes per step, so each takes as many
// tracks as the voices it is given, one note per step on each. With "combine", drum tracks that
// play the same chains, with the same pattern settings, and never on the same step share a
// track, which frees tracks for the synths.
// Circuit Rhythm: track for track.
import { STEP_TICKS, renderSong } from '../song.js';
import { sampleForProgram, rootFromName, KIT_FIRST, octaveShift, drumMap, isUnpitched } from './engine.js';

const MAX_GATE = 96;          // 16 steps of 6 micro-steps
const MAX_VOICES = 6;
const STORED = 12;            // stored note = MIDI note + 12 (72 = a sample's own pitch)
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Patterns a source track plays in the used scenes.
function usedPatterns(song, t) {
  const set = new Set();
  for (const sc of song.scenes) if (sc.used) for (let p = sc.chains[t].start; p <= sc.chains[t].end; p++) set.add(p);
  return [...set].sort((a, b) => a - b);
}

// Steps of a pattern in its playback range (forward).
const range = (pat) => Array.from({ length: pat.end - pat.start + 1 }, (_, i) => pat.start + i);

// The most notes a synth track plays on one step.
export function voicesNeeded(song, t) {
  let max = 0;
  for (const p of usedPatterns(song, t)) for (const i of range(song.tracks[t].patterns[p])) max = Math.max(max, song.tracks[t].patterns[p].steps[i].hits.length);
  return Math.min(MAX_VOICES, max);
}

// Can drum track b share drum track a's Rhythm track? Same chains in every used scene, same
// settings on the patterns they play, and never a hit on the same step.
function canShare(song, aTracks, b, tuneOf) {
  if (aTracks.some((a) => tuneOf(a) !== tuneOf(b))) return false;
  for (const sc of song.scenes) {
    if (!sc.used) continue;
    for (const a of aTracks) if (sc.chains[a].start !== sc.chains[b].start || sc.chains[a].end !== sc.chains[b].end) return false;
  }
  for (const p of usedPatterns(song, b)) {
    const pb = song.tracks[b].patterns[p];
    for (const a of aTracks) {
      const pa = song.tracks[a].patterns[p];
      if (pa.start !== pb.start || pa.end !== pb.end || pa.rate !== pb.rate || pa.dir !== pb.dir) return false;
      for (const i of range(pb)) if (pa.steps[i].hits.length && pb.steps[i].hits.length) return false;
    }
  }
  return true;
}

// song: js/song.js songOf. sources: js/packsong.js sources (id `k<track>`, .track, .isDrum,
// .program). opts: {
//   parts: Map(id -> { on, voices?, sample? }), names: the new pack's 128 sample names,
//   own: engine.js ownSamples result or null (then drums use `kit`, a RhythmGM kit),
//   kit: 16 kit entries, range: 0 | 7 | 12 | 18, combine: bool, mutes: Set(Rhythm track),
//   project: the source project as js/pack.js read it (drum Pitch, track Tune, colour) }
export function layoutPlan(song, sources, opts) {
  const o = { parts: new Map(), range: 0, combine: false, mutes: new Set(), ...opts };
  const rhythm = song.product === 'circuit-rhythm';
  // Each source track's tuning, carried to the Rhythm track's Tune (64 = centre): a Tracks drum
  // track's Pitch, or a Rhythm track's Tune. (Same 0-127 scale assumed: to check by ear.)
  const tuneOf = (t) => (rhythm ? o.project?.trackTunes?.[t] : t >= 4 ? o.project?.drumConfigs?.[t - 4]?.pitch : 64) ?? 64;
  const byTrack = new Map(sources.map((s) => [s.track, s]));
  const cfgOf = (s) => o.parts.get(s.id) ?? {};
  const on = (s) => s && cfgOf(s).on !== false;
  const roots = o.names.map((n) => rootFromName(n));
  const ownKit = o.own?.kit.length ? o.own : null;
  const gmDrum = drumMap(o.kit);
  const drumSlot = (h) => {
    if (ownKit) {
      const k = ownKit.kitBySlot.get(h.sample);
      if (k != null) return ownKit.kit[k].abs;
      return ownKit.kit[drumMap(ownKit.kit)(h.drumNote ?? 38)].abs;
    }
    return KIT_FIRST + gmDrum(h.drumNote ?? 38);
  };
  // GM drum note per pack sample, from packsong's guess (for a GM kit, or a dropped sample).
  const drumNoteOf = new Map();
  for (const s of sources) for (const n of s.notes) if (n.slot != null && n.drumNote != null) drumNoteOf.set(n.slot, n.drumNote);

  for (const s of sources) { delete s._voices; delete s._need; }
  const warnings = { voicesCut: 0, notesOver: 0, folded: 0, outside: 0, gatesCut: 0 };
  const reports = [];
  const assign = Array(8).fill(null);   // Rhythm track -> { src: [source tracks], kind, voice, voices, part }

  if (rhythm) {
    for (let t = 0; t < 8; t++) {
      const s = byTrack.get(t);
      if (on(s)) assign[t] = { src: [t], kind: s.isDrum ? 'drum' : 'sample', voice: 0, voices: 1, part: s };
    }
  } else {
    // drums: Drum k on track 4+k, or packed from track 5 when combining
    const drums = [4, 5, 6, 7].filter((t) => on(byTrack.get(t)));
    if (o.combine) {
      const groups = [];
      for (const t of drums) {
        const g = groups.find((x) => canShare(song, x, t, tuneOf));
        if (g) g.push(t); else groups.push([t]);
      }
      groups.forEach((g, i) => { assign[4 + i] = { src: g, kind: 'drum', voice: 0, voices: 1, part: byTrack.get(g[0]) }; });
    } else {
      for (const t of drums) assign[t] = { src: [t], kind: 'drum', voice: 0, voices: 1, part: byTrack.get(t) };
    }
    // synths (then MIDI tracks) on the free tracks from track 1
    const free = [0, 1, 2, 3, 4, 5, 6, 7].filter((t) => !assign[t]);
    const synths = [0, 1, 2, 3].map((t) => byTrack.get(t)).filter((s) => on(s));
    const want = synths.map((s) => {
      const need = Math.max(1, voicesNeeded(song, s.track));
      const set = cfgOf(s).voices;
      return { s, need, fixed: set != null, n: set != null ? Math.min(set, MAX_VOICES) : need };
    });
    // Synth 1 and 2 first, then MIDI 1 and 2 on what's left. Too many voices: take them from
    // the automatic ones with the most (the later part on a tie), then from any, then leave
    // out the last parts.
    const fit = (group, room) => {
      const total = () => group.reduce((x, w) => x + w.n, 0);
      for (const pass of [false, true]) {
        while (total() > room) {
          const c = group.filter((w) => w.n > 1 && (pass || !w.fixed)).sort((x, y) => y.n - x.n || y.s.track - x.s.track)[0];
          if (!c) break;
          c.n--;
        }
      }
      while (total() > room) group[group.findLastIndex((w) => w.n > 0)].n = 0;
      return room - total();
    };
    const left = fit(want.filter((w) => w.s.track < 2), free.length);
    fit(want.filter((w) => w.s.track >= 2), left);
    let k = 0;
    for (const w of want) {
      for (let v = 0; v < w.n; v++) assign[free[k++]] = { src: [w.s.track], kind: 'synth', voice: v, voices: w.n, part: w.s };
      w.s._voices = w.n;
      w.s._need = w.need;
      if (w.n && w.n < w.need) warnings.voicesCut++;
    }
  }

  // A scene lasts as long as its longest chain, notes or not. Source tracks left without a Rhythm
  // track (empty, or left out) lend their chains and pattern settings, without notes, to free
  // tracks, the ones that set a scene's length first, so every scene keeps its length.
  const chainTicks = (t, sc) => {
    let n = 0;
    for (let p = sc.chains[t].start; p <= sc.chains[t].end; p++) n += (song.tracks[t].patterns[p].end - song.tracks[t].patterns[p].start + 1) * (STEP_TICKS[song.tracks[t].patterns[p].rate] ?? 360);
    return n;
  };
  const represented = new Set(assign.filter(Boolean).flatMap((a) => a.src));
  const sceneLen = (sc, tracks) => Math.max(0, ...tracks.map((t) => chainTicks(t, sc)));
  const used = song.scenes.filter((sc) => sc.used);
  const spare = [0, 1, 2, 3, 4, 5, 6, 7].filter((t) => !assign[t]);
  const others = [0, 1, 2, 3, 4, 5, 6, 7].filter((t) => !represented.has(t));
  let shortScenes = 0;
  for (;;) {
    const have = [...new Set(assign.filter(Boolean).flatMap((a) => a.src))];
    const short = used.filter((sc) => sceneLen(sc, have) < sceneLen(sc, [0, 1, 2, 3, 4, 5, 6, 7]));
    if (!short.length) break;
    const cand = others.filter((t) => !have.includes(t))
      .map((t) => ({ t, fixes: short.filter((sc) => chainTicks(t, sc) > sceneLen(sc, have)).length }))
      .filter((c) => c.fixes).sort((a, b) => b.fixes - a.fixes)[0];
    if (!cand || !spare.length) { shortScenes = short.length; break; }
    assign[spare.shift()] = { src: [cand.t], kind: 'timing', voice: 0, voices: 1, part: byTrack.get(cand.t) ?? null };
  }
  warnings.shortScenes = shortScenes;

  // The sample and range fitting of each melodic part.
  const partSample = new Map();
  for (const s of sources) {
    if (s.isDrum) continue;
    const cfg = cfgOf(s);
    const own = o.own?.ownSample.get(s.id);
    const sample = cfg.sample ?? own ?? sampleForProgram(s.program ?? 0);
    let shift = 0;
    if (sample != null && o.range && !isUnpitched(sample)) shift = octaveShift(s.notes, roots[sample], o.range);
    partSample.set(s.id, { sample, own: cfg.sample == null && own != null, shift });
  }

  const tracks = assign.map((a, t) => {
    if (!a) return null;
    if (a.kind === 'timing') {
      const patterns = song.tracks[a.src[0]].patterns.map((src) => ({ start: src.start, end: src.end, rate: src.rate, dir: src.dir, steps: Array(32).fill(null) }));
      return { kind: 'timing', label: '(scene timing only)', src: a.src, voice: 0, voices: 1, parts: [], patterns, defaultSample: 0, notes: 0, tune: 64 };
    }
    const s = a.part;
    const ps = partSample.get(s.id);
    const muted = o.mutes.has(t);
    const patterns = [];
    let notes = 0;
    for (let p = 0; p < 8; p++) {
      const src = song.tracks[a.src[0]].patterns[p];
      const pat = { start: src.start, end: src.end, rate: src.rate, dir: src.dir, steps: Array.from({ length: 32 }, () => null) };
      patterns.push(pat);
      if (muted) continue;
      for (let i = 0; i < 32; i++) {
        let st = null;
        if (a.kind === 'drum') {
          const tr = a.src.find((x) => song.tracks[x].patterns[p].steps[i].hits.length);
          if (tr == null) continue;
          const step = song.tracks[tr].patterns[p].steps[i];
          const h = step.hits[0];
          const sample = drumSlot({ sample: h.sample, drumNote: drumNoteOf.get(h.sample) });
          // Rhythm drum tracks keep their pitch (with their own samples); Tracks drums have none.
          const byte = rhythm && ownKit && h.note != null ? clamp(h.note + STORED, 0, 127) : 72;
          st = { byte, gate: h.gate ?? 0, mask: step.hits.reduce((m, x) => m | (1 << x.micro), 0), vel: clamp(h.vel, 1, 127), prob: step.prob, sample };
        } else {
          const step = song.tracks[a.src[0]].patterns[p].steps[i];
          let hits = step.hits.slice().sort((x, y) => y.note - x.note || x.micro - y.micro);
          if (!hits.length) continue;
          // One note per voice, top voice first; with more notes than voices the outer ones stay.
          if (hits.length > a.voices) {
            if (a.voice === 0) warnings.notesOver += hits.length - a.voices;
            hits = a.voices === 1 ? [hits[0]] : [...hits.slice(0, a.voices - 1), hits[hits.length - 1]];
          }
          const h = hits[a.voice];
          if (!h) continue;
          let sample = ps.sample;
          if (sample == null) continue;
          let byte;
          if (a.kind === 'sample' && ps.own && o.own?.slotOf.has(h.sample)) {
            sample = o.own.slotOf.get(h.sample);           // a Rhythm track's own samples, as played
            byte = clamp(h.note + STORED, 0, 127);
          } else {
            const root = roots[sample];
            let note = h.note;
            if (isUnpitched(sample)) note = root;
            else if (o.range) {
              note += ps.shift;
              let moved = false;
              while (note - root > o.range && note - 12 >= 0) { note -= 12; moved = true; }
              while (root - note > o.range && note + 12 <= 127) { note += 12; moved = true; }
              if (moved && a.voice === 0) warnings.folded++;
            }
            byte = clamp(72 + note - root, 0, 127);
          }
          let gate = h.gate ?? 6;
          if (h.tie) gate = MAX_GATE;
          if (gate > MAX_GATE) { gate = MAX_GATE; warnings.gatesCut++; }
          st = { byte, gate: Math.max(1, gate), mask: 1 << h.micro, vel: clamp(h.vel, 1, 127), prob: step.prob, sample };
        }
        pat.steps[i] = st;
        notes++;
      }
      // Drum gates: up to the track's next hit in the pattern (wrapping), so a long sample
      // isn't cut short if the Rhythm stops a sample at its gate.
      if (a.kind === 'drum') {
        const idx = range(pat).filter((i) => pat.steps[i]);
        idx.forEach((i, j) => {
          const st = pat.steps[i];
          if (st.gate) return;
          const next = idx[j + 1] ?? idx[0] + (pat.end - pat.start + 1);
          st.gate = clamp((next - i) * 6, 1, MAX_GATE);
        });
      }
    }
    for (const pat of patterns) for (const st of pat.steps) if (st && !st.gate) st.gate = 6;
    const count = new Map();
    for (const pat of patterns) for (const st of pat.steps) if (st) count.set(st.sample, (count.get(st.sample) ?? 0) + 1);
    const defaultSample = [...count].sort((x, y) => y[1] - x[1])[0]?.[0] ?? (ps?.sample ?? 0);
    const names = a.src.map((x) => byTrack.get(x).name);
    const label = a.voices > 1 ? `${names[0]} (voice ${a.voice + 1} of ${a.voices})` : names.join(' + ');
    const tune = a.kind === 'synth' ? 64 : tuneOf(a.src[0]);
    return { kind: a.kind === 'drum' ? 'drum' : 'melodic', label, src: a.src, voice: a.voice, voices: a.voices, parts: a.src.map((x) => byTrack.get(x).id), patterns, defaultSample, notes, tune };
  });

  for (const s of sources) {
    const ps = partSample.get(s.id);
    const ts = tracks.map((tr, i) => (tr?.parts.includes(s.id) ? i : -1)).filter((i) => i >= 0);
    reports.push({
      id: s.id, name: s.name, instrument: s.isDrum ? 'Drums' : s.instrument, notes: s.notes.length,
      kind: s.isDrum ? 'drums' : 'layout', isDrum: s.isDrum, on: on(s), tracks: ts,
      sample: ps?.sample ?? null, own: ps?.own ?? false, shift: ps?.shift ?? 0, folded: 0, outside: 0,
      voices: s._voices ?? (ts.length || 1), need: s._need ?? null, synth: !rhythm && !s.isDrum,
      dropped: on(s) && !ts.length ? 1 : 0,
    });
  }

  const usedScenes = song.scenes.filter((sc) => sc.used);
  return {
    kind: 'layout',
    product: song.product,
    color: o.project?.color ?? null,
    tempo: clamp(song.tempo, 40, 240),
    tempoClamped: song.tempo < 40 || song.tempo > 240,
    swing: song.swing, swingRate: song.swingRate,
    sceneChain: song.sceneChain,
    scenes: song.scenes.map((sc) => ({
      index: sc.index,
      used: sc.used,
      // The scene's saved mute bits follow each source track to its Rhythm tracks.
      mask: assign.reduce((m, a, t) => (a && a.src.some((x) => (sc.mask >> x) & 1) ? m | (1 << t) : m), 0),
      chains: assign.map((a) => (a ? { start: sc.chains[a.src[0]].start, end: sc.chains[a.src[0]].end } : { start: 0, end: 0 })),
    })),
    nScenes: usedScenes.length,
    tracks,
    active: tracks.map((t, i) => !!t && !o.mutes.has(i) && t.notes > 0),
    parts: reports,
    warnings,
  };
}

// Sample slots the project plays.
export function layoutSamples(plan) {
  const used = new Set();
  plan.tracks.forEach((t, i) => {
    if (!t || !plan.active[i]) return;
    used.add(t.defaultSample);
    for (const p of t.patterns) for (const st of p.steps) if (st) used.add(st.sample);
  });
  return used;
}

// The plan as js/song.js plays it (for the preview and its timing): hits carry the step's
// note byte in `note` and the sample in `sample`. order: scene indices.
export function renderLayout(plan, order) {
  const tracks = Array.from({ length: 8 }, (_, t) => {
    const tr = plan.tracks[t];
    return {
      index: t,
      patterns: Array.from({ length: 8 }, (_, p) => {
        const pat = tr?.patterns[p] ?? { start: 0, end: 15, rate: 3, dir: 0, steps: [] };
        return {
          start: pat.start, end: pat.end, rate: pat.rate, dir: pat.dir,
          steps: Array.from({ length: 32 }, (_, i) => {
            const st = pat.steps[i];
            if (!st || !plan.active[t]) return { prob: 7, hits: [] };
            const micros = [0, 1, 2, 3, 4, 5].filter((m) => (st.mask >> m) & 1);
            return { prob: st.prob, hits: micros.map((m) => ({ micro: m, note: st.byte, vel: st.vel, gate: st.gate, sample: st.sample, multi: micros.length > 1 })) };
          }),
        };
      }),
    };
  });
  return renderSong({ scenes: plan.scenes, tracks, swing: plan.swing, swingRate: plan.swingRate }, { order, swing: true, chance: 'keep', sceneMutes: true });
}

export const stepTicksOf = (rate) => STEP_TICKS[rate] ?? 360;
