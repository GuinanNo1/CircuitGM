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

// Pattern lengths. stepQuarter = how much of the song (in quarter notes) one step covers;
// syncRate = the pattern's step rate on the Tracks; tempoDiv = how much the project tempo is
// divided by. Slower than 1/4 steps needs a lower project tempo, because 1/4 is the slowest
// step rate a pattern can have.
export const RATES = {
  16: { stepQuarter: 1 / 4, syncRate: 3, syncQuarters: 1 / 4, tempoDiv: 1, label: '1/16 steps' },
  8: { stepQuarter: 1 / 2, syncRate: 5, syncQuarters: 1 / 2, tempoDiv: 1, label: '1/8 steps' },
  4: { stepQuarter: 1, syncRate: 7, syncQuarters: 1, tempoDiv: 1, label: '1/4 steps' },
  2: { stepQuarter: 2, syncRate: 7, syncQuarters: 1, tempoDiv: 2, label: '1/4 steps at half tempo' },
  1: { stepQuarter: 4, syncRate: 7, syncQuarters: 1, tempoDiv: 4, label: '1/4 steps at quarter tempo' },
};
const AUTO_RATES = [16, 8, 4];
const MOVED_LIMIT = 0.02;        // Auto skips a step rate that moves more than 2% of notes

// assignment: { S1: [sourceId], S2: [...], M1: [...], M2: [...], DR: [...] }
// options: { rate: 'auto' | 16 | 8 | 4 | 2 | 1, sectionBars: 8, trimStart: true, kit: 0-7,
//            transpose: {S1: 0, ...}, mutes: { all: Set(key), bars: Map(key -> Set(bar)) } }
// Mute keys are source ids, plus 'lane4'..'lane7' for the four drum tracks. Bars count from
// the start of the file (bar 0), so mutes survive changes to the other options.
export function arrange(midi, assignment, options = {}) {
  const opt = { rate: 'auto', sectionBars: 8, trimStart: true, kit: 1, match: 'loose', ...options };
  const byId = new Map(midi.sources.map((s) => [s.id, s]));
  const pick = (role) => (assignment[role] ?? []).map((id) => byId.get(id)).filter(Boolean);

  const barTicks = midi.ppq * 4 * midi.timeSig.num / midi.timeSig.den;
  const mutes = opt.mutes ?? { all: new Set(), bars: new Map() };
  const muted = (key, tick) => mutes.all.has(key) || !!mutes.bars.get(key)?.has(Math.floor(tick / barTicks + 1e-9));

  const melodic = MELODIC_ROLES.map((r) => {
    const srcs = pick(r);
    const shift = opt.transpose?.[r] ?? 0;
    return srcs.length
      ? srcs.flatMap((s) => s.notes.filter((n) => !muted(s.id, n.tick)).map((n) => ({ ...n, note: n.note + shift })))
      : null;
  });
  const drumSrcs = pick('DR');
  const drumHits = drumSrcs.length
    ? drumSrcs.flatMap((s) => s.notes.filter((n) => !muted(s.id, n.tick) && !muted(`lane${4 + gmDrum(n.note)[0]}`, n.tick)))
    : null;
  const active = [...melodic.map(Boolean), ...[0, 1, 2, 3].map(() => !!drumHits)];

  const all = [...melodic.filter(Boolean).flat(), ...(drumHits ?? [])];
  if (!all.length) return { error: active.some(Boolean) ? 'Everything is muted. Unmute a part to build the song.' : 'Choose at least one track with notes.' };
  const firstTick = Math.min(...all.map((n) => n.tick));
  const lastTick = Math.max(...all.map((n) => n.tick + (n.dur ?? 0)));
  const startTick = opt.trimStart ? Math.floor(firstTick / barTicks + 1e-9) * barTicks : 0;

  const candidates = opt.rate === 'auto' ? AUTO_RATES : [Number(opt.rate)];
  const results = [];
  let tempoProblem = false;
  for (const rate of candidates) {
    const r = tryRate(rate);
    if (r === 'tempo') tempoProblem = true;
    else if (r) results.push(r);
  }
  if (!results.length) {
    return { error: tempoProblem
      ? `Dividing ${Math.round(midi.tempo)} BPM by ${RATES[candidates[0]].tempoDiv} goes below the Circuit Tracks minimum of 40 BPM. Choose a shorter pattern length.`
      : `This pattern length doesn't fit a ${midi.timeSig.num}/${midi.timeSig.den} bar in whole steps, or is longer than the section. Try a different pattern or section length.` };
  }
  // Auto: fewest projects among the rates that keep timing (<= 2% of notes moved), finest first.
  const keep = results.filter((r) => r.warnings.movedRatio <= MOVED_LIMIT);
  const pool = keep.length ? keep : results;
  pool.sort((a, b) => a.projects.length - b.projects.length || b.rate - a.rate);
  const best = pool[0];
  best.alternatives = results.map((r) => ({ rate: r.rate, projects: r.projects.length }));
  return best;

  function tryRate(rate) {
    const R = RATES[rate];
    if (midi.tempo / R.tempoDiv < 39.5) return 'tempo';
    const stepTicks = midi.ppq * R.stepQuarter;
    const stepsPerBar = barTicks / stepTicks;
    if (Math.abs(stepsPerBar - Math.round(stepsPerBar)) > 1e-6 || stepsPerBar > MAX_STEPS) return null;
    const spb = Math.round(stepsPerBar);
    let chunkBars = 0;
    for (let b = Math.min(opt.sectionBars, Math.floor(MAX_STEPS / spb)); b >= 1; b--) {
      if (opt.sectionBars % b === 0) { chunkBars = b; break; }
    }
    if (!chunkBars) return null;
    const perSection = opt.sectionBars / chunkBars;          // patterns per section
    if (perSection > MAX_PATTERNS) return null;
    const patLen = chunkBars * spb;                           // steps per pattern
    const chunkMicro = patLen * MICRO;
    const microTicks = stepTicks / MICRO;
    const nChunks = Math.max(1, Math.ceil((lastTick - startTick) / (chunkBars * barTicks) - 1e-9));
    const nSections = Math.ceil(nChunks / perSection);
    const totalChunks = nSections * perSection;
    const warn = { dropped: 0, drumDropped: 0, held: 0, beforeStart: 0, moved: 0, total: 0 };
    const MOVE_TOL = midi.ppq / 16;    // a 1/64 note
    const countMove = (n, pos) => {
      warn.total++;
      if (Math.abs(pos * microTicks - (n.tick - startTick)) > MOVE_TOL) warn.moved++;
    };

    // ---- per-track chunk contents ----
    const contents = []; // contents[t][chunk] = { notes|hits, key }
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
    for (let t = 0; t < 8; t++) {
      for (const ch of contents[t]) {
        if (t < 4) normaliseSynth(ch, warn, opt.match !== 'exact'); else normaliseDrum(ch, warn, opt.match !== 'exact');
      }
    }

    // Default sample per drum track = its most used kit part.
    const drumDefaults = [0, 1, 2, 3].map((dt) => {
      const count = {};
      for (const ch of contents[4 + dt]) for (const s of ch.steps) count[s.part] = (count[s.part] ?? 0) + 1;
      const fallback = ['kick', 'snare', 'ch', 'perc'][dt];
      return Object.entries(count).sort((a, b) => b[1] - a[1])[0]?.[0] ?? fallback;
    });

    // ---- plan projects / scenes / patterns ----
    const projects = [];
    let cur = null;
    const newProject = () => ({ scenes: [], store: Array.from({ length: 8 }, () => []) });
    cur = newProject();
    for (let sec = 0; sec < nSections; sec++) {
      let placed = tryPlace(cur, sec);
      if (!placed && cur.scenes.length) {
        projects.push(cur);
        cur = newProject();
        placed = tryPlace(cur, sec);
      }
      if (!placed) return null;
    }
    if (cur.scenes.length) projects.push(cur);
    if (projects.length > MAX_PROJECTS) warn.tooLong = true;

    function tryPlace(proj, sec) {
      if (proj.scenes.length >= MAX_SCENES) return false;
      const store = proj.store.map((s) => s.slice());
      const chains = [];
      const keys = (t) => contents[t].slice(sec * perSection, (sec + 1) * perSection).map((c) => c.key);
      let anyFull = false;
      for (let t = 0; t < 8; t++) {
        if (!active[t]) { chains.push({ start: 0, end: 0 }); continue; }
        const k = keys(t);
        if (k.every((x) => x === k[0])) {
          chains.push({ start: findOrAdd(store[t], [k[0]]), len: 1 });
        } else {
          anyFull = true;
          chains.push({ start: findOrAdd(store[t], k), len: k.length });
        }
      }
      // A scene lasts as long as its longest chain, so at least one track must chain the
      // whole section. If every track repeats one pattern, extend one of them.
      if (!anyFull && perSection > 1) {
        let t = [0, 1, 2, 3, 4, 5, 6, 7].find((i) => active[i] && keys(i)[0] !== '');
        if (t === undefined) t = active.findIndex(Boolean);
        chains[t] = { start: findOrAdd(store[t], keys(t)), len: perSection };
      }
      if (store.some((s) => s.length > MAX_PATTERNS)) return false;
      proj.store = store;
      proj.scenes.push({
        section: sec,
        chains: chains.map((c) => ({ start: c.start, end: c.start + (c.len ?? 1) - 1, len: c.len ?? 1 })),
      });
      return true;
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
    return {
      rate,
      rateLabel: R.label,
      syncRate: R.syncRate,
      syncQuarters: R.syncQuarters,
      tempoDiv: R.tempoDiv,
      sourceTempo: midi.tempo,
      patLen,
      chunkBars,
      perSection,
      sectionBars: opt.sectionBars,
      nSections,
      startBar: Math.round(startTick / barTicks),
      barTicks,
      startTick,
      microTicks,
      tempo: clamp(Math.round(midi.tempo / R.tempoDiv), 40, 240),
      tempoClamped: Math.round(midi.tempo / R.tempoDiv) < 40 || Math.round(midi.tempo / R.tempoDiv) > 240,
      active,
      contents,
      drumDefaults,
      kit: opt.kit,
      projects: outProjects,
      warnings: warn,
    };
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
          chunk: sc.section * plan.perSection + c,
          patterns: sc.chains.map((ch) => ch.start + (c % ch.len)),
        });
      }
    }
  }
  return out;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
