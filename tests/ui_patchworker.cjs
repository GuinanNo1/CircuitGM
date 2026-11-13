// PatchWorker in a real browser: load the default pack, render every patch through the browser
// synth, edit and undo, save a patch and the pack, carry a session over a reload, and talk to a
// stand-in Circuit Tracks over a fake Web MIDI port.
// Needs `python3 -m http.server 8765` running in the repo.
// node tests/ui_patchworker.cjs <out dir>
const { chromium } = require('playwright');
const fs = require('fs');

const fakeMidi = () => {
  window.__sent = [];
  const input = { name: 'Circuit Tracks MIDI', state: 'connected', onmidimessage: null };
  const output = {
    name: 'Circuit Tracks MIDI', state: 'connected',
    send(data) {
      const bytes = [...data];
      window.__sent.push(bytes);
      // Answer a "current patch" request with a patch named after the synth.
      if (bytes[0] === 0xf0 && bytes[6] === 0x40) {
        const reply = new Uint8Array(350);
        reply.set([0xf0, 0, 0x20, 0x29, 1, 0x64, 0, bytes[7], 0]);
        reply.set([...`From Synth ${bytes[7] + 1}`.padEnd(16)].map((c) => c.charCodeAt(0)), 9);
        for (let i = 25; i < 349; i++) reply[i] = 64;
        reply[349] = 0xf7;
        setTimeout(() => input.onmidimessage?.({ data: reply }), 20);
      }
    },
  };
  navigator.requestMIDIAccess = async () => ({ inputs: new Map([['i', input]]), outputs: new Map([['o', output]]), onstatechange: null });
};

