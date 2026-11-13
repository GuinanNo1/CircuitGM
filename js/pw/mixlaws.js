// Circuit Tracks project-level controls (mixer, FX, master filter, drums, sidechain) as plain
// numbers, from calibration set 7 (2026-11-13, project doc circuit-tracks-calibration-set7.md).
// No Web Audio here, so every law can be checked in Node (tests/mixlaws.mjs); js/pw/mixer.js
// builds the audio graph from these.
//
// "Measured" means a set 7 result; "assumed" marks the gaps filled by a guess, so they can be
// found and replaced when they are measured.

const clamp = (v, lo, hi) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : lo);

// Piecewise-linear interpolation through [x, y] points (x ascending), optionally in log(y).
function interp(points, x, log = false) {
  x = clamp(x, points[0][0], points[points.length - 1][0]);
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1], [x1, y1] = points[i];
    if (x <= x1) {
      const f = x1 === x0 ? 0 : (x - x0) / (x1 - x0);
      return log ? Math.exp(Math.log(y0) + f * (Math.log(y1) - Math.log(y0))) : y0 + f * (y1 - y0);
    }
  }
  return points[points.length - 1][1];
}

// ------------------------------------------------------------------ mixer
// Level (synth CC 12/14, drum level, and note velocity): linear amplitude, gain = v / 127.
// Measured: 100 = -2.1 dB vs 127, 64 = -6 dB.
export const levelGain = (v) => clamp(v, 0, 127) / 127;

// Pan: a linear balance control. Centre leaves both sides at full level; turning one way lowers
// the other side linearly (32 = right side at -6 dB, 0 = right silent; mirror image above 64).
// Measured for the synths and drum 1. Returns [left gain, right gain].
export function balance(v) {
  v = clamp(v, 0, 127);
  if (v < 64) return [1, v / 64];
  if (v > 64) return [(127 - v) / 63, 1];
  return [1, 1];
}

// ------------------------------------------------------------------ reverb
// RT60 in seconds at decay 64, per type 0-5 (measured; type 0 "very short" taken as 0.25 s).
export const REVERB_TYPE_RT60 = [0.25, 0.69, 0.91, 1.41, 1.29, 1.96];
// Decay scales the type's time. Measured at type 2: 0 and 32 very short (the tail is gone by
// about 0.3 s), 64 = 0.9 s, 96 = 1.5 s, 127 = 3.3 s. As factors of the decay-64 time:
const REVERB_DECAY = [[0, 0.12], [32, 0.25], [64, 1], [96, 1.67], [127, 3.67]];
export function reverbRt60(type, decay) {
  return REVERB_TYPE_RT60[clamp(Math.round(type), 0, 5)] * interp(REVERB_DECAY, decay, true);
}
// Damping: higher is darker. Measured at 127: HF above 4 kHz -21.6 dB vs the dry signal; 0 bright.
// Modelled as the high band decaying faster than the low band: ratio of the high band's RT60 to
// the low band's. Longer decay settings are also darker (measured), folded in here.
export function reverbHfRatio(damping, decay = 64) {
  const d = interp([[0, 1], [64, 0.45], [127, 0.15]], damping);
  const dark = interp([[0, 1], [64, 1], [127, 0.75]], decay);
  return d * dark;
}
// Left/right decorrelation by room size (measured: bigger rooms are less correlated). 0 = mono.
export const reverbSpread = (type) => interp([[0, 0.35], [2, 0.7], [5, 1]], type);
// Send: close to amplitude proportional to the send (measured reverb level at send 32 / 64 /
// 127: -70.1 / -62.7 / -56.4 dB, a little steeper than linear, hence the power 1.1). The
// absolute wet level against the dry signal is set by ear (REVERB_WET in mixer.js).
export const sendGain = (v) => (clamp(v, 0, 127) / 127) ** 1.1;

// ------------------------------------------------------------------ delay
// Echo spacing in beats for sync values 1-11 (measured at 120 BPM: 1 = 1/32T, 3 = 1/16T,
// 5 = 1/8T, 7 = 1/8, 9 = dotted 1/8, 10 = 1/4, 11 = 1/2T; even values 2, 4, 6, 8 assumed to be
// 1/32, 1/16, dotted 1/16 and 1/4T). 12-19 all hit the 0.68 s cap at 120 BPM; their note values
// below are assumed (they only matter at fast tempos). 20-35 act like value 1 (measured).
const SYNC_BEATS = [0, 1 / 12, 1 / 8, 1 / 6, 1 / 4, 1 / 3, 3 / 8, 1 / 2, 2 / 3, 3 / 4, 1, 4 / 3,
  3 / 2, 2, 8 / 3, 3, 4, 16 / 3, 6, 8];
