"""General MIDI sound set (programs 1-128) for the Circuit Tracks synth.

Run: python3 gm_patches.py  ->  gm_patches/001 Grand Piano.syx ... 128 Gunshot.syx

Every patch shares one macro layout so the knobs behave the same everywhere:
 1 Thicken (density + detune)   2 Edge (virtual sync)
 3 Attack + release longer      4 Filter envelope amount
 5 Cutoff (opens, or closes on already-bright sounds)
 6 Resonance                    7 Vibrato depth          8 Chorus
LFO 2 is always the vibrato (delayed, fades in; mod slot 20 -> pitch).
Macros are stored at position 0, so each patch loads exactly as designed.
"""
import os
from ctpatch import (Patch, F, cutoff, cutoff_hz, env_time, eq_level,
                     eq_mid_freq, eq_treble_freq)

OUT = "gm_patches"

# Values below come from hardware calibration (claude/circuit-tracks-calibration.md).

# Output level: Post FX is 1 dB/step, 64 = 0 dB, +12 dB max (76). Start every patch at
# +12; a loudness pass after re-recording trims the loud ones.
POST_FX = 12

# Per-family EQ in dB: (bass shelf dB, mid peak dB, mid centre Hz, treble shelf dB, treble Hz).
# Shapes follow the usual mix EQ for the acoustic instrument each family copies.
FAMILY_EQ = {
    1: (2, -2, 500, 3, 5000),       # piano: body, less box, clarity
    9: (-4, 2, 2000, 4, 5000),      # chromatic perc: lose mud, sparkle
    17: (3, -3, 900, 2, 4500),      # organ: weight, less honk
    25: (-4, 3, 1800, 2, 5000),     # guitar: thin lows, presence
    33: (4, 3, 900, -2, 4500),      # bass: low end + growl, tame fizz
    41: (-2, -3, 500, 3, 6500),     # strings: less box, air
    49: (1, -3, 500, 3, 6500),      # ensemble: scooped, airy
    57: (0, 4, 1300, 2, 4500),      # brass: mid bite
    65: (-2, 4, 1500, 1, 5000),     # reed: nasal mids
    73: (-5, 3, 2000, 6, 4500),     # pipe: breathy; air shelf over the lowered filter
    81: (-2, 3, 1800, 2, 4500),     # synth lead: cuts through
    89: (2, -3, 640, 3, 6500),      # pad: wide, scooped
    97: (0, 0, 1280, 2, 5000),      # synth fx
    105: (-3, 4, 1800, 2, 5000),    # ethnic: plucked/reedy mids
    113: (3, -2, 640, 3, 5000),     # percussive
    121: (0, 0, 1280, 0, 8000),     # sound effects: flat
}

# Low-pass cutoff targets (Hz) for each family's median patch. Every LP patch in the
# family below 110 is shifted by the same number of steps, keeping its relative darkness.
# (First drafts assumed a much brighter mapping: e.g. basses sat at ~160 Hz, brass ~210 Hz.)
FAMILY_CUTOFF = {1: 4000, 9: 4000, 17: 5000, 25: 3000, 33: 1000, 41: 5000, 49: 5000,
                 57: 2500, 65: 3000, 73: 6000, 81: 4000, 89: 2500, 97: 2000, 105: 4000,
                 113: 1500, 121: None}


# Loudness trims (dB) from the v2 hardware recording, aiming at ~-26 LUFS for sustained
# sounds and ~-29 (first 400 ms) for percussive ones. Cuts use Post FX (calibrated,
# 1 dB/step); boosts use Pre FX (assumed 1 dB/step, max +12; verify).
# Basses 33-40, 44, 59, 68, 71 re-pitched (octave -1), pipes re-filtered, Agogo/Woodblock
# redesigned 2026-11-05: their trims re-measured in the same session.
LOUD_TRIM = {1: 3, 2: 4, 4: -2, 5: -2, 6: 2, 8: 8, 9: -1, 10: -2, 12: 3, 13: 5, 14: 6, 15: 4, 16: -1, 17: -3, 18: -6, 19: -8, 20: -5, 21: -4, 22: -5, 23: 4, 24: -5, 25: 7, 26: 2, 27: 7, 28: 1, 29: 13, 30: 1, 31: -7, 33: -2, 34: -1, 35: -1, 38: -2, 39: -9, 40: -7, 41: 1, 43: -3, 44: -2, 45: 2, 46: 10, 47: 3, 48: -4, 49: -2, 50: -3, 51: -6, 52: -5, 53: 2, 54: 12, 55: 1, 56: 8, 57: -2, 58: -1, 59: -4, 60: 3, 61: -3, 62: -3, 63: -3, 64: -6, 65: 1, 67: -1, 68: -3, 69: 2, 70: 4, 71: -3, 72: -4, 73: 3, 74: 2, 75: 1, 76: 3, 77: 12, 78: 3, 79: 2, 80: 2, 81: -6, 82: -2, 83: -1, 84: -4, 85: -1, 86: 5, 87: -2, 88: -3, 89: -3, 90: -3, 91: -5, 93: 6, 94: -4, 95: -2, 96: -1, 97: 3, 99: -4, 100: -4, 101: -4, 102: -1, 105: -3, 106: 10, 107: 11, 108: 1, 109: 3, 110: 4, 112: 1, 113: 6, 115: 4, 116: 3, 117: 1, 118: 4, 119: 5, 120: -3, 121: 15, 122: 10, 123: 17, 124: 2, 125: -9, 126: 4, 127: 14, 128: -5}


# Per-patch filter values set after listening on hardware (Ian, 2026-11-05): breath noise
# in the pipe family came through unfiltered; ~80 (1.8 kHz) sounds right on Piccolo.
FILTER_OVERRIDE = {73: 80, 74: 78, 75: 80, 76: 76, 78: 74, 79: 82, 80: 78, 83: 82}


