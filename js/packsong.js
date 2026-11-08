// MIDI2Circuit: one project from a Circuit Tracks or Circuit Rhythm pack, as the same kind of
// parts a MIDI file gives (see js/midifile.js), so the rest of the converter works unchanged.
//
// The project is played through by js/song.js (Circuit2MIDI's reader): scenes in their saved
// order, pattern chains, step timing, micro-steps, gates, ties and swing. Each Circuit track
// with notes becomes one part. Sample hits keep the sample slot they play (`slot`), so the
// converted pack can use the loaded pack's own samples; `note` is still a GM drum note
// guessed from the sample's name, which places the hit on the Kick, Snare/Tom, Hi-hats or
// Perc track. Circuit Tracks drum hits keep their own drum track (`lane`).
import { songOf, renderSong, sceneOrder, defaultOrderKind, defaultMapping, guessProgram, guessDrumNotes, samplesByTrack, PPQ } from './song.js';
import { GM_NAMES } from './midifile.js';

const UNPITCHED = 60;
// Circuit sync rate (0-7) -> the converter's step rates (js/convert.js RATES); the 1/32 and
// triplet rates have no match there.
const RATE_KEY = { 3: 16, 5: 8, 7: 4 };

// Put a part on one Circuit Tracks drum track (0-3), or null to place each hit by its
// sample's name (GM drum note).
export function setLane(source, lane) {
  source.lane = lane;
  for (const n of source.notes) { if (lane == null) delete n.lane; else n.lane = lane; }
}

// Projects that can be converted: saved, readable and with notes.
export function projectChoices(pack) {
  return pack.projects.filter((p) => p.project && !p.empty && !p.error);
}

