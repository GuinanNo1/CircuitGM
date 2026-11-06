// MIDI -> Circuit Tracks arrangement.
//
// The song is cut into patterns of up to 32 steps (2 bars at 1/16 steps, or 4 bars at 1/8),
// grouped into sections (default 8 bars). Each section becomes one scene; scenes play in
// order through the scene chain. Within a scene a track either plays one pattern on loop
// (when every pattern-length chunk of that section is identical) or a chain of consecutive
// patterns. Identical sections reuse the same patterns, so a project holds up to 16 sections
// as long as no track needs more than 8 distinct patterns. When it is full, the song
// continues in the next project.
//
// Track order (as in the .ncs): 0 Synth 1, 1 Synth 2, 2 MIDI 1, 3 MIDI 2, 4-7 Drum 1-4.

export const TRACKS = ['Synth 1', 'Synth 2', 'MIDI 1', 'MIDI 2', 'Drum 1', 'Drum 2', 'Drum 3', 'Drum 4'];
export const MELODIC_ROLES = ['S1', 'S2', 'M1', 'M2'];
export const MICRO = 6;          // micro-ticks per step
export const MAX_STEPS = 32;
export const MAX_NOTES = 6;      // note slots per step
export const MAX_PATTERNS = 8;
export const MAX_SCENES = 16;
export const MAX_PROJECTS = 64;

// Kit layout in TracksGM_final: kit k uses sample slots k*8 .. k*8+7 in this order.
export const KIT_PARTS = ['kick', 'snare', 'rimclap', 'ch', 'oh', 'tom', 'cymbal', 'perc'];
export const KITS = ['Std', 'Room', 'Power', 'Elec', '808', 'Jazz', 'Brush', 'Orch'];

// GM drum note -> [drum track 0-3, kit part]
export function gmDrum(note) {
  if (note === 35 || note === 36) return [0, 'kick'];
  if (note === 38 || note === 40) return [1, 'snare'];
  if ([41, 43, 45, 47, 48, 50].includes(note)) return [1, 'tom'];
  if (note === 42 || note === 44) return [2, 'ch'];
  if (note === 46) return [2, 'oh'];
  if (note === 37 || note === 39) return [3, 'rimclap'];
  if ([49, 51, 52, 53, 55, 57, 59].includes(note)) return [3, 'cymbal'];
  return [3, 'perc'];
}
export const DRUM_TRACK_LABELS = ['Kick', 'Snare / Tom', 'Hi-hats', 'Percussion'];

// Step rates a pattern can run at on the Tracks. stepQuarter (how much of the song one step
// covers, in quarter notes) = syncQuarters x the tempo division: halving the project tempo
// doubles how much of the song each step, and so each pattern, holds.
export const RATES = {
  16: { syncRate: 3, syncQuarters: 1 / 4, label: '1/16 steps' },
  8: { syncRate: 5, syncQuarters: 1 / 2, label: '1/8 steps' },
  4: { syncRate: 7, syncQuarters: 1, label: '1/4 steps' },
};
const AUTO_RATES = [16, 8, 4];
const MOVED_LIMIT = 0.02;        // Auto skips a step rate that moves more than 2% of notes
const SIMILAR = { similar90: 0.9, similar75: 0.75 };
const MAX_ALIGN = 8;             // bars tried when lining sections up with repeats

// Bars per pattern for a rate and tempo division in a given time signature (null if a bar
// doesn't divide into whole steps).
export function patternBars(rate, tempoDiv, timeSig, sectionBars = 32) {
  const stepsPerBar = (4 * timeSig.num / timeSig.den) / (RATES[rate].syncQuarters * tempoDiv);
  if (Math.abs(stepsPerBar - Math.round(stepsPerBar)) > 1e-6 || stepsPerBar > MAX_STEPS || stepsPerBar < 1) return null;
  for (let b = Math.min(sectionBars, Math.floor(MAX_STEPS / Math.round(stepsPerBar))); b >= 1; b--) {
    if (sectionBars % b === 0) return b;
  }
  return null;
}

