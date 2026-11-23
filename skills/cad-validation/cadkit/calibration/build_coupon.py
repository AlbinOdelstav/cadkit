# -*- coding: utf-8 -*-
"""P1S / PLA calibration coupon: one ~15 g print that measures the values in
your tolerance profile on YOUR printer.

    freecadcmd build_coupon.py   (or: node cadkit.mjs coupon)
-> calibration/out/coupon_plate.stl, coupon_pegs.stl, COUPON.md (what to test)

Print both STLs flat, as exported, 0.2 mm layers, 3 walls, 15 % infill, no
support, the material you are calibrating. Then follow COUPON.md and put the
results in your tolerance profile (source: CALIBRATION + date).

Features are identified by NOTCHES on the plate edge (no text: freecadcmd has
no reliable font), counted from the left as seen from the top.
"""
import os, sys

_RAN = globals().get("_COUPON_RAN", False)
_COUPON_RAN = True

import FreeCAD as App
from FreeCAD import Vector as V
import Part, MeshPart

HERE = os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else \
    os.path.join(os.environ.get("CADKIT_HOME", os.getcwd()), "calibration")
OUT = os.path.join(HERE, "out")

PLATE = (100.0, 46.0, 4.0)
# row A: vertical M3 screw holes, clearance + self-tap pilot ladders
CLEAR = [3.2, 3.3, 3.4, 3.5, 3.6]
PILOT = [2.4, 2.5, 2.6, 2.7, 2.8]
# row B: peg-in-hole slide fit, gap PER SIDE (pegs printed separately, 8 mm)
SLIDE = [0.15, 0.25, 0.35, 0.45, 0.55]
PEG_D = 8.0
# row C: hex nut pockets for M3 (AF 5.5) + extra on the flats
NUT_EXTRA = [0.1, 0.2, 0.3, 0.4]
# side wall: horizontal 3.4 holes, round vs teardrop
# fins: wall thickness 0.4 / 0.6 / 0.8 / 1.0 / 1.2, 10 mm tall
FINS = [0.4, 0.6, 0.8, 1.0, 1.2]


def hexagon(af, h, c):
    import math
    r = af / 2 / math.cos(math.radians(30))
    pts = [V(c[0] + r * math.cos(math.radians(60 * i)), c[1] + r * math.sin(math.radians(60 * i)), c[2])
           for i in range(6)]
    w = Part.makePolygon(pts + [pts[0]])
    return Part.Face(w).extrude(V(0, 0, h))


FONT = "C:/Windows/Fonts/arialbd.ttf"
DEPTH = 0.6


def engrave(txt, cx, cy, ztop, h):
    """Solid of the text, centred on (cx, cy), from ztop - DEPTH to ztop + 1."""
    chars = Part.makeWireString(txt, FONT, h, 0.2)
    faces = []
    for wires in chars:
        if wires:
            faces += Part.makeFace(wires, "Part::FaceMakerBullseye").Faces
    comp = Part.makeCompound(faces)
    bb = comp.BoundBox
    comp.translate(V(cx - (bb.XMin + bb.XMax) / 2, cy - (bb.YMin + bb.YMax) / 2, ztop - DEPTH))
    solids = [f.extrude(V(0, 0, DEPTH + 1)) for f in comp.Faces]
    return solids[0].fuse(solids[1:]) if len(solids) > 1 else solids[0]


def label_positions(xs):
    """number -> (centre x, centre y, top z, text height)."""
    T = PLATE[2]
    pos = {}
    for i, x in enumerate(xs):
        pos[1 + i] = (x + 4.5, 8, T, 3.0)                       # A: clearance holes
        pos[6 + i] = (x + (5.0 if i == 4 else 4.3), 18, T, 3.0)  # P: pilots
        pos[11 + i] = (x, 37.6, T, 2.8)                        # B: peg holes
    for i in range(4):                                          # C: nut pockets
        pos[16 + i] = (80 + (i % 2) * 12, 14 if i < 2 else 26, T, 2.8)
    for i, t in enumerate(FINS):                                # F: fins (staggered)
        pos[20 + i] = (76 + 4 * i + t / 2, 37.6 if i % 2 == 0 else 33.6, T, 2.6)
    pos[25] = (6, 43, T + 12, 3.0)                              # side block, round hole
    pos[26] = (16, 43, T + 12, 3.0)                             # side block, teardrop hole
    pos[27] = (40, 43, T + 12, 3.0)                             # bridge
    return pos


