"""Dump GeneralUser GS 2.0 to WAV: every raw sample, plus every drum-kit hit rendered.

    python3 extract_sf2.py GeneralUser-GS.sf2 [outdir]

outdir/raw/NNN Name.wav       every sample in the sf2 (920), untouched 16-bit mono at its native
                              rate, loop points in a 'smpl' chunk
outdir/raw_index.csv          id, name, rate, root key, pitch correction, length, loop, and which
                              melodic presets / drum kits (with note numbers) use it
outdir/drums/<kit>/NN Name.wav  every note of all 13 drum kits rendered with make_drums.py's
                              chain (FluidSynth, vel 110, 48 kHz 16-bit mono, -0.5 dBFS, same
                              length caps) = drop-in replacements for pack slots
outdir/drums_index.csv        kit, program, note, GM name, length, and 'same_as' = the first
                              rendered hit it duplicates (corr >= 0.97 over the first 200 ms)
"""
import csv, os, struct, sys, wave
import numpy as np
import make_drums as md

GM_DRUMS = {27: "High Q", 28: "Slap", 29: "Scratch Push", 30: "Scratch Pull", 31: "Sticks",
    32: "Square Click", 33: "Metronome Click", 34: "Metronome Bell", 35: "Kick 2", 36: "Kick",
    37: "Side Stick", 38: "Snare", 39: "Clap", 40: "Snare 2", 41: "Low Floor Tom", 42: "Closed HH",
    43: "High Floor Tom", 44: "Pedal HH", 45: "Low Tom", 46: "Open HH", 47: "Low-Mid Tom",
    48: "Hi-Mid Tom", 49: "Crash", 50: "High Tom", 51: "Ride", 52: "China", 53: "Ride Bell",
    54: "Tambourine", 55: "Splash", 56: "Cowbell", 57: "Crash 2", 58: "Vibraslap", 59: "Ride 2",
    60: "Hi Bongo", 61: "Low Bongo", 62: "Mute Hi Conga", 63: "Open Hi Conga", 64: "Low Conga",
    65: "High Timbale", 66: "Low Timbale", 67: "High Agogo", 68: "Low Agogo", 69: "Cabasa",
    70: "Maracas", 71: "Short Whistle", 72: "Long Whistle", 73: "Short Guiro", 74: "Long Guiro",
    75: "Claves", 76: "Hi Wood Block", 77: "Low Wood Block", 78: "Mute Cuica", 79: "Open Cuica",
    80: "Mute Triangle", 81: "Open Triangle", 82: "Shaker", 83: "Jingle Bell", 84: "Bell Tree",
    85: "Castanets", 86: "Mute Surdo", 87: "Open Surdo"}
CYMBALS = {49, 51, 52, 53, 55, 57, 59}
LONGISH = {46, 41, 43, 45, 47, 48, 50, 58, 72, 74, 79, 81, 84, 86, 87}
SAFE = str.maketrans({c: "_" for c in '/\\:*?"<>|'})


def chunks(d):
    out, i = {}, 12
    def walk(i, end):
        while i < end:
            tag, n = d[i:i + 4], struct.unpack("<I", d[i + 4:i + 8])[0]
            if tag == b"LIST":
                walk(i + 12, i + 8 + n)
            else:
                out[tag] = (i + 8, n)
            i += 8 + n + (n & 1)
    walk(12, len(d))
    return out


def recs(d, c, tag, fmt):
    o, n = c[tag]; s = struct.calcsize(fmt)
    return [struct.unpack(fmt, d[o + k:o + k + s]) for k in range(0, n, s)]


def name(b):
    return b.split(b"\0")[0].decode("latin1").strip()


def parse(path):
    d = open(path, "rb").read()
    c = chunks(d)
    phdr = recs(d, c, b"phdr", "<20sHHHIII"); pbag = recs(d, c, b"pbag", "<HH")
    pgen = recs(d, c, b"pgen", "<HH");        inst = recs(d, c, b"inst", "<20sH")
    ibag = recs(d, c, b"ibag", "<HH");        igen = recs(d, c, b"igen", "<HH")
    shdr = recs(d, c, b"shdr", "<20sIIIIIBbHH")
    smpl_o = c[b"smpl"][0]

    def zones(bags, gens, b0, b1):
        for b in range(b0, b1):
            g0, g1 = bags[b][0], bags[b + 1][0]
            z = {}
            for op, amt in gens[g0:g1]:
                z[op] = amt
            yield z

    def keyrange(z):
        r = z.get(43)
        return (r & 0xFF, r >> 8) if r is not None else (0, 127)

    # instrument -> list of (keylo, keyhi, sample id)
    inst_zones = []
    for i in range(len(inst) - 1):
        zs = []
        for z in zones(ibag, igen, inst[i][1], inst[i + 1][1]):
            if 53 in z:
                zs.append((*keyrange(z), z[53]))
        inst_zones.append(zs)
    users = {s: set() for s in range(len(shdr) - 1)}
    for p in range(len(phdr) - 1):
        pname, prog, bank = name(phdr[p][0]), phdr[p][1], phdr[p][2]
        for z in zones(pbag, pgen, phdr[p][3], phdr[p + 1][3]):
            if 41 not in z:
                continue
            plo, phi = keyrange(z)
            for lo, hi, sid in inst_zones[z[41]]:
                a, b = max(lo, plo), min(hi, phi)
                if a > b:
                    continue
                if bank == 128:
                    keys = f"{a}" if a == b else f"{a}-{b}"
                    users[sid].add(f"Kit {prog} {pname} n{keys}")
                else:
                    users[sid].add(f"{bank}:{prog} {pname}")
    return d, smpl_o, shdr[:-1], users


