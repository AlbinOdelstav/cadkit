# -*- coding: utf-8 -*-
"""Fastener checks: every declared screw, along its own axis, through the
finished assembly.

For each screw the axis is probed every 0.25 mm. At each depth we measure the
free radius in each solid: distance from the axis to the nearest material in
the plane normal to the axis. From those profiles:

  head room     nothing inside head diameter behind the seat
  head bears    the first joined part has material under the head
  clearance     head-side parts: hole within the clearance range
  thread        last part (self-tap/insert): hole within pilot range, long enough
  bottoming     no material on the axis before the screw tip
  joins         every listed part is actually engaged along the screw
  nut           a nut fits and the screw reaches through it
  driver        a screwdriver cylinder reaches open air
  stock         the screw is in the maker inventory
"""

import math
import Part
from FreeCAD import Vector as V

from . import geom, library
from .report import PASS, FAIL, WARN, NT

STEP = 0.25


def screw_solid(o, u, d, L, dk, k):
    shank = Part.makeCylinder(d / 2.0, L, o, u)
    head = Part.makeCylinder(dk / 2.0, k, o - u * k, u)
    return shank.fuse(head)


def check_fasteners(rep, man, solids, tol, unc_near):
    """solids: {name: shape} for printed parts and 'component:<id>' bodies.
    unc_near(name, shape) -> (unc, src, dims) of the component bodies near shape."""
    fl = library.fasteners()["threads"]
    holes = tol["holes"]
    stock = library.stock_screws()
    screws = {}
    for f in man["fasteners"]:
        fid = f["id"]
        sc = f["screw"]
        th = str(sc["thread"]).upper()
        if th not in fl:
            rep.add("fasteners", "thread in library", FAIL, "%s not in fasteners.yaml" % th, item=fid)
            continue
        T = fl[th]
        d = T["d"]
        L = float(sc["length"])
        hd = T["heads"].get(sc.get("head", "cheese"))
        if not hd:
            rep.add("fasteners", "head type in library", FAIL, "head %s unknown" % sc.get("head"), item=fid)
            continue
        dk, kh, drv = hd["dk"], hd["k"], hd["driver_d"]
        o, u = geom.vec(f["origin"]), geom.unit(f["dir"])
        joins = f["joins"]
        kind = f["kind"]
        screws[fid] = (screw_solid(o, u, d, L, dk, kh), joins, kind)
        clr = holes["clearance"].get(th)
        pil = holes["self_tap_pilot"].get(th)
        horiz = abs(u.z) < 0.7      # in the assembly frame; print pose may differ
        extra = holes.get("horizontal_hole_extra", 0.2) if horiz else 0.0

        # profiles in every solid near the axis
        t0, t1 = -(kh + 1.0), L + 3.0
        prof = {}
        line = Part.LineSegment(o + u * t0, o + u * t1).toShape()
        for name, sh in solids.items():
            dmin = geom.min_dist(sh, line)
            if dmin is None or dmin > dk:
                continue
            prof[name] = geom.profile(sh, o, u, t0, t1, STEP)

        def fr(name, a, b):
            return [fv for t, fv in prof.get(name, []) if a <= t <= b]

        engage_r = d / 2.0 + 2.0
        eng = {n: geom.runs(p, lambda fv: fv < engage_r) for n, p in prof.items()}
        head_side = joins[:-1] if kind in ("self-tap", "insert", "standoff") else joins
        thread_part = joins[-1] if kind in ("self-tap", "insert", "standoff") else None

        def unc_of(n):
            return unc_near(n, line)

        # -- joins: each listed part engaged along the screw
        for n in joins:
            r = [x for x in eng.get(n, []) if x[1] > -0.5 and x[0] < L]
            if not r:
                rep.add("fasteners", "screw reaches %s" % n, FAIL,
                        "no material of %s within %.1f mm of the screw axis along its %.0f mm" % (n, engage_r, L),
                        "screw must pass through/into every part it joins",
                        where="axis from (%.1f, %.1f, %.1f)" % tuple(f["origin"]), item=fid)
            else:
                rep.add("fasteners", "screw reaches %s" % n, PASS,
                        "engaged %.1f..%.1f mm" % (r[0][0], r[-1][1]), item=fid)

        # -- head room behind the seat
        bad = []
        for n in prof:
            fv = fr(n, -kh, -STEP)
            if fv and min(fv) < dk / 2.0 + 0.2:
                bad.append("%s (free r %.2f)" % (n, min(fv)))
        rep.add("fasteners", "room for the screw head", FAIL if bad else PASS,
                ", ".join(bad) if bad else "free", "r >= %.2f" % (dk / 2 + 0.2), item=fid)

        # -- head bears on the first part
        first = joins[0]
        fv = fr(first, 0.0, 0.5)
        if not fv:
            rep.add("fasteners", "head bears on %s" % first, FAIL,
                    "no material under the head", item=fid)
        else:
            bear = min(fv) < dk / 2.0 - 0.3
            rep.add("fasteners", "head bears on %s" % first, PASS if bear else FAIL,
                    "free r under head %.2f vs head r %.2f" % (min(fv), dk / 2.0),
                    "hole smaller than the head", item=fid)

        # -- clearance through head-side parts
        for n in head_side:
            spans = [x for x in eng.get(n, []) if x[0] < L]
            vals = []
            for a, b in spans:
                vals += fr(n, max(a, 0.0), min(b, L) - STEP)
            vals = [v for v in vals if v < engage_r]
            if not vals:
                continue
            got = 2 * min(vals)
            if n.startswith("component:"):
                # a hole in a bought part (PCB, bracket): the screw must pass,
                # and the radial play must cover the uncertainty of where the
                # hole really is relative to the printed boss
                unc, src, ds = unc_near(n, line, axis=(o, u))
                play = (got - d) / 2.0
                if got < d:
                    st, msg = FAIL, "hole %.2f mm is smaller than the %.1f mm screw" % (got, d)
                elif play + 1e-6 >= unc and src not in library.WEAK:
                    st, msg = PASS, "hole %.2f mm, %.2f mm play per side >= ±%.2f position uncertainty (%s)" % (got, play, unc, src)
                else:
                    st = WARN
                    msg = ("hole %.2f mm gives %.2f mm play per side, less than the ±%.2f uncertainty of "
                           "where the hole is (%s) - it may not line up with the boss" % (got, play, unc, src))
                    rep.ask_measure(n.replace("component:", ""), [x for x in ds if x.unc >= unc - 1e-9][:3] or ds[:2],
                                    "screw %s lines up with its hole" % fid)
                rep.add("fasteners", "screw passes the hole in %s" % n, st, msg,
                        "screw %.1f + play >= uncertainty" % d, item=fid)
                continue
            lo, hi = clr[0] + extra, clr[1] + extra
            if got < d:
                st, msg = FAIL, "hole %.2f mm is smaller than the %.1f mm screw - it binds" % (got, d)
            elif got < lo:
                st, msg = FAIL, "hole %.2f mm, below clearance %.2f..%.2f" % (got, lo, hi)
            elif got > hi + 0.3:
                st, msg = WARN, "hole %.2f mm, oversize (clearance %.2f..%.2f)" % (got, lo, hi)
            else:
                st, msg = PASS, "hole %.2f mm" % got
            rep.add("fasteners", "clearance hole in %s" % n, st, msg,
                    "%.2f..%.2f (%s%s)" % (lo, hi, holes["clearance"].get("source", ""),
                                           ", horizontal +%.1f" % extra if extra else ""),
                    item=fid)

        # -- thread part
        if thread_part:
            n = thread_part
            spans = [x for x in eng.get(n, []) if x[1] > 0 and x[0] < L]
            vals = []
            for a, b in spans:
                vals += [(t, fv) for t, fv in prof[n] if max(a, 0) <= t <= min(b, L)]
            if kind == "self-tap" and vals:
                sol = [t for t, fv in vals if fv < 0.05]
                ins = [(t, fv) for t, fv in vals if fv >= 0.05]
                if sol and (not ins or min(sol) < min(t for t, _ in ins)):
                    rep.add("fasteners", "pilot hole in %s" % n, FAIL,
                            "no pilot hole: solid material at depth %.1f" % min(sol), item=fid)
                else:
                    got = 2 * min(fv for _, fv in ins)
                    lo, hi = pil[0] + extra, pil[1] + extra
                    st = PASS if lo - 0.02 <= got <= hi + 0.02 else FAIL
                    msg = "pilot %.2f mm" % got
                    if got > hi + 0.02 and got >= clr[0]:
                        msg += " - that is a clearance hole, the thread will not bite"
                    elif got < lo - 0.02:
                        msg += " - too tight, the part may split or the screw strip"
                    wlo = (holes.get("self_tap_pilot_warn_below") or {}).get(th)
                    if st == PASS and wlo and got < wlo + extra - 0.02:
                        st = WARN
                        msg += " - works but is hard to start (prefer >= %.2f)" % (wlo + extra)
                    rep.add("fasteners", "pilot hole in %s" % n, st, msg,
                            "%.2f..%.2f" % (lo, hi), item=fid)
                    bite = [t for t, fv in ins if fv <= hi / 2.0 + 0.02]
                    engl = (max(bite) - min(bite) + STEP) if bite else 0.0
                    need = holes["self_tap_min_engagement_x_d"] * d
                    rep.add("fasteners", "thread engagement in %s" % n,
                            PASS if engl >= need else FAIL,
                            "%.1f mm" % engl, ">= %.1f mm (%.0f x d)" % (need, need / d), item=fid)
            elif kind == "insert" and vals:
                ins = T["insert"]
                got = 2 * min(fv for _, fv in vals if fv >= 0.05) if any(fv >= 0.05 for _, fv in vals) else 0
                lo, hi = ins["hole_d"]
                rep.add("fasteners", "insert hole in %s" % n, PASS if lo - 0.05 <= got <= hi + 0.05 else FAIL,
                        "hole %.2f mm" % got, "%.2f..%.2f (%s)" % (lo, hi, ins.get("source", "")), item=fid)
                zone = [t for t, fv in vals if lo / 2 - 0.05 <= fv <= hi / 2 + 0.05]
                depth = (max(zone) - min(zone) + STEP) if zone else 0
                rep.add("fasteners", "insert pocket depth in %s" % n, PASS if depth >= ins["len"] - 0.2 else FAIL,
                        "%.1f mm" % depth, ">= %.1f mm" % ins["len"], item=fid)
                if zone:
                    reach = L - min(zone)
                    need = holes["insert_min_engagement_x_len"] * ins["len"]
                    rep.add("fasteners", "screw reaches into the insert", PASS if reach >= need else FAIL,
                            "%.1f mm into it" % reach, ">= %.1f mm" % need, item=fid)
            elif kind == "standoff":
                rep.add("fasteners", "thread in %s" % n, NT,
                        "bought threaded part: thread depth not modelled", item=fid)

        # -- bottoming / hitting something on the axis
        hit = None
        for n, p in prof.items():
            for t, fv in p:
                if 0.0 < t < L - STEP and fv < 0.05:
                    if hit is None or t < hit[0]:
                        hit = (t, n)
                    break
        if hit:
            what = "bottoms out" if hit[1] == thread_part else "hits %s" % hit[1]
            rep.add("fasteners", "screw is free to its tip", FAIL,
                    "%s at depth %.1f mm of %.0f" % (what, hit[0], L),
                    "max length here %.0f mm" % math.floor(hit[0]), item=fid)
        else:
            rep.add("fasteners", "screw is free to its tip", PASS, "%.0f mm clear" % L, item=fid)

        # -- nut
        if kind == "nut":
            nut = T["nut"]
            need_r = nut["af"] / 2.0 + 0.1
            ok_seat = None
            names = list(prof)
            ts = [t for t, _ in prof[names[0]]] if names else []
            for i, t in enumerate(ts):
                if t < 0 or t + nut["m"] > L - 0.5:
                    continue
                window = [t2 for t2 in ts if t <= t2 <= t + nut["m"]]
                free = all(min(fv for t2, fv in prof[n] if t2 in window) >= need_r for n in names)
                if free:
                    ok_seat = t
            if ok_seat is None:
                rep.add("fasteners", "nut fits and is fully engaged", FAIL,
                        "no %.1f mm deep space of r >= %.2f before the tip" % (nut["m"], need_r),
                        "nut AF %.1f, m %.1f" % (nut["af"], nut["m"]), item=fid)
            else:
                rep.add("fasteners", "nut fits and is fully engaged", PASS,
                        "seat at %.1f mm, %.1f mm of thread past the nut" % (ok_seat, L - ok_seat - nut["m"]),
                        item=fid)
                rep.add("fasteners", "nut can be inserted", NT,
                        "insertion path of the nut not checked - look at the pocket", item=fid)

        # -- screwdriver access from the head side
        skip = set(f.get("installed_before", []))
        bbs = [sh.BoundBox for sh in solids.values()]
        reach = 60.0
        for bb in bbs:
            for x in (bb.XMin, bb.XMax):
                for y in (bb.YMin, bb.YMax):
                    for z in (bb.ZMin, bb.ZMax):
                        reach = max(reach, (V(x, y, z) - o).Length + 5)
        cyl = Part.makeCylinder(drv / 2.0, reach, o - u * kh, -u)
        blocked = []
        for n, sh in solids.items():
            if n in skip:
                continue
            v = geom.overlap_volume(sh, cyl)
            if v and v > 1.0:
                blocked.append("%s (%.0f mm3)" % (n, v))
        rep.add("fasteners", "screwdriver reaches the head", FAIL if blocked else PASS,
                ("blocked by " + ", ".join(blocked)) if blocked else "straight path to open air",
                "d %.0f mm driver along the axis" % drv, item=fid)

        # -- stock
        if stock is None:
            rep.add("bom", "screw in your inventory", NT, "inventory not found", item=fid)
        else:
            q = stock.get((th, L), 0)
            rep.add("bom", "screw in your inventory", PASS if q else WARN,
                    "%s x %.0f: %d at home" % (th, L, q) if q else "%s x %.0f not in hardware.yaml - buy or change length" % (th, L),
                    item=fid)
    return screws


