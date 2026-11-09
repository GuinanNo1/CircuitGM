"""
ctpatch — build Novation Circuit Tracks synth patches (.syx).

Layout: Circuit Tracks Programmer's Reference Guide v3, "Synth Patch Format"
(340 bytes, all 7-bit). Macro destination names (0-69) from the
CIRCUIT-HACKS-RC wiki, which matches the guide's CC/NRPN ordering.

Usage:
    from ctpatch import Patch
    p = Patch("Acid Bass")
    p.set(osc1_wave="sawtooth", filter_type="lp24", filter_frequency=30)
    p.mod(1, "lfo1_bi", "filter_frequency", +20)
    p.macro(5, [("filter_frequency", +50)])
    p.write("Acid Bass.syx")
"""

import re

# ---------------------------------------------------------------- tables
OSC_WAVES = ["sine", "triangle", "sawtooth", "saw 9:1", "saw 8:2", "saw 7:3",
             "saw 6:4", "saw 5:5", "saw 4:6", "saw 3:7", "saw 2:8", "saw 1:9",
             "pulse width", "square", "sine table", "analogue pulse",
             "analogue sync", "triangle-saw blend", "digital nasty 1",
             "digital nasty 2", "digital saw-square", "digital vocal 1",
             "digital vocal 2", "digital vocal 3", "digital vocal 4",
             "digital vocal 5", "digital vocal 6", "random collection 1",
             "random collection 2", "random collection 3"]

FILTER_TYPES = {"lp12": 0, "lp24": 1, "bp6": 2, "bp12": 3, "hp12": 4, "hp24": 5}
DRIVE_TYPES = {"diode": 0, "valve": 1, "clipper": 2, "cross-over": 3,
               "rectifier": 4, "bit reducer": 5, "rate reducer": 6}
POLY = {"mono": 0, "mono_ag": 1, "poly": 2}

LFO_WAVES = ["sine", "triangle", "sawtooth", "square", "random s/h",
             "time s/h", "piano envelope"]  # 7+ = sequences / arps (see guide)

MOD_SOURCES = {"direct": 0, "velocity": 4, "keyboard": 5, "lfo1_uni": 6,
               "lfo1_bi": 7, "lfo2_uni": 8, "lfo2_bi": 9, "env_amp": 10,
               "env_filter": 11, "env3": 12}
MOD_DESTS = ["pitch", "osc1_pitch", "osc2_pitch", "osc1_vsync", "osc2_vsync",
             "osc1_pw", "osc2_pw", "osc1_level", "osc2_level", "noise_level",
             "ring_level", "filter_drive", "filter_frequency",
             "filter_resonance", "lfo1_rate", "lfo2_rate", "amp_decay",
             "filter_decay"]

# Macro destination VALUES (0-70). Value 0 = no destination; 1-70 follow the CC-order list
# below. Confirmed 2026-11-05: Components shows value 5 as "O1 VSync Depth" and 6 as "O1 Density",
# and on hardware value 20 moved noise level. (The 2026-11-04 table lacked the "none" entry, so
# every macro written before this fix pointed one entry early.) Components groups them
# differently for display (Post FX under Mixer, Portamento under FX).
MACRO_DESTS = ["none", "portamento", "post_fx_level", "osc1_interpolate", "osc1_pw",
               "osc1_vsync", "osc1_density", "osc1_density_detune",
               "osc1_semitones", "osc1_cents", "osc2_interpolate", "osc2_pw",
               "osc2_vsync", "osc2_density", "osc2_density_detune",
               "osc2_semitones", "osc2_cents", "osc1_level", "osc2_level",
               "ring_level", "noise_level", "filter_frequency",
               "filter_resonance", "filter_drive", "filter_tracking",
               "env2_to_filter", "env1_attack", "env1_decay", "env1_sustain",
               "env1_release", "env2_attack", "env2_decay", "env2_sustain",
               "env2_release", "env3_delay", "env3_attack", "env3_decay",
               "env3_sustain", "env3_release", "lfo1_rate", "lfo1_rate_sync",
               "lfo1_slew", "lfo2_rate", "lfo2_rate_sync", "lfo2_slew",
               "distortion_level", "chorus_level", "chorus_rate",
               "chorus_feedback", "chorus_depth", "chorus_delay"] + \
              [f"mod{i}_depth" for i in range(1, 21)]
assert len(MACRO_DESTS) == 71

