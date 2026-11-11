// PatchWorker: the Circuit Tracks synth patch (340 bytes) as a parameter table.
//
// Layout: Circuit Tracks Programmer's Reference Guide v3, "Synth Patch Format". Display units
// come from CircuitGM's hardware measurements (docs/circuit-tracks-file-formats.md and the
// calibration notes in tracksgm/tools/ctpatch.py). MIDI CC / NRPN numbers are from the same
// guide, as collected in circuit-tracks-tools (MIT, Namir Sayed-Ahmad Baraza).

export const PATCH_SIZE = 340;
export const SYX_SIZE = 350;
export const MOD_BASE = 124;       // 20 slots x [source 1, source 2, depth, destination]
export const MACRO_BASE = 204;     // 8 knobs x 17 [position, 4 x (destination, start, end, depth)]
export const MOD_SLOTS = 20;

export const OSC_WAVES = ['Sine', 'Triangle', 'Sawtooth', 'Saw 9:1 PW', 'Saw 8:2 PW', 'Saw 7:3 PW',
  'Saw 6:4 PW', 'Saw 5:5 PW', 'Saw 4:6 PW', 'Saw 3:7 PW', 'Saw 2:8 PW', 'Saw 1:9 PW', 'Pulse Width',
  'Square', 'Sine Table', 'Analogue Pulse', 'Analogue Sync', 'Triangle-Saw Blend', 'Digital Nasty 1',
  'Digital Nasty 2', 'Digital Saw-Square', 'Digital Vocal 1', 'Digital Vocal 2', 'Digital Vocal 3',
  'Digital Vocal 4', 'Digital Vocal 5', 'Digital Vocal 6', 'Random Collection 1',
  'Random Collection 2', 'Random Collection 3'];

export const FILTER_TYPES = ['Lowpass 12dB', 'Lowpass 24dB', 'Bandpass 6dB', 'Bandpass 12dB',
  'Highpass 12dB', 'Highpass 24dB'];
export const DRIVE_TYPES = ['Diode', 'Valve', 'Clipper', 'Cross-over', 'Rectifier', 'Bit Reducer',
  'Rate Reducer'];
export const LFO_WAVES = ['Sine', 'Triangle', 'Sawtooth', 'Square', 'Random S/H', 'Time S/H',
  'Piano Envelope', 'Sequence 1', 'Sequence 2', 'Sequence 3', 'Sequence 4', 'Sequence 5',
  'Sequence 6', 'Sequence 7', 'Alternative 1', 'Alternative 2', 'Alternative 3', 'Alternative 4',
  'Alternative 5', 'Alternative 6', 'Alternative 7', 'Alternative 8', 'Chromatic', 'Chromatic 16',
  'Major', 'Major 7', 'Minor 7', 'Min Arp 1', 'Min Arp 2', 'Diminished', 'Dec Minor', 'Minor 3rd',
  'Pedal', '4ths', '4ths x12', '1625 Maj', '1625 Min', '2511'];
export const POLY_MODES = ['Mono', 'Auto-Glide', 'Poly'];
export const ROUTINGS = ['None', 'Osc 1', 'Osc 1 & 2'];
export const FADE_MODES = ['Fade In', 'Fade Out', 'Gate In', 'Gate Out'];
export const CATEGORIES = ['None', 'Arp', 'Bass', 'Bell', 'Classic', 'Drum', 'Keyboard', 'Lead',
  'Movement', 'Pad', 'Poly', 'SFX', 'String', 'User', 'Vocoder/Tune'];
export const GENRES = ['None', 'Classic', 'Drum & Bass / Breaks', 'House', 'Industrial', 'Jazz',
  'R&B / Hip Hop', 'Rock / Pop', 'Techno', 'Dubstep'];