export const DELAY_MAX = 0.68;          // measured: the longest echo spacing
export const DELAY_FREE_STEP = 0.0053;  // measured: seconds per step of Delay Time when sync is 0
// Delay time in seconds, or 0 for no echoes (free time 0).
export function delaySeconds(time, sync, bpm = 120) {
  sync = Math.round(clamp(sync, 0, 127));
  if (sync === 0) return Math.min(DELAY_MAX, clamp(time, 0, 127) * DELAY_FREE_STEP);
  const beats = sync >= 20 ? SYNC_BEATS[1] : SYNC_BEATS[sync];
  return Math.min(DELAY_MAX, beats * 60 / clamp(bpm, 30, 300));
}
// Feedback: gain from one echo to the next. Measured: 0 = a single echo, 64 = each echo about
// 6 dB quieter, 100 = about 2 dB quieter, 127 = repeats without dying away.
export function delayFeedback(v) {
  return interp([[0, 0], [64, 0.5], [100, 0.79], [127, 0.995]], v);
}
// Width: measured only at 0 (no echoes at all) and 127 (the default). Assumed linear in between.
export const delayWidth = (v) => clamp(v, 0, 127) / 127;
// L/R ratio. Measured: 0 = both sides identical; 4 = the right side's echoes about 14 ms late at
// a 41.7 ms spacing (right time = left x 4/3); 11 and 12 bias the level to one side by about 17
// and 12 dB. Assumed: 1-10 stretch the right side by v / 12; 11 lowers the right side and 12 the
// left (which side each favours was not recorded). Returns { right: time factor, l, r: gains }.
export function delayLR(v) {
  v = Math.round(clamp(v, 0, 127));
  if (v === 11) return { right: 1, l: 1, r: 10 ** (-17 / 20) };
  if (v === 12) return { right: 1, l: 10 ** (-12 / 20), r: 1 };
  return { right: 1 + Math.min(v, 10) / 12, l: 1, r: 1 };
}
// Slew: no difference seen between 0 and 127 (the test was too short). Assumed: the glide time
// constant when the delay time changes.
export const delaySlew = (v) => 0.005 + (clamp(v, 0, 127) / 127) * 0.3;
// The first echo's level for a full send, against the dry signal. Measured: with feedback 127
// the echoes sit about 3 dB under the dry signal; send 127's first echo is about 6 dB louder
// than send 64's (amplitude proportional to send).
export const DELAY_ECHO_GAIN = 10 ** (-3 / 20);

// ------------------------------------------------------------------ master filter
// CC 74: below 64 low-pass, 60-68 off (measured flat), above 68 high-pass; both steep (24 dB per
// octave or more: two cascaded 12 dB stages here). Corners measured at 16/32/48 (200 Hz, 1 kHz,
// 4.3 kHz) and 80/96/112 (150 Hz, 1 kHz, 5 kHz); 0 and 127 practically closed.
const LP_HZ = [[0, 20], [16, 200], [32, 1000], [48, 4300], [60, 20000]];
const HP_HZ = [[68, 20], [80, 150], [96, 1000], [112, 5000], [127, 16000]];
// CC 71 resonance: measured at 100 a peak of about +11 dB (low-pass at 32) and +6 dB (high-pass
// at 96); 0 slightly softer than the default. Q per stage; the default value is assumed 64.
const RES_Q = [[0, 0.55], [64, 0.75], [100, 1.9], [127, 3]];
export function masterFilter(cutoff = 64, resonance = 64) {
  cutoff = clamp(cutoff, 0, 127);
  const q = interp(RES_Q, resonance);
  if (cutoff < 60) return { type: 'lowpass', hz: interp(LP_HZ, cutoff, true), q };
  if (cutoff > 68) return { type: 'highpass', hz: interp(HP_HZ, cutoff, true), q: 1 + (q - 1) * 0.6 };
  return { type: 'off', hz: 0, q };
}

