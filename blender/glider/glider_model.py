"""Driftlands glider, built in Blender from script.

Modelled in three.js space (X right, Y up, +Z forward, 1 unit = 1 m). T(x, y, z) converts to Blender
space (Z up, nose toward -Y), so the glTF exporter's Y-up conversion lands it exactly in game space.
Objects are kept separate, named and grouped in collections so they are easy to edit by hand.
"""
import math, os, sys
import bpy, bmesh
from mathutils import Vector, Matrix

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from glider_shape import sail_point, HALF_SPAN, BATTENS, le_z
import materials as M

HERE = os.path.dirname(os.path.abspath(__file__))


def T(x, y, z):
    return Vector((x, -z, y))


# ---------------------------------------------------------------- scene setup
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.unit_settings.system = 'METRIC'
    for name in ['Sail', 'Frame', 'Rigging', 'Harness', 'Pilot', 'Gear']:
        c = bpy.data.collections.new(name)
        sc.collection.children.link(c)


def link(obj, coll):
    bpy.data.collections[coll].objects.link(obj)
    return obj


def mesh_obj(name, verts, faces, uvs=None, coll='Frame', mat=None, smooth=True):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], faces)
    if uvs is not None:
        uvl = me.uv_layers.new(name='UVMap')
        for poly in me.polygons:
            for li, vi in zip(poly.loop_indices, poly.vertices):
                uvl.data[li].uv = uvs[vi]
    me.validate(); me.update()
    ob = bpy.data.objects.new(name, me)
    link(ob, coll)
    if smooth:
        me.shade_smooth()
    if mat is not None:
        me.materials.append(mat)
    return ob


# ---------------------------------------------------------------- generic sweep (tubes, straps, pods)
def frames(points, up_hint):
    P = [Vector(p) for p in points]
    n = len(P)
    Ts = []
    for i in range(n):
        a, b = P[max(0, i - 1)], P[min(n - 1, i + 1)]
        t = (b - a)
        Ts.append(t.normalized() if t.length > 1e-9 else Vector((0, 0, 1)))
    N0 = Vector(up_hint)
    out = []
    Nprev = N0
    for i in range(n):
        t = Ts[i]
        Nn = Nprev - t * Nprev.dot(t)
        if Nn.length < 1e-6:
            Nn = Vector((1, 0, 0)) - t * t.x
        Nn.normalize()
        B = t.cross(Nn).normalized()
        out.append((P[i], t, Nn, B))
        Nprev = Nn
    return out


def sweep(name, points3, radius, seg=16, coll='Frame', mat=None, up=(0, 1, 0), squash=1.0, cap=True,
          profile=None, uv_scale=1.0):
    """points3 in three.js coordinates; radius: float, list, or callable(t)->r. profile(theta)->(cx, cy) optional."""
    pts = [T(*p) for p in points3]
    upb = T(*up)
    F = frames(pts, upb)
    n = len(F)
    verts, faces, uvs = [], [], []
    arc = [0.0]
    for i in range(1, n):
        arc.append(arc[-1] + (F[i][0] - F[i - 1][0]).length)
    total = arc[-1] or 1.0
    for i, (p, t, Nn, B) in enumerate(F):
        tt = arc[i] / total
        r = radius(tt) if callable(radius) else (radius[i] if isinstance(radius, (list, tuple)) else radius)
        for k in range(seg + 1):
            th = k / seg * math.tau
            if profile:
                cx, cy = profile(th)
            else:
                cx, cy = math.cos(th), math.sin(th)
            v = p + Nn * (cy * r * squash) + B * (cx * r)
            verts.append(v)
            uvs.append((k / seg, arc[i] * uv_scale))
    R = seg + 1
    for i in range(n - 1):
        for k in range(seg):
            a = i * R + k
            faces.append((a, a + R, a + R + 1, a + 1))
    if cap:
        for end in (0, n - 1):
            c = len(verts)
            verts.append(F[end][0]); uvs.append((0.5, arc[end] * uv_scale))
            for k in range(seg):
                a = end * R + k
                faces.append((c, a, a + 1) if end == 0 else (c, a + 1, a))
    ob = mesh_obj(name, verts, faces, uvs, coll, mat)
    return ob


