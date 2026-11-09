"""Build RhythmInstGM: all 128 General MIDI instruments for the Circuit Rhythm, slot = program.

    python3 rhythmgm/tools/make_rhythminstgm.py /path/to/GeneralUser-GS.sf2   (from the repo root)

Slot N holds GM program N (slot 1 Acoustic Grand Piano ... slot 128 Gunshot), rendered from
GeneralUser GS bank 0 as one note each. When MIDI2Circuit builds a Rhythm pack, slots
113-128 (GM's Percussive and Sound Effects families) are replaced by one RhythmDrumGM kit,
so slots 1-112 plus the longest kit must also fit the Rhythm's 228.1 s.

Rendering is make_rhythmgm.py's chain (FluidSynth, velocity 100, reverb and chorus off, mono
sum, 48 kHz 16-bit, lead-in trimmed, tail cut at -60 dB, level -17 dB RMS over the first
second, peak <= -0.5 dBFS), with shorter notes so 128 instruments fit: sustained sounds are
held HOLD_S and keep their release, everything is capped at MAX_S with a fade.

The root note is the last word of each name ("Grand Piano C4"): play that key and the sample
sounds at its own pitch. On the Circuit Rhythm, middle C plays a sample unpitched.

Outputs (rhythmgm/): RhythmInstGM.circuitrhythmpack, RhythmInstGM_SD.zip,
inst_samples/NNN Name.wav, rhythminstgm_samples.json.
"""
import json, os, sys, wave

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import make_rhythmgm as rg                                       # noqa: E402  (synth, render, tidy)
from rhythm_pack import write_pack, write_sd_zip                  # noqa: E402

rg.HOLD_S = 1.4
rg.MAX_S = 2.0
LIMIT_S = 228.1

# (short name, root MIDI note), index + 1 = GM program
GM = [
    # Piano
    ("Grand Piano", 60), ("Bright Piano", 60), ("E.Grand Piano", 60), ("Honky-tonk", 60),
    ("E.Piano 1", 60), ("E.Piano 2", 60), ("Harpsichord", 60), ("Clavinet", 60),
    # Chromatic percussion
    ("Celesta", 72), ("Glockenspiel", 84), ("Music Box", 72), ("Vibraphone", 72),
    ("Marimba", 72), ("Xylophone", 72), ("Tubular Bells", 72), ("Dulcimer", 60),
    # Organ
    ("Drawbar Organ", 60), ("Perc Organ", 60), ("Rock Organ", 60), ("Church Organ", 60),
    ("Reed Organ", 60), ("Accordion", 60), ("Harmonica", 60), ("Tango Accord", 60),
    # Guitar
    ("Nylon Guitar", 60), ("Steel Guitar", 60), ("Jazz Guitar", 60), ("Clean Guitar", 60),
    ("Muted Guitar", 48), ("Overdrive Gtr", 48), ("Distortion Gtr", 48), ("Gtr Harmonics", 60),
    # Bass
    ("Acoustic Bass", 36), ("Finger Bass", 36), ("Pick Bass", 36), ("Fretless Bass", 36),
    ("Slap Bass 1", 36), ("Slap Bass 2", 36), ("Synth Bass 1", 36), ("Synth Bass 2", 36),
    # Strings
    ("Violin", 72), ("Viola", 60), ("Cello", 48), ("Contrabass", 36),
    ("Tremolo Str", 60), ("Pizzicato", 60), ("Harp", 60), ("Timpani", 48),
    # Ensemble
    ("Strings", 60), ("Slow Strings", 60), ("Synth Str 1", 60), ("Synth Str 2", 60),
    ("Choir Aahs", 60), ("Voice Oohs", 60), ("Synth Voice", 60), ("Orchestra Hit", 60),
    # Brass
    ("Trumpet", 72), ("Trombone", 48), ("Tuba", 36), ("Muted Trumpet", 72),
    ("French Horn", 60), ("Brass Section", 60), ("Synth Brass 1", 60), ("Synth Brass 2", 60),
    # Reed
    ("Soprano Sax", 72), ("Alto Sax", 60), ("Tenor Sax", 60), ("Baritone Sax", 48),
    ("Oboe", 72), ("English Horn", 60), ("Bassoon", 48), ("Clarinet", 60),
    # Pipe
    ("Piccolo", 84), ("Flute", 72), ("Recorder", 72), ("Pan Flute", 72),
    ("Blown Bottle", 72), ("Shakuhachi", 72), ("Whistle", 84), ("Ocarina", 72),
    # Synth lead
    ("Square Lead", 60), ("Saw Lead", 60), ("Calliope Lead", 60), ("Chiff Lead", 60),
    ("Charang Lead", 60), ("Voice Lead", 60), ("Fifths Lead", 60), ("Bass+Lead", 48),
    # Synth pad
    ("New Age Pad", 60), ("Warm Pad", 60), ("Polysynth Pad", 60), ("Choir Pad", 60),
    ("Bowed Pad", 60), ("Metallic Pad", 60), ("Halo Pad", 60), ("Sweep Pad", 60),
    # Synth effects
    ("FX Rain", 60), ("FX Soundtrack", 60), ("FX Crystal", 72), ("FX Atmosphere", 60),
    ("FX Brightness", 72), ("FX Goblins", 60), ("FX Echoes", 60), ("FX Sci-fi", 60),
    # Ethnic
    ("Sitar", 60), ("Banjo", 60), ("Shamisen", 60), ("Koto", 60),
    ("Kalimba", 72), ("Bagpipe", 60), ("Fiddle", 72), ("Shanai", 72),
    # Percussive
    ("Tinkle Bell", 84), ("Agogo", 72), ("Steel Drums", 72), ("Woodblock", 72),
    ("Taiko Drum", 48), ("Melodic Tom", 48), ("Synth Drum", 48), ("Reverse Cymbal", 60),
    # Sound effects
    ("Fret Noise", 60), ("Breath Noise", 60), ("Seashore", 60), ("Bird Tweet", 72),
    ("Telephone", 60), ("Helicopter", 60), ("Applause", 60), ("Gunshot", 60),
]


