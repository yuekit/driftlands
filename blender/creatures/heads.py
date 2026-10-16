"""Creature heads, fins and petals sculpted as SDFs -> parts/<name>.npz (+ anchors in parts/anchors.json).
Each part: local frame +Z forward, +Y up, origin where it joins the animated body."""
import sys, json, math
import numpy as np
from sdflib import *

ANCH = {}
def save(name, data, anchors):
    np.savez_compressed(f'parts/{name}.npz', **data); ANCH[name] = anchors
    print(name, 'saved')

def stilt_head(hybrid=False):
    # units: genome head size = 1. Gentle grazing head: long soft muzzle, brow, ossicones, leaf ears.
    G = Grid((-1.05, -0.75, -0.95), (1.05, 1.35, 2.45), 0.0105 if not hybrid else 0.011)
    P = G.P; X, Y, Z = P
    N = Noise(3 if not hybrid else 9)
    neck = rcone(P, (0, -0.28, -0.85), (0, 0.04, 0.1), 0.45, 0.47)
    cran = ell(P, (0, 0.22, 0.34), (0.5, 0.47, 0.6))
    d = smin(neck, cran, 0.28)
    sn = rcone((X / 0.86, Y, Z), (0, 0.12, 0.72), (0, -0.01, 1.92), 0.35, 0.23) * 0.86
    d = smin(d, sn, 0.3)
    muz = ell(P, (0, -0.05, 1.96), (0.27, 0.24, 0.25)); d = smin(d, muz, 0.1)
    jaw = ell(P, (0, -0.21, 1.15), (0.27, 0.16, 0.78)); d = smin(d, jaw, 0.12)
    chin = ell(P, (0, -0.3, 0.75), (0.22, 0.14, 0.4)); d = smin(d, chin, 0.15)
    side = lambda fn: fn((np.abs(X), Y, Z))
    d = smin(d, side(lambda q: ell(q, (0.36, 0.42, 0.63), (0.19, 0.11, 0.26))), 0.12)            # brows
    d = smin(d, side(lambda q: ell(q, (0.31, -0.02, 0.92), (0.15, 0.17, 0.36))), 0.14)            # cheeks
    d = sub(d, side(lambda q: sph(q, (0.43, 0.2, 0.62), 0.2)), 0.05)                              # eye sockets
    # mouth slit and nostrils
    d = sub(d, ell(P, (0, -0.135, 1.62), (0.6, 0.016, 0.55)) + 0.0, 0.02)
    d = sub(d, side(lambda q: ell(q, (0.11, 0.06, 2.17), (0.05, 0.035, 0.07))), 0.03)
    if not hybrid:
        # ossicones with knobbed tips
        oss = side(lambda q: smin(rcone(q, (0.2, 0.52, 0.15), (0.27, 1.02, -0.12), 0.1, 0.065), sph(q, (0.27, 1.06, -0.13), 0.11), 0.06))
        d = smin(d, oss, 0.1)
        # cupped leaf ears
        R = frame((0.82, 0.32, -0.48), (0, 1, 0.3))
        ear = side(lambda q: ell_rot(q, (0.66, 0.5, -0.02), R, (0.08, 0.2, 0.42)))
        cup = side(lambda q: ell_rot(q, (0.66 + 0.06 * R[0][0], 0.5 + 0.06 * R[0][1] + 0.03, -0.02 + 0.06 * R[0][2]), R, (0.06, 0.15, 0.36)))
        d = smin(d, sub(ear, cup, 0.02), 0.06)
    else:
        # hybrid: chitin brow plates and forcipule pincers from the arch centipede
        d = smin(d, side(lambda q: ell_rot(q, (0.24, 0.58, 0.45), frame((0.25, 0.3, 1.0)), (0.2, 0.06, 0.45))), 0.05)
        d = smin(d, ell(P, (0, 0.62, 0.15), (0.25, 0.08, 0.38)), 0.08)
        for s in (-1, 1):
            pin = chain(P, [(0.22 * s, -0.22, 1.7), (0.42 * s, -0.3, 2.05), (0.34 * s, -0.3, 2.42), (0.1 * s, -0.27, 2.55)], [0.09, 0.075, 0.05, 0.015], 0.03)
            d = smin(d, pin, 0.06)
    # skin: fine wrinkles across the nose bridge and around the eyes
    wr = np.sin(Z * 55 + N(X * 4, Y * 4, Z * 4) * 3) * 0.004 * ss(Z, 1.0, 1.5) * ss(Y, -0.1, 0.15)
    d = d + wr + N.fbm(X * 9, Y * 9, Z * 9, 3) * 0.006
    eyes = lambda q: 1 - ss(sph((np.abs(q[0]), q[1], q[2]), (0.43, 0.2, 0.62), 0.0), 0.2, 0.34)
    masks = {
        'm1': lambda q: np.maximum.reduce([1 - ss(ell(q, (0, -0.05, 1.96), (0.27, 0.24, 0.25)), 0.0, 0.12),
                                          ss(-q[1], 0.18, 0.32) * ss(q[2], 0.2, 0.6),
                                          (ss(q[1], 0.9, 1.0) if not hybrid else ss(q[1], 0.55, 0.62)),
                                          eyes(q) * 0.85,
                                          (ss(np.abs(q[0]), 0.6, 0.75) * ss(q[1], 0.3, 0.45) * ss(-q[2], -0.3, -0.05) * (0 if hybrid else 1))]),
        'm2': (lambda q: np.zeros_like(q[0])) if not hybrid else (lambda q: ss(q[1], 0.55, 0.62) * (0.5 + 0.5 * np.sin(q[2] * 30))),
    }
    data = mesh(G, d, masks)
    save('HybridHead' if hybrid else 'StiltHead', data, {'eye': [0.43, 0.2, 0.62], 'eyeR': 0.2, 'collar': 0.46})