// assignment: { S1: [sourceId], S2: [...], M1: [...], M2: [...], DR: [...] }
// options:
//   rate: 'auto' | 16 | 8 | 4     step rate of every pattern
//   tempoDiv: 1 | 2 | 4           project tempo = song tempo / tempoDiv
//   sectionBars: 'auto' | 4 | 8 | 16 | 32  bars per scene ('auto' tries 8 bars and one pattern
//                                  per scene, and keeps whichever needs fewer projects)
//   match: 'exact' | 'loose' | 'similar90' | 'similar75'   how repeats are recognised
//   quantize: 0 | grid in quarter notes (0.25 = 1/16, 0.5 = 1/8, 1/6 = 1/16 triplet)
//   align: true                   try starting sections a few bars earlier to line up repeats
//   trimStart, kit, transpose: {S1: 0, ...}, mutes: { all: Set(key), bars: Map(key -> Set(bar)) }
// Mute keys are source ids, plus 'lane4'..'lane7' for the four drum tracks. Bars count from
// the start of the file (bar 0), so mutes survive changes to the other options.
export function arrange(midi, assignment, options = {}) {
  const opt = { rate: 'auto', tempoDiv: 1, sectionBars: 'auto', trimStart: true, kit: 1, match: 'loose', quantize: 0, align: true, ...options };
  const tempoDiv = Number(opt.tempoDiv) || 1;
  const byId = new Map(midi.sources.map((s) => [s.id, s]));
  const pick = (role) => (assignment[role] ?? []).map((id) => byId.get(id)).filter(Boolean);

  const barTicks = midi.ppq * 4 * midi.timeSig.num / midi.timeSig.den;
  const mutes = opt.mutes ?? { all: new Set(), bars: new Map() };
  const muted = (key, tick) => mutes.all.has(key) || !!mutes.bars.get(key)?.has(Math.floor(tick / barTicks + 1e-9));
  const q = opt.quantize ? midi.ppq * opt.quantize : 0;
  const quant = (n) => (q ? { ...n, tick: Math.round(n.tick / q) * q, dur: Math.max(q, Math.round(n.dur / q) * q) } : n);

  const melodic = MELODIC_ROLES.map((r) => {
    const srcs = pick(r);
    const shift = opt.transpose?.[r] ?? 0;
    return srcs.length
      ? srcs.flatMap((s) => s.notes.filter((n) => !muted(s.id, n.tick)).map((n) => quant({ ...n, note: n.note + shift })))
      : null;
  });
  const drumSrcs = pick('DR');
  const drumHits = drumSrcs.length
    ? drumSrcs.flatMap((s) => s.notes.filter((n) => !muted(s.id, n.tick) && !muted(`lane${4 + gmDrum(n.note)[0]}`, n.tick)).map(quant))
    : null;
  const active = [...melodic.map(Boolean), ...[0, 1, 2, 3].map(() => !!drumHits)];

  const all = [...melodic.filter(Boolean).flat(), ...(drumHits ?? [])];
  if (!all.length) return { error: active.some(Boolean) ? 'Everything is muted. Unmute a part to build the song.' : 'Choose at least one track with notes.' };
  if (midi.tempo / tempoDiv < 39.5) {
    return { error: `Dividing ${Math.round(midi.tempo)} BPM by ${tempoDiv} goes below the Circuit Tracks minimum of 40 BPM. Choose a smaller tempo division.` };
  }
  const firstTick = Math.min(...all.map((n) => n.tick));
  const lastTick = Math.max(...all.map((n) => n.tick + (n.dur ?? 0)));
  const baseStart = opt.trimStart ? Math.floor(firstTick / barTicks + 1e-9) * barTicks : 0;
  const candidates = opt.rate === 'auto' ? AUTO_RATES : [Number(opt.rate)];
  const results = [];
  for (const rate of candidates) {
    let bestForRate = null;
    const pb = patternBars(rate, tempoDiv, midi.timeSig);
    const sectionChoices = opt.sectionBars === 'auto'
      ? [...new Set([Math.max(8, pb ?? 8), pb].filter(Boolean)), 'var']
      : [Number(opt.sectionBars)];
    for (const sectionBars of sectionChoices) {
      const offsets = opt.align ? Array.from({ length: Math.min(MAX_ALIGN, sectionBars === 'var' ? (pb ?? 8) : sectionBars) }, (_, k) => k) : [0];
      for (const k of offsets) {
        const r = tryRate(rate, baseStart - k * barTicks, sectionBars);
        if (!r) continue;
        if (!bestForRate || score(r) < score(bestForRate)) bestForRate = r;
      }
    }
    if (bestForRate) results.push(bestForRate);
  }
  if (!results.length) {
    return { error: `These settings don't fit a ${midi.timeSig.num}/${midi.timeSig.den} bar in whole steps, or the pattern is longer than the section. Try a different pattern length, tempo or section length.` };
  }
  // Auto: fewest projects among the rates that keep timing (<= 2% of notes moved), finest first.
  const keep = results.filter((r) => r.warnings.movedRatio <= MOVED_LIMIT);
  const pool = keep.length ? keep : results;
  pool.sort((a, b) => score(a) - score(b) || b.rate - a.rate);
  const best = pool[0];
  best.alternatives = results.map((r) => ({ rate: r.rate, projects: r.projects.length }));
  return best;

  // Fewer projects first, then fewer added lead-in bars (silence), then fewer patterns.
  function score(r) {
    const pats = r.projects.reduce((a, p) => a + p.patternCounts.reduce((x, y) => x + y, 0), 0);
    return r.projects.length * 1e6 + r.leadBars * 1000 + pats;
  }

  function tryRate(rate, startTick, sectionBars) {
    const R = RATES[rate];
    const variable = sectionBars === 'var';
    const chunkBars = patternBars(rate, tempoDiv, midi.timeSig, variable ? 32 : sectionBars);
    if (!chunkBars) return null;
    const stepTicks = midi.ppq * R.syncQuarters * tempoDiv;
    const spb = Math.round(barTicks / stepTicks);
    const perSection = variable ? 1 : sectionBars / chunkBars;   // patterns per section
    if (perSection > MAX_PATTERNS) return null;
    const patLen = chunkBars * spb;                           // steps per pattern
    const chunkMicro = patLen * MICRO;
    const microTicks = stepTicks / MICRO;
    const nChunks = Math.max(1, Math.ceil((lastTick - startTick) / (chunkBars * barTicks) - 1e-9));
    const nSections = Math.ceil(nChunks / perSection);
    const totalChunks = nSections * perSection;
    const warn = { dropped: 0, drumDropped: 0, held: 0, beforeStart: 0, moved: 0, total: 0, similarNotes: 0, similarPatterns: 0 };
    const MOVE_TOL = midi.ppq / 16;    // a 1/64 note
    const countMove = (n, pos) => {
      warn.total++;
      if (Math.abs(pos * microTicks - (n.tick - startTick)) > MOVE_TOL) warn.moved++;
    };

    // ---- per-track chunk contents ----
    const contents = []; // contents[t][chunk] = { steps, key }
    for (let t = 0; t < 8; t++) contents.push(Array.from({ length: totalChunks }, () => ({ items: [] })));

    melodic.forEach((notes, t) => {
      if (!notes) return;
      for (const n of notes) {
        let pos = Math.round((n.tick - startTick) / microTicks);
        if (pos < 0) { warn.beforeStart++; continue; }
        countMove(n, pos);
        let len = Math.max(1, Math.round(n.dur / microTicks));
        // Notes that run past the end of a pattern are cut there and struck again at the
        // start of the next pattern, because each pattern is stored separately.
        let first = true;
        while (len > 0) {
          const c = Math.floor(pos / chunkMicro);
          if (c >= totalChunks) break;
          const local = pos - c * chunkMicro;
          const room = chunkMicro - local;
          const l = Math.min(len, room);
          contents[t][c].items.push({ step: Math.floor(local / MICRO), delay: local % MICRO, note: clamp(n.note + 12, 1, 127), vel: clamp(n.vel, 1, 127), len: l });
          if (!first) warn.held++;
          first = false;
          len -= l;
          pos += l;
        }
      }
    });

    if (drumHits) {
      for (const n of drumHits) {
        const pos = Math.round((n.tick - startTick) / microTicks);
        if (pos < 0) { warn.beforeStart++; continue; }
        countMove(n, pos);
        const c = Math.floor(pos / chunkMicro);
        if (c >= totalChunks) continue;
        const local = pos - c * chunkMicro;
        const [dt, part] = gmDrum(n.note);
        contents[4 + dt][c].items.push({ step: Math.floor(local / MICRO), tick: local % MICRO, part, vel: n.vel });
      }
    }

    // Normalise each chunk into step lists and a comparison key.
    const loose = opt.match !== 'exact';
    for (let t = 0; t < 8; t++) {
      for (const ch of contents[t]) {
        if (t < 4) normaliseSynth(ch, warn, loose); else normaliseDrum(ch, warn, loose);
      }
    }
    // Similar repeats: a pattern that is mostly the same as an earlier one becomes that one.
    if (SIMILAR[opt.match]) for (let t = 0; t < 8; t++) if (active[t]) mergeSimilar(contents[t], t < 4, SIMILAR[opt.match], warn);

    // Default sample per drum track = its most used kit part.
    const drumDefaults = [0, 1, 2, 3].map((dt) => {
      const count = {};
      for (const ch of contents[4 + dt]) for (const s of ch.steps) count[s.part] = (count[s.part] ?? 0) + 1;
      const fallback = ['kick', 'snare', 'ch', 'perc'][dt];
      return Object.entries(count).sort((a, b) => b[1] - a[1])[0]?.[0] ?? fallback;
    });

    // ---- plan projects / scenes / patterns ----
    const projects = [];
    const newProject = () => ({ scenes: [], store: Array.from({ length: 8 }, () => []) });
    let cur = newProject();
    const storeSize = (st) => st.reduce((a, x) => a + x.length, 0);

    if (!variable) {
      for (let sec = 0; sec < nSections; sec++) {
        let placed = place(cur, sec * perSection, (sec + 1) * perSection);
        if (!placed && cur.scenes.length) {
          projects.push(cur);
          cur = newProject();
          placed = place(cur, sec * perSection, (sec + 1) * perSection);
        }
        if (!placed) return null;
        commit(cur, placed, sec);
      }
    } else {
      // Variable scenes: start a scene at each chunk and keep adding the next chunk to it while
      // that costs no more patterns than giving the chunk a scene of its own.
      let i = 0;
      while (i < totalChunks) {
        let best = place(cur, i, i + 1);
        if (!best) {
          projects.push(cur);
          cur = newProject();
          best = place(cur, i, i + 1);
          if (!best) return null;
        }
        let len = 1;
        while (len < MAX_PATTERNS && i + len < totalChunks) {
          const ext = place(cur, i, i + len + 1);
          if (!ext) break;
          const after = { scenes: [...cur.scenes, best], store: best.store };
          const sep = place(after, i + len, i + len + 1);
          if (sep && storeSize(sep.store) < storeSize(ext.store)) break;
          best = ext;
          len++;
        }
        commit(cur, best, i);
        i += len;
      }
    }
    if (cur.scenes.length) projects.push(cur);
    if (projects.length > MAX_PROJECTS) warn.tooLong = true;

    function commit(proj, placed, section) {
      proj.store = placed.store;
      proj.scenes.push({ ...placed.scene, section });
    }

    // Lay out chunks [c0, c1) as one scene on top of proj's patterns. Returns the new pattern
    // store and the scene, or null if a track would need more than 8 patterns or the project
    // has no scenes left. Nothing is changed until commit().
    function place(proj, c0, c1) {
      if (proj.scenes.length >= MAX_SCENES) return null;
      const L = c1 - c0;
      const store = proj.store.map((x) => x.slice());
      const chains = [];
      const keys = (t) => contents[t].slice(c0, c1).map((c) => c.key);
      for (let t = 0; t < 8; t++) {
        if (!active[t]) { chains.push({ start: 0, len: 1 }); continue; }
        // A chain loops within its scene, so a part that repeats every p patterns
        // (A A A A, or A B A B) only needs those p patterns.
        const k = keys(t);
        const p = period(k);
        chains.push({ start: findOrAdd(store[t], k.slice(0, p)), len: p });
      }
      // A scene lasts as long as its longest chain, so one track must chain the whole
      // scene. If every track repeats a shorter cycle, extend the busiest one.
      if (L > 1 && !chains.some((c, t) => active[t] && c.len === L)) {
        let t = [0, 1, 2, 3, 4, 5, 6, 7].filter((x) => active[x]).sort((x, y) => chains[y].len - chains[x].len)
          .find((x) => keys(x)[0] !== '');
        if (t === undefined) t = active.findIndex(Boolean);
        chains[t] = { start: findOrAdd(store[t], keys(t)), len: L };
      }
      if (store.some((x) => x.length > MAX_PATTERNS)) return null;
      return {
        store,
        scene: { firstChunk: c0, chains: chains.map((c) => ({ start: c.start, end: c.start + c.len - 1, len: c.len })) },
      };
    }

    // Pattern contents per project: keys -> chunk content.
    const byKey = Array.from({ length: 8 }, () => new Map());
    for (let t = 0; t < 8; t++) for (const ch of contents[t]) if (!byKey[t].has(ch.key)) byKey[t].set(ch.key, ch);
    const outProjects = projects.map((p, i) => ({
      index: i,
      scenes: p.scenes,
      patterns: p.store.map((keys, t) => keys.map((k) => byKey[t].get(k))),
      patternCounts: p.store.map((s) => s.length),
      firstSection: p.scenes[0].section,
      lastSection: p.scenes[p.scenes.length - 1].section,
    }));

    warn.movedRatio = warn.total ? warn.moved / warn.total : 0;
    const projectTempo = Math.round(midi.tempo / tempoDiv);
    return {
      rate,
      rateLabel: tempoDiv > 1 ? `${R.label}, tempo ÷${tempoDiv}` : R.label,
      syncRate: R.syncRate,
      syncQuarters: R.syncQuarters,
      tempoDiv,
      sourceTempo: midi.tempo,
      patLen,
      chunkBars,
      perSection,
      sectionBars: variable ? 'varies' : sectionBars,
      variableScenes: variable,
      nSections,
      startBar: Math.round(startTick / barTicks),
      leadBars: Math.round((baseStart - startTick) / barTicks),
      barTicks,
      startTick,
      microTicks,
      tempo: clamp(projectTempo, 40, 240),
      tempoClamped: projectTempo < 40 || projectTempo > 240,
      active,
      contents,
      drumDefaults,
      kit: opt.kit,
      projects: outProjects,
      warnings: warn,
    };
  }
}

