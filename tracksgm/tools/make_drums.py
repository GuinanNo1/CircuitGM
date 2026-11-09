"""Render 8 GeneralUser GS 2.0 drum kits x 8 hits as Circuit Tracks samples.

    python3 make_drums.py /path/to/GeneralUser-GS.sf2   ->  drums/NN Kit Hit.wav  (64 files)

Uses the system libfluidsynth (ctypes), the synth GeneralUser GS is programmed for, so each
hit keeps its envelopes, filters and velocity layer. Output: 48 kHz, 16-bit, mono (L+R sum),
silent lead-in removed, tail cut where it falls 60 dB below peak (with a short fade),
peak-normalised to -0.5 dBFS.

Slot order (sample slots 0-63, 16 per page on the Tracks = two kits per page, one per row):
  kick, snare, rim/clap, closed hat, open hat, tom, cymbal, percussion
(loosely: where GS kits share a sample, e.g. Jazz/Brush hats, a different hit replaces it
so no sample appears twice).
"""
import ctypes, ctypes.util, os, sys, wave
import numpy as np

SR = 48000
VEL = 110
RENDER_S = 6.0          # long enough for crashes/rides
HOLD_S = 4.0
MAX_S = {"cymbal": 4.0, "open hat": 2.0, "tom": 2.0, "perc": 2.0}   # trims to keep the pack well under 196.6 s
DEFAULT_MAX = 1.5
OUT = "drums"

SLOTS = ["kick", "snare", "rim/clap", "closed hat", "open hat", "tom", "cymbal", "perc"]

# kit name, GS program on bank 128, notes per slot, short hit names.
# A note may be (program, note) to take that hit from another kit.
# This is the TracksGM_final (2026-11-06) drum set, Ian's hand-picked version.
KITS = [
    ("Std",   0,  [36, 38, 39, 42, 46, 47, 49, 54],
     ["Kick", "Snare", "Clap", "CH", "OH", "Tom", "Crash", "Tamb"]),
    ("Room",  8,  [36, 38, 37, 42, 46, 45, 52, 63],
     ["Kick", "Snare", "Stick", "CH", "OH", "Tom", "China", "Conga"]),
    ("Power", 16, [36, 38, 40, 42, 46, 43, 57, 56],
     ["Kick", "Snare", "Snare2", "CH", "OH", "Tom", "Crash2", "Cowbell"]),
    ("Elec",  24, [(26, 35), (25, 40), 39, 42, 46, 48, 52, 40],   # Dance Kick 2, 808/909 Snare 2
     ["Kick", "Snare", "Clap", "Closed HH", "Open HH", "Tom", "RevCym", "GateSD"]),
    ("808",   25, [35, 38, 37, 42, 46, 43, 49, 56],
     ["Kick", "Snare", "Rim", "CH", "OH", "Tom", "Cymbal", "Cowbell"]),
    ("Jazz",  32, [36, 38, 37, 44, 82, 50, 51, 53],
     ["Kick", "Snare", "Stick", "PedalHH", "Shaker", "Tom", "Ride", "Bell"]),
    ("Brush", 40, [36, 38, 39, 40, 69, 41, 59, 55],
     ["Kick", "Tap", "Slap", "Swirl", "Cabasa", "Tom", "Ride2", "Splash"]),
    ("Orch",  48, [35, 38, 39, 76, 81, 41, 59, 45],
     ["Kick", "Snare", "Castanet", "WoodBlk", "Triangle", "TimpLo", "Cymbal", "TimpHi"]),
]

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
lib.fluid_synth_write_float.argtypes = [ctypes.c_void_p, ctypes.c_int,
                                        ctypes.c_void_p, ctypes.c_int, ctypes.c_int,
                                        ctypes.c_void_p, ctypes.c_int, ctypes.c_int]


def make_synth(sf2):
    s = lib.new_fluid_settings()
    lib.fluid_settings_setnum(s, b"synth.sample-rate", float(SR))
    lib.fluid_settings_setint(s, b"synth.reverb.active", 0)
    lib.fluid_settings_setint(s, b"synth.chorus.active", 0)
    lib.fluid_settings_setnum(s, b"synth.gain", 0.5)
    syn = lib.new_fluid_synth(s)
    sfid = lib.fluid_synth_sfload(syn, sf2.encode(), 1)
    if sfid < 0:
        sys.exit("could not load " + sf2)
    return syn, sfid


def render(syn, n):
    left = np.zeros(n, np.float32)
    right = np.zeros(n, np.float32)
    lib.fluid_synth_write_float(syn, n, left.ctypes.data, 0, 1, right.ctypes.data, 0, 1)
    return left, right


def hit(syn, sfid, prog, note):
    lib.fluid_synth_all_sounds_off(syn, 9)
    render(syn, SR // 10)                                  # flush
    lib.fluid_synth_program_select(syn, 9, sfid, 128, prog)
    lib.fluid_synth_noteon(syn, 9, note, VEL)
    l1, r1 = render(syn, int(HOLD_S * SR))
    lib.fluid_synth_noteoff(syn, 9, note)
    l2, r2 = render(syn, int((RENDER_S - HOLD_S) * SR))
    return 0.5 * (np.concatenate([l1, l2]) + np.concatenate([r1, r2]))


def tidy(x, max_s):
    a = np.abs(x)
    pk = a.max()
    if pk < 1e-6:
        raise ValueError("silent")
    start = max(0, int(np.argmax(a > pk * 10 ** (-50 / 20))) - 24)   # 0.5 ms pre-roll
    x = x[start:]
    # envelope (5 ms max-hold) -> last point above -60 dB
    w = 240
    env = np.maximum.reduceat(np.abs(x), np.arange(0, len(x), w))
    above = np.nonzero(env > pk * 1e-3)[0]
    end = min((above[-1] + 1) * w, len(x), int(max_s * SR))
    x = x[:end].copy()
    fade = min(int(0.02 * SR), len(x) // 4) if end < int(max_s * SR) else min(int(0.25 * SR), len(x) // 3)
    x[-fade:] *= np.linspace(1, 0, fade) ** 2
    x *= 10 ** (-0.5 / 20) / pk
    return x


def save(path, x):
    with wave.open(path, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((np.clip(x, -1, 1) * 32767).round().astype("<i2").tobytes())


if __name__ == "__main__":
    sf2 = sys.argv[1] if len(sys.argv) > 1 else "GeneralUser-GS.sf2"
    syn, sfid = make_synth(sf2)
    os.makedirs(OUT, exist_ok=True)
    total, i = 0.0, 0
    for kit, prog, notes, names in KITS:
        for slot, note, name in zip(SLOTS, notes, names):
            p, nt = note if isinstance(note, tuple) else (prog, note)
            x = tidy(hit(syn, sfid, p, nt), MAX_S.get(slot, DEFAULT_MAX))
            fn = f"{i:02d} {kit} {name}.wav"
            save(os.path.join(OUT, fn), x)
            total += len(x) / SR
            print(f"{fn:28s} {len(x) / SR:5.2f} s")
            i += 1
    print(f"{i} samples, {total:.1f} s total (cap 196.6 s)")