def build():
    L, W, T = PLATE
    plate = Part.makeBox(L, W, T)
    xs = [10 + 13 * i for i in range(5)]
    # row A (y = 8): clearance holes, row A' (y = 18): pilots (blind, 3.5 deep from top)
    for x, d in zip(xs, CLEAR):
        plate = plate.cut(Part.makeCylinder(d / 2, T + 2, V(x, 8, -1)))
    for x, d in zip(xs, PILOT):
        plate = plate.cut(Part.makeCylinder(d / 2, T, V(x, 18, 0.5)))
    # row B (y = 31): peg holes
    for x, g in zip(xs, SLIDE):
        plate = plate.cut(Part.makeCylinder(PEG_D / 2 + g, T + 2, V(x, 31, -1)))
    # row C (x = 78..96): nut pockets 2.6 deep from top, with a 3.4 through hole
    for i, e in enumerate(NUT_EXTRA):
        c = (80 + (i % 2) * 12, 8 + (i // 2) * 12, T - 2.6)
        plate = plate.cut(hexagon(5.5 + e, 3, c))
        plate = plate.cut(Part.makeCylinder(1.7, T + 2, V(c[0], c[1], -1)))
    # fins along the back edge (y = 40..44), 10 mm tall
    for i, t in enumerate(FINS):
        plate = plate.fuse(Part.makeBox(t, 4, 10, V(76 + 4 * i, 40, T)))
    # side block with horizontal holes: round (x=6) and teardrop (x=16)
    blk = Part.makeBox(24, 6, 12, V(0, W - 6, T))
    blk = blk.cut(Part.makeCylinder(1.7, 8, V(6, W - 7, T + 6), V(0, 1, 0)))
    td = Part.makeCylinder(1.7, 8, V(16, W - 7, T + 6), V(0, 1, 0))
    import math
    tri = Part.makePolygon([V(16 - 1.7 * math.cos(math.radians(45)), W - 7, T + 6 + 1.7 * math.sin(math.radians(45))),
                            V(16, W - 7, T + 6 + 1.7 / math.cos(math.radians(45))),
                            V(16 + 1.7 * math.cos(math.radians(45)), W - 7, T + 6 + 1.7 * math.sin(math.radians(45))),
                            V(16 - 1.7 * math.cos(math.radians(45)), W - 7, T + 6 + 1.7 * math.sin(math.radians(45)))])
    td = td.fuse(Part.Face(tri).extrude(V(0, 8, 0)))
    blk = blk.cut(td)
    # 20 mm bridge over the block's top slot
    br = Part.makeBox(28, 6, 2, V(26, W - 6, T + 10)).fuse(Part.makeBox(4, 6, 10, V(26, W - 6, T))) \
        .fuse(Part.makeBox(4, 6, 10, V(50, W - 6, T)))
    plate = plate.fuse(blk).fuse(br)
    # orientation notch: one notch at the left front corner
    plate = plate.cut(Part.makeBox(3, 3, T + 2, V(-1, -1, -1)))
    # engraved feature numbers 1..27 (see LABELS / COUPON.md)
    for n, (cx, cy, zt, h) in label_positions(xs).items():
        plate = plate.cut(engrave(str(n), cx, cy, zt, h))
    plate = plate.removeSplitter()
    pegs = None
    for i in range(5):
        p = Part.makeCylinder(PEG_D / 2, 10, V(8 + 12 * i, 8, 0))
        p = p.cut(Part.makeBox(1.0, 1.0, 10, V(8 + 12 * i - 0.5, 8 + PEG_D / 2 - 0.6, 0)))  # grip mark
        pegs = p if pegs is None else pegs.fuse(p)
    return plate, pegs


def write(shape, name):
    m = MeshPart.meshFromShape(Shape=shape, LinearDeflection=0.01, AngularDeflection=0.15, Relative=False)
    p = os.path.join(OUT, name)
    m.write(p)
    return p, shape.Volume / 1000 * 1.24


def main():
    os.makedirs(OUT, exist_ok=True)
    plate, pegs = build()
    assert len(plate.Solids) == 1 and plate.isValid(), "coupon plate is not one valid solid"
    p1, g1 = write(plate, "coupon_plate.stl")
    p2, g2 = write(pegs, "coupon_pegs.stl")
    rows = []
    for i, d in enumerate(CLEAR):
        rows.append((1 + i, "M3 genomgående hål", "Ø %.1f" % d, "faller skruven igenom fritt?"))
    for i, d in enumerate(PILOT):
        rows.append((6 + i, "M3 pilothål, 3,5 djupt", "Ø %.1f" % d, "går skruven i utan sprickor, och greppar den?"))
    for i, g in enumerate(SLIDE):
        rows.append((11 + i, "hål för plugg (Ø 8,0)", "glapp %.2f per sida" % g, "glider pluggen i för hand? glappar den?"))
    for i, e in enumerate(NUT_EXTRA):
        rows.append((16 + i, "M3-mutterficka", "nyckelvidd 5,5 + %.1f" % e, "trycks muttern in med fingret? sitter den kvar?"))
    for i, t in enumerate(FINS):
        rows.append((20 + i, "fena (vägg)", "%.1f mm tjock" % t, "blev den hel, eller glesa/saknas?"))
    rows.append((25, "liggande hål, runt", "Ø 3,4", "går skruven igenom? har taket hängt ner?"))
    rows.append((26, "liggande hål, droppform", "Ø 3,4", "går skruven igenom? jämför med 25"))
    rows.append((27, "bro", "20 mm spann", "plan eller hängig undersida?"))
    table = "\n".join("| %d | %s | %s | %s |" % r for r in rows)
    md = """# Kalibreringsbit (P1S, 0,4 munstycke)

Skriv ut `coupon_plate.stl` och `coupon_pegs.stl` platt som de är
exporterade. 0,20 mm lager, 3 väggar, 15 %% fyllnad, ingen support.
Uppskattning: ~%.0f g. Varje provdetalj har ett graverat nummer.
Använd vanliga M3-maskinskruvar (t.ex. M3 x 10 DIN 84) och de
5 pluggarna (alla Ø 8,0) till hålen 11-15.

| Nr | Vad | Storlek | Testa |
|---|---|---|---|
%s

Svara till exempel: "1-2 trånga, 3 bra. 6 sprack, 7-8 bra, 9 greppar dåligt.
Plugg går i 13, glappar i 15. Mutter 17. Fena 20 saknas, 21 glesa.
26 bättre än 25. Bron hänger lite."

Värdena förs in i din toleransprofil med `source: CALIBRATION <datum>`, och sedan `calibrated: true`.
""" % ((g1 + g2) * 0.55, table)
    with open(os.path.join(OUT, "COUPON.md"), "w", encoding="utf-8") as f:
        f.write(md)


if not _RAN:
    main()