// Mod matrix sources (sparse: only these values are valid) and destinations, grouped as in
// Novation Components.
export const MOD_SOURCES = [
  { v: 0, label: 'Direct' },
  { v: 4, label: 'Velocity', group: 'Performance' },
  { v: 5, label: 'Keyboard', group: 'Performance' },
  { v: 6, label: 'LFO 1 +', group: 'LFO' },
  { v: 7, label: 'LFO 1 +/-', group: 'LFO' },
  { v: 8, label: 'LFO 2 +', group: 'LFO' },
  { v: 9, label: 'LFO 2 +/-', group: 'LFO' },
  { v: 10, label: 'Envelope 1 (Amp)', group: 'Envelopes' },
  { v: 11, label: 'Envelope 2 (Filter)', group: 'Envelopes' },
  { v: 12, label: 'Envelope 3 (Mod)', group: 'Envelopes' },
];
export const MOD_DESTS = [
  { v: 0, label: 'Osc 1/2 Pitch', group: 'Oscillators' },
  { v: 1, label: 'Osc 1 Pitch', group: 'Oscillators' },
  { v: 2, label: 'Osc 2 Pitch', group: 'Oscillators' },
  { v: 3, label: 'Osc 1 V-Sync', group: 'Oscillators' },
  { v: 4, label: 'Osc 2 V-Sync', group: 'Oscillators' },
  { v: 5, label: 'Osc 1 Pulse Width', group: 'Oscillators' },
  { v: 6, label: 'Osc 2 Pulse Width', group: 'Oscillators' },
  { v: 7, label: 'Osc 1 Level', group: 'Mixer' },
  { v: 8, label: 'Osc 2 Level', group: 'Mixer' },
  { v: 9, label: 'Noise Level', group: 'Mixer' },
  { v: 10, label: 'Ring Mod 1*2 Level', group: 'Mixer' },
  { v: 11, label: 'Drive Amount', group: 'Filter' },
  { v: 12, label: 'Frequency', group: 'Filter' },
  { v: 13, label: 'Resonance', group: 'Filter' },
  { v: 14, label: 'LFO 1 Rate', group: 'LFO' },
  { v: 15, label: 'LFO 2 Rate', group: 'LFO' },
  { v: 16, label: 'Envelope 1 (Amp) Decay', group: 'Envelopes' },
  { v: 17, label: 'Envelope 2 (Filter) Decay', group: 'Envelopes' },
];

// ------------------------------------------------------------------ display helpers
const interp = (x, t) => {
  if (x <= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i++) {
    if (x <= t[i][0]) return t[i - 1][1] + (t[i][1] - t[i - 1][1]) * (x - t[i - 1][0]) / (t[i][0] - t[i - 1][0]);
  }
  return t[t.length - 1][1];
};
const CUTOFF_HZ = [[0, 30], [8, 45], [16, 55], [24, 65], [32, 110], [40, 150], [48, 260], [56, 400],
  [64, 650], [72, 1100], [80, 1800], [88, 2700], [96, 4000], [104, 6500], [112, 10500], [120, 17000],
  [127, 20000]];
const EQ_BASS_DB = [[0, -25], [32, -8], [64, 0], [96, 7], [127, 12.6]];
const EQ_MID_DB = [[0, -41], [32, -12], [64, 0], [96, 7.4], [127, 12.2]];
const EQ_TREBLE_DB = [[0, -18], [32, -7], [64, 0], [96, 6], [127, 11]];
const EQ_BASS_HZ = [[0, 80], [64, 320], [127, 550]];
const EQ_MID_HZ = [[0, 453], [16, 640], [32, 905], [48, 1100], [64, 1280], [80, 1500], [96, 1810],
  [112, 2000], [127, 2200]];
const EQ_TREBLE_HZ = [[0, 1100], [16, 1300], [32, 2000], [48, 2600], [64, 3600], [80, 4500],
  [96, 5500], [112, 6500], [127, 8000]];

