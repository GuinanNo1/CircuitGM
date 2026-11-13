// The Circuit Tracks project mixer in Web Audio: eight track strips (level, linear-balance pan,
// reverb and delay sends; drum strips also get distortion and EQ), the reverb, the delay, the
// master filter and the sidechain duck. The numbers come from js/pw/mixlaws.js (calibration
// set 7). The master compressor is not modelled (not measured yet).
//
// Track order is the hardware's: 0-1 Synth 1-2, 2-3 MIDI 1-2, 4-7 Drum 1-4.
//
//   strip.input -> [drum: EQ, distortion] -> duck -> level -> balance -> bus -> master filter -> out
//                                                     \-> reverb send, delay send -> FX -> bus
import { levelGain, balance, reverbRt60, reverbHfRatio, reverbSpread, sendGain, delaySeconds,
  delayFeedback, delayWidth, delayLR, delaySlew, DELAY_ECHO_GAIN, masterFilter, sidechainShape,
  drumDrive, drumTilt, DELAY_MAX } from './mixlaws.js?v=20261114e';

// The reverb's wet level for a full send, against the dry signal (set by ear: not measured).
export const REVERB_WET = 0.3;
const TAU = 0.015; // smoothing for control changes

export class Mixer {
  constructor(ctx, destination = ctx.destination) {
    this.ctx = ctx;
    const c = ctx;
    this.bus = c.createGain();
    this.out = c.createGain();
    this.out.connect(destination);

    // Master filter: two 12 dB stages, crossfaded against a straight path when off.
    this.filters = [c.createBiquadFilter(), c.createBiquadFilter()];
    this.filterWet = c.createGain();
    this.filterDry = c.createGain();
    this.bus.connect(this.filters[0]).connect(this.filters[1]).connect(this.filterWet).connect(this.out);
    this.bus.connect(this.filterDry).connect(this.out);

    // Reverb.
    this.reverbIn = c.createGain();
    this.convolver = c.createConvolver();
    this.reverbOut = c.createGain();
    this.reverbIn.connect(this.convolver).connect(this.reverbOut).connect(this.bus);
    this.reverbKey = '';

    // Delay: a separate line per side, each feeding back on itself. Web Audio adds one render
    // block (128 frames) to any loop, so the loop's own line is that much shorter than the
    // first echo's.
    this.delayIn = c.createGain();
    this.delayOut = c.createGain();
    const merge = c.createChannelMerger(2);
    this.delaySides = [0, 1].map((side) => {
      const line = c.createDelay(DELAY_MAX * 2 + 0.05);
      const loop = c.createDelay(DELAY_MAX * 2 + 0.05);
      const sum = c.createGain();
      const fb = c.createGain();
      const lvl = c.createGain();
      this.delayIn.connect(line).connect(sum);
      sum.connect(loop).connect(fb).connect(sum);
      sum.connect(lvl).connect(merge, 0, side);
      return { line, loop, fb, lvl };
    });
    merge.connect(this.delayOut).connect(this.bus);

    this.strips = Array.from({ length: 8 }, (_, t) => this.makeStrip(t));
    this.shapes = [null, null];
    this.mix = null;
    this.apply(null);
  }

