"""Fill the sample lists on the RhythmGM web page from rhythmgm_samples.json.

    python3 rhythmgm/tools/make_site_lists.py        (from the repo root)

Rewrites the blocks between <!-- kits:start ... --> / <!-- kits:end --> and
<!-- instruments:start ... --> / <!-- instruments:end --> in rhythmgm/index.html.
"""
import html, json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PAGE = os.path.join(ROOT, "index.html")
FAMILIES = ["Piano", "Chromatic Percussion", "Organ", "Guitar", "Bass", "Strings",
            "Ensemble", "Brass", "Reed", "Pipe", "Synth Lead", "Synth Pad",
            "Synth Effects", "Ethnic", "Percussive", "Sound Effects"]
ROLES = ["Kick", "Snare", "Rim / clap", "Closed hat", "Open hat", "Tom", "Cymbal", "Perc"]


def kits(drums):
    rows = ["<table>", "  <thead><tr><th>Slots</th><th>Kit</th>" + "".join(f"<th>{r}</th>" for r in ROLES) + "</tr></thead>", "  <tbody>"]
    for k in range(8):
        hits = drums[k * 8:(k + 1) * 8]
        kit = hits[0]["name"].split(" ")[0]
        cells = "".join(f"<td>{html.escape(h['name'][len(kit) + 1:])}</td>" for h in hits)
        rows.append(f"    <tr><td>{k * 8 + 1}–{k * 8 + 8}</td><td><b>{html.escape(kit)}</b></td>{cells}</tr>")
    rows += ["  </tbody>", "</table>"]
    return "\n".join("    " + r for r in rows)


def instruments(ins):
    out = ['<div class="patchlist">']
    for f, fam in enumerate(FAMILIES):
        group = ins[f * 4:(f + 1) * 4]
        first = group[0]["slot"] + 1
        out.append(f"  <section><h3>{first}–{first + 3} · {fam}</h3>")
        out.append(f'    <ol start="{first}">')
        for s in group:
            name, root = s["name"].rsplit(" ", 1)
            out.append(f"      <li>{html.escape(name)} <span class=\"hint inline\">root {root} · GM {s['gm_program']}</span></li>")
        out.append("    </ol>\n  </section>")
    out.append("</div>")
    return "\n".join("    " + line for line in out)


def fill(page, tag, body):
    pat = re.compile(rf"(<!-- {tag}:start[^>]*-->\n).*?(\s*<!-- {tag}:end -->)", re.S)
    if not pat.search(page):
        raise SystemExit(f"markers for {tag} not found")
    return pat.sub(lambda m: m.group(1) + body + m.group(2), page)


if __name__ == "__main__":
    d = json.load(open(os.path.join(ROOT, "rhythmgm_samples.json")))
    s = d["samples"]
    page = open(PAGE, encoding="utf-8").read()
    page = fill(page, "kits", kits([x for x in s if x["kind"] == "drum"]))
    page = fill(page, "instruments", instruments([x for x in s if x["kind"] == "instrument"]))
    page = re.sub(r"<span data-total>[^<]*</span>", f"<span data-total>{d['total_seconds']:.1f}</span>", page)
    open(PAGE, "w", encoding="utf-8").write(page)
    print(f"{PAGE}: {len(s)} samples, {d['total_seconds']} s")
