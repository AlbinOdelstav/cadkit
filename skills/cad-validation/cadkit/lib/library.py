# -*- coding: utf-8 -*-
"""Component, fastener and tolerance library.

Components are YAML files in library/components/. Every dimension carries
its source and uncertainty, and the shapes built from them carry the worst
uncertainty of the dimensions they use. Checks use that uncertainty to decide
whether a clearance is proven (PASS) or only plausible (WARNING + "measure X").
"""

import os, re, glob
import yaml

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIB = os.path.join(HERE, "library")

# Default uncertainty (mm) when a dimension does not state one.
DEFAULT_UNC = {"MEASURED": 0.1, "CALIBRATION": 0.1, "STEP": 0.1,
               "DRAWING": 0.2, "DATASHEET": 0.3, "DISTRIBUTOR": 0.4,
               "COMMUNITY": 0.6, "SCALED": 1.0, "ASSUMED": 1.5}
# Sources that may never turn a critical fit into PASS on their own.
WEAK = ("SCALED", "ASSUMED")
TRUST = ["MEASURED", "CALIBRATION", "STEP", "DRAWING", "DATASHEET",
         "DISTRIBUTOR", "COMMUNITY", "SCALED", "ASSUMED"]

_EXPR = re.compile(r"^[\sA-Za-z0-9_.+\-*/()]*$")


def load_yaml(path):
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f)


def tolerances(material):
    """(table for material, materials in the profile, problem or None).

    The profile is YOUR printer's calibrated table (config key `tolerances`).
    No profile, or one not marked `calibrated: true`, is a problem: the
    validator FAILs rather than guess fits from someone else's printer."""
    from . import config
    p = config.get("tolerances")
    if not p:
        return None, [], ("no tolerance profile configured (config key `tolerances`): copy "
                          "profiles/example-p1s-pla.yaml, print the calibration coupon, enter "
                          "your results and set calibrated: true")
    if not os.path.exists(p):
        return None, [], "tolerance profile not found: %s" % os.path.basename(p)
    t = load_yaml(p) or {}
    mats = t.get("materials", {})
    if t.get("calibrated") is not True:
        return None, sorted(mats), ("tolerance profile %s is not calibrated (set calibrated: true "
                                    "only after the coupon results are entered)" % os.path.basename(p))
    return mats.get(material), sorted(mats), None


def fasteners():
    return load_yaml(os.path.join(LIB, "fasteners.yaml"))


def component_ids():
    return sorted(os.path.splitext(os.path.basename(p))[0]
                  for p in glob.glob(os.path.join(LIB, "components", "*.yaml")))


class Dim(object):
    def __init__(self, name, spec):
        if isinstance(spec, (int, float)):
            spec = {"v": spec, "src": "ASSUMED"}
        self.name = name
        self.v = float(spec["v"])
        self.src = str(spec.get("src", "ASSUMED")).upper()
        self.unc = float(spec.get("unc", DEFAULT_UNC.get(self.src, 1.5)))
        self.ref = spec.get("ref", "")
        self.note = spec.get("note", "")

    def label(self):
        return "%s=%.2f %s ±%.2f" % (self.name, self.v, self.src, self.unc)