def family(num):
    return max(k for k in FAMILY_EQ if k <= num)


def gm(num, name, w1="sawtooth", w2=None, l1=127, l2=0, s1=0, s2=0, c2=0,
       i1=None, i2=None, pw1=None, pw2=None, vs1=0, vs2=0, d1=None, d2=None,
       noise=0, ring=0, f=("lp24", 127, 0), drive=None, track=None,
       amp=(0, 90, 127, 30), fe=None, e3=None, lfo1=None, mods=(),
       mono=False, port=0, oct=0, dist=None, ch=None, vib=0, vel=0,
       mac=None, x=None, eq=None, post=POST_FX, t60=None):
    p = Patch(name)
    b, m, mf, t, tf = FAMILY_EQ[family(num)]
    if eq is not None:                     # per-patch override: (bass, mid, treble) dB
        b, m, t = eq
    p.set(eq_bass_level=eq_level(b, "bass"), eq_mid_level=eq_level(m, "mid"),
          eq_mid_freq=eq_mid_freq(mf), eq_treble_level=eq_level(t, "treble"),
          eq_treble_freq=eq_treble_freq(tf))
    p.rel(post_fx_level=post)
    p.set(osc1_wave=w1, osc1_level=l1, osc2_level=l2, noise_level=noise,
          ring_level=ring, lfo2_wave="sine", lfo2_rate=72, lfo2_delay=50)
    if w2:
        p.set(osc2_wave=w2)
    p.lfo_flags(2, fade="fade_in")
    p.rel(osc1_semitones=s1, osc2_semitones=s2, osc2_cents=c2, octave=oct,
          env1_velocity=vel)
    for k, v in (("osc1_interpolate", i1), ("osc2_interpolate", i2)):
        if v is not None:
            p.set(**{k: v})
    for k, v in (("osc1_pw", pw1), ("osc2_pw", pw2)):
        if v is not None:
            p.rel(**{k: v})
    p.set(osc1_vsync=vs1, osc2_vsync=vs2)
    if d1:
        p.set(osc1_density=d1[0], osc1_density_detune=d1[1])
    if d2:
        p.set(osc2_density=d2[0], osc2_density_detune=d2[1])
    p.set(filter_type=f[0], filter_frequency=f[1], filter_resonance=f[2])
    if drive:
        p.set(filter_drive=drive[0], filter_drive_type=drive[1])
    if track is not None:
        p.set(filter_tracking=track)
    a, d, s, r = amp
    if t60:
        d = env_time(t60)
    p.set(env1_attack=a, env1_decay=d, env1_sustain=s, env1_release=r)
    if fe:
        a, d, s, r, amt = fe
        p.set(env2_attack=a, env2_decay=d, env2_sustain=s, env2_release=r)
        p.rel(env2_to_filter=amt)
    if e3:
        p.set(env3_delay=0, env3_attack=e3[0], env3_decay=e3[1], env3_sustain=e3[2])
    if lfo1:
        p.set(lfo1_wave=lfo1[0], lfo1_rate=lfo1[1])
    for slot, (src, dest, depth) in enumerate(mods, 1):
        p.mod(slot, src, dest, depth)
    p.mod(20, "lfo2_bi", "pitch", vib)
    if mono:
        p.set(poly_mode="mono_ag" if mono == "ag" else "mono", portamento=port)
    if dist:
        p.set(distortion_level=dist[0], distortion_type=dist[1])
    if ch is not None:
        if isinstance(ch, int):
            ch = (ch,)
        p.set(chorus_level=ch[0])
        if len(ch) > 1:
            p.set(chorus_type=ch[1])
        if len(ch) > 2:
            p.set(chorus_rate=ch[2], chorus_depth=ch[3])
        if len(ch) > 4:
            p.rel(chorus_feedback=ch[4])
    if x:
        p.set(**x)

    macros = {
        1: [("osc1_density", 40), ("osc1_density_detune", 40)],
        2: [("osc1_vsync", 45)],
        3: [("env1_attack", 40), ("env1_release", 40)],
        4: [("env2_to_filter", 20)],
        5: [("filter_frequency", 0)],     # set in retune()
        6: [("filter_resonance", 45)],
        7: [("mod20_depth", 4)],
        8: [("chorus_level", 50)],
    }
    macros.update(mac or {})
    for k, t in macros.items():
        p.macro(k, t)
    return num, p


