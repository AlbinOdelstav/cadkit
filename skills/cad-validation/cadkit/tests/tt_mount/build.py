# -*- coding: utf-8 -*-
"""Test design 2: a TT motor held by a printed retainer plate.

Two printed pins go through a wall into the gearbox's 3.0 through-holes, and
one M3 screw passes loose through plate and wall and THREADS INTO the motor's
tail tab. Exercises: screws threading into a bought part (library `threads:`),
fits into a bought part's hole with per-hole uncertainty (`origin:`).

    "C:/Program Files/FreeCAD 1.1/bin/freecadcmd.exe" tests/tt_mount/build.py
-> tests/tt_mount/out/<variant>/ (cadkit.yaml, parts/, stl/)
"""
import os, sys

_RAN = globals().get("_TTMOUNT_RAN", False)
_TTMOUNT_RAN = True

import yaml
import Part
from FreeCAD import Vector as V

HERE = os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else \
    os.path.join(os.getcwd(), "tests", "tt_mount")
KIT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, KIT)
from lib.export import export_part

# motor frame = assembly frame: shaft along Z, gearbox faces at z = +-9.4,
# gearbox end at x = -11.2, through-holes at (20.6, +-8.75), tail hole at x = -13.6
BASE = dict(pin_d=2.0, wall_hole=3.4, screw_x=-13.6, screw_into="tail")
VARIANTS = {
    "clean": {},                                  # pins 2.0: 0.5 per side, 0.2 left after ±0.3 hole uncertainty
    "pin_tight_vs_unc": {"pin_d": 2.5},           # 0.25 per side < ±0.3: may not line up
    "pin_too_big": {"pin_d": 2.95},               # 0.025 per side: no fit at all
    "screw_into_gearbox": {"screw_into": "gearbox"},  # thread into a hole that is not declared to take one
}
FACE = -9.4
WALL_T, PLATE_T = 3.0, 3.0
HOLES = [(20.6, 8.75), (20.6, -8.75)]


def cyl(r, h, x, y, z):
    return Part.makeCylinder(r, h, V(x, y, z))


def build(P):
    sx, sy = (P["screw_x"], 0.0) if P["screw_into"] == "tail" else HOLES[0]
    z0w = FACE - WALL_T
    wall = Part.makeBox(70, 40, WALL_T, V(-25, -20, z0w))
    plate = Part.makeBox(70, 40, PLATE_T, V(-25, -20, z0w - PLATE_T))
    for part in ("wall", "plate"):
        s = wall if part == "wall" else plate
        z = s.BoundBox.ZMin - 1
        s = s.cut(cyl(4.5, 10, 0, 0, z))                     # shaft + collar
        s = s.cut(cyl(1.75, 10, sx, sy, z))                  # screw, loose (3.5)
        if part == "wall":
            for x, y in HOLES:
                s = s.cut(cyl(P["wall_hole"] / 2, 10, x, y, z))
            wall = s
        else:
            plate = s
    pins = None
    if P["screw_into"] == "tail":
        for x, y in HOLES:                                   # plate bottom up to 4 mm into the gearbox
            p = cyl(P["pin_d"] / 2, PLATE_T + WALL_T + 4.0, x, y, z0w - PLATE_T)
            pins = p if pins is None else pins.fuse(p)
        plate = plate.fuse(pins).removeSplitter()
    return wall, plate, (sx, sy)


def manifest(P, entries, screw_xy):
    sx, sy = screw_xy
    m = dict(
        project="cadkit-test-tt-mount", version="v1", material="PLA", printer="Bambu Lab P1S 0.4",
        purpose="Hold a TT motor on a wall: two printed pins in the gearbox holes, one screw into the tail.",
        sources=["../../build.py"],
        parts=entries,
        components=[dict(id="tt", ref="tt-motor-dual-shaft",
                         placement=dict(pos=[0, 0, 0], rot=[]), connectors_used=[])],
        contacts=[["Plate", "Wall"], ["component:tt", "Wall"]],
        engaged=[],
        fasteners=[dict(id="tail-screw", screw=dict(thread="M3", length=20, head="cheese"),
                        kind="self-tap", origin=[sx, sy, FACE - WALL_T - PLATE_T], dir=[0, 0, 1],
                        joins=["Plate", "Wall", "component:tt"])],
        holes_not_fasteners=[dict(part="Wall", at=[x, y, FACE - WALL_T / 2], reason="pin hole")
                             for x, y in HOLES],
        fits=([dict(name="pins in gearbox holes", a="Plate", b="component:tt", axis=[0, 0, 1],
                    type="short", origin=[HOLES[0][0], HOLES[0][1], 0], at=[-8.5, -7.0, -6.0])]
              if P["screw_into"] == "tail" else "none"),
        access="none",
        motions="none",
    )
    return m


def main():
    for v, ov in VARIANTS.items():
        P = dict(BASE, **ov)
        d = os.path.join(HERE, "out", v)
        wall, plate, sxy = build(P)
        entries = [export_part(wall, "Wall", d), export_part(plate, "Plate", d)]
        with open(os.path.join(d, "cadkit.yaml"), "w", encoding="utf-8") as f:
            yaml.safe_dump(manifest(P, entries, sxy), f, sort_keys=False)


if not _RAN:
    main()
