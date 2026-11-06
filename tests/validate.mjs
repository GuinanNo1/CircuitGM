// Checks .ncs files against the ranges Novation's Components validator enforces
// (as mapped in Ondrysak/ncstool decompiled_validators/FORMAT_MAP.md).
import { readFileSync } from 'node:fs';
import { parseNCS } from '../js/vendor/ncs.js';
export function validate(buf) {
  const d = new Uint8Array(buf), e = [];
  const ck = (ok, msg) => { if (!ok) e.push(msg); };
  ck(d.length === 160780, 'size');
  ck(String.fromCharCode(...d.slice(0, 4)) === 'USER', 'signature');
  ck(d[8] === 1, 'feature flags');
  ck(d[12] <= 13, 'colour');
  ck(d[0x34] >= 40 && d[0x34] <= 240, 'tempo');
  ck(d[0x37] === 0 && d[0x38] === 0 && d[0x3c] === 0, 'timing spare bytes');
  ck(d[0x26d0c] <= 11 && d[0x26d0d] <= 15, 'scale');
  ck(d[0x26d0e] <= 15 && d[0x26d0f] <= 7, 'fx presets');
  const p = parseNCS(buf.slice ? buf.slice(0) : buf);
  ck(p.sceneChain.start <= p.sceneChain.end && p.sceneChain.end <= 15, 'scene chain');
  for (const [si, s] of p.scenes.entries()) for (const c of s.trackChains) ck(c.start <= c.end && c.end <= 7, `scene ${si} chain`);
  for (const c of p.patternChains) ck(c.start <= c.end && c.end <= 7, 'pattern chain');
  p.patterns.forEach((pats, t) => pats.forEach((pat, i) => {
    const st = pat.settings;
    ck(st.playbackStart <= st.playbackEnd && st.playbackEnd <= 31 && st.syncRate <= 7 && st.direction <= 3, `t${t}p${i} settings`);
    pat.steps.forEach((s, k) => {
      if (pat.kind === 'drum') {
        ck((s.velocity > 0) === s.active && s.velocity <= 127 && s.probability <= 7, `t${t}p${i}s${k} drum`);
      } else {
        ck(s.mask <= 63 && s.probability <= 7, `t${t}p${i}s${k} mask`);
        s.notes.forEach((n, j) => {
          if (s.mask >> j & 1) ck(n.note >= 1 && n.note <= 139 && n.gate >= 1 && n.gate <= 224 && n.delay <= 5 && n.velocity <= 127, `t${t}p${i}s${k}n${j}`);
        });
      }
    });
  }));
  return e;
}
import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const f of process.argv.slice(2)) {
    const b = readFileSync(f);
    const errs = validate(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
    console.log(f.split('/').pop(), errs.length ? `${errs.length} problems: ${errs.slice(0, 5).join('; ')}` : 'OK');
  }
}
