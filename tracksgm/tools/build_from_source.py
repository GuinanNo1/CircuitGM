"""Rebuild TracksGM_final from source and check it against the committed pack.

    cd tools
    python3 build_from_source.py                      # drum WAVs from ../drums
    python3 build_from_source.py --sf2 GeneralUser-GS.sf2   # re-render the drums too

Steps (all deterministic):
  1. gm_patches.py          -> build/gm_patches/*.syx   (calibrated GM set: family EQ and
                               cutoffs, filter overrides, loudness trims)
  2. collect into build/tracksgm_patches.json
  3. revoice_tracksgm_wt.py -> wavetable Index re-voice, macro 7 depth +6, and the
                               post-re-voice loudness trims
  4. drums: ../drums (the pack's own WAVs) or make_drums.py from the soundfont
  5. make_pack.build        -> build/TracksGM_final.circuittrackspack
Then the patches are compared with ../tracksgm_patches.json (the master) and reported.
"""
import argparse, glob, json, os, shutil, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
BUILD = os.path.join(ROOT, "build")
HDR = bytes([0xF0, 0x00, 0x20, 0x29, 0x01, 0x64, 0x00, 0x00, 0x00])


def run(*args, cwd):
    subprocess.run([sys.executable, *args], cwd=cwd, check=True)


def main():
    a = argparse.ArgumentParser()
    a.add_argument("--sf2", help="render the drums from this GeneralUser-GS.sf2 instead of using ../drums")
    o = a.parse_args()

    shutil.rmtree(BUILD, ignore_errors=True)
    os.makedirs(BUILD)
    for f in ("ctpatch.py", "gm_patches.py", "revoice_tracksgm_wt.py", "make_drums.py"):
        shutil.copy(os.path.join(HERE, f), BUILD)

    run("gm_patches.py", cwd=BUILD)
    files = sorted(glob.glob(os.path.join(BUILD, "gm_patches", "*.syx")))
    patches = []
    for i, f in enumerate(files):
        raw = open(f, "rb").read()
        patches.append({"slot": i, "name": raw[9:25].decode("ascii").rstrip(), "data": raw[9:349].hex()})
    master = json.load(open(os.path.join(ROOT, "tracksgm_patches.json")))
    j = {"pack": master["pack"], "color": master["color"], "source": "built by tools/build_from_source.py",
         "patches": patches, "samples": master["samples"]}
    json.dump(j, open(os.path.join(BUILD, "tracksgm_patches.json"), "w"), indent=0)
    run("revoice_tracksgm_wt.py", cwd=BUILD)
    j = json.load(open(os.path.join(BUILD, "tracksgm_patches.json")))

    syx_dir = os.path.join(BUILD, "tracksgm")
    os.makedirs(syx_dir)
    for p in j["patches"]:
        open(os.path.join(syx_dir, f"{p['slot'] + 1:03d} {p['name']}.syx"), "wb").write(
            HDR + bytes.fromhex(p["data"]) + b"\xF7")

    if o.sf2:
        run("make_drums.py", os.path.abspath(o.sf2), cwd=BUILD)
        drums = os.path.join(BUILD, "drums")
    else:
        drums = os.path.join(ROOT, "drums")

    sys.path.insert(0, HERE)
    from make_pack import build
    out = os.path.join(BUILD, "TracksGM_final.circuittrackspack")
    build(syx_dir, j["pack"], j["color"], out, drums)

    same = sum(a["data"] == b["data"] and a["name"] == b["name"] for a, b in zip(j["patches"], master["patches"]))
    print(f"patches identical to the master: {same} of 128")
    if same != 128:
        sys.exit(1)


if __name__ == "__main__":
    main()