# ------------------------------------------------- address map (name, addr, default, lo, hi)
FIELDS = [
    ("category", 16, 0, 0, 14), ("genre", 17, 0, 0, 9),
    ("poly_mode", 32, 2, 0, 2), ("portamento", 33, 0, 0, 127),
    ("pre_glide", 34, 64, 52, 76), ("octave", 35, 64, 58, 69),
    ("osc1_wave", 36, 2, 0, 29), ("osc1_interpolate", 37, 127, 0, 127),
    ("osc1_pw", 38, 64, 0, 127), ("osc1_vsync", 39, 0, 0, 127),
    ("osc1_density", 40, 0, 0, 127), ("osc1_density_detune", 41, 0, 0, 127),
    ("osc1_semitones", 42, 64, 0, 127), ("osc1_cents", 43, 64, 0, 127),
    ("osc1_bend", 44, 76, 52, 76),
    ("osc2_wave", 45, 2, 0, 29), ("osc2_interpolate", 46, 127, 0, 127),
    ("osc2_pw", 47, 64, 0, 127), ("osc2_vsync", 48, 0, 0, 127),
    ("osc2_density", 49, 0, 0, 127), ("osc2_density_detune", 50, 0, 0, 127),
    ("osc2_semitones", 51, 64, 0, 127), ("osc2_cents", 52, 64, 0, 127),
    ("osc2_bend", 53, 76, 52, 76),
    ("osc1_level", 54, 127, 0, 127), ("osc2_level", 55, 0, 0, 127),
    ("ring_level", 56, 0, 0, 127), ("noise_level", 57, 0, 0, 127),
    ("pre_fx_level", 58, 64, 52, 82), ("post_fx_level", 59, 64, 52, 82),
    ("filter_routing", 60, 0, 0, 2), ("filter_drive", 61, 0, 0, 127),
    ("filter_drive_type", 62, 0, 0, 6), ("filter_type", 63, 1, 0, 5),
    ("filter_frequency", 64, 127, 0, 127), ("filter_tracking", 65, 127, 0, 127),
    ("filter_resonance", 66, 0, 0, 127), ("filter_q_normalise", 67, 64, 0, 127),
    ("env2_to_filter", 68, 64, 0, 127),
    ("env1_velocity", 69, 64, 0, 127), ("env1_attack", 70, 2, 0, 127),
    ("env1_decay", 71, 90, 0, 127), ("env1_sustain", 72, 127, 0, 127),
    ("env1_release", 73, 40, 0, 127),
    ("env2_velocity", 74, 64, 0, 127), ("env2_attack", 75, 2, 0, 127),
    ("env2_decay", 76, 75, 0, 127), ("env2_sustain", 77, 35, 0, 127),
    ("env2_release", 78, 45, 0, 127),
    ("env3_delay", 79, 0, 0, 127), ("env3_attack", 80, 10, 0, 127),
    ("env3_decay", 81, 70, 0, 127), ("env3_sustain", 82, 64, 0, 127),
    ("env3_release", 83, 40, 0, 127),
    ("lfo1_wave", 84, 0, 0, 37), ("lfo1_phase", 85, 0, 0, 119),
    ("lfo1_slew", 86, 0, 0, 127), ("lfo1_delay", 87, 0, 0, 127),
    ("lfo1_delay_sync", 88, 0, 0, 35), ("lfo1_rate", 89, 68, 0, 127),
    ("lfo1_rate_sync", 90, 0, 0, 35), ("lfo1_flags", 91, 0, 0, 63),
    ("lfo2_wave", 92, 0, 0, 37), ("lfo2_phase", 93, 0, 0, 119),
    ("lfo2_slew", 94, 0, 0, 127), ("lfo2_delay", 95, 0, 0, 127),
    ("lfo2_delay_sync", 96, 0, 0, 35), ("lfo2_rate", 97, 68, 0, 127),
    ("lfo2_rate_sync", 98, 0, 0, 35), ("lfo2_flags", 99, 0, 0, 63),
    ("distortion_level", 100, 0, 0, 127), ("chorus_level", 102, 0, 0, 127),
    ("eq_bass_freq", 105, 64, 0, 127), ("eq_bass_level", 106, 64, 0, 127),
    ("eq_mid_freq", 107, 64, 0, 127), ("eq_mid_level", 108, 64, 0, 127),
    ("eq_treble_freq", 109, 125, 0, 127), ("eq_treble_level", 110, 64, 0, 127),
    ("distortion_type", 116, 0, 0, 6), ("distortion_compensation", 117, 100, 0, 127),
    ("chorus_type", 118, 1, 0, 1), ("chorus_rate", 119, 20, 0, 127),
    ("chorus_rate_sync", 120, 0, 0, 35), ("chorus_feedback", 121, 74, 0, 127),
    ("chorus_depth", 122, 64, 0, 127), ("chorus_delay", 123, 64, 0, 127),
]
F = {n: (a, d, lo, hi) for n, a, d, lo, hi in FIELDS}