  makeStrip(t) {
    const c = this.ctx;
    const s = { input: c.createGain(), duck: c.createGain(), level: c.createGain(),
      left: c.createGain(), right: c.createGain(), reverb: c.createGain(), delay: c.createGain(),
      mute: c.createGain() };
    let node = s.input;
    if (t >= 4) {
      s.low = c.createBiquadFilter(); s.low.type = 'lowshelf'; s.low.frequency.value = 300;
      s.high = c.createBiquadFilter(); s.high.type = 'highshelf'; s.high.frequency.value = 2000;
      s.dry = c.createGain(); s.wet = c.createGain(); s.shaper = c.createWaveShaper();
      s.shaper.oversample = '2x';
      const sum = c.createGain();
      node.connect(s.low).connect(s.high);
      s.high.connect(s.dry).connect(sum);
      s.high.connect(s.shaper).connect(s.wet).connect(sum);
      node = sum;
      s.drive = -1;
    }
    const split = c.createChannelSplitter(2);
    const merge = c.createChannelMerger(2);
    // A mono source goes to both sides of the splitter only if it is up-mixed first.
    s.level.channelCount = 2; s.level.channelCountMode = 'explicit'; s.level.channelInterpretation = 'speakers';
    node.connect(s.duck).connect(s.level).connect(s.mute);
    s.mute.connect(split);
    split.connect(s.left, 0).connect(merge, 0, 0);
    split.connect(s.right, 1).connect(merge, 0, 1);
    merge.connect(this.bus);
    s.mute.connect(s.reverb).connect(this.reverbIn);
    s.mute.connect(s.delay).connect(this.delayIn);
    return s;
  }

  set(param, v) { param.setTargetAtTime(v, this.ctx.currentTime, TAU); }

  // Apply a project's mix (projectMix() in mixlaws.js), or null for a neutral mixer: unity
  // levels, centre pans, no sends, no sidechain, flat drums, filter off (how the plain preview
  // played before the mixer existed).
  apply(mix) {
    this.mix = mix;
    const neutral = { level: 127, pan: 64, reverb: 0, delay: 0, sidechain: null, pitch: 64, decay: 127, distortion: 0, eq: 64 };
    for (let t = 0; t < 8; t++) {
      const m = !mix ? neutral : t < 2 ? mix.synth[t] : t >= 4 ? mix.drums[t - 4] : neutral;
      this.setStrip(t, m);
    }
    this.shapes = [0, 1].map((i) => (mix ? sidechainShape(mix.synth[i].sidechain ?? {}) : null));
    if (mix) {
      this.setReverb(mix.reverb);
      this.setDelay(mix.delay, mix.tempo, true);
      this.setBypass(mix.bypass);
      this.setFilter(mix.filter.cutoff, mix.filter.resonance);
    } else {
      this.setBypass(true);
      this.setFilter(64, 64);
    }
  }

  setStrip(t, m) {
    const s = this.strips[t];
    s.cfg = m;
    this.set(s.level.gain, levelGain(m.level));
    const [l, r] = balance(m.pan);
    this.set(s.left.gain, l);
    this.set(s.right.gain, r);
    this.set(s.reverb.gain, sendGain(m.reverb));
    this.set(s.delay.gain, sendGain(m.delay));
    if (s.low) {
      const tilt = drumTilt(m.eq ?? 64);
      this.set(s.low.gain, tilt.lowDb);
      this.set(s.high.gain, tilt.highDb);
      const drive = drumDrive(m.distortion ?? 0);
      if (drive !== s.drive) {
        s.drive = drive;
        if (drive > 0) s.shaper.curve = tanhCurve(drive);
        this.set(s.dry.gain, drive > 0 ? 0 : 1);
        this.set(s.wet.gain, drive > 0 ? 1 : 0);
      }
    }
  }

  setMute(t, audible) { this.set(this.strips[t].mute.gain, audible ? 1 : 0); }

  setReverb({ type, decay, damping }) {
    const rt = reverbRt60(type, decay);
    const hf = reverbHfRatio(damping, decay);
    const spread = reverbSpread(type);
    const key = `${rt.toFixed(3)}|${hf.toFixed(3)}|${spread.toFixed(2)}`;
    if (key === this.reverbKey) return;
    this.reverbKey = key;
    this.convolver.buffer = impulse(this.ctx, rt, hf, spread);
  }

  setDelay({ time, sync, feedback, width, ratio, slew }, bpm = 120, immediate = false) {
    const secs = delaySeconds(time, sync, bpm);
    const lr = delayLR(ratio);
    const fb = delayFeedback(feedback);
    const w = secs > 0 ? delayWidth(width) * DELAY_ECHO_GAIN : 0;
    const now = this.ctx.currentTime;
    const glide = immediate ? 0.001 : delaySlew(slew);
    this.delaySides.forEach((d, side) => {
      const s = Math.max(0.001, side ? secs * lr.right : secs);
      d.line.delayTime.setTargetAtTime(s, now, glide);
      d.loop.delayTime.setTargetAtTime(Math.max(0, s - 128 / this.ctx.sampleRate), now, glide);
      this.set(d.fb.gain, fb);
      this.set(d.lvl.gain, w * (side ? lr.r : lr.l));
    });
  }