// ------------------------------------------------------------------ sidechain
// Ducks a synth from a drum's notes (fires on the note even with the drum's level at 0).
// Source: 0-3 = drums 1-4, anything else off (assumed from the Programmer's Reference order).
// Measured with the defaults (attack 0, hold 50, decay 70, depth 127): about -41 dB, then
// recovering -14 / -3.4 / -1.2 dB at 40 / 80 / 120 ms (time constant about 44 ms). Hold 110 keeps
// it fully down about 350 ms; hold 0 is a little shorter than 50. Decay 20 recovers by about
// 40 ms; 120 slowly (-15 / -6 / -2.5 dB at 80 / 200 / 300 ms, time constant about 144 ms).
// Attack 40 and 90 differ little (90 slightly later). Depth: amplitude roughly proportional.
// The hold below includes the time from the note to the start of the recovery as logged (about
// 25 ms at the defaults); decay 120's time constant is a compromise between its 80 ms and
// 300 ms points (its recovery is slower to start than an exponential).
export function sidechainShape({ source = 0, attack = 0, hold = 50, decay = 70, depth = 0 } = {}) {
  if (!(source >= 0 && source <= 3) || depth <= 0) return null;
  return {
    drum: source,
    floor: 1 - 0.991 * (clamp(depth, 0, 127) / 127),    // depth 127 = -41 dB
    attack: 0.003 + (clamp(attack, 0, 127) / 127) * 0.03,
    hold: interp([[0, 0.015], [50, 0.025], [110, 0.35], [127, 0.6]], hold, true),
    tau: interp([[0, 0.004], [20, 0.008], [70, 0.044], [120, 0.2], [127, 0.24]], decay, true),
  };
}

// ------------------------------------------------------------------ drums
// Pitch: a playback-rate change, 64 = original. Measured spectral shift: -1 octave at 32,
// -2 at 0, +0.5 at 96, +0.65 at 127 (the upward amount may be limited by the measurement).
export const drumPitchSemis = (v) => interp([[0, -24], [32, -12], [64, 0], [96, 6], [127, 7.8]], v);
export const drumRate = (v) => 2 ** (drumPitchSemis(v) / 12);
// Decay shortens the sample. Measured 30 dB lengths of the default kick: 0.05 / 0.10 / 0.18 /
// 0.23 / 0.24 s at 0 / 32 / 64 / 96 / 127 (96 and 127 are the sample's own length). Returns the
// time for a fade to -30 dB, or null for no fade (127). 96 is extrapolated.
export function drumDecaySeconds(v) {
  if (v >= 127) return null;
  return interp([[0, 0.05], [32, 0.1], [64, 0.18], [96, 0.33], [126, 0.6]], v, true);
}
// Distortion: 64 adds about +4 dB RMS and brightens, 127 about +13 dB (measured). Drive into
// tanh with no make-up gain; this curve gives about +4 and +13 dB on a kick-like test signal.
// Returns the drive (0 = bypass).
export const drumDrive = (v) => (v <= 0 ? 0 : 1 + 24 * (clamp(v, 0, 127) / 127) ** 5);
// EQ: a tilt, 64 flat. Measured: 0 darker and louder (centroid 790 -> 290 Hz, +4.5 dB),
// 127 brighter (centroid 2.1 kHz). Shelf gains in dB for a low shelf at 300 Hz and a high
// shelf at 2 kHz.
export function drumTilt(v) {
  const t = (clamp(v, 0, 127) - 64) / 64;
  return { lowDb: t < 0 ? -t * 9 : -t * 3, highDb: t < 0 ? t * 15 : t * 9 };
}

// ------------------------------------------------------------------ a project's settings
// The mix settings of a parsed Tracks project (js/vendor/ncs.js), in the form mixer.js applies.
// Synth sends come from the project's send table (entries 0 and 1); drum sends from each drum's
// own config bytes (the send table's other entries are not used: what they hold is unconfirmed).
export function projectMix(proj) {
  const fx = proj?.fx ?? {};
  const synth = [0, 1].map((i) => ({
    level: proj?.mixerLevels?.[i] ?? 100, pan: proj?.mixerPans?.[i] ?? 64,
    reverb: fx.reverbSends?.[i] ?? 0, delay: fx.delaySends?.[i] ?? 0,
    sidechain: proj?.sidechain?.[i] ?? null,
  }));
  const drums = [0, 1, 2, 3].map((i) => {
    const d = proj?.drumConfigs?.[i] ?? {};
    return {
      level: d.level ?? 100, pan: d.pan ?? 64, reverb: d.reverbSend ?? 0, delay: d.delaySend ?? 0,
      pitch: d.pitch ?? 64, decay: d.decay ?? 127, distortion: d.distortion ?? 0, eq: d.eq ?? 64,
    };
  });
  return {
    tempo: proj?.tempo ?? 120,
    synth, drums,
    reverb: { type: fx.reverbType ?? 2, decay: fx.reverbDecay ?? 64, damping: fx.reverbDamping ?? 64 },
    delay: {
      time: fx.delayTime ?? 64, sync: fx.delaySync ?? 20, feedback: fx.delayFeedback ?? 64,
      width: fx.delayWidth ?? 127, ratio: fx.delayLrRatio ?? 4, slew: fx.delaySlew ?? 5,
    },
    bypass: !!fx.fxBypass,
    // The master filter is a live control, not stored in the project.
    filter: { cutoff: 64, resonance: 64 },
  };
}
