"""Rebuild the TracksGM pack (master GM set) from tracksgm_patches.json.

    python3 make_tracksgm.py --samples drums          -> TracksGM.circuittrackspack
    python3 make_tracksgm.py --syx-only               -> tracksgm/NNN <Name>.syx only

TracksGM = the GM Sound Set as Ian tweaked it on hardware (2026-11-05), plus the 64
GeneralUser GS drum samples in sample slots 0-63. Its patches are the master copy: they
include hand edits that gm_patches.py does not have, so do NOT regenerate the GM set from
gm_patches.py and overwrite them. To change a patch, load it with
ctpatch.read_syx("tracksgm/NNN Name.syx"), edit, write it back, then run
sync_json() below (or pass --update-json) so tracksgm_patches.json stays the master.

Drum WAVs are not stored in the project (binary). Recreate them with
    python3 make_drums.py GeneralUser-GS.sf2        (-> drums/, deterministic)
GeneralUser-GS.sf2: github.com/mrbumpy409/GeneralUser-GS (sparse git clone works from the
cloud workspace). Ship its documentation/LICENSE.txt with any shared pack and credit
"Drum samples: GeneralUser GS by S. Christian Collins".
"""
import argparse, glob, json, os

HERE = os.path.dirname(os.path.abspath(__file__))
JSON = os.path.join(HERE, "tracksgm_patches.json")
HDR = bytes([0xF0, 0x00, 0x20, 0x29, 0x01, 0x64, 0x00, 0x00, 0x00])
SYX_DIR = "tracksgm"


def write_syx(d=SYX_DIR):
    j = json.load(open(JSON))
    os.makedirs(d, exist_ok=True)
    for p in j["patches"]:
        data = bytes.fromhex(p["data"])
        assert len(data) == 340 and max(data) < 128
        open(os.path.join(d, f"{p['slot'] + 1:03d} {p['name']}.syx"), "wb").write(HDR + data + b"\xF7")
    return j


def sync_json(d=SYX_DIR):
    """Read the .syx folder back into tracksgm_patches.json (after editing patches)."""
    j = json.load(open(JSON))
    files = sorted(glob.glob(os.path.join(d, "*.syx")))
    assert len(files) == 128, f"expected 128 .syx in {d}, found {len(files)}"
    for i, f in enumerate(files):
        raw = open(f, "rb").read()
        assert len(raw) == 350 and raw[-1] == 0xF7
        j["patches"][i] = {"slot": i, "name": raw[9:25].decode("ascii").rstrip(),
                           "data": raw[9:349].hex()}
    json.dump(j, open(JSON, "w"), indent=0)
    print(f"updated {JSON}")


if __name__ == "__main__":
    a = argparse.ArgumentParser()
    a.add_argument("--samples", help="folder of the 64 drum WAVs (make_drums.py output)")
    a.add_argument("--syx-only", action="store_true")
    a.add_argument("--update-json", action="store_true", help="read tracksgm/*.syx back into the json")
    a.add_argument("-o", "--out", default="TracksGM.circuittrackspack")
    o = a.parse_args()
    if o.update_json:
        sync_json()
    j = write_syx()
    print(f"wrote 128 patches to {SYX_DIR}/")
    if not o.syx_only:
        from make_pack import build
        build(SYX_DIR, j["pack"], j["color"], o.out, o.samples)
