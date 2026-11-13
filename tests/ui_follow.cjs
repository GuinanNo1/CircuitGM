// PatchWorker and a linked Circuit Tracks, with the Tracks simulated (no hardware): Live on at
// link, following the Tracks' patch (dump request, Program Change), Program Change out when a
// patch is chosen here, the keep-your-changes question, Synth 1/2 following each synth.
// Needs `python3 -m http.server 8765` running in the repo.
// node tests/ui_follow.cjs
const { chromium } = require('playwright');

(async () => {
  const b = await chromium.launch();
  const errs = [];
  let fails = 0;
  const check = (name, ok) => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`); };
  const p = await b.newPage({ viewport: { width: 1400, height: 950 } });
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('http://localhost:8765/patchworker/');
  await p.waitForFunction(() => window.patchworker?.S.pack && document.querySelectorAll('#patchlist li[data-slot]').length === 128);

  // A fake Tracks: Synth 1 plays pack slot 10, Synth 2 slot 20; sent messages are recorded.
  await p.evaluate(() => {
    const w = window.patchworker, L = w.link;
    window.sent = [];
    window.tracks = [w.S.pack.patches[9].slice(), w.S.pack.patches[19].slice()];
    L.out = { name: 'Circuit Tracks', send: (d) => window.sent.push([...d]) };
    L.in = {};
    L.requestPatch = async (synth) => window.tracks[synth].slice();
    L.emit();
  });
  await p.waitForTimeout(300);
  const st = () => p.evaluate(() => ({ slot: window.patchworker.S.slot, live: document.querySelector('#hw-live').checked, hw: document.querySelector('#ed-hw').textContent, dlg: document.querySelector('#dlg').open }));
  let s = await st();
  check(`linking turns Live on and edits what Synth 1 plays (slot 10): ${s.slot + 1}, ${s.live}`, s.slot === 9 && s.live && !s.dlg);
  check(`status says Synth 1 plays this patch (${s.hw})`, /Synth 1 is playing this patch/.test(s.hw));

  // The Tracks changes Synth 1 to patch 15 (same pack): the editor follows, no question.
  await p.evaluate(() => { window.tracks[0] = window.patchworker.S.pack.patches[14].slice(); window.patchworker.link.onProgram(0, 14); });
  await p.waitForTimeout(200);
  s = await st();
  check(`Program Change from the Tracks moves the editor to slot 15 (${s.slot + 1})`, s.slot === 14 && !s.dlg);

  // Choosing slot 30 here: Program Change 29 out on channel 1, then the patch as SysEx.
  await p.evaluate(() => { window.sent = []; });
  await p.click('#patchlist li[data-slot="29"]');
  await p.waitForTimeout(300);
  let sent = await p.evaluate(() => window.sent);
  check(`choosing slot 30 sends Program Change 29 then the patch (${sent.map((m) => m[0].toString(16)).join(' ')})`, (() => { const pc = sent.findIndex((m) => m[0] === 0xc0 && m[1] === 29), sx = sent.findIndex((m) => m[0] === 0xf0); return pc >= 0 && sx > pc; })());
  // Our own Program Change coming back is ignored.
  await p.evaluate(() => window.patchworker.link.onProgram(0, 29));
  await p.waitForTimeout(150);
  check('an echo of our own Program Change changes nothing', (await st()).slot === 29);

  // Edit live, then choose another patch: the keep-your-changes question; Cancel stays.
  await p.evaluate(() => { window.tracks[0] = window.patchworker.S.pack.patches[29].slice(); const w = window.patchworker; w.setByte(20, (w.S.bytes[20] + 1) & 127); });
  await p.click('#patchlist li[data-slot="31"]');
  await p.waitForSelector('#dlg[open]');
  check('leaving a live-edited patch asks first', /Keep your changes/.test(await p.textContent('#dlg-title')) && !(await p.isHidden('#dlg-alt2')));
  await p.click('#dlg-cancel');
  await p.waitForTimeout(100);
  check('Cancel stays on the patch', (await st()).slot === 29);
  await p.click('#patchlist li[data-slot="31"]');
  await p.waitForSelector('#dlg[open]');
  await p.click('#dlg-alt2');
  await p.waitForTimeout(200);
  check(`Don't save goes to slot 32 and the edits stay in the pack`, (await st()).slot === 31 && await p.evaluate(() => document.querySelector('#patchlist li[data-slot="29"]').classList.contains('edited')));

  // Live edit, then the Tracks changes patch itself: asked afterwards (no Cancel), then follows.
  await p.evaluate(() => { const w = window.patchworker; w.setByte(20, (w.S.bytes[20] + 1) & 127); window.tracks[0] = w.S.pack.patches[39].slice(); w.link.onProgram(0, 39); });
  await p.waitForSelector('#dlg[open]');
  check('a patch change on the Tracks after live edits asks about them, no Cancel', await p.isHidden('#dlg-alt2') && (await p.textContent('#dlg-cancel')) === "Don't save");
  await p.click('#dlg-cancel');
  await p.waitForTimeout(200);
  check(`then follows the Tracks to slot 40 (${(await st()).slot + 1})`, (await st()).slot === 39);

  // A different pack on the Tracks: patch 50 there isn't pack slot 50.
  await p.evaluate(() => { const w = window.patchworker; window.tracks[0] = w.S.pack.patches[0].slice(); w.link.onProgram(0, 49); });
  await p.waitForSelector('#dlg[open]');
  check('a patch that differs from the pack asks whether to load it', /changed to patch 050/.test(await p.textContent('#dlg-title')));
  await p.click('#dlg-ok');
  await p.waitForTimeout(200);
  check('Load puts the Tracks\' patch into slot 50', await p.evaluate(() => { const w = window.patchworker; return w.S.slot === 49 && w.S.pack.patches[49].every((v, i) => v === window.tracks[0][i]); }));

  // Synth 2 button: edits what Synth 2 plays (slot 20).
  await p.click('#hw [data-synth="1"]');
  await p.waitForTimeout(300);
  s = await st();
  check(`Synth 2 follows Synth 2's patch (slot ${s.slot + 1})`, s.slot === 19 && /Synth 2 is playing this patch/.test(s.hw));
  // Something not in the pack: status says so, no dialog.
  await p.evaluate(() => { window.tracks[0] = new Uint8Array(window.patchworker.S.pack.patches[0]); window.tracks[0][0] = 'Z'.charCodeAt(0); window.tracks[0][20] ^= 1; });
  await p.click('#hw [data-synth="0"]');
  await p.waitForTimeout(300);
  s = await st();
  check(`a patch not in the pack is named in the status (${s.hw})`, /not in this pack/.test(s.hw) && !s.dlg);
  check(`Live stayed on (${s.live})`, s.live);

  // Following the synth in use on the Tracks: a pad played on Synth 2 switches the editor to it,
  // but not while the sequencer runs or the other synth is still playing.
  const port = { name: 'Circuit Tracks MIDI' };
  const rx = (bytes) => p.evaluate(([b, pt]) => window.patchworker.link.receive(pt, b), [bytes, port]);
  const synthNow = () => p.evaluate(() => window.patchworker.S.synth);
  await p.evaluate(() => { window.patchworker.link.lastNote = [-1e9, -1e9]; });
  await rx([0xfa]);
  await rx([0x91, 60, 100]);
  await p.waitForTimeout(150);
  check('a Synth 2 note while the sequencer runs does not switch', (await synthNow()) === 0);
  await rx([0xfc]);
  await rx([0x90, 60, 100]);
  await rx([0x91, 62, 100]);
  await p.waitForTimeout(150);
  check('nor while Synth 1 played in the last 2 s', (await synthNow()) === 0);
  await p.evaluate(() => { window.patchworker.link.lastNote = [-1e9, -1e9]; });
  await rx([0x91, 64, 100]);
  await p.waitForTimeout(300);
  check('a pad played on Synth 2 switches the editor to Synth 2', (await synthNow()) === 1 && await p.evaluate(() => document.body.dataset.synth === '1'));
  await p.evaluate(() => { window.patchworker.link.lastNote = [-1e9, -1e9]; });
  await rx([0xb0, 82, 40]);
  await p.waitForTimeout(300);
  check('a macro turned on Synth 1 switches back', (await synthNow()) === 0);

  // ?midilog shows what the Tracks sends.
  const q = await b.newPage();
  await q.goto('http://localhost:8765/patchworker/?midilog');
  await q.waitForFunction(() => window.patchworker?.S.pack);
  await q.evaluate(() => window.patchworker.link.receive({ name: 'Circuit Tracks' }, new Uint8Array([0xf0, 0x00, 0x20, 0x29, 0x01, 0x64, 0x7f, 0xf7])));
  check('?midilog lists messages from the Tracks', /f0 00 20 29 01 64 7f f7/.test(await q.textContent('.midilog')));
  await q.close();
  check(`no console errors (${errs.length ? errs.join('; ') : 'none'})`, !errs.length);
  await b.close();
  console.log(fails ? `${fails} failed` : 'all passed');
  process.exit(fails ? 1 : 0);
})();