// Smallest p dividing the list length such that the list repeats every p entries.
function period(k) {
  for (let p = 1; p < k.length; p++) {
    if (k.length % p) continue;
    if (k.every((x, i) => x === k[i % p])) return p;
  }
  return k.length;
}

// Find `seq` as a run of consecutive patterns already stored, or append it.
function findOrAdd(store, seq) {
  for (let i = 0; i + seq.length <= store.length; i++) {
    if (seq.every((k, j) => store[i + j] === k)) return i;
  }
  // Allow a run to start in the last few stored patterns and extend past the end.
  for (let i = Math.max(0, store.length - seq.length + 1); i < store.length; i++) {
    const tail = store.length - i;
    if (seq.slice(0, tail).every((k, j) => store[i + j] === k)) {
      store.push(...seq.slice(tail));
      return i;
    }
  }
  store.push(...seq);
  return store.length - seq.length;
}

// Replace each pattern that is at least `threshold` similar (shared notes / all notes) to an
// earlier distinct pattern with that pattern. Notes are compared by position and pitch
// (drums: position and sound), ignoring velocity and length.
function mergeSimilar(chunks, synth, threshold, warn) {
  const ids = (ch) => new Set(synth
    ? ch.steps.flatMap((s) => s.notes.map((n) => `${s.step}.${n.delay}.${n.note}`))
    : ch.steps.flatMap((s) => [...Array(6).keys()].filter((b) => s.mask >> b & 1).map((b) => `${s.step}.${b}.${s.part}`)));
  const reps = [];          // { ch, set }
  const seen = new Map();   // key -> rep chunk
  for (const ch of chunks) {
    if (!ch.key || seen.has(ch.key)) continue;
    const set = ids(ch);
    let best = null, bestSim = 0;
    for (const r of reps) {
      let inter = 0;
      for (const x of set) if (r.set.has(x)) inter++;
      const sim = inter / (set.size + r.set.size - inter);
      if (sim > bestSim) { bestSim = sim; best = r; }
    }
    if (best && bestSim >= threshold) {
      let inter = 0;
      for (const x of set) if (best.set.has(x)) inter++;
      warn.similarNotes += set.size + best.set.size - 2 * inter;
      warn.similarPatterns++;
      seen.set(ch.key, best.ch);
    } else {
      reps.push({ ch, set });
      seen.set(ch.key, ch);
    }
  }
  for (const ch of chunks) {
    const r = ch.key && seen.get(ch.key);
    if (r && r !== ch) { ch.steps = r.steps; ch.key = r.key; }
  }
}

