"""Fill the patch list and drum table on the TracksGM web page from tracksgm_patches.json.

    python3 tracksgm/tools/make_site_lists.py        (from the repo root)

Rewrites the blocks between <!-- patchlist:start ... --> / <!-- patchlist:end --> and
<!-- drums:start ... --> / <!-- drums:end --> in tracksgm/index.html. Run it again
whenever patch or sample names change.
"""
import html, json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)                       # tracksgm/
DATA = os.path.join(ROOT, "tracksgm_patches.json")
PAGE = os.path.join(ROOT, "index.html")

FAMILIES = ["Piano", "Chromatic Percussion", "Organ", "Guitar", "Bass", "Strings",
            "Ensemble", "Brass", "Reed", "Pipe", "Synth Lead", "Synth Pad",
            "Synth Effects", "Ethnic", "Percussive", "Sound Effects"]
SLOT_ROLES = ["Kick", "Snare", "Rim / clap", "Closed hat", "Open hat", "Tom", "Cymbal", "Perc"]


def patch_list(patches):
    out = ['<div class="patchlist">']
    for f, fam in enumerate(FAMILIES):
        first = f * 8 + 1
        out.append(f'  <section><h3>{first}–{first + 7} · {fam}</h3>')
        out.append(f'    <ol start="{first}">')
        for p in patches[f * 8:(f + 1) * 8]:
            out.append(f'      <li>{html.escape(p["name"])}</li>')
        out.append("    </ol>\n  </section>")
    out.append("</div>")
    return "\n".join("    " + line for line in out)


def drum_table(samples):
    rows = ['<table>', '  <thead><tr><th>Slots</th><th>Kit</th>'
            + "".join(f"<th>{r}</th>" for r in SLOT_ROLES) + "</tr></thead>", "  <tbody>"]
    for k in range(len(samples) // 8):
        hits = samples[k * 8:(k + 1) * 8]
        kit = hits[0].split(" ")[0]
        cells = "".join(f"<td>{html.escape(h[len(kit) + 1:] if h.startswith(kit + ' ') else h)}</td>" for h in hits)
        rows.append(f"    <tr><td>{k * 8 + 1}–{k * 8 + 8}</td><td><b>{html.escape(kit)}</b></td>{cells}</tr>")
    rows += ["  </tbody>", "</table>"]
    return "\n".join("    " + r for r in rows)


def fill(page, tag, body):
    pat = re.compile(rf"(<!-- {tag}:start[^>]*-->\n).*?(\s*<!-- {tag}:end -->)", re.S)
    if not pat.search(page):
        raise SystemExit(f"markers for {tag} not found in {PAGE}")
    return pat.sub(lambda m: m.group(1) + body + m.group(2), page)


if __name__ == "__main__":
    d = json.load(open(DATA))
    patches = sorted(d["patches"], key=lambda p: p["slot"])
    assert len(patches) == 128, len(patches)
    page = open(PAGE, encoding="utf-8").read()
    page = fill(page, "patchlist", patch_list(patches))
    page = fill(page, "drums", drum_table(d["samples"]))
    open(PAGE, "w", encoding="utf-8").write(page)
    print(f"{PAGE}: {len(patches)} patches, {len(d['samples'])} samples")
