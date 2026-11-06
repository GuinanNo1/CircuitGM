// Standard MIDI File (type 0 and 1) reader.
// Returns { ppq, tempo (BPM of the first tempo event), tempoChanges, timeSig, lengthTicks,
//           sources: [{ id, name, channel, program, notes: [{ tick, dur, note, vel }] }] }
// Every (track, channel) pair with notes becomes one source, so type-0 files and
// multi-channel tracks split into usable parts.

export const GM_NAMES = [
  'Acoustic Grand Piano', 'Bright Acoustic Piano', 'Electric Grand Piano', 'Honky-tonk Piano',
  'Electric Piano 1', 'Electric Piano 2', 'Harpsichord', 'Clavinet', 'Celesta', 'Glockenspiel',
  'Music Box', 'Vibraphone', 'Marimba', 'Xylophone', 'Tubular Bells', 'Dulcimer', 'Drawbar Organ',
  'Percussive Organ', 'Rock Organ', 'Church Organ', 'Reed Organ', 'Accordion', 'Harmonica',
  'Tango Accordion', 'Nylon Guitar', 'Steel Guitar', 'Jazz Guitar', 'Clean Guitar', 'Muted Guitar',
  'Overdriven Guitar', 'Distortion Guitar', 'Guitar Harmonics', 'Acoustic Bass', 'Finger Bass',
  'Pick Bass', 'Fretless Bass', 'Slap Bass 1', 'Slap Bass 2', 'Synth Bass 1', 'Synth Bass 2',
  'Violin', 'Viola', 'Cello', 'Contrabass', 'Tremolo Strings', 'Pizzicato Strings',
  'Orchestral Harp', 'Timpani', 'String Ensemble 1', 'String Ensemble 2', 'Synth Strings 1',
  'Synth Strings 2', 'Choir Aahs', 'Voice Oohs', 'Synth Voice', 'Orchestra Hit', 'Trumpet',
  'Trombone', 'Tuba', 'Muted Trumpet', 'French Horn', 'Brass Section', 'Synth Brass 1',
  'Synth Brass 2', 'Soprano Sax', 'Alto Sax', 'Tenor Sax', 'Baritone Sax', 'Oboe', 'English Horn',
  'Bassoon', 'Clarinet', 'Piccolo', 'Flute', 'Recorder', 'Pan Flute', 'Blown Bottle', 'Shakuhachi',
  'Whistle', 'Ocarina', 'Square Lead', 'Saw Lead', 'Calliope Lead', 'Chiff Lead', 'Charang Lead',
  'Voice Lead', 'Fifths Lead', 'Bass + Lead', 'New Age Pad', 'Warm Pad', 'Polysynth Pad',
  'Choir Pad', 'Bowed Pad', 'Metallic Pad', 'Halo Pad', 'Sweep Pad', 'Rain', 'Soundtrack',
  'Crystal', 'Atmosphere', 'Brightness', 'Goblins', 'Echoes', 'Sci-fi', 'Sitar', 'Banjo',
  'Shamisen', 'Koto', 'Kalimba', 'Bagpipe', 'Fiddle', 'Shanai', 'Tinkle Bell', 'Agogo',
  'Steel Drums', 'Woodblock', 'Taiko Drum', 'Melodic Tom', 'Synth Drum', 'Reverse Cymbal',
  'Guitar Fret Noise', 'Breath Noise', 'Seashore', 'Bird Tweet', 'Telephone Ring', 'Helicopter',
  'Applause', 'Gunshot',
];