def undeclared_holes(rep, man, parts):
    """Fastener-sized holes in printed parts that no declared fastener uses."""
    axes = [(geom.vec(f["origin"]), geom.unit(f["dir"])) for f in man["fasteners"]]
    ignore = man.get("holes_not_fasteners") or []
    for name, sh in parts.items():
        n = 0
        for pa, d, r in geom.cylinders(sh, 0.75, 3.2):
            if any(abs(abs(d.dot(u)) - 1) < 0.01 and geom.line_dist(o, u, pa) < 0.4 for o, u in axes):
                continue
            if any(i.get("part") == name and (geom.vec(i["at"]) - pa).Length < 2.0 or
                   (i.get("part") == name and geom.line_dist(pa, d, geom.vec(i["at"])) < 0.5)
                   for i in ignore):
                continue
            n += 1
            rep.add("fasteners", "hole is declared", WARN,
                    "d %.2f hole with no fastener in the manifest" % (2 * r),
                    "declare it under fasteners or holes_not_fasteners",
                    where="(%.1f, %.1f, %.1f) axis (%.0f, %.0f, %.0f)" % (pa.x, pa.y, pa.z, d.x, d.y, d.z),
                    item=name)
        if not n:
            rep.add("fasteners", "all fastener-sized holes declared", PASS, "", item=name)
