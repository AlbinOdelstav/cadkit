# -*- coding: utf-8 -*-
"""Geometry probes shared by the checks."""

import math
import FreeCAD as App
from FreeCAD import Vector as V
import Part

INF = 1e9


def vec(x):
    v = V(*x)
    return v


def unit(x):
    v = V(*x)
    v.normalize()
    return v


def section_faces(shape, n, dist):
    """Faces of `shape` cut by the plane {p : p.n == dist}."""
    try:
        wires = shape.slice(n, dist)
    except Exception:
        return []
    if not wires:
        return []
    try:
        return Part.makeFace(wires, "Part::FaceMakerBullseye").Faces
    except Exception:
        try:
            return [Part.Face(w) for w in wires if w.isClosed()]
        except Exception:
            return []


def free_radius(shape, origin, u, t, bb=None):
    """Distance from the axis point origin+u*t to the nearest material of
    `shape` in the plane through that point, normal to the axis.

    0 means the point is inside material. INF means the plane misses the shape.
    """
    p = origin + u * t
    if bb is not None:
        bb2 = App.BoundBox(bb)
        bb2.enlarge(0.01)
        # the plane must cross the box at all
        cs = [V(x, y, z) for x in (bb2.XMin, bb2.XMax) for y in (bb2.YMin, bb2.YMax)
              for z in (bb2.ZMin, bb2.ZMax)]
        ds = [(c - p).dot(u) for c in cs]
        if min(ds) > 0 or max(ds) < 0:
            return INF
    faces = section_faces(shape, u, p.dot(u))
    if not faces:
        return INF
    comp = Part.Compound(faces)
    return comp.distToShape(Part.Vertex(p))[0]


def profile(shape, origin, u, t0, t1, step=0.25):
    """[(t, free_radius)] along the axis."""
    bb = shape.BoundBox
    out = []
    n = int(round((t1 - t0) / step))
    for i in range(n + 1):
        t = t0 + i * step
        out.append((t, free_radius(shape, origin, u, t, bb)))
    return out


def runs(prof, pred):
    """Contiguous t-intervals where pred(f) holds: [(t_start, t_end)]."""
    out, cur = [], None
    step = prof[1][0] - prof[0][0] if len(prof) > 1 else 0.25
    for t, f in prof:
        if pred(f):
            if cur is None:
                cur = [t, t]
            cur[1] = t
        elif cur is not None:
            out.append((cur[0], cur[1] + step))
            cur = None
    if cur is not None:
        out.append((cur[0], cur[1] + step))
    return out


def min_dist(a, b):
    try:
        return a.distToShape(b)[0]
    except Exception:
        return None


def overlap_volume(a, b):
    try:
        if not a.BoundBox.intersect(b.BoundBox):
            return 0.0
        return a.common(b).Volume
    except Exception:
        return None


def print_pose(shape, rotations):
    """Copy of shape rotated as listed and dropped onto z=0."""
    s = shape.copy()
    for axis, deg in rotations or []:
        s.rotate(V(0, 0, 0), V(*axis), deg)
    bb = s.BoundBox
    s.translate(V(-bb.XMin, -bb.YMin, -bb.ZMin))
    return s


def cylinders(shape, rmin, rmax):
    """Concave cylindrical faces (holes) with radius in [rmin, rmax]:
    [(centre_point, axis_dir, radius)]."""
    out = []
    for f in shape.Faces:
        s = f.Surface
        if s.__class__.__name__ != "Cylinder":
            continue
        r = s.Radius
        if not (rmin <= r <= rmax):
            continue
        c = s.Center
        d = s.Axis
        # concave = the axis lies outside the material
        try:
            u0, u1, v0, v1 = f.ParameterRange
            pm = f.valueAt((u0 + u1) / 2, (v0 + v1) / 2)
            # point on axis nearest pm
            k = (pm - c).dot(d)
            pa = c + d * k
            if shape.isInside(pa, 1e-4, True):
                continue
            out.append((pa, d, r))
        except Exception:
            continue
    # dedupe co-axial faces (a hole split into two half faces)
    ded = []
    for pa, d, r in out:
        if any(abs(r - r2) < 0.05 and abs(abs(d.dot(d2)) - 1) < 1e-3 and
               ((pa - p2) - d2 * (pa - p2).dot(d2)).Length < 0.05 for p2, d2, r2 in ded):
            continue
        ded.append((pa, d, r))
    return ded


def line_dist(p, d, q):
    """Distance from point q to the line p + s*d (d unit)."""
    w = q - p
    return (w - d * w.dot(d)).Length