def catmull(points, per=8):
    out = []
    P = points
    n = len(P)
    for i in range(n - 1):
        p0, p1, p2, p3 = P[max(0, i - 1)], P[i], P[i + 1], P[min(n - 1, i + 2)]
        for j in range(per):
            t = j / per
            t2, t3 = t * t, t * t * t
            out.append(tuple(0.5 * (2 * p1[d] + (-p0[d] + p2[d]) * t + (2 * p0[d] - 5 * p1[d] + 4 * p2[d] - p3[d]) * t2 + (-p0[d] + 3 * p1[d] - 3 * p2[d] + p3[d]) * t3) for d in range(3)))
    out.append(tuple(P[-1]))
    return out


def lerp3(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def add_mod_bevel(ob, w=0.004, seg=2):
    m = ob.modifiers.new('Bevel', 'BEVEL'); m.width = w; m.segments = seg; m.limit_method = 'ANGLE'
    return m


def prim_box(name, center, size, coll, mat, rot=(0, 0, 0), bevel=0.006):
    bpy.ops.mesh.primitive_cube_add(size=1)
    ob = bpy.context.active_object
    for c in ob.users_collection: c.objects.unlink(ob)
    link(ob, coll)
    ob.name = name
    ob.location = T(*center)
    ob.scale = (size[0], size[2], size[1])
    ob.rotation_euler = (rot[0], -rot[2], rot[1])
    ob.data.materials.append(mat)
    if bevel: add_mod_bevel(ob, bevel, 3)
    return ob


def prim_sphere(name, center, r, coll, mat, scale=(1, 1, 1), segs=24, rings=16):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, segments=segs, ring_count=rings)
    ob = bpy.context.active_object
    for c in ob.users_collection: c.objects.unlink(ob)
    link(ob, coll)
    ob.name = name
    ob.location = T(*center)
    ob.scale = (scale[0], scale[2], scale[1])
    ob.data.materials.append(mat)
    ob.data.shade_smooth()
    return ob


def prim_torus(name, center, R, r, coll, mat, axis_rot=(0, 0, 0), scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, major_segments=24, minor_segments=8)
    ob = bpy.context.active_object
    for c in ob.users_collection: c.objects.unlink(ob)
    link(ob, coll)
    ob.name = name
    ob.location = T(*center)
    ob.rotation_euler = axis_rot
    ob.scale = scale
    ob.data.materials.append(mat)
    ob.data.shade_smooth()
    return ob


# ---------------------------------------------------------------- the sail
def sail_normal(s, v, e=1e-3):
    p = Vector(sail_point(s, v))
    du = Vector(sail_point(min(1, s + e), v)) - Vector(sail_point(max(-1, s - e), v))
    dv = Vector(sail_point(s, min(1, v + e))) - Vector(sail_point(s, max(0, v - e)))
    n = dv.cross(du)
    if n.y < 0: n = -n
    return p, n.normalized()


def build_sail(mats):
    NU, NV = 160, 44
    verts, faces, uvs = [], [], []
    for j in range(NV + 1):
        v = j / NV
        v = v * v * (3 - 2 * v) * 0.35 + v * 0.65          # denser near the edges
        for i in range(NU + 1):
            u = i / NU
            s = u * 2 - 1
            s = math.copysign(abs(s) ** 0.92, s)            # a little denser toward the tips
            verts.append(T(*sail_point(s, v)))
            uvs.append(((s + 1) / 2, 1 - v))
    R = NU + 1
    for j in range(NV):
        for i in range(NU):
            a = j * R + i
            faces.append((a, a + 1, a + R + 1, a + R))
    ob = mesh_obj('Sail', verts, faces, uvs, 'Sail', mats['sail'])
    sol = ob.modifiers.new('Thickness', 'SOLIDIFY'); sol.thickness = 0.012; sol.offset = -1
    sol.use_even_offset = True
    return ob