// Measured on the hardware (filter at C4, key tracking 127): -3 dB point of the 12 dB low-pass.
export const cutoffHz = (v) => interp(v, CUTOFF_HZ);
// Amp-envelope times: +32 steps = 10x. Attack to full level; decay / release to -60 dB.
export const attackSeconds = (v) => 0.18 * 10 ** ((v - 64) / 31.5);
export const decaySeconds = (v) => 0.38 * 10 ** ((v - 64) / 31.5);
// LFO free-running rate: one octave per 12 steps.
export const lfoHz = (v) => 3.39 * 2 ** ((v - 64) / 12);
export const eqDb = (band, v) => interp(v, { bass: EQ_BASS_DB, mid: EQ_MID_DB, treble: EQ_TREBLE_DB }[band]);
export const eqHz = (band, v) => interp(v, { bass: EQ_BASS_HZ, mid: EQ_MID_HZ, treble: EQ_TREBLE_HZ }[band]);
// Mod depth -> pitch is cubic: +32 = +16 semitones exactly.
export const pitchSemis = (d) => d ** 3 / 2048 + d * 0.005;
// Env 2 amount / mod depth -> filter frequency, in frequency-value steps (11.5 steps = 1 octave).
export const filterSteps = (a) => a + a ** 3 / 4300;

// Tempo-sync ladders (value 0 = sync off; 1-35 pick a note length). Beats per cycle.
const LFO_SYNC_BEATS = [0, 1 / 8, 1 / 6, 3 / 16, 1 / 4, 1 / 3, 3 / 8, 1 / 2, 2 / 3, 3 / 4, 1, 4 / 3,
  1.5, 2, 8 / 3, 3, 4, 16 / 3, 6, 8, 32 / 3, 12, 16, 64 / 3, 24, 32, 128 / 3, 48, 64, 256 / 3, 96,
  128, 512 / 3, 192, 256, 320];
export const syncBeats = (v) => LFO_SYNC_BEATS[Math.max(0, Math.min(35, v))];
const NOTE_NAMES = new Map([[1 / 8, '1/32'], [1 / 6, '1/16 T'], [3 / 16, '1/32 D'], [1 / 4, '1/16'],
  [1 / 3, '1/8 T'], [3 / 8, '1/16 D'], [1 / 2, '1/8'], [2 / 3, '1/4 T'], [3 / 4, '1/8 D'], [1, '1/4'],
  [4 / 3, '1/2 T'], [1.5, '1/4 D'], [2, '1/2'], [8 / 3, '1 bar T'], [3, '1/2 D'], [4, '1 bar']]);
export function syncName(v) {
  if (!v) return 'Off';
  const b = syncBeats(v);
  if (NOTE_NAMES.has(b)) return NOTE_NAMES.get(b);
  const bars = b / 4;
  return `${Number.isInteger(bars) ? bars : bars.toFixed(2)} bars`;
}

const hz = (f) => (f >= 10000 ? `${(f / 1000).toFixed(1)} kHz` : f >= 1000 ? `${(f / 1000).toFixed(2)} kHz` : `${Math.round(f)} Hz`);
const secs = (s) => (s < 0.0095 ? `${(s * 1000).toFixed(1)} ms` : s < 1 ? `${Math.round(s * 1000)} ms` : `${s.toFixed(s < 10 ? 2 : 1)} s`);
const signed = (n, unit = '') => `${n > 0 ? '+' : ''}${n}${unit}`;
const db = (d) => `${d > 0 ? '+' : ''}${d.toFixed(1)} dB`;

export const FMT = {
  raw: (v) => String(v),
  bi: (v) => signed(v - 64),
  semis: (v) => signed(v - 64, ' st'),
  cents: (v) => signed(v - 64, ' ct'),
  octave: (v) => signed(v - 64, ' oct'),
  level: (v) => `${signed(Math.min(v, 76) - 64, ' dB')}${v > 76 ? ' (max)' : ''}`,
  cutoff: (v) => (v >= 120 ? 'open' : `~${hz(cutoffHz(v))}`),
  attack: (v) => `~${secs(attackSeconds(v))}`,
  decay: (v) => `~${secs(decaySeconds(v))}`,
  lfoRate: (v) => `~${lfoHz(v) < 10 ? lfoHz(v).toFixed(2) : lfoHz(v).toFixed(1)} Hz`,
  phase: (v) => `${v * 3}°`,
  sync: (v) => syncName(v),
  eqBassDb: (v) => db(eqDb('bass', v)),
  eqMidDb: (v) => db(eqDb('mid', v)),
  eqTrebleDb: (v) => db(eqDb('treble', v)),
  eqBassHz: (v) => `~${hz(eqHz('bass', v))}`,
  eqMidHz: (v) => `~${hz(eqHz('mid', v))}`,
  eqTrebleHz: (v) => `~${hz(eqHz('treble', v))}`,
};