MOD_BASE, MACRO_BASE = 124, 204
HEADER = bytes([0xF0, 0x00, 0x20, 0x29, 0x01, 0x64])


def _enum(value, table):
    if isinstance(value, int):
        return value
    v = value.lower()
    if isinstance(table, dict):
        return table[v]
    return table.index(v)


class Patch:
    def __init__(self, name):
        self.data = bytearray(340)
        for n, (a, d, lo, hi) in F.items():
            self.data[a] = d
        for s in range(20):
            self.data[MOD_BASE + 4 * s + 2] = 64
        for k in range(8):
            for r in range(4):
                b = MACRO_BASE + 17 * k + 1 + 4 * r
                self.data[b + 2] = 127
                self.data[b + 3] = 64
        self.name = name

    @property
    def name(self):
        return self.data[0:16].decode("ascii").rstrip()

    @name.setter
    def name(self, s):
        if not re.fullmatch(r"[\x20-\x7e]{1,16}", s):
            raise ValueError(f"name {s!r}: 1-16 printable ASCII chars")
        self.data[0:16] = s.ljust(16).encode("ascii")

    def set(self, **kw):
        for n, v in kw.items():
            a, d, lo, hi = F[n]
            if n.endswith("_wave") and n.startswith("osc"):
                v = _enum(v, OSC_WAVES)
            elif n.endswith("_wave") and n.startswith("lfo"):
                v = _enum(v, LFO_WAVES)
            elif n == "filter_type":
                v = _enum(v, FILTER_TYPES)
            elif n in ("filter_drive_type", "distortion_type"):
                v = _enum(v, DRIVE_TYPES)
            elif n == "poly_mode":
                v = _enum(v, POLY)
            elif n == "chorus_type":
                v = {"phaser": 0, "chorus": 1}.get(v, v)
            if not lo <= v <= hi:
                raise ValueError(f"{n}={v} outside {lo}-{hi}")
            self.data[a] = v
        return self

    def rel(self, **kw):
        return self.set(**{n: 64 + v for n, v in kw.items()})

    def lfo_flags(self, lfo, one_shot=False, key_sync=False, common_sync=False,
                  delay_trigger=False, fade="fade_in"):
        fade_v = ["fade_in", "fade_out", "gate_in", "gate_out"].index(fade)
        v = one_shot | key_sync << 1 | common_sync << 2 | delay_trigger << 3 | fade_v << 4
        self.data[F[f"lfo{lfo}_flags"][0]] = v
        return self

    def mod(self, slot, source, dest, depth, source2="direct"):
        b = MOD_BASE + 4 * (slot - 1)
        self.data[b] = _enum(source, MOD_SOURCES)
        self.data[b + 1] = _enum(source2, MOD_SOURCES)
        self.data[b + 2] = 64 + depth
        self.data[b + 3] = _enum(dest, MOD_DESTS)
        return self

    def macro(self, knob, targets, position=0):
        base = MACRO_BASE + 17 * (knob - 1)
        self.data[base] = position
        for r, t in enumerate(targets):
            dest, depth = t[0], t[1]
            start, end = (t[2], t[3]) if len(t) == 4 else (0, 127)
            b = base + 1 + 4 * r
            self.data[b:b + 4] = bytes([_enum(dest, MACRO_DESTS), start, end, 64 + depth])
        return self

    def syx(self, location=0):
        assert all(x < 128 for x in self.data)
        return HEADER + bytes([0x00, location, 0x00]) + bytes(self.data) + b"\xF7"

    def write(self, path, location=0):
        with open(path, "wb") as f:
            f.write(self.syx(location))


def dump(p):
    ref = Patch("ref").data
    out = {"name": p.name}
    for n, (a, d, lo, hi) in F.items():
        if p.data[a] != ref[a]:
            out[n] = p.data[a]
    return out