class Component(object):
    """A bought part: dimensions with provenance, and shapes built from them."""

    def __init__(self, cid, overrides=None):
        """overrides: {dim: {v, src, unc}} from the project manifest
        (`measured:`), e.g. calipers on the user's own board."""
        path = os.path.join(LIB, "components", cid + ".yaml")
        if not os.path.exists(path):
            raise KeyError("component '%s' not in library (have: %s)"
                           % (cid, ", ".join(component_ids())))
        self.path = path
        self.data = load_yaml(path)
        self.id = cid
        self.name = self.data.get("name", cid)
        self.dims = {k: Dim(k, v) for k, v in (self.data.get("dims") or {}).items()}
        for k, v in (overrides or {}).items():
            if k not in self.dims:
                raise KeyError("measured dim '%s' is not a dimension of %s" % (k, cid))
            if isinstance(v, (int, float)):
                v = {"v": v, "src": "MEASURED"}
            self.dims[k] = Dim(k, dict({"src": "MEASURED"}, **v))
        self.confirm = self.data.get("confirm", [])

    # -- expressions over dims ------------------------------------------
    def ev(self, x):
        """Evaluate a number or an arithmetic expression over dim names."""
        if isinstance(x, (int, float)):
            return float(x), []
        if not _EXPR.match(str(x)):
            raise ValueError("bad expression %r in %s" % (x, self.id))
        names = [n for n in re.findall(r"[A-Za-z_][A-Za-z0-9_]*", str(x))]
        for n in names:
            if n not in self.dims:
                raise KeyError("dimension '%s' not defined in %s" % (n, self.id))
        val = eval(str(x), {"__builtins__": {}}, {k: d.v for k, d in self.dims.items()})
        return float(val), names

    def evv(self, xs):
        out, used = [], []
        for x in xs:
            v, n = self.ev(x)
            out.append(v)
            used += n
        return out, used

    def worst(self, names):
        """(uncertainty, weakest source, dims) over the dims used."""
        ds = [self.dims[n] for n in set(names)]
        if not ds:
            return 0.0, "DRAWING", []
        unc = max(d.unc for d in ds)
        src = max((d.src for d in ds), key=lambda s: TRUST.index(s) if s in TRUST else 99)
        return unc, src, sorted(ds, key=lambda d: -d.unc)

    # -- shapes -------------------------------------------------------------
    def shapes(self, placement, active_connectors):
        """Return list of dicts: name, kind (solid|keepout), shape, unc, src, dims.

        Shapes are already moved by `placement`. Keepouts come from the
        component's keepouts and from every connector in active_connectors.
        """
        import Part
        from FreeCAD import Vector as V
        out = []

        def make(spec):
            used = []
            if "box" in spec:
                b = spec["box"]
                mn, u1 = self.evv(b["min"])
                sz, u2 = self.evv(b["size"])
                used = u1 + u2
                sh = Part.makeBox(sz[0], sz[1], sz[2], V(*mn))
            elif "cyl" in spec:
                c = spec["cyl"]
                base, u1 = self.evv(c["base"])
                d, u2 = self.ev(c["d"])
                h, u3 = self.ev(c["h"])
                used = u1 + u2 + u3
                sh = Part.makeCylinder(d / 2.0, h, V(*base), V(*c.get("dir", [0, 0, 1])))
            else:
                raise ValueError("body needs box or cyl: %r" % spec)
            hl = []
            for hole in spec.get("holes", []):
                at, u4 = self.evv(hole["at"])
                d, u5 = self.ev(hole["d"])
                used += u4 + u5
                z0 = sh.BoundBox.ZMin - 1
                sh = sh.cut(Part.makeCylinder(d / 2.0, sh.BoundBox.ZLength + 2,
                                              V(at[0], at[1], z0)))
                hl.append((V(at[0], at[1], 0), u4 + u5))
            make.holes = hl
            return sh, used

        bodies = [(b, "solid") for b in self.data.get("bodies", [])]
        bodies += [(k, "keepout") for k in self.data.get("keepouts", [])]
        for c in self.data.get("connectors", []):
            if c["name"] in active_connectors:
                bodies.append((dict(c["plug"], name="%s plug" % c["name"],
                                    connector=c["name"]), "keepout"))
        for spec, kind in bodies:
            sh, used = make(spec)
            holes = []
            for p, names in getattr(make, "holes", []):
                q = placement.multVec(p) if placement else p
                hu, hs, hd = self.worst(names)
                holes.append(dict(at=q, axis=placement.Rotation.multVec(V(0, 0, 1)) if placement else V(0, 0, 1),
                                  unc=hu, src=hs, dims=hd))
            make.holes = []
            if placement:
                sh = sh.copy()
                sh.transformShape(placement.toMatrix())
            if spec.get("unc_from"):
                used = [n for n in spec["unc_from"] if n in self.dims]
            unc, src, ds = self.worst(used)
            out.append(dict(name=spec.get("name", "body"), kind=kind, shape=sh,
                            unc=unc, src=src, dims=ds, holes=holes,
                            connector=spec.get("connector"),
                            reason=spec.get("reason", "")))
        return out

    def connector_names(self):
        return [c["name"] for c in self.data.get("connectors", [])]


def stock_screws():
    """Screws listed in the maker inventory, as {(thread, length): qty}."""
    from . import config
    p = config.get("inventory_hardware")
    out = {}
    if not p or not os.path.exists(p):
        return None
    for row in load_yaml(p) or []:
        sp = row.get("specs") or {}
        if row.get("category") == "screw" and sp.get("thread") and sp.get("length"):
            k = (str(sp["thread"]).upper(), float(sp["length"]))
            out[k] = out.get(k, 0) + int(row.get("qty", 0))
    return out
