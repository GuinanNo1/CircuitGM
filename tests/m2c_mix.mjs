// MIDI2Circuit with a Circuit Tracks pack project as the song: the built projects keep the
// source project's mix (FX values and presets, FX off, levels, pans, sends, sidechain), each
// track's settings following its part. Roles as the page sets them by default (each part on
// its own track; a source without a sidechain gets one on Synth 2), plus one swapped run (Synth 1 <-> Synth 2) to check the settings move.
// Run from the repo root: node tests/m2c_mix.mjs <pack[@n]>...
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { arrange, laneOf } from '../js/convert.js';
import { loadBaseFromBuffers, buildProjects, mixControls } from '../js/build.js';
import { parseNCS } from '../js/vendor/ncs.js';
import { loadPack } from '../js/pack.js';
import { packSong, projectChoices } from '../js/packsong.js';
import { sourceMix } from '../js/m2r/mix.js';

const ab = (p) => { const b = readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); };
const base = await loadBaseFromBuffers(ab('tracksgm/TracksGM_v1.circuittrackspack'), ab('data/Empty.ncs'));
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; if (fails < 30) console.log('FAIL', m); } };

// As js/app.js updateMix: first part of each synth/MIDI track, busiest part of each drum track.
function mixSources(midi, asg) {
  const byId = new Map(midi.sources.map((s) => [s.id, s]));
  const srcs = ['S1', 'S2', 'M1', 'M2'].map((r) => byId.get(asg[r][0])?.track ?? null);
  for (let lane = 0; lane < 4; lane++) {
    let best = null, most = 0;
    for (const id of asg.DR) {
      const s = byId.get(id);
      const n = s.notes.filter((x) => laneOf(x) === lane).length;
      if (n > most) { most = n; best = s.track; }
    }
    srcs.push(best);
  }
  return srcs;
}

for (const arg of process.argv.slice(2)) {
  const [f, at] = arg.split('@');
  const pack = await loadPack(ab(f), f);
  const entries = at ? [pack.projects[Number(at) - 1]] : projectChoices(pack);
  for (const entry of entries) {
    const midi = packSong(pack, entry);
    // No sidechain in the source: give Synth 2 one (custom values, from Drum 1) to follow.
    if (!entry.project.sidechain.some((x) => x.preset)) entry.project.sidechain[1] = { preset: 5, source: 0, attack: 7, hold: 33, decay: 44, depth: 111 };
    for (const swap of [false, true]) {
      const asg = { S1: [], S2: [], M1: [], M2: [], DR: [] };
      for (const s of midi.sources) asg[s.role].push(s.id);
      if (swap) [asg.S1, asg.S2] = [asg.S2, asg.S1];
      const plan = arrange(midi, asg, { rate: 16, kit: 0 });
      if (plan.error) { console.log(`${basename(f)}@${entry.slot + 1}: ${plan.error}`); break; }
      const mix = sourceMix(entry.project, 'circuit-tracks');
      const sources = mixSources(midi, asg);
      const projs = buildProjects(plan, base, { title: 'Mix', synthPatch: [0, 1], kit: 0, color: 3, mix, mixSources: sources, fx: { ...mixControls(mix, sources), sidechain: [null, null] } });
      const label = `${basename(f).replace(/\.circuittrackspack$/, '')}@${entry.slot + 1}${swap ? ' (S1<->S2)' : ''}`;
      const p = entry.project;
      for (const pr of projs) {
        const b = parseNCS(pr.bytes.buffer.slice(pr.bytes.byteOffset, pr.bytes.byteOffset + pr.bytes.length));
        ok(b.reverbPreset === p.reverbPreset && b.delayPreset === p.delayPreset, `${label}: FX presets`);
        for (const k of ['reverbType', 'reverbDecay', 'reverbDamping', 'delayTime', 'delaySync', 'delayFeedback', 'delayWidth', 'delayLrRatio', 'delaySlew', 'fxBypass']) ok(b.fx[k] === p.fx[k], `${label}: ${k} ${b.fx[k]} vs ${p.fx[k]}`);
        // each new track against its source track, read straight from the source project
        const level = (q, t) => (t < 4 ? q.mixerLevels[t] : q.drumConfigs[t - 4].level);
        const pan = (q, t) => (t < 4 ? q.mixerPans[t] : q.drumConfigs[t - 4].pan);
        const sendAt = [0, 1, 6, 7, 2, 3, 4, 5];
        sources.forEach((src, t) => {
          if (src == null) return;
          ok(level(b, t) === level(p, src) && pan(b, t) === pan(p, src), `${label}: track ${t} level/pan ${level(b, t)},${pan(b, t)} vs ${level(p, src)},${pan(p, src)}`);
          ok(b.fx.reverbSends[sendAt[t]] === p.fx.reverbSends[sendAt[src]] && b.fx.delaySends[sendAt[t]] === p.fx.delaySends[sendAt[src]], `${label}: track ${t} sends`);
          if (t < 4) {
            const s = p.sidechain[src];
            const on = src < 4 && s.preset && s.source < 4 && sources.indexOf(4 + s.source, 4) >= 0;
            ok(b.sidechain[t].preset === (on ? s.preset : 0), `${label}: track ${t} sidechain preset ${b.sidechain[t].preset}`);
            if (on) ok(sources[4 + b.sidechain[t].source] === 4 + s.source && b.sidechain[t].depth === s.depth && b.sidechain[t].attack === s.attack, `${label}: track ${t} sidechain`);
          }
        });
      }
      if (!swap) console.log(`${label}: ${projs.length} project(s), sources ${sources.join(',')}`);
    }
  }
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
