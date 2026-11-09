"""Fill the sample lists on the RhythmGM web page from the two packs' sample data.

    python3 rhythmgm/tools/make_site_lists.py        (from the repo root)

Reads rhythmdrumgm_samples.json, rhythmlatingm_samples.json and rhythminstgm_samples.json and rewrites the blocks between
<!-- kits:start ... --> / <!-- kits:end --> and <!-- instruments:start ... --> /
<!-- instruments:end -->, <!-- latin... --> and <!-- latinkits... --> in rhythmgm/index.html,
plus the data-drum-total, data-latin-total and data-inst-total figures.
"""
import html, json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PAGE = os.path.join(ROOT, "index.html")
FAMILIES = ["Piano", "Chromatic Percussion", "Organ", "Guitar", "Bass", "Strings",
            "Ensemble", "Brass", "Reed", "Pipe", "Synth Lead", "Synth Pad",
            "Synth Effects", "Ethnic", "Percussive", "Sound Effects"]
ROLE_LABELS = ["Kick", "Kick 2", "Snare", "Snare 2", "Rim", "Clap", "Closed hat", "Pedal hat",
               "Open hat", "Tom low", "Tom mid", "Tom high", "Crash", "Ride", "Extra 1", "Extra 2"]


def kits(drums):
    names = [drums[k * 16]["kit"] for k in range(8)]
    rows = ["<table>",
            "  <thead><tr><th>Pos.</th><th>Role</th>" + "".join(
                f"<th>{html.escape(n)}<br><span class=\"hint inline\">{k * 16 + 1}–{k * 16 + 16}</span></th>"
                for k, n in enumerate(names)) + "</tr></thead>", "  <tbody>"]
    for r in range(16):
        cells = []
        for k in range(8):
            h = drums[k * 16 + r]
            cells.append(f"<td>{html.escape(h['role'])}</td>" if r >= 14 or h["role"].startswith("Timp")
                         else "<td>✓</td>")
        rows.append(f"    <tr><td>{r + 1}</td><td><b>{ROLE_LABELS[r]}</b></td>{''.join(cells)}</tr>")
    rows += ["  </tbody>", "</table>"]
    return "\n".join("    " + r for r in rows)


def latin(lat):
    """Positions down the side, the conga set and the bongo set across."""
    c = [x for x in lat if x["set"] == "congas"][:16]
    b = [x for x in lat if x["set"] == "bongos"][:16]
    rows = ["<table>", "  <thead><tr><th>Pos.</th><th>RhythmDrumGM role</th><th>Kits …1 (congas)</th><th>Kits …2 (bongos)</th></tr></thead>", "  <tbody>"]
    for r in range(16):
        rows.append(f"    <tr><td>{r + 1}</td><td>{ROLE_LABELS[r]}</td><td>{html.escape(c[r]['role'])}</td><td>{html.escape(b[r]['role'])}</td></tr>")
    rows += ["  </tbody>", "</table>"]
    return "\n".join("    " + r for r in rows)


def latin_kits(lat):
    kits = []
    for i in range(0, len(lat), 16):
        kits.append(f"<b>{html.escape(lat[i]['kit'])}</b> {i + 1}–{i + 16}")
    return "    " + ", ".join(kits) + "."


def instruments(ins):
    out = ['<div class="patchlist">']
    for f, fam in enumerate(FAMILIES):
        group = ins[f * 8:(f + 1) * 8]
        first = group[0]["slot"] + 1
        note = " · replaced by a drum kit in built packs" if first >= 113 else ""
        out.append(f"  <section><h3>{first}–{first + 7} · {fam}<span class=\"hint inline\">{note}</span></h3>")
        out.append(f'    <ol start="{first}">')
        for s in group:
            name, root = s["name"].rsplit(" ", 1)
            out.append(f"      <li>{html.escape(name)} <span class=\"hint inline\">root {root}</span></li>")
        out.append("    </ol>\n  </section>")
    out.append("</div>")
    return "\n".join("    " + line for line in out)


def fill(page, tag, body):
    pat = re.compile(rf"(<!-- {tag}:start[^>]*-->\n).*?(\s*<!-- {tag}:end -->)", re.S)
    if not pat.search(page):
        raise SystemExit(f"markers for {tag} not found")
    return pat.sub(lambda m: m.group(1) + body + m.group(2), page)


if __name__ == "__main__":
    dr = json.load(open(os.path.join(ROOT, "rhythmdrumgm_samples.json")))
    ins = json.load(open(os.path.join(ROOT, "rhythminstgm_samples.json")))
    lat = json.load(open(os.path.join(ROOT, "rhythmlatingm_samples.json")))
    page = open(PAGE, encoding="utf-8").read()
    page = fill(page, "kits", kits(dr["samples"]))
    page = fill(page, "instruments", instruments(ins["samples"]))
    page = fill(page, "latin", latin(lat["samples"]))
    page = fill(page, "latinkits", latin_kits(lat["samples"]))
    page = re.sub(r"<span data-drum-total>[^<]*</span>", f"<span data-drum-total>{dr['total_seconds']:.1f}</span>", page)
    page = re.sub(r"<span data-latin-total>[^<]*</span>", f"<span data-latin-total>{lat['total_seconds']:.1f}</span>", page)
    page = re.sub(r"<span data-inst-total>[^<]*</span>", f"<span data-inst-total>{ins['total_seconds']:.1f}</span>", page)
    open(PAGE, "w", encoding="utf-8").write(page)
    print(f"{PAGE}: drums {dr['total_seconds']} s, instruments {ins['total_seconds']} s")
