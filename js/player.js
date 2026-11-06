// Preview playback with Web Audio. Melodic parts use simple synth voices chosen by GM
// instrument family (a sketch of the part, not the Circuit Tracks patch); drums use the
// actual TracksGM samples of the chosen kit.
//
// Events: { t: seconds, d: seconds, track: 0-7, note, vel, part? (drum kit part), program? }

const LOOKAHEAD = 0.15;
const TICK_MS = 25;

export class Player {
  constructor() {
    this.ctx = null;
    this.drumBuffers = new Map();   // part -> AudioBuffer
    this.mutes = new Array(8).fill(false);
    this.solo = -1;
    this.timer = null;
    this.raf = null;
    this.onPosition = null;
    this.onEnd = null;
  }

  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      this.master.connect(comp).connect(this.ctx.destination);
      this.trackGains = Array.from({ length: 8 }, () => {
        const g = this.ctx.createGain();
        g.connect(this.master);
        return g;
      });
      this.noise = makeNoise(this.ctx);
    }
    return this.ctx;
  }

  async setDrumSamples(map) {
    this.ensure();
    this.drumBuffers.clear();
    for (const [part, bytes] of map) {
      try {
        this.drumBuffers.set(part, await this.ctx.decodeAudioData(bytes.slice(0)));
      } catch { /* keep the synth fallback for this part */ }
    }
  }

  setMute(track, on) { this.mutes[track] = on; this.applyGains(); }
  setSolo(track) { this.solo = this.solo === track ? -1 : track; this.applyGains(); }
  applyGains() {
    if (!this.ctx) return;
    this.trackGains.forEach((g, t) => {
      const audible = this.solo >= 0 ? t === this.solo : !this.mutes[t];
      g.gain.setTargetAtTime(audible ? 1 : 0, this.ctx.currentTime, 0.01);
    });
  }

  get playing() { return this.timer !== null; }

  async play(events, { from = 0, length } = {}) {
    this.stop();
    const ctx = this.ensure();
    if (ctx.state === 'suspended') await ctx.resume();
    this.applyGains();
    this.events = events;
    this.length = length ?? Math.max(0, ...events.map((e) => e.t + e.d));
    this.startTime = ctx.currentTime + 0.08 - from;
    this.idx = events.findIndex((e) => e.t >= from);
    if (this.idx < 0) this.idx = events.length;
    this.voices = [];
    this.timer = setInterval(() => this.schedule(), TICK_MS);
    this.schedule();
    const frame = () => {
      const pos = ctx.currentTime - this.startTime;
      this.onPosition?.(Math.max(0, pos));
      if (pos > this.length + 0.3) { this.stop(); this.onEnd?.(); return; }
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.raf) cancelAnimationFrame(this.raf);
    this.timer = null;
    this.raf = null;
    const now = this.ctx?.currentTime ?? 0;
    for (const v of this.voices ?? []) {
      try { v.gain.gain.cancelScheduledValues(now); v.gain.gain.setTargetAtTime(0, now, 0.02); v.src.stop(now + 0.1); } catch { /* already stopped */ }
    }
    this.voices = [];
  }

  schedule() {
    const ctx = this.ctx;
    const horizon = ctx.currentTime + LOOKAHEAD - this.startTime;
    while (this.idx < this.events.length && this.events[this.idx].t < horizon) {
      const e = this.events[this.idx++];
      const at = this.startTime + e.t;
      if (at < ctx.currentTime - 0.05) continue;
      if (e.part) this.drum(e, at); else this.tone(e, at);
    }
    // Forget finished voices.
    if (this.voices.length > 256) this.voices = this.voices.filter((v) => v.end > ctx.currentTime);
  }

  tone(e, at) {
    const ctx = this.ctx;
    const fam = family(e.program ?? 0);
    const f = 440 * 2 ** ((e.note - 69) / 12);
    const vel = (e.vel / 127) ** 1.5 * 0.32;
    const osc = ctx.createOscillator();
    osc.type = fam.wave;
    osc.frequency.value = f;
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = Math.min(16000, f * fam.bright);
    filt.Q.value = 0.7;
    const g = ctx.createGain();
    const dur = Math.max(0.03, e.d);
    const end = at + dur + fam.release;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(vel, at + fam.attack);
    if (fam.decay) g.gain.setTargetAtTime(vel * fam.sustain, at + fam.attack, fam.decay);
    g.gain.setTargetAtTime(0, at + dur, fam.release / 3);
    osc.connect(filt).connect(g).connect(this.trackGains[e.track]);
    osc.start(at);
    osc.stop(end + 0.05);
    this.voices.push({ src: osc, gain: g, end });
  }

  drum(e, at) {
    const ctx = this.ctx;
    const buf = this.drumBuffers.get(e.part);
    const g = ctx.createGain();
    g.gain.value = (e.vel / 127) * 0.9;
    g.connect(this.trackGains[e.track]);
    let src;
    if (buf) {
      src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(g);
      src.start(at);
      this.voices.push({ src, gain: g, end: at + buf.duration });
      return;
    }
    // Fallback synth drums (used before the kit has loaded).
    src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filt = ctx.createBiquadFilter();
    const len = { kick: 0.25, snare: 0.18, tom: 0.25, ch: 0.05, oh: 0.35, rimclap: 0.08, cymbal: 0.9, perc: 0.12 }[e.part] ?? 0.1;
    filt.type = e.part === 'kick' || e.part === 'tom' ? 'lowpass' : 'highpass';
    filt.frequency.value = { kick: 180, tom: 500, snare: 1500, ch: 7000, oh: 6000, cymbal: 5000, rimclap: 2000, perc: 3000 }[e.part] ?? 2000;
    g.gain.setValueAtTime(g.gain.value, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + len);
    src.connect(filt).connect(g);
    src.start(at);
    src.stop(at + len + 0.05);
    this.voices.push({ src, gain: g, end: at + len });
  }
}

