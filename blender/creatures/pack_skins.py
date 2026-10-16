import numpy as np, sys
from PIL import Image
from scipy.ndimage import gaussian_filter
D = sys.argv[1]; OUT = sys.argv[2]
K = [7.0, 6.0, 8.0, 3.0, 5.0, 4.5]          # bump strength per skin
A, B, prev = [], [], []
for i in range(6):
    a = np.load(f'{D}/skin_{i}.npy'); h = a[..., 0]
    h = (h - h.min()) / (h.max() - h.min() + 1e-6)
    hs = gaussian_filter(h, 0.6, mode='wrap')
    dx = (np.roll(hs, -1, 1) - np.roll(hs, 1, 1)) * 0.5 * K[i]
    dy = (np.roll(hs, -1, 0) - np.roll(hs, 1, 0)) * 0.5 * K[i]
    n = np.stack([-dx, dy, np.ones_like(dx)], -1); n /= np.linalg.norm(n, axis=-1, keepdims=True)
    cav = np.clip(gaussian_filter(h, 5, mode='wrap') - h, 0, 1)
    tone = np.clip(0.82 + 0.5 * (h - gaussian_filter(h, 10, mode='wrap')) - cav * 1.4, 0.35, 1.0)
    A.append(np.stack([n[..., 0] * 0.5 + 0.5, n[..., 1] * 0.5 + 0.5, tone], -1))
    B.append(np.stack([np.clip(a[..., 1], 0, 1), np.clip(a[..., 2], 0, 1), h], -1))
    L = np.array([0.5, 0.6, 0.62]); L /= np.linalg.norm(L)
    sh = np.clip((n * L).sum(-1), 0, 1) * tone
    col = np.stack([sh * (0.8 + 0.4 * a[..., 1].clip(0, 1)), sh * 0.85, sh * (0.7 + 0.5 * a[..., 2].clip(0, 1))], -1)
    prev.append(np.tile(col, (2, 2, 1)))
strip = np.concatenate([np.concatenate(A, 1), np.concatenate(B, 1)], 0)
Image.fromarray((strip * 255 + 0.5).clip(0, 255).astype(np.uint8)).save(OUT, quality=88)
p = np.concatenate(prev, 1)
Image.fromarray((p * 255).clip(0, 255).astype(np.uint8)).resize((p.shape[1] // 2, p.shape[0] // 2)).save(OUT.replace('.jpg', '_preview.png'))
import os; print('strip', strip.shape, os.path.getsize(OUT))
