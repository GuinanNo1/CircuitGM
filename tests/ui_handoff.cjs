// Browser test: pack hand-offs between pages. Circuit2MIDI 'Convert to Circuit Tracks' (Rhythm) /
// 'Rebuild in MIDI2Circuit' (Tracks, Advanced only) to MIDI2Circuit, and 'Trim ... in PackTrim'
// from Circuit2MIDI and MIDI2Circuit to PackTrim (with Keep: only project N).
// Needs `python3 -m http.server 8765` in the repo root and Playwright (Chrome).
// node tests/ui_handoff.cjs <two-project tracks pack> <rhythm pack>   (tests/compact_only.mjs "<dir>/Two projects.circuittrackspack" writes the first; tests/pack2pack.mjs <dir> the second)
const { chromium } = require('playwright');
const fs = require('fs'); const os = require('os'); const path = require('path');
let fails = 0; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails++; };
(async () => { const b = await chromium.launch({ channel: 'chrome' }); const p = await b.newPage({ viewport: { width: 1280, height: 900 } }); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.addInitScript(() => { try { localStorage.setItem('circuitgm-advanced-m2c', '1'); localStorage.setItem('circuitgm-advanced-c2m', '1'); localStorage.setItem('circuitgm-advanced-packtrim', '1'); } catch {} });   // these tests drive every control: Advanced mode
// 1. Tracks pack with two projects: pick project 2
await p.goto('http://localhost:8765/circuit2midi/'); await p.setInputFiles('#file', process.argv[2]);
await p.waitForSelector('.proj'); ok(await p.isDisabled('#to-tracks'), 'button off until a project is chosen');
ok((await p.textContent('#to-tracks')) === 'Rebuild in MIDI2Circuit' && await p.$eval('#to-tracks-box', (e) => e.classList.contains('adv')), 'Tracks pack: "Rebuild in MIDI2Circuit", Advanced only');
await p.click('.proj[data-slot="1"]'); ok(!(await p.isDisabled('#to-tracks')), 'button on after choosing project 2');
await Promise.all([p.waitForURL(/localhost:8765\/midi2circuit\/(\?.*)?$/), p.click('#to-tracks')]);
await p.waitForFunction(() => /Circuit Tracks/.test(document.querySelector('#fileinfo')?.textContent || ''), null, { timeout: 30000 });
ok(p.url() === 'http://localhost:8765/midi2circuit/', `address cleaned (${p.url()})`);
ok((await p.inputValue('#project')) === '1', 'MIDI2Circuit opened on project 2');
ok(/Second/.test(await p.textContent('#fileinfo')) && (await p.textContent('#base-name')) === 'Two projects', `project and base pack from the hand-off (${await p.textContent('#base-name')})`);
ok(await p.evaluate(() => !!window.tracksgm.state.plan), 'arranged');
// 2. Rhythm pack, single project
await p.goto('http://localhost:8765/circuit2midi/'); await p.setInputFiles('#file', process.argv[3]);
await p.waitForSelector('#step-scenes:not([hidden])', { timeout: 30000 });
ok((await p.textContent('#to-tracks')) === 'Convert to Circuit Tracks (MIDI2Circuit)' && await p.$eval('#to-tracks-box', (e) => !e.classList.contains('adv')), 'Rhythm pack: "Convert to Circuit Tracks", in both modes');
await Promise.all([p.waitForURL(/localhost:8765\/midi2circuit\/(\?.*)?$/), p.click('#to-tracks')]);
await p.waitForFunction(() => /will hold/.test(document.querySelector('#shrink-info')?.textContent || ''), null, { timeout: 60000 });
ok(/Circuit Rhythm/.test(await p.textContent('#fileinfo')) && (await p.textContent('#base-name')) === 'TracksGM_v1', 'Rhythm pack arrives, base pack stays TracksGM');
console.log('   ', (await p.textContent('#summary')).replace(/\s+/g, ' '));
// 2b. MIDI2Circuit -> PackTrim with the loaded Rhythm pack
await Promise.all([p.waitForURL(/localhost:8765\/packtrim\/(\?.*)?$/), p.click('#to-packtrim')]);
await p.waitForSelector('#step-save:not([hidden])', { timeout: 30000 });
ok(p.url() === 'http://localhost:8765/packtrim/' && /Circuit Rhythm/.test(await p.textContent('#packinfo')), 'MIDI2Circuit hands the loaded pack to PackTrim');
// 2c. Circuit2MIDI -> PackTrim, then Keep: only project 2
await p.goto('http://localhost:8765/circuit2midi/'); await p.setInputFiles('#file', process.argv[2]);
await p.waitForSelector('.proj');
await Promise.all([p.waitForURL(/localhost:8765\/packtrim\/(\?.*)?$/), p.click('#to-packtrim')]);
await p.waitForSelector('#step-save:not([hidden])', { timeout: 30000 });
ok(/Two/.test(await p.textContent('#packinfo')) && (await p.$$('#projects tbody tr')).length === 2, 'Circuit2MIDI hands the pack to PackTrim');
ok((await p.$$('#keep option')).length === 3 && (await p.inputValue('#keep')) === 'all', 'Keep: Every project, or one of the two projects');
const before = await p.textContent('#summary');
await p.selectOption('#keep', '1');
ok((await p.$$('#projects tr.gone')).length === 1 && /Only project 2 is kept/.test(await p.textContent('#projects-hint')), 'Only project 2: project 1 shown as emptied');
ok((await p.textContent('#summary')) !== before, `summary follows the Keep choice (${(await p.textContent('#summary')).replace(/\s+/g, ' ')})`);
const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#save')]);
const out = path.join(os.tmpdir(), dl.suggestedFilename()); await dl.saveAs(out);
const { loadPack } = await import('../js/pack.js');
const b2 = fs.readFileSync(out); const tp = await loadPack(b2.buffer.slice(b2.byteOffset, b2.byteOffset + b2.length), out);
ok(tp.projects.filter((e) => !e.empty).map((e) => e.slot).join() === '1', 'saved pack keeps only project 2');
// 3. Nothing waiting
await p.goto('http://localhost:8765/midi2circuit/?from=circuit2midi');
await p.waitForFunction(() => /could not be found/.test(document.querySelector('#fileinfo')?.textContent || ''), null, { timeout: 20000 });
ok(true, 'no waiting pack: says so');
await p.goto('http://localhost:8765/packtrim/?from=circuit2midi');
await p.waitForFunction(() => /could not be found/.test(document.querySelector('#load-status')?.textContent || ''), null, { timeout: 20000 });
ok(true, 'PackTrim, no waiting pack: says so');
ok(errs.length === 0, `no page errors ${errs.join(' | ')}`);
await b.close(); console.log(fails ? `${fails} failed` : 'all passed'); process.exit(fails ? 1 : 0); })();
