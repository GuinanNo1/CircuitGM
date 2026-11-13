// PatchWorker's browser synth: an approximation of the Circuit Tracks synth engine in Web Audio,
// so a patch can be heard and edited with no hardware connected.
//
// The voice architecture (two oscillators + noise, filter, three envelopes, two LFOs, mod matrix,
// macros that ADD to parameters, per-patch distortion / chorus / EQ, six-voice polyphony, buffer
// LFOs with key-sync, envelope re-anchoring on release, synchronous voice stealing) is adapted
// from the synth in circuit-tracks-tools by Namir Sayed-Ahmad Baraza (MIT licence, see
// js/vendor/LICENSE-circuit-tracks-tools.txt). PatchWorker reads the 340 patch bytes directly,
// replaces the parameter curves with CircuitGM's hardware measurements (filter cutoff, envelope
// times, LFO rate, mod depth to pitch and filter, EQ, Pre / Post FX level) and adds wavetable
// shapes, ring modulation, density, virtual sync, filter drive and bypass, and a phaser.
//
// It is still an approximation: the hardware is the reference.
import { P, MACRO_DESTS, MOD_SLOTS, modAddr, macroPosAddr, macroRows, cutoffHz, attackSeconds,
  decaySeconds, lfoHz, eqDb, eqHz, pitchSemis, filterSteps, syncBeats, initPatch } from './params.js?v=20261114d';
import { WAVETABLES } from './wavetables.js?v=20261114d';
import { SHAPERS } from './shapers.js?v=20261114d';

const MAX_VOICES = 6;
// Pitch: the Circuit Tracks plays an incoming MIDI note at standard pitch (MIDI 60 measured at
// 261.6 Hz on the hardware, calibration set 2, rec_cal2/mod "MOD ref"). The patch's Keyboard
// Octave only sets the octave the Tracks' own pads and patch preview start in, so it does not
// shift notes arriving over MIDI, and neither do the Tracks' octave buttons.
export const HARDWARE_TRANSPOSE = 0;
const TABLE = 1024;
const HARMONICS = 96;
const clamp = (v, lo, hi) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : lo);
const midiHz = (n) => 440 * 2 ** ((n - 69) / 12);
const frac = (x) => x - Math.floor(x);

// ------------------------------------------------------------------ oscillator shapes
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

const tableCache = new Map();

// One cycle of an oscillator wave as TABLE samples, peak-normalised. `index` is the patch's
// pulse width / index byte, `interp` its interpolate byte and `vsync` its virtual sync depth.
export function waveTable(wave, index = 64, interp = 127, vsync = 0) {
  const key = `${wave}|${index}|${interp > 63 ? 1 : 0}|${vsync}`;
  if (tableCache.has(key)) return tableCache.get(key);
  if (tableCache.size > 400) tableCache.clear();

  const x = index / 127;
  let pos = x * 8;                              // wavetables have 9 positions
  if (interp <= 63) pos = Math.round(pos);
  const lo = Math.floor(pos);
  const f = pos - lo;
  // Pulse width, measured (calibration set 4): the high part is index / 127 of the cycle (64 =
  // square, 16 = one eighth, 112 = seven eighths); 0 and 127 give a flat line, so silence.
  const duty = index / 127;
  // Measured (calibration set 3): every basic wave starts its cycle at zero going up, so the
  // fundamentals of all of them line up. The saw therefore has its jump in mid-cycle.
  const saw = (p) => 2 * frac(p + 0.5) - 1;
  const tri = (p) => 1 - 4 * Math.abs(frac(p + 0.25) - 0.5);
  // The pulse's falling edge sits on the saw's jump at mid-cycle (measured on the 5:5 mix).
  const pulse = (p, d) => (frac(p - 0.5 + d) < d ? 1 : -1);
  let t = new Float32Array(TABLE);
  let measured = false;
  const fill = (fn) => { for (let i = 0; i < TABLE; i++) t[i] = fn(i / TABLE); };

  if (wave === 0) fill((p) => Math.sin(2 * Math.PI * p));
  else if (wave === 1) fill(tri);
  else if (wave === 2) fill(saw);
  else if (wave >= 3 && wave <= 11) {
    const pw = (wave - 2) / 10;                 // saw : pulse mix, 9:1 ... 1:9
    fill((p) => (1 - pw) * saw(p) + pw * pulse(p, duty));
  } else if (wave === 12) fill((p) => pulse(p, duty));
  else if (wave === 13) fill((p) => pulse(p, 0.5));
  else {
    // Wavetable waves: the shapes measured on the hardware, blended between table positions.
    measured = true;
    const rows = WAVETABLES[wave];
    const put = ([re, im], g) => {
      if (!g) return;
      for (let h = 0; h < re.length; h++) {
        if (!re[h] && !im[h]) continue;
        const a = (2 * Math.PI * (h + 1)) / TABLE;
        for (let i = 0; i < TABLE; i++) t[i] += g * (re[h] * Math.cos(a * i) - im[h] * Math.sin(a * i)) / 1000;
      }
    };
    put(rows[Math.min(lo, 8)], 1 - f);
    if (lo < 8) put(rows[lo + 1], f);
  }

  if (vsync > 0) {
    // Virtual sync: the shape runs faster than the note and restarts every cycle. Measured
    // (calibration set 4): the speed-up is 1 + setting / 16, so 16, 32, 64 and 96 give the 2nd,
    // 3rd, 5th and 7th harmonic as a clean wave and 127 lands just below the 9th.
    const ratio = 1 + vsync / 16;
    const src = t;
    t = new Float32Array(TABLE);
    for (let i = 0; i < TABLE; i++) t[i] = src[Math.floor(frac((i / TABLE) * ratio) * TABLE)];
  }
  // The basic waves already peak at 1 and the wavetables keep their measured level; only a
  // virtual-synced basic wave is brought back to a peak of 1.
  if (!measured && vsync > 0) {
    let peak = 0;
    for (let i = 0; i < TABLE; i++) peak = Math.max(peak, Math.abs(t[i]));
    if (peak > 0) for (let i = 0; i < TABLE; i++) t[i] /= peak;
  }
  tableCache.set(key, t);
  return t;
}

// How far oscillator 2 runs behind oscillator 1, as a fraction of a cycle, when both play the same
// pitch. The hardware's oscillators run freely: the offset is whatever earlier notes left behind
// and then stays put while the two pitches are equal. Calibration set 3 (2026-11-13) had 193.5
// degrees on all 49 patches, where two equal waves nearly cancel; the same-pitch GM patches
// recorded on 2026-11-05 fit anything from in phase to nearly opposite, patch by patch. A quarter
// cycle gives the average loudness of all the offsets the hardware can land on.
export const OSC2_PHASE = 0.25;