// ------------------------------------------------------------------ the parameter table
// id: [address, default, low, high, label, format, cc | [nrpn msb, lsb]]
const T = {
  category: [16, 0, 0, 14, 'Category'], genre: [17, 0, 0, 9, 'Genre'],
  poly_mode: [32, 2, 0, 2, 'Voice mode', 'raw', 3],
  portamento: [33, 0, 0, 127, 'Portamento', 'raw', 5],
  pre_glide: [34, 64, 52, 76, 'Pre-Glide', 'semis', 9],
  octave: [35, 64, 58, 69, 'Keyboard Octave', 'octave', 13],

  osc1_wave: [36, 2, 0, 29, 'Osc 1 wave', 'raw', 19],
  osc1_interpolate: [37, 127, 0, 127, 'Interpolate', 'raw', 20],
  osc1_pw: [38, 64, 0, 127, 'Index', 'bi', 21],
  osc1_vsync: [39, 0, 0, 127, 'VSync', 'raw', 22],
  osc1_density: [40, 0, 0, 127, 'Density', 'raw', 24],
  osc1_density_detune: [41, 0, 0, 127, 'Detune', 'raw', 25],
  osc1_semitones: [42, 64, 0, 127, 'Semitones', 'semis', 26],
  osc1_cents: [43, 64, 0, 127, 'Cents', 'cents', 27],
  osc1_bend: [44, 76, 52, 76, 'Bend', 'semis', 28],
  osc2_wave: [45, 2, 0, 29, 'Osc 2 wave', 'raw', 29],
  osc2_interpolate: [46, 127, 0, 127, 'Interpolate', 'raw', 30],
  osc2_pw: [47, 64, 0, 127, 'Index', 'bi', 31],
  osc2_vsync: [48, 0, 0, 127, 'VSync', 'raw', 33],
  osc2_density: [49, 0, 0, 127, 'Density', 'raw', 35],
  osc2_density_detune: [50, 0, 0, 127, 'Detune', 'raw', 36],
  osc2_semitones: [51, 64, 0, 127, 'Semitones', 'semis', 37],
  osc2_cents: [52, 64, 0, 127, 'Cents', 'cents', 39],
  osc2_bend: [53, 76, 52, 76, 'Bend', 'semis', 40],

  osc1_level: [54, 127, 0, 127, 'Osc 1', 'raw', 51],
  osc2_level: [55, 0, 0, 127, 'Osc 2', 'raw', 52],
  ring_level: [56, 0, 0, 127, 'Ringmod', 'raw', 54],
  noise_level: [57, 0, 0, 127, 'Noise', 'raw', 56],
  pre_fx_level: [58, 64, 52, 82, 'Pre FX', 'level', 58],
  post_fx_level: [59, 64, 52, 82, 'Post FX', 'level', 59],

  filter_routing: [60, 0, 0, 2, 'Bypass', 'raw', 60],
  filter_drive: [61, 0, 0, 127, 'Drive', 'raw', 63],
  filter_drive_type: [62, 0, 0, 6, 'Drive type', 'raw', 65],
  filter_type: [63, 1, 0, 5, 'Filter type', 'raw', 68],
  filter_frequency: [64, 127, 0, 127, 'Frequency', 'cutoff', 74],
  filter_tracking: [65, 127, 0, 127, 'Key Track', 'raw', 69],
  filter_resonance: [66, 0, 0, 127, 'Resonance', 'raw', 71],
  filter_q_normalise: [67, 64, 0, 127, 'Q', 'raw', 78],
  env2_to_filter: [68, 64, 0, 127, 'Env 2 > Freq', 'bi', 79],

  env1_velocity: [69, 64, 0, 127, 'Velocity', 'bi', 108],
  env1_attack: [70, 2, 0, 127, 'Attack', 'attack', 73],
  env1_decay: [71, 90, 0, 127, 'Decay', 'decay', 75],
  env1_sustain: [72, 127, 0, 127, 'Sustain', 'raw', 70],
  env1_release: [73, 40, 0, 127, 'Release', 'decay', 72],
  env2_velocity: [74, 64, 0, 127, 'Velocity', 'bi', [0, 0]],
  env2_attack: [75, 2, 0, 127, 'Attack', 'attack', [0, 1]],
  env2_decay: [76, 75, 0, 127, 'Decay', 'decay', [0, 2]],
  env2_sustain: [77, 35, 0, 127, 'Sustain', 'raw', [0, 3]],
  env2_release: [78, 45, 0, 127, 'Release', 'decay', [0, 4]],
  env3_delay: [79, 0, 0, 127, 'Delay', 'raw', [0, 14]],
  env3_attack: [80, 10, 0, 127, 'Attack', 'attack', [0, 15]],
  env3_decay: [81, 70, 0, 127, 'Decay', 'decay', [0, 16]],
  env3_sustain: [82, 64, 0, 127, 'Sustain', 'raw', [0, 17]],
  env3_release: [83, 40, 0, 127, 'Release', 'decay', [0, 18]],

  lfo1_wave: [84, 0, 0, 37, 'LFO 1 wave', 'raw', [0, 70]],
  lfo1_phase: [85, 0, 0, 119, 'Phase', 'phase', [0, 71]],
  lfo1_slew: [86, 0, 0, 127, 'Slew', 'raw', [0, 72]],
  lfo1_delay: [87, 0, 0, 127, 'Delay', 'raw', [0, 74]],
  lfo1_delay_sync: [88, 0, 0, 35, 'Delay sync', 'sync', [0, 75]],
  lfo1_rate: [89, 68, 0, 127, 'Rate', 'lfoRate', [0, 76]],
  lfo1_rate_sync: [90, 0, 0, 35, 'Rate sync', 'sync', [0, 77]],
  lfo1_flags: [91, 0, 0, 63, 'LFO 1 switches'],
  lfo2_wave: [92, 0, 0, 37, 'LFO 2 wave', 'raw', [0, 79]],
  lfo2_phase: [93, 0, 0, 119, 'Phase', 'phase', [0, 80]],
  lfo2_slew: [94, 0, 0, 127, 'Slew', 'raw', [0, 81]],
  lfo2_delay: [95, 0, 0, 127, 'Delay', 'raw', [0, 83]],
  lfo2_delay_sync: [96, 0, 0, 35, 'Delay sync', 'sync', [0, 84]],
  lfo2_rate: [97, 68, 0, 127, 'Rate', 'lfoRate', [0, 85]],
  lfo2_rate_sync: [98, 0, 0, 35, 'Rate sync', 'sync', [0, 86]],
  lfo2_flags: [99, 0, 0, 63, 'LFO 2 switches'],

  distortion_level: [100, 0, 0, 127, 'Level', 'raw', 91],
  chorus_level: [102, 0, 0, 127, 'Level', 'raw', 93],
  eq_bass_freq: [105, 64, 0, 127, 'Low Freq', 'eqBassHz', [0, 104]],
  eq_bass_level: [106, 64, 0, 127, 'Low Gain', 'eqBassDb', [0, 105]],
  eq_mid_freq: [107, 64, 0, 127, 'Mid Freq', 'eqMidHz', [0, 106]],
  eq_mid_level: [108, 64, 0, 127, 'Mid Gain', 'eqMidDb', [0, 107]],
  eq_treble_freq: [109, 125, 0, 127, 'High Freq', 'eqTrebleHz', [0, 108]],
  eq_treble_level: [110, 64, 0, 127, 'High Gain', 'eqTrebleDb', [0, 109]],
  distortion_type: [116, 0, 0, 6, 'Distortion type', 'raw', [1, 0]],
  distortion_compensation: [117, 100, 0, 127, 'Comp', 'raw', [1, 1]],
  chorus_type: [118, 1, 0, 1, 'Chorus / Phaser', 'raw', [1, 24]],
  chorus_rate: [119, 20, 0, 127, 'Rate', 'raw', [1, 25]],
  chorus_rate_sync: [120, 0, 0, 35, 'Rate sync', 'sync', [1, 26]],
  chorus_feedback: [121, 74, 0, 127, 'Feedback', 'bi', [1, 27]],
  chorus_depth: [122, 64, 0, 127, 'Depth', 'raw', [1, 28]],
  chorus_delay: [123, 64, 0, 127, 'Delay', 'raw', [1, 29]],
};