export function parseMidi(buffer) {
  const d = new Uint8Array(buffer);
  let p = 0;
  const str = (n) => { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(d[p + i]); return s; };
  const u32 = () => { const v = (d[p] << 24 | d[p + 1] << 16 | d[p + 2] << 8 | d[p + 3]) >>> 0; p += 4; return v; };
  const u16 = () => { const v = d[p] << 8 | d[p + 1]; p += 2; return v; };

  // RIFF-wrapped MIDI (.rmi): skip to the MThd chunk.
  if (str(4) === 'RIFF') {
    const at = indexOf(d, [0x4d, 0x54, 0x68, 0x64]);
    if (at < 0) throw new Error('No MIDI data found in this RIFF file.');
    p = at;
  }
  if (str(4) !== 'MThd') throw new Error('This is not a standard MIDI file (no MThd header).');
  p += 4;
  const hdrLen = u32();
  const format = u16();
  const nTracks = u16();
  const division = u16();
  p += hdrLen - 6;
  if (division & 0x8000) throw new Error('SMPTE-timed MIDI files are not supported.');
  const ppq = division;

  const tempos = [];      // { tick, bpm }
  const timeSigs = [];    // { tick, num, den }
  const parts = new Map(); // key "track:channel" -> source
  const trackNames = [];
  let lengthTicks = 0;

  for (let t = 0; t < nTracks && p < d.length; t++) {
    // Skip unknown chunks until the next MTrk.
    while (p + 8 <= d.length && str(4) !== 'MTrk') { p += 4; p += u32(); }
    if (p + 8 > d.length) break;
    p += 4;
    const len = u32();
    const end = Math.min(d.length, p + len);
    let tick = 0;
    let status = 0;
    let trackName = '';
    const program = new Array(16).fill(-1);
    const bankMsb = new Array(16).fill(0);
    const open = new Map(); // "ch:note" -> [ {tick, vel, src} ]

    const source = (ch) => {
      const key = `${t}:${ch}`;
      if (!parts.has(key)) {
        parts.set(key, { track: t, channel: ch, program: -1, bank: 0, notes: [], name: '' });
      }
      return parts.get(key);
    };

    while (p < end) {
      // variable-length delta
      let delta = 0;
      for (let i = 0; i < 4; i++) { const b = d[p++]; delta = (delta << 7) | (b & 0x7f); if (!(b & 0x80)) break; }
      tick += delta;
      let b = d[p];
      if (b & 0x80) { status = b; p++; } else if (!status) { p++; continue; }

      if (status === 0xff) {
        const type = d[p++];
        let mlen = 0;
        for (let i = 0; i < 4; i++) { const c = d[p++]; mlen = (mlen << 7) | (c & 0x7f); if (!(c & 0x80)) break; }
        const data = d.subarray(p, p + mlen);
        p += mlen;
        if (type === 0x51 && mlen === 3) tempos.push({ tick, bpm: 60000000 / (data[0] << 16 | data[1] << 8 | data[2]) });
        else if (type === 0x58 && mlen >= 2) timeSigs.push({ tick, num: data[0], den: 2 ** data[1] });
        else if (type === 0x03 && !trackName) trackName = decodeText(data);
        else if (type === 0x2f) break;
        status = 0;
        continue;
      }
      if (status === 0xf0 || status === 0xf7) {
        let slen = 0;
        for (let i = 0; i < 4; i++) { const c = d[p++]; slen = (slen << 7) | (c & 0x7f); if (!(c & 0x80)) break; }
        p += slen;
        status = 0;
        continue;
      }
      const kind = status & 0xf0;
      const ch = status & 0x0f;
      const a = d[p++];
      const twoBytes = kind !== 0xc0 && kind !== 0xd0;
      const v = twoBytes ? d[p++] : 0;
      if (kind === 0x90 && v > 0) {
        const s = source(ch);
        if (s.program < 0) { s.program = Math.max(0, program[ch]); s.bank = bankMsb[ch]; }
        const k = `${ch}:${a}`;
        if (!open.has(k)) open.set(k, []);
        open.get(k).push({ tick, vel: v, src: s });
      } else if (kind === 0x80 || (kind === 0x90 && v === 0)) {
        const k = `${ch}:${a}`;
        const stack = open.get(k);
        if (stack?.length) {
          const on = stack.shift();
          on.src.notes.push({ tick: on.tick, dur: Math.max(1, tick - on.tick), note: a, vel: on.vel });
          lengthTicks = Math.max(lengthTicks, tick);
        }
      } else if (kind === 0xc0) {
        program[ch] = a;
      } else if (kind === 0xb0 && a === 0) {
        bankMsb[ch] = v;
      }
    }
    // Notes still held at the end of the track: end them there.
    for (const [k, stack] of open) {
      const note = Number(k.split(':')[1]);
      for (const on of stack) on.src.notes.push({ tick: on.tick, dur: Math.max(1, tick - on.tick), note, vel: on.vel });
    }
    trackNames[t] = trackName;
    lengthTicks = Math.max(lengthTicks, tick);
    p = end;
  }

  tempos.sort((x, y) => x.tick - y.tick);
  timeSigs.sort((x, y) => x.tick - y.tick);

  const sources = [];
  for (const s of parts.values()) {
    if (!s.notes.length) continue;
    s.notes.sort((x, y) => x.tick - y.tick || x.note - y.note);
    const isDrum = s.channel === 9;
    const tn = trackNames[s.track];
    const inst = isDrum ? 'Drums' : GM_NAMES[s.program] ?? 'Unknown';
    s.name = tn ? tn : inst;
    s.instrument = inst;
    s.isDrum = isDrum;
    s.id = `t${s.track}c${s.channel}`;
    let lo = 127, hi = 0;
    for (const n of s.notes) { lo = Math.min(lo, n.note); hi = Math.max(hi, n.note); }
    s.range = [lo, hi];
    sources.push(s);
  }
  sources.sort((x, y) => x.track - y.track || x.channel - y.channel);
  sources.forEach((s, i) => { s.index = i + 1; });

  return {
    format,
    ppq,
    tempo: tempos.length ? tempos[0].bpm : 120,
    tempoChanges: tempos.filter((t, i) => i > 0 && Math.abs(t.bpm - tempos[i - 1].bpm) > 0.5).length,
    timeSig: timeSigs.length ? { num: timeSigs[0].num, den: timeSigs[0].den } : { num: 4, den: 4 },
    timeSigChanges: timeSigs.filter((s, i) => i > 0 && (s.num !== timeSigs[i - 1].num || s.den !== timeSigs[i - 1].den)).length,
    lengthTicks,
    sources,
  };
}

function decodeText(bytes) {
  let s = '';
  for (const b of bytes) s += b >= 32 && b < 127 ? String.fromCharCode(b) : ' ';
  return s.replace(/\s+/g, ' ').trim();
}

function indexOf(d, seq) {
  outer: for (let i = 0; i + seq.length <= d.length; i++) {
    for (let j = 0; j < seq.length; j++) if (d[i + j] !== seq[j]) continue outer;
    return i;
  }
  return -1;
}

export function noteName(n) {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  return `${names[n % 12]}${Math.floor(n / 12) - 1}`;
}
