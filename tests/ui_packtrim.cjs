// PackTrim in a real browser: load a pack, read the summary, save the trimmed pack, and (for a
// pack with an unreadable project) check that trimming is refused.
// Needs `python3 -m http.server 8765` running in the repo.
// node tests/ui_packtrim.cjs <out dir> <pack> [<pack> ...]
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const [out, ...packs] = process.argv.slice(2);
  const browser = await chromium.launch({ channel: 'chrome' });
  const errors = [];
  for (const pack of packs) {
    const tag = pack.replace(/^.*\//, '').replace(/\..*$/, '');
    for (const [view, opts] of [['desktop', { viewport: { width: 1280, height: 900 } }], ['dark', { viewport: { width: 1280, height: 900 }, colorScheme: 'dark' }], ['phone', { viewport: { width: 390, height: 844 }, isMobile: true }]]) {
      const ctx = await browser.newContext({ ...opts, acceptDownloads: true });
      const page = await ctx.newPage();
      page.on('console', (m) => { if (m.type() === 'error') errors.push(`${tag}/${view}: ${m.text()}`); });
      page.on('pageerror', (e) => errors.push(`${tag}/${view}: ${e.message}`));
      await page.goto('http://localhost:8765/packtrim/index.html');
      await page.setInputFiles('#file', pack);
      await page.waitForSelector('#step-save:not([hidden])', { timeout: 30000 });
      const info = await page.evaluate(() => ({
        pack: document.querySelector('#packinfo').innerText.replace(/\n/g, ' '),
        projects: [...document.querySelectorAll('#projects tbody tr')].map((r) => r.innerText.replace(/\s+/g, ' ').trim()),
        summary: document.querySelector('#summary').innerText.replace(/\n/g, ' '),
        kept: document.querySelectorAll('#samples .slot.keep').length + '/' + document.querySelectorAll('#patches .slot.keep').length,
        dropped: document.querySelectorAll('#samples .slot.out').length + '/' + document.querySelectorAll('#patches .slot.out').length,
        saveDisabled: document.querySelector('#save').disabled,
        status: document.querySelector('#save-status').innerText,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }));
      console.log(`${tag}/${view}:`, JSON.stringify(info));
      await page.screenshot({ path: `${out}/${tag}-${view}.png`, fullPage: true });
      if (view === 'desktop' && !info.saveDisabled) {
        const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#save')]);
        const file = `${out}/${dl.suggestedFilename()}`;
        await dl.saveAs(file);
        await page.waitForFunction(() => /Saved/.test(document.querySelector('#save-status').innerText));
        console.log('  saved', file, fs.statSync(file).size, '|', await page.evaluate(() => document.querySelector('#save-status').innerText));
      }
      await ctx.close();
    }
  }
  await browser.close();
  if (errors.length) { console.log('ERRORS:\n' + errors.join('\n')); }
})();