def build_battens(mats):
    for side in (-1, 1):
        for bi, b in enumerate(BATTENS):
            pts = []
            vend = 0.93 if b < 0.85 else 0.86
            for k in range(26):
                v = 0.02 + (vend - 0.02) * k / 25
                p, n = sail_normal(side * b, v)
                q = p + n * 0.012
                pts.append((q.x, q.y, q.z))
            sweep(f'Batten_{"L" if side < 0 else "R"}{bi}', pts, lambda t: 0.011 * (1 - 0.45 * t), seg=8, coll='Sail', mat=mats['batten'], squash=0.7)
            # end cap at the trailing edge
            e = pts[-1]
            prim_sphere(f'BattenTip_{"L" if side < 0 else "R"}{bi}', e, 0.013, 'Sail', mats['grip'], segs=10, rings=6)
    # centre (keel) batten
    pts = []
    for k in range(26):
        v = 0.04 + 0.86 * k / 25
        p, n = sail_normal(0.0, v)
        q = p + n * 0.012
        pts.append((q.x, q.y, q.z))
    sweep('Batten_C', pts, 0.012, seg=8, coll='Sail', mat=mats['batten'], squash=0.7)


def build_leading_edge(mats):
    for side in (-1, 1):
        pts = []
        for k in range(48):
            a = 0.005 + 0.968 * k / 47
            p, n = sail_normal(side * a, 0.0)
            q = p - n * 0.035 + Vector((0, 0, 0.012))
            pts.append((q.x, q.y, q.z))
        sweep(f'LeadingEdge_{"L" if side < 0 else "R"}', pts, lambda t: 0.055 * (1 - 0.35 * t), seg=16, coll='Sail', mat=mats['mylar'])
        # wingtip cap
        tipp = pts[-1]
        prim_sphere(f'TipCap_{"L" if side < 0 else "R"}', tipp, 0.045, 'Sail', mats['tube_dark'], segs=12, rings=8)
    # nose cone
    p, n = sail_normal(0.0, 0.0)
    nose = (p.x, p.y - 0.03, p.z + 0.05)
    sweep('NoseCone', [(0, nose[1], nose[2] - 0.12), (0, nose[1] - 0.005, nose[2] + 0.02), (0, nose[1] - 0.01, nose[2] + 0.09)],
          [0.07, 0.065, 0.02], seg=16, coll='Sail', mat=mats['tube_dark'])
    return nose


# ---------------------------------------------------------------- airframe
HANG = (0.0, 1.70, 0.12)          # hang point / control frame apex on the keel
BASE_L, BASE_R = (-0.80, -0.26, 0.64), (0.80, -0.26, 0.64)
KP_TOP = (0.0, 2.62, 0.10)


def build_frame(mats, nose):
    # keel
    keel = [(0, nose[1] - 0.02, nose[2] - 0.05), (0, 1.73, 1.2), (0, 1.70, 0.12), (0, 1.73, -1.0), (0, 1.78, -1.38)]
    sweep('Keel', catmull(keel, 6), 0.032, seg=14, mat=mats['tube'])
    prim_sphere('KeelEnd', keel[-1], 0.034, 'Frame', mats['tube_dark'], segs=12, rings=8)
    # cross bar: from the leading edges (~55% span) to a junction on the keel just aft of the hang point
    for side in (-1, 1):
        p, n = sail_normal(side * 0.55, 0.0)
        le = p - n * 0.06
        cb = [(le.x, le.y, le.z - 0.03), lerp3((le.x, le.y, le.z), (0, 1.71, -0.18), 0.5), (0, 1.71, -0.18)]
        sweep(f'CrossBar_{"L" if side < 0 else "R"}', cb, 0.03, seg=14, mat=mats['tube'])
        prim_box(f'CrossBarFitting_{"L" if side < 0 else "R"}', (le.x * 0.98, le.y - 0.01, le.z - 0.03), (0.08, 0.06, 0.08), 'Frame', mats['tube_dark'], bevel=0.01)
    prim_box('CrossBarJunction', (0, 1.70, -0.18), (0.16, 0.08, 0.12), 'Frame', mats['tube_dark'], bevel=0.015)
    # kingpost
    sweep('Kingpost', [(0, 1.72, 0.10), (0, 2.2, 0.10), KP_TOP], [0.024, 0.021, 0.018], seg=12, mat=mats['tube'])
    prim_sphere('KingpostCap', KP_TOP, 0.03, 'Frame', mats['tube_dark'], scale=(1, 0.8, 1), segs=12, rings=8)
    # control frame: aerofoil downtubes, base bar, corner fittings
    aero = lambda th: (math.cos(th) * 1.0, math.sin(th) * 0.45 - 0.15 * math.sin(th) * abs(math.cos(th)))
    for side, base in ((-1, BASE_L), (1, BASE_R)):
        top = (side * 0.06, HANG[1] - 0.05, HANG[2])
        pts = [top, lerp3(top, base, 0.5), base]
        sweep(f'Downtube_{"L" if side < 0 else "R"}', pts, 0.034, seg=16, mat=mats['tube_anod'], up=(0, 0, 1), profile=aero, squash=1.0)
        prim_box(f'CornerFitting_{"L" if side < 0 else "R"}', base, (0.08, 0.07, 0.07), 'Frame', mats['tube_dark'], bevel=0.012)
    prim_box('ApexFitting', (0, HANG[1] - 0.04, HANG[2]), (0.18, 0.09, 0.08), 'Frame', mats['tube_dark'], bevel=0.015)
    bb = [BASE_L, (-0.4, -0.29, 0.645), (0, -0.30, 0.65), (0.4, -0.29, 0.645), BASE_R]
    sweep('BaseBar', catmull(bb, 6), 0.022, seg=14, mat=mats['tube'])
    # rubber grips with ribs
    for side in (-1, 1):
        for gi in range(3):
            c = (side * (0.36 + gi * 0.07), -0.29 + 0.002 * gi, 0.645)
            prim_torus(f'GripRib_{"L" if side < 0 else "R"}{gi}', c, 0.026, 0.009, 'Frame', mats['grip'], axis_rot=(0, math.pi / 2, 0))
        g0 = (side * 0.30, -0.288, 0.645); g1 = (side * 0.56, -0.284, 0.645)
        sweep(f'Grip_{"L" if side < 0 else "R"}', [g0, g1], 0.026, seg=14, mat=mats['grip'])


