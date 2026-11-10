// A bundled model is base64 text in the single-file builds and a URL in the hosted build. Either way: an ArrayBuffer.
export async function assetBuffer(a) {
  if (!a.startsWith('Z2xURg')) {   // not base64 of a .glb ("glTF"): a URL written by the hosted build
    const r = await fetch(a);
    if (!r.ok) throw new Error(`Could not load ${a} (${r.status})`);
    return r.arrayBuffer();
  }
  const bin = atob(a);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}
