# -*- coding: utf-8 -*-
"""Per-part checks: solid, export, mesh, bed, walls, slender features, overhangs."""

import os, sys, math, types
import numpy as np
import FreeCAD as App
import Part, Mesh

from . import geom, morph
from .report import PASS, FAIL, WARN, NT

SK = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))  # .../skills
BED = (256.0, 256.0, 256.0)


def _load_cadreview():
    """Import cadreview's mesh helpers without running its main()."""
    path = os.path.join(SK, "cad-review", "cadreview.py")
    mod = types.ModuleType("cadreview_lib")
    mod.__dict__["_CADREVIEW_RAN"] = True
    with open(path, encoding="utf-8") as f:
        code = compile(f.read(), path, "exec")
    exec(code, mod.__dict__)
    return mod


CR = _load_cadreview()
sys.path.insert(0, os.path.join(SK, "cad-validation"))
import cadcheck  # noqa: E402


def _disk(r):
    y, x = np.ogrid[-r:r + 1, -r:r + 1]
    return x * x + y * y <= r * r


def _grid(mesh, axis, at, cell):
    loops = CR.sections(mesh, axis, at)
    q2 = [CR.to2d(l, axis) for l in loops]
    if not q2:
        return None, None
    allp = np.concatenate(q2)
    lo, hi = allp.min(0) - 1.0, allp.max(0) + 1.0
    return CR.raster(q2, lo, hi, cell), lo


def thin_features(mesh, axis, at, width, cell=0.1, min_area=0.3):
    """Regions of the section thinner than `width`: [(area_mm2, (x, y))]."""
    g, lo = _grid(mesh, axis, at, cell)
    if g is None:
        return []
    r = max(1, int(round(width / 2.0 / cell - 0.5)))
    opened = morph.opening(g, r)
    thin = g & ~opened
    lab, n = morph.label(thin)
    out = []
    for k in range(1, n + 1):
        m = lab == k
        a = m.sum() * cell * cell
        if a < min_area:
            continue
        ys, xs = np.nonzero(m)
        out.append((a, (lo[0] + xs.mean() * cell, lo[1] + ys.mean() * cell)))
    return out


def narrow_gaps(mesh, axis, at, width, cell=0.1, min_area=0.3):
    g, lo = _grid(mesh, axis, at, cell)
    if g is None:
        return []
    r = max(1, int(round(width / 2.0 / cell - 0.5)))
    closed = morph.closing(g, r)
    gap = closed & ~g
    lab, n = morph.label(gap)
    out = []
    for k in range(1, n + 1):
        m = lab == k
        a = m.sum() * cell * cell
        if a >= min_area:
            ys, xs = np.nonzero(m)
            out.append((a, (lo[0] + xs.mean() * cell, lo[1] + ys.mean() * cell)))
    return out


def slender(mesh, step=0.5, cell=0.1, max_extent=12.0):
    """Worst free-standing slender island: (ratio, height, width, (x, y, z)).

    An island is a small separate region of a horizontal section. Its run
    starts where it splits off from the rest of the part and ends where it
    joins something again (a hoop, a roof). Height of the run over the
    island's narrowest caliper width is the slenderness. Written for a
    real failure: 1.6 mm cage bars, 40 mm tall, broke off while printing.
    """
    bb = mesh.BoundBox
    angs = np.radians(np.arange(0, 180, 10.0))
    dirs = np.stack([np.cos(angs), np.sin(angs)])
    lo = np.array([bb.XMin - 1, bb.YMin - 1])
    hi = np.array([bb.XMax + 1, bb.YMax + 1])
    prev_lab, prev_info = None, {}
    worst = (0.0, 0.0, 0.0, None)
    z = bb.ZMin + 0.3
    while z < bb.ZMax - 0.2:
        loops = CR.sections(mesh, "z", z)
        q2 = [CR.to2d(l, "z") for l in loops]
        g = CR.raster(q2, lo, hi, cell) if q2 else np.zeros((2, 2), bool)
        lab, n = morph.label(g)
        info = {}
        for k in range(1, n + 1):
            ys, xs = np.nonzero(lab == k)
            pts = np.stack([xs, ys], 1) * cell
            proj = pts @ dirs
            w = proj.max(0) - proj.min(0) + cell
            small = w.max() <= max_extent
            start, wmin = z, w.min()
            if prev_lab is not None and small:
                ov = set(np.unique(prev_lab[lab == k])) - {0}
                if len(ov) == 1:
                    pk = ov.pop()
                    pi = prev_info.get(pk)
                    # inherit only if the previous region was a small island that
                    # did not split: one-to-one continuation
                    if pi and pi["small"] and (prev_lab == pk).sum() > 0:
                        others = set(np.unique(lab[prev_lab == pk])) - {0}
                        if len(others) == 1:
                            start, wmin = pi["start"], min(pi["wmin"], w.min())
            info[k] = dict(small=small, start=start, wmin=wmin)
            if small:
                h = z - start
                ratio = h / max(wmin, cell)
                if ratio > worst[0]:
                    worst = (ratio, h, wmin, (lo[0] + xs.mean() * cell,
                                              lo[1] + ys.mean() * cell, z))
        prev_lab, prev_info = lab, info
        z += step
    return worst


