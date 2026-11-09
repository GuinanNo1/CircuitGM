// Browser test: Circuit2MIDI 'Convert to Circuit Tracks' hands a pack to MIDI2Circuit.
// Needs `python3 -m http.server 8765` in the repo root and Playwright (Chrome).
// node tests/ui_handoff.cjs <two-project tracks pack> <rhythm pack>   (tests/compact_only.mjs <path> writes the first)
const { chromium } = require('playwright');
let fails = 0; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails++; };
(async () => { const b = await chromium.launch({ channel: 'chrome' }); const p = await b.newPage({ viewport: { width: 1280, height: 900 } }); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
// 1. Tracks pack with two projects: pick project 2
await p.goto('http://localhost:8765/circuit2midi/'); await p.setInputFiles('#file', process.argv[2]);
await p.waitForSelector('.proj'); ok(await p.isDisabled('#to-tracks'), 'button off until a project is chosen');
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
await Promise.all([p.waitForURL(/localhost:8765\/midi2circuit\/(\?.*)?$/), p.click('#to-tracks')]);
await p.waitForFunction(() => /will hold/.test(document.querySelector('#shrink-info')?.textContent || ''), null, { timeout: 60000 });
ok(/Circuit Rhythm/.test(await p.textContent('#fileinfo')) && (await p.textContent('#base-name')) === 'TracksGM_final', 'Rhythm pack arrives, base pack stays TracksGM');
console.log('   ', (await p.textContent('#summary')).replace(/\s+/g, ' '));
// 3. Nothing waiting
await p.goto('http://localhost:8765/midi2circuit/?from=circuit2midi');
await p.waitForFunction(() => /could not be found/.test(document.querySelector('#fileinfo')?.textContent || ''), null, { timeout: 20000 });
ok(true, 'no waiting pack: says so');
ok(errs.length === 0, `no page errors ${errs.join(' | ')}`);
await b.close(); console.log(fails ? `${fails} failed` : 'all passed'); process.exit(fails ? 1 : 0); })();
