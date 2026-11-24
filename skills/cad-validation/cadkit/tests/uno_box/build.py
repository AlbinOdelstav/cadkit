# -*- coding: utf-8 -*-
"""Test project: Arduino Uno enclosure, a clean version plus one variant per
deliberately introduced defect. Each variant gets its own folder with parts,
STLs and a cadkit.yaml, exactly like a real project version.

    node ../run_tests.mjs   (builds this first)

Output: tests/uno_box/out/<variant>/
"""

import os, sys, copy

_RAN = globals().get("_UNOBOX_RAN", False)
_UNOBOX_RAN = True

KIT = os.environ.get("CADKIT_HOME") or os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, KIT)
HERE = os.path.join(KIT, "tests", "uno_box")
OUT = os.path.join(HERE, "out")

import yaml
import FreeCAD as App
from FreeCAD import Vector as V
import Part, Mesh

# Uno data used to PLACE the board (the validator reads its own copy from the
# library; these only position the design features)
H_ALL = {"h1": (13.97, 2.54), "h2": (15.24, 50.80), "h3": (66.04, 7.62), "h4": (66.04, 35.56)}
USB_Y, DC_Y = (32.20 + 44.00) / 2, (3.30 + 12.29) / 2

BASE = dict(
    t=2.4, floor=2.0, ux=6.94, uy=5.0, sh=6.0, gap_x=1.0, H=24.0,
    lid_t=2.5, lip_d=3.0, lip_t=1.6, lip_gap=0.5,
    post=6.0, post_pilot=2.7, post_depth=12.0, lid_hole=3.4,
    so_d=5.6, so_pilot=2.7, so_pilot_below=0.5,
    usb_w=19.0, usb_h=15.0, usb_dy=0.0, dc_w=13.0,
    cable_d=6.0, uno_screw=8, lid_screw=10,
    # h1 sits 2.41 mm from the DC jack (official drawing): an M3 head (r 2.75)
    # clashes with it and an M2 head has no bearing on the 3.2 hole. h1 and h2
    # get plain support pins; the board is screwed at h3 and h4.
    screwed=("h3", "h4"),
    lid_hole_dx=0.0,               # offset of ONE lid hole (+ its screw) from its post
    float_h2=False, driver_arm=False, shelf=False, extra_hole=False, slender_pin=False,
    mesh_damage=False, stl_scale=None, skin=False, thin_ok=None,
)

VARIANTS = {
    "clean": {},
    "clean_measured": {},           # same geometry, manifest has measured hole positions
    "m3_hole_small": {"lid_hole": 2.5},
    "pilot_hard_start": {"post_pilot": 2.6},
    "lid_hole_offset": {"lid_hole_dx": 1.5},
    "screw_too_long": {"uno_screw": 12},
    "driver_blocked": {"driver_arm": True},
    "thin_wall": {"t": 0.6},
    "usb_misaligned": {"usb_dy": 4.0},
    "pins_hit_floor": {"sh": 1.5},
    "lid_too_tight": {"lip_gap": 0.1},
    "uno_does_not_fit": {"gap_x": -1.0},
    "floating_standoff": {"float_h2": True},
    "unsupported_shelf": {"shelf": True},
    "cable_hole_small": {"cable_d": 3.0},
    "undeclared_hole": {"extra_hole": True},
    "slender_pin": {"slender_pin": True},
    "broken_mesh": {"mesh_damage": True},
    "wrong_scale": {"stl_scale": 1 / 25.4},
    # a 4 x 3 mm pocket leaves a 0.2 mm skin in the -Y wall (like a hole grazing a bridge underside)
    "thin_skin": {"skin": True},
    "thin_skin_declared": {"skin": True, "thin_ok": [42.4, 0.1, 14.0]},
    "thin_skin_wrong_place": {"skin": True, "thin_ok": [42.4, 0.1, 24.0]},
    "thin_wall_declared": {"t": 0.6, "thin_ok": [42.4, 0.1, 14.0]},
}


def box(x0, y0, z0, x1, y1, z1):
    return Part.makeBox(x1 - x0, y1 - y0, z1 - z0, V(x0, y0, z0))


def cyl(r, h, base, d=(0, 0, 1)):
    return Part.makeCylinder(r, h, V(*base), V(*d))


