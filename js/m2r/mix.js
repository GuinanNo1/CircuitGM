// MIDI2Rhythm "Keep the project's layout": the source project's mix (reverb and delay, FX off,
// each track's level, pan, sends and sidechain) carried to the Rhythm project, following each
// source track to the Rhythm track(s) that play it (js/m2r/layout.js plan.tracks[t].src).
//
// Byte layouts: docs/circuit-rhythm-format.md (tail) and docs/circuit-tracks-file-formats.md.
// The FX values are copied as stored, not as a preset number, so a source with edited values
// keeps them; both devices store the same 0-127 values (reverb type/decay/damping, delay
// time/sync/feedback/width/ratio/slew; the Tracks' Delay 1 is a fresh project's values, which
// the Rhythm plays the same way, since it plays stored values).

const TAIL = 0x2e4 + 64 * 2600;   // 0x28ce4
const T_DELAY_PRESET = 32, T_REVERB_PRESET = 33, T_SC_PRESETS = 42, T_ROWS = 50, ROW = 41;
const T_REVERB_VALUES = 378, T_DELAY_VALUES = 386, T_FX_OFF = 393;
const R_LEVEL = 26, R_PAN = 27, R_RSEND = 28, R_DSEND = 29, R_SC = 32;

// The mix of a source project as js/pack.js read it. Tracks are the source's 8 tracks (Circuit
// Tracks: Synth 1, Synth 2, MIDI 1, MIDI 2, Drum 1-4). sc.source is a source track, or null.
export function sourceMix(project, product) {
  if (!project) return null;
  if (product === 'circuit-rhythm') {
    const m = project.mix;
    if (!m) return null;
    return {
      reverb: { preset: m.reverbPreset, values: m.reverbValues },
      delay: { preset: m.delayPreset, values: m.delayValues },
      fxOff: m.fxOff,
      tracks: m.rows.map((row, t) => ({
        level: row[R_LEVEL], pan: row[R_PAN], rsend: row[R_RSEND], dsend: row[R_DSEND],
        sc: m.scPresets[t] ? { preset: m.scPresets[t], source: row[R_SC] & 7, values: Array.from(row.subarray(R_SC + 1, R_SC + 5)) } : null,
        row,
      })),
    };
  }
  const f = project.fx;
  if (!f) return null;
  // The tail's 8 send bytes: Synth 1, Synth 2, Drum 1-4, then two that hardware saves leave at
  // 0 but some packs set (most likely MIDI 1 and 2; carried as that).
  const sendAt = [0, 1, 6, 7, 2, 3, 4, 5];
  const levels = [...project.mixerLevels, ...project.drumConfigs.map((c) => c.level)];
  const pans = [...project.mixerPans, ...project.drumConfigs.map((c) => c.pan)];
  return {
    reverb: { preset: project.reverbPreset, values: [f.reverbType, f.reverbDecay, f.reverbDamping] },
    delay: { preset: project.delayPreset, values: [f.delayTime, f.delaySync, f.delayFeedback, f.delayWidth, f.delayLrRatio, f.delaySlew] },
    fxOff: f.fxBypass,
    tracks: Array.from({ length: 8 }, (_, t) => {
      const sc = t < 4 ? project.sidechain[t] : null;
      return {
        level: levels[t], pan: pans[t], rsend: f.reverbSends[sendAt[t]] ?? 0, dsend: f.delaySends[sendAt[t]] ?? 0,
        // source 0-3 = Drum 1-4 (source track 4-7), 4 = off
        sc: sc && sc.preset && sc.source < 4 ? { preset: sc.preset, source: 4 + sc.source, values: [sc.attack, sc.hold, sc.decay, sc.depth] } : null,
        row: null,
      };
    }),
  };
}

// The Rhythm track that plays a source track: the first active one, else the first at all.
function rhythmTrackOf(plan, src) {
  const all = plan.tracks.map((tr, t) => (tr?.src.includes(src) ? t : -1)).filter((t) => t >= 0);
  return all.find((t) => plan.active[t]) ?? all[0] ?? null;
}

// Each Rhythm track's carried settings: { level, pan, rsend, dsend, sc: { preset, source,
// values } | null, row } or null for a track the plan leaves empty.
export function mixByTrack(plan, mix) {
  if (!mix) return Array(8).fill(null);
  return plan.tracks.map((tr) => {
    if (!tr) return null;
    const m = mix.tracks[tr.src[0]];
    let sc = null;
    if (m.sc) {
      const source = rhythmTrackOf(plan, m.sc.source);
      if (source != null) sc = { ...m.sc, source };
    }
    return { ...m, sc };
  });
}

// Write the mix into a Rhythm project (before the track loop sets each track's sample and
// Tune, and before the step-5 effects, which are filled in from this; see mixControls).
// A Rhythm source's track settings are copied whole (41 bytes: also the macros), then the
// sidechain source is pointed at the Rhythm track that now plays the trigger.
export function applyMix(d, plan, mix) {
  if (!mix) return;
  d[TAIL + T_DELAY_PRESET] = mix.delay.preset;
  d[TAIL + T_REVERB_PRESET] = mix.reverb.preset;
  d.set(mix.reverb.values, TAIL + T_REVERB_VALUES);
  d.set(mix.delay.values, TAIL + T_DELAY_VALUES);
  d[TAIL + T_FX_OFF] = mix.fxOff ? 1 : 0;
  mixByTrack(plan, mix).forEach((m, t) => {
    if (!m) return;
    const o = TAIL + T_ROWS + t * ROW;
    if (m.row) d.set(m.row, o);
    d[o + R_LEVEL] = m.level;
    d[o + R_PAN] = m.pan;
    d[o + R_RSEND] = m.rsend;
    d[o + R_DSEND] = m.dsend;
    d[TAIL + T_SC_PRESETS + t] = m.sc ? m.sc.preset : 0;
    if (m.sc) { d[o + R_SC] = m.sc.source; d.set(m.sc.values, o + R_SC + 1); }
    else d.fill(0, o + R_SC + 1, o + R_SC + 5);      // off, as the Rhythm stores it
  });
}

// Step 5's controls as the carried mix sets them: sends and sidechain for tracks 1-8.
export function mixControls(plan, mix) {
  const by = mixByTrack(plan, mix);
  return {
    reverbSends: by.map((m) => m?.rsend ?? 0),
    delaySends: by.map((m) => m?.dsend ?? 0),
    sidechain: by.map((m) => ({ preset: m?.sc?.preset ?? 0, source: m?.sc?.source ?? 0 })),
  };
}
