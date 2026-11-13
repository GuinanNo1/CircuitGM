// PatchWorker's link to a Circuit Tracks over Web MIDI (Chrome, Edge, Opera; Firefox with its
// site permission add-on). Everything here follows the Circuit Tracks Programmer's Reference
// Guide v3: patches travel as SysEx, single parameters as CC or NRPN on the synth's channel.
import { P, toSyx, parseSyx, SYX_HEAD, PRODUCT_TRACKS } from './params.js?v=20261113d';

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
    if (data[0] === 0xf0) {
      if (!fromTracks) return;
      const patches = parseSyx(data);
      if (!patches.length) return;
      const { data: bytes, location } = patches[0];
      if (this.waiting) this.waiting.resolve(bytes);
      else this.onPatch?.(bytes, location & 1);
      return;
    }
    const status = data[0] & 0xf0;
    const ch = data[0] & 0x0f;
    if (fromTracks) {
      if (status === 0xb0 && ch <= 1 && data[1] >= 80 && data[1] <= 87) this.onMacro?.(data[1] - 80, data[2], ch);
      return;                                   // the Tracks plays its own pads: don't echo them
    }
    if (status === 0x90 && data[2] > 0) this.onNote?.(true, data[1], data[2]);
    else if (status === 0x80 || status === 0x90) this.onNote?.(false, data[1], 0);
  }
}
