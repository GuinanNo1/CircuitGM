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
  await p.waitForTimeout(400);
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
  await p.waitForTimeout(400);
  check(`then follows the Tracks to slot 40 (${(await st()).slot + 1})`, (await st()).slot === 39);

  // Picking patches in the Tracks' Preset view: a Program Change and the patch itself arrive
  // together; picking the same patch again sends only the patch. No dialogs, no Get import.
  const syx = (synth, bytes) => [0xf0, 0x00, 0x20, 0x29, 0x01, 0x64, 0x00, synth, 0x00, ...bytes, 0xf7];
  const port0 = { name: 'Circuit Tracks MIDI' };
  const rx0 = (bytes) => p.evaluate(([b, pt]) => window.patchworker.link.receive(pt, new Uint8Array(b)), [bytes, port0]);
  let pk = await p.evaluate(() => [...window.patchworker.S.pack.patches[44]]);
  await rx0([0xc0, 44]);
  await rx0(syx(0, pk));
  await p.waitForTimeout(300);
  s = await st();
  check(`a preset picked on the Tracks (PC + patch) is followed quietly (slot ${s.slot + 1})`, s.slot === 44 && !s.dlg && /Synth 1 is playing this patch/.test(s.hw));
  pk = await p.evaluate(() => [...window.patchworker.S.pack.patches[46]]);
  await rx0(syx(0, pk));
  await p.waitForTimeout(400);
  s = await st();
  check(`a patch sent on its own is followed too (slot ${s.slot + 1})`, s.slot === 46 && !s.dlg);
  // Live edits, then the same preset picked again on the Tracks: it reloads the stored patch.
  await p.evaluate(() => { const w = window.patchworker; w.setByte(20, (w.S.bytes[20] + 1) & 127); });
  await rx0(syx(0, await p.evaluate(() => [...window.patchworker.S.pack.original[46]])));
  await p.waitForSelector('#dlg[open]');
  check('picking the same preset again after live edits asks about them', /Keep your changes/.test(await p.textContent('#dlg-title')));
  await p.click('#dlg-cancel');
  await p.waitForTimeout(300);
  s = await st();
  check(`then the synth is shown as having the older version (${s.hw})`, s.slot === 46 && /older version/.test(s.hw));

  // Macros turned on the Tracks are edits: marked here, and asked about when the Tracks changes patch.
  await p.evaluate(() => window.patchworker.selectSlot(55, { send: false }));
  pk = await p.evaluate(() => [...window.patchworker.S.pack.patches[55]]);
  await rx0([0xc0, 55]);
  await rx0(syx(0, pk));
  await p.waitForTimeout(300);
  await p.evaluate(() => { window.patchworker.link.lastNote = [-1e9, -1e9]; });
  for (const v of [10, 40, 90]) await rx0([0xb0, 80, v]);
  await p.waitForTimeout(200);
  check('a macro turned on the Tracks marks the patch as changed here', await p.evaluate(() => { const w = window.patchworker; return document.querySelector('#patchlist li[data-slot="55"]').classList.contains('edited'); }));
  check('one Undo takes back the whole knob turn', await p.evaluate(() => { const w = window.patchworker; w.undo(); const back = w.S.bytes.every((v, i) => v === w.S.pack.original[55][i]); w.redo(); return back; }));
  await rx0([0xc0, 56]);
  await rx0(syx(0, await p.evaluate(() => [...window.patchworker.S.pack.patches[56]])));
  await p.waitForSelector('#dlg[open]', { timeout: 5000 });
  check('then a patch change on the Tracks asks to keep those changes', /Keep your changes/.test(await p.textContent('#dlg-title')));
  await p.click('#dlg-cancel');
  await p.waitForTimeout(300);
  check(`and follows to slot 57 (${(await st()).slot + 1})`, (await st()).slot === 56);

  // A different pack on the Tracks: patch 50 there isn't pack slot 50.
  await p.evaluate(() => { const w = window.patchworker; window.tracks[0] = w.S.pack.patches[0].slice(); w.link.onProgram(0, 49); });
  await p.waitForSelector('#dlg[open]', { timeout: 5000 });
  check('a patch that differs from the pack asks whether to load it', /changed to patch 050/.test(await p.textContent('#dlg-title')));
  check(`and lists what differs (${(await p.textContent('#dlg-body')).match(/Different: [^.]*/)?.[0]})`, /Different: name/.test(await p.textContent('#dlg-body')));
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

  // Pressing Synth 2 / Synth 1 on the Tracks (its track-select SysEx) switches the editor, even
  // while the sequencer runs.
  await rx([0xfa]);
  await rx([0xf0, 0x00, 0x20, 0x29, 0x01, 0x64, 0x04, 0x03, 0x01, 0x00, 0xf7]);
  await p.waitForTimeout(300);
  check('the Synth 2 button on the Tracks switches the editor to Synth 2', (await synthNow()) === 1);
  await rx([0xf0, 0x00, 0x20, 0x29, 0x01, 0x64, 0x04, 0x03, 0x00, 0x00, 0xf7]);
  await p.waitForTimeout(300);
  check('and Synth 1 switches back', (await synthNow()) === 0);
  await p.evaluate(() => window.patchworker.setFace('tracks'));
  await rx([0xf0, 0x00, 0x20, 0x29, 0x01, 0x64, 0x04, 0x03, 0x06, 0x00, 0xf7]);
  await p.waitForTimeout(200);
  check('Drum 3 on the Tracks lights Drum 3 in the TRACKS panel, editor stays on Synth 1', (await synthNow()) === 0 && await p.evaluate(() => document.querySelector('.trk.on')?.dataset.track === '6'));
  await rx([0xf0, 0x00, 0x20, 0x29, 0x01, 0x64, 0x04, 0x03, 0x01, 0x00, 0xf7]);
  await p.waitForTimeout(300);
  check('Synth 2 on the Tracks lights Synth 2 in the panel', (await synthNow()) === 1 && await p.evaluate(() => document.querySelector('.trk.on')?.dataset.track === '1'));
  // View changes on the Tracks (04 <view> <track>): the panel follows the view, and the track
  // where the message carries one (not Mixer / FX / Patterns, which send track 00).
  const viewNow = () => p.evaluate(() => [document.querySelector('.views .view[aria-pressed="true"]')?.dataset.view, document.querySelector('.trk.on')?.dataset.track]);
  await rx([0xf0, 0x00, 0x20, 0x29, 0x01, 0x64, 0x04, 0x0d, 0x00, 0x00, 0xf7]);
  await p.waitForTimeout(200);
  check(`FX on the Tracks shows FX, track stays Synth 2 (${await viewNow()})`, (await viewNow()).join() === 'fx,1');
  await rx([0xf0, 0x00, 0x20, 0x29, 0x01, 0x64, 0x04, 0x07, 0x05, 0x00, 0xf7]);
  await p.waitForTimeout(200);
  check(`Probability on Drum 2 shows Probability and Drum 2 (${await viewNow()})`, (await viewNow()).join() === 'probability,5');
  for (const [code, id] of [[0x02, 'preset'], [0x08, 'note'], [0x0a, 'micro'], [0x09, 'sidechain'], [0x0b, 'patterns'], [0x0c, 'mixer'], [0x04, 'velocity'], [0x05, 'gate'], [0x06, 'pattern'], [0x03, 'note']]) {
    await rx([0xf0, 0x00, 0x20, 0x29, 0x01, 0x64, 0x04, code, 0x01, 0x00, 0xf7]);
    await p.waitForTimeout(60);
    const v = await viewNow();
    if (v[0] !== id) check(`view code ${code.toString(16)} shows ${id} (got ${v[0]})`, false);
  }
  check('every view code seen on the hardware maps to its panel view', (await viewNow()).join() === 'note,1');
  await p.evaluate(() => window.patchworker.setFace('editor'));
  await rx([0xfc]);

  // The Tracks' first answer lost just after linking: PatchWorker asks again.
  {
    const r = await b.newPage({ viewport: { width: 1400, height: 950 } });
    r.on('pageerror', (e) => errs.push(e.message));
    await r.goto('http://localhost:8765/patchworker/');
    await r.waitForFunction(() => window.patchworker?.S.pack && document.querySelectorAll('#patchlist li[data-slot]').length === 128);
    await r.evaluate(() => {
      const w = window.patchworker, L = w.link;
      let calls = 0;
      const playing = w.S.pack.patches[11].slice();
      L.out = { name: 'Circuit Tracks', send: () => {} };
      L.in = {};
      L.requestPatch = async () => { if (calls++ === 0) throw new Error('no answer'); return playing.slice(); };
      L.emit();
    });
    await r.waitForTimeout(800);
    check('a lost first answer is asked again, and the editor follows (slot 12)', await r.evaluate(() => window.patchworker.S.slot === 11 && /Synth 1 is playing this patch/.test(document.querySelector('#ed-hw').textContent)));
    await r.close();
  }

  // Linking while the Tracks' knobs have been turned: still the same patch, knobs taken over.
  {
    const r = await b.newPage({ viewport: { width: 1400, height: 950 } });
    r.on('pageerror', (e) => errs.push(e.message));
    await r.goto('http://localhost:8765/patchworker/');
    await r.waitForFunction(() => window.patchworker?.S.pack && document.querySelectorAll('#patchlist li[data-slot]').length === 128);
    const knob = await r.evaluate(async () => {
      const w = window.patchworker, L = w.link;
      const { macroPosAddr } = await import('/js/pw/params.js?v=' + (document.querySelector('script[type=module]').src.split('v=')[1]));
      const playing = w.S.pack.patches[0].slice();
      const a = macroPosAddr(0);
      playing[a] = (playing[a] + 50) & 127;
      L.out = { name: 'Circuit Tracks', send: () => {} };
      L.in = {};
      L.requestPatch = async () => playing.slice();
      L.emit();
      return { a, v: playing[a] };
    });
    await r.waitForTimeout(500);
    check('a patch whose macro knobs were turned on the Tracks is still found (slot 1), knobs taken over', await r.evaluate(({ a, v }) => { const w = window.patchworker; return w.S.slot === 0 && w.S.bytes[a] === v && /Synth 1 is playing this patch/.test(document.querySelector('#ed-hw').textContent) && document.querySelector('#patchlist li[data-slot="0"]').classList.contains('edited'); }, knob));
    await r.evaluate(() => window.patchworker.link.receive({ name: 'Circuit Tracks' }, new Uint8Array([0xb0, 80, 7])));
    check('and the macro knob on the Tracks then moves the editor', await r.evaluate(({ a }) => window.patchworker.S.bytes[a] === 7, knob));
    await r.close();
  }

  // ?midilog shows what the Tracks sends.
  const q = await b.newPage();
  await q.goto('http://localhost:8765/patchworker/?midilog');
  await q.waitForFunction(() => window.patchworker?.S.pack);
  await q.evaluate(() => window.patchworker.link.receive({ name: 'Circuit Tracks' }, new Uint8Array([0xf0, 0x00, 0x20, 0x29, 0x01, 0x64, 0x7f, 0xf7])));
  check('?midilog lists messages from the Tracks', /← f0 00 20 29 01 64 7f f7/.test(await q.textContent('.midilog')));
  // Store follows Components: file session (open, handshake, read of the pack's patch file 04/<pack>,
  // close), then 01 <pack> 00 <slot> 00 + patch (352 bytes); nothing else goes out until 500 ms after.
  const stored = await q.evaluate(async () => {
    const w = window.patchworker, out = [];
    w.link.in = { name: 'Circuit Tracks' };
    w.link.out = { send(b) { out.push({ t: performance.now(), b: [...b] }); } };
    const done = w.link.writeSlot(w.S.bytes, 3, 69);
    await new Promise((r) => setTimeout(r, 200));
    w.link.send([0xf0, 0x00, 0x20, 0x29, 0x01, 0x64, 0x40, 0x00, 0x00, 0xf7]);   // a patch request mid-Store
    w.link.program(0, 3);
    const ok = await done;
    await new Promise((r) => setTimeout(r, 900));
    w.link.out = null; w.link.in = null;
    const t0 = out[0].t;
    return { ok, msgs: out.map((e) => ({ t: Math.round(e.t - t0), b: e.b })) };
  });
  const m = stored.msgs, hx = (b) => b.map((x) => x.toString(16).padStart(2, '0')).join(' ');
  const storeAt = m.findIndex((e) => e.b.length === 352);
  check('Store opens a file session first (03 40)', hx(m[0].b) === 'f0 00 20 29 01 64 03 40 f7');
  check('reads the chosen pack\'s patch file (04/3) once', m.filter((e) => e.b[6] === 3 && e.b[7] === 1).map((e) => `${e.b[16]}/${e.b[18]}/${e.b[19]}`).join() === '4/3/2');
  check('closes the session (03 41) before the Store', storeAt > 0 && hx(m[storeAt - 1].b) === 'f0 00 20 29 01 64 03 41 f7');
  check('Store message is 01 <pack> 00 <slot> 00 + patch, 352 bytes', storeAt > 0 && hx(m[storeAt].b.slice(0, 11)) === 'f0 00 20 29 01 64 01 03 00 45 00' && m[storeAt].b[351] === 0xf7 && stored.ok);
  check(`a request and a Program Change made mid-Store wait until 500 ms after it (${m.slice(storeAt).map((e) => e.t).join(', ')})`,
    m.length === storeAt + 3 && m[storeAt + 1].t - m[storeAt].t >= 495 && m[storeAt + 2].t - m[storeAt].t >= 495);
  const logText = await q.textContent('.midilog');
  check('?midilog sums up the Store (pack, slot, name, macro positions)', /→ f0 00 20 29 01 64 01 03 00 45 00 … STORE to pack index 3, slot 70 \(352 bytes\): ".+", macros( \d+){8}/.test(logText));
  check('?midilog shows the file-session messages', /→ f0 00 20 29 01 64 03 40 f7/.test(logText));
  check('Store needs a pack', await q.evaluate(() => window.patchworker.link.writeSlot(window.patchworker.S.bytes, undefined, 0).then(() => false, () => true)));
  // Read patch files: a simulated Tracks lists 2 packs and has file 04/0 (700 bytes), not 04/1-31.
  const read = await q.evaluate(async () => {
    const w = window.patchworker, L = w.link, H = [0xf0, 0x00, 0x20, 0x29, 0x01, 0x64, 0x03];
    const file = Uint8Array.from({ length: 700 }, (_, i) => (i < 10 ? 'STORE TEST'.charCodeAt(i) : (i * 37) & 0xff));
    const nib = (v, n) => Array.from({ length: n }, (_, k) => (v >> (4 * (n - 1 - k))) & 15);
    const pack7 = (b) => { const o = []; for (let i = 0; i < b.length; i += 7) { const g = [...b.slice(i, i + 7)]; o.push(g.reduce((h, x, j) => h | ((x >> 7) << j), 0), ...g.map((x) => x & 127)); } return o; };
    const reply = (d) => setTimeout(() => L.receive({ name: 'Circuit Tracks' }, Uint8Array.from(d)), 2);
    let crc = 0xffffffff; for (const b of file) { crc ^= b; for (let k = 0; k < 8; k++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1; } crc = (crc ^ 0xffffffff) >>> 0;
    L.in = { name: 'Circuit Tracks' };
    L.out = { send(b) {
      if (b[6] !== 3) return;
      if (b[7] === 0x0b && b[8] === 2) ['00_First', '15_TracksGM'].forEach((n, i) => reply([...H, 0x0c, 0x02, i, ...[...n].map((c) => c.charCodeAt(0)), 0xf7]));
      if (b[7] === 0x01 && b[16] === 4) {
        const e = b[18], a = (k) => [0, 0, 0, 0, 0, 0, 0, k];
        if (e !== 0) return reply([...H, 0x06, 0x04, 0x00, e, 0xf7]);
        reply([...H, 0x01, ...a(0), 4, 0, 0, 1, 0, 0, 0, ...nib(file.length, 5), 0xf7]);
        reply([...H, 0x02, ...a(1), 4, 0, 0, ...pack7(file), 0xf7]);
        reply([...H, 0x03, ...a(2), 4, 0, 0, ...nib(crc, 8), 0xf7]);
      }
    } };
    const dl = []; const orig = URL.createObjectURL; URL.createObjectURL = (blob) => { dl.push(blob); return 'blob:x'; };
    document.querySelector('.midilog-box button:nth-of-type(3)').click();
    await new Promise((r) => { const t = setInterval(() => { if (dl.length) { clearInterval(t); r(); } }, 50); setTimeout(r, 8000); });
    URL.createObjectURL = orig; L.out = null; L.in = null;
    const json = dl.length ? JSON.parse(await dl[0].text()) : null;
    return { json, log: document.querySelector('.midilog').textContent };
  });
  check('Read patch files lists the packs', /★ packs on the Circuit Tracks: 0=00_First, 1=15_TracksGM/.test(read.log));
  check('and reads file 04/0 with its size, CRC and start', /★ file 04\/0: 700 bytes, CRC ok, starts "STORE TEST/.test(read.log) && /★ file 04\/1: none/.test(read.log));
  check('and downloads them as JSON', read.json && read.json.files[0].size === 700 && read.json.files[0].hex.startsWith('53544f5245') && read.json.packs[1] === '15_TracksGM');
  await q.close();
  check(`no console errors (${errs.length ? errs.join('; ') : 'none'})`, !errs.length);
  await b.close();
  console.log(fails ? `${fails} failed` : 'all passed');
  process.exit(fails ? 1 : 0);
})();
