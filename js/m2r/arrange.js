// MIDI2Rhythm arrangement: eight mono tracks (js/m2r/engine.js) -> Circuit Rhythm projects.
//
// Works like MIDI2Circuit's arranger (js/convert.js): the song is cut into patterns of up to
// 32 steps, grouped into sections; each section is one scene, identical patterns are reused,
// and when a project runs out of patterns (8 per track) or scenes (16) the song continues in
// the next project. Each track can have its own step rate ("Per track: keep notes").
//
// A Circuit Rhythm step holds one note: [note byte, gate, micro mask, velocity, probability,
// sample]. Two different notes landing in one step on a track can't both play: the earlier
// (then louder) one is kept and the other counted as lost.

export const MICRO = 6;
export const MAX_STEPS = 32;
export const MAX_PATTERNS = 8;
export const MAX_SCENES = 16;
export const MAX_PROJECTS = 64;
const MAX_GATE = 96;
export const RATES = {
  16: { syncRate: 3, syncQuarters: 1 / 4, label: '1/16 steps' },
  8: { syncRate: 5, syncQuarters: 1 / 2, label: '1/8 steps' },
  4: { syncRate: 7, syncQuarters: 1, label: '1/4 steps' },
};
const AUTO_RATES = [16, 8, 4];
const MOVED_LIMIT = 0.02;
const MAX_ALIGN = 8;

function patternBars(rate, tempoDiv, timeSig, sectionBars = 32) {
  const stepsPerBar = (4 * timeSig.num / timeSig.den) / (RATES[rate].syncQuarters * tempoDiv);
  if (Math.abs(stepsPerBar - Math.round(stepsPerBar)) > 1e-6 || stepsPerBar > MAX_STEPS || stepsPerBar < 1) return null;
  for (let b = Math.min(sectionBars, Math.floor(MAX_STEPS / Math.round(stepsPerBar))); b >= 1; b--) {
    if (sectionBars % b === 0) return b;
  }
  return null;
}