def build(P):
    t, H, fl = P["t"], P["H"], P["floor"]
    ux, uy, uz = P["ux"], P["uy"], P["sh"]
    Lx = ux + 68.58 + P["gap_x"] + P["post"]
    Ly = uy + 53.34 + 2.5
    P["Lx"], P["Ly"] = Lx, Ly
    s = P["post"]
    posts = [(s / 2, s / 2), (Lx - s / 2, s / 2), (s / 2, Ly - s / 2), (Lx - s / 2, Ly - s / 2)]
    P["posts"] = posts

    # ---------------- base
    base = box(-t, -t, -fl, Lx + t, Ly + t, H).cut(box(0, 0, 0, Lx, Ly, H + 1))
    for (cx, cy) in posts:
        base = base.fuse(box(cx - s / 2, cy - s / 2, 0, cx + s / 2, cy + s / 2, H))
    sos = []
    for k, (hx, hy) in H_ALL.items():
        x, y = ux + hx, uy + hy
        z0 = 0.2 if (k == "h2" and P["float_h2"]) else -0.01
        so = cyl(P["so_d"] / 2, uz - z0, (x, y, z0))
        sos.append((k, so))
    for k, so in sos:
        if k == "h2" and P["float_h2"]:
            continue
        base = base.fuse(so)
    if P["driver_arm"]:
        base = base.fuse(box(60, 30, 16, Lx + 0.01, 44, 18))
    if P["shelf"]:
        base = base.fuse(box(30, Ly - 8, 17.5, 45, Ly + 0.01, 19.5))
    if P["slender_pin"]:
        base = base.fuse(cyl(0.7, 22.0, (Lx - 3.5, 45.0, -0.01)))
    base = base.removeSplitter()
    # holes and openings
    for k, (hx, hy) in H_ALL.items():
        if k not in P["screwed"]:
            continue
        pil = P["so_pilot"]
        base = base.cut(cyl(pil / 2, uz + P["so_pilot_below"] + 0.5,
                            (ux + hx, uy + hy, -P["so_pilot_below"])))
    for i, (cx, cy) in enumerate(posts):
        base = base.cut(cyl(P["post_pilot"] / 2, P["post_depth"] + 1, (cx, cy, H - P["post_depth"])))
    usb_cy, usb_cz = uy + USB_Y + P["usb_dy"], uz + 1.6 + 5.5
    base = base.cut(box(-t - 1, usb_cy - P["usb_w"] / 2, usb_cz - P["usb_h"] / 2, 0.01,
                        usb_cy + P["usb_w"] / 2, H + 1))
    dc_cy, dc_cz = uy + DC_Y, uz + 1.6 + 5.5
    base = base.cut(box(-t - 1, dc_cy - P["dc_w"] / 2, dc_cz - P["dc_w"] / 2, 0.01,
                        dc_cy + P["dc_w"] / 2, H + 1))
    base = base.cut(cyl(P["cable_d"] / 2, t + 2, (Lx - 1, 30.0, 10.0), (1, 0, 0)))
    if P["skin"]:
        base = base.cut(box(38, -2.2, 10.5, 42, 0.01, 13.5))
    if P["extra_hole"]:
        base = base.cut(cyl(1.7, fl + 2, (40.0, 30.0, -fl - 1)))
    if P["float_h2"]:
        k, so = sos[1]
        base = Part.makeCompound([base, so])

    # ---------------- lid
    g = P["lip_gap"]
    lid = box(-t, -t, H, Lx + t, Ly + t, H + P["lid_t"])
    lip = box(g, g, H - P["lip_d"], Lx - g, Ly - g, H + 0.01).cut(
        box(g + P["lip_t"], g + P["lip_t"], H - P["lip_d"] - 1, Lx - g - P["lip_t"], Ly - g - P["lip_t"], H + 1))
    for (cx, cy) in posts:
        lip = lip.cut(box(cx - s / 2 - 0.5, cy - s / 2 - 0.5, H - 5, cx + s / 2 + 0.5, cy + s / 2 + 0.5, H + 1))
    lid = lid.fuse(lip).removeSplitter()
    lid_holes = []
    for i, (cx, cy) in enumerate(posts):
        dx = P["lid_hole_dx"] if i == 1 else 0.0
        lid = lid.cut(cyl(P["lid_hole"] / 2, P["lid_t"] + 2, (cx + dx, cy, H - 1)))
        lid_holes.append((cx + dx, cy))
    P["lid_holes"] = lid_holes
    return base, lid


