"""TracksGM edit 2026-11-05: wavetable re-voice (Index instead of Interpolate) + macro 7 depth.

    python3 revoice_tracksgm_wt.py      (edits tracksgm_patches.json in place; run once)

Calibration set 2 showed Index (bytes 38/47) picks one of 9 waveforms (centres 0,16,...,112,127)
and Interpolate (37/46) only smooths between them. The tables have no fixed formants, so
positions were chosen from measured spectra at C2 (rec_cal2/wt_results.csv):
  "ooh"-like (dark, fundamental-heavy): vocal 6 / vocal 3 / vocal 5 position 1 (Index 0)
  "aah"-like (peaks ~670 + ~1100-1360 Hz): vocal 5 Index 64, vocal 4 Index 16/32, vocal 1 Index 64
Interpolate is set to 127 so the morph macros glide between waveforms. Macro 1 on the vocal
patches now moves Index (osc*_pw) instead of Interpolate. Macro depth scaling is unmeasured,
so morph depths are +/-16..32 (clamping at the table ends is harmless).
"""
import json
import ctpatch as c

JSON = "tracksgm_patches.json"
W = c.OSC_WAVES.index
IX1, IX2, I1, I2, W1, W2 = 38, 47, 37, 46, 36, 45

# patch number: (osc1 wave or None to keep, osc1 Index, osc2 wave/None, osc2 Index/None, macro 1 targets or None)
PLAN = {
    53: (None, 32, None, 64, [("osc1_pw", -32), ("osc2_pw", -32)]),          # Choir Aahs: aah -> darker
    54: (W("digital vocal 6"), 0, W("digital vocal 3"), 0,
         [("osc1_pw", 32), ("osc2_pw", 32)]),                                   # Voice Oohs: ooh -> opener
    55: (None, 64, None, None, [("osc1_pw", 32)]),                              # Synth Voice
    86: (None, 32, None, None, [("osc1_pw", 32)]),                              # Voice Lead: brighter on macro
    92: (None, 64, None, 16, [("osc1_pw", -32), ("osc2_pw", -16)]),          # Choir Pad
    95: (None, 48, None, None, [("osc1_pw", 32)]),                              # Halo Pad
    98: (None, None, None, 96, None),                                           # FX Soundtrack (osc 2 table)
    102: (None, 96, None, None, None),                                          # FX Goblins (+ LFO -> Index below)
    104: (None, 112, None, None, None),                                         # FX Sci-fi
}
MACRO7_DEPTH = 6        # vibrato macro (-> mod 20 depth): was +4

# Loudness re-measured on hardware after the re-voice (lab rec_wt_check, -26 LUFS target):
# 54 Voice Oohs -13 dB (its +12 dB Pre FX boost was distorting), 86 -3, 102 +3, 55 +1.
# (Pre FX, Post FX) as stored; both are 1 dB/step from 64.
WT_LEVELS = {54: (64, 75), 55: (66, 76), 86: (66, 76), 102: (66, 76)}


def main():
    j = json.load(open(JSON))
    log = []
    for e in j["patches"]:
        n = e["slot"] + 1
        p = c.Patch("x")
        p.data[:] = bytes.fromhex(e["data"])
        d = p.data
        # macro 7 slot A -> mod20 depth: +4 -> +6
        b = 204 + 17 * 6 + 1
        if d[b] == c.MACRO_DESTS.index("mod20_depth") and d[b + 3] == 64 + 4:
            d[b + 3] = 64 + MACRO7_DEPTH
            log.append(f"{n:03d} macro 7 depth +6")
        if n in PLAN:
            w1, ix1, w2, ix2, m1 = PLAN[n]
            if w1 is not None:
                d[W1] = w1
            if ix1 is not None:
                d[IX1], d[I1] = ix1, 127
            if w2 is not None:
                d[W2] = w2
            if ix2 is not None:
                d[IX2], d[I2] = ix2, 127
            if m1:
                for r in range(4):                      # clear knob 1, then set targets
                    bb = 204 + 1 + 4 * r
                    d[bb:bb + 4] = bytes([0, 0, 127, 64])
                p.macro(1, m1)
            if n == 102:
                p.mod(2, "lfo1_bi", "osc1_pw", 20)      # random S/H -> Index: goblin chatter
            log.append(f"{n:03d} {e['name']}: wavetable re-voice")
        if n in WT_LEVELS:
            d[58], d[59] = WT_LEVELS[n]
        e["data"] = bytes(d).hex()
    json.dump(j, open(JSON, "w"), indent=0)
    print(f"{sum('macro 7' in l for l in log)} macro-7 depths raised; " +
          ", ".join(l for l in log if "re-voice" in l))


if __name__ == "__main__":
    main()
