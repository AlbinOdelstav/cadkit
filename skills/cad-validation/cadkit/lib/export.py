# -*- coding: utf-8 -*-
"""Export helper for build scripts, so every part reaches the validator the
same way:

    import sys, os; sys.path.insert(0, "<plugin>/skills/cad-validation/cadkit")
    from lib.export import export_part
    entry = export_part(shape, "Lid", version_dir, print_rotation=[[[1, 0, 0], 180]])

writes  <version_dir>/parts/Lid.brep   exact geometry, ASSEMBLED position
        <version_dir>/stl/Lid.stl      mesh in PRINT pose, on z = 0
and returns the manifest entry for `parts:`.
"""

import os
import MeshPart

from . import geom


def export_part(shape, name, version_dir, print_rotation=None, lin=0.02, ang=0.2):
    pd = os.path.join(version_dir, "parts")
    sd = os.path.join(version_dir, "stl")
    os.makedirs(pd, exist_ok=True)
    os.makedirs(sd, exist_ok=True)
    brep = os.path.join(pd, name + ".brep")
    stl = os.path.join(sd, name + ".stl")
    shape.exportBrep(brep)
    pose = geom.print_pose(shape, print_rotation)
    m = MeshPart.meshFromShape(Shape=pose, LinearDeflection=lin, AngularDeflection=ang,
                               Relative=False)
    m.write(stl)
    return {"name": name, "brep": "parts/%s.brep" % name, "stl": "stl/%s.stl" % name,
            "print_rotation": print_rotation or []}
