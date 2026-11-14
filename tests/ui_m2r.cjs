// MIDI2Rhythm in a browser: load a MIDI file, check the parts table and the eight tracks,
// switch a chord part to Arpeggio in Advanced mode, play the preview, build the pack.
// Needs `python3 -m http.server 8765` in the repo root.
// NODE_PATH=/opt/npm-tools/node_modules node tests/ui_m2r.cjs <shots dir> <file.mid>
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const [shots, mid] = process.argv.slice(2);
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  let fails = 0;
  const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails++; };
  for (const [name, opts] of [['desktop', { viewport: { width: 1280, height: 900 } }], ['dark', { viewport: { width: 1280, height: 900 }, colorScheme: 'dark' }], ['phone', { viewport: { width: 390, height: 844 } }]]) {
    const ctx = await browser.newContext({ ...opts, acceptDownloads: true });
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g/.test(m.text()) && !/ERR_/.test(m.text())) errors.push(`${name}: ${m.text()}`); });
    page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
    await page.goto('http://localhost:8765/midi2rhythm/index.html');
    await page.waitForFunction(() => document.querySelector('#base-status').textContent.startsWith('Ready'), null, { timeout: 30000 });
    await page.setInputFiles('#file', mid);
    await page.waitForSelector('#step-arrange:not([hidden]) .grid .col');
    if (name === 'desktop') {
      const rows = await page.$$eval('#parts tbody tr', (r) => r.length);
      const slots = await page.$$eval('#budget .slot:not(.empty)', (r) => r.length);
      ok(rows > 0 && slots > 0, `${rows} parts, ${slots} tracks used`);
      ok(await page.isHidden('#parts select[data-method]') || !(await page.$('#parts select[data-method]')), 'method select hidden in simple mode');
      await page.screenshot({ path: `${shots}/m2r-simple.png`, fullPage: true });
      await page.click('#advanced');
      const sel = await page.$('#parts select[data-method]');
      if (sel) {
        await sel.selectOption('arp');
        await page.waitForTimeout(300);
        ok((await page.$eval('#parts select[data-method]', (s) => s.value)) === 'arp', 'arpeggio chosen in Advanced');
      }
      // play one part, then mute and unmute track 1 with its dot
      await page.click('#parts .playbtn');
      await page.waitForTimeout(800);
      ok(await page.$eval('#parts .playbtn', (b) => b.classList.contains('on')), 'part play button on');
      await page.click('#parts .playbtn');
      const before = (await page.textContent('#summary')).replace(/\s+/g, ' ');
      await page.click('#grid .row-label [data-mute="0"]');
      await page.waitForTimeout(300);
      ok(await page.$eval('#grid [data-mute="0"]', (b) => b.classList.contains('off')), 'track 1 muted by its dot');
      await page.click('#grid .row-label [data-mute="0"]');
      await page.waitForTimeout(300);
      ok((await page.textContent('#summary')).replace(/\s+/g, ' ') === before, 'unmuted: arrangement back as before');
      await page.click('#play');
      await page.waitForFunction(() => document.querySelector('#play').textContent === 'Stop', null, { timeout: 30000 });
      await page.waitForTimeout(2500);
      const t = await page.textContent('#time');
      ok(t !== '0:00', `preview clock ${t}, now column ${await page.$$eval('.col.now', (x) => x.length)}`);
      await page.click('#play');
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#build')]);
      const p = `${shots}/ui-m2r.circuitrhythmpack`;
      await dl.saveAs(p);
      ok(fs.statSync(p).size > 1e6, `download ${dl.suggestedFilename()} ${fs.statSync(p).size} bytes; ${await page.textContent('#build-status')}`);
      console.log('summary:', (await page.textContent('#summary')).replace(/\s+/g, ' '));
      console.log('warnings:', (await page.textContent('#warnings')).slice(0, 400));
      await page.selectOption('#kit', 'latin:2');
      await page.waitForTimeout(500);
      ok((await page.$$eval('#budget .slot:not(.empty)', (r) => r.length)) > 0, 'Latin kit re-plans');
      await page.click('#advanced');
    }
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    console.log(name, 'scrollWidth', sw);
    await page.screenshot({ path: `${shots}/m2r-${name}.png`, fullPage: true });
    await ctx.close();
  }
  ok(!errors.length, `page errors: ${errors.length ? errors.join(' | ') : 'none'}`);
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
