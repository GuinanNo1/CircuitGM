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
  decaySeconds, lfoHz, eqDb, eqHz, pitchSemis, filterSteps, syncBeats, initPatch } from './params.js?v=20261113a';

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

function harmonicTable(amps) {
  const t = new Float32Array(TABLE);
  for (let h = 1; h < amps.length; h++) {
    if (!amps[h]) continue;
    for (let i = 0; i < TABLE; i++) t[i] += amps[h] * Math.sin(2 * Math.PI * h * i / TABLE);
  }
  return t;
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
  const duty = clamp(0.5 + (x - 0.504) * 0.9, 0.04, 0.96);
  // Measured (calibration set 3): every basic wave starts its cycle at zero going up, so the
  // fundamentals of all of them line up. The saw therefore has its jump in mid-cycle.
  const saw = (p) => 2 * frac(p + 0.5) - 1;
  const tri = (p) => 1 - 4 * Math.abs(frac(p + 0.25) - 0.5);
  const pulse = (p, d) => (p < d ? 1 : -1);
  let t = new Float32Array(TABLE);
  const fill = (fn) => { for (let i = 0; i < TABLE; i++) t[i] = fn(i / TABLE); };

  if (wave === 0) fill((p) => Math.sin(2 * Math.PI * p));
  else if (wave === 1) fill(tri);
  else if (wave === 2) fill(saw);
  else if (wave >= 3 && wave <= 11) {
    const pw = (wave - 2) / 10;                 // saw : pulse mix, 9:1 ... 1:9
    fill((p) => (1 - pw) * saw(p) + pw * pulse(p, duty));
  } else if (wave === 12) fill((p) => pulse(p, duty));
  else if (wave === 13) fill((p) => pulse(p, 0.5));
  else if (wave === 14) {
    // Measured: table position k is the pure k-th harmonic.
    fill((p) => (1 - f) * Math.sin(2 * Math.PI * (lo + 1) * p) + f * Math.sin(2 * Math.PI * (lo + 2) * p));
  } else if (wave === 15) fill((p) => pulse(p, 0.5 - (pos / 8) * 0.45));
  else if (wave === 16) fill((p) => saw(frac(p * (1 + pos * 0.45))) * (1 - 0.5 * p));
  else if (wave === 17) fill((p) => (1 - pos / 8) * tri(p) + (pos / 8) * saw(p));
  else if (wave === 18) fill((p) => Math.sin(2 * Math.PI * p + (0.6 + pos * 0.5) * Math.sin(2 * Math.PI * 3 * p)));
  else if (wave === 19) fill((p) => Math.tanh(3 * Math.sin(2 * Math.PI * p + (0.5 + pos * 0.45) * Math.sin(2 * Math.PI * 5 * p))));
  else if (wave === 20) fill((p) => (1 - pos / 8) * saw(p) + (pos / 8) * pulse(p, 0.5));
  else if (wave >= 21 && wave <= 26) {
    // "Digital vocal": single-cycle harmonic shapes with two spectral bumps (no fixed formants,
    // as measured), the bumps moving up with the table position.
    const n = wave - 21;
    const c1 = 2 + n * 0.8 + pos * 1.1;
    const c2 = c1 * 2.4 + 2;
    const amps = [0];
    for (let h = 1; h <= 40; h++) amps.push((0.35 / h) + Math.exp(-((h - c1) ** 2) / 2.5) + 0.6 * Math.exp(-((h - c2) ** 2) / 6));
    t = harmonicTable(amps);
  } else {
    // "Random collection": fixed pseudo-random harmonic sets, blended between table positions.
    const set = (k) => { const r = rng(wave * 7919 + k * 104729); const a = [0]; for (let h = 1; h <= 24; h++) a.push(r() ** 2 / h ** 0.6); return a; };
    const a = set(lo);
    const b = set(lo + 1);
    t = harmonicTable(a.map((v, h) => (1 - f) * v + f * b[h]));
  }

  if (vsync > 0) {
    // Virtual sync: the shape runs faster than the note and restarts every cycle.
    const ratio = 1 + (vsync / 127) * 3;
    const src = t;
    t = new Float32Array(TABLE);
    for (let i = 0; i < TABLE; i++) t[i] = src[Math.floor(frac((i / TABLE) * ratio) * TABLE)];
  }
  let peak = 0;
  for (let i = 0; i < TABLE; i++) peak = Math.max(peak, Math.abs(t[i]));
  if (peak > 0) for (let i = 0; i < TABLE; i++) t[i] /= peak;
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
const LFO_LEVEL_SEQ = {
  7: [1, 0, 1, 0, 1, 1, 0, 0], 8: [1, 1, 0, 1, 0, 0, 1, 0], 9: [1, 0, 0, 0, 1, 0, 1, 1],
  10: [1, 0, 1, 1, 0, 1, 0, 0], 11: [1, 1, 1, 0, 0, 1, 0, 1], 12: [1, 0, 0, 1, 0, 0, 1, 0],
  13: [1, 1, 0, 0, 1, 0, 1, 1], 14: [1, -1], 15: [1, -1, 1, -1, 1, 1, -1, -1], 16: [1, 0, -1, 0],
  17: [1, 1, -1, -1], 18: [1, -1, -1, 1], 19: [1, 0.5, -0.5, -1], 20: [1, -0.5, 1, -1, 0.5, -1],
  21: [0.5, 1, -1, -0.5],
};
const LFO_PITCH_SEQ = {
  22: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], 23: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  24: [0, 2, 4, 5, 7, 9, 11, 12], 25: [0, 4, 7, 11], 26: [0, 3, 7, 10], 27: [0, 3, 7, 12],
  28: [0, 3, 7, 12, 7, 3], 29: [0, 3, 6, 9], 30: [12, 10, 8, 7, 5, 3, 2, 0], 31: [0, 3],
  32: [0, 0, 12, 0], 33: [0, 5], 34: [0, 5, 10, 3, 8, 1, 6, 11, 4, 9, 2, 7], 35: [0, 9, 2, 7],
  36: [0, 8, 2, 7], 37: [2, 7, 0, 0],
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
  if (wave === 6) { for (let i = 0; i < n; i++) d[i] = Math.exp((-5 * i) / n); return d; }
  const values = wave === 4 || wave === 5 ? SH_VALUES : LFO_LEVEL_SEQ[wave] ?? (LFO_PITCH_SEQ[wave] ?? [0]).map((s) => s / 12);
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
    // The hardware's noise is flat to about 10 kHz and falls away above 14 kHz (calibration
    // set 3): white noise through a 4-pole low-pass, brought back to the level of white noise.
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const w0 = (2 * Math.PI * Math.min(15000, ctx.sampleRate * 0.45)) / ctx.sampleRate;
    const al = Math.sin(w0) / (2 * 0.707);
    const cw = Math.cos(w0);
    const b0 = (1 - cw) / 2 / (1 + al), b1 = (1 - cw) / (1 + al), a1 = (-2 * cw) / (1 + al), a2 = (1 - al) / (1 + al);
    for (let pass = 0; pass < 2; pass++) {
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

// Waveshaper curves for the filter drive and the distortion effect (types as on the hardware).
function shaperShape(type, amount) {
  const n = 2048;
  const c = new Float32Array(n);
  const k = 1 + amount * 14;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    let y;
    if (type === 1) y = x >= 0 ? Math.tanh(x * k) : Math.tanh(x * k * 0.6) / 0.9;            // valve
    else if (type === 2) y = clamp(x * (1 + amount * 5), -0.8, 0.8) / 0.8;                    // clipper
    else if (type === 3) { const dz = amount * 0.25; y = Math.abs(x) < dz ? 0 : Math.tanh((x - Math.sign(x) * dz) * k); } // cross-over
    else if (type === 4) y = (1 - amount) * x + amount * (Math.abs(x) * 2 - 1);                // rectifier
    else if (type === 5) { const lv = Math.max(2, Math.round(24 - amount * 21)); y = Math.round(x * lv) / lv; } // bit reducer
    else if (type === 6) { const st = Math.max(3, Math.round(40 - amount * 34)); y = Math.round(Math.sin(x * Math.PI / 2) * st) / st; } // rate reducer
    else y = Math.tanh(x * k) / Math.tanh(k);                                                  // diode
    c[i] = y;
  }
  return c;
}

// Level each type adds, measured on the Circuit Tracks with a sine (RMS dB against the clean
// patch, by 0-127 setting). Types without a row keep the level of the clean signal.
const DRIVE_DB = [
  [[0, 0], [32, 2], [64, 5], [127, 8]],                       // diode
  [[0, 0], [32, 1], [64, 4], [127, 6]],                       // valve
  [[0, 0], [32, 5], [64, 7], [127, 8]],                       // clipper
];
const DIST_DB = [
  [[0, 0], [32, 1.4], [64, 4.6], [96, 9], [127, 10.8]],       // diode
  [[0, 0], [32, 1.3], [64, 4.3], [96, 8.5], [127, 10.1]],     // valve
  [[0, 0], [32, 5], [64, 9], [96, 12], [127, 15]],            // clipper
  [[0, 0], [32, -3.6], [64, -9], [80, 0], [96, 7], [127, 11]], // cross-over
];
const tableDb = (rows, v) => {
  if (!rows) return 0;
  for (let i = 1; i < rows.length; i++) {
    if (v <= rows[i][0]) return rows[i - 1][1] + ((rows[i][1] - rows[i - 1][1]) * (v - rows[i - 1][0])) / (rows[i][0] - rows[i - 1][0]);
  }
  return rows[rows.length - 1][1];
};
const curveAt = (c, x) => {
  const p = clamp((x + 1) / 2, 0, 1) * (c.length - 1);
  const i = Math.min(c.length - 2, Math.floor(p));
  return c[i] + (c[i + 1] - c[i]) * (p - i);
};

// A shaper curve scaled so that a sine of peak `ref` going through `dry * x + wet * curve(x)`
// comes out `db` louder (RMS) than it went in: the curve gives the tone, the hardware
// measurement gives the level.
function shaperCurve(type, amount, { ref, db, dry = 0, wet = 1 }) {
  const c = shaperShape(type, amount);
  if (wet <= 0) return c;
  const N = 256;
  const xs = [];
  const ys = [];
  for (let i = 0; i < N; i++) { const x = ref * Math.sin((2 * Math.PI * (i + 0.5)) / N); xs.push(x); ys.push(curveAt(c, x)); }
  const target = (ref * ref / 2) * 10 ** (db / 10);
  const power = (s) => { let a = 0; for (let i = 0; i < N; i++) a += (dry * xs[i] + wet * s * ys[i]) ** 2; return a / N; };
  let lo = 0;
  let hi = 1;
  while (power(hi) < target && hi < 4096) hi *= 2;
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (power(mid) < target) lo = mid; else hi = mid; }
  if (power(lo) > target * 1.001 && power(0) > target) return c.fill(0);   // the dry part alone is already louder
  for (let i = 0; i < c.length; i++) c[i] *= hi;
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
// Natural frequency of the filter against the measured -3 dB point of the 12 dB low-pass.
const CUTOFF_TO_F0 = 0.93;

const chorusHz = (v) => Math.max(0.02, 0.0013 * v * v);          // measured on the phaser: 40 -> 2 Hz, 100 -> 12.7 Hz
const lfoDelaySeconds = (v) => (v / 127) ** 2 * 6;

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
    this.distSum = c.createGain();
    this.voiceBus.connect(this.distDry).connect(this.distSum);
    this.voiceBus.connect(this.shaper).connect(this.distWet).connect(this.distSum);

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
    const ckey = `${dtype}|${distLevel}`;
    if (ckey !== this.curveKey) {
      this.shaper.curve = shaperCurve(dtype, dist, { ref: DIST_REF, db: tableDb(DIST_DB[dtype], distLevel), dry: 1 - dist, wet: dist });
      this.curveKey = ckey;
    }
    set(this.distWet.gain, dist);
    set(this.distDry.gain, 1 - dist);

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
    set(this.phaserDepth.gain, 600 + depth * 2400);
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
        lfo.src.start();
        lfo.wave = wave;
      } else {
        set(lfo.src.playbackRate, wave === 4 || wave === 5 ? this.lfoRateHz(n) / SH_STEPS : this.lfoRateHz(n));
      }
    }

    for (const v of this.voices) {
      if (v.dead) continue;
      const fc = this.filterHz(v.note);
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

  filterHz(note) {
    const track = this.val('filter_tracking') / 127;
    return clamp(cutoffHz(this.val('filter_frequency')) * CUTOFF_TO_F0 * 2 ** (((note - 60) / 12) * track), 20, 20000);
  }

  // Q of each filter section (as a plain ratio), and what Web Audio wants for it: low- and
  // high-pass take Q in dB, band-pass as a ratio.
  filterQ(stages) {
    return Math.exp(tableDb(stages > 1 ? RES_LNQ2 : RES_LNQ1, this.val('filter_resonance')));
  }

  filterQParam(stages, ftype) {
    const q = this.filterQ(stages);
    return ftype === 2 || ftype === 3 ? q : 20 * Math.log10(q);
  }

  // Level after the filter: the drop with resonance, and the band-pass peak growing with Q.
  filterGain(stages, ftype) {
    const g = 10 ** (tableDb(RES_GAIN_DB, this.val('filter_resonance')) / 20);
    return ftype === 2 || ftype === 3 ? g * this.filterQ(stages) ** stages : g;
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
    const glideTime = (porta / 127) ** 2 * 1.5;
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
      const spread = 4 + (this.val(`osc${n}_density_detune`) / 127) * 44;
      const wave = this.oscWave(n);
      const out = c.createGain();
      out.gain.value = 1 / Math.sqrt(1 + 2 * density * density);
      const list = [];
      for (const [sp, g] of density > 0 ? [[0, 1], [spread, density], [-spread, density]] : [[0, 1]]) {
        const osc = c.createOscillator();
        osc.setPeriodicWave(wave);
        const target = midiHz(pitch + semis + HARDWARE_TRANSPOSE);
        if (glideFrom != null && glideTime > 0.002) {
          osc.frequency.setValueAtTime(midiHz(glideFrom + semis + HARDWARE_TRANSPOSE), t);
          osc.frequency.exponentialRampToValueAtTime(target, t + glideTime);
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
      sh.curve = shaperCurve(dt, drive, { ref: DRIVE_REF, db: tableDb(DRIVE_DB[dt], this.val('filter_drive')) });
      node.connect(sh);
      node = sh;
    }
    const ftype = b[P.filter_type.a];
    const stages = ftype === 1 || ftype === 3 || ftype === 5 ? 2 : 1;
    const filters = [];
    const fc = this.filterHz(pitch);
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
    // Fits every measured point within about 0.3 dB. Measured on envelope 1; assumed for envelope 2.
    const velCurve = 0.015 + 0.985 * vel * vel;
    const envVel = (id) => {
      const v = this.val(id);
      return v >= 64 ? 1 - ((v - 64) / 63) * (1 - velCurve) : Math.max(0.0075, 1 - ((64 - v) / 64) * velCurve);
    };
    const runEnv = (param, prefix, peak) => {
      const del = prefix === 'env3' ? (this.val('env3_delay') / 127) ** 2 * 4 : 0;
      const a = Math.max(0.0015, attackSeconds(this.val(`${prefix}_attack`)));
      const dTau = Math.max(0.003, decaySeconds(this.val(`${prefix}_decay`)) / 6.9);
      const sus = this.val(`${prefix}_sustain`) / 127;
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
      const cents = (filterSteps(envAmount) / 11.5) * 1200 * envVel('env2_velocity');
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
        if (src === 6 || src === 8) {                      // unipolar: (x + 1) / 2
          const half = c.createGain(); half.gain.value = 0.5;
          const sum = c.createGain();
          const k = c.createConstantSource(); k.offset.value = 0.5; k.start(t);
          link(nodeL, half).connect(sum); k.connect(sum);
          voice.sources.push(k); voice.nodes.push(half);
          nodeL = sum;
        }
        const dly = lfoDelaySeconds(this.val(`lfo${n + 1}_delay`));
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
          runEnv(k.offset, prefix, 1);
          k.start(t);
          voice.sources.push(k);
          envNodes[prefix] = k;
        }
        return envNodes[prefix];
      }
      return null;
    };
    const staticValue = (src) => (src === 4 ? vel : src === 5 ? (pitch - 60) / 60 : 1);
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
      else if (dest === 12) { scale = (filterSteps(depth) / 11.5) * 1200; targets = filters.map((f) => f.detune); }
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
      e.param.setValueAtTime(PatchSynth.envAt(e, time), time);
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