def manifest(P, name, parts):
    ux, uy, uz = P["ux"], P["uy"], P["sh"]
    fast = []
    for k in P["screwed"]:
        hx, hy = H_ALL[k]
        fast.append({"id": "uno-%s" % k, "screw": {"thread": "M3", "length": P["uno_screw"], "head": "cheese"},
                     "kind": "self-tap", "origin": [round(ux + hx, 3), round(uy + hy, 3), round(uz + 1.6, 3)],
                     "dir": [0, 0, -1], "joins": ["component:uno", "Base"], "installed_before": ["Lid"]})
    for i, (cx, cy) in enumerate(P["lid_holes"]):
        fast.append({"id": "lid-%d" % (i + 1), "screw": {"thread": "M3", "length": P["lid_screw"], "head": "cheese"},
                     "kind": "self-tap", "origin": [round(cx, 3), round(cy, 3), P["H"] + P["lid_t"]],
                     "dir": [0, 0, -1], "joins": ["Lid", "Base"]})
    comp = {"id": "uno", "ref": "arduino-uno-r3",
            "placement": {"pos": [ux, uy, uz]},
            "connectors_used": ["usb_b", "dc_jack"]}
    if name == "clean_measured":
        # what the user would enter after the calipers (here: confirming the drawing)
        comp["measured"] = {k: {"v": v, "unc": 0.05} for k, v in
                            dict(h1_x=13.97, h1_y=2.54, h3_x=66.04, h3_y=7.62, h4_x=66.04, h4_y=35.56,
                                 usb_plug_w=16.0, usb_plug_h=12.0, dc_plug_d=10.0, dc_h=11.0,
                                 under=2.0, standoff_free_d=6.4).items()}
    return {
        "project": "uno-box-test", "version": name, "material": "PLA", "printer": "Bambu Lab P1S 0.4",
        "purpose": "Uno enclosure: USB-B and DC reachable, removable lid on 4 screws, cable exit",
        "sources": ["../../build.py"],
        "parts": parts,
        "components": [comp],
        "contacts": [["component:uno", "Base"]],
        "holes_not_fasteners": [{"part": "Base", "at": [P["Lx"] + 1.2, 30.0, 10.0], "reason": "sensor cable exit"}],
        "fasteners": fast,
        "fits": [{"name": "lid lip in base", "a": "Lid", "b": "Base", "axis": [0, 0, 1], "type": "slide"}],
        "access": [{"name": "sensor cable exit", "why": "4 mm cable + 1 mm",
                    "cyl": {"base": [P["Lx"] - 5, 30.0, 10.0], "dir": [1, 0, 0], "d": 5.0, "len": 15.0}}],
        "motions": "none",
        **({"thin_ok": [{"part": "Base", "at": P["thin_ok"], "max_area": 2.0,
                         "reason": "test: skin left by a pocket, prints as a slit"}]} if P["thin_ok"] else {}),
    }


def main():
    from lib.export import export_part
    for name, over in VARIANTS.items():
        P = copy.deepcopy(BASE)
        P.update(over)
        d = os.path.join(OUT, name)
        os.makedirs(d, exist_ok=True)
        base, lid = build(P)
        parts = [export_part(base, "Base", d), export_part(lid, "Lid", d, [[[1, 0, 0], 180]])]
        stl = os.path.join(d, "stl", "Lid.stl")
        if P["mesh_damage"]:
            m = Mesh.Mesh(stl)
            m.removeFacets(list(range(0, 40)))
            m.write(stl)
        if P["stl_scale"]:
            m = Mesh.Mesh(stl)
            mat = App.Matrix()
            mat.scale(P["stl_scale"], P["stl_scale"], P["stl_scale"])
            m.transform(mat)
            m.write(stl)
        with open(os.path.join(d, "cadkit.yaml"), "w", encoding="utf-8") as f:
            f.write("# generated by tests/uno_box/build.py - variant %s\n" % name)
            yaml.safe_dump(manifest(P, name, parts), f, sort_keys=False)
    with open(os.path.join(OUT, "built.txt"), "w") as f:
        f.write("\n".join(VARIANTS))


if not _RAN:
    main()
