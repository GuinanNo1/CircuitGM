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
      role: rhythm ? null : (['S1', 'S2', 'M1', 'M2', 'DR', 'DR', 'DR', 'DR'][tr.index]),
      notes: notes.sort((a, b) => a.tick - b.tick || a.note - b.note),
      range: [lo, hi],
    });
  }
  sources.forEach((s, i) => { s.index = i + 1; });
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