def check_part(rep, man, part, tol):
    name = part["name"]
    pr = tol["printability"]
    cat = "part"
    for k in ("brep", "stl"):
        if not os.path.exists(part[k]):
            rep.add(cat, "%s file exists" % k.upper(), FAIL, "missing: %s" % part[k], item=name)
            return None
    # -- stale export
    st = os.path.getmtime(part["stl"])
    stale = [s for s in man["sources"] if os.path.exists(s) and os.path.getmtime(s) > st + 1]
    missing = [s for s in man["sources"] if not os.path.exists(s)]
    if stale:
        rep.add("export", "STL newer than its sources", FAIL,
                "%s edited after the STL - rebuild" % ", ".join(os.path.basename(s) for s in stale),
                item=name)
    elif missing:
        rep.add("export", "STL newer than its sources", WARN,
                "source not found: %s" % ", ".join(missing), item=name)
    else:
        rep.add("export", "STL newer than its sources", PASS, "up to date", item=name)

    shape = Part.read(part["brep"])
    # -- solid validity
    ok = shape.isValid()
    rep.add("geometry", "B-rep is valid", PASS if ok else FAIL,
            "isValid()" if ok else "invalid shape - check booleans", item=name)
    sols = shape.Solids
    if len(sols) == 1:
        rep.add("geometry", "one connected solid", PASS, "1 solid", item=name)
    elif not sols:
        rep.add("geometry", "one connected solid", FAIL, "no solid at all (shell or faces only)", item=name)
    else:
        vols = sorted((s.Volume for s in sols), reverse=True)
        rep.add("geometry", "one connected solid", FAIL,
                "%d separate solids, volumes %s mm3 - lumps that touch but are not fused"
                % (len(sols), ", ".join("%.0f" % v for v in vols[:5])), item=name,
                where="smallest at %s" % _ctr(min(sols, key=lambda s: s.Volume)))
    # -- export matches model
    pose = geom.print_pose(shape, part.get("print_rotation"))
    m = Mesh.Mesh(part["stl"])
    mb, pb = m.BoundBox, pose.BoundBox
    ms = (mb.XLength, mb.YLength, mb.ZLength)
    ps = (pb.XLength, pb.YLength, pb.ZLength)
    dd = max(abs(a - b) for a, b in zip(ms, ps))
    tolb = 0.1 + 0.002 * max(ps)
    vol_rel = abs(m.Volume - pose.Volume) / max(pose.Volume, 1e-9)
    msg = "STL %.2f x %.2f x %.2f, model in print pose %.2f x %.2f x %.2f, volume %+.1f %%" % (
        ms + ps + (100 * (m.Volume - pose.Volume) / max(pose.Volume, 1e-9),))
    if dd <= tolb and vol_rel <= 0.015:
        rep.add("export", "STL matches the CAD model", PASS, msg, "size ±%.2f, volume ±1.5 %%" % tolb, item=name)
    else:
        hint = ""
        for f in (25.4, 10.0, 0.1, 1 / 25.4, 1000.0, 0.001):
            if max(abs(a * f - b) for a, b in zip(ms, ps)) <= tolb * 2:
                hint = " - scale off by x%.4g (unit error)" % (1 / f)
        if not hint and max(abs(a - b) for a, b in zip(sorted(ms), sorted(ps))) <= tolb:
            hint = " - same sizes, different orientation (print_rotation wrong?)"
        rep.add("export", "STL matches the CAD model", FAIL, msg + hint,
                "size ±%.2f, volume ±1.5 %%" % tolb, item=name)
    if abs(mb.ZMin) > 0.01:
        rep.add("print", "STL sits on z=0", WARN, "ZMin %.2f" % mb.ZMin, item=name)
    # -- mesh
    comps = m.countComponents()
    rep.add("mesh", "single shell", PASS if comps == 1 else FAIL, "%d shell(s)" % comps, item=name)
    rep.add("mesh", "watertight", PASS if m.isSolid() else FAIL, "", item=name)
    nm = m.hasNonManifolds()
    rep.add("mesh", "manifold", FAIL if nm else PASS, "non-manifold edges" if nm else "", item=name)
    rep.add("mesh", "normals outward", PASS if m.Volume > 0 else FAIL,
            "volume %.1f cm3" % (m.Volume / 1000.0), item=name)
    try:
        si = m.hasSelfIntersections()
        rep.add("mesh", "no self-intersections", FAIL if si else PASS, "", item=name)
    except Exception as e:
        rep.add("mesh", "no self-intersections", NT, "could not test: %s" % e, item=name)
    # -- bed
    fits = sorted(ms[:2]) <= sorted(BED[:2]) and ms[2] <= BED[2]
    rep.add("print", "fits the P1S bed", PASS if fits else FAIL,
            "%.0f x %.0f x %.0f mm" % ms, "256 x 256 x 256", item=name)
    # -- first layer
    first = CR.loops_info(CR.sections(m, "z", mb.ZMin + 0.1), "z")
    fa = sum(i["area"] * (-1 if i["hole"] else 1) for i in first)
    ratio = mb.ZLength / max(math.sqrt(max(fa, 1e-6)), 1e-6)
    tag = PASS
    if fa < 25:
        tag = WARN
    elif ratio > 4:
        tag = WARN
    rep.add("print", "first layer holds the part", tag,
            "%.0f mm2 on the plate, height/footprint %.1f" % (fa, ratio),
            ">= 25 mm2, ratio <= 4", item=name)
    # -- walls, in three directions
    worst_fail, worst_warn, gaps = [], [], []
    for ax, lo, hi in (("z", mb.ZMin, mb.ZMax), ("x", mb.XMin, mb.XMax), ("y", mb.YMin, mb.YMax)):
        if hi - lo < 1.0:
            continue
        for at in np.linspace(lo + 0.35, hi - 0.35, 10):
            for a, (u, v) in thin_features(m, ax, at, pr["min_wall"]):
                worst_fail.append((a, ax, at, u, v))
            for a, (u, v) in thin_features(m, ax, at, pr["warn_wall"], min_area=1.0):
                worst_warn.append((a, ax, at, u, v))
            for a, (u, v) in narrow_gaps(m, ax, at, pr["min_gap"]):
                gaps.append((a, ax, at, u, v))

    def where(t):
        a, ax, at, u, v = t
        names = [c for c in "xyz" if c != ax]
        return "%s=%.1f, %s=%.1f %s=%.1f (print pose)" % (ax, at, names[0], u, names[1], v)

    if worst_fail:
        w = max(worst_fail)
        rep.add("walls", "no wall thinner than %.2f mm" % pr["min_wall"], FAIL,
                "%d thin regions, largest %.1f mm2" % (len(worst_fail), w[0]),
                ">= %.2f mm (2 lines)" % pr["min_wall"], where=where(w), item=name)
    else:
        rep.add("walls", "no wall thinner than %.2f mm" % pr["min_wall"], PASS,
                "30 sections in x, y, z", item=name)
    if worst_warn and not worst_fail:
        w = max(worst_warn)
        rep.add("walls", "walls at least %.2f mm" % pr["warn_wall"], WARN,
                "%d regions thinner, largest %.1f mm2" % (len(worst_warn), w[0]),
                "prints, but weak", where=where(w), item=name)
    elif not worst_warn:
        rep.add("walls", "walls at least %.2f mm" % pr["warn_wall"], PASS, "", item=name)
    if gaps:
        w = max(gaps)
        rep.add("walls", "no gap narrower than %.2f mm" % pr["min_gap"], WARN,
                "%d narrow gaps, largest %.1f mm2 - will fuse shut" % (len(gaps), w[0]),
                where=where(w), item=name)
    else:
        rep.add("walls", "no gap narrower than %.2f mm" % pr["min_gap"], PASS, "", item=name)
    # -- slender free-standing features
    r, h, w, at = slender(m)
    if r >= pr["slender_fail"]:
        st = FAIL
    elif r >= pr["slender_warn"]:
        st = WARN
    else:
        st = PASS
    rep.add("print", "no slender free-standing features", st,
            ("worst %.0f mm tall, %.1f mm wide: ratio %.1f" % (h, w, r)) if at else "none",
            "ratio < %.0f (fail %.0f)" % (pr["slender_warn"], pr["slender_fail"]),
            where=("x=%.1f y=%.1f z=%.1f (print pose)" % at) if at and st != PASS else "",
            item=name)
    # -- overhangs (exact geometry, print pose)
    try:
        need, detail = cadcheck.needs_support(pose, max_cant=pr["max_ledge"],
                                              max_bridge=pr["max_bridge"])
        if need:
            rep.add("print", "self-supporting (no support material)", WARN, detail,
                    "ledge <= %.0f, bridge <= %.0f" % (pr["max_ledge"], pr["max_bridge"]),
                    item=name)
        else:
            import re
            mm = re.search(r"bridge ([0-9.]+) mm", detail)
            br = float(mm.group(1)) if mm else 0.0
            rep.add("print", "self-supporting (no support material)",
                    WARN if br > pr["warn_bridge"] else PASS, detail,
                    "bridges over %.0f mm string" % pr["warn_bridge"], item=name)
    except Exception as e:
        rep.add("print", "self-supporting (no support material)", NT, "check crashed: %s" % e, item=name)
    return shape


def _ctr(s):
    c = s.BoundBox.Center
    return "(%.1f, %.1f, %.1f)" % (c.x, c.y, c.z)
