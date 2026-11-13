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

// Kit layout in TracksGM_v1: kit k uses sample slots k*8 .. k*8+7 in this order.
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
// A drum hit's track (0-3) and sound. Hits from a Circuit pack carry their own sample slot,
// written '#<slot>' (js/build.js turns it back into the slot); MIDI hits use a kit part.
// Circuit Tracks drum hits keep their drum track (`lane`); others go by their GM drum note.
export function laneOf(n) { return n.lane ?? gmDrum(n.drumNote ?? n.note)[0]; }
export function partOf(n) { return n.slot != null ? `#${n.slot}` : gmDrum(n.note)[1]; }
// Project colours as stored in the .ncs header (0-13), with the RGB the Tracks shows
// (circuit-tracks-tools docs/ncs-format.md, "Project Color Table").
export const PROJECT_COLOURS = [
  ['Red', [251, 53, 53]], ['Rose', [250, 52, 116]], ['Peach', [250, 130, 125]],
  ['Orange', [250, 163, 52]], ['Sand', [250, 195, 125]], ['Yellow', [250, 242, 52]],
  ['Khaki', [219, 250, 125]], ['Lime', [161, 239, 26]], ['Green', [52, 250, 55]],
  ['Teal', [75, 250, 134]], ['Cyan', [52, 175, 250]], ['Blue', [52, 87, 250]],
  ['Purple', [110, 52, 250]], ['Pink', [250, 75, 206]],
];
// R O Y G B I V; and every shade from red to purple in hue order.
const RAINBOW = [0, 3, 5, 8, 10, 11, 12];
// scheme: 'rainbow' | a single colour number 0-13
export function projectColours(n, scheme = 'rainbow') {
  const seq = scheme === 'rainbow' ? RAINBOW : [Number(scheme) % 14];
  return Array.from({ length: n }, (_, i) => seq[i % seq.length]);
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
//   rate: 'auto' | 16 | 8 | 4     step rate of every pattern; 'track': a step rate per track
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
    ? drumSrcs.flatMap((s) => s.notes.filter((n) => !muted(s.id, n.tick) && !muted(`lane${4 + laneOf(n)}`, n.tick)).map(quant))
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
  // Each candidate is a step rate per track (index 0-7). 'auto' and a fixed rate give every
  // track the same rate, as before. 'track' also tries a rate per track: each track's own
  // preferred rate (a Circuit pack's tracks carry theirs), and the longest rate that keeps
  // that track's timing; the same-rate layouts stay in the running, so it is never worse.
  const candidates = opt.rate === 'auto' || opt.rate === 'track' ? AUTO_RATES.map((r) => Array(8).fill(r)) : [Array(8).fill(Number(opt.rate))];
  if (opt.rate === 'track') {
    for (const plan of trackRatePlans()) if (!candidates.some((c) => c.every((x, i) => !active[i] || x === plan[i]))) candidates.push(plan);
  }
  const results = [];
  for (const rates of candidates) {
    let bestForRate = null;
    const coarse = coarsest(rates);
    const pb = patternBars(coarse, tempoDiv, midi.timeSig);
    const sectionChoices = opt.sectionBars === 'auto'
      ? [...new Set([Math.max(8, pb ?? 8), pb].filter(Boolean)), 'var']
      : [Number(opt.sectionBars)];
    for (const sectionBars of sectionChoices) {
      const offsets = opt.align ? Array.from({ length: Math.min(MAX_ALIGN, sectionBars === 'var' ? (pb ?? 8) : sectionBars) }, (_, k) => k) : [0];
      for (const k of offsets) {
        const r = tryRate(rates, baseStart - k * barTicks, sectionBars);
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
  // Per track: also count notes lost to the step grid (merged, or dropped from a full step).
  const lost = (r) => (opt.rate === 'track' ? (r.warnings.merged + r.warnings.dropped + r.warnings.drumDropped) / Math.max(1, r.warnings.total) : 0);
  const keep = results.filter((r) => r.warnings.movedRatio + lost(r) <= MOVED_LIMIT);
  // Per track, when nothing is that close: the layouts within 2% of the least loss.
  const least = Math.min(...results.map((r) => r.warnings.movedRatio + lost(r)));
  const pool = keep.length ? keep : opt.rate === 'track' ? results.filter((r) => r.warnings.movedRatio + lost(r) <= least + MOVED_LIMIT) : results;
  pool.sort((a, b) => score(a) - score(b) || b.fineness - a.fineness);
  const best = pool[0];
  best.alternatives = results.map((r) => ({ rate: r.mixed ? 'track' : r.rate, rates: r.trackRates.map((x) => x.rate), projects: r.projects.length, moved: r.warnings.moved, lost: r.warnings.merged + r.warnings.dropped + r.warnings.drumDropped }));
  return best;

  // The longest (coarsest) step rate among the active tracks.
  function coarsest(rates) {
    const act = rates.filter((_, t) => active[t]);
    return Math.min(...(act.length ? act : rates));
  }

  // Per-track rate plans: preferred rates from the sources (finest of a track's sources),
  // and per track the longest rate whose grid keeps its notes in place (at most 2% moved).
  function trackRatePlans() {
    const plans = [];
    const srcRates = (t) => (t < 4 ? pick(MELODIC_ROLES[t]) : drumSrcs).map((s) => s.rate).filter((x) => RATES[x]);
    const own = Array.from({ length: 8 }, (_, t) => {
      const rs = t < 4 ? srcRates(t) : (drumHits ?? []).filter((n) => laneOf(n) === t - 4).map((n) => n.rate).filter((x) => RATES[x]);
      return rs.length ? Math.max(...rs) : null;
    });
    if (own.some((x, t) => active[t] && x)) plans.push(own.map((x) => x ?? 16));
    const notesOf = (t) => (t < 4 ? melodic[t] ?? [] : (drumHits ?? []).filter((n) => laneOf(n) === t - 4));
    // What a rate costs a track: notes moved off their time, and notes lost (two of one
    // pitch in a step on a synth, two different sounds in a step on a drum track).
    const cost = (t, rate) => {
      const ns = notesOf(t);
      if (!ns.length) return 0;
      const step = midi.ppq * RATES[rate].syncQuarters * tempoDiv;
      const micro = step / MICRO;
      let moved = 0;
      const seen = new Map();
      for (const n of ns) {
        const x = n.tick - baseStart;
        const pos = Math.round(x / micro);
        if (Math.abs(pos * micro - x) > midi.ppq / 16) moved++;
        const s = Math.floor(pos / MICRO);
        const key = t < 4 ? `${s}:${n.note}` : `${s}`;
        const what = t < 4 ? 1 : partOf(n);
        if (!seen.has(key)) seen.set(key, new Set());
        seen.get(key).add(t < 4 ? seen.get(key).size : what);
      }
      let lostN = 0;
      for (const v of seen.values()) lostN += v.size - 1;
      return moved + lostN;
    };
    // Per track: the longest rate that costs at most 2% of its notes more than the finest
    // rate does (some losses, such as two sounds sharing a drum track, happen at any rate).
    plans.push(Array.from({ length: 8 }, (_, t) => {
      const n = notesOf(t).length;
      const best = cost(t, 16);
      return [4, 8, 16].find((rate) => cost(t, rate) - best <= MOVED_LIMIT * n) ?? 16;
    }));
    return plans;
  }

  // Fewer projects first, then fewer added lead-in bars (silence), then fewer patterns.
  function score(r) {
    const pats = r.projects.reduce((a, p) => a + p.patternCounts.reduce((x, y) => x + y, 0), 0);
    return r.projects.length * 1e6 + r.leadBars * 1000 + pats;
  }

  // rates: a step rate (RATES key) per track. The scene grid is cut into chunks of the
  // coarsest track's pattern length; a track with a finer rate fills each chunk with k
  // shorter patterns (k = chunk bars / its pattern bars). With one rate for all, k = 1.
  function tryRate(rates, startTick, sectionBars) {
    const coarse = coarsest(rates);
    rates = rates.map((x, t) => (active[t] ? x : coarse));
    const R = RATES[coarse];
    const variable = sectionBars === 'var';
    const chunkBars = patternBars(coarse, tempoDiv, midi.timeSig, variable ? 32 : sectionBars);
    if (!chunkBars) return null;
    const perSection = variable ? 1 : sectionBars / chunkBars;   // patterns per section
    if (perSection > MAX_PATTERNS) return null;
    const tr = rates.map((rate) => {
      const Rt = RATES[rate];
      const patBars = patternBars(rate, tempoDiv, midi.timeSig, chunkBars);
      if (!patBars) return null;
      const stepTicks = midi.ppq * Rt.syncQuarters * tempoDiv;
      const spb = Math.round(barTicks / stepTicks);
      const patLen = patBars * spb;
      return { rate, label: Rt.label, syncRate: Rt.syncRate, syncQuarters: Rt.syncQuarters, patBars, k: chunkBars / patBars, patLen, microTicks: stepTicks / MICRO, chunkMicro: patLen * MICRO };
    });
    if (tr.some((x) => !x)) return null;
    const mixed = tr.some((x) => x.rate !== coarse);
    const patLen = tr.find((x) => x.rate === coarse).patLen;     // steps per pattern on the coarsest track
    const microTicks = tr.find((x) => x.rate === coarse).microTicks;
    const nChunks = Math.max(1, Math.ceil((lastTick - startTick) / (chunkBars * barTicks) - 1e-9));
    const nSections = Math.ceil(nChunks / perSection);
    const totalChunks = nSections * perSection;
    const warn = { dropped: 0, drumDropped: 0, merged: 0, held: 0, beforeStart: 0, moved: 0, total: 0, similarNotes: 0, similarPatterns: 0 };
    const MOVE_TOL = midi.ppq / 16;    // a 1/64 note
    const countMove = (n, pos, mt) => {
      warn.total++;
      if (Math.abs(pos * mt - (n.tick - startTick)) > MOVE_TOL) warn.moved++;
    };

    // ---- per-track pattern contents ----
    const contents = []; // contents[t][chunk * k + sub] = { steps, key }
    for (let t = 0; t < 8; t++) contents.push(Array.from({ length: totalChunks * tr[t].k }, () => ({ items: [] })));

    melodic.forEach((notes, t) => {
      if (!notes) return;
      const { microTicks, chunkMicro } = tr[t];
      const nPat = totalChunks * tr[t].k;
      for (const n of notes) {
        let pos = Math.round((n.tick - startTick) / microTicks);
        if (pos < 0) { warn.beforeStart++; continue; }
        countMove(n, pos, microTicks);
        let len = Math.max(1, Math.round(n.dur / microTicks));
        // Notes that run past the end of a pattern are cut there and struck again at the
        // start of the next pattern, because each pattern is stored separately.
        let first = true;
        while (len > 0) {
          const c = Math.floor(pos / chunkMicro);
          if (c >= nPat) break;
          const local = pos - c * chunkMicro;
          const room = chunkMicro - local;
          const l = Math.min(len, room);
          contents[t][c].items.push({ step: Math.floor(local / MICRO), delay: local % MICRO, note: clamp(n.note + 12, 1, 127), vel: clamp(n.vel, 1, 127), len: l, cont: !first });
          if (!first) warn.held++;
          first = false;
          len -= l;
          pos += l;
        }
      }
    });

    if (drumHits) {
      for (const n of drumHits) {
        const dt = laneOf(n), part = partOf(n);
        const { microTicks, chunkMicro, k } = tr[4 + dt];
        const pos = Math.round((n.tick - startTick) / microTicks);
        if (pos < 0) { warn.beforeStart++; continue; }
        countMove(n, pos, microTicks);
        const c = Math.floor(pos / chunkMicro);
        if (c >= totalChunks * k) continue;
        const local = pos - c * chunkMicro;
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
      const keys = (t) => contents[t].slice(c0 * tr[t].k, c1 * tr[t].k).map((c) => c.key);
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
      // (Covered = chain length x pattern length; tracks that already cover most come first,
      // then the coarsest, which needs the fewest patterns.)
      if (L > 1 && !chains.some((c, t) => active[t] && c.len === L * tr[t].k)) {
        let t = [0, 1, 2, 3, 4, 5, 6, 7].filter((x) => active[x])
          .sort((x, y) => chains[y].len / tr[y].k - chains[x].len / tr[x].k || tr[x].k - tr[y].k)
          .find((x) => keys(x)[0] !== '');
        if (t === undefined) t = active.findIndex(Boolean);
        chains[t] = { start: findOrAdd(store[t], keys(t)), len: L * tr[t].k };
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
    const label = mixed ? 'step rate per track' : R.label;
    return {
      rate: coarse,
      mixed,
      fineness: tr.reduce((a, x, t) => a + (active[t] ? x.rate : 0), 0),
      trackRates: tr.map(({ rate, label, syncRate, syncQuarters, patBars, k, patLen }) => ({ rate, label, syncRate, syncQuarters, patBars, k, patLen })),
      rateLabel: tempoDiv > 1 ? `${label}, tempo ÷${tempoDiv}` : label,
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
    // One slot per pitch per step: keep the longest (counted as merged).
    const uniq = new Map();
    for (const it of list) {
      const prev = uniq.get(it.note);
      if (prev && !it.cont && !prev.cont) warn.merged++;
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
    const k = (t) => plan.trackRates?.[t].k ?? 1;
    for (const [si, sc] of p.scenes.entries()) {
      const len = Math.max(...sc.chains.map((c, t) => Math.ceil(c.len / k(t))));
      for (let c = 0; c < len; c++) {
        // sub[t]: the k patterns track t plays in this chunk; patterns[t]: the first of them.
        const sub = sc.chains.map((ch, t) => Array.from({ length: k(t) }, (_, j) => ch.start + ((c * k(t) + j) % ch.len)));
        out.push({
          project: p.index,
          scene: si,
          section: sc.section,
          chunk: sc.firstChunk + c,
          patterns: sub.map((s) => s[0]),
          sub,
        });
      }
    }
  }
  return out;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
