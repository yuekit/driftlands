"""Paints the sail livery, height and normal maps in the sail's UV space (u = span, image row = chord).

Everything is evaluated in metric planform coordinates so emblems, patches and stitching are not
stretched by the parametric UVs.
"""
import math, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from glider_shape import HALF_SPAN, BATTENS

N = int(sys.argv[1]) if len(sys.argv) > 1 else 2048
OUT = sys.argv[2] if len(sys.argv) > 2 else '.'
rng = np.random.default_rng(7)

u = (np.arange(N) + 0.5) / N
v = (np.arange(N) + 0.5) / N
U, Vv = np.meshgrid(u, v)          # rows = v (leading edge at top), cols = u
S = U * 2 - 1
A = np.abs(S)

def le_z(a): return 2.36 - a * 3.32 + 0.22 * a * a
def te_z(a):
    base = -0.62 - a * 0.95 - 0.12 * a ** 3
    sc = np.zeros_like(a)
    for i in range(len(BATTENS) - 1):
        b0, b1 = BATTENS[i], BATTENS[i + 1]
        t = (a - b0) / (b1 - b0)
        sc = np.where((a >= b0) & (a <= b1), 0.065 * np.sin(np.pi * t) * (1 - 0.4 * a), sc)
    sc = np.where(a < BATTENS[0], 0.03 * np.sin(np.pi * a / BATTENS[0]), sc)
    return base + sc
def tip(a):
    t = np.clip((a - 0.93) / 0.07, 0, 1)
    return np.where(a < 0.93, 1.0, np.sqrt(np.maximum(0, 1 - t * t)))

zl, zt, k = le_z(A), te_z(A), tip(A)
mid = (zl + zt) * 0.5
zl2 = mid + (zl - mid) * k; zt2 = mid + (zt - mid) * k
Z = zl2 + (zt2 - zl2) * Vv
X = S * HALF_SPAN * (1 - Vv * 0.025)
chord = np.maximum(zl2 - zt2, 1e-3)

# ---------------------------------------------------------------- noise helpers
def value_noise(shape, cells, seed):
    r = np.random.default_rng(seed)
    g = r.random((cells + 1, cells + 1))
    img = Image.fromarray((g * 255).astype(np.uint8)).resize((shape[1], shape[0]), Image.BICUBIC)
    return np.asarray(img).astype(np.float32) / 255.0
def fbm(shape, base, octs, seed):
    a, w, n = np.zeros(shape, np.float32), 0.5, 0.0
    for o in range(octs):
        a += value_noise(shape, base * 2 ** o, seed + o) * w; n += w; w *= 0.5
    return a / n

# ---------------------------------------------------------------- palette (sRGB)
def hexc(h): return np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)], np.float32) / 255.0
CREAM, RUST, TEAL, INK, GOLD, LINEN = map(hexc, ['#efe3c8', '#c4553a', '#2f6f73', '#2a2230', '#d8a24a', '#e2d2ae'])
col = np.ones((N, N, 3), np.float32) * CREAM
height = np.zeros((N, N), np.float32)

def paint(mask, c, a=1.0):
    global col
    m = np.clip(mask, 0, 1)[..., None] * a
    col = col * (1 - m) + c * m

def band(x, lo, hi, soft):
    return np.clip((x - lo) / soft, 0, 1) * np.clip((hi - x) / soft, 0, 1)

# panel tint: each panel between battens and chord seams gets its own slight shade
bat_idx = np.searchsorted(np.array(BATTENS), A)
ch_idx = (Vv > 0.36).astype(int) + (Vv > 0.70).astype(int)
pid = bat_idx * 3 + ch_idx + (S > 0) * 50
tint = (np.sin(pid * 12.9898) * 43758.5453) % 1.0
col *= (0.965 + 0.06 * tint)[..., None]

# leading-edge pocket, rust band, teal tips
px = 1.0 / N
paint(band(Vv, -1, 0.068, 2 * px), TEAL * 0.92)
paint(band(Vv, 0.068, 0.078, 2 * px), GOLD, 0.9)
paint(band(A, 0.585, 0.725, 0.004), RUST)
paint(band(A, 0.735, 0.745, 0.002), RUST, 0.85)
paint(band(A, 0.845, 0.853, 0.002), GOLD, 0.95)
paint(np.clip((A - 0.855) / 0.003, 0, 1), TEAL)
paint(np.clip((A - 0.965) / 0.004, 0, 1), INK * 1.4, 0.8)