export const P = {};
for (const [id, [a, d, lo, hi, label, fmt = 'raw', midi]] of Object.entries(T)) {
  P[id] = { id, a, d, lo, hi, label, fmt, cc: typeof midi === 'number' ? midi : null, nrpn: Array.isArray(midi) ? midi : null };
}
export const BY_ADDR = new Map(Object.values(P).map((p) => [p.a, p]));

// Macro destination values: 0 = no destination, then 1-70 in the guide's CC order. Confirmed in
// Components and on hardware (see the calibration notes).
const MACRO_IDS = [null, 'portamento', 'post_fx_level', 'osc1_interpolate', 'osc1_pw', 'osc1_vsync',
  'osc1_density', 'osc1_density_detune', 'osc1_semitones', 'osc1_cents', 'osc2_interpolate',
  'osc2_pw', 'osc2_vsync', 'osc2_density', 'osc2_density_detune', 'osc2_semitones', 'osc2_cents',
  'osc1_level', 'osc2_level', 'ring_level', 'noise_level', 'filter_frequency', 'filter_resonance',
  'filter_drive', 'filter_tracking', 'env2_to_filter', 'env1_attack', 'env1_decay', 'env1_sustain',
  'env1_release', 'env2_attack', 'env2_decay', 'env2_sustain', 'env2_release', 'env3_delay',
  'env3_attack', 'env3_decay', 'env3_sustain', 'env3_release', 'lfo1_rate', 'lfo1_rate_sync',
  'lfo1_slew', 'lfo2_rate', 'lfo2_rate_sync', 'lfo2_slew', 'distortion_level', 'chorus_level',
  'chorus_rate', 'chorus_feedback', 'chorus_depth', 'chorus_delay'];
