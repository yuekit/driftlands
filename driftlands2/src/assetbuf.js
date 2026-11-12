// A bundled asset is base64 text or a data: URL in the single-file builds and a file URL in the hosted build.
import * as THREE from 'three';

const isUrl = (a) => /^(\.{0,2}\/|https?:|data:|blob:)/.test(a);

export async function assetBuffer(a) {
  if (isUrl(a)) {
    const r = await fetch(a);
    if (!r.ok) throw new Error(`Could not load ${a.slice(0, 80)} (${r.status})`);
    return r.arrayBuffer();
  }
  const bin = atob(a);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

export async function assetBitmap(a, type = 'image/webp') {
  let blob;
  if (isUrl(a)) { const r = await fetch(a); if (!r.ok) throw new Error(`Could not load ${a.slice(0, 80)} (${r.status})`); blob = await r.blob(); }
  else blob = new Blob([await assetBuffer(a)], { type });
  return createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
}

// textures are authored for glTF (v = 0 at the top), so nothing is flipped
export async function assetTexture(a, { srgb = false, aniso = 8, maxSize = 0 } = {}) {
  let bmp = await assetBitmap(a);
  if (maxSize && Math.max(bmp.width, bmp.height) > maxSize) {
    const k = maxSize / Math.max(bmp.width, bmp.height);
    const small = await createImageBitmap(bmp, { resizeWidth: Math.round(bmp.width * k), resizeHeight: Math.round(bmp.height * k), resizeQuality: 'high', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    bmp.close(); bmp = small;
  }
  const t = new THREE.Texture(bmp);
  t.flipY = false; t.premultiplyAlpha = false;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true; t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}

// pixels of a grey image as bytes (one per pixel)
export async function assetGrey(a) {
  const bmp = await assetBitmap(a);
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(bmp.width, bmp.height) : Object.assign(document.createElement('canvas'), { width: bmp.width, height: bmp.height });
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0);
  const d = g.getImageData(0, 0, bmp.width, bmp.height).data;
  const out = new Uint8Array(bmp.width * bmp.height);
  for (let i = 0; i < out.length; i++) out[i] = d[i * 4];
  const w = bmp.width, h = bmp.height;
  bmp.close();
  return { data: out, width: w, height: h };
}