# ---------------------------------------------------------------- emblems (drawn on a metric canvas)
def stamp(draw_fn, cx, cz, size, color, alpha=1.0, hscale=0.0, res=1024):
    canvas = Image.new('L', (res, res), 0)
    draw_fn(ImageDraw.Draw(canvas), res)
    canvas = canvas.filter(ImageFilter.GaussianBlur(0.8))
    c = np.asarray(canvas).astype(np.float32) / 255.0
    # world -> canvas: screen-right is -x when viewed from behind, screen-up is +z
    cxp = (cx - X) / size + 0.5
    cyp = (cz - Z) / size + 0.5
    inside = (cxp >= 0) & (cxp < 1) & (cyp >= 0) & (cyp < 1)
    ix = np.clip((cxp * res).astype(int), 0, res - 1); iy = np.clip((cyp * res).astype(int), 0, res - 1)
    m = np.where(inside, c[iy, ix], 0.0)
    paint(m, color, alpha)
    return m

def compass(d, R):
    c = R / 2
    d.ellipse([c - R * 0.46, c - R * 0.46, c + R * 0.46, c + R * 0.46], outline=255, width=int(R * 0.022))
    d.ellipse([c - R * 0.40, c - R * 0.40, c + R * 0.40, c + R * 0.40], outline=255, width=int(R * 0.008))
    for i in range(16):
        a = i / 16 * math.tau
        l = R * (0.38 if i % 4 == 0 else 0.26 if i % 2 == 0 else 0.18)
        w = R * (0.07 if i % 4 == 0 else 0.045)
        tipp = (c + math.sin(a) * l, c - math.cos(a) * l)
        l1 = (c + math.sin(a + math.pi / 2) * w, c - math.cos(a + math.pi / 2) * w)
        l2 = (c + math.sin(a - math.pi / 2) * w, c - math.cos(a - math.pi / 2) * w)
        d.polygon([tipp, l1, (c, c), l2], fill=255 if i % 2 == 0 else 180)
    d.ellipse([c - R * 0.05, c - R * 0.05, c + R * 0.05, c + R * 0.05], fill=0)
    # an eye in the middle: the naturalist's mark
    d.ellipse([c - R * 0.13, c - R * 0.07, c + R * 0.13, c + R * 0.07], outline=255, width=int(R * 0.012))
    for i in range(48):
        a = i / 48 * math.tau
        r0, r1 = R * 0.47, R * (0.5 if i % 3 == 0 else 0.485)
        d.line([(c + math.cos(a) * r0, c + math.sin(a) * r0), (c + math.cos(a) * r1, c + math.sin(a) * r1)], fill=255, width=int(R * 0.006))

FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Bold.ttf'
def lettering(text, size_frac, y_frac=0.5, spacing=0.0):
    def f(d, R):
        font = ImageFont.truetype(FONT, int(R * size_frac))
        w = d.textlength(text, font=font) + spacing * R * (len(text) - 1)
        x = (R - w) / 2
        for ch in text:
            d.text((x, R * y_frac), ch, font=font, fill=255, anchor='lm')
            x += d.textlength(ch, font=font) + spacing * R
    return f

stamp(compass, -2.05, 0.35, 1.05, RUST, 0.92)
stamp(lettering('SURVEY', 0.11, 0.5, 0.04), -2.05, -0.38, 1.2, INK, 0.85)
stamp(lettering('07', 0.62, 0.5, 0.02), 2.05, 0.30, 1.05, INK, 0.88)
stamp(lettering('DRIFTLANDS', 0.085, 0.5, 0.03), 2.05, -0.36, 1.25, RUST, 0.85)

# ---------------------------------------------------------------- seams, stitching, patches
def line_dist_along(coord, value):
    return np.abs(coord - value)

seam = np.zeros((N, N), np.float32)
stitch = np.zeros((N, N), np.float32)
for b in BATTENS:
    # distance in metres across a chordwise seam (x direction)
    d = np.abs(A - b) * HALF_SPAN
    seam = np.maximum(seam, np.clip(1 - d / 0.006, 0, 1))
    for off in (-0.012, 0.012):
        dd = np.abs((A - b) * HALF_SPAN - off)
        dots = (np.sin(Z * 2 * math.pi / 0.022) > 0.2)
        stitch = np.maximum(stitch, np.clip(1 - dd / 0.0025, 0, 1) * dots)