def crawler_head():
    # units: body segment radius = 1. Flattened shield head with compound eyes and venom claws (forcipules).
    G = Grid((-1.55, -0.85, -0.85), (1.55, 0.8, 2.6), 0.011)
    P = G.P; X, Y, Z = P; N = Noise(21)
    side = lambda fn: fn((np.abs(X), Y, Z))
    collar = rcone((X, Y / 0.68, Z), (0, 0, -0.75), (0, 0.02, 0.2), 1.0, 0.95) * 0.68
    shield = ell(P, (0, 0.04, 0.55), (1.02, 0.42, 0.9))
    d = smin(collar, shield, 0.25)
    dome = ell(P, (0, 0.22, 0.48), (0.86, 0.24, 0.74)); d = smin(d, dome, 0.06)
    d = smax(d, -(Y + 0.32), 0.06)                                           # flat belly plate
    d = smin(d, side(lambda q: ell(q, (0.5, 0.18, 1.12), (0.24, 0.16, 0.2))), 0.08)   # antenna sockets
    d = smin(d, side(lambda q: ell(q, (0.66, 0.2, 0.92), (0.3, 0.24, 0.26))), 0.1)    # eye bulges
    d = sub(d, side(lambda q: sph(q, (0.66, 0.24, 0.98), 0.27)), 0.03)
    claws = side(lambda q: chain(q, [(0.5, -0.24, 0.95), (0.86, -0.3, 1.42), (0.66, -0.3, 1.98), (0.2, -0.28, 2.2), (0.08, -0.26, 2.22)], [0.2, 0.15, 0.1, 0.04, 0.012], 0.04))
    d = smin(d, claws, 0.08)
    palps = side(lambda q: chain(q, [(0.25, -0.33, 1.05), (0.3, -0.42, 1.38), (0.24, -0.44, 1.6)], [0.08, 0.06, 0.05], 0.03))
    d = smin(d, palps, 0.04)
    # chitin: plate seams across the shield and pitting
    seam = np.abs(np.sin(Z * 7.5 + np.abs(X) * 1.5)) ** 12 * ss(Y, 0.0, 0.2) * 0.012
    d = d + seam + N.fbm(X * 7, Y * 7, Z * 7, 3) * 0.008
    masks = {
        'm1': lambda q: np.maximum(ss(q[2], 1.75, 2.1) * ss(-q[1], 0.15, 0.22), ss(np.abs(q[0]), 0.82, 0.98) * ss(q[1], -0.2, 0.0) * ss(q[2], 0.15, 0.4)),
        'm2': lambda q: (1 - ss(np.abs(np.sin(q[2] * 9) * np.sin(q[0] * 9)), 0.0, 0.15)) * ss(np.abs(q[0]), 0.75, 0.9) * ss(q[1], -0.1, 0.05),
    }
    save('CrawlerHead', mesh(G, d, masks), {'eye': [0.66, 0.24, 0.98], 'eyeR': 0.27, 'antenna': [0.5, 0.28, 1.2], 'collar': 1.0})

