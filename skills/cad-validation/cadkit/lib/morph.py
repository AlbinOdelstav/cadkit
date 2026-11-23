# -*- coding: utf-8 -*-
"""Binary morphology and connected-component labelling in plain numpy.

scipy.ndimage cannot be used on this machine: Windows Application Control
blocks its compiled BLAS DLL inside FreeCAD's Python.
"""

import numpy as np


def disk_offsets(r):
    return [(dy, dx) for dy in range(-r, r + 1) for dx in range(-r, r + 1)
            if dx * dx + dy * dy <= r * r]


def _shift(g, dy, dx):
    h, w = g.shape
    o = np.zeros_like(g)
    o[max(0, dy):h + min(0, dy), max(0, dx):w + min(0, dx)] = \
        g[max(0, -dy):h - max(0, dy), max(0, -dx):w - max(0, dx)]
    return o


def erode(g, r):
    o = g.copy()
    for dy, dx in disk_offsets(r):
        o &= _shift(g, dy, dx)
    return o


def dilate(g, r):
    o = g.copy()
    for dy, dx in disk_offsets(r):
        o |= _shift(g, dy, dx)
    return o


def opening(g, r):
    return dilate(erode(g, r), r)


def closing(g, r):
    pad = r + 1
    gp = np.pad(g, pad)
    return erode(dilate(gp, r), r)[pad:-pad, pad:-pad]


def label(g):
    """8-connected labels via run-length union-find. Returns (labels, n)."""
    h, w = g.shape
    parent = [0]

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    runs_prev = []
    all_runs = []
    for y in range(h):
        row = g[y]
        if not row.any():
            runs_prev = []
            continue
        d = np.diff(np.concatenate([[0], row.view(np.int8), [0]]))
        starts = np.nonzero(d == 1)[0]
        ends = np.nonzero(d == -1)[0]          # exclusive
        cur = []
        j = 0
        for s, e in zip(starts, ends):
            lab = len(parent)
            parent.append(lab)
            # overlap with previous row runs, 8-connected: [s-1, e]
            while j < len(runs_prev) and runs_prev[j][1] < s:
                j += 1
            k = j
            while k < len(runs_prev) and runs_prev[k][0] <= e:
                a, b = find(runs_prev[k][2]), find(lab)
                if a != b:
                    parent[max(a, b)] = min(a, b)
                k += 1
            cur.append((s, e, lab))
            all_runs.append((y, s, e, lab))
        runs_prev = cur
    out = np.zeros((h, w), dtype=np.int32)
    remap = {}
    for y, s, e, lab in all_runs:
        root = find(lab)
        if root not in remap:
            remap[root] = len(remap) + 1
        out[y, s:e] = remap[root]
    return out, len(remap)