if __name__ == "__main__":
    sf2 = sys.argv[1] if len(sys.argv) > 1 else "GeneralUser-GS.sf2"
    assert len(GM) == 128
    sdir = os.path.join(OUT, "inst_samples")
    os.makedirs(sdir, exist_ok=True)
    for f in os.listdir(sdir):
        if f.endswith(".wav"):
            os.remove(os.path.join(sdir, f))
    syn, sfid = rg.make_synth(sf2)
    slots, total = [], 0.0
    for i, (short, root) in enumerate(GM):
        prog = i + 1
        x = rg.tidy(rg.play(syn, sfid, prog, root))
        s = {"slot": i, "gm_program": prog, "name": f"{short} {rg.note_name(root)}", "root_note": root,
             "source": f"GeneralUser GS bank 0 program {prog}", "file": f"{prog:03d} {short} {rg.note_name(root)}.wav"}
        rg.save(os.path.join(sdir, s["file"]), x)
        with wave.open(os.path.join(sdir, s["file"])) as w:
            s["seconds"] = round(w.getnframes() / rg.SR, 3)
        total += s["seconds"]
        slots.append(s)
        print(f"{prog:3d} {s['name']:20s} {s['seconds']:5.2f} s")

    kits = json.load(open(os.path.join(OUT, "rhythmdrumgm_samples.json")))["samples"]
    kit_s = {}
    for d in kits:
        kit_s[d["kit"]] = kit_s.get(d["kit"], 0) + d["seconds"]
    first112 = sum(s["seconds"] for s in slots[:112])
    worst = max(kit_s, key=kit_s.get)
    print(f"total {total:.1f} s of {LIMIT_S} s; slots 1-112 {first112:.1f} s + longest kit "
          f"({worst}, {kit_s[worst]:.1f} s) = {first112 + kit_s[worst]:.1f} s; "
          f"longest name {max(len(s['name']) for s in slots)}")
    if total > LIMIT_S or first112 + kit_s[worst] > LIMIT_S:
        sys.exit("over the Circuit Rhythm sample limit")
    json.dump({"pack": "RhythmInstGM", "product": "circuit-rhythm", "total_seconds": round(total, 1),
               "limit_seconds": LIMIT_S, "first_112_seconds": round(first112, 1),
               "kit_seconds": {k: round(v, 1) for k, v in kit_s.items()}, "samples": slots},
              open(os.path.join(OUT, "rhythminstgm_samples.json"), "w"), indent=1)
    pairs = [(s["name"], os.path.join(sdir, s["file"])) for s in slots]
    write_pack(os.path.join(OUT, "RhythmInstGM.circuitrhythmpack"), "RhythmInstGM", "blue", pairs)
    write_sd_zip(os.path.join(OUT, "RhythmInstGM_SD.zip"), pairs)
    print("wrote RhythmInstGM.circuitrhythmpack, RhythmInstGM_SD.zip")