const MACRO_LABELS = { portamento: ['Voice', 'Portamento'], post_fx_level: ['Mixer', 'Post FX Level'],
  osc1_interpolate: ['Osc 1', 'Osc 1 Interpolate'], osc1_pw: ['Osc 1', 'Osc 1 Pulse Width / Index'],
  osc1_vsync: ['Osc 1', 'Osc 1 VSync Depth'], osc1_density: ['Osc 1', 'Osc 1 Density'],
  osc1_density_detune: ['Osc 1', 'Osc 1 Density Detune'], osc1_semitones: ['Osc 1', 'Osc 1 Semitones'],
  osc1_cents: ['Osc 1', 'Osc 1 Cents'], osc2_interpolate: ['Osc 2', 'Osc 2 Interpolate'],
  osc2_pw: ['Osc 2', 'Osc 2 Pulse Width / Index'], osc2_vsync: ['Osc 2', 'Osc 2 VSync Depth'],
  osc2_density: ['Osc 2', 'Osc 2 Density'], osc2_density_detune: ['Osc 2', 'Osc 2 Density Detune'],
  osc2_semitones: ['Osc 2', 'Osc 2 Semitones'], osc2_cents: ['Osc 2', 'Osc 2 Cents'],
  osc1_level: ['Mixer', 'Osc 1 Volume'], osc2_level: ['Mixer', 'Osc 2 Volume'],
  ring_level: ['Mixer', 'Ring Mod Level'], noise_level: ['Mixer', 'Noise Level'],
  filter_frequency: ['Filter', 'Filter Frequency'], filter_resonance: ['Filter', 'Filter Resonance'],
  filter_drive: ['Filter', 'Filter Drive'], filter_tracking: ['Filter', 'Filter Key Track'],
  env2_to_filter: ['Filter', 'Env 2 > Filter Frequency'],
  env1_attack: ['Envelopes', 'Env 1 (Amp) Attack'], env1_decay: ['Envelopes', 'Env 1 (Amp) Decay'],
  env1_sustain: ['Envelopes', 'Env 1 (Amp) Sustain'], env1_release: ['Envelopes', 'Env 1 (Amp) Release'],
  env2_attack: ['Envelopes', 'Env 2 (Filter) Attack'], env2_decay: ['Envelopes', 'Env 2 (Filter) Decay'],
  env2_sustain: ['Envelopes', 'Env 2 (Filter) Sustain'], env2_release: ['Envelopes', 'Env 2 (Filter) Release'],
  env3_delay: ['Envelopes', 'Env 3 (Mod) Delay'], env3_attack: ['Envelopes', 'Env 3 (Mod) Attack'],
  env3_decay: ['Envelopes', 'Env 3 (Mod) Decay'], env3_sustain: ['Envelopes', 'Env 3 (Mod) Sustain'],
  env3_release: ['Envelopes', 'Env 3 (Mod) Release'], lfo1_rate: ['LFO', 'LFO 1 Rate'],
  lfo1_rate_sync: ['LFO', 'LFO 1 Rate Sync'], lfo1_slew: ['LFO', 'LFO 1 Slew'],
  lfo2_rate: ['LFO', 'LFO 2 Rate'], lfo2_rate_sync: ['LFO', 'LFO 2 Rate Sync'],
  lfo2_slew: ['LFO', 'LFO 2 Slew'], distortion_level: ['FX', 'Distortion Level'],
  chorus_level: ['FX', 'Chorus Level'], chorus_rate: ['FX', 'Chorus Rate'],
  chorus_feedback: ['FX', 'Chorus Feedback'], chorus_depth: ['FX', 'Chorus Depth'],
  chorus_delay: ['FX', 'Chorus Delay'] };