def build_rigging(mats, nose):
    tail = (0, 1.78, -1.38)
    tops = [nose, tail]
    for side in (-1, 1):
        p, n = sail_normal(side * 0.62, 0.0)
        tops.append((p.x, p.y - 0.05, p.z - 0.02))
    wires = []
    for t in tops:
        wires.append((KP_TOP, t))
    lowers = [(BASE_L, nose), (BASE_R, nose), (BASE_L, tail), (BASE_R, tail), (BASE_L, tops[2]), (BASE_R, tops[3])]
    wires += lowers
    for i, (a, b) in enumerate(wires):
        sweep(f'Wire_{i:02d}', [a, b], 0.0045, seg=6, coll='Rigging', mat=mats['wire'], cap=False)
        # tangs and thimbles at each end
        for e, endp in enumerate((a, b)):
            d = Vector(b) - Vector(a); d.normalize()
            q = Vector(endp) + d * (0.04 if e == 0 else -0.04)
            prim_sphere(f'Thimble_{i:02d}{e}', (q.x, q.y, q.z), 0.011, 'Rigging', mats['steel'], segs=8, rings=6)


# ---------------------------------------------------------------- harness + gear
def build_harness(mats):
    # pod: lofted elliptical sections along z
    secs = [
        (0.40, 0.33, 0.17, 0.12), (0.30, 0.30, 0.24, 0.16), (0.05, 0.28, 0.26, 0.18), (-0.30, 0.28, 0.25, 0.18),
        (-0.70, 0.30, 0.22, 0.16), (-1.10, 0.32, 0.18, 0.14), (-1.45, 0.34, 0.13, 0.11), (-1.68, 0.37, 0.06, 0.06), (-1.74, 0.38, 0.015, 0.015),
    ]
    pts = [(0, s[1], s[0]) for s in secs]
    rx = [s[2] for s in secs]; ry = [s[3] / s[2] for s in secs]
    # sweep supports uniform squash only, so build per-ring with the profile scaled by section
    P = [T(*p) for p in pts]
    F = frames(P, T(0, 1, 0))
    seg = 28
    verts, faces, uvs = [], [], []
    arc = 0.0
    for i, (p, t, Nn, B) in enumerate(F):
        if i: arc += (F[i][0] - F[i - 1][0]).length
        for k in range(seg + 1):
            th = k / seg * math.tau
            cx, cy = math.cos(th), math.sin(th)
            # flatter belly, rounder back
            cyy = cy * (1.0 if cy > 0 else 0.8)
            verts.append(p + Nn * (cyy * secs[i][3]) + B * (cx * secs[i][2]))
            uvs.append((k / seg, arc))
    R = seg + 1
    for i in range(len(F) - 1):
        for k in range(seg):
            a = i * R + k
            faces.append((a, a + R, a + R + 1, a + 1))
    pod = mesh_obj('HarnessPod', verts, faces, uvs, 'Harness', mats['canvas'])
    sub = pod.modifiers.new('Smooth', 'SUBSURF'); sub.levels = 1; sub.render_levels = 1
    # shoulder opening rim (leather)
    prim_torus('PodRim', (0, 0.34, 0.39), 0.2, 0.025, 'Harness', mats['leather'], axis_rot=(math.pi / 2 - 0.25, 0, 0), scale=(1.15, 0.75, 1))
    # tail fin
    fin = [(0, 0.40, -1.25), (0, 0.55, -1.62), (0, 0.42, -1.72)]
    sweep('PodTailFin', fin, [0.06, 0.03, 0.01], seg=10, coll='Harness', mat=mats['leather'], squash=0.25, up=(1, 0, 0))
    # straps around the pod, with brass buckles
    for zi, (z, rx_, ry_, yc) in enumerate([(0.12, 0.262, 0.185, 0.28), (-0.52, 0.24, 0.175, 0.285), (-1.05, 0.19, 0.145, 0.318)]):
        prim_torus(f'Strap_{zi}', (0, yc, z), 1.0, 0.018, 'Harness', mats['strap'], axis_rot=(math.pi / 2, 0, 0), scale=(rx_, ry_, 1.0))
        prim_box(f'Buckle_{zi}', (rx_ * 0.98, yc + 0.02, z), (0.025, 0.07, 0.06), 'Harness', mats['brass'], bevel=0.006)
    # hang strap + carabiner
    sweep('HangStrap', [(0, 1.66, 0.10), (0, 1.2, 0.05), (0, 0.68, -0.05)], 0.022, seg=8, coll='Harness', mat=mats['strap'], squash=0.25, up=(0, 0, 1))
    prim_torus('Carabiner', (0, 0.62, -0.05), 0.05, 0.009, 'Harness', mats['steel'], axis_rot=(0, 0, 0), scale=(0.7, 1.0, 1.0))
    # reserve parachute container under the belly
    prim_box('ReserveContainer', (0, 0.08, -0.25), (0.26, 0.09, 0.42), 'Gear', mats['canvas_dark'], bevel=0.03)
    prim_box('ReserveHandle', (0.14, 0.07, -0.08), (0.03, 0.03, 0.08), 'Gear', mats['rust_webbing'], bevel=0.008)
    # specimen satchel on the right side, with flap and buckle
    prim_box('Satchel', (0.30, 0.22, -0.42), (0.08, 0.20, 0.30), 'Gear', mats['leather'], bevel=0.025)
    prim_box('SatchelFlap', (0.345, 0.27, -0.42), (0.02, 0.14, 0.31), 'Gear', mats['leather_dark'], bevel=0.008)
    prim_box('SatchelBuckle', (0.36, 0.22, -0.42), (0.012, 0.035, 0.03), 'Gear', mats['brass'], bevel=0.004)
    # brass spyglass strapped along the left side: the naturalist's lens
    sg = [(-0.30, 0.34, 0.10), (-0.30, 0.33, -0.55)]
    sweep('Spyglass_Body', sg, [0.032, 0.032], seg=18, coll='Gear', mat=mats['leather_dark'])
    sweep('Spyglass_Draw', [(-0.30, 0.34, 0.10), (-0.30, 0.345, 0.26)], 0.026, seg=18, coll='Gear', mat=mats['brass'])
    sweep('Spyglass_Eyepiece', [(-0.30, 0.345, 0.26), (-0.30, 0.347, 0.32)], [0.018, 0.022], seg=18, coll='Gear', mat=mats['brass'])
    for ri, z in enumerate((-0.55, -0.2, 0.10)):
        sweep(f'Spyglass_Ring{ri}', [(-0.30, 0.33 + 0.0 * ri, z - 0.012), (-0.30, 0.33, z + 0.012)], 0.036, seg=18, coll='Gear', mat=mats['brass'])
    sweep('Spyglass_Objective', [(-0.30, 0.33, -0.56), (-0.30, 0.33, -0.60)], [0.036, 0.04], seg=18, coll='Gear', mat=mats['brass'])
    # rolled map case on the back
    sweep('MapTube', [(0.0, 0.48, -0.15), (0.0, 0.47, -0.85)], 0.045, seg=16, coll='Gear', mat=mats['canvas_dark'])
    for zi, z in enumerate((-0.15, -0.85)):
        sweep(f'MapTubeCap{zi}', [(0, 0.48 - zi * 0.01, z + 0.015 * (1 if zi == 0 else -1)), (0, 0.48 - zi * 0.01, z - 0.015 * (1 if zi == 0 else -1))], 0.048, seg=16, coll='Gear', mat=mats['leather_dark'])
    for zi, z in enumerate((-0.3, -0.7)):
        prim_torus(f'MapStrap{zi}', (0, 0.47, z), 0.05, 0.007, 'Gear', mats['strap'], axis_rot=(math.pi / 2, 0, 0))
    # field journal tucked under the left strap
    prim_box('Journal', (-0.255, 0.30, -0.52), (0.03, 0.17, 0.12), 'Gear', mats['journal'], rot=(0, 0, 0.1), bevel=0.006)
    # lantern hanging from the base bar
    sweep('LanternHook', [(0, -0.30, 0.65), (0, -0.36, 0.65)], 0.006, seg=6, coll='Gear', mat=mats['steel'])
    prim_torus('LanternRing', (0, -0.355, 0.65), 0.018, 0.004, 'Gear', mats['brass'], axis_rot=(0, math.pi / 2, 0))
    sweep('LanternCap', [(0, -0.37, 0.65), (0, -0.40, 0.65)], [0.02, 0.045], seg=16, coll='Gear', mat=mats['brass'])
    sweep('LanternBase', [(0, -0.50, 0.65), (0, -0.53, 0.65)], [0.045, 0.035], seg=16, coll='Gear', mat=mats['brass'])
    for k in range(4):
        a = k / 4 * math.tau + math.pi / 4
        x, z = math.cos(a) * 0.04, 0.65 + math.sin(a) * 0.04
        sweep(f'LanternBar{k}', [(x, -0.40, z), (x, -0.50, z)], 0.005, seg=6, coll='Gear', mat=mats['brass'])
    glass = sweep('LampGlass', [(0, -0.40, 0.65), (0, -0.45, 0.65), (0, -0.50, 0.65)], [0.034, 0.038, 0.034], seg=16, coll='Gear', mat=mats['lamp'])
    return glass