def write_raw(path, pcm, rate, root, corr, loop):
    with wave.open(path, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate)
        w.writeframes(pcm)
    if loop:
        ls, le = loop
        cents = -corr if corr <= 0 else 100 - corr       # smpl wants a positive fraction above root
        unity = root if corr <= 0 else root - 1
        frac = int(round(cents / 100 * 2 ** 32)) & 0xFFFFFFFF
        smpl = struct.pack("<9I", 0, 0, int(1e9 / rate), unity, frac, 0, 0, 1, 0)
        smpl += struct.pack("<6I", 0, 0, ls, le - 1, 0, 0)
        with open(path, "r+b") as f:
            f.seek(0, 2)
            f.write(b"smpl" + struct.pack("<I", len(smpl)) + smpl)
            size = f.tell() - 8
            f.seek(4); f.write(struct.pack("<I", size))


def main():
    sf2 = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else "GeneralUser-GS-wav"
    d, smpl_o, shdr, users = parse(sf2)

    # --- raw samples
    os.makedirs(os.path.join(out, "raw"), exist_ok=True)
    with open(os.path.join(out, "raw_index.csv"), "w", newline="") as f:
        cw = csv.writer(f)
        cw.writerow(["id", "file", "name", "rate", "root_key", "pitch_corr_cents", "length_s",
                     "loop_start", "loop_end", "used_by"])
        for sid, (nm, s, e, ls, le, rate, root, corr, link, typ) in enumerate(shdr):
            n = name(nm)
            fn = f"{sid:03d} {n.translate(SAFE)}.wav"
            pcm = d[smpl_o + 2 * s:smpl_o + 2 * e]
            loop = (ls - s, le - s) if le > ls and ls >= s and le <= e else None
            write_raw(os.path.join(out, "raw", fn), pcm, rate, root, corr, loop)
            cw.writerow([sid, fn, n, rate, root, corr, f"{(e - s) / rate:.3f}",
                         loop[0] if loop else "", loop[1] if loop else "",
                         "; ".join(sorted(users[sid]))])
    print(f"raw: {len(shdr)} samples")

    # --- rendered drum kits
    kits = sorted({(int(u.split()[1]), u.split(" n")[0].split(" ", 2)[2])
                   for us in users.values() for u in us if u.startswith("Kit ")})
    syn, sfid = md.make_synth(sf2)
    rows, renders = [], []
    for prog, kname in kits:
        kdir = os.path.join(out, "drums", f"{prog:03d} {kname.translate(SAFE)}")
        os.makedirs(kdir, exist_ok=True)
        for note in range(128):
            x = md.hit(syn, sfid, prog, note)
            if np.abs(x).max() < 1e-4:
                continue
            cap = 4.0 if note in CYMBALS else 2.0 if note in LONGISH or note not in GM_DRUMS else 1.5
            x = md.tidy(x, cap)
            hname = GM_DRUMS.get(note, f"Note {note}")
            fn = f"{note:03d} {hname}.wav"
            md.save(os.path.join(kdir, fn), x)
            rows.append([f"{prog:03d} {kname}", prog, note, hname, f"{len(x) / md.SR:.2f}",
                         os.path.relpath(os.path.join(kdir, fn), out)])
            renders.append(x)
        print(f"kit {prog:3d} {kname}: done")

    # duplicates: normalised first 200 ms, corr >= 0.97 with an earlier render
    N = int(0.2 * md.SR)
    M = np.zeros((len(renders), N), np.float32)
    for i, x in enumerate(renders):
        y = x[:N]; M[i, :len(y)] = y
    M /= np.linalg.norm(M, axis=1, keepdims=True) + 1e-12
    C = M @ M.T
    with open(os.path.join(out, "drums_index.csv"), "w", newline="") as f:
        cw = csv.writer(f)
        cw.writerow(["kit", "program", "note", "name", "length_s", "file", "same_as"])
        uniq = 0
        for i, r in enumerate(rows):
            prev = np.nonzero(C[i, :i] >= 0.97)[0]
            same = rows[prev[0]][5] if len(prev) else ""
            uniq += not same
            cw.writerow(r + [same])
    print(f"drums: {len(rows)} hits rendered, {uniq} distinct")


if __name__ == "__main__":
    main()