// tracks: [{ notes: [{ tick, dur, vel, byte, sample }], defaultSample }]
// opts: { rate: 'track'|'auto'|16|8|4, sectionBars: 'auto'|4|8|16|32, match: 'loose'|'exact',
//         tempoDiv: 1|2|4, trimStart: true, align: true, mutes: Set(track index) }
export function arrangeRhythm(midi, tracks, opts = {}) {
  const opt = { rate: 'track', sectionBars: 'auto', match: 'loose', tempoDiv: 1, trimStart: true, align: true, ...opts };
  const tempoDiv = Number(opt.tempoDiv) || 1;
  const N = 8;
  const lines = Array.from({ length: N }, (_, t) => (tracks[t] && !opt.mutes?.has(t) ? tracks[t].notes : null));
  const active = lines.map((l) => !!(l && l.length));
  const all = lines.filter(Boolean).flat();
  if (!all.length) return { error: 'There is nothing to play: turn on at least one part.' };
  if (midi.tempo / tempoDiv < 39.5) return { error: `Dividing ${Math.round(midi.tempo)} BPM by ${tempoDiv} goes below the Circuit Rhythm minimum of 40 BPM. Choose a smaller tempo division.` };
  const barTicks = midi.ppq * 4 * midi.timeSig.num / midi.timeSig.den;
  const firstTick = Math.min(...all.map((n) => n.tick));
  const lastTick = Math.max(...all.map((n) => n.tick + (n.dur ?? 0)));
  const baseStart = opt.trimStart ? Math.floor(firstTick / barTicks + 1e-9) * barTicks : 0;

  const candidates = opt.rate === 'auto' || opt.rate === 'track' ? AUTO_RATES.map((r) => Array(N).fill(r)) : [Array(N).fill(Number(opt.rate))];
  if (opt.rate === 'track') {
    const plan = perTrackRates();
    if (!candidates.some((c) => c.every((x, i) => !active[i] || x === plan[i]))) candidates.push(plan);
  }
  const results = [];
  for (const rates of candidates) {
    let best = null;
    const coarse = coarsest(rates);
    const pb = patternBars(coarse, tempoDiv, midi.timeSig);
    const sectionChoices = opt.sectionBars === 'auto' ? [...new Set([Math.max(8, pb ?? 8), pb].filter(Boolean)), 'var'] : [Number(opt.sectionBars)];
    for (const sb of sectionChoices) {
      const offsets = opt.align ? Array.from({ length: Math.min(MAX_ALIGN, sb === 'var' ? (pb ?? 8) : sb) }, (_, k) => k) : [0];
      for (const k of offsets) {
        const r = tryRates(rates, baseStart - k * barTicks, sb);
        if (r && (!best || score(r) < score(best))) best = r;
      }
    }
    if (best) results.push(best);
  }
  if (!results.length) return { error: `These settings don't fit a ${midi.timeSig.num}/${midi.timeSig.den} bar in whole steps. Try a different pattern length or tempo.` };
  const loss = (r) => r.warnings.movedRatio + (opt.rate === 'track' ? r.warnings.lost / Math.max(1, r.warnings.total) : 0);
  const keep = results.filter((r) => loss(r) <= MOVED_LIMIT);
  const least = Math.min(...results.map(loss));
  const pool = keep.length ? keep : opt.rate === 'track' ? results.filter((r) => loss(r) <= least + MOVED_LIMIT) : results;
  pool.sort((a, b) => score(a) - score(b) || b.fineness - a.fineness);
  return pool[0];

  function coarsest(rates) {
    const act = rates.filter((_, t) => active[t]);
    return Math.min(...(act.length ? act : rates));
  }
  function score(r) {
    const pats = r.projects.reduce((a, p) => a + p.patternCounts.reduce((x, y) => x + y, 0), 0);
    return r.projects.length * 1e6 + r.leadBars * 1000 + pats;
  }
  // Per track: the longest step rate that costs at most 2% of its notes more than 1/16 does.
  function perTrackRates() {
    const cost = (t, rate) => {
      const ns = lines[t] ?? [];
      const stepT = midi.ppq * RATES[rate].syncQuarters * tempoDiv;
      const micro = stepT / MICRO;
      let moved = 0;
      const seen = new Map();
      for (const n of ns) {
        const x = n.tick - baseStart;
        const pos = Math.round(x / micro);
        if (Math.abs(pos * micro - x) > midi.ppq / 16) moved++;
        const s = Math.floor(pos / MICRO);
        const key = `${n.byte}.${n.sample}`;
        if (!seen.has(s)) seen.set(s, new Set());
        seen.get(s).add(key);
      }
      let lost = 0;
      for (const v of seen.values()) lost += v.size - 1;
      return moved + lost;
    };
    return Array.from({ length: N }, (_, t) => {
      if (!active[t]) return 16;
      const n = lines[t].length, best = cost(t, 16);
      return [4, 8, 16].find((r) => cost(t, r) - best <= MOVED_LIMIT * n) ?? 16;
    });
  }

  function tryRates(rates, startTick, sectionBars) {
    const coarse = coarsest(rates);
    rates = rates.map((x, t) => (active[t] ? x : coarse));
    const variable = sectionBars === 'var';
    const chunkBars = patternBars(coarse, tempoDiv, midi.timeSig, variable ? 32 : sectionBars);
    if (!chunkBars) return null;
    const perSection = variable ? 1 : sectionBars / chunkBars;
    if (perSection > MAX_PATTERNS) return null;
    const tr = rates.map((rate) => {
      const R = RATES[rate];
      const patBars = patternBars(rate, tempoDiv, midi.timeSig, chunkBars);
      if (!patBars) return null;
      const stepTicks = midi.ppq * R.syncQuarters * tempoDiv;
      const patLen = patBars * Math.round(barTicks / stepTicks);
      return { rate, label: R.label, syncRate: R.syncRate, patBars, k: chunkBars / patBars, patLen, microTicks: stepTicks / MICRO, chunkMicro: patLen * MICRO, stepTicks };
    });
    if (tr.some((x) => !x)) return null;
    const nChunks = Math.max(1, Math.ceil((lastTick - startTick) / (chunkBars * barTicks) - 1e-9));
    let nSections = Math.ceil(nChunks / perSection);
    let totalChunks = nSections * perSection;
    const warn = { moved: 0, total: 0, lost: 0, beforeStart: 0, cut: 0 };

    const contents = [];
    for (let t = 0; t < N; t++) contents.push(Array.from({ length: totalChunks * tr[t].k }, () => ({ items: [] })));
    lines.forEach((notes, t) => {
      if (!notes) return;
      const { microTicks, chunkMicro } = tr[t];
      const nPat = totalChunks * tr[t].k;
      for (const n of notes) {
        const pos = Math.round((n.tick - startTick) / microTicks);
        if (pos < 0) { warn.beforeStart++; continue; }
        warn.total++;
        if (Math.abs(pos * microTicks - (n.tick - startTick)) > midi.ppq / 16) warn.moved++;
        const c = Math.floor(pos / chunkMicro);
        if (c >= nPat) continue;
        const local = pos - c * chunkMicro;
        let len = Math.max(1, Math.round(n.dur / microTicks));
        if (len > chunkMicro - local) { len = chunkMicro - local; warn.cut++; }
        contents[t][c].items.push({ step: Math.floor(local / MICRO), delay: local % MICRO, byte: n.byte, sample: n.sample, vel: clamp(n.vel, 1, 127), len });
      }
    });
    const loose = opt.match !== 'exact';
    for (let t = 0; t < N; t++) for (const ch of contents[t]) normalise(ch, warn, loose);
    // Silence at the end (a long last note, or parts left out) gets no scenes of its own.
    let lastUsed = 0;
    for (let t = 0; t < N; t++) contents[t].forEach((ch, i) => { if (ch.key) lastUsed = Math.max(lastUsed, Math.floor(i / tr[t].k)); });
    nSections = Math.max(1, Math.ceil((lastUsed + 1) / perSection));
    totalChunks = nSections * perSection;
    for (let t = 0; t < N; t++) contents[t].length = totalChunks * tr[t].k;

    const projects = [];
    const newProject = () => ({ scenes: [], store: Array.from({ length: N }, () => []) });
    let cur = newProject();
    const storeSize = (st) => st.reduce((a, x) => a + x.length, 0);
    if (!variable) {
      for (let sec = 0; sec < nSections; sec++) {
        let placed = place(cur, sec * perSection, (sec + 1) * perSection);
        if (!placed && cur.scenes.length) { projects.push(cur); cur = newProject(); placed = place(cur, sec * perSection, (sec + 1) * perSection); }
        if (!placed) return null;
        commit(cur, placed, sec);
      }
    } else {
      let i = 0;
      while (i < totalChunks) {
        let best = place(cur, i, i + 1);
        if (!best) { projects.push(cur); cur = newProject(); best = place(cur, i, i + 1); if (!best) return null; }
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

    function commit(proj, placed, section) { proj.store = placed.store; proj.scenes.push({ ...placed.scene, section }); }
    function place(proj, c0, c1) {
      if (proj.scenes.length >= MAX_SCENES) return null;
      const L = c1 - c0;
      const store = proj.store.map((x) => x.slice());
      const chains = [];
      const keys = (t) => contents[t].slice(c0 * tr[t].k, c1 * tr[t].k).map((c) => c.key);
      for (let t = 0; t < N; t++) {
        if (!active[t]) { chains.push({ start: 0, len: 1 }); continue; }
        const k = keys(t);
        const p = period(k);
        chains.push({ start: findOrAdd(store[t], k.slice(0, p)), len: p });
      }
      if (L > 1 && !chains.some((c, t) => active[t] && c.len === L * tr[t].k)) {
        let t = [...Array(N).keys()].filter((x) => active[x])
          .sort((x, y) => chains[y].len / tr[y].k - chains[x].len / tr[x].k || tr[x].k - tr[y].k)
          .find((x) => keys(x)[0] !== '');
        if (t === undefined) t = active.findIndex(Boolean);
        chains[t] = { start: findOrAdd(store[t], keys(t)), len: L * tr[t].k };
      }
      if (store.some((x) => x.length > MAX_PATTERNS)) return null;
      return { store, scene: { firstChunk: c0, chains: chains.map((c) => ({ start: c.start, end: c.start + c.len - 1, len: c.len })) } };
    }

    const byKey = Array.from({ length: N }, () => new Map());
    for (let t = 0; t < N; t++) for (const ch of contents[t]) if (!byKey[t].has(ch.key)) byKey[t].set(ch.key, ch);
    const outProjects = projects.map((p, i) => ({
      index: i,
      scenes: p.scenes,
      patterns: p.store.map((keys, t) => keys.map((k) => byKey[t].get(k))),
      patternCounts: p.store.map((s) => s.length),
    }));
    warn.movedRatio = warn.total ? warn.moved / warn.total : 0;
    const projectTempo = Math.round(midi.tempo / tempoDiv);
    return {
      rate: coarse,
      mixed: tr.some((x) => x.rate !== coarse),
      fineness: tr.reduce((a, x, t) => a + (active[t] ? x.rate : 0), 0),
      trackRates: tr.map(({ rate, label, syncRate, patBars, k, patLen, stepTicks }) => ({ rate, label, syncRate, patBars, k, patLen, stepTicks })),
      tempoDiv,
      chunkBars,
      sectionBars: variable ? 'varies' : sectionBars,
      nSections,
      leadBars: Math.round((baseStart - startTick) / barTicks),
      barTicks,
      startTick,
      tempo: clamp(projectTempo, 40, 240),
      tempoClamped: projectTempo < 40 || projectTempo > 240,
      active,
      contents,
      projects: outProjects,
      tooLong: outProjects.length > MAX_PROJECTS,
      warnings: warn,
    };
  }
}

// One note per step: the same note and sample twice in a step becomes micro-hits (a flam);
// a different note or sample in the same step is lost (the earlier, then louder, one stays).
function normalise(ch, warn, loose) {
  const by = new Map();
  for (const it of ch.items) { if (!by.has(it.step)) by.set(it.step, []); by.get(it.step).push(it); }
  const steps = [];
  for (const [step, list] of [...by].sort((a, b) => a[0] - b[0])) {
    list.sort((a, b) => a.delay - b.delay || b.vel - a.vel);
    const first = list[0];
    const e = { step, byte: first.byte, sample: first.sample, vel: first.vel, mask: 0, gate: 0 };
    for (const it of list) {
      if (it.byte === first.byte && it.sample === first.sample) {
        e.mask |= 1 << it.delay;
        e.vel = Math.max(e.vel, it.vel);
        e.gate = Math.max(e.gate, it.delay + it.len);
      } else warn.lost++;
    }
    e.gate = Math.max(1, Math.min(MAX_GATE, e.gate));
    steps.push(e);
  }
  ch.steps = steps;
  ch.key = steps.length ? JSON.stringify(steps.map((s) => (loose
    ? [s.step, s.byte, s.sample, s.mask, Math.max(1, Math.round(s.gate / MICRO))]
    : [s.step, s.byte, s.sample, s.mask, s.gate, s.vel]))) : '';
  delete ch.items;
}

function period(k) {
  for (let p = 1; p < k.length; p++) {
    if (k.length % p) continue;
    if (k.every((x, i) => x === k[i % p])) return p;
  }
  return k.length;
}
function findOrAdd(store, seq) {
  for (let i = 0; i + seq.length <= store.length; i++) if (seq.every((k, j) => store[i + j] === k)) return i;
  for (let i = Math.max(0, store.length - seq.length + 1); i < store.length; i++) {
    const tail = store.length - i;
    if (seq.slice(0, tail).every((k, j) => store[i + j] === k)) { store.push(...seq.slice(tail)); return i; }
  }
  store.push(...seq);
  return store.length - seq.length;
}

// What each track plays, in order (as js/convert.js playOrder): for the grid and preview.
export function playOrder(plan) {
  const out = [];
  for (const p of plan.projects) {
    const k = (t) => plan.trackRates[t].k;
    for (const [si, sc] of p.scenes.entries()) {
      const len = Math.max(...sc.chains.map((c, t) => Math.ceil(c.len / k(t))));
      for (let c = 0; c < len; c++) {
        const sub = sc.chains.map((ch, t) => Array.from({ length: k(t) }, (_, j) => ch.start + ((c * k(t) + j) % ch.len)));
        out.push({ project: p.index, scene: si, section: sc.section, chunk: sc.firstChunk + c, patterns: sub.map((s) => s[0]), sub });
      }
    }
  }
  return out;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