  setBypass(on) {
    this.set(this.reverbOut.gain, on ? 0 : REVERB_WET);
    this.set(this.delayOut.gain, on ? 0 : 1);
  }

  setFilter(cutoff, resonance) {
    const f = masterFilter(cutoff, resonance);
    if (this.mix) this.mix.filter = { cutoff, resonance };
    const on = f.type !== 'off';
    if (on) {
      for (const b of this.filters) {
        b.type = f.type;
        this.set(b.frequency, f.hz);
        this.set(b.Q, f.q);
      }
    }
    this.set(this.filterWet.gain, on ? 1 : 0);
    this.set(this.filterDry.gain, on ? 0 : 1);
  }

  // A drum note (drum 0-3) at `time`: duck the synths whose sidechain listens to that drum.
  // Fires whatever the drum's level (measured: it ducks even with the drum at level 0).
  trigger(drum, time) {
    this.shapes.forEach((sh, t) => {
      if (!sh || sh.drum !== drum) return;
      const g = this.strips[t].duck.gain;
      if (typeof g.cancelAndHoldAtTime === 'function') g.cancelAndHoldAtTime(time);
      else { g.cancelScheduledValues(time); g.setValueAtTime(g.value, time); }
      g.linearRampToValueAtTime(sh.floor, time + sh.attack);
      g.setValueAtTime(sh.floor, time + sh.attack + sh.hold);
      g.setTargetAtTime(1, time + sh.attack + sh.hold, sh.tau);
    });
  }

  // Release any duck in progress (on stop).
  reset() {
    for (const s of this.strips) {
      s.duck.gain.cancelScheduledValues(0);
      s.duck.gain.setValueAtTime(1, this.ctx.currentTime);
    }
  }
}

const curves = new Map();
function tanhCurve(drive) {
  const key = drive.toFixed(2);
  if (curves.has(key)) return curves.get(key);
  const n = 2048;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) c[i] = Math.tanh(drive * ((i / (n - 1)) * 2 - 1));
  curves.set(key, c);
  return c;
}

// A stereo reverb impulse: decaying noise, the high band (above about 3 kHz) dying away faster
// than the low band by `hf`, the two sides `spread` apart (0 = identical, 1 = independent).
// Scaled so its energy grows with the decay time, as a real room's does.
export function impulse(ctx, rt60, hf, spread) {
  const sr = ctx.sampleRate;
  const len = Math.max(Math.round(sr * 0.1), Math.round(sr * Math.min(7, rt60 * 1.3)));
  const buf = ctx.createBuffer(2, len, sr);
  let seed = 22222;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2147483648 - 1; };
  const shared = new Float32Array(len);
  for (let i = 0; i < len; i++) shared[i] = rnd();
  const a = Math.exp(-2 * Math.PI * 3000 / sr);
  const kLo = -6.9078 / (rt60 * sr);
  const kHi = -6.9078 / (rt60 * Math.max(0.05, hf) * sr);
  const mixS = Math.sqrt(1 - spread), mixO = Math.sqrt(spread);
  const fade = Math.round(sr * 0.004);
  let energy = 0;
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const n = mixS * shared[i] + mixO * rnd();
      lp = (1 - a) * n + a * lp;
      const v = lp * Math.exp(kLo * i) + (n - lp) * Math.exp(kHi * i);
      d[i] = i < fade ? v * (i / fade) : v;
      energy += d[i] * d[i];
    }
  }
  const scale = Math.sqrt(rt60 / 0.91) / Math.sqrt(energy / 2 || 1);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] *= scale;
  }
  return buf;
}
