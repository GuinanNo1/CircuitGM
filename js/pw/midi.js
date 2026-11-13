// PatchWorker's link to a Circuit Tracks over Web MIDI (Chrome, Edge, Opera; Firefox with its
// site permission add-on). Everything here follows the Circuit Tracks Programmer's Reference
// Guide v3: patches travel as SysEx, single parameters as CC or NRPN on the synth's channel.
import { P, toSyx, parseSyx, SYX_HEAD, PRODUCT_TRACKS } from './params.js?v=20261114l';

// Views on the Tracks whose message carries the selected track (not Mixer 0C, FX 0D, Patterns 0B).
export const TRACK_VIEWS = new Set([0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a]);
// The TRACKS panel view for each view code the Tracks sends.
export const VIEW_CODES = { 0x02: 'preset', 0x03: 'note', 0x08: 'note', 0x04: 'velocity', 0x05: 'gate', 0x0a: 'micro', 0x06: 'pattern', 0x07: 'probability', 0x0b: 'patterns', 0x0c: 'mixer', 0x0d: 'fx', 0x09: 'sidechain', 0x0e: 'scales', 0x0f: 'tempo', 0x10: 'projects', 0x11: 'projects' };   // 11 Packs: no panel view of its own
export const SYX_GAP = 20;           // ms between SysEx messages (Programmer's Reference)
export const SYX_STORE_GAP = 500;    // ms after a Store before the next SysEx

const isTracks = (port) => /circuit tracks/i.test(port.name ?? '');

export class TracksLink extends EventTarget {
  constructor() {
    super();
    this.access = null;
    this.out = null;
    this.in = null;
    this.error = null;
    this.onPatch = null;      // (bytes, synth) when the Tracks sends a patch
    this.onMacro = null;      // (knob, value, synth) when a macro knob is turned on the Tracks
    this.onNote = null;       // (on, note, velocity) from any other MIDI keyboard
    this.onTrack = null;      // (track) when a track is selected on the Tracks: 0-1 synths, 2-3 MIDI, 4-7 drums
    this.onView = null;       // (view code, track) when the Tracks changes view (see VIEW_CODES)
    this.onFocus = null;      // (synth) when the Tracks shows Synth 1 or 2 is in use (its pads or macros)
    this.log = null;          // an array to record what the Tracks sends (?midilog), or null
    this.onLog = null;
    this.onProgram = null;
    this.playing = false;     // the Tracks' transport, from its Start / Stop (Clock Tx on)
    this.lastNote = [-1e9, -1e9];    // (synth, slot) when Synth 1 or 2 changes patch on the Tracks (needs PGM Tx on)
    this.waiting = null;
  }

  get supported() { return typeof navigator !== 'undefined' && !!navigator.requestMIDIAccess; }
  get connected() { return !!this.out; }

