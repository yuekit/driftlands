"""Editable procedural materials for the Driftlands glider.

Patterns read the object's original 'UVMap' (or world position for large-scale variation), so they stay
put after the parts are joined into an atlas for baking. Every material is a plain Principled BSDF graph
that can be edited by hand in Blender.
"""
import os
import bpy


def hexrgb(h, a=1.0):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    lin = [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
    return (*lin, a)


class G:
    def __init__(self, name):
        self.m = bpy.data.materials.new(name)
        self.m.use_nodes = True
        self.nt = self.m.node_tree
        self.nt.nodes.clear()
        self.out = self.n('ShaderNodeOutputMaterial', (900, 0))
        self.bsdf = self.n('ShaderNodeBsdfPrincipled', (600, 0))
        self.l(self.bsdf.outputs['BSDF'], self.out.inputs['Surface'])
        self.x = 0

    def n(self, kind, loc=(0, 0)):
        node = self.nt.nodes.new(kind)
        node.location = loc
        return node

    def l(self, a, b):
        self.nt.links.new(a, b)

    def coords(self, kind='Position'):
        if kind == 'UV':
            uv = self.n('ShaderNodeUVMap', (-900, 200)); uv.uv_map = 'UVMap'
            return uv.outputs['UV']
        geo = self.n('ShaderNodeNewGeometry', (-900, 0))
        return geo.outputs['Position']


def principled(name, base, rough=0.5, metal=0.0, var=0.08, var_scale=6.0, rough_var=0.1, bump=None,
               bump_strength=0.25, sheen=0.0, coat=0.0, emission=None, emit_strength=0.0, alpha=1.0, edge_wear=0.0,
               transmission=0.0, ior=1.45, weave=None):
    g = G(name)
    b = g.bsdf
    pos = g.coords('Position')
    # colour variation
    noise = g.n('ShaderNodeTexNoise', (-600, 300)); noise.inputs['Scale'].default_value = var_scale; noise.inputs['Detail'].default_value = 6
    g.l(pos, noise.inputs['Vector'])
    ramp = g.n('ShaderNodeMix', (-300, 300)); ramp.data_type = 'RGBA'; ramp.blend_type = 'MULTIPLY'
    ramp.inputs['Factor'].default_value = 1.0
    ramp.inputs['A'].default_value = base
    mr = g.n('ShaderNodeMapRange', (-450, 380)); mr.inputs['To Min'].default_value = 1 - var; mr.inputs['To Max'].default_value = 1 + var * 0.6
    g.l(noise.outputs['Fac'], mr.inputs['Value'])
    comb = g.n('ShaderNodeCombineColor', (-450, 250))
    for ch in ('Red', 'Green', 'Blue'):
        g.l(mr.outputs['Result'], comb.inputs[ch])
    g.l(comb.outputs['Color'], ramp.inputs['B'])
    color_out = ramp.outputs['Result']
    if edge_wear > 0:
        geo = g.n('ShaderNodeNewGeometry', (-600, 520))
        wear = g.n('ShaderNodeMapRange', (-450, 520)); wear.inputs['From Min'].default_value = 0.5; wear.inputs['From Max'].default_value = 0.58
        g.l(geo.outputs['Pointiness'], wear.inputs['Value'])
        mixw = g.n('ShaderNodeMix', (-150, 400)); mixw.data_type = 'RGBA'
        g.l(wear.outputs['Result'], mixw.inputs['Factor'])
        g.l(color_out, mixw.inputs['A'])
        mixw.inputs['B'].default_value = tuple(min(1, c * 1.6 + 0.08) for c in base[:3]) + (1,)
        mul = g.n('ShaderNodeMath', (-300, 600)); mul.operation = 'MULTIPLY'; mul.inputs[1].default_value = edge_wear
        g.l(wear.outputs['Result'], mul.inputs[0]); g.l(mul.outputs['Value'], mixw.inputs['Factor'])
        color_out = mixw.outputs['Result']
    g.l(color_out, b.inputs['Base Color'])
    # roughness variation
    rn = g.n('ShaderNodeTexNoise', (-600, 0)); rn.inputs['Scale'].default_value = var_scale * 3; g.l(pos, rn.inputs['Vector'])
    rr = g.n('ShaderNodeMapRange', (-300, 0)); rr.inputs['To Min'].default_value = max(0, rough - rough_var); rr.inputs['To Max'].default_value = min(1, rough + rough_var)
    g.l(rn.outputs['Fac'], rr.inputs['Value']); g.l(rr.outputs['Result'], b.inputs['Roughness'])
    b.inputs['Metallic'].default_value = metal
    if sheen: b.inputs['Sheen Weight'].default_value = sheen
    if coat: b.inputs['Coat Weight'].default_value = coat
    if transmission:
        b.inputs['Transmission Weight'].default_value = transmission; b.inputs['IOR'].default_value = ior
    if emission is not None:
        b.inputs['Emission Color'].default_value = emission; b.inputs['Emission Strength'].default_value = emit_strength
    # bump
    height = None
    if bump == 'grain':
        t = g.n('ShaderNodeTexNoise', (-600, -300)); t.inputs['Scale'].default_value = 220; t.inputs['Detail'].default_value = 10; t.inputs['Roughness'].default_value = 0.7
        g.l(pos, t.inputs['Vector']); height = t.outputs['Fac']
    elif bump == 'leather':
        v = g.n('ShaderNodeTexVoronoi', (-600, -300)); v.inputs['Scale'].default_value = 160; v.feature = 'DISTANCE_TO_EDGE'
        g.l(pos, v.inputs['Vector'])
        t = g.n('ShaderNodeTexNoise', (-600, -500)); t.inputs['Scale'].default_value = 60; g.l(pos, t.inputs['Vector'])
        add = g.n('ShaderNodeMath', (-400, -400)); add.operation = 'MULTIPLY_ADD'; add.inputs[1].default_value = 0.6
        g.l(v.outputs['Distance'], add.inputs[0]); g.l(t.outputs['Fac'], add.inputs[2])
        height = add.outputs['Value']
    elif bump == 'weave':
        sc = weave or 260
        w1 = g.n('ShaderNodeTexWave', (-600, -300)); w1.bands_direction = 'X'; w1.inputs['Scale'].default_value = sc; w1.wave_profile = 'SIN'
        w2 = g.n('ShaderNodeTexWave', (-600, -500)); w2.bands_direction = 'Z'; w2.inputs['Scale'].default_value = sc; w2.wave_profile = 'SIN'
        w3 = g.n('ShaderNodeTexWave', (-600, -700)); w3.bands_direction = 'Y'; w3.inputs['Scale'].default_value = sc; w3.wave_profile = 'SIN'
        for w in (w1, w2, w3): g.l(pos, w.inputs['Vector'])
        m1 = g.n('ShaderNodeMath', (-400, -400)); m1.operation = 'MULTIPLY'
        m2 = g.n('ShaderNodeMath', (-250, -450)); m2.operation = 'MULTIPLY'
        g.l(w1.outputs['Fac'], m1.inputs[0]); g.l(w2.outputs['Fac'], m1.inputs[1]); g.l(m1.outputs['Value'], m2.inputs[0]); g.l(w3.outputs['Fac'], m2.inputs[1])
        height = m2.outputs['Value']
    elif bump == 'ribs':
        w = g.n('ShaderNodeTexWave', (-600, -300)); w.bands_direction = 'X'; w.inputs['Scale'].default_value = 90; g.l(pos, w.inputs['Vector']); height = w.outputs['Fac']
    elif bump == 'scratches':
        t = g.n('ShaderNodeTexNoise', (-600, -300)); t.inputs['Scale'].default_value = 400; t.inputs['Detail'].default_value = 2
        g.l(pos, t.inputs['Vector']); height = t.outputs['Fac']
    if height is not None:
        bn = g.n('ShaderNodeBump', (300, -300)); bn.inputs['Strength'].default_value = bump_strength; bn.inputs['Distance'].default_value = 0.002
        g.l(height, bn.inputs['Height']); g.l(bn.outputs['Normal'], b.inputs['Normal'])
    return g.m


def sail_material(folder):
    g = G('M_Sail')
    b = g.bsdf
    uv = g.coords('UV')
    img = g.n('ShaderNodeTexImage', (-500, 200)); img.image = bpy.data.images.load(os.path.join(folder, 'sail_color.png')); img.image.name = 'sail_color'
    nim = g.n('ShaderNodeTexImage', (-500, -200)); nim.image = bpy.data.images.load(os.path.join(folder, 'sail_normal.png')); nim.image.colorspace_settings.name = 'Non-Color'; nim.image.name = 'sail_normal'
    g.l(uv, img.inputs['Vector']); g.l(uv, nim.inputs['Vector'])
    nm = g.n('ShaderNodeNormalMap', (100, -200)); nm.uv_map = 'UVMap'; nm.inputs['Strength'].default_value = 1.0
    g.l(nim.outputs['Color'], nm.inputs['Color']); g.l(nm.outputs['Normal'], b.inputs['Normal'])
    g.l(img.outputs['Color'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 0.72
    b.inputs['Sheen Weight'].default_value = 0.25
    # light glowing through the fabric
    b.inputs['Subsurface Weight'].default_value = 0.0
    b.inputs['Transmission Weight'].default_value = 0.0
    tr = g.n('ShaderNodeBsdfTranslucent', (600, -250)); g.l(img.outputs['Color'], tr.inputs['Color'])
    mix = g.n('ShaderNodeMixShader', (800, 0)); mix.inputs['Fac'].default_value = 0.28
    g.l(b.outputs['BSDF'], mix.inputs[1]); g.l(tr.outputs['BSDF'], mix.inputs[2]); g.l(mix.outputs['Shader'], g.out.inputs['Surface'])
    g.out.location = (1000, 0)
    return g.m


def make_all(folder):
    m = {}
    m['sail'] = sail_material(folder)
    m['batten'] = principled('M_Batten', hexrgb('#2a2630'), rough=0.35, var=0.04, bump='scratches', bump_strength=0.05, coat=0.4)
    m['mylar'] = principled('M_LeadingEdgePocket', hexrgb('#2c6a6e'), rough=0.45, var=0.06, bump='weave', weave=320, bump_strength=0.12, sheen=0.3)
    m['tube'] = principled('M_TubeAluminium', hexrgb('#b9bcc4'), rough=0.3, metal=1.0, var=0.05, rough_var=0.12, bump='scratches', bump_strength=0.04, edge_wear=0.4)
    m['tube_dark'] = principled('M_Fittings', hexrgb('#2b2a33'), rough=0.4, metal=0.6, var=0.05, edge_wear=0.8)
    m['tube_anod'] = principled('M_DowntubeAnodised', hexrgb('#a3462f'), rough=0.28, metal=1.0, var=0.05, rough_var=0.08, bump='scratches', bump_strength=0.03, edge_wear=0.6)
    m['grip'] = principled('M_Rubber', hexrgb('#1d1b20'), rough=0.85, var=0.05, bump='ribs', bump_strength=0.3)
    m['wire'] = principled('M_Wire', hexrgb('#8d9098'), rough=0.3, metal=1.0, var=0.02)
    m['steel'] = principled('M_Steel', hexrgb('#c3c6cc'), rough=0.25, metal=1.0, var=0.03, edge_wear=0.3)
    m['canvas'] = principled('M_WaxedCanvas', hexrgb('#a2875a'), rough=0.62, var=0.14, var_scale=4, bump='weave', weave=240, bump_strength=0.18, sheen=0.2)
    m['canvas_dark'] = principled('M_CanvasDark', hexrgb('#4c4a3a'), rough=0.7, var=0.12, bump='weave', weave=240, bump_strength=0.18)
    m['leather'] = principled('M_Leather', hexrgb('#7a4630'), rough=0.48, var=0.16, var_scale=8, bump='leather', bump_strength=0.18, edge_wear=0.5, coat=0.15)
    m['leather_dark'] = principled('M_LeatherDark', hexrgb('#3d2620'), rough=0.5, var=0.14, bump='leather', bump_strength=0.18, edge_wear=0.6)
    m['strap'] = principled('M_Webbing', hexrgb('#2c2a33'), rough=0.8, var=0.06, bump='weave', weave=420, bump_strength=0.25)
    m['rust_webbing'] = principled('M_WebbingRust', hexrgb('#c4553a'), rough=0.8, var=0.06, bump='weave', weave=420, bump_strength=0.25)
    m['brass'] = principled('M_Brass', hexrgb('#c79a4a'), rough=0.28, metal=1.0, var=0.18, var_scale=12, rough_var=0.15, edge_wear=0.7, bump='scratches', bump_strength=0.03)
    m['journal'] = principled('M_JournalCover', hexrgb('#2f6f73'), rough=0.6, var=0.12, bump='leather', bump_strength=0.15, edge_wear=0.8)
    m['lamp'] = principled('LampGlass', hexrgb('#ffd8a0'), rough=0.1, var=0.0, emission=hexrgb('#ffb060'), emit_strength=0.0)
    m['coat'] = principled('M_Coat', hexrgb('#3f5d55'), rough=0.62, var=0.1, bump='weave', weave=300, bump_strength=0.12, sheen=0.35)
    m['coat_dark'] = principled('M_CoatTrim', hexrgb('#5a3424'), rough=0.6, var=0.1, bump='leather', bump_strength=0.12)
    m['skin'] = principled('M_Skin', hexrgb('#e3b592'), rough=0.55, var=0.06, var_scale=20)
    m['fleece'] = principled('M_Fleece', hexrgb('#efe3c8'), rough=0.9, var=0.08, bump='grain', bump_strength=0.6, sheen=0.8)
    m['lens'] = principled('M_GoggleLens', hexrgb('#1f3a40'), rough=0.05, metal=0.0, var=0.0, coat=1.0)
    m['glove'] = principled('M_Glove', hexrgb('#5a3424'), rough=0.55, var=0.12, bump='leather', bump_strength=0.15, edge_wear=0.4)
    m['scarf'] = principled('M_Scarf', hexrgb('#d23c2c'), rough=0.8, var=0.08, bump='weave', weave=300, bump_strength=0.2, sheen=0.5)
    return m
