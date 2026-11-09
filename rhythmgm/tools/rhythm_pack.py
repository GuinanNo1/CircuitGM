"""Write Circuit Rhythm packs the way Novation Components saves them.

Layout copied from Components-saved packs (TEARDROP, Prodigy, CHILDREN, TOUR DE FRANCE,
Freaks; all "version": "2.0"):

  projects/project_0..63.ncs      64 project files, 169,092 bytes each. Slot 0 is named
                                  "User Session"; unused slots have a blank name and hold the
                                  empty template: "INIT" at byte 0, 32 spaces at bytes 16-47,
                                  zeros elsewhere (md5 e1c697f7b24fba4531716cbc02af5b2a).
  samples/sample_N.wav            48 kHz 16-bit mono; an empty slot is listed in index.json
                                  with a blank name and has no file.
  grid_effects/grid_effect_0..15  16 Grid FX files, 7 bytes each. Every pack saved without
                                  edited Grid FX has effectType 127 and the bytes 7f 00 00 00
                                  00 00 00 (the Rhythm's defaults). Edited pads use 0-6 =
                                  Beat Repeat, Reverser, Gater, Auto Filter, Digitise, Phaser,
                                  Vinyl Sim (the Rhythm 2.0 addendum's order; seen in Freaks).
  index.json                      compact JSON, written last.

Zip entries are deflated, with the three folder entries first in each group.
"""
import json, os, zipfile

PROJECT_SIZE = 169092
GRID_FX_DEFAULT = bytes([0x7F, 0, 0, 0, 0, 0, 0])


def empty_project():
    d = bytearray(PROJECT_SIZE)
    d[0:4] = b"INIT"
    d[16:48] = b" " * 32
    return bytes(d)


def write_pack(path, name, color, samples):
    """samples: list of (name, wav path or None), up to 128 slots."""
    assert len(samples) <= 128
    samples = list(samples) + [("", None)] * (128 - len(samples))
    index = {
        "name": name, "color": color, "product": "circuit-rhythm", "version": "2.0",
        "projects": [{"name": "User Session" if i == 0 else "", "url": f"projects/project_{i}.ncs"}
                     for i in range(64)],
        "samples": [{"name": n, "url": f"samples/sample_{i}.wav"} for i, (n, _) in enumerate(samples)],
        "gridEffects": [{"effectType": 127, "url": f"grid_effects/grid_effect_{i}.grideffect"}
                        for i in range(16)],
    }
    proj = empty_project()
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(zipfile.ZipInfo("projects/"), "")
        for i in range(64):
            z.writestr(f"projects/project_{i}.ncs", proj)
        z.writestr(zipfile.ZipInfo("samples/"), "")
        for i, (_, wav) in enumerate(samples):
            if wav:
                z.write(wav, f"samples/sample_{i}.wav")
        z.writestr(zipfile.ZipInfo("grid_effects/"), "")
        for i in range(16):
            z.writestr(f"grid_effects/grid_effect_{i}.grideffect", GRID_FX_DEFAULT)
        z.writestr("index.json", json.dumps(index, separators=(",", ":")))


def write_sd_zip(path, samples):
    """Novation's manual SD-card layout: Rhythm/<pack>/PCM/NN__Name.wav plus empty meta/ and
    Sessions/; the Rhythm makes default Grid FX when GridFx/ is absent."""
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        for d in ("Rhythm/0/meta/", "Rhythm/0/Sessions/", "Rhythm/0/PCM/"):
            z.writestr(d, "")
        for i, (n, wav) in enumerate(samples):
            if wav:
                z.write(wav, f"Rhythm/0/PCM/{i:02d}__{n}.wav")
