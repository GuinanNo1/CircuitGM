"""Build a .circuittrackspack (patches, samples, or both) for Novation Components.

    python3 make_pack.py gm_patches "GM Sound Set" --color blue --samples drums
    python3 make_pack.py - "GU Drums" --samples drums            # samples only, no patches

Patch files are taken in sorted filename order into slots 0-127 ("-" = none). Optional
--samples DIR puts 48 kHz/16-bit/mono WAVs into sample slots 0-63 (sorted order); a
leading "NN " slot number in a WAV filename is dropped from its name in the pack.
Project slots stay empty.

Layout follows real Components exports ("Born Slippy DL", "I Feel Love DL"):
ZIP with directory entries projects/ samples/ patches/, index.json listing every slot
(empty: projects "", patches "Initial Patch", samples ""), files only for used slots.
"""
import argparse, glob, json, os, re, wave, zipfile

PATCH_HDR = bytes([0xF0, 0x00, 0x20, 0x29, 0x01, 0x64, 0x00, 0x00, 0x00])
N_PROJ, N_SAMP, N_PATCH = 64, 64, 128
SAMPLE_CAP_S = 196.6


def load_patch(path):
    raw = open(path, "rb").read()
    if len(raw) != 350 or raw[:6] != PATCH_HDR[:6] or raw[-1] != 0xF7:
        raise ValueError(f"{path}: not a 350-byte Circuit Tracks patch")
    if max(raw[1:-1]) > 0x7F:
        raise ValueError(f"{path}: non 7-bit data")
    raw = PATCH_HDR + raw[9:]          # normalise to Replace Current Patch, Synth 1
    name = raw[9:25].decode("ascii").rstrip()
    return name, raw


def build(patch_dir, name, color, out, sample_dir=None):
    files = [] if patch_dir in (None, "-") else sorted(glob.glob(os.path.join(patch_dir, "*.syx")))
    if len(files) > N_PATCH or (not files and not sample_dir):
        raise SystemExit(f"need up to {N_PATCH} .syx files and/or --samples, found {len(files)}")
    patches = [load_patch(f) for f in files]

    samples = []
    if sample_dir:
        wavs = sorted(glob.glob(os.path.join(sample_dir, "*.wav")))
        if len(wavs) > N_SAMP:
            raise SystemExit(f"{len(wavs)} WAVs; the pack holds {N_SAMP}")
        total = 0.0
        for f in wavs:
            with wave.open(f) as w:
                if (w.getframerate(), w.getsampwidth(), w.getnchannels()) != (48000, 2, 1):
                    raise SystemExit(f"{f}: must be 48 kHz 16-bit mono")
                total += w.getnframes() / 48000
            stem = re.sub(r"^\d+\s+", "", os.path.splitext(os.path.basename(f))[0])
            samples.append((stem, open(f, "rb").read()))
        if total > SAMPLE_CAP_S:
            raise SystemExit(f"samples total {total:.1f} s > {SAMPLE_CAP_S} s cap")
        print(f"samples: {len(samples)}, {total:.1f} s of {SAMPLE_CAP_S} s")

    index = {
        "name": name, "color": color, "product": "circuit-tracks", "version": "2.0",
        "projects": [{"name": "", "url": f"projects/project_{i}.ncs"} for i in range(N_PROJ)],
        "samples": [{"name": samples[i][0] if i < len(samples) else "",
                     "url": f"samples/sample_{i}.wav"} for i in range(N_SAMP)],
        "patches": [{"name": patches[i][0] if i < len(patches) else "Initial Patch",
                     "url": f"patches/patch_{i}.syx"} for i in range(N_PATCH)],
    }
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("index.json", json.dumps(index, indent=2))
        for d in ("projects/", "samples/", "patches/"):
            z.writestr(zipfile.ZipInfo(d), "")
        for i, (_, raw) in enumerate(patches):
            z.writestr(f"patches/patch_{i}.syx", raw)
        for i, (_, raw) in enumerate(samples):
            z.writestr(f"samples/sample_{i}.wav", raw)
    print(f"{out}: {len(patches)} patches, {len(samples)} samples")


if __name__ == "__main__":
    a = argparse.ArgumentParser()
    a.add_argument("patch_dir", help='folder of .syx files, or "-" for none')
    a.add_argument("name")
    a.add_argument("--color", default="blue")
    a.add_argument("--samples")
    a.add_argument("-o", "--out")
    o = a.parse_args()
    build(o.patch_dir, o.name, o.color, o.out or f"{o.name}.circuittrackspack", o.samples)