def whale_head():
    # units: body radius where the head joins = 1 (body cross-section is 1 wide, 0.86 tall). +Z toward the nose.
    G = Grid((-1.15, -1.05, -0.45), (1.15, 1.08, 2.0), 0.009)
    P = G.P; X, Y, Z = P; N = Noise(31)
    side = lambda fn: fn((np.abs(X), Y, Z))
    body = ell(P, (0, -0.02, 0.22), (1.0, 0.86, 1.58))
    collar = rcone((X, Y / 0.86, Z), (0, 0, -0.5), (0, 0, 0.1), 1.0, 1.0) * 0.86
    d = smin(body, collar, 0.2)
    jaw = ell(P, (0, -0.3, 0.5), (0.93, 0.56, 1.36)); d = smin(d, jaw, 0.12)
    d = smax(d, Y - (0.74 - 0.38 * ss(Z, 0.2, 1.75)), 0.3)                   # flatter rostrum
    # mouth line sweeping up and back to the corner, below the eye
    ym = -0.1 - 0.26 * ss(Z, 0.2, 1.7) + 0.04 * np.sin(Z * 2.6)
    slit = np.maximum(np.abs(Y - ym) - 0.011, -(Z - 0.18))
    d = smax(d, -slit, 0.012)
    # throat pleats on the belly
    pleat = (np.abs(np.sin(X * 26)) ** 6) * ss(-Y, 0.42, 0.62) * ss(Z, -0.4, 0.2) * 0.012
    d = d + pleat
    # eye bulge and socket just above the mouth corner
    d = smin(d, side(lambda q: ell(q, (0.84, 0.0, 0.22), (0.16, 0.14, 0.2))), 0.08)
    d = sub(d, side(lambda q: sph(q, (0.9, 0.02, 0.24), 0.085)), 0.02)
    # blowholes behind a splash ridge
    d = smin(d, ell(P, (0, 0.8, 0.02), (0.18, 0.08, 0.28)), 0.1)
    d = sub(d, side(lambda q: ell_rot(q, (0.06, 0.88, -0.02), frame((0.25, 0.0, 1.0)), (0.025, 0.05, 0.1))), 0.015)
    # tubercles on the rostrum and lower jaw
    rng = np.random.default_rng(5)
    for i in range(26):
        a = rng.uniform(-1.1, 1.1); zz = rng.uniform(0.8, 1.72)
        top = rng.random() < 0.55
        y0 = (0.7 - 0.3 * (zz - 0.2)) if top else (-0.3 - 0.18 * (zz - 0.3))
        x0 = np.sin(a) * (0.45 if top else 0.75) * (1.78 - zz) / 1.0
        d = smin(d, sph(P, (x0, y0 if top else y0 - 0.08, zz), rng.uniform(0.028, 0.05)), 0.02)
    # barnacle crust patches
    crustm = ss(N.fbm(X * 6 + 4, Y * 6, Z * 6, 2), 0.2, 0.3) * ss(Z, 1.05, 1.4)
    d = d - crustm * (0.012 + np.abs(N(X * 60, Y * 60, Z * 60)) * 0.025)
    d = d + N.fbm(X * 10, Y * 10, Z * 10, 3) * 0.004
    masks = {
        'm1': lambda q: np.maximum(ss(-q[1], 0.38, 0.55), ss(N.fbm(q[0] * 6 + 4, q[1] * 6, q[2] * 6, 2), 0.2, 0.3) * ss(q[2], 1.05, 1.4) * 0.8),
        'm2': lambda q: (1 - ss(np.abs(q[1] - (-0.1 - 0.26 * ss(q[2], 0.2, 1.7)) + 0.06), 0.0, 0.03)) * (np.sin(q[2] * 38) > 0.6) * ss(q[2], 0.35, 0.5),
    }
    save('WhaleHead', mesh(G, d, masks), {'eye': [0.9, 0.02, 0.24], 'eyeR': 0.085, 'collar': 1.0})

def blade(P, span_fn, xs=(0.0, 1.0)):
    pass

