// Browser test: MIDI2Circuit with a Circuit pack as the song.
// Needs `python3 -m http.server 8765` in the repo root and Playwright (Chrome).
// node tests/ui_p2p.cjs <screenshot dir> <rhythm pack> <tracks pack> <midi file>
const { chromium } = require('playwright');
const fs = require('fs');
const [shots, rhythm, tracks, mid] = process.argv.slice(2);
let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) fails++; };

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  for (const [label, viewport, scheme] of [['desktop', { width: 1280, height: 900 }, 'light'], ['phone', { width: 390, height: 844 }, 'dark']]) {
    const page = await browser.newPage({ viewport, colorScheme: scheme, acceptDownloads: true });
    await page.addInitScript(() => { try { localStorage.setItem('circuitgm-advanced-m2c', '1'); localStorage.setItem('circuitgm-advanced-c2m', '1'); } catch {} });   // these tests drive every control: Advanced mode
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('http://localhost:8765/midi2circuit/');
    await page.waitForFunction(() => !/Loading/.test(document.querySelector('#base-status').textContent), null, { timeout: 20000 });
    const text = (s) => page.textContent(s);
    const visible = (s) => page.isVisible(s);

    // Rhythm pack as the song
    await page.setInputFiles('#file', rhythm);
    await page.waitForSelector('#projpick', { state: 'visible' });
    await page.waitForFunction(() => /will hold/.test(document.querySelector('#shrink-info').textContent));
    ok(/Rhythm test/.test(await text('#fileinfo')) && /Circuit Rhythm/.test(await text('#fileinfo')), `${label}: file info names the Rhythm pack`);
    ok((await page.$$eval('#project option', (o) => o.length)) === 1, `${label}: one project offered`);
    ok(await visible('#shrink') && !(await visible('#kit')) && await visible('#kit-pack'), `${label}: shrink shown, kit list hidden, pack drums shown`);
    ok(/4 samples from Rhythm test/.test(await text('#kit-pack')), `${label}: drums use 4 pack samples (${await text('#kit-pack')})`);
    ok(/2 patches and 4 samples/.test(await text('#shrink-info')), `${label}: shrink info (${(await text('#shrink-info')).slice(0, 60)}…)`);
    ok((await text('#base-name')) === 'TracksGM_v1', `${label}: Rhythm pack leaves the base pack on TracksGM`);
    const parts = await page.$$eval('#tracks tbody tr', (rows) => rows.map((r) => `${r.querySelector('.pname').textContent}=${r.querySelector('.role[aria-pressed="true"]')?.dataset.role ?? '-'}`));
    ok(parts.join() === 'Track 1: Kick 909=DR,Track 2: Snare Crack=DR,Track 3: Closed Hat=DR,Track 4: Bass Pluck=S1', `${label}: parts ${parts.join(', ')}`);
    const lanes = await page.$$eval('#tracks tbody tr select.lane', (s) => s.map((x) => (x.hidden ? '-' : x.value)));
    ok(lanes.join() === '1,2,0,-', `${label}: drum tracks per Rhythm track, busiest first (${lanes.join()})`);
    ok((await page.inputValue('#rate')) === 'track', `${label}: packs start on Per track`);
    // Move the snare to D4 and back: the arrangement follows.
    await page.selectOption('#tracks tbody tr:nth-child(2) select.lane', '3');
    await page.waitForFunction(() => [...document.querySelectorAll('.row-label')].some((r) => /Drum 4/.test(r.textContent)));
    ok(await page.evaluate(() => window.tracksgm.state.plan.projects[0].patternCounts[7] > 0), `${label}: snare moved to D4`);
    await page.selectOption('#tracks tbody tr:nth-child(2) select.lane', '2');
    await page.uncheck('#shrink-on');
    await page.waitForFunction(() => /6 samples/.test(document.querySelector('#shrink-info').textContent));
    ok(/128 patches and 6 samples/.test(await text('#shrink-info')), `${label}: not shrinking keeps the rest`);
    await page.check('#shrink-on');
    await page.waitForFunction(() => /4 samples/.test(document.querySelector('#shrink-info').textContent));
    await page.click('#play');
    await page.waitForTimeout(800);
    ok((await text('#play')) === 'Stop', `${label}: preview plays`);
    await page.click('#play');
    if (label === 'desktop') {
      await page.screenshot({ path: `${shots}/p2p-rhythm-top.png`, fullPage: false });
      await page.$eval('#step-sounds', (e) => e.scrollIntoView());
      await page.screenshot({ path: `${shots}/p2p-rhythm-sounds.png` });
    } else {
      await page.screenshot({ path: `${shots}/p2p-rhythm-phone.png`, fullPage: true });
      ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${label}: no sideways scroll`);
    }
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#build')]);
    const saved = `${shots}/${label}-${dl.suggestedFilename()}`;
    await dl.saveAs(saved);
    ok(fs.statSync(saved).size > 1000 && /Saved/.test(await text('#build-status')), `${label}: built ${dl.suggestedFilename()} (${await text('#build-status')})`);

    // Base box refuses a Rhythm pack
    await page.setInputFiles('#base-file', rhythm);
    ok(/Circuit Rhythm pack/.test(await text('#base-status')), `${label}: base box explains it can't use a Rhythm pack`);

    // Tracks pack as the song: becomes the base pack, parts go back to their own tracks
    await page.setInputFiles('#file', tracks);
    await page.waitForFunction(() => /Circuit Tracks/.test(document.querySelector('#fileinfo').textContent));
    ok((await text('#base-name')) === 'P2P source', `${label}: Tracks pack becomes the base pack (${await text('#base-name')})`);
    ok((await page.inputValue('#patch-s1')) === '80' && (await page.inputValue('#patch-s2')) === '38', `${label}: synths keep their own patches`);
    const tparts = await page.$$eval('#tracks tbody tr', (rows) => rows.map((r) => r.querySelector('.role[aria-pressed="true"]')?.dataset.role ?? '-'));
    ok(tparts.join() === 'S1,S2,DR,DR,DR', `${label}: Tracks parts on their own tracks (${tparts.join()})`);
    if (label === 'desktop') { await page.$eval('#step-arrange', (e) => e.scrollIntoView()); await page.screenshot({ path: `${shots}/p2p-tracks-arrange.png` }); }

    // A MIDI file again: back to TracksGM, pack-only controls hidden
    await page.setInputFiles('#file', mid);
    await page.waitForFunction(() => /File/.test(document.querySelector('#fileinfo').textContent));
    ok((await text('#base-name')) === 'TracksGM_v1', `${label}: MIDI file puts the base pack back to TracksGM`);
    ok(!(await visible('#projpick')) && !(await visible('#shrink')) && await visible('#kit'), `${label}: picker and shrink hidden for MIDI, kit list back`);
    ok((await page.inputValue('#rate')) === 'track', `${label}: MIDI file: Per track is the default too`);
    ok(errors.length === 0, `${label}: no page errors ${errors.join(' | ')}`);
    await page.close();
  }
  await browser.close();
  console.log(fails ? `${fails} failed` : 'all passed');
  process.exit(fails ? 1 : 0);
})();
