"""Shared geometry for the Driftlands glider (three.js coordinates: X right, Y up, +Z forward, metres).

The sail is a parametric surface over s in [-1, 1] (span, left to right) and v in [0, 1] (chord, leading
to trailing edge). Both the Blender model and the livery painter use these functions, so the painted
texture lines up exactly with the mesh.
"""
import math

HALF_SPAN = 5.2
BASE_Y = 1.6
BATTENS = [0.075, 0.18, 0.29, 0.40, 0.51, 0.62, 0.73, 0.83, 0.915]   # |s| stations


def _tip(a):
    # rounds the wing tip: 1 inboard, falls to 0 at the very tip
    if a < 0.93:
        return 1.0
    t = (a - 0.93) / 0.07
    return math.sqrt(max(0.0, 1.0 - t * t))


def le_z(a):
    return 2.36 - a * 3.32 + 0.22 * a * a


def te_z(a):
    # scalloped trailing edge between battens
    base = -0.62 - a * 0.95 - 0.12 * a ** 3
    sc = 0.0
    for i in range(len(BATTENS) - 1):
        b0, b1 = BATTENS[i], BATTENS[i + 1]
        if b0 <= a <= b1:
            t = (a - b0) / (b1 - b0)
            sc = 0.065 * math.sin(math.pi * t) * (1.0 - 0.4 * a)
    if a < BATTENS[0]:
        sc = 0.03 * math.sin(math.pi * a / BATTENS[0])
    return base + sc


def chord_z(s, v):
    a = abs(s)
    zl, zt = le_z(a), te_z(a)
    k = _tip(a)
    mid = (zl + zt) * 0.5
    zl = mid + (zl - mid) * k
    zt = mid + (zt - mid) * k
    return zl + (zt - zl) * v


def sail_point(s, v):
    """Top-surface point of the sail."""
    a = abs(s)
    x = s * HALF_SPAN * (1.0 - v * 0.025)
    z = chord_z(s, v)
    camber = math.sin(math.pi * min(1.0, v * 1.08)) * 0.26 * (1.0 - 0.55 * a)
    dihedral = a * 0.30 - a * a * 0.10
    billow = math.sin(math.pi * v) * math.sin(math.pi * min(1.0, a / 0.98)) * 0.09
    washout = v * a * a * 0.22
    y = BASE_Y + camber + dihedral + billow + washout
    return (x, y, z)


def sail_metric(s, v):
    """Planform coordinates (x, z) for painting without distortion."""
    p = sail_point(s, v)
    return p[0], p[2]
