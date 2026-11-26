# -*- coding: utf-8 -*-
"""Test design 3: a top plate bolted to a block with an M3 screw and a hex nut.

Exercises the nut checks: the hex (corners included) fits its pocket, and the
nut has a straight free path in (along the axis, or sideways through a slot).

    "C:/Program Files/FreeCAD 1.1/bin/freecadcmd.exe" tests/nut_block/build.py
-> tests/nut_block/out/<variant>/ (cadkit.yaml, parts/, stl/)
"""
import math, os, sys

_RAN = globals().get("_NUTBLOCK_RAN", False)
_NUTBLOCK_RAN = True

import yaml
import Part
from FreeCAD import Vector as V

HERE = os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else \
    os.path.join(os.getcwd(), "tests", "nut_block")
KIT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, KIT)
from lib.export import export_part

AF = 5.5 + 0.25           # M3 nut AF 5.5 + pocket allowance
DEPTH = 2.6               # pocket depth for a 2.4 nut
CX, CY = 15.0, 15.0
BASE = dict(pocket="bottom", round_d=None, cover=False, nut_before=None, nut_insert=None)
VARIANTS = {
    "clean": {},                                               # hex pocket open at the block bottom
    "side_slot": {"pocket": "slot"},                           # nut slides in sideways through a slot
    "trapped": {"pocket": "enclosed"},                         # closed cavity: no way in
    "trapped_print_pause": {"pocket": "enclosed", "nut_insert": "print_pause"},
    "round_pocket": {"round_d": 5.9},                          # round pocket: the corners (6.5) do not fit
    "slot_covered": {"pocket": "slot", "cover": True},         # a cover blocks the slot
    "slot_covered_declared": {"pocket": "slot", "cover": True, "nut_before": ["Cover"]},
}


def hex_prism(af, z0, h):
    rc = af / math.sqrt(3.0)
    pts = [V(CX + rc * math.cos(math.radians(60 * k)), CY + rc * math.sin(math.radians(60 * k)), z0)
           for k in range(6)]
    return Part.Face(Part.makePolygon(pts + [pts[0]])).extrude(V(0, 0, h))


def build(P):
    top = Part.makeBox(30, 30, 3, V(0, 0, 10))
    block = Part.makeBox(30, 30, 10, V(0, 0, 0))
    hole = Part.makeCylinder(1.75, 20, V(CX, CY, -2))
    top, block = top.cut(hole), block.cut(hole)
    if P["round_d"]:
        block = block.cut(Part.makeCylinder(P["round_d"] / 2, DEPTH + 0.01, V(CX, CY, -0.01)))
    elif P["pocket"] == "bottom":
        block = block.cut(hex_prism(AF, -0.01, DEPTH + 0.01))
    elif P["pocket"] == "enclosed":
        block = block.cut(hex_prism(AF, 4.0, DEPTH))
    elif P["pocket"] == "slot":       # hex flats face +-Y, slot runs out through the -X face
        block = block.cut(hex_prism(AF, 4.0, DEPTH)).cut(
            Part.makeBox(CX + 1, AF, DEPTH, V(-1, CY - AF / 2, 4.0)))
    parts = [("Top", top.removeSplitter()), ("Block", block.removeSplitter())]
    if P["cover"]:
        parts.append(("Cover", Part.makeBox(3, 30, 10, V(-3, 0, 0))))
    return parts


def manifest(P, entries):
    f = dict(id="bolt", screw=dict(thread="M3", length=15, head="cheese"), kind="nut",
             origin=[CX, CY, 13.0], dir=[0, 0, -1], joins=["Top", "Block"])
    if P["nut_before"]:
        f["nut_before"] = P["nut_before"]
    if P["nut_insert"]:
        f["nut_insert"] = P["nut_insert"]
    contacts = [["Top", "Block"]] + ([["Cover", "Block"]] if P["cover"] else [])
    return dict(
        project="cadkit-test-nut-block", version="v1", material="PLA", printer="Bambu Lab P1S 0.4",
        purpose="Bolt a plate to a block with an M3 screw and a captive hex nut.",
        sources=["../../build.py"], parts=entries, components="none", contacts=contacts,
        fasteners=[f], fits="none", access="none", motions="none")


def main():
    for v, ov in VARIANTS.items():
        P = dict(BASE, **ov)
        d = os.path.join(HERE, "out", v)
        entries = [export_part(s, n, d) for n, s in build(P)]
        with open(os.path.join(d, "cadkit.yaml"), "w", encoding="utf-8") as fh:
            yaml.safe_dump(manifest(P, entries), fh, sort_keys=False)


if not _RAN:
    main()
