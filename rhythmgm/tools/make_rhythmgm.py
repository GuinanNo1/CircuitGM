"""Build RhythmGM, the General MIDI sample pack for the Novation Circuit Rhythm.

    python3 rhythmgm/tools/make_rhythmgm.py /path/to/GeneralUser-GS.sf2      (from the repo root)

Layout (128 sample slots, 228.1 s limit):
  slots   1-64   the 64 TracksGM drum hits, unchanged (tracksgm/drums), same kit order:
                 Std, Room, Power, Elec, 808, Jazz, Brush, Orch; each kit runs kick, snare,
                 rim/clap, closed hat, open hat, tom, cymbal, percussion.
  slots  65-128  64 pitched General MIDI instruments, 4 from each of the 16 GM families,
                 in GM order, rendered from GeneralUser GS (bank 0) as one note each.

Each instrument note is played through libfluidsynth (the synth GeneralUser GS is voiced
for) at velocity 100 with reverb and chorus off, summed to mono, 48 kHz 16-bit. Sustained
sounds are held HOLD_S seconds and keep their release; decaying sounds ring out. Lead-in
is trimmed, the tail is cut where it falls 60 dB below peak (capped at MAX_S), and levels
are matched by RMS over the first second (peak never above -0.5 dBFS).

The root note is in each sample's name ("Grand Piano C4"): play that key and the sample
sounds at its own pitch. On the Circuit Rhythm a step at note 60 plays a sample unpitched.

Outputs (rhythmgm/):
  RhythmGM.circuitrhythmpack     pack for Novation Components (samples only; empty project slots)
  RhythmGM_SD.zip                the same samples in Novation's manual SD-card layout
  samples/NNN Name.wav           the 128 samples, by slot
  rhythmgm_samples.json          slot, name, source, GM program, root note, length
"""
import ctypes, ctypes.util, json, os, sys, wave, zipfile
import numpy as np

SR = 48000
VEL = 100
HOLD_S = 2.0            # sustained sounds: note held this long, then released
MAX_S = 2.6             # longest instrument sample
RMS_DB = -17.0          # level target, RMS over the first second
LIMIT_S = 228.1         # Circuit Rhythm pack sample time (Novation Components guide)

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.dirname(HERE)                                    # rhythmgm/
DRUMS = os.path.join(OUT, "..", "tracksgm", "drums")

# (GM program 1-128, short name, root MIDI note). 4 per family, in GM order.
INSTRUMENTS = [
    # Piano
    (1, "Grand Piano", 60), (5, "Electric Piano", 60), (7, "Harpsichord", 60), (8, "Clavinet", 60),
    # Chromatic percussion
    (10, "Glockenspiel", 84), (12, "Vibraphone", 72), (13, "Marimba", 72), (15, "Tubular Bells", 72),
    # Organ
    (17, "Drawbar Organ", 60), (19, "Rock Organ", 60), (20, "Church Organ", 60), (22, "Accordion", 60),
    # Guitar
    (25, "Nylon Guitar", 60), (26, "Steel Guitar", 60), (28, "Clean Guitar", 60), (31, "Distortion Gtr", 48),
    # Bass
    (33, "Acoustic Bass", 36), (34, "Finger Bass", 36), (37, "Slap Bass", 36), (39, "Synth Bass", 36),
    # Strings
    (41, "Violin", 72), (43, "Cello", 48), (46, "Pizzicato", 60), (47, "Harp", 60),
    # Ensemble
    (49, "String Ensemble", 60), (51, "Synth Strings", 60), (53, "Choir Aahs", 60), (56, "Orchestra Hit", 60),
    # Brass
    (57, "Trumpet", 72), (61, "French Horn", 60), (62, "Brass Section", 60), (63, "Synth Brass", 60),
    # Reed
    (66, "Alto Sax", 60), (67, "Tenor Sax", 60), (69, "Oboe", 72), (72, "Clarinet", 60),
    # Pipe
    (74, "Flute", 72), (76, "Pan Flute", 72), (78, "Shakuhachi", 72), (80, "Ocarina", 72),
    # Synth lead
    (81, "Square Lead", 60), (82, "Saw Lead", 60), (85, "Charang Lead", 60), (87, "Fifths Lead", 60),
    # Synth pad
    (89, "New Age Pad", 60), (90, "Warm Pad", 60), (91, "Polysynth Pad", 60), (96, "Sweep Pad", 60),
    # Synth effects
    (99, "FX Crystal", 72), (100, "FX Atmosphere", 60), (101, "FX Brightness", 72), (104, "FX Sci-fi", 60),
    # Ethnic
    (105, "Sitar", 60), (106, "Banjo", 60), (108, "Koto", 60), (109, "Kalimba", 72),
    # Percussive
    (115, "Steel Drums", 72), (117, "Taiko Drum", 48), (118, "Melodic Tom", 48), (119, "Synth Drum", 48),
    # Sound effects
    (123, "Seashore", 60), (124, "Bird Tweet", 72), (126, "Helicopter", 60), (127, "Applause", 60),
]
NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def note_name(n):
    return f"{NOTE_NAMES[n % 12]}{n // 12 - 1}"