(async () => {
  const out = process.argv[2] ?? 'tests/out';
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
  const fails = [];
  const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails.push(what); };
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await ctx.addInitScript(fakeMidi);
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_|fonts\./.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  const open = async () => { await page.goto('http://localhost:8765/patchworker/'); await page.waitForFunction(() => window.patchworker?.S.pack && document.querySelectorAll('#patchlist li[data-slot]').length === 128); };
  await open();
  check((await page.innerText('#pack-info')).startsWith('128 patches · 64 samples'), 'TracksGM loads by default');
  check(await page.inputValue('#patch-name') === 'Grand Piano', 'slot 1 is Grand Piano');

  // --- every patch makes sound in the browser synth, with nothing blowing up
  const render = await page.evaluate(async () => {
    const { PatchSynth } = await import('/js/pw/engine.js?v=20261113d');
    const { S } = window.patchworker;
    const res = [];
    for (let i = 0; i < 128; i++) {
      const off = new OfflineAudioContext(1, 48000, 48000);
      const synth = new PatchSynth(off);
      synth.setPatch(S.pack.patches[i]);
      synth.noteOn(60, 100, 0.01, 0.45);
      const d = (await off.startRendering()).getChannelData(0);
      let peak = 0;
      let bad = 0;
      for (const v of d) { if (!Number.isFinite(v)) bad++; else peak = Math.max(peak, Math.abs(v)); }
      res.push({ i, peak, bad });
    }
    return res;
  });
  // Middle C plays at 261.6 Hz, as measured on the hardware.
  const c4 = await page.evaluate(async () => {
    const { PatchSynth } = await import('/js/pw/engine.js?v=20261113d');
    const { initPatch } = await import('/js/pw/params.js?v=20261113d');
    const off = new OfflineAudioContext(1, 48000, 48000);
    const s = new PatchSynth(off); const b = initPatch(); b[36] = 0; b[35] = 63; s.setPatch(b);
    s.noteOn(60, 100, 0, 0.9);
    const d = (await off.startRendering()).getChannelData(0);
    let n = 0; for (let i = 9601; i < 33600; i++) if (d[i - 1] < 0 && d[i] >= 0) n++;
    return n * 2;
  });
  check(Math.abs(c4 - 262) <= 2, `MIDI 60 plays at ~261.6 Hz with Keyboard Octave -1 stored (${c4} Hz)`);
  const silent = render.filter((r) => r.peak < 0.003).map((r) => r.i + 1);
  check(render.every((r) => !r.bad), 'no patch renders NaN or infinity');
  check(silent.length === 0, `all 128 patches are audible (silent: ${silent.join(', ') || 'none'})`);
  const peaks = render.map((r) => r.peak).sort((a, b) => a - b);
  console.log(`     peaks: min ${peaks[0].toFixed(3)}, median ${peaks[64].toFixed(3)}, max ${peaks[127].toFixed(3)}`);

  // --- an untouched pack saves back with every file identical
  const same = await page.evaluate(async () => {
    const { openPack } = await import('/js/pw/packio.js?v=20261113d');
    const { S, buildPack } = window.patchworker;
    const { blob } = await buildPack(S.pack);
    const again = await openPack(await blob.arrayBuffer());
    let diff = 0;
    for (const [name, data] of S.pack.files) {
      if (name === 'index.json') continue;
      const b = again.files.get(name);
      if (!b || b.length !== data.length || !b.every((v, k) => v === data[k])) diff++;
    }
    return { diff, files: again.files.size, was: S.pack.files.size, index: JSON.stringify(again.index) === JSON.stringify(S.pack.index) };
  });
  check(same.diff === 0 && same.files === same.was && same.index, `untouched pack round-trips (${same.files} files, index identical: ${same.index})`);

  // --- edit with the keyboard, undo, redo
  const freq = page.locator('.filter .knob', { hasText: 'Frequency' });
  const before = await page.evaluate(() => window.patchworker.S.bytes[64]);
  await freq.focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowDown');
  check(await page.evaluate(() => window.patchworker.S.bytes[64]) === before - 5, 'arrow keys move a knob');
  check(await page.locator('#patchlist li.sel.edited').count() === 1, 'the slot is marked as changed');
  await page.click('#undo');
  check(await page.evaluate(() => window.patchworker.S.bytes[64]) === before, 'undo restores it in one step');
  await page.click('#redo');
  check(await page.evaluate(() => window.patchworker.S.bytes[64]) === before - 5, 'redo brings it back');

  // --- rename, download the patch, check the file
  await page.fill('#patch-name', 'Worker Test');
  await page.click('#patch-menu-btn');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act="save-syx"]')]);
  const syxFile = `${out}/${dl.suggestedFilename()}`;
  await dl.saveAs(syxFile);
  const syx = fs.readFileSync(syxFile);
  const want = await page.evaluate(() => [...window.patchworker.S.bytes]);
  check(syx.length === 350 && syx[0] === 0xf0 && syx[5] === 0x64 && syx[349] === 0xf7 && want.every((v, i) => syx[9 + i] === v), `patch saved as ${dl.suggestedFilename()} (350 bytes, matches the editor)`);

  // --- load that .syx into slot 128, then save the pack and read it back
  await page.setInputFiles('#file-syx', syxFile);
  await page.selectOption('#dlg-body select', '127');
  await page.click('#dlg-ok');
  await page.waitForFunction(() => document.querySelector('#slot-no').textContent === '128', null, { timeout: 3000 }).catch(() => {});
  check(await page.innerText('#slot-no') === '128' && await page.inputValue('#patch-name') === 'Worker Test', '.syx loads into the chosen slot');
  await page.click('#pack-save');
  const [pdl] = await Promise.all([page.waitForEvent('download'), page.click('#dlg-ok')]);
  const packFile = `${out}/${pdl.suggestedFilename()}`;
  await pdl.saveAs(packFile);
  const packCheck = await page.evaluate(async (b64) => {
    const { openPack } = await import('/js/pw/packio.js?v=20261113d');
    const { getName } = await import('/js/pw/params.js?v=20261113d');
    const buf = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
    const p = await openPack(buf);
    return { n0: getName(p.patches[0]), n127: getName(p.patches[127]), i0: p.index.patches[0].name, i127: p.index.patches[127].name, f: p.patches[0][64], samples: p.samples };
  }, fs.readFileSync(packFile).toString('base64'));
  check(packCheck.n0 === 'Worker Test' && packCheck.i0 === 'Worker Test' && packCheck.n127 === 'Worker Test' && packCheck.i127 === 'Worker Test' && packCheck.f === before - 5 && packCheck.samples === 64,
    `saved pack carries the edits (${JSON.stringify(packCheck)})`);

  // --- the session survives a reload
  await page.waitForTimeout(700);
  await open();
  check(await page.locator('#patchlist li.edited').count() === 2 && await page.innerText('#slot-no') === '128', 'a reload carries on with the edits and the selected slot');

  // --- Circuit Tracks link (fake port)
  await page.click('#link-btn');
  await page.waitForSelector('#hw:not([hidden])');
  const sent = () => page.evaluate(() => window.__sent.splice(0));
  // Linking sends nothing by itself: the page says what the synth is playing and asks.
  await page.waitForSelector('#dlg[open]');
  let msgs = await sent();
  check(!msgs.some((m) => m.length === 350) && (await page.innerText('#dlg-title')) === 'Synth 1 on the Circuit Tracks', 'linking asks before replacing what Synth 1 is playing');
  check((await page.getAttribute('#ed-hw', 'data-state')) === 'differs', `the status line says the synth has another patch (${await page.innerText('#ed-hw')})`);
  await page.click('#dlg-ok');
  await page.waitForTimeout(100);
  msgs = await sent();
  check(msgs.some((m) => m.length === 350 && m[6] === 0 && m[7] === 0) && (await page.getAttribute('#ed-hw', 'data-state')) === 'same', 'Send in that dialog sends the patch to Synth 1');
  await page.click('#patchlist li[data-slot="38"]');
  await page.waitForTimeout(100);
  msgs = await sent();
  check(msgs.some((m) => m.length === 350), 'choosing a slot sends its patch');
  await freq.focus();
  await page.keyboard.press('ArrowUp');
  msgs = await sent();
  check(msgs.length === 1 && msgs[0][0] === 0xb0 && msgs[0][1] === 74, `filter frequency goes out as CC 74 (${JSON.stringify(msgs)})`);
  await page.click('#hw [data-synth="1"]');
  await page.waitForSelector('#dlg[open]');
  check((await page.getAttribute('body', 'data-synth')) === '1', 'choosing Synth 2 switches the panel colour');
  await page.click('#dlg-ok');
  await page.waitForTimeout(100);
  await sent();
  await page.locator('.env .knob', { hasText: 'Attack' }).nth(1).evaluate(() => window.patchworker.setByte(75, 30));
  msgs = await sent();
  check(JSON.stringify(msgs) === JSON.stringify([[0xb1, 99, 0, 0xb1, 98, 1, 0xb1, 6, 30]]), `env 2 attack goes out as NRPN 0:1 on channel 2 (${JSON.stringify(msgs)})`);
  await page.locator('#macro-row .knob').nth(4).focus();
  await page.keyboard.press('PageUp');
  msgs = await sent();
  check(msgs.length === 1 && msgs[0][1] === 84 && msgs[0][2] === 10, 'macro 5 goes out as CC 84');
  await page.click('[data-page="mod"]');
  await page.locator('.matrix .mrow').nth(1).locator('input.depth').fill('80');
  await page.waitForTimeout(350);
  msgs = await sent();
  check(msgs.length === 1 && msgs[0].length === 350 && msgs[0][7] === 1, 'a mod matrix edit resends the whole patch');
  // keys play the Tracks, not the browser
  await page.keyboard.press('a');
  await page.keyboard.up('a');
  msgs = await sent();
  check(msgs.length >= 2 && msgs[0][0] === 0x91 && msgs[0][1] === 48 && msgs.some((m) => m[0] === 0x81), `computer keys play the linked synth (${JSON.stringify(msgs)})`);
  // Get: names the slot it will replace, then marks the patch as fetched from the hardware.
  await page.click('#hw-get');
  await page.waitForSelector('#dlg[open]');
  check((await page.innerText('#dlg-title')).includes('From Synth 2'), 'Get fetches the synth\'s current patch');
  check(/This replaces 039 "/.test(await page.innerText('#dlg-body')), `Get names the patch it will replace (${(await page.innerText('#dlg-body')).replace(/\n/g, ' | ')})`);
  await page.click('#dlg-ok');
  await page.waitForTimeout(150);
  msgs = await sent();
  check(await page.inputValue('#patch-name') === 'From Synth 2' && (await page.innerText('#ed-what')).includes('fetched from Synth 2 on the Circuit Tracks') && await page.locator('#patchlist li[data-slot="38"].from-hw').count() === 1,
    `a fetched patch is labelled as from the Circuit Tracks (${await page.innerText('#ed-what')})`);
  check(!msgs.some((m) => m.length === 350) && (await page.getAttribute('#ed-hw', 'data-state')) === 'same', 'a fetched patch is not sent back to the synth it came from');
  // Live off: later edits leave the synth with an older version until Send.
  await page.uncheck('#hw-live');
  await page.evaluate(() => window.patchworker.setByte(75, 31));
  msgs = await sent();
  check(msgs.length === 0 && (await page.innerText('#ed-hw')).includes('older version'), 'with Live off the status line says the synth is behind');
  await page.check('#hw-live');
  msgs = await sent();
  check(msgs.some((m) => m.length === 350) && (await page.getAttribute('#ed-hw', 'data-state')) === 'same', 'ticking Live sends the patch');
  // Replacing a patch from the menu asks first.
  await page.click('#patch-menu-btn');
  await page.click('[data-act="init"]');
  await page.waitForSelector('#dlg[open]');
  check((await page.innerText('#dlg-body')).includes('including the changes you made'), 'the Initial Patch asks before replacing a changed patch');
  await page.click('#dlg-cancel');
  check(await page.inputValue('#patch-name') === 'From Synth 2', 'cancelling leaves the patch alone');

  await page.click('[data-page="main"]');
  await page.screenshot({ path: `${out}/patchworker-main.png` });
  await page.click('[data-page="fx"]');
  await page.screenshot({ path: `${out}/patchworker-fx.png` });
  await page.click('[data-page="mod"]');
  await page.screenshot({ path: `${out}/patchworker-mod.png` });
  await page.setViewportSize({ width: 1100, height: 760 });
  await page.click('[data-page="main"]');
  await page.screenshot({ path: `${out}/patchworker-small.png` });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(overflow <= 0, `no sideways overflow at 1100px (${overflow})`);

  check(errors.length === 0, `no console errors (${errors.join(' | ') || 'none'})`);
  await browser.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})();
