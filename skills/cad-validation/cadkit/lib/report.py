# -*- coding: utf-8 -*-
"""Validation report: every check is PASS, FAIL, WARNING or NOT TESTED.

PASS only comes from a check that actually ran and measured inside the limit
with margin to spare for the uncertainty of the dimensions it rests on.
"""

import json, time

PASS, FAIL, WARN, NT = "PASS", "FAIL", "WARNING", "NOT TESTED"
CRITICAL = ("manifest", "fasteners", "fits", "components", "access", "motion",
            "assembly", "export")


class Report(object):
    def __init__(self, manifest):
        self.m = manifest
        self.rows = []
        self.measure = {}       # dim label -> reasons (risk-based measuring asks)
        self.notes = []

    def add(self, cat, check, status, measured="", required="", where="",
            basis="", item=""):
        self.rows.append(dict(cat=cat, item=item, check=check, status=status,
                              measured=measured, required=required,
                              where=where, basis=basis))

    def ask_measure(self, comp, dims, why):
        for d in dims:
            key = "%s: %s (now %.2f mm, %s ±%.2f)" % (comp, d.name, d.v, d.src, d.unc)
            self.measure.setdefault(key, []).append(why)

    # ---------------------------------------------------------------
    def counts(self):
        c = {PASS: 0, FAIL: 0, WARN: 0, NT: 0}
        for r in self.rows:
            c[r["status"]] += 1
        return c

    def verdict(self):
        c = self.counts()
        if c[FAIL]:
            return "NOT READY"
        crit = [r for r in self.rows if r["cat"] in CRITICAL and r["status"] in (WARN, NT)]
        if crit or self.measure:
            return "COUPON FIRST"
        if c[WARN]:
            return "READY FOR TEST PRINT (with warnings)"
        return "READY FOR TEST PRINT"

    # ---------------------------------------------------------------
    def markdown(self, stamp):
        m = self.m
        c = self.counts()
        v = self.verdict()
        L = []
        L.append("# Validation report: %s %s" % (m["project"], m["version"]))
        L.append("")
        L.append("**Verdict: %s**  " % v)
        L.append("%d PASS, %d FAIL, %d WARNING, %d NOT TESTED  " % (c[PASS], c[FAIL], c[WARN], c[NT]))
        L.append("Material %s, printer %s. Generated %s by cadkit %s.  "
                 % (m["material"], m.get("printer", "P1S"), stamp["time"], stamp["tool"]))
        L.append("A test print is not a validated production design. PASS means "
                 "the check ran and measured inside its limit; it does not prove strength.")
        L.append("")
        fails = [r for r in self.rows if r["status"] == FAIL]
        if fails:
            L.append("## Must fix (FAIL)")
            for r in fails:
                L.append("- **%s** %s%s: %s. Required %s.%s" % (
                    r["cat"], r["item"] + " - " if r["item"] else "", r["check"],
                    r["measured"], r["required"] or "-",
                    " At %s." % r["where"] if r["where"] else ""))
            L.append("")
        if self.measure:
            L.append("## Measure these (only these)")
            L.append("A critical fit depends on them and the documented value is not "
                     "certain enough to prove it. Calipers on your own part:")
            for k, why in self.measure.items():
                L.append("- %s - %s" % (k, "; ".join(sorted(set(why)))))
            L.append("")
        warns = [r for r in self.rows if r["status"] == WARN]
        if warns:
            L.append("## Warnings")
            for r in warns:
                L.append("- %s %s%s: %s%s" % (
                    r["cat"], r["item"] + " - " if r["item"] else "", r["check"],
                    r["measured"], " (%s)" % r["where"] if r["where"] else ""))
            L.append("")
        nts = [r for r in self.rows if r["status"] == NT]
        L.append("## Not verified")
        for r in nts:
            L.append("- %s %s%s: %s" % (r["cat"], r["item"] + " - " if r["item"] else "",
                                        r["check"], r["measured"] or r["basis"]))
        for n in self.notes:
            L.append("- %s" % n)
        L.append("")
        L.append("## All checks")
        L.append("| Category | Item | Check | Status | Measured | Required | Basis |")
        L.append("|---|---|---|---|---|---|---|")
        for r in self.rows:
            L.append("| %s | %s | %s | %s | %s | %s | %s |" % tuple(
                str(r[k]).replace("|", "/") for k in
                ("cat", "item", "check", "status", "measured", "required", "basis")))
        L.append("")
        L.append("## Files checked")
        for p, h in sorted(stamp["files"].items()):
            L.append("- `%s` sha256 %s" % (p, h[:12]))
        return "\n".join(L) + "\n"

    def json(self, stamp):
        return json.dumps(dict(verdict=self.verdict(), counts=self.counts(),
                               rows=self.rows, measure=self.measure,
                               notes=self.notes, stamp=stamp,
                               project=self.m["project"], version=self.m["version"]),
                          indent=1)
