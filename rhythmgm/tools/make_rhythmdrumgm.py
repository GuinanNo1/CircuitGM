"""Build RhythmDrumGM: the eight GeneralUser GS drum kits for the Circuit Rhythm, 16 hits each.

    python3 rhythmgm/tools/make_rhythmdrumgm.py /path/to/GeneralUser-GS.sf2   (from the repo root)

Every kit has the same 16 roles in the same order, so a pattern keeps working when you swap
kits, and any one kit drops straight into slots 113-128 of RhythmInstGM:

   1 Kick      2 Kick 2    3 Snare     4 Snare 2   5 Rim       6 Clap      7 CH        8 Pedal HH
   9 OH       10 Tom Lo   11 Tom Mid  12 Tom Hi   13 Crash    14 Ride     15 extra    16 extra

Kits (slots): Std 1-16, Room 17-32, Power 33-48, Elec 49-64, 808 65-80, Jazz 81-96,
Brush 97-112, Orch 113-128. The GM note for each role is in ROLES; KITS overrides it where a
kit has its sound elsewhere, or where TracksGM_final uses a different pick (Ian's choices in
tracksgm/tools/make_drums.py are kept). A note may be (GS program, note) to borrow from
another kit. Slots 15-16 are extra percussion, different per kit.

Rendering is make_drums.py's chain (FluidSynth, velocity 110, 48 kHz 16-bit mono, lead-in
trimmed, tail cut at -60 dB with a fade, peak -0.5 dBFS) with the same length caps (cymbals
4 s, open hats, toms and extras 2 s, the rest 1.5 s), so a hit shared with TracksGM sounds
the same on both. All 128 hits use well under the Rhythm's 228.1 s.

Outputs (rhythmgm/): RhythmDrumGM.circuitrhythmpack, RhythmDrumGM_SD.zip,
drum_samples/NNN Name.wav, rhythmdrumgm_samples.json.
"""
import json, os, shutil, sys, wave

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(OUT, "..", "tracksgm", "tools"))
import make_drums as md                                         # noqa: E402
from rhythm_pack import write_pack, write_sd_zip                 # noqa: E402

LIMIT_S = 228.1

# role, default GM note, length cap (s)
ROLES = [("Kick", 36, 1.5), ("Kick 2", 35, 1.5), ("Snare", 38, 1.5), ("Snare 2", 40, 1.5),
         ("Rim", 37, 1.5), ("Clap", 39, 1.5), ("CH", 42, 1.5), ("Pedal HH", 44, 1.5),
         ("OH", 46, 2.0), ("Tom Lo", 41, 2.0), ("Tom Mid", 47, 2.0), ("Tom Hi", 50, 2.0),
         ("Crash", 49, 4.0), ("Ride", 51, 4.0), (None, None, 2.0), (None, None, 2.0)]

# kit, GS program (bank 128), {role index: note or (program, note)}, (extra 1, extra 2) as (name, note)
KITS = [
    ("Std", 0, {}, (("Tamb", 54), ("Cowbell", 56))),
    ("Room", 8, {}, (("Conga Hi", 63), ("Conga Lo", 64))),
    ("Power", 16, {}, (("Cowbell", 56), ("Tamb", 54))),
    ("Elec", 24, {0: (26, 35), 1: 36, 2: (25, 40), 3: 38}, (("Cabasa", 69), ("Maracas", 70))),
    ("808", 25, {0: 35, 1: 36, 13: (0, 51)}, (("Cowbell", 56), ("Claves", 75))),
    ("Jazz", 32, {}, (("Shaker", 82), ("Ride Bell", 53))),
    ("Brush", 40, {}, (("Cabasa", 69), ("Tamb", 54))),
    ("Orch", 48, {0: 35, 1: 36, 5: (0, 39), 6: 27, 7: 28, 8: 29, 12: 59, 13: (0, 51)},
     (("Castanets", 39), ("Triangle", 81))),
]
ORCH_TOMS = {9: "Timp Lo", 10: "Timp Mid", 11: "Timp Hi"}      # GS Orchestra kit: 41-53 are timpani


def plan():
    out = []
    for kit, prog, over, extras in KITS:
        for r, (role, note, cap) in enumerate(ROLES):
            if role is None:
                role, note = extras[r - 14]
            note = over.get(r, note)
            p, n = note if isinstance(note, tuple) else (prog, note)
            if kit == "Orch" and r in ORCH_TOMS:
                role = ORCH_TOMS[r]
            out.append({"kit": kit, "role": role, "name": f"{kit} {role}", "gs_program": p,
                        "note": n, "cap": cap})
    return out


if __name__ == "__main__":
    sf2 = sys.argv[1] if len(sys.argv) > 1 else "GeneralUser-GS.sf2"
    sdir = os.path.join(OUT, "drum_samples")
    os.makedirs(sdir, exist_ok=True)
    for f in os.listdir(sdir):
        if f.endswith(".wav"):
            os.remove(os.path.join(sdir, f))
    # Hits TracksGM already has (same kit and note) are copied from tracksgm/drums, so the
    # two packs share byte-identical samples; the rest are rendered.
    tracks, k = {}, 0
    for kit, prog, notes, names in md.KITS:
        for n, nm in zip(notes, names):
            tracks[n if isinstance(n, tuple) else (prog, n)] = f"{k:02d} {kit} {nm}.wav"
            k += 1
    syn, sfid = md.make_synth(sf2)
    slots, total = plan(), 0.0
    assert len(slots) == 128
    for i, s in enumerate(slots):
        cap = s.pop("cap")
        s["slot"] = i
        s["file"] = f"{i + 1:03d} {s['name']}.wav"
        src = tracks.get((s["gs_program"], s["note"]))
        if src:
            shutil.copyfile(os.path.join(OUT, "..", "tracksgm", "drums", src), os.path.join(sdir, s["file"]))
            s["source"] = f"tracksgm/drums/{src}"
        else:
            md.save(os.path.join(sdir, s["file"]), md.tidy(md.hit(syn, sfid, s["gs_program"], s["note"]), cap))
            s["source"] = f"GeneralUser GS kit {s['gs_program']} note {s['note']}"
        with wave.open(os.path.join(sdir, s["file"])) as w:
            s["seconds"] = round(w.getnframes() / md.SR, 3)
        total += s["seconds"]
        print(f"{i + 1:3d} {s['name']:18s} kit {s['gs_program']:2d} note {s['note']:2d} {s['seconds']:5.2f} s")
    print(f"total {total:.1f} s of {LIMIT_S} s; longest name {max(len(s['name']) for s in slots)}")
    if total > LIMIT_S:
        sys.exit("over the Circuit Rhythm sample limit")
    json.dump({"pack": "RhythmDrumGM", "product": "circuit-rhythm", "total_seconds": round(total, 1),
               "limit_seconds": LIMIT_S, "roles": [r[0] for r in ROLES[:14]] + ["extra", "extra"],
               "samples": slots}, open(os.path.join(OUT, "rhythmdrumgm_samples.json"), "w"), indent=1)
    pairs = [(s["name"], os.path.join(sdir, s["file"])) for s in slots]
    write_pack(os.path.join(OUT, "RhythmDrumGM.circuitrhythmpack"), "RhythmDrumGM", "orange", pairs)
    write_sd_zip(os.path.join(OUT, "RhythmDrumGM_SD.zip"), pairs)
    print("wrote RhythmDrumGM.circuitrhythmpack, RhythmDrumGM_SD.zip")