export function packSong(pack, entry) {
  const song = songOf(pack, entry);
  const rendered = renderSong(song, { order: sceneOrder(song, defaultOrderKind(song)), swing: true, chance: 'keep' });
  const mapping = defaultMapping(song, pack);
  const used = samplesByTrack(song);
  const slots = [...new Set(used.flat())].filter((s) => s != null).sort((a, b) => a - b);
  const drumNote = guessDrumNotes(slots, song.sampleName);
  const rhythm = pack.product === 'circuit-rhythm';

  const sources = [];
  for (const tr of song.tracks) {
    const hits = rendered.hits.filter((h) => h.track === tr.index);
    if (!hits.length) continue;
    const m = mapping.tracks[tr.index];
    const sampled = tr.kind === 'drum' || tr.kind === 'sample';
    const isDrum = sampled && m.mode === 'drums';
    let pitched = false;
    const notes = [];
    for (const h of hits) {
      const n = { tick: h.tick, dur: Math.max(1, Math.round(h.dur)), vel: h.vel };
      if (sampled) {
        if (h.sample == null) continue;
        n.slot = h.sample;
        n.drumNote = drumNote[h.sample] ?? 38;
        if (tr.kind === 'drum') n.lane = tr.index - 4;
        if (h.note != null && h.note !== UNPITCHED) pitched = true;
        n.note = isDrum ? n.drumNote : (h.note ?? UNPITCHED);
      } else {
        n.note = h.note;
      }
      if (n.note >= 0 && n.note <= 127) notes.push(n);
    }
    if (!notes.length) continue;
    // The track's step rate: the finest rate among the patterns its scenes play (null when
    // one of them uses a rate the converter can't write, such as 1/32 or a triplet).
    const playedPats = new Set(song.scenes.filter((sc) => sc.used).flatMap((sc) => {
      const c = sc.chains[tr.index];
      return Array.from({ length: c.end - c.start + 1 }, (_, i) => c.start + i);
    }));
    const keys = [...playedPats].map((p) => tr.patterns[p]).filter((p) => p?.steps.some((s) => s.hits.length)).map((p) => RATE_KEY[p.rate] ?? null);
    const rate = keys.length && keys.every((k) => k) ? Math.max(...keys) : null;
    for (const n of notes) n.rate = rate;
    let program = 0;
    if (tr.kind === 'synth') program = m.program >= 0 ? m.program : guessProgram(tr.sound, 80);
    else if (tr.kind === 'sample' && !isDrum) program = m.program >= 0 ? m.program : 0;
    let lo = 127, hi = 0;
    for (const n of notes) { lo = Math.min(lo, n.note); hi = Math.max(hi, n.note); }
    const kindLabel = { synth: 'synth', midi: 'MIDI notes', drum: 'drum samples', sample: isDrum ? 'samples' : 'samples, played as notes' }[tr.kind];
    sources.push({
      id: `k${tr.index}`,
      track: tr.index,
      channel: tr.index,
      program,
      isDrum,
      canDrum: sampled,            // a sample track can go to the drum tracks either way
      kind: tr.kind,
      name: `${tr.label}${tr.sound ? `: ${tr.sound}` : ''}`,
      instrument: isDrum ? 'Samples' : tr.kind === 'midi' ? 'MIDI notes' : GM_NAMES[program] ?? 'Unknown',
      sub: `${tr.label} · ${kindLabel}${pitched && sampled ? ' · pitched' : ''}`,
      pitched: pitched && sampled,
      patchSlot: tr.kind === 'synth' ? tr.patchSlot : null,
      rate,
      lane: tr.kind === 'drum' ? tr.index - 4 : null,
      role: rhythm ? null : (['S1', 'S2', 'M1', 'M2', 'DR', 'DR', 'DR', 'DR'][tr.index]),
      notes: notes.sort((a, b) => a.tick - b.tick || a.note - b.note),
      range: [lo, hi],
    });
  }
  sources.forEach((s, i) => { s.index = i + 1; });
  if (rhythm) {
    // Circuit Rhythm: each drum-mode track gets a Circuit Tracks drum track of its own, the
    // busiest first; a fifth and later share the drum track of the quietest of the four.
    // Tracks played at several pitches go to Synth 1 and Synth 2 (MIDI 1 and 2 would only
    // play external gear).
    const drums = sources.filter((s) => s.isDrum).sort((a, b) => b.notes.length - a.notes.length || a.track - b.track);
    // The busiest four get a drum track each; any more share the one they clash with least
    // (hits within a 1/16 of each other), the quietest on a tie.
    const near = (a, b) => {
      const ticks = new Set(b.notes.map((n) => Math.round(n.tick / 360)));
      return a.notes.filter((n) => ticks.has(Math.round(n.tick / 360))).length;
    };
    drums.forEach((s, i) => {
      if (i < 4) { setLane(s, i); return; }
      const onLane = (l) => drums.slice(0, i).filter((d) => d.lane === l);
      const lane = [3, 2, 1, 0].map((l) => ({ l, clash: onLane(l).reduce((x, d) => x + near(s, d), 0), busy: onLane(l).reduce((x, d) => x + d.notes.length, 0) }))
        .sort((x, y) => x.clash - y.clash || x.busy - y.busy)[0].l;
      setLane(s, lane);
    });
    for (const s of drums) s.role = 'DR';
    sources.filter((s) => !s.isDrum).sort((a, b) => b.notes.length - a.notes.length || a.track - b.track)
      .forEach((s, i) => { s.role = i % 2 ? 'S2' : 'S1'; });
  }
  const sampleSlots = [...new Set(sources.flatMap((s) => s.notes.map((n) => n.slot)).filter((x) => x != null))].sort((a, b) => a - b);
  return {
    format: 'pack',
    ppq: PPQ,
    tempo: song.tempo,
    tempoChanges: 0,
    timeSig: { num: 4, den: 4 },
    timeSigChanges: 0,
    lengthTicks: rendered.length,
    sources,
    song,
    pack,
    entry,
    sampleSlots,
    scenes: rendered.sceneStarts.length,
  };
}
