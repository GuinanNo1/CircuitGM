// Preview playback with Web Audio. Melodic parts use simple synth voices chosen by GM
// instrument family (a sketch of the part, not the Circuit Tracks patch); drums use the
// actual TracksGM samples of the chosen kit.
//
// Events: { t: seconds, d: seconds, track: 0-7, note, vel, part? (drum kit part), program?,
//   env? ({ attack, decay, sustain, release } from the Circuit patch; otherwise a guess by GM family) }
//
// Every track goes through the project mixer (js/pw/mixer.js). It is neutral until
// setProject() is given a Circuit Tracks project: then the project's levels, pans, sends,
// reverb, delay, drum settings and sidechain apply as measured on the hardware (calibration
// set 7), and the two synth tracks can play their patches on PatchWorker's browser synth.
import { Mixer } from './pw/mixer.js?v=20261113n';
import { projectMix, drumRate, drumDecaySeconds } from './pw/mixlaws.js?v=20261113n';
import { PatchSynth } from './pw/engine.js?v=20261113n';

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
      this.mixer = new Mixer(this.ctx, this.master);
      this.trackGains = this.mixer.strips.map((s) => s.input);
      this.noise = makeNoise(this.ctx);
      this.synths = [null, null];
      if (this.pendingProject) this.setProject(...this.pendingProject);
    }
    return this.ctx;
  }

  // A Circuit Tracks project (parsed by js/vendor/ncs.js) to mix like the hardware, or null for
  // the plain neutral preview. patches: [Synth 1, Synth 2] 340-byte patches to play the synth
  // tracks with the browser synth (default: the patches saved in the project); pass
  // { patches: false } to keep the simple preview voices for them.
  setProject(proj, { patches } = {}) {
    if (!this.ctx) { this.pendingProject = [proj, { patches }]; this.mix = proj ? projectMix(proj) : null; return; }
    this.pendingProject = null;
    this.mix = proj ? projectMix(proj) : null;
    this.mixer.apply(this.mix);
    const bytes = patches === false || !proj ? [null, null] : patches ?? [proj.synth1Patch, proj.synth2Patch];
    for (let i = 0; i < 2; i++) {
      if (bytes[i]?.length >= 340) {
        this.synths[i] ??= new PatchSynth(this.ctx, this.trackGains[i]);
        this.synths[i].bpm = this.mix?.tempo ?? 120;
        this.synths[i].setPatch(new Uint8Array(bytes[i]));
      } else if (this.synths[i]) {
        this.synths[i].allNotesOff();
        this.synths[i] = null;
      }
    }
  }

  // The master filter (CC 74 cutoff, CC 71 resonance: below 64 low-pass, 64 off, above high-pass).
  setFilter(cutoff, resonance = 64) { this.ensure(); this.mixer.setFilter(cutoff, resonance); }

  async setDrumSamples(map) {
    this.ensure();
    this.drumBuffers.clear();
    for (const [part, bytes] of map) {
      try {
        this.drumBuffers.set(part, await this.ctx.decodeAudioData(bytes.slice(0)));
      } catch { /* keep the synth fallback for this part */ }
    }
  }

  // Play one sample on its own, straight to the output (mutes and solo don't apply), so a
  // reader can hear which sound it is. bytes: the file, used when the sample isn't loaded yet.
  // Returns the sample's length in seconds; onEnd runs when it finishes or is stopped.
  async audition(part, bytes, onEnd) {
    const ctx = this.ensure();
    if (ctx.state === 'suspended') await ctx.resume();
    this.stopAudition();
    let buf = this.drumBuffers.get(part);
    if (!buf && bytes) {
      buf = await ctx.decodeAudioData(bytes.slice(0));
      this.drumBuffers.set(part, buf);
    }
    if (!buf) throw new Error('This sample could not be played.');
    const src = ctx.createBufferSource();
    const g = ctx.createGain();
    g.gain.value = 0.8;
    src.buffer = buf;
    src.connect(g).connect(this.master);
    const a = { src, g, onEnd };
    src.onended = () => { if (this.auditioning === a) { this.auditioning = null; onEnd?.(); } };
    this.auditioning = a;
    src.start();
    return buf.duration;
  }

  stopAudition() {
    const a = this.auditioning;
    if (!a) return;
    this.auditioning = null;
    const now = this.ctx.currentTime;
    try { a.g.gain.setTargetAtTime(0, now, 0.01); a.src.stop(now + 0.05); } catch { /* already stopped */ }
    a.onEnd?.();
  }

  setMute(track, on) { this.mutes[track] = on; this.applyGains(); }
  setSolo(track) { this.solo = this.solo === track ? -1 : track; this.applyGains(); }
  applyGains() {
    if (!this.ctx) return;
    for (let t = 0; t < 8; t++) this.mixer.setMute(t, this.solo >= 0 ? t === this.solo : !this.mutes[t]);
  }

  get playing() { return this.timer !== null; }
  get position() { return this.playing ? Math.max(0, this.ctx.currentTime - this.startTime) : 0; }

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
    this.held = new Map();
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
    this.held?.clear();
    for (const syn of this.synths ?? []) syn?.allNotesOff();
    this.mixer?.reset();
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
    const syn = e.track < 2 && this.mix ? this.synths?.[e.track] : null;
    if (syn) { syn.noteOn(e.note, e.vel, at, Math.max(0.01, e.d)); return; }
    const fam = family(e.program ?? 0);
    // The Circuit patch's own envelope when we have it: a guess from the GM family can be far
    // off (a "pad" fading in over 0.25 s makes short chords sound late).
    const env = e.env ?? fam;
    const attack = Math.max(0.002, env.attack);
    const release = Math.max(0.01, env.release);
    const f = 440 * 2 ** ((e.note - 69) / 12);
    const vel = (e.vel / 127) ** 1.5 * 0.32;
    // The same note again on a track retriggers it, as on the hardware, instead of stacking a
    // second voice on the first.
    const key = e.track * 128 + e.note;
    const prev = this.held.get(key);
    if (prev && prev.end > at) {
      try { prev.gain.gain.cancelScheduledValues(at); prev.gain.gain.setTargetAtTime(0, at, 0.004); prev.src.stop(at + 0.03); } catch { /* already stopped */ }
      prev.end = at;
    }
    const osc = ctx.createOscillator();
    osc.type = fam.wave;
    osc.frequency.value = f;
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = Math.min(16000, f * fam.bright);
    filt.Q.value = 0.7;
    const g = ctx.createGain();
    const dur = Math.max(0.03, e.d);
    const end = at + dur + release;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(vel, at + attack);
    // Patch decay times are to (near) the sustain level, so a third of one is the time constant;
    // the family guesses were tuned as time constants already.
    if (env.decay && env.sustain < 1) g.gain.setTargetAtTime(vel * env.sustain, at + attack, e.env ? env.decay / 3 : env.decay);
    g.gain.setTargetAtTime(0, at + dur, release / 3);
    osc.connect(filt).connect(g).connect(this.trackGains[e.track]);
    osc.start(at);
    osc.stop(end + 0.05);
    const v = { src: osc, gain: g, end };
    this.voices.push(v);
    this.held.set(key, v);
  }

  drum(e, at) {
    const ctx = this.ctx;
    const buf = this.drumBuffers.get(e.part);
    const g = ctx.createGain();
    g.gain.value = (e.vel / 127) * 0.9;
    g.connect(this.trackGains[e.track]);
    // A Circuit Tracks drum track: its pitch and decay, and its note fires the sidechain.
    const cfg = this.mix && e.track >= 4 ? this.mix.drums[e.track - 4] : null;
    if (cfg) {
      this.mixer.trigger(e.track - 4, at);
      e = { ...e, rate: (e.rate || 1) * drumRate(cfg.pitch) };
      const fade = drumDecaySeconds(cfg.decay);
      if (fade) {
        g.gain.setValueAtTime(g.gain.value, at);
        g.gain.setTargetAtTime(0, at, fade / 3.45);   // -30 dB at `fade`
      }
    }
    let src;
    // e.choke: a new hit cuts the track's previous one (each Circuit drum or sample track
    // plays one sound at a time). e.rate: playback rate for a transposed sample.
    if (e.choke) {
      const prev = this.lastVoice?.[e.track];
      if (prev && prev.end > at) {
        try { prev.gain.gain.setTargetAtTime(0, at, 0.008); prev.src.stop(at + 0.06); } catch { /* already stopped */ }
        prev.end = at;
      }
    }
    if (buf) {
      src = ctx.createBufferSource();
      src.buffer = buf;
      if (e.rate) src.playbackRate.value = e.rate;
      src.connect(g);
      src.start(at);
      const v = { src, gain: g, end: at + buf.duration / (e.rate || 1) };
      this.voices.push(v);
      if (e.choke) (this.lastVoice ??= [])[e.track] = v;
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