def whale_fin():
    # humpback-style pectoral: root at origin, span 1 along +X, leading edge toward +Z, tubercles on it
    G = Grid((-0.08, -0.12, -0.42), (1.06, 0.12, 0.26), 0.0045)
    P = G.P; X, Y, Z = P; N = Noise(41)
    t = np.clip(X, 0, 1)
    chord = 0.3 * (1 - t) ** 0.55 + 0.035
    th = 0.075 * (1 - t) + 0.012
    cz = -0.17 * t * t - 0.02; cy = 0.04 * t * t
    lead = cz + chord * 0.45
    q = ((Z - cz) / (chord * 0.5)) ** 2 + ((Y - cy) / (th * 0.5 * (0.6 + 0.4 * ss(Z, cz - chord * 0.5, cz)))) ** 2
    d = (np.sqrt(q) - 1) * th * 0.5
    d = smax(d, X - 1.0, 0.02); d = smax(d, -X - 0.05, 0.02)
    for i in range(12):
        x0 = 0.12 + i * 0.07; tt = x0
        d = smin(d, sph(P, (x0, 0.04 * tt * tt, -0.17 * tt * tt - 0.02 + (0.3 * (1 - tt) ** 0.55 + 0.035) * 0.48), 0.022 * (1 - tt * 0.5)), 0.012)
    d = d + N.fbm(X * 30, Y * 30, Z * 30, 2) * 0.0015
    masks = {'m1': lambda q: ss(-(q[1] - 0.04 * np.clip(q[0], 0, 1) ** 2), 0.0, 0.01), 'm2': lambda q: np.zeros_like(q[0])}
    save('WhaleFin', mesh(G, d, masks, 0.5), {})

def whale_fluke():
    # both flukes: root at origin, lobes to +-X, trailing edge toward -Z with a central notch
    G = Grid((-1.05, -0.08, -0.62), (1.05, 0.08, 0.2), 0.0045)
    P = G.P; X, Y, Z = P; N = Noise(43)
    t = np.clip(np.abs(X), 0, 1)
    chord = 0.34 * (1 - t) ** 0.7 + 0.03
    lead = 0.12 - 0.42 * t ** 1.4
    cz = lead - chord * 0.5
    th = 0.06 * (1 - t) + 0.01
    notch = 0.08 * np.exp(-(X / 0.08) ** 2)
    q = ((Z - cz - notch * 0.5) / (chord * 0.5 - notch * 0.5)) ** 2 + (Y / (th * 0.5)) ** 2
    d = (np.sqrt(q) - 1) * th * 0.5
    d = smax(d, np.abs(X) - 1.0, 0.02)
    trail = np.sin(np.abs(X) * 22) * 0.012 * ss(-(Z - (lead - chord)), -0.03, 0.0)
    d = d + trail + N.fbm(X * 25, Y * 25, Z * 25, 2) * 0.0012
    masks = {'m1': lambda q: ss(-q[1], 0.0, 0.01) * (0.5 + 0.5 * ss(N.fbm(q[0] * 4, 0, q[2] * 4, 2), 0.0, 0.2)), 'm2': lambda q: np.zeros_like(q[0])}
    save('WhaleFluke', mesh(G, d, masks, 0.5), {})

def petal():
    # cupped bloom petal: root at origin, span 1 along +X, width along Z, frilled edge, midrib
    G = Grid((-0.04, -0.06, -0.34), (1.04, 0.2, 0.34), 0.0035)
    P = G.P; X, Y, Z = P; N = Noise(51)
    t = np.clip(X, 0, 1)
    w = 0.3 * np.sin(np.pi * t ** 0.8) ** 0.8 + 0.035 * (1 - t)
    u = Z / np.maximum(w, 1e-3)
    cup = 0.13 * u * u * (0.3 + t) + 0.06 * np.sin(np.pi * t) * 0.3
    frill = 0.022 * np.sin(t * 46 + u * 2) * ss(np.abs(u), 0.6, 1.0)
    yc = cup + frill
    th = 0.009 + 0.006 * (1 - t)
    rib = 0.012 * np.exp(-(u / 0.12) ** 2) * (1 - t)
    d = np.maximum(np.abs(Y - yc - rib * 0.5) - th * 0.5 - rib * 0.5, (np.abs(Z) - w) * 0.8)
    d = smax(d, X - 1.0 + 0.0, 0.01); d = smax(d, -X, 0.01)
    veins = np.abs(np.sin(u * 14 + t * 3)) ** 10 * 0.0015
    d = d - veins
    masks = {'m1': lambda q: ss(q[0], 0.45, 0.95), 'm2': lambda q: ss(q[0], 0.6, 1.0) * 0.8}
    save('PolypPetal', mesh(G, d, masks, 0.4), {})

if __name__ == '__main__':
    which = sys.argv[1].split(',')
    if 'stilt' in which: stilt_head(False)
    if 'hybrid' in which: stilt_head(True)
    if 'crawler' in which: crawler_head()
    if 'whale' in which: whale_head()
    if 'fin' in which: whale_fin()
    if 'fluke' in which: whale_fluke()
    if 'petal' in which: petal()
    try: old = json.load(open('parts/anchors.json'))
    except Exception: old = {}
    old.update(ANCH); json.dump(old, open('parts/anchors.json', 'w'), indent=1)
