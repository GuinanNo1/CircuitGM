// The calibration set 7 laws (js/pw/mixlaws.js) against the measured numbers.
// node tests/mixlaws.mjs
import { readFileSync } from 'fs';
import * as L from '../js/pw/mixlaws.js';
import { parseNCS } from '../js/vendor/ncs.js';

let fails = 0;
const db = (g) => 20 * Math.log10(g);
function near(name, got, want, tol) {
  const ok = Math.abs(got - want) <= tol;
  if (!ok) fails++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${got.toFixed(3)} (want ${want} ± ${tol})`);
}

// Mixer
near('level 100 dB', db(L.levelGain(100)), -2.1, 0.1);
near('level 64 dB', db(L.levelGain(64)), -6, 0.1);
near('pan 32 right dB', db(L.balance(32)[1]), -6, 0.1);
near('pan 0 right', L.balance(0)[1], 0, 0);
near('pan 64 both', L.balance(64)[0] + L.balance(64)[1], 2, 0);
near('pan 127 left', L.balance(127)[0], 0, 0);

// Reverb
near('rt60 type 2 decay 64', L.reverbRt60(2, 64), 0.91, 0.01);
near('rt60 type 5 decay 64', L.reverbRt60(5, 64), 1.96, 0.01);
near('rt60 type 2 decay 96', L.reverbRt60(2, 96), 1.5, 0.05);
near('rt60 type 2 decay 127', L.reverbRt60(2, 127), 3.3, 0.05);
near('send 64 vs 127 dB', db(L.sendGain(64) / L.sendGain(127)), -6.3, 0.4);
near('send 32 vs 127 dB', db(L.sendGain(32) / L.sendGain(127)), -13.7, 0.6);

// Delay
near('free time 32', L.delaySeconds(32, 0), 0.171, 0.002);
near('free time 127 (cap)', L.delaySeconds(127, 0), 0.678, 0.005);
near('free time 0', L.delaySeconds(0, 0), 0, 0);
const sync = { 1: 0.0417, 3: 0.083, 5: 0.167, 7: 0.25, 9: 0.375, 10: 0.5, 11: 0.667, 12: 0.68, 19: 0.68, 20: 0.0417, 35: 0.0417 };
for (const [v, s] of Object.entries(sync)) near(`sync ${v} at 120`, L.delaySeconds(64, Number(v), 120), s, 0.002);
near('feedback 64 dB', db(L.delayFeedback(64)), -6, 0.1);
near('feedback 100 dB', db(L.delayFeedback(100)), -2, 0.1);
near('feedback 0', L.delayFeedback(0), 0, 0);
near('L/R 4: right lag at 41.7 ms (ms)', (L.delayLR(4).right - 1) * 41.7, 14, 0.5);
near('L/R 0: identical', L.delayLR(0).right, 1, 0);
near('width 0', L.delayWidth(0), 0, 0);

// Master filter
near('LP corner 32 (Hz)', L.masterFilter(32).hz, 1000, 1);
near('LP corner 48 (Hz)', L.masterFilter(48).hz, 4300, 1);
near('HP corner 96 (Hz)', L.masterFilter(96).hz, 1000, 1);
near('HP corner 112 (Hz)', L.masterFilter(112).hz, 5000, 1);
for (const v of [60, 64, 68]) near(`filter ${v} off`, L.masterFilter(v).type === 'off' ? 1 : 0, 1, 0);
near('resonance 100 LP peak (dB, two stages)', 2 * db(L.masterFilter(32, 100).q), 11, 1.5);

// Sidechain: model the duck curve and compare with the defaults' measurement.
const duck = (sh, t) => {
  if (t < sh.attack) return 1 - (1 - sh.floor) * (t / sh.attack);
  if (t < sh.attack + sh.hold) return sh.floor;
  return 1 - (1 - sh.floor) * Math.exp(-(t - sh.attack - sh.hold) / sh.tau);
};
const def = L.sidechainShape({ source: 0, attack: 0, hold: 50, decay: 70, depth: 127 });
near('duck floor (dB)', db(def.floor), -41, 1);
near('duck at 40 ms (dB)', db(duck(def, 0.04)), -14, 2.5);
near('duck at 80 ms (dB)', db(duck(def, 0.08)), -3.4, 1);
near('duck at 120 ms (dB)', db(duck(def, 0.12)), -1.2, 0.5);
const slow = L.sidechainShape({ source: 0, decay: 120, depth: 127 });
near('decay 120 at 300 ms (dB)', db(duck(slow, 0.3)), -2.5, 1);
const long = L.sidechainShape({ source: 0, hold: 110, depth: 127 });
near('hold 110: still down at 340 ms (dB)', db(duck(long, 0.34)), -41, 1);
near('depth 0 off', L.sidechainShape({ depth: 0 }) === null ? 1 : 0, 1, 0);
near('source 4 off', L.sidechainShape({ source: 4, depth: 127 }) === null ? 1 : 0, 1, 0);

// Drums
near('drum pitch 32 (semis)', L.drumPitchSemis(32), -12, 0);
near('drum pitch 0 (semis)', L.drumPitchSemis(0), -24, 0);
near('drum decay 0 (s)', L.drumDecaySeconds(0), 0.05, 0.001);
near('drum decay 64 (s)', L.drumDecaySeconds(64), 0.18, 0.001);
near('drum decay 127 none', L.drumDecaySeconds(127) === null ? 1 : 0, 1, 0);
near('drum EQ 64 flat', Math.abs(L.drumTilt(64).lowDb) + Math.abs(L.drumTilt(64).highDb), 0, 0);

// The empty project's settings.
const buf = readFileSync(new URL('../data/Empty.ncs', import.meta.url));
const mix = L.projectMix(parseNCS(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length)));
near('empty: reverb type', mix.reverb.type, 2, 0);
near('empty: delay sync', mix.delay.sync, 20, 0);
near('empty: synth 1 level', mix.synth[0].level, 100, 0);
near('empty: drum 4 decay', mix.drums[3].decay, 127, 0);
near('empty: no sidechain', L.sidechainShape(mix.synth[0].sidechain) === null ? 1 : 0, 1, 0);

console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
