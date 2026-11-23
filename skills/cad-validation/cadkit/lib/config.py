# -*- coding: utf-8 -*-
"""Machine-specific settings, same rules as config.mjs: environment variables
first, then a config file ($CADKIT_CONFIG, <plugin root>/config.yaml,
~/.cadkit/config.yaml). Nothing personal is hard-coded."""

import os

KIT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT = os.path.abspath(os.path.join(KIT, "..", "..", ".."))
ENV = {"freecadcmd": "CADKIT_FREECADCMD", "bambu_studio": "CADKIT_BAMBU",
       "bambu_presets": "CADKIT_BAMBU_PRESETS", "tolerances": "CADKIT_TOLERANCES",
       "inventory_hardware": "CADKIT_INVENTORY_HARDWARE"}


def config_file():
    for p in (os.environ.get("CADKIT_CONFIG"), os.path.join(ROOT, "config.yaml"),
              os.path.join(os.path.expanduser("~"), ".cadkit", "config.yaml")):
        if p and os.path.exists(p):
            return p
    return None


def _flat(path):
    out = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.split("#", 1)[0].strip()
            if ":" not in line:
                continue
            k, v = line.split(":", 1)
            v = v.strip().strip("'\"")
            if v:
                out[k.strip()] = v
    return out


def get(key):
    """Value for key, or None when it is not configured."""
    v = os.environ.get(ENV.get(key, ""), "")
    if v:
        return v
    f = config_file()
    if not f:
        return None
    v = _flat(f).get(key)
    if not v:
        return None
    v = os.path.expanduser(v)
    return v if os.path.isabs(v) else os.path.normpath(os.path.join(os.path.dirname(f), v))