lib = ctypes.CDLL(ctypes.util.find_library("fluidsynth") or "libfluidsynth.so.3")
lib.new_fluid_settings.restype = ctypes.c_void_p
lib.new_fluid_synth.restype = ctypes.c_void_p
lib.new_fluid_synth.argtypes = [ctypes.c_void_p]
lib.fluid_settings_setnum.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_double]
lib.fluid_settings_setint.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_int]
lib.fluid_synth_sfload.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_int]
lib.fluid_synth_program_select.argtypes = [ctypes.c_void_p] + [ctypes.c_int] * 4
lib.fluid_synth_noteon.argtypes = [ctypes.c_void_p] + [ctypes.c_int] * 3
lib.fluid_synth_noteoff.argtypes = [ctypes.c_void_p] + [ctypes.c_int] * 2
lib.fluid_synth_all_sounds_off.argtypes = [ctypes.c_void_p, ctypes.c_int]
lib.fluid_synth_write_float.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p, ctypes.c_int,
                                        ctypes.c_int, ctypes.c_void_p, ctypes.c_int, ctypes.c_int]


def make_synth(sf2):
    s = lib.new_fluid_settings()
    lib.fluid_settings_setnum(s, b"synth.sample-rate", float(SR))
    lib.fluid_settings_setint(s, b"synth.reverb.active", 0)
    lib.fluid_settings_setint(s, b"synth.chorus.active", 0)
    lib.fluid_settings_setnum(s, b"synth.gain", 0.4)
    syn = lib.new_fluid_synth(s)
    sfid = lib.fluid_synth_sfload(syn, sf2.encode(), 1)
    if sfid < 0:
        sys.exit("could not load " + sf2)
    return syn, sfid


def render(syn, n):
    l, r = np.zeros(n, np.float32), np.zeros(n, np.float32)
    lib.fluid_synth_write_float(syn, n, l.ctypes.data, 0, 1, r.ctypes.data, 0, 1)
    return l, r


