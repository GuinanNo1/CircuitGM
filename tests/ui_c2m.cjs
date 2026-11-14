// Circuit2MIDI in a real browser: load packs, pick a project, change settings,
// preview, save the MIDI file. Needs `python3 -m http.server 8765` running in the repo.
// node tests/ui_c2m.cjs <screenshot dir> <pack> [<pack> ...]
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const [shots, ...packs] = process.argv.slice(2);
  fs.mkdirSync(shots, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  const views = [['desktop', { viewport: { width: 1280, height: 900 } }], ['dark', { viewport: { width: 1280, height: 900 }, colorScheme: 'dark' }], ['phone', { viewport: { width: 390, height: 844 } }]];
  for (const pack of packs) {
    const tag = pack.replace(/^.*\//, '').replace(/\..*$/, '');
    for (const [name, opts] of views) {
      const ctx = await browser.newContext({ ...opts, acceptDownloads: true });
      const page = await ctx.newPage();
      await page.addInitScript(() => { try { localStorage.setItem('circuitgm-advanced-m2c', '1'); localStorage.setItem('circuitgm-advanced-c2m', '1'); } catch {} });   // these tests drive every control: Advanced mode
      page.on('console', (m) => { if (m.type() === 'error') errors.push(`${tag}/${name}: ${m.text()}`); });
      page.on('pageerror', (e) => errors.push(`${tag}/${name}: ${e.message}`));
      await page.goto('http://localhost:8765/circuit2midi/index.html');
      await page.setInputFiles('#file', pack);
      await page.waitForSelector('#step-scenes:not([hidden]) #grid .col.scene', { timeout: 20000 });
      const info = await page.evaluate(() => ({
        pack: document.querySelector('#packinfo').innerText.replace(/\n/g, ' '),
        projects: document.querySelectorAll('.proj').length,
        cols: document.querySelectorAll('#grid .col.scene').length,
        maps: document.querySelectorAll('#maptable tbody tr').length,
        drums: document.querySelectorAll('#drumtable tbody tr').length,
        summary: document.querySelector('#song-summary').innerText.replace(/\n/g, ' '),
        trimLink: !document.querySelector('#trim-row').hidden,
        warnings: [...document.querySelectorAll('#warnings li')].map((l) => l.textContent),
        overflow: document.documentElement.scrollWidth - window.innerWidth,
      }));
      console.log(`${tag}/${name}:`, JSON.stringify(info));
      if (info.overflow > 0) errors.push(`${tag}/${name}: page is ${info.overflow}px wider than the screen`);
      if (name === 'desktop') {
        if (!info.trimLink) errors.push(`${tag}: no "Trim this pack in PackTrim" button`);
        // preview runs and the clock moves
        await page.click('#play');
        await page.waitForTimeout(2500);
        const t = await page.textContent('#time');
        const now = await page.evaluate(() => document.querySelectorAll('#grid .col.now').length);
        console.log('  preview clock', t, 'highlighted columns', now);
        if (t === '0:00') errors.push(`${tag}: preview clock did not move`);
        // change settings while playing: leave out track 1, custom order, octave
        await page.click('#grid .labels .row-label:nth-child(2) .dot');
        await page.selectOption('#order', 'custom');
        await page.fill('#custom', '1, 2x2');
        await page.waitForTimeout(500);
        const after = await page.evaluate(() => ({ cols: document.querySelectorAll('#grid .col.scene').length, off: document.querySelector('#maptable tbody tr').className, playing: document.querySelector('#play').textContent }));
        console.log('  after changes', JSON.stringify(after));
        if (after.cols !== 3) errors.push(`${tag}: custom order gave ${after.cols} columns`);
        await page.fill('#custom', '1, 99');
        await page.waitForTimeout(500);
        console.log('  bad order message:', await page.textContent('#order-status'));
        await page.selectOption('#order', 'used');
        await page.click('#play').catch(() => {});
        // save
        const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#save')]);
        const mid = `${shots}/${dl.suggestedFilename()}`;
        await dl.saveAs(mid);
        console.log('  saved', dl.suggestedFilename(), fs.statSync(mid).size, await page.textContent('#save-status'));
      }
      await page.screenshot({ path: `${shots}/${tag}-${name}.png`, fullPage: true });
      await ctx.close();
    }
  }
  await browser.close();
  console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no page errors');
  process.exit(errors.length ? 1 : 0);
})();