const periodicCache = new WeakMap();
function periodicWave(ctx, wave, index, interp, vsync, shift = 0) {
  let m = periodicCache.get(ctx);
  if (!m) { m = new Map(); periodicCache.set(ctx, m); }
  const usesIndex = wave >= 3 && wave !== 13;
  const key = `${wave}|${usesIndex ? index : 0}|${usesIndex && interp > 63 ? 1 : 0}|${vsync}|${shift}`;
  if (m.has(key)) return m.get(key);
  if (m.size > 300) m.clear();
  const t = waveTable(wave, usesIndex ? index : 64, interp, vsync);
  const real = new Float32Array(HARMONICS + 1);
  const imag = new Float32Array(HARMONICS + 1);
  for (let h = 1; h <= HARMONICS; h++) {
    let re = 0;
    let im = 0;
    for (let i = 0; i < TABLE; i++) {
      const a = 2 * Math.PI * h * (i / TABLE + shift);
      re += t[i] * Math.cos(a);
      im += t[i] * Math.sin(a);
    }
    real[h] = (2 * re) / TABLE;
    imag[h] = (2 * im) / TABLE;
  }
  // No normalising by the browser: the tables are peak-normalised, as the hardware's waves are
  // (measured levels against a sine: triangle -1.7 dB, saw -1.9 dB, square +2.9 dB).
  const w = ctx.createPeriodicWave(real, imag, { disableNormalization: true });
  m.set(key, w);
  return w;
}

// ------------------------------------------------------------------ LFO shapes
// Step waves as measured on the hardware (calibration set 4), one entry per step of the cycle, in
// twelfths of the LFO's full swing (so with the depth set for 12 semitones the pitch waves play
// semitones). Sequences 1-7 are 16 steps of mixed heights, the Alternatives are two-level rhythms.
const LFO_STEPS = {
  7: [8.5, 3, 6.5, 4.5, 7.5, 1.5, 5.5, 3.5, 9.5, 0, 4.5, 2.5, 6.5, 0.5, 12, 3],
  8: [1.5, 9, 3, 6, 2, 1, 4, 0, 1.5, 6, 2, 1, 9.5, 2.5, 5.5, 12],
  9: [2, 9.5, 1.5, 7.5, 0, 3, 5, 1.5, 12, 2.5, 7.5, 4.5, 3, 11, 2.5, 5.5],
  10: [12, 3.5, 6, 10.5, 3, 4.5, 8.5, 2.5, 4.5, 6.5, 2.5, 1, 4.5, 0, 1, 3.5],
  11: [3, 1.5, 0, 5.5, 2.5, 1, 7.5, 3, 1, 10.5, 7.5, 1, 12, 5, 2.5, 9],
  12: [4.5, 9, 6.5, 2.5, 10.5, 4, 8.5, 5.5, 3, 8, 6, 11, 4, 6.5, 12, 3],
  13: [7, 0, 2.5, 0, 6.5, 0, 12, 0, 5, 0, 10, 0, 2.5, 0, 4, 0],
  14: [12, 12, 0, 0, 12, 0, 12, 0],
  15: [12, 0, 12, 0, 12, 12, 0, 0],
  16: [12, 12, 12, 12, 12, 12, 12, 12, 12, 0, 0, 0, 12, 12, 12, 0, 12, 12, 12, 0, 12, 12, 12, 0],
  17: [12, 12, 12, 0, 12, 12, 12, 0, 12, 12, 12, 0, 12, 12, 12, 12, 12, 12, 12, 12, 12, 0, 0, 0],
  18: [12, 12, 12, 12, 12, 12, 0, 12, 12, 12, 12, 0],
  19: [12, 12, 0, 12, 12, 0, 12, 12, 0, 12, 12, 0, 12, 12, 12, 12, 12, 0, 12, 12, 12, 12, 12, 0],
  20: [12, 12, 0, 12, 12, 0, 12, 12, 12, 0, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 0],
  21: [12, 12, 0, 12, 12, 0, 12, 0, 12, 0, 12, 0],
  22: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  23: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 10, 9, 8, 7],
  24: [0, 2, 4, 5, 7, 9, 11, 12],
  25: [0, 4, 7, 11],
  26: [0, 3, 7, 10],
  27: [0, 7, 3, 7, 3, 10, 7, 3],
  28: [0, 3, 7, 3, 7, 10, 3, 7],
  29: [0, 2, 3, 5, 6, 8, 9, 11],
  30: [7, 5, 3, 2, 0, 12, 10, 8],
  31: [0, 1.5, 3, 4.5, 6, 7.5, 9, 10.5],
  32: [5, 0, 6, 0, 1, 0, 3, 0],
  33: [0, 2.5, 5, 7.5, 0.5, 3, 5.5, 8],
  34: [0, 2.5, 5, 7.5, 0.5, 3, 5.5, 8, 1, 3.5, 6, 8.5],
  35: [0, 9, 2, 7],
  36: [0, 8, 2, 7],
  37: [2, 7, 0, 0],
};
const SH_STEPS = 64;
const SH_VALUES = (() => { const r = rng(20261112); return Array.from({ length: SH_STEPS }, () => r() * 2 - 1); })();

// One cycle of an LFO wave as n samples (also used to draw it). S/H waves hold 64 random steps.
export function lfoShape(wave, n = 256) {
  const d = new Float32Array(n);
  if (wave <= 3) {
    for (let i = 0; i < n; i++) {
      const ph = i / n;
      if (wave === 0) d[i] = Math.sin(2 * Math.PI * ph);
      else if (wave === 1) d[i] = 1 - 4 * Math.abs(frac(ph + 0.25) - 0.5);
      else if (wave === 2) d[i] = 1 - 2 * ph;                 // the hardware saw falls
      else d[i] = ph < 0.5 ? 1 : -1;
    }
    return d;
  }
  // Piano Envelope, measured: starts at the middle and falls to the bottom (time constant 0.15 cycle).
  if (wave === 6) { for (let i = 0; i < n; i++) d[i] = Math.exp(-i / n / 0.15) - 1; return d; }
  // Random S/H holds one random value per cycle; Time S/H flips between top and bottom.
  const values = wave === 4 ? SH_VALUES : wave === 5 ? SH_VALUES.map((v) => (v >= 0 ? 1 : -1)) : LFO_STEPS[wave].map((st) => st / 6 - 1);
  const stepLen = n / values.length;
  const ramp = Math.min(48, stepLen / 4);
  for (let i = 0; i < n; i++) {
    const s = Math.min(values.length - 1, Math.floor(i / stepLen));
    const k = i - s * stepLen;
    const prev = values[(s - 1 + values.length) % values.length];
    d[i] = k < ramp && n > 1000 ? prev + ((values[s] - prev) * k) / ramp : values[s];
  }
  return d;
}