function makeNoise(ctx) {
  const b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

// Rough voice per GM family: waveform, brightness, envelope.
function family(program) {
  const f = Math.floor(program / 8);
  const T = {
    0: { wave: 'triangle', bright: 6, attack: 0.005, decay: 0.5, sustain: 0.25, release: 0.25 },   // piano
    1: { wave: 'sine', bright: 10, attack: 0.002, decay: 0.3, sustain: 0.1, release: 0.4 },        // chromatic perc
    2: { wave: 'square', bright: 4, attack: 0.01, decay: 0, sustain: 1, release: 0.06 },           // organ
    3: { wave: 'sawtooth', bright: 5, attack: 0.004, decay: 0.4, sustain: 0.3, release: 0.15 },    // guitar
    4: { wave: 'sawtooth', bright: 3, attack: 0.005, decay: 0.25, sustain: 0.6, release: 0.08 },   // bass
    5: { wave: 'sawtooth', bright: 4, attack: 0.08, decay: 0, sustain: 1, release: 0.3 },          // strings
    6: { wave: 'sawtooth', bright: 4, attack: 0.06, decay: 0, sustain: 1, release: 0.3 },          // ensemble
    7: { wave: 'sawtooth', bright: 6, attack: 0.03, decay: 0, sustain: 1, release: 0.12 },         // brass
    8: { wave: 'square', bright: 5, attack: 0.03, decay: 0, sustain: 1, release: 0.1 },            // reed
    9: { wave: 'sine', bright: 8, attack: 0.04, decay: 0, sustain: 1, release: 0.12 },             // pipe
    10: { wave: 'sawtooth', bright: 8, attack: 0.005, decay: 0, sustain: 1, release: 0.08 },       // synth lead
    11: { wave: 'sawtooth', bright: 3, attack: 0.25, decay: 0, sustain: 1, release: 0.6 },         // synth pad
    12: { wave: 'triangle', bright: 6, attack: 0.1, decay: 0, sustain: 1, release: 0.5 },          // synth fx
    13: { wave: 'triangle', bright: 8, attack: 0.003, decay: 0.4, sustain: 0.2, release: 0.3 },    // ethnic
    14: { wave: 'triangle', bright: 10, attack: 0.002, decay: 0.15, sustain: 0, release: 0.1 },    // percussive
    15: { wave: 'triangle', bright: 4, attack: 0.05, decay: 0.3, sustain: 0.4, release: 0.3 },     // sfx
  };
  return T[f] ?? T[0];
}