P = [
    # ---------------- Piano 1-8
    gm(1, "Grand Piano", w1="triangle", w2="sawtooth", l2=45, c2=3,
       f=("lp24", 60, 5), amp=(0, 95, 0, 45), fe=(0, 80, 20, 40, 35), vel=25,
       ch=20),
    gm(2, "Bright Piano", w1="triangle", w2="sawtooth", l2=70, c2=4,
       f=("lp12", 85, 10), amp=(0, 92, 0, 42), fe=(0, 75, 30, 40, 30), vel=25,
       ch=25),
    gm(3, "Electric Grand", w1="saw 7:3", w2="triangle", l2=90, s2=12, c2=5,
       f=("lp24", 70, 10), amp=(0, 95, 0, 45), fe=(0, 70, 30, 40, 25), vel=20,
       ch=45),
    gm(4, "Honky-tonk", w1="triangle", w2="sawtooth", l2=110, c2=14,
       f=("lp12", 80, 8), amp=(0, 90, 0, 40), fe=(0, 70, 25, 40, 25), vel=20),
    gm(5, "Electric Piano 1", eq=(3, 0, 0), w1="sine", w2="sine", l1=110, l2=40, s2=12,
       ring=30, f=("lp12", 90, 0), amp=(0, 100, 0, 55), vel=30,
       ch=(55, 0, 30, 70), lfo1=("triangle", 45),
       mac={7: [("mod1_depth", -30)]},
       mods=[("lfo1_uni", "osc1_level", 0)]),          # macro 7 = tremolo
    gm(6, "Electric Piano 2", eq=(3, 0, 1), w1="sine", w2="sine", l1=110, s2=26, c2=2,
       ring=55, e3=(0, 45, 0), mods=[("env3", "ring_level", 40)],
       f=("lp12", 110, 0), amp=(0, 95, 0, 50), vel=30, ch=50),
    gm(7, "Harpsichord", w1="saw 9:1", w2="pulse width", l2=70, s2=12,
       pw2=-40, f=("hp12", 20, 10), amp=(0, 80, 0, 25), fe=(0, 40, 0, 20, 20),
       ch=15),
    gm(8, "Clavinet", w1="pulse width", pw1=-48, f=("bp12", 70, 40),
       amp=(0, 70, 0, 15), fe=(0, 35, 0, 15, 30), vel=25, drive=(25, "valve")),

    # ---------------- Chromatic percussion 9-16
    gm(9, "Celesta", w1="sine", w2="triangle", l2=50, s2=24, s1=12,
       amp=(0, 85, 0, 60), ch=30),
    gm(10, "Glockenspiel", w1="sine", w2="sine", l2=60, s2=31, s1=24,
       amp=(0, 80, 0, 65), f=("lp12", 127, 0)),
    gm(11, "Music Box", w1="sine", w2="sine", l2=40, s2=24, c2=4, s1=12,
       amp=(0, 82, 0, 70), ch=(40, 1, 25, 60)),
    gm(12, "Vibraphone", w1="sine", w2="sine", l2=35, s2=24, s1=0,
       amp=(0, 105, 0, 75), lfo1=("sine", 55),
       mods=[("lfo1_uni", "osc1_level", -25)], ch=25),
    gm(13, "Marimba", t60=1.0, w1="sine", w2="triangle", l2=45, s2=12,
       amp=(0, 62, 0, 30), f=("lp12", 90, 0), vel=20),
    gm(14, "Xylophone", t60=0.5, w1="sine", w2="triangle", l2=55, s2=19, s1=12,
       amp=(0, 50, 0, 25), vel=20),
    gm(15, "Tubular Bells", w1="sine", w2="sine", l1=80, s2=17, c2=3,
       ring=70, amp=(0, 110, 0, 90), ch=30),
    gm(16, "Dulcimer", w1="sawtooth", w2="sawtooth", l2=110, c2=10,
       f=("lp12", 75, 15), amp=(0, 88, 0, 50), fe=(0, 55, 10, 40, 30)),

    # ---------------- Organ 17-24
    gm(17, "Drawbar Organ", w1="sine", w2="sine", l2=100, s2=12, s1=0,
       d1=(30, 0), amp=(0, 90, 127, 8), lfo1=("sine", 85), ch=(60, 1, 70, 40)),
    gm(18, "Perc Organ", w1="sine", w2="sine", l2=90, s2=19,
       ring=0, e3=(0, 35, 0), mods=[("env3", "osc2_level", 40)],
       amp=(0, 90, 127, 8), ch=(55, 1, 70, 40)),
    gm(19, "Rock Organ", w1="sine", w2="square", l2=60, s2=12,
       amp=(0, 90, 127, 10), drive=(55, "valve"), dist=(30, "valve"),
       ch=(70, 1, 85, 60)),
    gm(20, "Church Organ", w1="sine", w2="sawtooth", l2=50, s2=12,
       d1=(60, 20), f=("lp12", 95, 0), amp=(20, 90, 127, 55), ch=40),
    gm(21, "Reed Organ", w1="saw 5:5", w2="square", l2=60, s2=12,
       f=("lp12", 65, 10), amp=(15, 90, 115, 25), ch=20),
    gm(22, "Accordion", w1="saw 6:4", w2="saw 6:4", l2=120, c2=9,
       f=("lp12", 78, 15), amp=(8, 90, 120, 20), ch=(30, 1, 40, 50)),
    gm(23, "Harmonica", w1="square", w2="saw 8:2", l2=50, mono="ag", port=10,
       f=("bp12", 75, 35), amp=(10, 90, 110, 15), vib=2, noise=8),
    gm(24, "Tango Accordion", w1="saw 6:4", w2="saw 4:6", l2=120, c2=6,
       f=("lp12", 85, 20), amp=(5, 85, 115, 18), ch=35),

    # ---------------- Guitar 25-32
    gm(25, "Nylon Guitar", w1="triangle", w2="sawtooth", l2=40,
       f=("lp24", 55, 10), amp=(0, 85, 0, 35), fe=(0, 45, 10, 30, 30), vel=25),
    gm(26, "Steel Guitar", w1="sawtooth", w2="sawtooth", l2=80, c2=5,
       f=("lp12", 70, 15), amp=(0, 90, 0, 40), fe=(0, 50, 15, 35, 35), vel=25,
       ch=25),
    gm(27, "Jazz Guitar", w1="triangle", w2="saw 7:3", l2=50,
       f=("lp24", 48, 15), amp=(0, 88, 0, 35), fe=(0, 40, 20, 30, 20), vel=20),
    gm(28, "Clean Guitar", w1="saw 7:3", w2="sawtooth", l2=60, c2=4,
       f=("lp12", 75, 20), amp=(0, 88, 0, 40), fe=(0, 45, 20, 35, 30),
       ch=(50, 1, 40, 70), vel=20),
    gm(29, "Muted Guitar", t60=0.25, w1="sawtooth", f=("lp24", 40, 25),
       amp=(0, 40, 0, 12), fe=(0, 25, 0, 10, 35), vel=25),
    gm(30, "Overdrive Guitar", post=4, w1="sawtooth", w2="sawtooth", l2=100, c2=8,
       f=("lp24", 70, 20), drive=(80, "valve"), dist=(60, "valve"),
       amp=(0, 100, 90, 30), mono="ag", port=5),
    gm(31, "Distortion Gtr", post=2, w1="sawtooth", w2="square", l2=100, c2=10,
       s2=-12, f=("lp24", 75, 25), drive=(110, "clipper"),
       dist=(95, "clipper"), amp=(0, 100, 100, 30), mono="ag", port=5),
    gm(32, "Gtr Harmonics", w1="sine", w2="sine", l2=60, s1=12, s2=19,
       amp=(0, 95, 0, 60), ch=35),

    # ---------------- Bass 33-40
    gm(33, "Acoustic Bass", w1="triangle", w2="sine", l2=90, oct=-1,
       f=("lp24", 40, 5), amp=(0, 87, 0, 58), fe=(0, 30, 0, 58, 20), vel=20,
       mono=True),
    gm(34, "Finger Bass", w1="sawtooth", w2="sine", l2=100, oct=-1,
       f=("lp24", 35, 10), amp=(0, 92, 60, 55), fe=(0, 35, 10, 55, 25),
       vel=20, mono=True),
    gm(35, "Pick Bass", w1="sawtooth", w2="square", l2=70, oct=-1,
       f=("lp24", 45, 20), amp=(0, 90, 45, 55), fe=(0, 25, 5, 55, 40),
       vel=25, mono=True),
    gm(36, "Fretless Bass", w1="triangle", w2="sawtooth", l2=40, oct=-1,
       f=("lp24", 42, 15), amp=(3, 90, 90, 61), mono="ag", port=25, vib=1),
    gm(37, "Slap Bass 1", w1="sawtooth", w2="square", l2=80, oct=-1,
       f=("lp24", 55, 30), amp=(0, 87, 35, 51), fe=(0, 20, 0, 51, 50),
       vel=30, mono=True),
    gm(38, "Slap Bass 2", w1="square", w2="sawtooth", l2=90, c2=6, oct=-1,
       f=("lp24", 65, 40), amp=(0, 85, 30, 51), fe=(0, 18, 0, 51, 55),
       vel=30, mono=True, drive=(30, "valve")),
    gm(39, "Synth Bass 1", w1="sawtooth", oct=-1, f=("lp24", 30, 70),
       amp=(0, 80, 80, 48), fe=(0, 40, 0, 48, 40), mono="ag", port=15,
       drive=(30, "valve")),
    gm(40, "Synth Bass 2", w1="square", w2="sawtooth", l2=110, c2=12, oct=-1,
       f=("lp24", 40, 40), amp=(0, 85, 90, 51), fe=(0, 50, 20, 51, 30),
       mono=True),

    # ---------------- Strings 41-48
    gm(41, "Violin", w1="sawtooth", w2="saw 8:2", l2=60, c2=5, mono="ag",
       port=12, f=("lp12", 85, 15), amp=(30, 90, 120, 30), vib=3, ch=20,
       x={"lfo2_delay": 40}),
    gm(42, "Viola", w1="sawtooth", w2="saw 8:2", l2=60, c2=5, oct=-1,
       mono="ag", port=12, f=("lp12", 75, 15), amp=(32, 90, 120, 32), vib=3),
    gm(43, "Cello", eq=(4, -2, 2), w1="sawtooth", w2="saw 7:3", l2=70, c2=4, oct=-1,
       s1=-12, s2=-12, mono="ag", port=12, f=("lp12", 62, 15),
       amp=(30, 90, 120, 35), vib=2),
    gm(44, "Contrabass", eq=(5, -2, 2), w1="sawtooth", w2="saw 7:3", l2=70, oct=-1,
       mono="ag", port=10, f=("lp12", 50, 10), amp=(30, 90, 120, 65), vib=2),
    gm(45, "Tremolo Strings", w1="sawtooth", w2="sawtooth", l2=110, c2=7,
       d1=(40, 30), f=("lp12", 80, 10), amp=(10, 90, 120, 50),
       lfo1=("triangle", 95), mods=[("lfo1_uni", "osc1_level", -40),
                                    ("lfo1_uni", "osc2_level", -40)], ch=50),
    gm(46, "Pizzicato", t60=0.4, w1="sawtooth", w2="triangle", l2=60, c2=5,
       f=("lp24", 55, 10), amp=(0, 55, 0, 30), fe=(0, 30, 0, 20, 30), vel=25,
       ch=40),
    gm(47, "Orchestral Harp", w1="triangle", w2="sine", l2=80, s2=12,
       f=("lp12", 80, 5), amp=(0, 95, 0, 60), fe=(0, 40, 10, 40, 20), vel=20,
       ch=30),
    gm(48, "Timpani", eq=(5, 0, -3), w1="sine", w2="triangle", l2=50, noise=25, oct=-1,
       e3=(0, 40, 0), mods=[("env3", "pitch", 6)], f=("lp24", 45, 10),
       amp=(0, 90, 0, 60), vel=30),

    # ---------------- Ensemble 49-56
    gm(49, "String Ens 1", w1="sawtooth", w2="sawtooth", l2=110, c2=8,
       d1=(50, 35), d2=(50, 45), f=("lp12", 78, 10), amp=(35, 90, 120, 55),
       ch=(70, 1, 25, 80)),
    gm(50, "String Ens 2", w1="sawtooth", w2="sawtooth", l2=110, c2=8,
       d1=(60, 40), d2=(60, 50), f=("lp12", 72, 10), amp=(60, 90, 120, 70),
       ch=(75, 1, 20, 85)),
    gm(51, "Synth Strings 1", w1="sawtooth", w2="pulse width", l2=100,
       s2=12, lfo1=("triangle", 40), mods=[("lfo1_bi", "osc2_pw", 25)],
       f=("lp12", 82, 10), amp=(40, 90, 118, 60), ch=(90, 1, 30, 95)),
    gm(52, "Synth Strings 2", w1="sawtooth", w2="sawtooth", l2=110, c2=10,
       d1=(70, 50), f=("lp24", 70, 25), amp=(50, 90, 115, 65),
       fe=(60, 90, 60, 60, 15), ch=(80, 0, 20, 70)),
    gm(53, "Choir Aahs", w1="digital vocal 4", w2="digital vocal 5",
       i1=95, i2=110, d1=(45, 40), d2=(45, 50), l1=100, l2=95, c2=7,
       noise=12, f=("lp12", 88, 30), amp=(55, 90, 118, 70), vib=2,
       ch=(85, 1, 28, 85), mac={1: [("osc1_interpolate", -60),
                                   ("osc2_interpolate", -60)]}),
    gm(54, "Voice Oohs", w1="digital vocal 1", w2="digital vocal 1", i1=10,
       i2=25, d1=(35, 30), d2=(35, 40), l1=110, l2=100, c2=5, noise=5,
       f=("lp24", 50, 12), amp=(65, 90, 120, 80), vib=2,
       ch=(90, 1, 20, 95), mac={1: [("osc1_interpolate", 55),
                                   ("osc2_interpolate", 50)]}),
    gm(55, "Synth Voice", w1="digital vocal 3", w2="sawtooth", l2=50,
       i1=60, c2=6, f=("lp12", 85, 30), amp=(30, 90, 115, 55),
       lfo1=("triangle", 30), mods=[("lfo1_bi", "osc1_pw", 12)], vib=2,
       ch=70, mac={1: [("osc1_interpolate", 60)]}),
    gm(56, "Orchestra Hit", w1="sawtooth", w2="sawtooth", l2=110, s2=7,
       d1=(70, 50), d2=(70, 50), noise=30, f=("lp24", 90, 10),
       amp=(0, 55, 0, 40), fe=(0, 35, 0, 30, 25), ch=60),

    # ---------------- Brass 57-64
    gm(57, "Trumpet", w1="sawtooth", w2="saw 9:1", l2=50, mono="ag", port=8,
       f=("lp24", 55, 20), amp=(6, 90, 115, 18), fe=(6, 50, 60, 20, 35),
       vib=2, vel=20),
    gm(58, "Trombone", w1="sawtooth", w2="sawtooth", l2=60, c2=4, oct=-1,
       mono="ag", port=25, f=("lp24", 45, 15), amp=(10, 90, 115, 22),
       fe=(10, 55, 55, 20, 30), vib=1),
    gm(59, "Tuba", eq=(5, 2, -3), w1="sawtooth", w2="sine", l2=90, oct=-1, mono="ag",
       port=15, f=("lp24", 35, 10), amp=(10, 90, 115, 61),
       fe=(10, 50, 50, 61, 20)),
    gm(60, "Muted Trumpet", w1="sawtooth", mono="ag", port=8,
       f=("bp12", 70, 45), amp=(5, 90, 110, 15), fe=(5, 40, 50, 15, 20),
       vib=2),
    gm(61, "French Horn", w1="sawtooth", w2="triangle", l2=90, oct=-1,
       f=("lp24", 40, 10), amp=(20, 90, 118, 35), fe=(20, 70, 60, 30, 15),
       vib=1, ch=25),
    gm(62, "Brass Section", w1="sawtooth", w2="sawtooth", l2=110, c2=9,
       d1=(40, 30), f=("lp24", 55, 15), amp=(6, 90, 118, 25),
       fe=(8, 55, 60, 25, 35), ch=35),
    gm(63, "Synth Brass 1", w1="sawtooth", w2="sawtooth", l2=110, c2=12,
       f=("lp24", 35, 25), amp=(2, 90, 115, 25), fe=(5, 60, 40, 25, 45),
       ch=30),
    gm(64, "Synth Brass 2", w1="saw 6:4", w2="sawtooth", l2=110, c2=8,
       s2=12, f=("lp24", 45, 30), amp=(12, 90, 118, 35),
       fe=(25, 70, 50, 35, 35), ch=(60, 0, 20, 70)),

    # ---------------- Reed 65-72
    gm(65, "Soprano Sax", w1="saw 8:2", w2="square", l2=40, mono="ag",
       port=10, noise=10, f=("lp24", 75, 25), amp=(6, 90, 115, 18),
       fe=(5, 40, 60, 15, 20), vib=3),
    gm(66, "Alto Sax", w1="saw 8:2", w2="square", l2=50, mono="ag", port=10,
       noise=10, f=("lp24", 62, 25), amp=(6, 90, 115, 18),
       fe=(5, 40, 60, 15, 22), vib=3, drive=(20, "valve")),
    gm(67, "Tenor Sax", w1="sawtooth", w2="square", l2=60, oct=-1,
       mono="ag", port=10, noise=12, f=("lp24", 52, 25), amp=(6, 90, 115, 18),
       fe=(5, 40, 60, 15, 25), vib=3, drive=(35, "valve")),
    gm(68, "Baritone Sax", w1="sawtooth", w2="square", l2=70, oct=-1,
       mono="ag", port=10, noise=12, f=("lp24", 45, 25), amp=(6, 90, 115, 58),
       fe=(5, 40, 60, 58, 25), vib=2, drive=(45, "valve")),
    gm(69, "Oboe", w1="pulse width", pw1=-35, mono="ag", port=8,
       f=("bp12", 82, 35), amp=(8, 90, 115, 15), vib=2),
    gm(70, "English Horn", w1="pulse width", pw1=-30, oct=-1, mono="ag",
       port=8, f=("bp12", 72, 30), amp=(10, 90, 115, 18), vib=2),
    gm(71, "Bassoon", w1="pulse width", pw1=-40, oct=-1, mono="ag", port=8,
       f=("lp24", 48, 25), amp=(10, 90, 115, 58), vib=1),
    gm(72, "Clarinet", w1="square", mono="ag", port=8, noise=5,
       f=("lp24", 60, 15), amp=(8, 90, 118, 18), vib=1),

    # ---------------- Pipe 73-80
    gm(73, "Piccolo", eq=(-6, 2, 4), w1="sine", w2="triangle", l2=40, oct=1, mono="ag",
       port=6, noise=14, f=("lp12", 110, 0), amp=(8, 90, 115, 15), vib=3),
    gm(74, "Flute", w1="sine", w2="triangle", l2=45, mono="ag", port=8,
       noise=16, f=("lp12", 95, 0), amp=(10, 90, 115, 20), vib=3),
    gm(75, "Recorder", w1="triangle", w2="sine", l2=60, s2=12, noise=8,
       f=("lp12", 100, 0), amp=(6, 90, 118, 15), vib=1),
    gm(76, "Pan Flute", w1="sine", noise=30, f=("lp12", 90, 10),
       amp=(15, 90, 110, 30), e3=(0, 25, 0),
       mods=[("env3", "noise_level", 30)], vib=2, ch=30),
    gm(77, "Blown Bottle", w1="sine", noise=90, f=("bp12", 70, 40),
       track=127, amp=(20, 90, 110, 30), vib=1),
    gm(78, "Shakuhachi", w1="sine", w2="triangle", l2=30, noise=40,
       f=("lp12", 80, 15), amp=(25, 90, 110, 35), e3=(0, 30, 0),
       mods=[("env3", "pitch", -3), ("env3", "noise_level", 30)], vib=3,
       mono="ag", port=15),
    gm(79, "Whistle", w1="sine", oct=1, noise=4, f=("lp12", 127, 0),
       amp=(8, 90, 120, 15), mono="ag", port=15, vib=3),
    gm(80, "Ocarina", w1="sine", w2="triangle", l2=25, noise=6,
       f=("lp12", 110, 0), amp=(10, 90, 118, 20), vib=2),

    # ---------------- Synth lead 81-88
    gm(81, "Square Lead", w1="square", w2="square", l2=90, c2=6, mono="ag",
       port=12, f=("lp24", 90, 15), amp=(0, 90, 120, 20), vib=2),
    gm(82, "Saw Lead", w1="sawtooth", w2="sawtooth", l2=110, c2=10,
       mono="ag", port=12, f=("lp24", 88, 25), amp=(0, 90, 120, 20),
       fe=(0, 60, 80, 20, 15), vib=2),
    gm(83, "Calliope Lead", w1="triangle", w2="sine", l2=60, s2=12,
       noise=25, f=("lp12", 100, 0), amp=(8, 90, 118, 25), vib=3, ch=35),
    gm(84, "Chiff Lead", w1="saw 5:5", w2="sine", l2=60, noise=20,
       e3=(0, 20, 0), mods=[("env3", "noise_level", 50)],
       f=("lp12", 85, 10), amp=(0, 90, 110, 25), vib=2, mono="ag", port=8),
    gm(85, "Charang Lead", post=4, w1="sawtooth", w2="square", l2=100, c2=8,
       f=("lp24", 80, 30), drive=(90, "valve"), dist=(70, "valve"),
       amp=(0, 95, 100, 25), mono="ag", port=8, vib=2),
    gm(86, "Voice Lead", w1="digital vocal 2", w2="sawtooth", l2=50, i1=50,
       f=("lp12", 90, 25), amp=(10, 90, 118, 25), mono="ag", port=12,
       vib=3, ch=50, mac={1: [("osc1_interpolate", 60)]}),
    gm(87, "Fifths Lead", w1="sawtooth", w2="sawtooth", l2=110, s2=7,
       f=("lp24", 82, 20), amp=(0, 90, 120, 20), fe=(0, 55, 70, 20, 15),
       mono="ag", port=10, vib=2),
    gm(88, "Bass + Lead", w1="sawtooth", w2="square", l2=110, s2=-12,
       f=("lp24", 70, 30), amp=(0, 90, 115, 18), fe=(0, 45, 50, 18, 25),
       mono="ag", port=10, drive=(40, "valve")),

    # ---------------- Synth pad 89-96
    gm(89, "New Age Pad", w1="sine", w2="sawtooth", l2=60, s2=12, ring=30,
       f=("lp12", 75, 15), amp=(30, 100, 110, 85), fe=(40, 100, 60, 80, 20),
       ch=(80, 1, 25, 90)),
    gm(90, "Warm Pad", w1="sawtooth", w2="sawtooth", l2=110, c2=8,
       d1=(30, 30), f=("lp12", 58, 20), amp=(70, 90, 120, 80),
       fe=(80, 100, 60, 80, 20), lfo1=("triangle", 30),
       mods=[("lfo1_bi", "filter_frequency", 10)], ch=(70, 1, 20, 90)),
    gm(91, "Polysynth Pad", w1="sawtooth", w2="pulse width", l2=100, c2=6,
       f=("lp24", 55, 25), amp=(10, 90, 110, 50), fe=(5, 70, 40, 50, 30),
       ch=50),
    gm(92, "Choir Pad", w1="digital vocal 1", w2="digital vocal 4", i1=40,
       i2=70, d1=(40, 35), d2=(40, 45), l1=105, l2=95, c2=6, noise=12,
       f=("lp12", 70, 25), amp=(62, 90, 118, 75), fe=(70, 95, 70, 75, 14),
       lfo1=("triangle", 22), mods=[("lfo1_bi", "filter_frequency", 6),
                                    ("lfo1_bi", "osc1_pw", 8)],
       vib=2, ch=(85, 1, 25, 90),
       mac={1: [("osc1_interpolate", 63), ("osc2_interpolate", -50)]}),
    gm(93, "Bowed Pad", w1="triangle-saw blend", w2="sawtooth", l2=70,
       c2=5, noise=10, f=("bp12", 65, 30), amp=(80, 100, 115, 85),
       lfo1=("sine", 25), mods=[("lfo1_bi", "filter_frequency", 12)], vib=1,
       ch=60),
    gm(94, "Metallic Pad", w1="sawtooth", w2="sawtooth", l2=100, s2=7,
       c2=20, ring=60, f=("lp12", 80, 40), amp=(50, 100, 110, 80),
       lfo1=("triangle", 18), mods=[("lfo1_bi", "osc2_pitch", 4)],
       ch=(80, 0, 15, 90, 30)),
    gm(95, "Halo Pad", w1="digital vocal 3", w2="sine", l2=80, s2=12,
       i1=70, noise=8, f=("lp12", 85, 25), amp=(75, 100, 115, 95),
       ch=(95, 1, 20, 100), vib=1, mac={1: [("osc1_interpolate", -50)]}),
    gm(96, "Sweep Pad", w1="sawtooth", w2="sawtooth", l2=110, c2=10,
       f=("lp24", 30, 60), amp=(40, 100, 115, 80), lfo1=("triangle", 12),
       mods=[("lfo1_bi", "filter_frequency", 35)], ch=(70, 0, 15, 80)),

    # ---------------- Synth FX 97-104
    gm(97, "FX Rain", w1="sine", w2="sine", l2=60, s2=24, noise=40,
       f=("hp12", 60, 20), amp=(0, 85, 30, 60), lfo1=("random s/h", 100),
       mods=[("lfo1_bi", "osc1_pitch", 12)], ch=60),
    gm(98, "FX Soundtrack", w1="sawtooth", w2="digital vocal 2", l2=90,
       i2=60, c2=12, f=("lp12", 60, 30), amp=(70, 110, 110, 100),
       lfo1=("triangle", 10), mods=[("lfo1_bi", "filter_frequency", 25)],
       ch=(90, 1, 15, 100)),
    gm(99, "FX Crystal", w1="sine", w2="sine", l2=70, s2=31, s1=12, ring=40,
       amp=(0, 100, 20, 90), lfo1=("random s/h", 90),
       mods=[("lfo1_uni", "ring_level", 30)], ch=(80, 1, 30, 90)),
    gm(100, "FX Atmosphere", w1="analogue pulse", w2="sawtooth", l2=70,
       c2=7, noise=15, f=("lp12", 70, 30), amp=(30, 100, 100, 90),
       lfo1=("sine", 15), mods=[("lfo1_bi", "osc1_pw", 25)], ch=(85, 1, 15, 90)),
    gm(101, "FX Brightness", w1="sawtooth", w2="sawtooth", l2=110, s2=12,
       c2=8, f=("hp12", 50, 30), amp=(20, 100, 110, 80), ch=(90, 1, 30, 90)),
    gm(102, "FX Goblins", w1="digital nasty 1", w2="sawtooth", l2=60,
       i1=60, s2=-12, f=("bp12", 60, 60), amp=(60, 100, 110, 80),
       lfo1=("random s/h", 40), mods=[("lfo1_bi", "filter_frequency", 30)],
       ch=(70, 0, 20, 80)),
    gm(103, "FX Echoes", w1="sine", w2="triangle", l2=60, s2=12,
       amp=(0, 100, 0, 110), lfo1=("square", 80),
       mods=[("lfo1_uni", "osc1_level", -45), ("lfo1_uni", "osc2_level", -45)],
       ch=(70, 1, 10, 90, 50)),
    gm(104, "FX Sci-fi", w1="digital nasty 2", w2="sine", l2=70, i1=40,
       ring=50, f=("lp12", 85, 50), amp=(10, 100, 100, 80),
       lfo1=("sine", 60), mods=[("lfo1_bi", "osc2_pitch", 20)], ch=50),

    # ---------------- Ethnic 105-112
    gm(105, "Sitar", w1="sawtooth", w2="sawtooth", l2=90, c2=12, vs1=50,
       f=("bp12", 85, 50), amp=(0, 100, 0, 50), e3=(0, 30, 0),
       mods=[("env3", "pitch", 2)], vib=1),
    gm(106, "Banjo", t60=1.0, w1="saw 8:2", w2="pulse width", l2=60, s2=12,
       f=("bp12", 85, 30), amp=(0, 60, 0, 25), fe=(0, 25, 0, 15, 25), vel=20),
    gm(107, "Shamisen", t60=0.8, w1="sawtooth", f=("bp12", 90, 45),
       amp=(0, 55, 0, 25), fe=(0, 20, 0, 15, 30), vel=25),
    gm(108, "Koto", w1="saw 7:3", w2="triangle", l2=60, s2=12,
       f=("lp12", 80, 25), amp=(0, 85, 0, 50), fe=(0, 35, 10, 30, 25),
       e3=(0, 20, 0), mods=[("env3", "pitch", 1)], vel=20),
    gm(109, "Kalimba", t60=1.2, w1="sine", w2="sine", l2=40, s2=24, c2=10,
       amp=(0, 60, 0, 40), f=("lp12", 100, 0), vel=25),
    gm(110, "Bagpipe", w1="saw 8:2", w2="sawtooth", l2=80, s2=-12,
       f=("bp12", 85, 35), amp=(5, 90, 120, 10), vib=0, noise=5,
       drive=(30, "valve")),
    gm(111, "Fiddle", w1="sawtooth", w2="saw 9:1", l2=60, c2=5, mono="ag",
       port=10, f=("lp12", 90, 25), amp=(12, 90, 118, 20), vib=3),
    gm(112, "Shanai", w1="pulse width", pw1=-45, mono="ag", port=12,
       f=("bp12", 92, 50), amp=(8, 90, 115, 15), vib=3,
       drive=(30, "valve")),

    # ---------------- Percussive 113-120
    gm(113, "Tinkle Bell", eq=(-4, 0, 5), w1="sine", w2="sine", l1=80, s1=12, s2=30, c2=5,
       ring=70, amp=(0, 75, 0, 55), ch=30),
    gm(114, "Agogo", t60=0.7, eq=(-4, 2, 4), w1="sine", w2="sine", l1=127, l2=90,
       s1=12, s2=29, ring=40, amp=(0, 55, 0, 30), f=("lp12", 127, 0)),
    gm(115, "Steel Drums", eq=(-3, 2, 5), w1="sine", w2="triangle", l2=70, s2=19, c2=8,
       ring=30, amp=(0, 70, 0, 40), e3=(0, 15, 0),
       mods=[("env3", "pitch", 2)], ch=30),
    gm(116, "Woodblock", t60=0.25, w1="triangle", w2="sine", l1=127, l2=90, s1=12,
       s2=19, noise=30, amp=(0, 25, 0, 15), f=("lp12", 110, 10)),
    gm(117, "Taiko Drum", eq=(6, -2, -3), w1="sine", noise=35, oct=-2, e3=(0, 30, 0),
       mods=[("env3", "pitch", 8)], f=("lp24", 40, 10),
       amp=(0, 75, 0, 45), vel=30),
    gm(118, "Melodic Tom", eq=(5, -2, 1), w1="sine", w2="triangle", l2=40, noise=15,
       oct=-1, e3=(0, 30, 0), mods=[("env3", "pitch", 10)],
       f=("lp24", 55, 10), amp=(0, 65, 0, 35), vel=30),
    gm(119, "Synth Drum", eq=(5, 0, 0), w1="sine", noise=10, oct=-1, e3=(0, 35, 0),
       mods=[("env3", "pitch", 20)], amp=(0, 60, 0, 30), vel=25),
    gm(120, "Reverse Cymbal", w1="sine", l1=0, noise=127, f=("hp24", 90, 20),
       amp=(90, 90, 127, 5), fe=(90, 90, 127, 5, 20)),

    # ---------------- Sound effects 121-128
    gm(121, "Gtr Fret Noise", t60=0.15, w1="sawtooth", l1=40, noise=90,
       f=("bp12", 90, 60), amp=(0, 30, 0, 15), e3=(0, 20, 0),
       mods=[("env3", "filter_frequency", 25)]),
    gm(122, "Breath Noise", w1="sine", l1=0, noise=110, f=("bp6", 80, 20),
       amp=(25, 90, 110, 40), lfo1=("sine", 20),
       mods=[("lfo1_bi", "filter_frequency", 10)]),
    gm(123, "Seashore", w1="sine", l1=0, noise=127, f=("lp12", 60, 10),
       amp=(40, 100, 120, 90), lfo1=("sine", 8),
       mods=[("lfo1_bi", "filter_frequency", 35),
             ("lfo1_uni", "noise_level", -40)]),
    gm(124, "Bird Tweet", eq=(-5, 0, 3), w1="sine", oct=2, amp=(0, 90, 120, 20),
       lfo1=("triangle", 105), mods=[("lfo1_bi", "pitch", 25)],
       e3=(0, 20, 0)),
    gm(125, "Telephone Ring", w1="square", w2="square", l2=80, s2=28,
       s1=24, f=("lp12", 100, 0), amp=(0, 90, 127, 10),
       lfo1=("square", 110), mods=[("lfo1_uni", "osc1_level", -63),
                                   ("lfo1_uni", "osc2_level", 63)]),
    gm(126, "Helicopter", w1="sine", l1=50, noise=110, oct=-2,
       f=("lp24", 50, 30), amp=(30, 90, 127, 40), lfo1=("square", 75),
       mods=[("lfo1_uni", "noise_level", -60),
             ("lfo1_uni", "filter_frequency", 25)]),
    gm(127, "Applause", w1="sine", l1=0, noise=127, f=("bp12", 85, 20),
       amp=(40, 100, 120, 70), lfo1=("random s/h", 115),
       mods=[("lfo1_uni", "noise_level", -55)]),
    gm(128, "Gunshot", t60=0.6, eq=(5, 0, 2), w1="sine", l1=60, noise=127, oct=-2,
       f=("lp24", 90, 10), amp=(0, 45, 0, 35), fe=(0, 35, 0, 30, 30),
       e3=(0, 15, 0), mods=[("env3", "pitch", 20)],
       dist=(60, "clipper")),
]