for vs in (0.36, 0.70):
    d = np.abs(Vv - vs) * chord
    seam = np.maximum(seam, np.clip(1 - d / 0.006, 0, 1))
    for off in (-0.012, 0.012):
        dd = np.abs((Vv - vs) * chord - off)
        dots = (np.sin(X * 2 * math.pi / 0.022) > 0.2)
        stitch = np.maximum(stitch, np.clip(1 - dd / 0.0025, 0, 1) * dots)
# trailing-edge hem
hem_d = (1 - Vv) * chord
seam = np.maximum(seam, np.clip(1 - np.abs(hem_d - 0.03) / 0.008, 0, 1))
paint(seam, INK, 0.22)
paint(stitch, INK * 1.2, 0.35)
height += seam * 0.7 - stitch * 0.5

patches = [(3.15, -0.62, 0.36, 0.26, 0.15), (-3.55, -0.98, 0.30, 0.30, -0.2), (0.95, -0.42, 0.24, 0.17, 0.35), (-0.9, 0.95, 0.2, 0.14, -0.1)]
for (pxc, pzc, w, h, rot) in patches:
    dx, dz = X - pxc, Z - pzc
    ca, sa = math.cos(rot), math.sin(rot)
    lx, lz = dx * ca - dz * sa, dx * sa + dz * ca
    inside = np.clip((w / 2 - np.abs(lx)) / 0.004, 0, 1) * np.clip((h / 2 - np.abs(lz)) / 0.004, 0, 1)
    paint(inside, LINEN * (0.95 + 0.05 * rng.random()), 0.95)
    edge = np.clip(1 - np.abs(np.maximum(np.abs(lx) - w / 2, np.abs(lz) - h / 2) + 0.012) / 0.003, 0, 1)
    sdots = (np.sin((lx + lz) * 2 * math.pi / 0.018) > 0.1)
    paint(edge * sdots, INK, 0.5)
    height += inside * 0.35 - edge * sdots * 0.4

# ---------------------------------------------------------------- weathering
g1 = fbm((N, N), 6, 5, 11)
g2 = fbm((N, N), 24, 3, 21)
grime = np.clip((Vv - 0.72) / 0.28, 0, 1) ** 1.5 * 0.22 + np.clip((A - 0.8) / 0.2, 0, 1) * 0.08
grime *= 0.6 + 0.8 * g1
paint(np.ones_like(grime), np.array([0.32, 0.25, 0.22], np.float32), 1.0) if False else None
col *= (1 - grime)[..., None] * np.array([1.0, 0.97, 0.93]) + grime[..., None] * np.array([0.55, 0.47, 0.42])
# water-stain rings
st = fbm((N, N), 10, 4, 33)
ring = np.clip(1 - np.abs(st - 0.58) / 0.012, 0, 1) * (g2 > 0.5)
col *= (1 - ring * 0.08)[..., None]
# sun-bleached mottling
col = col * (0.97 + 0.06 * g2[..., None])

# fabric tension wrinkles near the trailing edge, between battens
wr = np.sin((A * HALF_SPAN * 9.0) + Vv * 3.0) * np.clip((Vv - 0.55) / 0.45, 0, 1) * 0.25
height += wr + (g2 - 0.5) * 0.15

col = np.clip(col, 0, 1)
Image.fromarray((col * 255 + 0.5).astype(np.uint8)).save(f'{OUT}/sail_color.png')
h16 = np.clip((height - height.min()) / (height.max() - height.min() + 1e-6), 0, 1)
Image.fromarray((h16 * 65535).astype(np.uint16)).save(f'{OUT}/sail_height.png')

# tangent-space normal map (OpenGL convention: +Y = +V = up in the image)
k = 4.0
dhdu = (np.roll(height, -1, 1) - np.roll(height, 1, 1)) * 0.5
dhdv = (np.roll(height, 1, 0) - np.roll(height, -1, 0)) * 0.5
n = np.stack([-dhdu * k, -dhdv * k, np.ones_like(height)], -1)
n /= np.linalg.norm(n, axis=-1, keepdims=True)
Image.fromarray(((n * 0.5 + 0.5) * 255 + 0.5).astype(np.uint8)).save(f'{OUT}/sail_normal.png')
print('painted', N)