function normaliseSynth(ch, warn, loose) {
  const bySteps = new Map();
  for (const it of ch.items) {
    if (!bySteps.has(it.step)) bySteps.set(it.step, []);
    bySteps.get(it.step).push(it);
  }
  const steps = [];
  for (const [step, list] of [...bySteps].sort((a, b) => a[0] - b[0])) {
    // One slot per pitch per step: keep the longest.
    const uniq = new Map();
    for (const it of list) {
      const prev = uniq.get(it.note);
      if (!prev || it.len > prev.len) uniq.set(it.note, it);
    }
    let notes = [...uniq.values()];
    if (notes.length > MAX_NOTES) {
      // Keep the top and bottom notes, then the loudest of the rest.
      notes.sort((a, b) => a.note - b.note);
      const keep = [notes[0], notes[notes.length - 1]];
      const rest = notes.slice(1, -1).sort((a, b) => b.vel - a.vel).slice(0, MAX_NOTES - 2);
      warn.dropped += notes.length - MAX_NOTES;
      notes = [...keep, ...rest];
    }
    notes.sort((a, b) => a.delay - b.delay || a.note - b.note);
    steps.push({ step, notes: notes.map(({ note, vel, delay, len }) => ({ note, vel, delay, len })) });
  }
  ch.steps = steps;
  // Loose matching ignores velocity and rounds note length to whole steps, so a repeat
  // played with slightly different dynamics still reuses the same pattern.
  ch.key = steps.length ? JSON.stringify(steps.map((s) => [s.step, s.notes.map((n) => loose
    ? [n.note, n.delay, Math.max(1, Math.round(n.len / MICRO))]
    : [n.note, n.vel, n.delay, n.len])])) : '';
  delete ch.items;
}

