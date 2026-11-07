// Standard MIDI File (type 1) writer for Circuit2MIDI.
// song: { ppq, tempo (BPM), name, markers: [{ tick, text }],
//         tracks: [{ name, ch (1-16), program (0-127 or null), events: [{ tick, dur, note, vel }] }] }

export function writeSMF(song) {
  const chunks = [conductor(song), ...song.tracks.map((t) => noteTrack(t))];
  const header = [...ascii('MThd'), ...u32(6), ...u16(1), ...u16(chunks.length), ...u16(song.ppq)];
  const parts = [new Uint8Array(header)];
  for (const c of chunks) parts.push(new Uint8Array([...ascii('MTrk'), ...u32(c.length)]), c);
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

function conductor(song) {
  const ev = [];
  ev.push({ tick: 0, order: 0, bytes: meta(0x03, ascii(song.name || 'Circuit2MIDI')) });
  const usPerQ = Math.round(60000000 / song.tempo);
  ev.push({ tick: 0, order: 1, bytes: meta(0x51, [(usPerQ >> 16) & 255, (usPerQ >> 8) & 255, usPerQ & 255]) });
  ev.push({ tick: 0, order: 2, bytes: meta(0x58, [4, 2, 24, 8]) });
  for (const m of song.markers ?? []) ev.push({ tick: m.tick, order: 3, bytes: meta(0x06, ascii(m.text)) });
  return encode(ev, song.end ?? 0);
}

function noteTrack(t) {
  const ch = (t.ch - 1) & 15;
  const ev = [{ tick: 0, order: 0, bytes: meta(0x03, ascii(t.name)) }];
  if (t.program != null) ev.push({ tick: 0, order: 1, bytes: [0xc0 | ch, t.program & 127] });
  // One note at a time per pitch: a new note-on ends the one before it.
  const sorted = [...t.events].sort((a, b) => a.tick - b.tick || a.note - b.note);
  const lastOff = new Map();
  for (const e of sorted) {
    const prev = lastOff.get(e.note);
    if (prev && prev.tick > e.tick) prev.tick = e.tick;
    ev.push({ tick: e.tick, order: 3, bytes: [0x90 | ch, e.note & 127, Math.max(1, e.vel & 127)] });
    const off = { tick: e.tick + Math.max(1, e.dur), order: 2, bytes: [0x80 | ch, e.note & 127, 0] };
    ev.push(off);
    lastOff.set(e.note, off);
  }
  return encode(ev, 0);
}

// Note-offs sort before note-ons at the same tick (order 2 < 3).
function encode(events, end) {
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const out = [];
  let now = 0;
  for (const e of events) {
    out.push(...vlq(e.tick - now), ...e.bytes);
    now = e.tick;
  }
  out.push(...vlq(Math.max(0, end - now)), 0xff, 0x2f, 0x00);
  return new Uint8Array(out);
}

const meta = (type, data) => [0xff, type, ...vlq(data.length), ...data];
const ascii = (s) => Array.from(String(s).normalize('NFKD').replace(/[^\x20-\x7e]/g, '').slice(0, 120), (c) => c.charCodeAt(0));
const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = (n) => [(n >> 8) & 255, n & 255];
function vlq(n) {
  n = Math.max(0, Math.round(n));
  const bytes = [n & 0x7f];
  while ((n >>= 7)) bytes.unshift((n & 0x7f) | 0x80);
  return bytes;
}
