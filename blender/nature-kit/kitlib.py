"""Shared helpers for the Driftlands nature kit (Blender side). Model in three.js space; T() converts."""
import math
import bpy, bmesh
from mathutils import Vector

def T(x, y, z): return Vector((x, -z, y))

def reset(colls):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene; sc.unit_settings.system = 'METRIC'
    for name in colls:
        c = bpy.data.collections.new(name); sc.collection.children.link(c)

def link(ob, coll): bpy.data.collections[coll].objects.link(ob); return ob

def mesh_obj(name, verts, faces, coll, mat=None, smooth=True, uvs=None, location=(0, 0, 0)):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], [tuple(f) for f in faces])
    if uvs is not None:
        uvl = me.uv_layers.new(name='UVMap')
        for poly in me.polygons:
            for li, vi in zip(poly.loop_indices, poly.vertices): uvl.data[li].uv = uvs[vi]
    me.validate(); me.update()
    ob = bpy.data.objects.new(name, me); ob.location = location; link(ob, coll)
    if smooth: me.shade_smooth()
    if mat is not None: me.materials.append(mat)
    return ob

def frames(P, up=(0, 1, 0)):
    n = len(P); out = []; Np = Vector(up)
    for i in range(n):
        t = (P[min(n - 1, i + 1)] - P[max(0, i - 1)]); t = t.normalized() if t.length > 1e-9 else Vector((0, 0, 1))
        Nn = Np - t * Np.dot(t)
        if Nn.length < 1e-6: Nn = Vector((1, 0, 0)) - t * t.x
        Nn.normalize(); out.append((P[i], t, Nn, t.cross(Nn).normalized())); Np = Nn
    return out

def tube(points, radii, seg=8, cap_end=True, profile=None, twist=0.0):
    """points/radii in three.js space -> (verts, faces, uvs) in Blender space. profile(a, s) scales radius."""
    P = [Vector(p) for p in points]; F = frames(P)
    verts, faces, uvs = [], [], []
    L = [0.0]
    for i in range(1, len(P)): L.append(L[-1] + (P[i] - P[i - 1]).length)
    for i, (p, t, Nn, B) in enumerate(F):
        r = radii[i] if hasattr(radii, '__len__') else radii
        for k in range(seg + 1):
            a = 2 * math.pi * k / seg + twist * L[i]
            rr = r * (profile(a, i / max(1, len(P) - 1)) if profile else 1.0)
            q = p + (Nn * math.cos(a) + B * math.sin(a)) * rr
            verts.append(T(*q)); uvs.append((k / seg, L[i]))
    R = seg + 1
    for i in range(len(P) - 1):
        for k in range(seg):
            a = i * R + k; faces.append((a, a + 1, a + R + 1, a + R))
    if cap_end:
        c = len(verts); verts.append(T(*P[-1])); uvs.append((0.5, L[-1]))
        b = (len(P) - 1) * R
        for k in range(seg): faces.append((b + k, c, b + k + 1))
    return verts, faces, uvs

def catmull(pts, per=6):
    P = [Vector(p) for p in pts]; out = []
    for i in range(len(P) - 1):
        p0, p1, p2, p3 = P[max(0, i - 1)], P[i], P[i + 1], P[min(len(P) - 1, i + 2)]
        for s in range(per):
            t = s / per; t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(P[-1]); return out

def hexrgb(h):
    h = h.lstrip('#'); c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(((x / 12.92) if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4) for x in c) + (1.0,)
