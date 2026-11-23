# -*- coding: utf-8 -*-
"""Assembly checks: interference, component fit, connector access, declared
fits (gap per side), extra access paths and motion sweeps."""

import itertools, math
import Part
from FreeCAD import Vector as V

from . import geom, library
from .report import PASS, FAIL, WARN, NT

OVERLAP_TOL = 0.5      # mm3 of overlap that counts as a clash


def interference(rep, parts, bodies, screws, engaged):
    """All pairs: printed parts, component solids, screws.

    `contacts` in the manifest only allow TOUCHING (zero-volume contact, no
    clearance warning). Only `engaged` pairs - press fits, keyed joints - may
    overlap. A first version let contacts overlap and missed a board that
    did not fit its cavity."""
    allowed = set(tuple(sorted(p)) for p in engaged or [])
    items = [(n, s) for n, s in parts.items()]
    items += [(b["label"], b["shape"]) for b in bodies if b["kind"] == "solid"]
    comp_of = {b["label"]: b["owner"] for b in bodies}
    n_pairs, bad = 0, []
    for (a, sa), (b, sb) in itertools.combinations(items, 2):
        if comp_of.get(a) and comp_of.get(a) == comp_of.get(b):
            continue                      # bodies of the same bought part
        key = tuple(sorted((comp_of.get(a, a), comp_of.get(b, b))))
        n_pairs += 1
        v = geom.overlap_volume(sa, sb)
        if v is None:
            rep.add("assembly", "no clash %s / %s" % (a, b), NT, "boolean failed")
            continue
        if v > OVERLAP_TOL and key not in allowed and (a, b) not in allowed:
            bb = sa.common(sb).BoundBox
            bad.append((a, b, v, bb.Center))
    for a, b, v, c in bad:
        rep.add("assembly", "no clash %s / %s" % (a, b), FAIL, "%.1f mm3 overlap" % v,
                where="(%.1f, %.1f, %.1f)" % (c.x, c.y, c.z))
    if not bad:
        rep.add("assembly", "no clashes between any pair", PASS,
                "%d pairs checked (parts + bought parts)" % n_pairs)
    # screws against everything except the parts they thread into
    sbad = []
    for fid, (sh, joins, kind) in screws.items():
        thread = joins[-1] if kind in ("self-tap", "insert", "standoff") else None
        for n, s in items:
            owner = comp_of.get(n, n)
            if owner == thread or n == thread:
                continue
            v = geom.overlap_volume(sh, s)
            if v and v > OVERLAP_TOL:
                sbad.append((fid, n, v))
    for fid, n, v in sbad:
        rep.add("assembly", "screw %s clear of %s" % (fid, n), FAIL, "%.1f mm3 overlap" % v, item=fid)
    if screws and not sbad:
        rep.add("assembly", "screws clear of everything they do not thread into", PASS,
                "%d screws" % len(screws))


def components(rep, parts, bodies, contacts, tol):
    """Bought parts against printed parts, with the uncertainty of their dims.

    A clearance is PASS only when it is still positive after taking away the
    uncertainty of the dimensions the body was built from. Otherwise WARNING
    with the dims to measure. Contacts (the board resting on its standoffs)
    are only checked for overlap.
    """
    allowed = set(tuple(sorted(p)) for p in contacts or [])
    for b in bodies:
        if b["kind"] != "solid":
            continue
        worst = None
        for n, s in parts.items():
            key = tuple(sorted((b["owner"], n)))
            d = geom.min_dist(b["shape"], s)
            if d is None:
                continue
            if worst is None or d < worst[0]:
                worst = (d, n, key in allowed)
        if worst is None:
            continue
        d, n, contact = worst
        if contact:
            continue
        lab = "%s clears printed parts" % b["label"]
        if d < 0.01:
            continue                     # reported by interference
        if d < b["unc"]:
            rep.add("components", lab, WARN,
                    "%.2f mm to %s, less than the ±%.2f uncertainty (%s)" % (d, n, b["unc"], b["src"]),
                    "clearance > uncertainty", item=b["owner"])
            rep.ask_measure(b["owner_ref"], b["dims"][:3], "%s near %s (%.2f mm)" % (b["name"], n, d))
        else:
            rep.add("components", lab, PASS, "%.2f mm to %s" % (d, n),
                    "> ±%.2f (%s)" % (b["unc"], b["src"]), item=b["owner"])


def keepouts(rep, parts, bodies):
    """Connector plugs, solder sides, buttons: space that must stay empty."""
    for b in bodies:
        if b["kind"] != "keepout":
            continue
        lab = ("%s reachable" % b["name"]) if b.get("connector") else ("keep-out '%s' free" % b["name"])
        hits = []
        near = None
        for n, s in parts.items():
            v = geom.overlap_volume(b["shape"], s)
            if v is None:
                continue
            if v > OVERLAP_TOL:
                hits.append("%s %.0f mm3" % (n, v))
            else:
                d = geom.min_dist(b["shape"], s)
                if d is not None and (near is None or d < near[0]):
                    near = (d, n)
        if hits:
            rep.add("access", lab, FAIL, "blocked by " + ", ".join(hits),
                    b.get("reason", ""), item=b["owner"])
        elif near and near[0] < b["unc"]:
            rep.add("access", lab, WARN,
                    "free, but only %.2f mm from %s against ±%.2f uncertainty (%s)" % (near[0], near[1], b["unc"], b["src"]),
                    item=b["owner"])
            rep.ask_measure(b["owner_ref"], b["dims"][:3], "%s %.2f mm from %s" % (b["name"], near[0], near[1]))
        elif b["src"] in library.WEAK:
            rep.add("access", lab, WARN, "free, but its position is %s" % b["src"], item=b["owner"])
            rep.ask_measure(b["owner_ref"], b["dims"][:3], "%s position" % b["name"])
        else:
            rep.add("access", lab, PASS, "free" + (", %.2f mm margin" % near[0] if near else ""),
                    "%s ±%.2f" % (b["src"], b["unc"]), item=b["owner"])