const lfoBuffers = new WeakMap();
function lfoBuffer(ctx, wave) {
  let m = lfoBuffers.get(ctx);
  if (!m) { m = new Map(); lfoBuffers.set(ctx, m); }
  if (!m.has(wave)) {
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    buf.copyToChannel(lfoShape(wave, ctx.sampleRate), 0);
    m.set(wave, buf);
  }
  return m.get(wave);
}

const noiseBuffers = new WeakMap();
function noiseBuffer(ctx) {
  if (!noiseBuffers.has(ctx)) {
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    // The hardware's noise is flat to about 10 kHz and falls away gently above (calibration
    // sets 3 and 5: -4 dB at 15 kHz, -7 at 17, -10 at 19, -16 at 21.5): white noise through a
    // 2-pole low-pass at 13 kHz, brought back to the level of white noise.
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const w0 = (2 * Math.PI * Math.min(13000, ctx.sampleRate * 0.45)) / ctx.sampleRate;
    const al = Math.sin(w0) / (2 * 0.707);
    const cw = Math.cos(w0);
    const b0 = (1 - cw) / 2 / (1 + al), b1 = (1 - cw) / (1 + al), a1 = (-2 * cw) / (1 + al), a2 = (1 - al) / (1 + al);
    for (let pass = 0; pass < 1; pass++) {
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
      for (let i = 0; i < d.length; i++) {
        const x = d[i];
        const y = b0 * x + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2;
        x2 = x1; x1 = x; y2 = y1; y1 = y; d[i] = y;
      }
    }
    let sum = 0;
    for (let i = 0; i < d.length; i++) sum += d[i] * d[i];
    const k = Math.sqrt(1 / 3) / Math.sqrt(sum / d.length);
    for (let i = 0; i < d.length; i++) d[i] *= k;
    noiseBuffers.set(ctx, buf);
  }
  return noiseBuffers.get(ctx);
}

const tableDb = (rows, v) => {
  if (!rows) return 0;
  if (v <= rows[0][0]) return rows[0][1];               // hold the first value below the table
  for (let i = 1; i < rows.length; i++) {
    if (v <= rows[i][0]) return rows[i - 1][1] + ((rows[i][1] - rows[i - 1][1]) * (v - rows[i - 1][0])) / (rows[i][0] - rows[i - 1][0]);
  }
  return rows[rows.length - 1][1];
};

// Waveshaper curve for the filter drive or the distortion effect, from the curves measured on the
// hardware (js/pw/shapers.js). The engine's signal at the shaper peaks at `ref` for one full-level
// sine voice, which is where the measured curve reaches its ends; louder signals (chords, Pre FX
// boost) carry on past them along the curve's end slope, levelling off.
// Distortion Compensation only changes the level (calibration set 4, diode at 96: +10.9 dB at 0,
// +4.8 at 64, -7.2 at 127, against the default 100). Measured at one setting only: scaled with
// the distortion level here.
const COMP_DB = [[0, 10.9], [64, 4.8], [100, 0], [127, -7.2]];
// Web Audio's WaveShaper clips any input beyond +/-1, which a Pre FX boost or a chord reaches; the
// hardware has headroom (calibration set 6: valve drive at 25 with Pre FX +8 dB adds no loss). The
// signal goes in at 1 / SHAPER_HEADROOM and the curve is stretched to match.
const SHAPER_HEADROOM = 4;
const curveCache = new Map();
function shaperCurve(kind, type, level, ref, gainDb = 0) {
  const key = `${kind}|${type}|${level}|${ref}|${gainDb.toFixed(2)}`;
  if (curveCache.has(key)) return curveCache.get(key);
  const rows = SHAPERS[kind][type] ?? SHAPERS[kind][0];
  const lv = Object.keys(rows).map(Number).sort((a, b) => a - b);
  const M = rows[lv[0]].length - 1;
  const ident = Array.from({ length: M + 1 }, (_, i) => (i / M) * 2 - 1);
  // the measured curve for this setting: straight line at 0, interpolated between settings
  let lo = 0, hi = lv[0], a = ident, b = rows[hi];
  for (let k = 0; k < lv.length; k++) {
    if (level >= lv[k]) { lo = lv[k]; a = rows[lv[k]]; hi = lv[k + 1] ?? lv[k]; b = rows[hi]; }
  }
  const f = hi === lo ? 0 : (level - lo) / (hi - lo);
  const y = a.map((v, i) => v + (b[i] - v) * f);
  const at = (x) => {
    const p = ((clamp(x, -1, 1) + 1) / 2) * M;
    const i = Math.min(M - 1, Math.floor(p));
    return y[i] + (y[i + 1] - y[i]) * (p - i);
  };
  const sTop = ((y[M] - y[M - 1]) * M) / 2, sBot = ((y[1] - y[0]) * M) / 2;
  const g = 10 ** (gainDb / 20);
  const n = 4096, c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (((i / (n - 1)) * 2 - 1) * SHAPER_HEADROOM) / ref;
    let v = at(x);
    // Past the measured range carry on along the end slope (calibration set 5: the valve drive
    // at 25 stays this straight with Pre FX +8 dB), levelling off well beyond it.
    if (x > 1) v = y[M] + sTop * 3 * Math.tanh((x - 1) / 3);
    else if (x < -1) v = y[0] - sBot * 3 * Math.tanh((-1 - x) / 3);
    c[i] = v * ref * g;
  }
  curveCache.set(key, c);
  return c;
}
// Peak of one full-level sine voice where the filter drive and the distortion effect sit.
const DRIVE_REF = 0.5;
const DIST_REF = 0.175;

// Mixer gains of noise and ring modulation at 127, set so their levels against a full-level sine
// match the hardware (calibration set 3: noise -3.0 dB, ring modulation -5.3 dB).
const NOISE_GAIN = 0.46;
const RING_GAIN = 0.384;

// Filter resonance, measured with noise through every filter type (calibration set 3). All types
// fit one two-pole section (two in series for the 24 dB types and the 12 dB band-pass) whose Q
// follows the first table; the output drops as resonance rises (second table). The two-section
// types level off above about 85, where the hardware filter starts to ring by itself. The
// band-pass keeps its skirts and grows a peak, where Web Audio's keeps its peak and narrows.
const RES_Q1 = [[0, 0.74], [20, 1.05], [40, 1.52], [60, 2.59], [80, 4.9], [100, 15], [127, 35]];
const RES_Q2 = [[0, 0.74], [20, 1.03], [40, 1.5], [60, 2.59], [80, 4.4], [100, 5.2], [127, 5.9]];
const RES_LNQ1 = RES_Q1.map(([v, q]) => [v, Math.log(q)]);
const RES_LNQ2 = RES_Q2.map(([v, q]) => [v, Math.log(q)]);
const RES_GAIN_DB = [[0, 0], [20, -0.8], [40, -1.3], [60, -2.3], [80, -3.0], [100, -4.1], [127, -5.7]];
// Natural frequency of the filter by Frequency setting, measured as the resonant peak with
// tracking off (calibration set 4): one octave per 12.07 steps from 32 to 120, slower below.
const F0_HZ = [[0, 12], [8, 21], [16, 41], [24, 64], [32, 100], [40, 164], [48, 258], [56, 416], [64, 659],
  [72, 1043], [80, 1652], [88, 2613], [96, 4137], [104, 6527], [112, 10310], [120, 16427], [127, 24000]];