def retune(P):
    """Shift each family's low-pass patches so the family median hits FAMILY_CUTOFF,
    then point macro 5 at a sensible sweep from there."""
    a_f, a_t = F["filter_frequency"][0], F["filter_type"][0]
    lp = lambda p: p.data[a_t] in (0, 1) and p.data[a_f] < 110
    for fam_start, target in FAMILY_CUTOFF.items():
        group = [p for n, p in P if family(n) == fam_start and lp(p)]
        if not target or not group:
            continue
        vals = sorted(p.data[a_f] for p in group)
        med = (vals[(len(vals) - 1) // 2] + vals[len(vals) // 2]) / 2
        shift = round(cutoff(target) - med)
        for p in group:
            p.data[a_f] = max(0, min(127, p.data[a_f] + shift))
    for n, p in P:
        if n in FILTER_OVERRIDE:
            p.data[a_f] = FILTER_OVERRIDE[n]
        t = LOUD_TRIM.get(n, 0)
        if t < 0:
            p.data[F["post_fx_level"][0]] += t
        elif t > 0:
            p.data[F["pre_fx_level"][0]] = 64 + min(t, 12)
        v = p.data[a_f]
        depth = min(63, 127 - v) if v < 100 else -40        # open it, or close bright ones
        p.data[204 + 17 * 4 + 1 + 3] = 64 + depth           # macro 5, target 1 depth
    return P


P = retune(P)

if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    assert [n for n, _ in P] == list(range(1, 129)), "numbering gap"
    for n, p in P:
        p.write(os.path.join(OUT, f"{n:03d} {p.name}.syx"))
    print(f"wrote {len(P)} patches to {OUT}/")
