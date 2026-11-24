# -*- coding: utf-8 -*-
"""Validate one design version against its manifest (cadkit.yaml).

Run through the launcher, which sets CADKIT_MANIFEST and reads the report:

    node <plugin>/skills/cad-validation/cadkit/cadkit.mjs validate <version folder>

or directly:

    set CADKIT_MANIFEST=<folder or cadkit.yaml>
    freecadcmd validate.py

Writes <folder>/validation/report.md and report.json. Exit code: 0 ready,
1 NOT READY (a FAIL), 2 COUPON FIRST, 3 the validator itself could not run.
There are no switches to skip checks, on purpose.
"""

import os, sys, time, json, traceback

_RAN = globals().get("_CADKIT_RAN", False)
_CADKIT_RAN = True

TOOL_VERSION = "1.0.0"
HERE = os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else \
    os.environ.get("CADKIT_HOME", os.getcwd())
sys.path.insert(0, HERE)


def run(mpath):
    from lib import manifest, library, report
    from lib.report import PASS, FAIL, WARN, NT

    man = manifest.load(mpath)
    rep = report.Report(man)
    out = os.path.join(man["_base"], "validation")
    os.makedirs(out, exist_ok=True)

    tol, have, problem = library.tolerances(man["material"])
    if problem:
        rep.add("manifest", "material has a tolerance table", FAIL, problem,
                "a calibrated profile for this printer (README: first-time setup)")
        return rep, out, man
    if not tol:
        rep.add("manifest", "material has a tolerance table", FAIL,
                "%s not in the tolerance profile (have %s)" % (man["material"], ", ".join(have)),
                "calibrate the material first (README: new material)")
        return rep, out, man
    rep.add("manifest", "manifest complete", PASS, "all sections declared")
    rep.add("manifest", "material has a tolerance table", PASS, man["material"])

    from lib import checks_part, checks_fast, checks_asm

    # -- parts
    parts = {}
    for p in man["parts"]:
        try:
            s = checks_part.check_part(rep, man, p, tol)
            if s is not None:
                parts[p["name"]] = s
        except Exception as e:
            rep.add("part", "part checks ran", NT, "crashed: %r" % e, item=p["name"])
            rep.notes.append(traceback.format_exc().splitlines()[-1])

    # -- bought parts
    bodies, comp_solid, comp_unc = [], {}, {}
    for c in man["components"]:
        try:
            comp = library.Component(c["ref"], c.get("measured"))
        except Exception as e:
            rep.add("components", "component in library", FAIL, str(e), item=c["id"])
            continue
        unknown = [k for k in c["connectors_used"] if k not in comp.connector_names()]
        if unknown:
            rep.add("components", "connectors exist", FAIL,
                    "%s not defined (have %s)" % (unknown, comp.connector_names()), item=c["id"])
        pl = manifest.placement(c["placement"])
        bs = comp.shapes(pl, c["connectors_used"])
        lab = "component:%s" % c["id"]
        sol = [b for b in bs if b["kind"] == "solid"]
        for b in bs:
            b["owner"], b["owner_ref"] = lab, "%s (%s)" % (c["id"], comp.name)
            b["label"] = "%s/%s" % (c["id"], b["name"])
        bodies += bs
        if sol:
            comp_solid[lab] = sol[0]["shape"].fuse([b["shape"] for b in sol[1:]]) if len(sol) > 1 else sol[0]["shape"]
            w = max(sol, key=lambda b: b["unc"])
            comp_unc[lab] = (w["unc"], w["src"], w["dims"])
        # Informational: which dims are only estimates. Each critical check
        # applies the provenance rule to the dims IT uses, so this row does
        # not block (category 'library' is not critical).
        weak = sorted(d.name for d in comp.dims.values() if d.src in library.WEAK)
        rep.add("library", "dimension sources", WARN if weak else PASS,
                ("%d of %d dims are estimates: %s" % (len(weak), len(comp.dims), ", ".join(weak)))
                if weak else "%d dims, all sourced" % len(comp.dims),
                "estimates are fine for placement; checks that rely on them do not PASS",
                item=c["id"])
        if not c["connectors_used"]:
            rep.add("declared", "connectors that must be reachable", NT,
                    "manifest says none for %s" % c["id"], item=c["id"])

    solids = dict(parts)
    solids.update(comp_solid)

    def hole_at(n, axis):
        """The library hole of component n that the line axis=(origin, dir)
        passes through (within 3 mm of its centre), or None."""
        from lib import geom as G
        best = None
        for b in bodies:
            if b["owner"] != n or b["kind"] != "solid":
                continue
            for h in b.get("holes", []):
                dd = G.line_dist(axis[0], axis[1], h["at"])
                if best is None or dd < best[0]:
                    best = (dd, h)
        return best[1] if best and best[0] < 3.0 else None

    def unc_near(n, near=None, within=3.0, axis=None):
        """Uncertainty of the bodies of component n that lie near `near`.
        With axis=(origin, dir): the uncertainty of the component hole that
        axis passes through (its own position and diameter dims only)."""
        if not n.startswith("component:"):
            return (0.0, "MODEL", [])
        bs = [b for b in bodies if b["owner"] == n and b["kind"] == "solid"]
        if axis is not None:
            h = hole_at(n, axis)
            if h is not None:
                return (h["unc"], h["src"], h["dims"])
        if near is not None:
            close = []
            for b in bs:
                d = b["shape"].distToShape(near)[0]
                if d <= within:
                    close.append(b)
            bs = close or bs
        if not bs:
            return comp_unc.get(n, (0.0, "MODEL", []))
        w = max(bs, key=lambda b: b["unc"])
        dims = []
        for b in bs:
            dims += [d for d in b["dims"] if d not in dims]
        dims.sort(key=lambda d: -d.unc)
        return (w["unc"], w["src"], dims)

    def unc_of(n, near=None, axis=None):
        return unc_near(n, near, axis=axis)

    contacts = man.get("contacts") or []
    screws = {}
    try:
        screws = checks_fast.check_fasteners(rep, man, solids, tol, unc_near, hole_at) if man["fasteners"] else {}
        if not man["fasteners"]:
            rep.add("declared", "fasteners", NT, "manifest declares none")
        checks_fast.undeclared_holes(rep, man, parts)
    except Exception as e:
        rep.add("fasteners", "fastener checks ran", NT, "crashed: %r" % e)
        rep.notes.append(traceback.format_exc())
    for cat, fn in (
            ("assembly", lambda: checks_asm.interference(rep, parts, bodies, screws, man.get("engaged") or [])),
            ("components", lambda: checks_asm.components(rep, parts, bodies, contacts, tol)),
            ("access", lambda: checks_asm.keepouts(rep, parts, bodies)),
            ("fits", lambda: checks_asm.fits(rep, man, solids, unc_of, tol)),
            ("access", lambda: checks_asm.access_paths(rep, man, parts)),
            ("motion", lambda: checks_asm.motions(rep, man, solids))):
        try:
            fn()
        except Exception as e:
            rep.add(cat, "%s checks ran" % cat, NT, "crashed: %r" % e)
            rep.notes.append(traceback.format_exc())
    if not man["fits"]:
        rep.add("declared", "fits", NT, "manifest declares none")
    if not man["motions"]:
        rep.add("declared", "moving parts", NT, "manifest declares none")

    # what this tool never verifies
    rep.notes += [
        "Strength under load: not analysed (no FEM). Use print orientation and walls; test the part.",
        "Bought parts are only as right as their library dims; see 'Measure these'.",
        "Slicer result (supports, time, filament) is not part of this report; run `cadkit slice`.",
        "Assembly ORDER is only checked where fasteners declare `installed_before`.",
    ]
    return rep, out, man


