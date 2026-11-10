"""Build RhythmDrumGM: the eight GeneralUser GS drum kits for the Circuit Rhythm, 16 hits each.

    python3 rhythmgm/tools/make_rhythmdrumgm.py /path/to/GeneralUser-GS.sf2   (from the repo root)

Each kit is two rows of eight. Row 1 is the TracksGM kit exactly (same hits, byte-identical
samples, same order), so the 8 drums of a TracksGM kit map one-to-one onto a RhythmDrumGM
kit and fill one pad row on the Rhythm. Row 2 repeats the same eight roles with a second
sound for each:

   row 1:  1 Kick     2 Snare     3 Rim/clap     4 Closed hat   5 Open hat   6 Tom     7 Cymbal     8 Perc
   row 2:  9 Kick 2  10 Snare 2  11 Rim/clap 2  12 Hat 2       13 Open 2    14 Tom 2  15 Cymbal 2  16 Perc 2

(Jazz, Brush and Orch use their TracksGM picks in row 1, e.g. Jazz pedal hat and shaker in
the hat slots, so their row 2 holds the ordinary closed and open hats.)

Kits (slots): Std 1-16, Room 17-32, Power 33-48, Elec 49-64, 808 65-80, Jazz 81-96,
Brush 97-112, Orch 113-128. Any kit drops into slots 113-128 of RhythmInstGM. Row 1 comes
from tracksgm/tools/make_drums.py (KITS); row 2 is ROW2 below. A note may be (GS program,
note) to borrow from another kit.

Rendering is make_drums.py's chain (FluidSynth, velocity 110, 48 kHz 16-bit mono, lead-in
trimmed, tail cut at -60 dB with a fade, peak -0.5 dBFS) with its length caps per role
(cymbals 4 s; open hats, toms and percussion 2 s; the rest 1.5 s). Hits TracksGM has are
copied from tracksgm/drums.

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
ROLES = ["Kick", "Snare", "Rim/clap", "Closed hat", "Open hat", "Tom", "Cymbal", "Perc"]
CAPS = [md.MAX_S.get(s, md.DEFAULT_MAX) for s in md.SLOTS]       # same caps as TracksGM, by role

# Row 2 per kit, in ROLES order: (short name, note or (GS program, note)).
ROW2 = {
    "Std":   [("Kick2", 35), ("Snare2", 40), ("Rim", 37), ("PedalHH", 44),
              ("Ride", 51), ("TomLo", 41), ("Crash2", 57), ("Cowbell", 56)],
    "Room":  [("Kick2", 35), ("Snare2", 40), ("Clap", 39), ("PedalHH", 44),
              ("Ride", 51), ("TomHi", 50), ("Crash", 49), ("CongaLo", 64)],
    "Power": [("Kick2", 35), ("Clap", 39), ("Rim", 37), ("PedalHH", 44),
              ("Ride", 51), ("TomHi", 48), ("Crash", 49), ("Tamb", 54)],
    "Elec":  [("Kick2", 36), ("Snare2", 38), ("Rim", 37), ("PedalHH", 44),
              ("Ride", 51), ("TomLo", 41), ("Crash", 49), ("Maracas", 70)],
    "808":   [("Kick2", 36), ("Snare2", 40), ("Clap", 39), ("PedalHH", 44),
              ("Ride", (0, 51)), ("TomHi", 50), ("Crash", (0, 49)), ("Claves", 75)],
    "Jazz":  [("Kick2", 35), ("Snare2", 40), ("Clap", 39), ("CH", 42),
              ("OH", 46), ("TomLo", 41), ("Crash", 49), ("Tamb", 54)],
    "Brush": [("Kick2", 35), ("Snare2", (32, 38)), ("Rim", 37), ("CH", 42),
              ("OH", 46), ("TomHi", 50), ("Crash", 49), ("Tamb", 54)],
    "Orch":  [("Kick2", 36), ("Snare2", (16, 40)), ("Clap", (0, 39)), ("CH", 27),
              ("OH", 29), ("TimpMid", 43), ("Crash", 57), ("Tamb", 54)],
}


def plan():
    out = []
    for kit, prog, notes, names in md.KITS:
        rows = [list(zip(names, notes)), ROW2[kit]]
        for row, hits in enumerate(rows):
            for r, (short, note) in enumerate(hits):
                p, n = note if isinstance(note, tuple) else (prog, note)
                out.append({"kit": kit, "row": row + 1, "role": ROLES[r] + (" 2" if row else ""),
                            "hit": short, "name": f"{kit} {short}", "gs_program": p, "note": n, "cap": CAPS[r]})
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
               "limit_seconds": LIMIT_S, "roles": ROLES + [r + " 2" for r in ROLES],
               "samples": slots}, open(os.path.join(OUT, "rhythmdrumgm_samples.json"), "w"), indent=1)
    pairs = [(s["name"], os.path.join(sdir, s["file"])) for s in slots]
    write_pack(os.path.join(OUT, "RhythmDrumGM.circuitrhythmpack"), "RhythmDrumGM", "orange", pairs)
    write_sd_zip(os.path.join(OUT, "RhythmDrumGM_SD.zip"), pairs)
    print("wrote RhythmDrumGM.circuitrhythmpack, RhythmDrumGM_SD.zip")