  async connect() {
    if (!this.supported) { this.error = 'This browser has no Web MIDI. Use Chrome or Edge to link a Circuit Tracks.'; this.emit(); return false; }
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: true });
    } catch (e) {
      this.error = 'MIDI access was not allowed. Allow MIDI (with SysEx) for this page and try again.';
      this.emit();
      return false;
    }
    this.error = null;
    this.off = false;
    this.access.onstatechange = () => this.scan();
    this.scan();
    return this.connected;
  }

  // Stop using the Tracks: no more messages either way until connect() is called again.
  disconnect() {
    if (this.access) {
      this.access.onstatechange = null;
      for (const port of this.access.inputs.values()) port.onmidimessage = null;
    }
    this.out = null;
    this.in = null;
    this.waiting = null;
    this.off = true;
    this.emit();
  }

  scan() {
    const outs = [...this.access.outputs.values()].filter((p) => p.state === 'connected');
    const ins = [...this.access.inputs.values()].filter((p) => p.state === 'connected');
    this.out = outs.find(isTracks) ?? null;
    this.in = ins.find(isTracks) ?? null;
    this.ports = { outs: outs.map((p) => p.name), ins: ins.map((p) => p.name) };
    for (const port of ins) port.onmidimessage = (ev) => this.receive(port, ev.data);
    this.emit();
  }

  emit() { this.dispatchEvent(new Event('change')); }

  // SysEx goes out spaced: the Programmer's Reference asks for at least 20 ms between messages and
  // ignores one that arrives while the Tracks is busy. A Store (Replace Patch, writing flash) gets
  // SYX_STORE_GAP ms to itself: a patch request 2 ms after one made the Tracks drop the Store
  // (hardware, 2026-11-14). Other messages go straight out, as before.
  send(bytes) {
    if (!this.out) return this.sendNow(bytes);
    if (this.held) { this.held.push(Uint8Array.from(bytes)); return true; }   // a Store is under way
    const now = performance.now();
    const sysex = bytes[0] === 0xf0;
    const store = sysex && bytes[5] === PRODUCT_TRACKS && bytes[6] === 0x01 && bytes.length >= 350;   // a Store (either layout)
    // Nothing at all goes out while a Store is being written; SysEx also keeps its 20 ms spacing.
    let at = Math.max(now, this.storeUntil ?? 0);
    if (sysex) at = Math.max(at, this.sysexFree ?? 0);
    if (sysex) this.sysexFree = at + SYX_GAP;
    if (store) this.storeUntil = this.sysexFree = at + SYX_STORE_GAP;
    if (at <= now) return this.sendNow(bytes);
    const copy = Uint8Array.from(bytes);
    setTimeout(() => this.sendNow(copy), at - now);
    return true;
  }
  sendNow(bytes) {
    let ok = false;
    if (this.out) { try { this.out.send(bytes); ok = true; } catch { ok = false; } }
    if (this.log) this.record([...bytes], ok ? 'out' : 'fail');
    return ok;
  }
  // ?midilog: keep the last 400 messages either way (clock and active sensing left out).
  record(d, dir) {
    this.log.push({ t: performance.now(), d, dir });
    if (this.log.length > 400) this.log.shift();
    this.onLog?.();
  }

  // --- to the Tracks
  sendPatch(bytes, synth) { return this.send(toSyx(bytes, { command: 0, location: synth })); }
  // --- Components' file protocol (F0 00 20 29 01 64 03 <sub> …), from namirsab/circuit-tracks-tools
  // (MIT) and our own hardware logs (2026-11-14). Read-only use so far.
  fileMsg(sub, payload = []) { return [...SYX_HEAD, PRODUCT_TRACKS, 0x03, sub, ...payload, 0xf7]; }

  // Run fn() inside a file session (open, directory handshake … close). Other messages are held
  // until it ends. The handshake's 03 0B 02 makes the Tracks list its packs: returned as names.
  // after(): run once the session is closed, before held messages go out (used by writeSlot).
  async fileSession(fn, after = null) {
    if (!this.out || !this.in) throw new Error('The Circuit Tracks is not connected in both directions.');
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const free = Math.max(this.storeUntil ?? 0, this.sysexFree ?? 0) - performance.now();
    if (free > 0) await wait(free);
    this.held = [];
    const packs = [];
    let ran = false;
    this.fileWaiter = (d) => {
      if (d[7] === 0x0c) packs[d[9]] = String.fromCharCode(...d.slice(10, -1));   // 03 0C 02 <n> <name>
    };
    try {
      for (const [msg, ms] of [[this.fileMsg(0x40), 300], [this.fileMsg(0x0b, [0x01]), 100], [this.fileMsg(0x09, [0x01, 0x00]), 100], [this.fileMsg(0x0b, [0x02]), 300]]) {
        this.sendNow(msg);
        await wait(ms);
      }
      const result = await fn(packs);
      ran = true;
      return result;
    } finally {
      this.fileWaiter = null;
      this.sendNow(this.fileMsg(0x41));
      await wait(300);
      if (ran && after) after();
      const held = this.held;
      this.held = null;
      for (const msg of held) this.send(msg);
    }
  }

  // Read file <type>/<entry> (inside fileSession). Resolves { size, data, crcOk } or null if the
  // Tracks says there is no such file (03 06 <type> 00 <entry>).
  // entry is 14-bit (file ID = <type> <entry >> 7> <entry & 7F>, as namirsab builds it).
  readFile(type, entry, timeout = 4000) {
    const hi = (entry >> 7) & 0x7f, lo = entry & 0x7f;
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = null;
      const timer = setTimeout(() => { this.fileWaiter = null; reject(new Error(`No answer for file ${type}/${entry}.`)); }, timeout);
      const done = (v) => { clearTimeout(timer); this.fileWaiter = null; resolve(v); };
      this.fileWaiter = (d) => {
        const sub = d[7];
        if (sub === 0x06 && d[8] === type && d[9] === hi && d[10] === lo) return done(null);
        if (d[16] !== type || d[17] !== hi || d[18] !== lo) return;    // fid after sub + 8 address bytes
        if (sub === 0x01) size = nibbles(d.slice(23, 28));             // 4 flag bytes, 5 size nibbles
        else if (sub === 0x02) chunks.push(unpack(d.slice(19, -1)));
        else if (sub === 0x03) {
          const all = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
          let at = 0;
          for (const c of chunks) { all.set(c, at); at += c.length; }
          const data = all.subarray(0, size ?? all.length);
          done({ size, data, crcOk: crc32(data) === nibbles(d.slice(19, 27)) });
        }
      };
      this.sendNow(this.fileMsg(0x01, [0, 0, 0, 0, 0, 0, 0, 0, type, hi, lo, 0x02]));
    });
  }

  // Store a patch in slot 0-127 of pack 0-31 on the Tracks' SD card (packs in the order the Tracks
  // lists them in a file session). The Programmer's Reference's Replace Patch (01 <slot> 00) is
  // ignored by the Tracks. Components' form, from namirsab/circuit-tracks-tools (MIT): a file session
  // first, then 01 <pack> 00 <slot> 00 + the patch (352 bytes). namirsab sent 00 in the pack byte,
  // which on 2026-11-14 wrote into pack 0 ("00_BetterOffAlone"), proving that byte is the pack.
  // Inside the session the pack's patch file (04/<pack>) is read, as Components browses it.
  // Nothing else goes to the Tracks until it is done. Resolves true if everything was sent.
  async writeSlot(bytes, pack, slot) {
    if (!(pack >= 0 && pack < 32)) throw new Error('No pack chosen.');
    let ok = false;
    await this.fileSession(async () => { await this.readFile(0x04, pack, 1500).catch(() => null); }, () => {
      const store = new Uint8Array(352);
      store.set([...SYX_HEAD, PRODUCT_TRACKS, 0x01, pack & 0x7f, 0x00, slot & 0x7f, 0x00]);
      store.set(bytes.subarray(0, 340), 11);
      store[351] = 0xf7;
      this.storeUntil = this.sysexFree = 0;
      ok = this.sendNow(store);
      this.storeUntil = this.sysexFree = performance.now() + SYX_STORE_GAP;   // held messages wait
    });
    return ok;
  }
  // Program Change on a synth's channel: the Tracks loads its own patch from that slot (needs PGM Rx on).
  program(synth, slot) { return this.send([0xc0 | synth, slot & 0x7f]); }
  noteOn(synth, note, velocity) { return this.send([0x90 | synth, note & 0x7f, velocity & 0x7f]); }
  noteOff(synth, note) { return this.send([0x80 | synth, note & 0x7f, 0]); }
  allNotesOff(synth) { return this.send([0xb0 | synth, 123, 0]); }
  cc(synth, num, value) { return this.send([0xb0 | synth, num, value & 0x7f]); }
  nrpn(synth, msb, lsb, value) {
    const s = 0xb0 | synth;
    return this.send([s, 99, msb, s, 98, lsb, s, 6, value & 0x7f]);
  }
  macro(synth, knob, value) { return this.cc(synth, 80 + knob, value); }

  // One edited parameter. Returns false when the parameter has no CC / NRPN of its own (mod
  // matrix, macro assignments, LFO switches, name): the caller then sends the whole patch.
  sendParam(synth, id, value) {
    const p = P[id];
    if (!p) return false;
    if (p.cc != null) return this.cc(synth, p.cc, value);
    if (p.nrpn) return this.nrpn(synth, p.nrpn[0], p.nrpn[1], value);
    return false;
  }

  // Ask the Tracks for the patch currently in Synth 1 or 2; resolves with its 340 bytes.
  requestPatch(synth, timeout = 3000) {
    if (!this.out || !this.in) return Promise.reject(new Error('The Circuit Tracks is not connected in both directions.'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.waiting = null; reject(new Error('The Circuit Tracks did not answer.')); }, timeout);
      this.waiting = { synth, resolve: (b) => { clearTimeout(timer); this.waiting = null; resolve(b); } };
      this.send([...SYX_HEAD, PRODUCT_TRACKS, 0x40, synth, 0x00, 0xf7]);
    });
  }

  // --- from the Tracks and other MIDI devices
  receive(port, data) {
    if (!data || !data.length) return;
    const fromTracks = isTracks(port);
    if (fromTracks && this.log && !(data[0] === 0xf8 || data[0] === 0xfe)) this.record([...data], 'in');
    if (data[0] === 0xf0) {
      if (!fromTracks) return;
      // View changed on the Tracks (seen 2026-11-13/14, not in the Programmer's Reference):
      // F0 00 20 29 01 64 04 <view> <track> 00 F7. Track 0-1 Synth 1-2, 2-3 MIDI 1-2, 4-7 Drum 1-4
      // (always 00 for Mixer, FX, Patterns, Scales, Tempo, Projects, Packs). Views: 02 Preset, 03 Note, 08 Expanded Note,
      // 04 Velocity, 05 Gate, 0A Micro Step, 06 Pattern Settings, 07 Probability, 0B Patterns,
      // 0C Mixer, 0D FX, 09 Sidechain, 0E Scales, 0F Tempo, 10 Projects, 11 Packs. A track button
      // sends its track's view (Note: 03). Shift sends 08 01 / 08 00 (pressed / released); scenes
      // (saving, selecting, chaining) send nothing.
      if (data.length === 11 && data[1] === 0x00 && data[2] === 0x20 && data[3] === 0x29 && data[4] === 0x01 && data[5] === PRODUCT_TRACKS && data[6] === 0x04) {
        const view = data[7], track = data[8];
        this.onView?.(view, track);
        if (TRACK_VIEWS.has(view)) this.onTrack?.(track);
        return;
      }
      // File-protocol replies (03 ...) go to readFile() while it waits for them.
      if (data[6] === 0x03 && data[5] === PRODUCT_TRACKS) { this.fileWaiter?.(data); return; }
      const patches = parseSyx(data);
      if (!patches.length) return;
      const { data: bytes, location } = patches[0];
      if (this.waiting) this.waiting.resolve(bytes);
      else this.onPatch?.(bytes, location & 1);
      return;
    }
    const status = data[0] & 0xf0;
    const ch = data[0] & 0x0f;
    if (fromTracks && (data[0] === 0xfa || data[0] === 0xfb)) { this.playing = true; return; }
    if (fromTracks && data[0] === 0xfc) { this.playing = false; return; }
    // Played on the Tracks' own pads or knobs, not by its sequencer: the transport isn't running
    // and the other synth has been quiet for 2 s.
    const byHand = (c) => !this.playing && performance.now() - this.lastNote[1 - c] > 2000;
    if (fromTracks) {
      if (status === 0xb0 && ch <= 1 && data[1] >= 80 && data[1] <= 87) { if (byHand(ch)) this.onFocus?.(ch); this.onMacro?.(data[1] - 80, data[2], ch); }
      else if (status === 0xc0 && ch <= 1) this.onProgram?.(ch, data[1]);
      else if (status === 0x90 && ch <= 1 && data[2] > 0) {   // a note on Synth 1 or 2
        const hand = byHand(ch);
        this.lastNote[ch] = performance.now();
        if (hand) this.onFocus?.(ch);
      }
      return;                                   // the Tracks plays its own pads: don't echo them
    }
    if (status === 0x90 && data[2] > 0) this.onNote?.(true, data[1], data[2]);
    else if (status === 0x80 || status === 0x90) this.onNote?.(false, data[1], 0);
  }
}

// MSB interleave (7-bit SysEx <-> bytes): a header byte holding the top bits of the next 7 bytes.
export function unpack(enc) {
  const out = [];
  for (let i = 0; i < enc.length; i += 8) {
    const hi = enc[i];
    for (let j = 0; j < 7 && i + 1 + j < enc.length; j++) out.push(enc[i + 1 + j] | (((hi >> j) & 1) << 7));
  }
  return Uint8Array.from(out);
}
const nibbles = (a) => [...a].reduce((v, n) => (v * 16) + (n & 15), 0);
let crcTable = null;
export function crc32(bytes) {
  if (!crcTable) crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