def main():
    mpath = os.environ.get("CADKIT_MANIFEST")
    if not mpath:
        sys.stderr.write("set CADKIT_MANIFEST\n")
        return 3
    from lib import manifest
    try:
        rep, out, man = run(mpath)
    except manifest.ManifestError as e:
        base = mpath if os.path.isdir(mpath) else os.path.dirname(mpath)
        out = os.path.join(base, "validation")
        os.makedirs(out, exist_ok=True)
        with open(os.path.join(out, "report.md"), "w", encoding="utf-8") as f:
            f.write("# Validation report\n\n**Verdict: NOT READY**\n\nThe manifest is "
                    "incomplete, so nothing could be checked:\n\n```\n%s\n```\n" % e)
        with open(os.path.join(out, "report.json"), "w", encoding="utf-8") as f:
            json.dump({"verdict": "NOT READY", "error": str(e)}, f)
        return 1
    files = {}
    for p in man["parts"]:
        for k in ("stl", "brep"):
            if os.path.exists(p[k]):
                files[os.path.relpath(p[k], man["_base"])] = manifest.sha(p[k])
    files["cadkit.yaml"] = manifest.sha(man["_path"])
    stamp = dict(time=time.strftime("%Y-%m-%d %H:%M"), tool=TOOL_VERSION, files=files)
    with open(os.path.join(out, "report.md"), "w", encoding="utf-8") as f:
        f.write(rep.markdown(stamp))
    with open(os.path.join(out, "report.json"), "w", encoding="utf-8") as f:
        f.write(rep.json(stamp))
    v = rep.verdict()
    return 1 if v == "NOT READY" else (2 if v == "COUPON FIRST" else 0)


if not _RAN:
    try:
        code = main()
    except Exception:
        traceback.print_exc()
        code = 3
    sys.stdout.flush()
    os._exit(code)
