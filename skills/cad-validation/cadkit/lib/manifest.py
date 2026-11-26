# -*- coding: utf-8 -*-
"""Design manifest: what the design must do, declared so it can be checked.

One file per version folder: cadkit.yaml. It is mandatory. Every section
must be present; a section with nothing in it must say `none` explicitly,
so "I forgot the fasteners" can never look like "there are no fasteners".
"""

import os, hashlib
import yaml

REQUIRED_SECTIONS = ("parts", "components", "fasteners", "fits", "access", "motions")
THIN_OK_MAX_AREA = 5.0      # a declared thin spot is a small local exception, never a thin wall
THIN_OK_RADIUS = 3.0        # mm from the declared point
KINDS = ("self-tap", "insert", "nut", "through", "standoff")


class ManifestError(Exception):
    pass


def find(path):
    if os.path.isdir(path):
        p = os.path.join(path, "cadkit.yaml")
        if not os.path.exists(p):
            raise ManifestError("no cadkit.yaml in %s - the manifest is mandatory "
                                "(copy templates/cadkit.yaml)" % path)
        return p
    return path


def sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def load(path):
    path = find(path)
    with open(path, encoding="utf-8") as f:
        m = yaml.safe_load(f) or {}
    base = os.path.dirname(os.path.abspath(path))
    errs = []
    for k in ("project", "version", "material"):
        if not m.get(k):
            errs.append("missing '%s'" % k)
    for s in REQUIRED_SECTIONS:
        if s not in m:
            errs.append("missing section '%s' (write `%s: none` if there is nothing)" % (s, s))
        elif m[s] == "none":
            m[s] = []
        elif m[s] is None:
            errs.append("section '%s' is empty - list items or write `none`" % s)
        elif not isinstance(m[s], list):
            errs.append("section '%s' must be a list or `none`" % s)
    if not errs and not m["parts"]:
        errs.append("no parts")
    names = set()
    for p in m.get("parts") or []:
        for k in ("name", "brep", "stl"):
            if k not in p:
                errs.append("part %s: missing '%s'" % (p.get("name", "?"), k))
        names.add(p.get("name"))
        for k in ("brep", "stl"):
            if k in p:
                p[k] = os.path.normpath(os.path.join(base, p[k]))
    for c in m.get("components") or []:
        for k in ("id", "ref", "placement", "connectors_used"):
            if k not in c:
                errs.append("component %s: missing '%s'%s" % (
                    c.get("id", "?"), k,
                    " (list the connectors that must stay reachable, or `none`)"
                    if k == "connectors_used" else ""))
        if c.get("connectors_used") == "none":
            c["connectors_used"] = []
        names.add("component:%s" % c.get("id"))
    for f in m.get("fasteners") or []:
        for k in ("id", "screw", "kind", "origin", "dir", "joins"):
            if k not in f:
                errs.append("fastener %s: missing '%s'" % (f.get("id", "?"), k))
        if f.get("kind") not in KINDS:
            errs.append("fastener %s: kind must be one of %s" % (f.get("id"), ", ".join(KINDS)))
        for j in f.get("joins", []):
            if j not in names:
                errs.append("fastener %s joins unknown '%s'" % (f.get("id"), j))
        for key in ("installed_before", "nut_before"):
            for j in f.get(key) or []:
                if j not in names:
                    errs.append("fastener %s: %s lists unknown '%s'" % (f.get("id"), key, j))
        if f.get("nut_insert") not in (None, "print_pause"):
            errs.append("fastener %s: nut_insert can only be print_pause" % f.get("id"))
    for x in m.get("fits") or []:
        for k in ("name", "a", "b", "axis", "type"):
            if k not in x:
                errs.append("fit %s: missing '%s'" % (x.get("name", "?"), k))
    tok = m.get("thin_ok") or []
    if tok == "none":
        tok = []
    if not isinstance(tok, list):
        errs.append("thin_ok must be a list or `none`")
        tok = []
    for t in tok:
        lbl = "thin_ok %s" % t.get("at")
        if t.get("part") not in names:
            errs.append("%s: unknown part '%s'" % (lbl, t.get("part")))
        at = t.get("at")
        if not (isinstance(at, list) and len(at) == 3 and all(isinstance(c, (int, float)) for c in at)):
            errs.append("%s: 'at' must be [x, y, z] in the PRINT POSE (as the report prints it)" % lbl)
        if not str(t.get("reason") or "").strip():
            errs.append("%s: missing 'reason' (why this thin spot is acceptable)" % lbl)
        ma = t.get("max_area")
        if not isinstance(ma, (int, float)) or not 0 < ma <= THIN_OK_MAX_AREA:
            errs.append("%s: 'max_area' must be a number in (0, %.0f] mm2" % (lbl, THIN_OK_MAX_AREA))
    m["thin_ok"] = tok
    m["sources"] = [os.path.normpath(os.path.join(base, s)) for s in m.get("sources", [])]
    if not m["sources"]:
        errs.append("missing 'sources' (the build scripts/params the STLs come from)")
    if errs:
        raise ManifestError("manifest %s:\n  - " % path + "\n  - ".join(errs))
    m["_path"], m["_base"] = path, base
    return m


def placement(spec):
    import FreeCAD as App
    pos = spec.get("pos", [0, 0, 0])
    pl = App.Placement(App.Vector(*pos), App.Rotation())
    for axis, deg in spec.get("rot", []) or []:
        pl = App.Placement(App.Vector(*pos), App.Rotation(App.Vector(*axis), deg)
                           .multiply(pl.Rotation))
    return pl
