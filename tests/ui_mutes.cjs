const { chromium } = require('playwright');
(async () => {
  const shots = process.argv[2];
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_TUNNEL')) errors.push(m.text()); });
  await page.goto('http://localhost:8765/index.html');
  await page.waitForFunction(() => document.querySelector('#base-status').textContent.includes('patches'));
  await page.setInputFiles('#file', '/home/claude/mrbumpy409/generaluser-gs/demo MIDIs/Dance.mid');
  await page.waitForSelector('#grid .col');
  const rowNames = await page.$$eval('#grid .labels .row-label', (x) => x.map((e) => e.textContent.trim()));
  console.log('rows:', rowNames.join(' | '));
  const summary = async () => (await page.textContent('#summary')).replace(/\s+/g, ' ').trim();
  console.log('before:', await summary());
  await page.click('#play'); await page.waitForTimeout(800);
  // mute whole S2 source (row 3 = first source under Synth 2)
  const labels = await page.$$('#grid .labels .row-label');
  const idx = rowNames.findIndex((n, i) => i > 2 && rowNames[i - 1].startsWith('Synth 2'));
  await (await labels[idx].$('.dot')).click();
  console.log('after muting', rowNames[idx], ':', await summary(), '| still playing:', await page.textContent('#play'));
  // mute bars: click first non-empty source cell of drums source row
  const drumIdx = rowNames.findIndex((n) => n.startsWith('Dance/10'));
  const cell = await page.$(`.cell.src.on[data-row="${drumIdx - 2}"]`);
  await cell.click();
  console.log('muted cells:', await page.$$eval('.cell.muted', (x) => x.length), '| dot off:', await page.$$eval('.dot.off', (x) => x.length));
  await page.selectOption('#tempo-div', '2'); await page.selectOption('#rate', '4');
  console.log('÷2, 1/4 steps:', await summary(), '| rate labels', (await page.$$eval('#rate option', (x) => x.map((o) => o.textContent))).join(' / '));
  console.log('warnings:', (await page.$$eval('#warnings li', (x) => x.map((e) => e.textContent.slice(0, 90)))).join(' // '));
  await page.click('#play').catch(() => {});
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#build')]);
  await dl.saveAs(`${shots}/mutes.circuittrackspack`);
  console.log('status:', await page.textContent('#build-status'));
  await page.screenshot({ path: `${shots}/mutes.png`, fullPage: true });
  console.log('errors:', errors.length ? errors : 'none');
  await browser.close();
})();
