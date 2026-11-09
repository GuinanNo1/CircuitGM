const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const shots = process.argv[2];
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  for (const [name, opts] of [['desktop', { viewport: { width: 1280, height: 900 } }], ['dark', { viewport: { width: 1280, height: 900 }, colorScheme: 'dark' }], ['phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 }]]) {
    const ctx = await browser.newContext({ ...opts, acceptDownloads: true });
    const page = await ctx.newPage();
    await page.addInitScript(() => { try { localStorage.setItem('circuitgm-advanced-m2c', '1'); localStorage.setItem('circuitgm-advanced-c2m', '1'); } catch {} });   // these tests drive every control: Advanced mode
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`${name}: ${m.text()}`); });
    page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
    await page.goto('http://localhost:8765/midi2circuit/index.html');
    await page.waitForFunction(() => document.querySelector('#base-status').textContent.includes('patches'), null, { timeout: 15000 });
    await page.setInputFiles('#file', '/home/claude/mrbumpy409/generaluser-gs/demo MIDIs/Dance.mid');
    await page.waitForSelector('#step-arrange:not([hidden]) .col');
    if (name === 'desktop') {
      // combine: send part 5 (Perc Organ 2) to Synth 2 as well
      const rows = await page.$$('#tracks tbody tr');
      await (await rows[4].$('.role[data-role="S2"]')).click();
      await page.click('#play');
      await page.waitForTimeout(1500);
      const t = await page.textContent('#time');
      console.log('preview time after 1.5 s:', t, 'col now:', await page.$$eval('.col.now', (x) => x.length));
      await page.click('#play');
      const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#build')]);
      const p = `${shots}/ui.circuittrackspack`;
      await dl.saveAs(p);
      console.log('download', dl.suggestedFilename(), fs.statSync(p).size, 'status:', await page.textContent('#build-status'));
      console.log('summary:', (await page.textContent('#summary')).replace(/\s+/g, ' '));
      console.log('warnings:', (await page.textContent('#warnings')).slice(0, 300));
      console.log('S2 sub:', await page.textContent('#sub-s2'), '| S1 patch:', await page.$eval('#patch-s1', (s) => s.selectedOptions[0].textContent));
    }
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    console.log(name, 'scrollWidth', sw);
    await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
    await ctx.close();
  }
  console.log('errors:', errors.length ? errors : 'none');
  await browser.close();
})();