const LOG_F0 = F0_HZ.map(([v, f]) => [v, Math.log(f)]);
const f0Hz = (v) => Math.exp(tableDb(LOG_F0, v));
// The hardware adds key tracking (1 step per semitone at 127), the filter envelope and modulation
// to the Frequency setting in its own steps and caps the sum at 0..127 (calibration set 6: 110
// tracked an octave up sounds as 122, two octaves up as 127; 100 with envelope +20 as 120).
// Near the top the browser's high-pass (a digital biquad squeezed against Nyquist) cuts as the
// hardware's does about 3 steps higher up, so it is set that much lower there.
const HP24_TOP = [[100, 0], [105, 2], [110, 3], [127, 3.5]];
const HP12_TOP = [[110, 0], [120, 1.5], [127, 5]];
const stepsHz = (v, ftype) => {
  const c = clamp(v, 0, 127);
  const adj = ftype === 5 ? tableDb(HP24_TOP, c) : ftype === 4 ? tableDb(HP12_TOP, c) : 0;
  return Math.min(23900, f0Hz(c - adj));
};
// Envelope / mod depth in Frequency steps: a + a^3 / 4300 (calibration set 2; set 6 at the top of
// the range: +20 moves the cutoff about 21 steps).
const depthSteps = (a) => filterSteps(a);
const capCents = (v, ftype, ds) => 1200 * Math.log2(stepsHz(v + ds, ftype) / stepsHz(v, ftype));
// The resonance weakens at high cutoffs (refitted with set 6: peak at resonance 100 needs -3.4 dB at
// 2.6 kHz, -3.2 at 4.1, -6.8 at 6.5, -7 above 10 kHz on the resonant part of Q; earlier: -1.5 dB at 4 kHz, -4.3 at 6.5 kHz,
// -5.3 at 10 kHz, -5.7 at 16 kHz), and Q Normalise trims it (at resonance 80: +3.6 dB at 0, +2.4
// at 32, -2.4 at 96, -4.3 at 127, against the default 64). Both scale the resonant part of Q.
const RES_HI_DB = [[1700, 0], [2600, -3.4], [4100, -3.2], [6500, -6.8], [10300, -7], [16400, -7.2]];
const QNORM_DB = [[0, 3.6], [32, 2.4], [64, 0], [96, -2.4], [127, -4.3]];
// Level with a saw through the two-section types, against the noise-fitted tables (calibration
// set 5, cutoff 50-65): the 24 dB low-pass comes out quieter as resonance rises, the 12 dB
// band-pass 1 dB quieter at low cutoffs (none by cutoff 80, where set 3 fitted it) and more so
// near self-oscillation.
const LP24_RES_DB = [[0, 0], [20, 0], [40, -0.5], [70, -1.4], [90, -3.5], [127, -4.5]];
const BP12_RES_DB = [[0, 0], [70, -0.1], [90, -2.1], [127, -3]];
const BP12_LOW_DB = [[0, -1], [65, -1], [80, 0], [127, 0]];

const chorusHz = (v) => Math.max(0.02, 0.0013 * v * v);          // measured on the phaser: 40 -> 2 Hz, 100 -> 12.7 Hz
// LFO delay and envelope 3 delay share one measured law: 40 -> 0.09 s, 70 -> 0.44 s, 100 -> 2.3 s.
const delaySeconds = (v) => (v <= 0 ? 0 : 0.148 * 10 ** ((v - 50) / 42.4));

// ------------------------------------------------------------------ the synth
export class PatchSynth {
  constructor(ctx, destination = ctx.destination) {
    this.ctx = ctx;
    this.bytes = initPatch();
    this.osc2Phase = OSC2_PHASE;
    this.voices = [];
    this.bpm = 120;
    this.contrib = new Map();
    this.lastNote = null;
    this.held = new Set();

    const c = ctx;
    this.voiceBus = c.createGain();
    this.voiceBus.gain.value = 0.7;

    this.distDry = c.createGain();
    this.distWet = c.createGain();
    this.shaper = c.createWaveShaper();
    this.shaper.oversample = '2x';
    this.distIn = c.createGain();
    this.distIn.gain.value = 1 / SHAPER_HEADROOM;
    this.distSum = c.createGain();
    this.voiceBus.connect(this.distDry).connect(this.distSum);
    this.voiceBus.connect(this.distIn).connect(this.shaper).connect(this.distWet).connect(this.distSum);

    // Chorus: modulated delay with feedback. Phaser: four swept all-pass stages.
    this.modLfo = c.createOscillator();
    this.modLfo.start();
    this.fxSum = c.createGain();
    this.distSum.connect(this.fxSum);
    this.chorusDelay = c.createDelay(0.1);
    this.chorusDepth = c.createGain();
    this.chorusFb = c.createGain();
    this.chorusWet = c.createGain();
    this.modLfo.connect(this.chorusDepth).connect(this.chorusDelay.delayTime);
    this.distSum.connect(this.chorusDelay);
    this.chorusDelay.connect(this.chorusFb).connect(this.chorusDelay);
    this.chorusDelay.connect(this.chorusWet).connect(this.fxSum);
    this.phaserWet = c.createGain();
    this.phaserDepth = c.createGain();
    this.modLfo.connect(this.phaserDepth);
    this.phaserStages = [];
    let node = this.distSum;
    for (let i = 0; i < 4; i++) {
      const ap = c.createBiquadFilter();
      ap.type = 'allpass';
      ap.Q.value = 0.6;
      this.phaserDepth.connect(ap.detune);
      node.connect(ap);
      node = ap;
      this.phaserStages.push(ap);
    }
    node.connect(this.phaserWet).connect(this.fxSum);

    this.eqBass = c.createBiquadFilter(); this.eqBass.type = 'lowshelf';
    this.eqMid = c.createBiquadFilter(); this.eqMid.type = 'peaking'; this.eqMid.Q.value = 1.4;
    this.eqTreble = c.createBiquadFilter(); this.eqTreble.type = 'highshelf';
    this.post = c.createGain();
    this.master = c.createGain();
    this.master.gain.value = 0.8;
    this.limiter = c.createDynamicsCompressor();
    this.limiter.threshold.value = -6; this.limiter.knee.value = 6; this.limiter.ratio.value = 12;
    this.limiter.attack.value = 0.003; this.limiter.release.value = 0.15;
    this.analyser = c.createAnalyser();
    this.analyser.fftSize = 2048;
    this.fxSum.connect(this.eqBass).connect(this.eqMid).connect(this.eqTreble).connect(this.post)
      .connect(this.master).connect(this.limiter).connect(destination);
    this.limiter.connect(this.analyser);

    // Free-running LFOs: a stable output node each, the source behind it is rebuilt on wave change.
    this.lfos = [0, 1].map(() => ({ out: c.createGain(), src: null, wave: -1 }));
    this.refresh();
  }

