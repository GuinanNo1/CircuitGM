// The project mixer (js/pw/mixer.js) rendered offline in a real browser, measured against the
// calibration set 7 numbers, plus a smoke test of the Player playing the empty project through it.
// Needs `python3 -m http.server 8765` running in the repo.
// node tests/ui_mixer.cjs
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('http://localhost:8765/index.html');
  const r = await page.evaluate(async () => {
    const { Mixer } = await import('/js/pw/mixer.js?v=20261113f');
    const { projectMix } = await import('/js/pw/mixlaws.js?v=20261113f');
    const SR = 48000;
    const db = (x) => 20 * Math.log10(Math.max(x, 1e-9));
    const rms = (d, a, b) => { let s = 0; for (let i = a; i < b; i++) s += d[i] * d[i]; return Math.sqrt(s / (b - a)); };
    const base = projectMix(null);
    const mixWith = (f) => { const m = structuredClone(base); f(m); return m; };
    async function render(secs, setup) {
      const ctx = new OfflineAudioContext(2, SR * secs, SR);
      const mx = new Mixer(ctx, ctx.destination);
      setup(ctx, mx);
      const buf = await ctx.startRendering();
      return [buf.getChannelData(0), buf.getChannelData(1)];
    }
    const sine = (ctx, dst, hz = 220, at = 0) => { const o = ctx.createOscillator(); o.frequency.value = hz; o.connect(dst); o.start(at); return o; };
    const out = {};

    // Level 64, pan 32: -6 dB on the left (vs level 127), right a further -6 dB.
    {
      const [l, r] = await render(0.5, (ctx, mx) => {
        mx.apply(mixWith((m) => { m.synth[0].level = 64; m.synth[0].pan = 32; }));
        sine(ctx, mx.strips[0].input);
      });
      out.levelLeftDb = db(rms(l, SR * 0.2, SR * 0.4) / Math.SQRT1_2);
      out.panRightDb = db(rms(r, SR * 0.2, SR * 0.4) / rms(l, SR * 0.2, SR * 0.4));
    }

    // Sidechain from drum 1 at the defaults, depth 127: duck at 40 / 80 / 120 ms after the note.
    {
      const [l] = await render(1, (ctx, mx) => {
        mx.apply(mixWith((m) => { m.synth[0].level = 127; m.synth[0].sidechain = { source: 0, attack: 0, hold: 50, decay: 70, depth: 127 }; }));
        sine(ctx, mx.strips[0].input, 1000);
        mx.trigger(0, 0.5);
        mx.trigger(1, 0.8); // drum 2: should not duck
      });
      const at = (ms) => db(rms(l, Math.round(SR * (0.5 + ms / 1000)) - 48, Math.round(SR * (0.5 + ms / 1000)) + 48) / Math.SQRT1_2);
      out.duck = [10, 40, 80, 120].map(at);
      out.duckOtherDrum = db(rms(l, SR * 0.85, SR * 0.86) / Math.SQRT1_2);
    }

    // Delay, sync 7 at 120 BPM: echoes every 250 ms; feedback 64: each 6 dB quieter.
    {
      const [l] = await render(1.5, (ctx, mx) => {
        mx.apply(mixWith((m) => { m.bypass = false; m.synth[0].delay = 127; m.delay.sync = 7; m.delay.ratio = 0; }));
        const b = ctx.createBuffer(1, 32, SR); b.getChannelData(0)[0] = 1;
        const s = ctx.createBufferSource(); s.buffer = b; s.connect(mx.strips[0].input); s.start(0.1);
      });
      const peaks = [];
      for (let k = 1; k <= 3; k++) {
        const c = Math.round(SR * (0.1 + 0.25 * k));
        let best = 0, bi = 0;
        for (let i = c - 2400; i < c + 2400; i++) if (Math.abs(l[i]) > best) { best = Math.abs(l[i]); bi = i; }
        peaks.push([(bi / SR - 0.1) * 1000, db(best)]);
      }
      out.echoes = peaks;
    }

    // Reverb type 2, decay 64: RT60 from the slope of the tail's energy.
    {
      const [l] = await render(3, (ctx, mx) => {
        mx.apply(mixWith((m) => { m.bypass = false; m.synth[0].reverb = 127; m.synth[0].level = 0; }));
        const b = ctx.createBuffer(1, 32, SR); b.getChannelData(0)[0] = 1;
        const s = ctx.createBufferSource(); s.buffer = b; s.connect(mx.strips[0].input); s.start(0.1);
      });
      const e1 = rms(l, SR * 0.2, SR * 0.3), e2 = rms(l, SR * 0.6, SR * 0.7);
      out.reverbRt60 = 60 / ((db(e1) - db(e2)) / 0.4);
    }

    // Master filter 32 (low-pass about 1 kHz): a 300 Hz tone passes, 4 kHz is cut hard.
    {
      const tone = async (hz, cutoff) => {
        const [l] = await render(0.4, (ctx, mx) => { mx.apply(mixWith((m) => { m.synth[0].level = 127; m.filter.cutoff = cutoff; })); sine(ctx, mx.strips[0].input, hz); });
        return db(rms(l, SR * 0.2, SR * 0.35) / Math.SQRT1_2);
      };
      out.filter = { lp300: await tone(300, 32), lp4k: await tone(4000, 32), hp300: await tone(300, 96), off4k: await tone(4000, 64) };
    }

    // The Player with the empty project: synth notes on the browser synth, drum hits, no errors.
    {
      const { Player } = await import('/js/player.js');
      const { parseNCS } = await import('/js/vendor/ncs.js');
      const buf = await (await fetch('/data/Empty.ncs')).arrayBuffer();
      const proj = parseNCS(buf);
      const p = new Player();
      p.setProject(proj);
      p.ensure();
      await p.play([
        { t: 0, d: 0.2, track: 0, note: 60, vel: 100 },
        { t: 0.1, d: 0.2, track: 1, note: 64, vel: 100 },
        { t: 0.1, d: 0.1, track: 4, note: 60, vel: 100, part: 'kick' },
      ], { length: 0.4 });
      await new Promise((res) => setTimeout(res, 700));
      out.playerSynths = p.synths.map((s) => !!s);
      p.setFilter(32, 100);
      p.stop();
      // Neutral (no project): the plain preview voices, as Circuit2MIDI and MIDI2Circuit use it.
      const q = new Player();
      q.setMute(2, true);
      await q.play([{ t: 0, d: 0.2, track: 0, note: 60, vel: 100, program: 0 }, { t: 0.05, d: 0.1, track: 5, note: 60, vel: 90, part: 'snare' }], { length: 0.3 });
      await new Promise((res) => setTimeout(res, 500));
      out.neutralSynths = (q.synths ?? []).filter(Boolean).length;
      q.stop();
    }
    return out;
  });
  await browser.close();
  console.log(JSON.stringify(r, null, 1));
  const checks = [
    ['level 64 (dB)', r.levelLeftDb, -6, 0.3],
    ['pan 32 right vs left (dB)', r.panRightDb, -6, 0.3],
    ['duck at 40 ms (dB)', r.duck[1], -14, 3],
    ['duck at 80 ms (dB)', r.duck[2], -3.4, 1.2],
    ['duck at 120 ms (dB)', r.duck[3], -1.2, 0.6],
    ['other drum does not duck (dB)', r.duckOtherDrum, 0, 0.2],
    ['echo 1 time (ms)', r.echoes[0][0], 250, 2],
    ['echo 2 time (ms)', r.echoes[1][0], 500, 2],
    ['echo 1 -> 2 (dB)', r.echoes[1][1] - r.echoes[0][1], -6, 0.5],
    ['reverb RT60 (s)', r.reverbRt60, 0.91, 0.15],
    ['LP 32 at 300 Hz (dB)', r.filter.lp300, 0, 1.5],
    ['LP 32 at 4 kHz (dB)', r.filter.lp4k, -45, 8],
    ['HP 96 at 300 Hz (dB)', r.filter.hp300, -40, 10],
    ['filter off at 4 kHz (dB)', r.filter.off4k, 0, 0.2],
  ];
  let fails = 0;
  for (const [name, got, want, tol] of checks) {
    const ok = Math.abs(got - want) <= tol;
    if (!ok) fails++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${got.toFixed(2)} (want ${want} ± ${tol})`);
  }
  if (!r.playerSynths.every(Boolean)) { fails++; console.log('FAIL player did not make both synths'); }
  if (r.neutralSynths !== 0) { fails++; console.log('FAIL neutral player made browser synths'); }
  if (errors.length) { fails++; console.log('page errors:', errors); }
  console.log(fails ? `${fails} failed` : 'all passed');
  process.exit(fails ? 1 : 0);
})();