# ---------------------------------------------------------------- pilot
HEAD = (0.0, 0.47, 0.60)


def build_pilot(mats):
    # shoulders and upper torso emerging from the pod
    prim_sphere('Torso', (0, 0.36, 0.36), 0.2, 'Pilot', mats['coat'], scale=(1.15, 0.7, 0.75))
    prim_sphere('Collar', (0, 0.42, 0.47), 0.085, 'Pilot', mats['coat_dark'], scale=(1.25, 0.6, 0.6))
    # neck and head
    sweep('Neck', [(0, 0.40, 0.44), (0, 0.45, 0.54)], 0.045, seg=12, coll='Pilot', mat=mats['skin'])
    prim_sphere('Head', HEAD, 0.105, 'Pilot', mats['skin'], scale=(0.95, 1.0, 1.08))
    prim_sphere('Nose', (0, 0.455, 0.71), 0.018, 'Pilot', mats['skin'], scale=(0.8, 1.0, 1.1))
    # leather flying cap with ear flaps and a fleece rim
    cap = prim_sphere('FlyingCap', (0, 0.485, 0.585), 0.115, 'Pilot', mats['leather'], scale=(1.0, 0.95, 1.08))
    # cut the face opening with a boolean against a squashed sphere
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.1, segments=20, ring_count=12)
    cutter = bpy.context.active_object
    cutter.location = T(0, 0.43, 0.70); cutter.scale = (1.0, 1.0, 0.85)
    b = cap.modifiers.new('FaceOpening', 'BOOLEAN'); b.object = cutter; b.operation = 'DIFFERENCE'; b.solver = 'EXACT'
    bpy.context.view_layer.objects.active = cap
    bpy.ops.object.modifier_apply(modifier='FaceOpening')
    bpy.data.objects.remove(cutter, do_unlink=True)
    cap.data.materials.clear(); cap.data.materials.append(mats['leather'])
    for side in (-1, 1):
        prim_sphere(f'EarFlap_{"L" if side < 0 else "R"}', (side * 0.1, 0.43, 0.6), 0.05, 'Pilot', mats['leather'], scale=(0.35, 1.1, 0.8))
        sweep(f'ChinStrap_{"L" if side < 0 else "R"}', [(side * 0.1, 0.40, 0.61), (side * 0.06, 0.36, 0.64), (0, 0.355, 0.65)], 0.008, seg=6, coll='Pilot', mat=mats['leather_dark'], squash=0.4)
    # goggles: strap + brass rims + tinted lenses, worn over the eyes
    prim_torus('GoggleStrap', (0, 0.49, 0.592), 0.112, 0.009, 'Pilot', mats['strap'], axis_rot=(0.18, 0, 0), scale=(1.03, 1.1, 1.0))
    for side in (-1, 1):
        c = (side * 0.042, 0.488, 0.692)
        sweep(f'GoggleRim_{"L" if side < 0 else "R"}', [(c[0], c[1], c[2] - 0.022), (c[0], c[1], c[2] + 0.008)], [0.034, 0.031], seg=20, coll='Pilot', mat=mats['brass'])
        sweep(f'GoggleLens_{"L" if side < 0 else "R"}', [(c[0], c[1], c[2] + 0.004), (c[0], c[1], c[2] + 0.012)], [0.027, 0.024], seg=20, coll='Pilot', mat=mats['lens'])
    sweep('GoggleBridge', [(-0.012, 0.488, 0.698), (0.012, 0.488, 0.698)], 0.007, seg=6, coll='Pilot', mat=mats['brass'])
    # arms reaching to the base bar, gloves around the grips
    for side in (-1, 1):
        sh = (side * 0.19, 0.37, 0.42)
        el = (side * 0.34, 0.08, 0.49)
        wr = (side * 0.44, -0.21, 0.62)
        pts = catmull([sh, el, wr], 6)
        sweep(f'Sleeve_{"L" if side < 0 else "R"}', pts, lambda t: 0.05 - 0.016 * t, seg=14, coll='Pilot', mat=mats['coat'])
        sweep(f'Cuff_{"L" if side < 0 else "R"}', [lerp3(el, wr, 0.82), lerp3(el, wr, 1.0)], 0.046, seg=14, coll='Pilot', mat=mats['coat_dark'])
        prim_sphere(f'Glove_{"L" if side < 0 else "R"}', (side * 0.45, -0.275, 0.645), 0.042, 'Pilot', mats['glove'], scale=(1.15, 0.85, 1.0))
        prim_sphere(f'Shoulder_{"L" if side < 0 else "R"}', sh, 0.062, 'Pilot', mats['coat'])
    # scarf knot at the collar (the long tail is simulated in the game)
    prim_sphere('ScarfKnot', (0, 0.36, 0.45), 0.045, 'Pilot', mats['scarf'], scale=(1.3, 0.8, 0.9))


def main(out_blend):
    reset()
    mats = M.make_all(HERE)
    build_sail(mats)
    build_battens(mats)
    nose = build_leading_edge(mats)
    build_frame(mats, nose)
    build_rigging(mats, nose)
    build_harness(mats)
    build_pilot(mats)
    # a game-space marker the loader uses for the lens camera
    e = bpy.data.objects.new('HeadAnchor', None); e.location = T(*HEAD); link(e, 'Pilot')
    e2 = bpy.data.objects.new('ScarfAnchor', None); e2.location = T(0, 0.36, 0.45); link(e2, 'Pilot')
    bpy.ops.wm.save_as_mainfile(filepath=out_blend)
    print('saved', out_blend, len(bpy.data.objects), 'objects')


if __name__ == '__main__':
    main(sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else os.path.join(HERE, 'glider_src.blend'))