export const MACRO_DESTS = [{ v: 0, id: null, label: 'No Destination' }];
for (let v = 1; v <= 50; v++) {
  const id = MACRO_IDS[v];
  MACRO_DESTS.push({ v, id, group: MACRO_LABELS[id][0], label: MACRO_LABELS[id][1] });
}
for (let s = 1; s <= 20; s++) MACRO_DESTS.push({ v: 50 + s, id: `mod${s}_depth`, group: 'Mod Matrix', label: `Mod Matrix ${s} Depth` });
export const MACRO_DEST_OF = new Map(MACRO_DESTS.filter((d) => d.id).map((d) => [d.id, d.v]));

// ------------------------------------------------------------------ patch bytes
export function initPatch(name = 'Initial Patch') {
  const b = new Uint8Array(PATCH_SIZE);
  for (const p of Object.values(P)) b[p.a] = p.d;
  for (let s = 0; s < MOD_SLOTS; s++) b[MOD_BASE + 4 * s + 2] = 64;
  for (let k = 0; k < 8; k++) {
    for (let r = 0; r < 4; r++) {
      const o = MACRO_BASE + 17 * k + 1 + 4 * r;
      b[o + 2] = 127;
      b[o + 3] = 64;
    }
  }
  setName(b, name);
  return b;
}

export function getName(b) {
  let s = '';
  for (let i = 0; i < 16; i++) s += b[i] >= 32 && b[i] <= 126 ? String.fromCharCode(b[i]) : ' ';
  return s.trimEnd();
}