  setPatch(bytes) {
    this.bytes = bytes;
    this.refresh();
  }

  setVolume(v) { this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02); }

  // --- parameter values: patch byte + what the macro knobs add at their current positions
  computeMacros() {
    const m = new Map();
    for (let k = 0; k < 8; k++) {
      const pos = this.bytes[macroPosAddr(k)];
      for (const r of macroRows(this.bytes, k)) {
        const id = MACRO_DESTS[r.dest]?.id;
        if (!id || !r.depth || r.end <= r.start) continue;
        const t01 = clamp((pos - r.start) / (r.end - r.start), 0, 1);
        m.set(id, (m.get(id) ?? 0) + t01 * r.depth * 2);
      }
    }
    this.contrib = m;
  }

  val(id) {
    const p = P[id];
    return clamp(Math.round(this.bytes[p.a] + (this.contrib.get(id) ?? 0)), p.lo, p.hi);
  }

  modDepth(slot) {
    return clamp(this.bytes[modAddr(slot, 2)] - 64 + (this.contrib.get(`mod${slot + 1}_depth`) ?? 0), -64, 63);
  }

  lfoRateHz(n) {
    const sync = this.val(`lfo${n + 1}_rate_sync`);
    if (sync > 0) return 1 / (syncBeats(sync) * (60 / this.bpm));
    return lfoHz(this.val(`lfo${n + 1}_rate`));
  }

  makeLfoSource(n, loop = true) {
    const wave = this.bytes[P[`lfo${n + 1}_wave`].a];
    const src = this.ctx.createBufferSource();
    src.buffer = lfoBuffer(this.ctx, wave);
    src.loop = loop;
    src.playbackRate.value = (wave === 4 || wave === 5 ? this.lfoRateHz(n) / SH_STEPS : this.lfoRateHz(n));
    return src;
  }

  // Bring everything that can change while notes sound into line with the patch bytes.
  refresh() {
    this.computeMacros();
    const c = this.ctx;
    const now = c.currentTime;
    const set = (param, v) => param.setTargetAtTime(v, now, 0.015);

    const distLevel = this.val('distortion_level');
    const dist = distLevel / 127;
    const dtype = this.bytes[P.distortion_type.a];
    const ckey = `${dtype}|${distLevel}|${this.val('distortion_compensation')}`;
    if (ckey !== this.curveKey) {
      const comp = tableDb(COMP_DB, this.val('distortion_compensation')) * Math.min(1, distLevel / 96);
      this.shaper.curve = shaperCurve('dist', dtype, distLevel, DIST_REF, comp);
      this.curveKey = ckey;
    }
    // the measured curve is the whole output: no dry signal alongside it
    set(this.distWet.gain, distLevel > 0 ? 1 : 0);
    set(this.distDry.gain, distLevel > 0 ? 0 : 1);

    const level = this.val('chorus_level') / 127;
    const isChorus = this.bytes[P.chorus_type.a] === 1;
    const csync = this.val('chorus_rate_sync');
    const rate = csync > 0 ? 1 / (syncBeats(csync) * (60 / this.bpm)) : chorusHz(this.val('chorus_rate'));
    const depth = this.val('chorus_depth') / 127;
    const delay = 0.003 + (this.val('chorus_delay') / 127) * 0.027;
    set(this.modLfo.frequency, Math.min(rate, 40));
    set(this.chorusDelay.delayTime, delay);
    set(this.chorusDepth.gain, depth * Math.min(delay * 0.8, 0.006));
    set(this.chorusFb.gain, isChorus ? ((this.val('chorus_feedback') - 64) / 64) * 0.75 : 0);
    set(this.chorusWet.gain, isChorus ? level * 0.8 : 0);
    set(this.phaserWet.gain, isChorus ? 0 : level * 0.9);
    // Phaser sweep, fitted to calibration set 4 (level wobble and pitch smearing of a saw): the
    // hardware's notches move gently, about 1 to 10 semitones each way by Depth.
    set(this.phaserDepth.gain, 100 + depth * 500);
    this.phaserStages.forEach((ap, i) => set(ap.frequency, (300 + delay * 30000) * (1 + i * 0.7)));

    set(this.eqBass.frequency, eqHz('bass', this.val('eq_bass_freq')));
    set(this.eqBass.gain, eqDb('bass', this.val('eq_bass_level')));
    set(this.eqMid.frequency, eqHz('mid', this.val('eq_mid_freq')));
    set(this.eqMid.gain, eqDb('mid', this.val('eq_mid_level')));
    set(this.eqTreble.frequency, eqHz('treble', this.val('eq_treble_freq')));
    set(this.eqTreble.gain, eqDb('treble', this.val('eq_treble_level')));
    set(this.post.gain, 10 ** ((Math.min(this.val('post_fx_level'), 76) - 64) / 20));

    for (let n = 0; n < 2; n++) {
      const lfo = this.lfos[n];
      const wave = this.bytes[P[`lfo${n + 1}_wave`].a];
      if (lfo.wave !== wave || !lfo.src) {
        if (lfo.src) { try { lfo.src.stop(); lfo.src.disconnect(); } catch { /* gone */ } }
        lfo.src = this.makeLfoSource(n);
        lfo.src.connect(lfo.out);
        // Free-running LFOs: where in its cycle the LFO starts (a test hook; the hardware's
        // free-running LFO is at whatever point it has reached when a note starts).
        lfo.src.start(0, this.lfoStart || 0);
        lfo.wave = wave;
      } else {
        set(lfo.src.playbackRate, wave === 4 || wave === 5 ? this.lfoRateHz(n) / SH_STEPS : this.lfoRateHz(n));
      }
    }

    for (const v of this.voices) {
      if (v.dead) continue;
      const fc = this.filterHz(v.note, v.ftype);
      const q = this.filterQParam(v.filters.length, v.ftype);
      for (const f of v.filters) { set(f.frequency, fc); set(f.Q, q); }
      set(v.fgain.gain, this.filterGain(v.filters.length, v.ftype));
      const lv = this.mixLevels();
      set(v.g1.gain, lv.l1); set(v.g2.gain, lv.l2); set(v.gn.gain, lv.ln); set(v.gr.gain, lv.lr);
      set(v.pre.gain, lv.pre);
      for (const n of [1, 2]) {
        const cents = this.val(`osc${n}_cents`) - 64;
        const w = this.oscWave(n);
        for (const o of v[`oscs${n}`]) { set(o.osc.detune, cents + o.spread); if (o.wave !== w) { o.osc.setPeriodicWave(w); o.wave = w; } }
      }
    }
  }

  oscWave(n) {
    return periodicWave(this.ctx, this.bytes[P[`osc${n}_wave`].a], this.val(`osc${n}_pw`),
      this.val(`osc${n}_interpolate`), this.val(`osc${n}_vsync`), n === 2 ? this.osc2Phase : 0);
  }

  mixLevels() {
    return {
      l1: (this.val('osc1_level') / 127) * 0.5, l2: (this.val('osc2_level') / 127) * 0.5,
      ln: (this.val('noise_level') / 127) * NOISE_GAIN, lr: (this.val('ring_level') / 127) * RING_GAIN,
      pre: 10 ** ((this.val('pre_fx_level') - 64) / 20),
    };
  }

  filterSteps(note) {
    return this.val('filter_frequency') + ((note - 60) * this.val('filter_tracking')) / 127;
  }

  filterHz(note, ftype = this.bytes[P.filter_type.a]) {
    return clamp(stepsHz(this.filterSteps(note), ftype), 20, 23900);
  }

  // Q of each filter section (as a plain ratio), and what Web Audio wants for it: low- and
  // high-pass take Q in dB, band-pass as a ratio.
  filterQ(stages, ftype = this.bytes[P.filter_type.a]) {
    const q = Math.exp(tableDb(stages > 1 ? RES_LNQ2 : RES_LNQ1, this.val('filter_resonance')));
    // the high-cutoff weakening was fitted on the low-pass; the high-pass keeps more of its peak,
    // and the band-pass (whose level goes with Q per section) only a little is taken from
    const hi = tableDb(RES_HI_DB, f0Hz(this.val('filter_frequency'))) * (ftype >= 4 ? 0.4 : ftype >= 2 ? 0.3 : 1);
    const db = tableDb(QNORM_DB, this.val('filter_q_normalise')) + hi;
    return RES_Q1[0][1] + (q - RES_Q1[0][1]) * 10 ** (db / 20);
  }

  filterQParam(stages, ftype) {
    const q = this.filterQ(stages, ftype);
    return ftype === 2 || ftype === 3 ? q : 20 * Math.log10(q);
  }

  // Level after the filter: the drop with resonance, and the band-pass peak growing with Q.
  filterGain(stages, ftype) {
    const r = this.val('filter_resonance');
    const extra = ftype === 1 || ftype === 5 ? tableDb(LP24_RES_DB, r)
      : ftype === 3 ? tableDb(BP12_RES_DB, r) + tableDb(BP12_LOW_DB, this.val('filter_frequency')) : 0;
    const g = 10 ** ((tableDb(RES_GAIN_DB, r) + extra) / 20);
    return ftype === 2 || ftype === 3 ? g * this.filterQ(stages, ftype) ** stages : g;
  }

  // --- notes
  noteOn(note, velocity = 100, time = null, duration = null) {
    const c = this.ctx;
    const t = Math.max(time ?? c.currentTime, c.currentTime);
    const b = this.bytes;
    const mode = b[P.poly_mode.a];
    const pitch = note;
    const vel = clamp(velocity, 1, 127) / 127;

    // Glide: Mono always glides when portamento is up; Auto-Glide only between overlapping notes.
    let glideFrom = null;
    const porta = this.val('portamento');
    // Portamento, measured (calibration set 4, a two-octave glide): 90% of the way in
    // 0.185 s x 2^((setting - 100) / 11.7) (0.07 s at 80, 0.92 s at 127), along a curve that
    // slows into the note. glideTime here is that 90% time.
    const glideTime = porta > 0 ? 0.185 * 2 ** ((porta - 100) / 11.7) : 0;
    if (mode < 2) {
      const overlapping = this.voices.some((v) => !v.released);
      if (porta > 0 && this.lastNote != null && this.lastNote !== pitch && (mode === 0 || overlapping)) glideFrom = this.lastNote;
      for (const v of [...this.voices]) this.releaseVoice(v, t, 0.006);
    } else if (this.voices.length >= MAX_VOICES) {
      this.killVoice(this.voices[0]);
    }
    const preGlide = this.val('pre_glide') - 64;
    if (glideFrom == null && preGlide !== 0 && porta > 0) glideFrom = pitch + preGlide;
    this.lastNote = pitch;

    const lv = this.mixLevels();
    const mix = c.createGain();          // filtered path
    const bypass = c.createGain();       // oscillators routed around the filter
    const routing = b[P.filter_routing.a];
    const voice = { note: pitch, key: note, time: t, sources: [], nodes: [], envs: [], links: [], released: false, dead: false };
    // Connections out of shared nodes (the free-running LFOs) are recorded so they can be undone.
    const link = (a, dst) => { a.connect(dst); voice.links.push([a, dst]); return dst; };

    const makeOscs = (n) => {
      const semis = this.val(`osc${n}_semitones`) - 64;
      const cents = this.val(`osc${n}_cents`) - 64;
      const density = this.val(`osc${n}_density`) / 127;
      // Density detune, measured (calibration set 4): the copies sit +/- 45 cents x detune / 127
      // from the note. At detune 0 they share its pitch at fixed offsets and partly cancel
      // (-3.3 dB at full density), so that case is one oscillator turned down.
      const spread = (this.val(`osc${n}_density_detune`) / 127) * 45;
      const wave = this.oscWave(n);
      const out = c.createGain();
      const stack = density > 0 && spread > 0.5;
      out.gain.value = stack ? 1 / Math.sqrt(1 + 2 * density * density) : 1 - 0.32 * density;
      const list = [];
      for (const [sp, g] of stack ? [[0, 1], [spread, density], [-spread, density]] : [[0, 1]]) {
        const osc = c.createOscillator();
        osc.setPeriodicWave(wave);
        const target = midiHz(pitch + semis + HARDWARE_TRANSPOSE);
        if (glideFrom != null && glideTime > 0.002) {
          osc.frequency.setValueAtTime(midiHz(glideFrom + semis + HARDWARE_TRANSPOSE), t);
          osc.frequency.setTargetAtTime(target, t, glideTime / 2);
        } else osc.frequency.value = target;
        osc.detune.value = cents + sp;
        const g1 = c.createGain();
        g1.gain.value = g;
        osc.connect(g1).connect(out);
        osc.start(t);
        list.push({ osc, spread: sp, wave });
        voice.sources.push(osc);
      }
      return { out, list };
    };
    const o1 = makeOscs(1);
    const o2 = makeOscs(2);
    voice.oscs1 = o1.list;
    voice.oscs2 = o2.list;

    const g1 = c.createGain(); g1.gain.value = lv.l1;
    const g2 = c.createGain(); g2.gain.value = lv.l2;
    const gn = c.createGain(); gn.gain.value = lv.ln;
    const gr = c.createGain(); gr.gain.value = lv.lr;
    o1.out.connect(g1).connect(routing >= 1 ? bypass : mix);
    o2.out.connect(g2).connect(routing >= 2 ? bypass : mix);
    const noise = c.createBufferSource();
    noise.buffer = noiseBuffer(c);
    noise.loop = true;
    noise.start(t, Math.random());
    noise.connect(gn).connect(mix);
    voice.sources.push(noise);
    // Ring modulation: osc 1 x osc 2.
    const ring = c.createGain();
    ring.gain.value = 0;
    o1.out.connect(ring.gain);
    o2.out.connect(ring).connect(gr).connect(mix);

    const pre = c.createGain();
    pre.gain.value = lv.pre;
    mix.connect(pre);
    let node = pre;
    const drive = this.val('filter_drive') / 127;
    if (drive > 0) {
      const sh = c.createWaveShaper();
      const dt = b[P.filter_drive_type.a];
      sh.curve = shaperCurve('drive', dt, this.val('filter_drive'), DRIVE_REF);
      const shIn = c.createGain();
      shIn.gain.value = 1 / SHAPER_HEADROOM;
      node.connect(shIn).connect(sh);
      voice.nodes.push(shIn);
      node = sh;
    }
    const ftype = b[P.filter_type.a];
    const stages = ftype === 1 || ftype === 3 || ftype === 5 ? 2 : 1;
    const filters = [];
    const fc = this.filterHz(pitch, ftype);
    const fSteps = this.filterSteps(pitch);
    for (let i = 0; i < stages; i++) {
      const f = c.createBiquadFilter();
      f.type = ftype <= 1 ? 'lowpass' : ftype <= 3 ? 'bandpass' : 'highpass';
      f.frequency.value = fc;
      f.Q.value = this.filterQParam(stages, ftype);
      node.connect(f);
      node = f;
      filters.push(f);
    }
    const fgain = c.createGain();
    fgain.gain.value = this.filterGain(stages, ftype);
    node.connect(fgain);
    node = fgain;
    voice.nodes.push(fgain);
    const amp = c.createGain();
    amp.gain.value = 0;
    node.connect(amp);
    bypass.connect(amp);
    amp.connect(this.voiceBus);
    Object.assign(voice, { g1, g2, gn, gr, pre, filters, fgain, ftype, amp });

    // An envelope as an AudioParam automation, kept as numbers so a release can re-anchor it.
    // Velocity law measured on the Circuit Tracks (calibration set 3, sine, velocities 1-127 at
    // ten settings): the envelope follows velocity squared, not velocity, with a small floor.
    // Fits every measured point within about 0.3 dB, for envelope 1 and for envelope 2.
    const velCurve = 0.015 + 0.985 * vel * vel;
    const envVel = (id) => {
      const v = this.val(id);
      return v >= 64 ? 1 - ((v - 64) / 63) * (1 - velCurve) : Math.max(0.0075, 1 - ((64 - v) / 64) * velCurve);
    };
    const runEnv = (param, prefix, peak) => {
      const del = prefix === 'env3' ? delaySeconds(this.val('env3_delay')) : 0;
      const a = Math.max(0.0015, attackSeconds(this.val(`${prefix}_attack`)));
      const dTau = Math.max(0.003, decaySeconds(this.val(`${prefix}_decay`)) / 6.9);
      // The amp envelope's sustain level is the square of the setting (measured: 64 -> a quarter);
      // envelopes 2 and 3 are linear.
      const sus = prefix === 'env1' ? (this.val('env1_sustain') / 127) ** 2 : this.val(`${prefix}_sustain`) / 127;
      const rTau = Math.max(0.003, decaySeconds(this.val(`${prefix}_release`)) / 6.9);
      param.setValueAtTime(0, t);
      if (del) param.setValueAtTime(0, t + del);
      param.linearRampToValueAtTime(peak, t + del + a);
      param.setTargetAtTime(peak * sus, t + del + a, dTau);
      const e = { param, t0: t + del, a, peak, sus, dTau, rTau };
      voice.envs.push(e);
      return e;
    };
    voice.ampEnv = runEnv(amp.gain, 'env1', 0.5 * envVel('env1_velocity'));

    const envAmount = this.val('env2_to_filter') - 64;
    if (envAmount !== 0) {
      const cents = capCents(fSteps, ftype, depthSteps(envAmount) * envVel('env2_velocity'));
      for (const f of filters) runEnv(f.detune, 'env2', cents);
    }

    // --- mod matrix: source 1 x source 2 x depth -> destination
    const envNodes = {};
    const sourceNode = (src) => {
      if (src >= 6 && src <= 9) {
        const n = src < 8 ? 0 : 1;
        const flags = b[P[`lfo${n + 1}_flags`].a];
        let nodeL;
        if (flags & 2) {                                   // key sync: a fresh LFO per note
          const s = this.makeLfoSource(n, !(flags & 1));
          s.start(t, b[P[`lfo${n + 1}_phase`].a] / 120);
          voice.sources.push(s);
          nodeL = s;
        } else nodeL = this.lfos[n].out;
        // Measured (calibration set 4, LFO -> oscillator level): the "+" source runs 0..1 and the
        // "+/-" source -0.5..+0.5, where a constant ("direct") is 1.
        if (src === 7 || src === 9) {
          const half = c.createGain(); half.gain.value = 0.5;
          link(nodeL, half);
          voice.nodes.push(half);
          nodeL = half;
        }
        if (src === 6 || src === 8) {                      // unipolar: (x + 1) / 2
          const half = c.createGain(); half.gain.value = 0.5;
          const sum = c.createGain();
          const k = c.createConstantSource(); k.offset.value = 0.5; k.start(t);
          link(nodeL, half).connect(sum); k.connect(sum);
          voice.sources.push(k); voice.nodes.push(half);
          nodeL = sum;
        }
        const dly = delaySeconds(this.val(`lfo${n + 1}_delay`));
        if (dly > 0.01) {                                  // delay with fade / gate, in or out
          const fade = c.createGain();
          const fm = (flags >> 4) & 3;
          const from = fm === 0 || fm === 2 ? 0 : 1;
          fade.gain.setValueAtTime(from, t);
          if (fm < 2) fade.gain.linearRampToValueAtTime(1 - from, t + dly);
          else fade.gain.setValueAtTime(1 - from, t + dly);
          link(nodeL, fade);
          voice.nodes.push(fade);
          nodeL = fade;
        }
        return nodeL;
      }
      if (src >= 10 && src <= 12) {
        const prefix = `env${src - 9}`;
        if (!envNodes[prefix]) {
          const k = c.createConstantSource();
          k.offset.value = 0;
          // Envelopes 1 and 2 keep their velocity setting as mod sources (measured on envelope 2).
          runEnv(k.offset, prefix, prefix === 'env3' ? 1 : envVel(`${prefix}_velocity`));
          k.start(t);
          voice.sources.push(k);
          envNodes[prefix] = k;
        }
        return envNodes[prefix];
      }
      return null;
    };
    // Measured: velocity as a source is velocity squared; keyboard is 1/64 per semitone from C4.
    const staticValue = (src) => (src === 4 ? vel * vel : src === 5 ? (pitch - 60) / 64 : 1);
    const isStatic = (src) => !(src >= 6 && src <= 12);
    const allOscs = (n) => voice[`oscs${n}`].map((o) => o.osc.detune);

    for (let s = 0; s < MOD_SLOTS; s++) {
      const depth = this.modDepth(s);
      if (!depth) continue;
      const s1 = b[modAddr(s, 0)];
      const s2 = b[modAddr(s, 1)];
      const dest = b[modAddr(s, 3)];
      let scale;
      let targets;
      if (dest <= 2) {
        scale = pitchSemis(depth) * 100;
        targets = [...(dest !== 2 ? allOscs(1) : []), ...(dest !== 1 ? allOscs(2) : [])];
      } else if (dest === 7) { scale = (depth / 64) * 0.5; targets = [g1.gain]; }
      else if (dest === 8) { scale = (depth / 64) * 0.5; targets = [g2.gain]; }
      else if (dest === 9) { scale = (depth / 64) * 0.4; targets = [gn.gain]; }
      else if (dest === 10) { scale = (depth / 64) * 0.5; targets = [gr.gain]; }
      else if (dest === 12) { scale = capCents(fSteps, ftype, depthSteps(depth)); targets = filters.map((f) => f.detune); }
      else if (dest === 13) { scale = (depth / 64) * 12; targets = filters.map((f) => f.Q); }
      else continue;                                         // V-Sync, pulse width, drive, LFO rate, env decay: not emulated

      scale *= (isStatic(s1) ? staticValue(s1) : 1) * (isStatic(s2) ? staticValue(s2) : 1);
      const dyn = [s1, s2].filter((x) => !isStatic(x)).map(sourceNode);
      // A constant pulling a mixer level down stops at silence (measured), it does not invert.
      if (dyn.length === 0 && dest >= 7 && dest <= 10) scale = Math.max(scale, -targets[0].value);
      const g = c.createGain();
      if (dyn.length === 0) {
        const k = c.createConstantSource();
        k.offset.value = 1; k.start(t);
        voice.sources.push(k);
        g.gain.value = scale;
        k.connect(g);
      } else if (dyn.length === 1) {
        g.gain.value = scale;
        link(dyn[0], g);
      } else {
        const m = c.createGain();
        m.gain.value = 0;
        link(dyn[1], m.gain);
        link(dyn[0], m).connect(g);
        g.gain.value = scale;
        voice.nodes.push(m);
      }
      for (const tg of targets) g.connect(tg);
      voice.nodes.push(g);
    }

    this.voices.push(voice);
    if (duration != null) this.releaseVoice(voice, t + Math.max(0.01, duration));
    return voice;
  }

  noteOff(note, time = null) {
    const t = time ?? this.ctx.currentTime;
    for (const v of this.voices) if (v.key === note && !v.released) this.releaseVoice(v, t);
  }

  allNotesOff() {
    for (const v of [...this.voices]) this.releaseVoice(v, this.ctx.currentTime, 0.01);
  }

  static envAt(e, t) {
    if (t <= e.t0) return 0;
    if (t < e.t0 + e.a) return e.peak * ((t - e.t0) / e.a);
    return e.peak * e.sus + e.peak * (1 - e.sus) * Math.exp(-(t - e.t0 - e.a) / e.dTau);
  }

  releaseVoice(voice, time, forceTau = null) {
    if (voice.dead || (voice.released && time >= voice.releaseAt)) return;
    voice.released = true;
    voice.releaseAt = time;
    let tail = 0.05;
    for (const e of voice.envs) {
      const tau = forceTau ?? e.rTau;
      e.param.cancelScheduledValues(time);
      // Released during the attack: cancelling removed the attack ramp, so ramp again to the
      // value reached by now (a plain set would leave the envelope at 0 until the release).
      if (time > e.t0 && time < e.t0 + e.a) e.param.linearRampToValueAtTime(PatchSynth.envAt(e, time), time);
      else e.param.setValueAtTime(PatchSynth.envAt(e, time), time);
      e.param.setTargetAtTime(0, time, tau);
      if (e === voice.ampEnv) tail = tau * 7;
    }
    const stopAt = time + Math.min(tail, 30) + 0.05;
    for (const s of voice.sources) { try { s.stop(stopAt); } catch { /* already stopped */ } }
    clearTimeout(voice.timer);
    if (typeof this.ctx.suspend === 'function' && this.ctx.constructor.name !== 'OfflineAudioContext') {
      voice.timer = setTimeout(() => this.disposeVoice(voice), Math.max(0, (stopAt - this.ctx.currentTime) * 1000 + 60));
    }
  }

  killVoice(voice) {
    for (const s of voice.sources) { try { s.stop(); } catch { /* already stopped */ } }
    this.disposeVoice(voice);
  }

  disposeVoice(voice) {
    if (voice.dead) return;
    voice.dead = true;
    clearTimeout(voice.timer);
    const i = this.voices.indexOf(voice);
    if (i >= 0) this.voices.splice(i, 1);
    try { voice.amp.disconnect(); } catch { /* gone */ }
    for (const [a, dst] of voice.links) { try { a.disconnect(dst); } catch { /* gone */ } }
    for (const n of voice.nodes) { try { n.disconnect(); } catch { /* gone */ } }
    for (const s of voice.sources) { try { s.disconnect(); } catch { /* gone */ } }
  }
}

// Envelope outline for drawing: [seconds, level] points for the current stage settings.
export function envelopePoints(bytes, n) {
  const p = `env${n}`;
  const del = n === 3 ? (bytes[P.env3_delay.a] / 127) ** 2 * 4 : 0;
  return {
    delay: del,
    attack: attackSeconds(bytes[P[`${p}_attack`].a]),
    decay: decaySeconds(bytes[P[`${p}_decay`].a]),
    sustain: bytes[P[`${p}_sustain`].a] / 127,
    release: decaySeconds(bytes[P[`${p}_release`].a]),
  };
}