def fits(rep, man, solids, unc_of, tol):
    """Declared fits: the gap per side between a and b, measured in sections
    normal to the insertion axis inside the overlap."""
    for x in man["fits"]:
        a, b = solids.get(x["a"]), solids.get(x["b"])
        lab = "fit %s" % x["name"]
        if a is None or b is None:
            rep.add("fits", lab, FAIL, "unknown part %s / %s" % (x["a"], x["b"]))
            continue
        lim = tol["fits"].get(x["type"])
        if not lim:
            rep.add("fits", lab, FAIL, "fit type %s not in the tolerance profile" % x["type"])
            continue
        u = geom.unit(x["axis"])
        o = V(0, 0, 0)

        def span(s):
            vs = [V(p.X, p.Y, p.Z).dot(u) for p in s.Vertexes]
            return min(vs), max(vs)
        a0, a1 = span(a)
        b0, b1 = span(b)
        lo, hi = max(a0, b0) + 0.3, min(a1, b1) - 0.3
        if "at" in x:
            depths = [float(t) for t in x["at"]]
        elif hi > lo:
            depths = [lo + (hi - lo) * k / 6.0 for k in range(7)]
        else:
            rep.add("fits", lab, FAIL, "parts do not overlap along the axis - not engaged")
            continue
        gaps = []
        for t in depths:
            fa = geom.section_faces(a, u, t)
            fb = geom.section_faces(b, u, t)
            if not fa or not fb:
                continue
            d = Part.Compound(fa).distToShape(Part.Compound(fb))[0]
            gaps.append((d, t))
        if not gaps:
            rep.add("fits", lab, NT, "no section cuts both parts - set `at:` depths")
            continue
        g, t = min(gaps)
        ua, sa, da = unc_of(x["a"], b)
        ub, sb, db = unc_of(x["b"], a)
        unc = max(ua, ub)
        src = sa if ua >= ub else sb
        req = "per side %.2f..%.2f (fail < %.2f), %s" % (lim["warn_below"], lim["warn_above"],
                                                         lim["fail_below"], lim.get("source", ""))
        msg = "gap %.2f mm per side at depth %.1f" % (g, t)
        if g <= 0.005:
            st, msg = FAIL, "parts touch or overlap at depth %.1f - no gap at all" % t
        elif g < lim["fail_below"]:
            st = FAIL
            msg += " - too tight (%s)" % lim.get("note", "")
        elif g < lim["warn_below"] or g > lim["warn_above"]:
            st = WARN
            msg += " - tight" if g < lim["warn_below"] else " - loose"
        else:
            st = PASS
        if st == PASS and unc > 0 and (g - unc < lim["fail_below"] or src in library.WEAK):
            st = WARN
            msg += ", but rests on %s dims ±%.2f" % (src, unc)
            for nm, ds in ((x["a"], da), (x["b"], db)):
                if ds:
                    rep.ask_measure(nm.replace("component:", ""), ds[:3], lab)
        rep.add("fits", lab, st, msg, req, basis="%d sections" % len(gaps))


def access_paths(rep, man, parts):
    for x in man["access"]:
        lab = "access path %s" % x["name"]
        if "cyl" in x:
            c = x["cyl"]
            sh = Part.makeCylinder(c["d"] / 2.0, c["len"], V(*c["base"]), geom.unit(c["dir"]))
        elif "box" in x:
            b = x["box"]
            sh = Part.makeBox(b["size"][0], b["size"][1], b["size"][2], V(*b["min"]))
        else:
            rep.add("access", lab, FAIL, "needs cyl or box")
            continue
        hits = []
        for n, s in parts.items():
            v = geom.overlap_volume(sh, s)
            if v and v > OVERLAP_TOL:
                hits.append("%s %.0f mm3" % (n, v))
        rep.add("access", lab, FAIL if hits else PASS,
                ("blocked by " + ", ".join(hits)) if hits else "free",
                x.get("why", ""))


def motions(rep, man, solids):
    import cadcheck
    for x in man["motions"]:
        lab = "motion %s" % x.get("name", x["part"])
        mv = solids.get(x["part"])
        if mv is None:
            rep.add("motion", lab, FAIL, "unknown part %s" % x["part"])
            continue
        others = [s for n, s in solids.items() if n != x["part"] and n not in x.get("ignore", [])]
        fixed = Part.makeCompound(others)
        u = geom.unit(x["axis"])
        org = geom.vec(x.get("origin", [0, 0, 0]))

        def place(t, mv=mv, u=u, org=org, kind=x["type"]):
            s = mv.copy()
            if kind == "linear":
                s.translate(u * t)
            else:
                s.rotate(org, u, t)
            return s
        lo, hi = x["range"]
        step = x.get("step", 1.0 if x["type"] == "linear" else 5.0)
        run, a, b = cadcheck.contiguous_travel(mv, fixed, place, lo, hi, step=step, tol=OVERLAP_TOL)
        full = run >= (hi - lo) - 1e-6
        rep.add("motion", lab, PASS if full else FAIL,
                "clear %.1f..%.1f of %.1f..%.1f%s" % (a, b, lo, hi, x["type"] == "rotary" and " deg" or " mm"),
                "full range clear, sampled every %g" % step,
                basis="swept; contacts between samples not seen")
