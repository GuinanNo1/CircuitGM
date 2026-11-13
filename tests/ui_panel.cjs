// PatchWorker's TRACKS face (js/pw/panel.js): the TRACKS / EDITOR switch, track and view
// buttons, Note view pads playing the patch, the face remembered over a reload.
// Needs `python3 -m http.server 8765` running in the repo.
// node tests/ui_panel.cjs [<screenshot dir>]
const { chromium } = require('playwright');

(async () => {
  const shots = process.argv[2];
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const errs = [];
  let fails = 0;
  const check = (name, ok) => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`); };
  for (const [name, vp] of [['desktop', { width: 1400, height: 950 }], ['phone', { width: 390, height: 844 }]]) {
    const p = await b.newPage({ viewport: vp });
    p.on('pageerror', (e) => errs.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    await p.goto('http://localhost:8765/patchworker/');
    await p.waitForFunction(() => window.patchworker?.S.pack && document.querySelectorAll('#patchlist li[data-slot]').length === 128);
    await p.click('#face [data-face=tracks]');
    check(`${name}: TRACKS shows the panel and hides the editor pages`, await p.evaluate(() => !document.querySelector('#tracks').hidden && document.querySelector('#page-main').hidden && document.querySelector('.tabs').hidden));
    check(`${name}: 32 pads, 16 of them steps`, await p.evaluate(() => document.querySelectorAll('.pad').length === 32 && document.querySelectorAll('.pad.step').length === 16));
    const pad = await p.$('.pad.key.root');
    await pad.hover();
    await p.mouse.down();
    await p.waitForTimeout(100);
    check(`${name}: a Note view pad plays C3`, (await p.evaluate(() => [...window.patchworker.S.held.keys()])).join() === '48');
    if (shots) await p.screenshot({ path: `${shots}/panel-${name}.png`, fullPage: name === 'phone' });
    await p.mouse.up();
    check(`${name}: letting go releases it`, (await p.evaluate(() => window.patchworker.S.held.size)) === 0);
    await p.click('.trk[data-track="1"]');
    check(`${name}: the Synth 2 button chooses Synth 2`, (await p.evaluate(() => [window.patchworker.S.synth, document.body.dataset.synth, document.querySelector('.panel-lcd').textContent].join('|'))) === '1|1|Synth 2 · Note');
    await p.click('.view[data-view=mixer]');
    await p.click('.trk[data-track="5"]');
    check(`${name}: placeholder views play nothing`, await p.evaluate(() => document.querySelector('.panel-lcd').textContent === 'Drum 2 · Mixer' && document.querySelectorAll('.pad[data-note]').length === 0));
    check(`${name}: no sideways overflow`, await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await p.reload();
    await p.waitForFunction(() => window.patchworker?.S.pack);
    check(`${name}: the face is remembered`, await p.evaluate(() => document.body.dataset.face === 'tracks' && !document.querySelector('#tracks').hidden));
    await p.click('#face [data-face=editor]');
    check(`${name}: EDITOR brings the pages back`, await p.evaluate(() => document.querySelector('#tracks').hidden && !document.querySelector('#page-main').hidden && !document.querySelector('.tabs').hidden));
    await p.close();
  }
  check(`no console errors (${errs.length ? errs.join('; ') : 'none'})`, !errs.length);
  await b.close();
  console.log(fails ? `${fails} failed` : 'all passed');
  process.exit(fails ? 1 : 0);
})();
