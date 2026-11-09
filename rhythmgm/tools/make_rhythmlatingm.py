"""Build RhythmLatinGM: eight Latin percussion kits for the Circuit Rhythm, 16 hits each.

    python3 rhythmgm/tools/make_rhythmlatingm.py /path/to/GeneralUser-GS.sf2   (from the repo root)

GS has no Latin kit, but every GS kit carries the GM Latin percussion (notes 54-87). Each
Latin kit takes its kick and snare from a root kit (RhythmDrumGM's picks) and fills the rest
with Latin sounds, placed where they best stand in for RhythmDrumGM's roles, so a kit still
drops into slots 113-128 of RhythmInstGM. Conga and bongo sets alternate (ROOTS):

  pos  RhythmDrumGM role   conga kits                bongo kits
   1   Kick                Kick (root kit)           Kick (root kit)
   2   Kick 2              Surdo                     Surdo
   3   Snare               Snare (root kit)          Snare (root kit)
   4   Snare 2             Timbale Hi                Timbale Hi
   5   Rim                 Claves                    Claves
   6   Clap                Cabasa                    Cabasa
   7   CH                  Maracas                   Maracas
   8   Pedal HH            Shaker                    Shaker
   9   OH                  Guiro                     Guiro
  10   Tom Lo              Conga Lo (tumba)          Bongo Lo
  11   Tom Mid             Conga Hi (open)           Bongo Hi
  12   Tom Hi              Conga Mute                Timbale Lo
  13   Crash               Agogo                     Agogo
  14   Ride                Cowbell                   Cowbell
  15   extra               Timbale Lo                Cuica
  16   extra               Wood Block                Wood Block

Kits (slots): LatinStd 1-16 (congas), LatinRoom 17-32 (bongos), LatinPower 33-48 (congas),
LatinElec 49-64 (bongos), Latin808 65-80 (congas), LatinDance 81-96 (bongos), LatinJazz
97-112 (congas), LatinBrush 113-128 (bongos). Sample names drop the "Latin" so they stay
short ("Room Bongo Hi").

Rendering as make_rhythmdrumgm.py (make_drums.py's chain, same length caps); hits TracksGM
already has are copied from tracksgm/drums.

Outputs (rhythmgm/): RhythmLatinGM.circuitrhythmpack, RhythmLatinGM_SD.zip,
latin_samples/NNN Name.wav, rhythmlatingm_samples.json.
"""
import json, os, shutil, sys, wave

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(OUT, "..", "tracksgm", "tools"))
import make_drums as md                                         # noqa: E402
from rhythm_pack import write_pack, write_sd_zip                 # noqa: E402

LIMIT_S = 228.1
# root kit, GS program, kick and snare (note or (program, note); RhythmDrumGM's picks), hand-drum set
ROOTS = [("Std", 0, 36, 38, 1), ("Room", 8, 36, 38, 2), ("Power", 16, 36, 38, 1),
         ("Elec", 24, (26, 35), (25, 40), 2), ("808", 25, 35, 38, 1), ("Dance", 26, 36, 38, 2),
         ("Jazz", 32, 36, 38, 1), ("Brush", 40, 36, 38, 2)]
COMMON = {0: ("Kick", 36, 1.5), 1: ("Surdo", 87, 2.0), 2: ("Snare", 38, 1.5), 3: ("Timbale Hi", 65, 2.0),
          4: ("Claves", 75, 2.0), 5: ("Cabasa", 69, 2.0), 6: ("Maracas", 70, 2.0), 7: ("Shaker", 82, 2.0),
          8: ("Guiro", 74, 2.0), 12: ("Agogo", 67, 2.0), 13: ("Cowbell", 56, 2.0)}
SETS = {
    1: {9: ("Conga Lo", 64, 2.0), 10: ("Conga Hi", 63, 2.0), 11: ("Conga Mute", 62, 2.0),
        14: ("Timbale Lo", 66, 2.0), 15: ("Wood Block", 76, 2.0)},
    2: {9: ("Bongo Lo", 61, 2.0), 10: ("Bongo Hi", 60, 2.0), 11: ("Timbale Lo", 66, 2.0),
        14: ("Cuica", 79, 2.0), 15: ("Wood Block", 76, 2.0)},
}


def plan():
    out = []
    for root, prog, kick, snare, n in ROOTS:
        roles = {**COMMON, **SETS[n], 0: ("Kick", kick, 1.5), 2: ("Snare", snare, 1.5)}
        for r in range(16):
            role, note, cap = roles[r]
            p, nt = note if isinstance(note, tuple) else (prog, note)
            out.append({"kit": f"Latin{root}", "root": root, "set": "congas" if n == 1 else "bongos",
                        "role": role, "name": f"{root} {role}", "gs_program": p, "note": nt, "cap": cap})
    return out


if __name__ == "__main__":
    sf2 = sys.argv[1] if len(sys.argv) > 1 else "GeneralUser-GS.sf2"
    sdir = os.path.join(OUT, "latin_samples")
    os.makedirs(sdir, exist_ok=True)
    for f in os.listdir(sdir):
        if f.endswith(".wav"):
            os.remove(os.path.join(sdir, f))
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
    json.dump({"pack": "RhythmLatinGM", "product": "circuit-rhythm", "total_seconds": round(total, 1),
               "limit_seconds": LIMIT_S, "samples": slots},
              open(os.path.join(OUT, "rhythmlatingm_samples.json"), "w"), indent=1)
    pairs = [(s["name"], os.path.join(sdir, s["file"])) for s in slots]
    write_pack(os.path.join(OUT, "RhythmLatinGM.circuitrhythmpack"), "RhythmLatinGM", "green", pairs)
    write_sd_zip(os.path.join(OUT, "RhythmLatinGM_SD.zip"), pairs)
    print("wrote RhythmLatinGM.circuitrhythmpack, RhythmLatinGM_SD.zip")