function normaliseDrum(ch, warn, loose) {
  const bySteps = new Map();
  for (const it of ch.items) {
    if (!bySteps.has(it.step)) bySteps.set(it.step, []);
    bySteps.get(it.step).push(it);
  }
  const steps = [];
  for (const [step, list] of [...bySteps].sort((a, b) => a[0] - b[0])) {
    // One sample per step on the Tracks: keep the loudest part; extra hits of the same
    // part in the step become micro-hits (flams and rolls).
    const byPart = new Map();
    for (const it of list) {
      const e = byPart.get(it.part) ?? { part: it.part, vel: 0, mask: 0, n: 0 };
      e.vel = Math.max(e.vel, it.vel); e.mask |= 1 << it.tick; e.n++;
      byPart.set(it.part, e);
    }
    const parts = [...byPart.values()].sort((a, b) => b.vel - a.vel || b.n - a.n);
    for (const p of parts.slice(1)) warn.drumDropped += p.n;
    const p = parts[0];
    steps.push({ step, part: p.part, vel: clamp(p.vel, 1, 127), mask: p.mask });
  }
  ch.steps = steps;
  ch.key = steps.length ? JSON.stringify(steps.map((s) => loose ? [s.step, s.part, s.mask] : [s.step, s.part, s.vel, s.mask])) : '';
  delete ch.items;
}

// What each track plays, in order, as [{ project, scene, section, chunk (global), pattern }].
// Used by the arrangement view and by preview playback.
export function playOrder(plan) {
  const out = [];
  for (const p of plan.projects) {
    for (const [si, sc] of p.scenes.entries()) {
      const len = Math.max(...sc.chains.map((c) => c.len));
      for (let c = 0; c < len; c++) {
        out.push({
          project: p.index,
          scene: si,
          section: sc.section,
          chunk: sc.firstChunk + c,
          patterns: sc.chains.map((ch) => ch.start + (c % ch.len)),
        });
      }
    }
  }
  return out;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