export function setName(b, name) {
  const clean = [...String(name)].map((c) => (c >= ' ' && c <= '~' ? c : ' ')).join('').slice(0, 16).padEnd(16, ' ');
  for (let i = 0; i < 16; i++) b[i] = clean.charCodeAt(i);
}

export const modAddr = (slot, field) => MOD_BASE + 4 * slot + field;                  // field 0-3
export const macroPosAddr = (knob) => MACRO_BASE + 17 * knob;
export const macroAddr = (knob, row, field) => MACRO_BASE + 17 * knob + 1 + 4 * row + field; // field 0-3

// A macro row is live when it has a destination, a non-zero depth and a usable range.
export function macroRows(b, knob) {
  const rows = [];
  for (let r = 0; r < 4; r++) {
    const o = macroAddr(knob, r, 0);
    rows.push({ dest: b[o], start: b[o + 1], end: b[o + 2], depth: b[o + 3] - 64 });
  }
  return rows;
}

// Valid range for any byte address (used to keep imported and edited data legal).
export function rangeOf(addr) {
  const p = BY_ADDR.get(addr);
  if (p) return [p.lo, p.hi];
  if (addr >= MOD_BASE && addr < MACRO_BASE) {
    const f = (addr - MOD_BASE) % 4;
    return f === 3 ? [0, 17] : f === 2 ? [0, 127] : [0, 12];
  }
  if (addr >= MACRO_BASE) {
    const f = (addr - MACRO_BASE) % 17;
    if (f === 0) return [0, 127];
    return (f - 1) % 4 === 0 ? [0, 70] : [0, 127];
  }
  return [0, 127];
}

// ------------------------------------------------------------------ SysEx
export const SYX_HEAD = [0xf0, 0x00, 0x20, 0x29, 0x01];
export const PRODUCT_TRACKS = 0x64;
export const PRODUCT_CIRCUIT = 0x60;     // the original Circuit: same 340-byte patch

// One "Replace Current Patch" message (command 0, location = synth 0 / 1), or a
// "Replace Patch" message that writes flash slot 0-127 (command 1).
export function toSyx(b, { command = 0, location = 0 } = {}) {
  const out = new Uint8Array(SYX_SIZE);
  out.set([...SYX_HEAD, PRODUCT_TRACKS, command, location, 0]);
  out.set(b.subarray(0, PATCH_SIZE), 9);
  out[SYX_SIZE - 1] = 0xf7;
  return out;
}

// Every patch message in a .syx file (one patch, or a bank of them).
export function parseSyx(bytes) {
  const out = [];
  let i = 0;
  while (i < bytes.length) {
    if (bytes[i] !== 0xf0) { i++; continue; }
    let end = i + 1;
    while (end < bytes.length && bytes[end] !== 0xf7) end++;
    if (end >= bytes.length) break;
    const len = end - i + 1;
    const head = SYX_HEAD.every((h, k) => bytes[i + k] === h);
    const product = bytes[i + 5];
    if (head && len === SYX_SIZE && (product === PRODUCT_TRACKS || product === PRODUCT_CIRCUIT) && bytes[i + 6] <= 1) {
      out.push({ data: sanitise(bytes.slice(i + 9, i + 9 + PATCH_SIZE)), command: bytes[i + 6], location: bytes[i + 7], product });
    }
    i = end + 1;
  }
  return out;
}

// Clamp every known byte into its legal range (and force 7-bit), leaving the layout alone.
export function sanitise(b) {
  for (let a = 0; a < PATCH_SIZE; a++) {
    b[a] &= 0x7f;
    if (a < 16) { if (b[a] < 32 || b[a] > 126) b[a] = 32; continue; }
    if (a >= 18 && a < 32) continue;
    const [lo, hi] = rangeOf(a);
    if (b[a] < lo) b[a] = lo;
    if (b[a] > hi) b[a] = hi;
  }
  return b;
}
