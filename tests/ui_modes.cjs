// Simple / Advanced mode on MIDI2Circuit and Circuit2MIDI.
//   node tests/ui_modes.cjs <midi file> <circuit pack>
// Needs `python3 -m http.server 8765` in the repo root and Playwright (Chrome).
const { chromium } = require('playwright');
const [mid, pack] = process.argv.slice(2);
let failed = 0;
const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) failed++; };
const shown = (p, sel) => p.$eval(sel, (e) => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length)).catch(() => false);

(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));

  // ---- MIDI2Circuit ----
  await p.goto('http://localhost:8765/midi2circuit/');
  await p.waitForFunction(() => !/Loading/.test(document.querySelector('#base-status').textContent));
  ok(await p.evaluate(() => document.documentElement.classList.contains('simple')), 'M2C starts in simple mode');
  ok(!(await p.isChecked('#advanced')), 'M2C switch is off');
  ok(await shown(p, '.modenote.simple-only'), 'M2C simple-mode note shows');
  ok(!(await shown(p, '#basepack')), 'M2C base pack box hidden');
  await p.setInputFiles('#file', mid);
  await p.waitForFunction(() => window.tracksgm?.state?.plan, null, { timeout: 60000 });
  ok(!(await shown(p, '#arrange-options')), 'M2C arrangement settings hidden');
  ok(!(await shown(p, '#warnings')), 'M2C warnings hidden');
  ok(!(await shown(p, '.solo')), 'M2C solo buttons hidden');
  ok((await p.inputValue('#rate')) === 'track', 'M2C pattern length is Per track: keep notes');
  ok((await p.inputValue('#title')).length <= 16 && !/^TracksGM /.test(await p.inputValue('#packname')), `M2C names fit, no TracksGM prefix ("${await p.inputValue('#title')}" / "${await p.inputValue('#packname')}")`);
  ok(/of 16 characters/.test(await p.textContent('#title-count')), 'M2C name count shows');

  await p.click('.modeswitch');
  ok(await p.evaluate(() => !document.documentElement.classList.contains('simple')), 'M2C Advanced on');
  ok(await shown(p, '#arrange-options') && await shown(p, '#basepack') && await shown(p, '.solo'), 'M2C advanced controls show');
  ok(!(await shown(p, '.modenote.simple-only')), 'M2C simple-mode note hidden in Advanced');
  await p.click('#quantize'); await p.selectOption('#quantize', { index: 1 });
  await p.click('.modeswitch');
  ok(await shown(p, '#mode-changed') && /1 setting you changed/.test(await p.textContent('#mode-changed')), `M2C changed-setting line (${await p.textContent('#mode-changed')})`);
  await p.reload();
  await p.waitForFunction(() => !/Loading/.test(document.querySelector('#base-status').textContent));
  ok(await p.evaluate(() => document.documentElement.classList.contains('simple')), 'M2C remembers simple mode');
  await p.click('.modeswitch'); await p.reload();
  ok(await p.evaluate(() => !document.documentElement.classList.contains('simple')), 'M2C remembers Advanced');
  await p.click('.modeswitch');

  // ---- Circuit2MIDI ----
  await p.goto('http://localhost:8765/circuit2midi/');
  ok(await p.evaluate(() => document.documentElement.classList.contains('simple')), 'C2M starts in simple mode (own setting)');
  await p.setInputFiles('#file', pack);
  await p.waitForSelector('.proj');
  await p.click('.proj');
  await p.waitForFunction(() => !document.querySelector('#step-save').hidden, null, { timeout: 60000 });
  ok(!(await shown(p, '#step-map')) && !(await shown(p, '#scene-options')), 'C2M mapping and scene settings hidden');
  ok(!(await p.$('#step-compact')) && await shown(p, '#to-packtrim'), 'C2M has no trim step, and the PackTrim button shows in simple mode');
  ok(!(await shown(p, '#to-tracks')), 'C2M Rebuild in MIDI2Circuit hidden in simple mode (Tracks pack)');
  const nums = await p.$$eval('main > .panel > h2 > .num', (ns) => ns.filter((n) => n.offsetParent).map((n) => n.textContent).join(','));
  ok(nums === '1,2,3,4', `C2M visible steps renumbered (${nums})`);
  await p.click('.modeswitch');
  ok(await shown(p, '#to-tracks') && (await p.textContent('#to-tracks')) === 'Rebuild in MIDI2Circuit', 'C2M Advanced shows Rebuild in MIDI2Circuit for a Tracks pack');
  ok(await shown(p, '#step-map'), 'C2M Advanced shows the mapping');
  const nums2 = await p.$$eval('main > .panel > h2 > .num', (ns) => ns.filter((n) => n.offsetParent).map((n) => n.textContent).join(','));
  ok(nums2 === '1,2,3,4,5', `C2M Advanced numbering (${nums2})`);
  await p.click('.modeswitch');

  // phone width: switch and note fit
  await p.setViewportSize({ width: 390, height: 844 });
  ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'C2M no sideways scroll on a phone');
  ok(errs.length === 0, `no page errors ${errs.join(' | ')}`);
  await b.close();
  console.log(failed ? `${failed} failed` : 'all passed');
  process.exit(failed ? 1 : 0);
})();