def play(syn, sfid, prog, note):
    lib.fluid_synth_all_sounds_off(syn, 0)
    render(syn, SR // 5)
    lib.fluid_synth_program_select(syn, 0, sfid, 0, prog - 1)
    lib.fluid_synth_noteon(syn, 0, note, VEL)
    l1, r1 = render(syn, int(HOLD_S * SR))
    lib.fluid_synth_noteoff(syn, 0, note)
    l2, r2 = render(syn, int(2.0 * SR))
    return 0.5 * (np.concatenate([l1, l2]) + np.concatenate([r1, r2])).astype(np.float64)


def tidy(x):
    a = np.abs(x)
    pk = a.max()
    if pk < 1e-6:
        raise ValueError("silent")
    start = max(0, int(np.argmax(a > pk * 10 ** (-50 / 20))) - 24)
    x = x[start:]
    w = 240
    env = np.maximum.reduceat(np.abs(x), np.arange(0, len(x), w))
    above = np.nonzero(env > pk * 1e-3)[0]
    end = min((above[-1] + 1) * w, len(x), int(MAX_S * SR))
    x = x[:end].copy()
    cut = end == int(MAX_S * SR)
    fade = min(int((0.3 if cut else 0.02) * SR), len(x) // 3)
    x[-fade:] *= np.linspace(1, 0, fade) ** 2
    rms = np.sqrt(np.mean(x[:SR] ** 2))
    g = 10 ** (RMS_DB / 20) / max(rms, 1e-9)
    g = min(g, 10 ** (-0.5 / 20) / np.abs(x).max())
    return x * g


def save(path, x):
    with wave.open(path, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((np.clip(x, -1, 1) * 32767).round().astype("<i2").tobytes())


def read_wav(path):
    with wave.open(path) as w:
        assert (w.getnchannels(), w.getsampwidth(), w.getframerate()) == (1, 2, SR), path
        return w.readframes(w.getnframes()), w.getnframes() / SR


if __name__ == "__main__":
    sf2 = sys.argv[1] if len(sys.argv) > 1 else "GeneralUser-GS.sf2"
    assert len(INSTRUMENTS) == 64
    sdir = os.path.join(OUT, "samples")
    os.makedirs(sdir, exist_ok=True)
    for f in os.listdir(sdir):
        if f.endswith(".wav"):
            os.remove(os.path.join(sdir, f))

    slots = []                                                  # (name, wav bytes path, info)
    drum_files = sorted(f for f in os.listdir(DRUMS) if f.endswith(".wav"))
    assert len(drum_files) == 64, len(drum_files)
    for i, f in enumerate(drum_files):
        name = f[3:-4]                                          # "00 Std Kick.wav" -> "Std Kick"
        slots.append({"slot": i, "name": name, "kind": "drum", "source": f"tracksgm/drums/{f}"})

    syn, sfid = make_synth(sf2)
    for prog, short, root in INSTRUMENTS:
        x = tidy(play(syn, sfid, prog, root))
        slots.append({"slot": len(slots), "name": f"{short} {note_name(root)}", "kind": "instrument",
                      "gm_program": prog, "root_note": root, "source": f"GeneralUser GS bank 0 program {prog}", "_x": x})

    total = 0.0
    for s in slots:
        path = os.path.join(sdir, f"{s['slot'] + 1:03d} {s['name']}.wav")
        if "_x" in s:
            save(path, s.pop("_x"))
        else:
            with open(os.path.join(DRUMS, os.path.basename(s["source"])), "rb") as src, open(path, "wb") as dst:
                dst.write(src.read())
        _, s["seconds"] = read_wav(path)
        s["seconds"] = round(s["seconds"], 3)
        s["file"] = os.path.basename(path)
        total += s["seconds"]
        print(f"{s['slot'] + 1:3d} {s['name']:24s} {s['seconds']:5.2f} s")
    print(f"total {total:.1f} s of {LIMIT_S} s")
    if total > LIMIT_S:
        sys.exit("over the Circuit Rhythm sample limit")
    longest = max(len(s["name"]) for s in slots)

    json.dump({"pack": "RhythmGM", "product": "circuit-rhythm", "total_seconds": round(total, 1),
               "limit_seconds": LIMIT_S, "samples": slots}, open(os.path.join(OUT, "rhythmgm_samples.json"), "w"), indent=1)

    # .circuitrhythmpack: index.json + samples/sample_N.wav, as Components writes it. Project
    # slots are left empty (blank name, no file), as Components stores an unused slot.
    index = {
        "name": "RhythmGM", "color": "blue", "product": "circuit-rhythm", "version": "2.0",
        "projects": [{"name": "", "url": f"projects/project_{i}.ncs"} for i in range(64)],
        "samples": [{"name": s["name"], "url": f"samples/sample_{s['slot']}.wav"} for s in slots],
    }
    with zipfile.ZipFile(os.path.join(OUT, "RhythmGM.circuitrhythmpack"), "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("index.json", json.dumps(index, indent=2))
        for s in slots:
            z.write(os.path.join(sdir, s["file"]), f"samples/sample_{s['slot']}.wav")

    # Novation's manual SD-card layout ("Manually setting up Circuit Rhythm SD card packs"):
    # Rhythm/<pack number>/PCM/NN__Name.wav, plus empty meta/ and Sessions/; the Rhythm makes
    # default Grid FX when GridFx/ is absent.
    with zipfile.ZipFile(os.path.join(OUT, "RhythmGM_SD.zip"), "w", zipfile.ZIP_DEFLATED) as z:
        for d in ("Rhythm/0/meta/", "Rhythm/0/Sessions/", "Rhythm/0/PCM/"):
            z.writestr(d, "")
        for s in slots:
            z.write(os.path.join(sdir, s["file"]), f"Rhythm/0/PCM/{s['slot']:02d}__{s['name']}.wav")
    print(f"wrote RhythmGM.circuitrhythmpack, RhythmGM_SD.zip; longest name {longest} characters")
