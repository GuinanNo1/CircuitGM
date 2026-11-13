// PatchWorker's link to a Circuit Tracks over Web MIDI (Chrome, Edge, Opera; Firefox with its
// site permission add-on). Everything here follows the Circuit Tracks Programmer's Reference
// Guide v3: patches travel as SysEx, single parameters as CC or NRPN on the synth's channel.
import { P, toSyx, parseSyx, SYX_HEAD, PRODUCT_TRACKS } from './params.js?v=20261113n';

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
    this.access.onstatechange = () => this.scan();
    this.scan();
    return this.connected;
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

  send(bytes) {
    if (!this.out) return false;
    try { this.out.send(bytes); return true; } catch { return false; }
  }

  // --- to the Tracks
  sendPatch(bytes, synth) { return this.send(toSyx(bytes, { command: 0, location: synth })); }
  writeSlot(bytes, slot) { return this.send(toSyx(bytes, { command: 1, location: slot })); }
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
    if (fromTracks && this.log && !(data[0] === 0xf8 || data[0] === 0xfe)) {
      this.log.push({ t: performance.now(), d: [...data] });
      if (this.log.length > 400) this.log.shift();
      this.onLog?.();
    }
    if (data[0] === 0xf0) {
      if (!fromTracks) return;
      // Track selected on the Tracks (seen 2026-11-13, not in the Programmer's Reference):
      // F0 00 20 29 01 64 04 03 <track> 00 F7: 0 Synth 1, 1 Synth 2, 2-3 MIDI 1-2, 4-7 Drum 1-4.
      if (data.length === 11 && data[1] === 0x00 && data[2] === 0x20 && data[3] === 0x29 && data[4] === 0x01 && data[5] === PRODUCT_TRACKS && data[6] === 0x04 && data[7] === 0x03) {
        this.onTrack?.(data[8]);
        return;
      }
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