def read_syx(path):
    raw = open(path, "rb").read()
    assert raw[:6] == HEADER and len(raw) == 350 and raw[-1] == 0xF7, "not a Tracks patch"
    p = Patch("x")
    p.data[:] = raw[9:349]
    return p


import math as _m


def _interp(x, table):
    if x <= table[0][0]:
        return table[0][1]
    for (x0, y0), (x1, y1) in zip(table, table[1:]):
        if x <= x1:
            return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return table[-1][1]


def _inv(y, table):
    return round(_interp(y, [(b, a) for a, b in sorted(table, key=lambda t: t[1])]))


CUTOFF_HZ = [(0, 30), (8, 45), (16, 55), (24, 65), (32, 110), (40, 150), (48, 260),
             (56, 400), (64, 650), (72, 1100), (80, 1800), (88, 2700), (96, 4000),
             (104, 6500), (112, 10500), (120, 17000), (127, 20000)]
EQ_BASS_DB = [(0, -25), (32, -8), (64, 0), (96, 7), (127, 12.6)]
EQ_MID_DB = [(0, -41), (32, -12), (64, 0), (96, 7.4), (127, 12.2)]
EQ_TREBLE_DB = [(0, -18), (32, -7), (64, 0), (96, 6), (127, 11)]
EQ_MID_HZ = [(0, 453), (16, 640), (32, 905), (48, 1100), (64, 1280), (80, 1500),
             (96, 1810), (112, 2000), (127, 2200)]
EQ_TREBLE_HZ = [(0, 1100), (16, 1300), (32, 2000), (48, 2600), (64, 3600),
                (80, 4500), (96, 5500), (112, 6500), (127, 8000)]


def cutoff(hz):
    return max(0, min(127, round(64 + 11.5 * _m.log2(hz / 650)))) if 150 <= hz <= 12000 \
        else _inv(hz, CUTOFF_HZ)


def cutoff_hz(v):
    return _interp(v, CUTOFF_HZ)


def env_time(seconds, stage="decay"):
    ref = 0.18 if stage == "attack" else 0.38
    return max(0, min(127, round(64 + 31.5 * _m.log10(seconds / ref))))


def env_seconds(v, stage="decay"):
    ref = 0.18 if stage == "attack" else 0.38
    return ref * 10 ** ((v - 64) / 31.5)


def eq_level(db, band):
    return max(0, min(127, _inv(db, {"bass": EQ_BASS_DB, "mid": EQ_MID_DB,
                                      "treble": EQ_TREBLE_DB}[band])))


def eq_mid_freq(hz):
    return _inv(hz, EQ_MID_HZ)


def eq_treble_freq(hz):
    return _inv(hz, EQ_TREBLE_HZ)


# ---------------------------------------------------------------- calibration set 2
def lfo_rate(hz):
    """LFO rate value (free running) for a frequency in Hz: Hz = 3.39 * 2^((v-64)/12)."""
    return max(0, min(127, round(64 + 12 * _m.log2(hz / 3.39))))


def lfo_hz(v):
    return 3.39 * 2 ** ((v - 64) / 12)


def pitch_depth(semitones):
    """Mod-matrix depth for a pitch offset in semitones: semitones ~ depth^3 / 2048
    (32 -> 16 st exact). For LFO vibrato this is the peak deviation."""
    s = abs(semitones)
    d = round((2048 * s) ** (1 / 3)) if s else 0
    return min(63, d) * (1 if semitones >= 0 else -1)


def vib_depth(cents):
    """Depth for a vibrato of +/- `cents` (measured: 4 ~ 9 c, 6 ~ 15 c, 8 ~ 34 c, 10 ~ 50 c)."""
    table = [(0, 0), (2, 4), (4, 9), (6, 15), (8, 34), (10, 50), (16, 200)]
    return round(_interp(cents, [(c, d) for d, c in table]))


def filter_amount(steps):
    """Env2->filter amount (or mod depth to filter) moving the cutoff by `steps` frequency-value
    steps: steps ~ a + a^3/4300 (11.5 steps ~ 1 octave)."""
    s, a = abs(steps), 0.0
    for _ in range(50):
        a -= (a + a ** 3 / 4300 - s) / (1 + 3 * a * a / 4300)
    return min(63, round(a)) * (1 if steps >= 0 else -1)


WT_INDEX = [0, 16, 32, 48, 64, 80, 96, 112, 127]   # centres of the 9 wavetable Index steps
