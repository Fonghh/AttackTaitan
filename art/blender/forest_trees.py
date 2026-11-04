"""
森林的樹（5 種）：綠色大橡樹、杉樹、苔蘚古木（垂藤）、櫻花樹、楓樹。

遊戲裡每棵樹的「勾索／碰撞」還是原本的隱形樹幹＋樹冠，這裡做的是看得到的外觀，對齊那個框：
- 樹幹 `trunk_<樣式>`：標準化尺寸——底部半徑 1、高度 1（Z 0～1），遊戲裡依每棵樹縮放成（半徑 r、高 h）。
- 樹冠 `canopy_<種類>`：以「樹幹半徑 r」為單位、原點在樹幹頂端；大致填滿原本樹冠的範圍
  （中心在頂端上方 1.6、水平半徑約 3.2、上下約 ±2.2），遊戲裡等比例縮放 r 倍、放在樹幹頂端。
- 每個物件可以有多個材質（樹皮＋苔蘚、兩三種綠葉…），遊戲依材質拆成 InstancedMesh。

執行：bash art/tools/run.sh art/blender/forest_trees.py
"""
import math
import random

import bpy  # 一定要先載入 bpy，bmesh／mathutils 才找得到
import bmesh
import mathutils

import blender_lib as L

R = random.Random(7)
L.reset()

M = {
    'bark': L.mat('bark', '#b07a52', rough=1),
    'bark_dark': L.mat('bark_dark', '#8e5f3f', rough=1),
    'moss': L.mat('moss', '#7fbf5a', rough=1),
    'leaf_a': L.mat('leaf_a', '#7fcf6e', rough=1),
    'leaf_b': L.mat('leaf_b', '#a3dc84', rough=1),
    'leaf_c': L.mat('leaf_c', '#5fb36a', rough=1),
    'pine_a': L.mat('pine_a', '#3f9a7a', rough=1),
    'pine_b': L.mat('pine_b', '#5bb48c', rough=1),
    'vine': L.mat('vine', '#9fd67a', rough=1),
    'blossom_a': L.mat('blossom_a', '#ffb7cf', rough=1),
    'blossom_b': L.mat('blossom_b', '#ffe1ec', rough=1),
    'maple_a': L.mat('maple_a', '#f6a04d', rough=1),
    'maple_b': L.mat('maple_b', '#ffd36e', rough=1),
    'maple_c': L.mat('maple_c', '#e8683f', rough=1),
}


def new_obj(name, bm, mats, flat=True):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    for p in me.polygons:
        p.use_smooth = not flat
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


# ───────────── 樹幹 ─────────────
def trunk(style):
    """底部半徑 1、高度 1。flare＝板根、twist＝扭轉、moss＝長苔蘚、straight＝筆直細長。"""
    bm = bmesh.new()
    seg, rings = 18, 14
    twist = {'twist': 1.6, 'flare': 0.4, 'moss': 0.7, 'straight': 0.1}[style]
    top_r = {'straight': 0.5, 'twist': 0.6, 'flare': 0.58, 'moss': 0.62}[style]
    roots = {'straight': 0.25, 'twist': 0.5, 'flare': 0.9, 'moss': 0.7}[style]
    verts = []
    for j in range(rings + 1):
        t = j / rings
        row = []
        for i in range(seg):
            a = (i / seg) * math.pi * 2 + t * twist
            r = 1.0 + (top_r - 1.0) * t ** 0.8
            # 板根：底部往外張開的 6 條根
            if t < 0.2:
                k = (1 - t / 0.2) ** 2
                r += roots * k * max(0.0, math.cos(3 * a)) ** 3 + 0.15 * k
            # 樹皮的直向紋路
            r *= 1 + 0.05 * math.sin(9 * a + t * 4) + 0.03 * math.sin(23 * a)
            row.append(bm.verts.new((math.cos(a) * r, math.sin(a) * r, t)))
        verts.append(row)
    for j in range(rings):
        for i in range(seg):
            bm.faces.new((verts[j][i], verts[j][(i + 1) % seg], verts[j + 1][(i + 1) % seg], verts[j + 1][i]))
    bm.faces.new(verts[-1])
    mats = [M['bark']]
    if style == 'moss':
        # 苔蘚：兩段不規則的綠色環帶（比樹幹略大一點）
        for (t0, t1) in ((0.05, 0.22), (0.5, 0.58)):
            ring_rows = []
            for j in range(5):
                t = t0 + (t1 - t0) * j / 4
                row = []
                for i in range(seg):
                    a = (i / seg) * math.pi * 2 + t * twist
                    r = (1.0 + (top_r - 1.0) * t ** 0.8) * 1.06
                    if t < 0.2:
                        k = (1 - t / 0.2) ** 2
                        r += roots * k * max(0.0, math.cos(3 * a)) ** 3 * 1.05 + 0.15 * k
                    wob = 0.05 * math.sin(i * 1.7 + j * 2.3) + 0.03 * math.sin(i * 4.1)
                    row.append(bm.verts.new((math.cos(a) * r, math.sin(a) * r, t + wob)))
                ring_rows.append(row)
            for j in range(4):
                for i in range(seg):
                    # 只長在一部分：一塊一塊不規則的苔蘚（越上面越少）
                    if math.sin(i * 1.9 + t0 * 20) + math.sin(i * 0.7 + j * 1.3) * 0.6 < (j - 1.5) * 0.35:
                        continue
                    f = bm.faces.new((ring_rows[j][i], ring_rows[j][(i + 1) % seg], ring_rows[j + 1][(i + 1) % seg], ring_rows[j + 1][i]))
                    f.material_index = 1
        mats.append(M['moss'])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = new_obj(f'trunk_{style}', bm, mats, flat=False)
    return ob


# ───────────── 樹冠零件 ─────────────
def blob(bm, center, radius, squash=1.0, mat_index=0, lumps=0.18, subdiv=2):
    """凹凸不平的葉團（低多邊形、面塊清楚）。"""
    ret = bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=radius)
    vs = ret['verts']
    seed = R.random() * 100
    for v in vs:
        n = v.co.normalized()
        bump = 1 + lumps * (math.sin(n.x * 5 + seed) * math.sin(n.y * 4 + seed * 0.7) * math.sin(n.z * 6 + seed * 1.3))
        v.co = n * radius * bump
        v.co.z *= squash
        v.co += mathutils.Vector(center)
    faces = list({f for v in vs for f in v.link_faces})
    for f in faces:
        f.material_index = mat_index


def branch(bm, p0, p1, r0, r1, mat_index=0, seg=7):
    """從 p0 到 p1 的錐形樹枝。"""
    p0, p1 = mathutils.Vector(p0), mathutils.Vector(p1)
    d = p1 - p0
    ln = d.length
    ret = bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r0, radius2=r1, depth=ln)
    q = mathutils.Vector((0, 0, 1)).rotation_difference(d.normalized())
    for v in ret['verts']:
        v.co = q @ v.co + (p0 + p1) / 2
    for f in {f for v in ret['verts'] for f in v.link_faces}:
        f.material_index = mat_index


def cone(bm, base_z, radius, height, mat_index, seg=9, droop=0.25, twist=0.0):
    """杉樹的一層：邊緣往下垂的圓錐。"""
    ret = bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=radius, radius2=0.0, depth=height)
    for v in ret['verts']:
        v.co.z += base_z + height / 2
        if v.co.z < base_z + 0.01:
            v.co.z -= droop * radius  # 下垂的邊緣
            a = math.atan2(v.co.y, v.co.x) + twist
            rr = math.hypot(v.co.x, v.co.y) * (1 + 0.08 * math.sin(a * 5))
            v.co.x, v.co.y = math.cos(a) * rr, math.sin(a) * rr
    for f in {f for v in ret['verts'] for f in v.link_faces}:
        f.material_index = mat_index


def side_branches(bm, n, leaf_index, bark_index=0, size=0.75):
    """樹幹中段伸出來的側枝＋小葉團（以樹幹頂端為原點、往下約 3～6 個樹幹半徑）。"""
    for i in range(n):
        a = R.uniform(0, math.pi * 2)
        z = R.uniform(-6.5, -3.2)
        tip = (math.cos(a) * 2.1, math.sin(a) * 2.1, z + R.uniform(0.6, 1.2))
        branch(bm, (math.cos(a) * 0.3, math.sin(a) * 0.3, z), tip, 0.22, 0.08, bark_index, seg=6)
        blob(bm, (tip[0] * 1.1, tip[1] * 1.1, tip[2] + 0.2), size * R.uniform(0.85, 1.15), 0.8, leaf_index, subdiv=1)


def leafy_canopy(name, leaf_mats, extra=None):
    """一般的闊葉樹冠：3～4 條粗枝伸出去，枝頭各有一團葉子，中間再疊幾團。"""
    bm = bmesh.new()
    n_br = 4
    for i in range(n_br):
        a = i / n_br * math.pi * 2 + R.uniform(-0.3, 0.3)
        tip = (math.cos(a) * 2.0, math.sin(a) * 2.0, 1.2 + R.uniform(-0.3, 0.5))
        branch(bm, (0, 0, -0.6), tip, 0.42, 0.16, 0)
        blob(bm, (tip[0] * 1.05, tip[1] * 1.05, tip[2] + 0.3), R.uniform(1.4, 1.75), 0.8, 1 + i % len(leaf_mats))
    blob(bm, (0, 0, 2.3), 2.1, 0.85, 1)
    side_branches(bm, 3, 1 + 1 % len(leaf_mats))
    blob(bm, (0.5, -0.4, 3.0), 1.3, 0.85, 1 + 1 % len(leaf_mats))
    for i in range(5):
        a = R.uniform(0, math.pi * 2)
        r = R.uniform(1.0, 2.4)
        blob(bm, (math.cos(a) * r, math.sin(a) * r, R.uniform(0.9, 2.8)), R.uniform(0.9, 1.3), 0.85, 1 + (i + 2) % len(leaf_mats))
    if extra:
        extra(bm)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return new_obj(name, bm, [M['bark']] + leaf_mats)


def pine_canopy():
    bm = bmesh.new()
    branch(bm, (0, 0, -0.5), (0, 0, 4.5), 0.45, 0.12, 0)
    tiers = [(-1.0, 3.2), (0.4, 2.8), (1.7, 2.3), (2.9, 1.8), (4.0, 1.2)]
    for k, (z, r) in enumerate(tiers):
        cone(bm, z, r, r * 1.05, 1 + k % 2, seg=10, droop=0.18, twist=k * 0.3)
    cone(bm, 4.9, 0.7, 1.2, 2, seg=8, droop=0.0)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return new_obj('canopy_pine', bm, [M['bark'], M['pine_a'], M['pine_b']])


def ancient_canopy():
    """苔蘚古木：寬扁的傘狀樹冠，底下垂著一條條藤蔓。"""
    bm = bmesh.new()
    for i in range(5):
        a = i / 5 * math.pi * 2 + 0.4
        tip = (math.cos(a) * 2.6, math.sin(a) * 2.6, 0.7 + R.uniform(-0.2, 0.3))
        branch(bm, (0, 0, -0.5), tip, 0.4, 0.14, 0)
        blob(bm, (tip[0], tip[1], tip[2] + 0.4), R.uniform(1.3, 1.6), 0.55, 1 + i % 2)
    blob(bm, (0, 0, 1.3), 2.5, 0.55, 1)
    blob(bm, (0.3, 0.2, 2.0), 1.7, 0.6, 2)
    side_branches(bm, 2, 2)
    # 垂藤：從樹冠底下垂下來的細長圓錐
    for i in range(16):
        a = R.uniform(0, math.pi * 2)
        r = R.uniform(1.2, 3.2)
        top = 0.4 + R.uniform(-0.2, 0.2)
        ln = R.uniform(1.2, 2.6)
        ret = bmesh.ops.create_cone(bm, cap_ends=False, segments=5, radius1=0.0, radius2=0.12, depth=ln)
        for v in ret['verts']:
            v.co += mathutils.Vector((math.cos(a) * r, math.sin(a) * r, top - ln / 2))
        for f in {f for v in ret['verts'] for f in v.link_faces}:
            f.material_index = 3
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return new_obj('canopy_ancient', bm, [M['bark_dark'], M['leaf_c'], M['leaf_a'], M['vine']])


def add_blossom_dots(bm):
    # 櫻花：樹冠表面點綴幾團淺粉白的小花團
    for i in range(10):
        a = R.uniform(0, math.pi * 2)
        r = R.uniform(1.5, 2.8)
        blob(bm, (math.cos(a) * r, math.sin(a) * r, R.uniform(1.4, 3.2)), R.uniform(0.45, 0.7), 0.9, 2, lumps=0.1, subdiv=1)


# ───────────── 組合 ─────────────
trunks = [trunk(s) for s in ('flare', 'straight', 'moss', 'twist')]
canopies = [
    leafy_canopy('canopy_oak', [M['leaf_a'], M['leaf_b'], M['leaf_c']]),
    pine_canopy(),
    ancient_canopy(),
    leafy_canopy('canopy_blossom', [M['blossom_a'], M['blossom_b']], add_blossom_dots),
    leafy_canopy('canopy_maple', [M['maple_a'], M['maple_b'], M['maple_c']]),
]
for o in trunks + canopies:
    o.data.validate()

L.save('forest_trees')
glb = L.export('forest_trees')

# 預覽：依遊戲裡的比例擺出 5 棵樹（樹幹半徑 5、高 70）
VARIANTS = [('flare', 'oak'), ('straight', 'pine'), ('moss', 'ancient'), ('twist', 'blossom'), ('flare', 'maple')]
r, h = 5.0, 70.0
for i, (ts, cn) in enumerate(VARIANTS):
    x = (i - 2) * 42
    t = bpy.data.objects[f'trunk_{ts}'].copy()
    t.data = t.data.copy()
    bpy.context.scene.collection.objects.link(t)
    t.scale = (r, r, h)
    t.location = (x, 0, 0)
    c = bpy.data.objects[f'canopy_{cn}'].copy()
    bpy.context.scene.collection.objects.link(c)
    c.scale = (r, r, r)
    c.location = (x, 0, h)
for o in trunks + canopies:
    o.hide_render = True
bpy.ops.mesh.primitive_plane_add(size=260, location=(0, 0, 0))
L.assign(bpy.context.object, L.mat('ground', '#b5dc96'))
pics = L.preview('forest_trees', views=('front', 'three'), size=900, samples=10)
tris = sum(len(o.data.polygons) for o in trunks + canopies)
import os
print(f'[forest_trees] 多邊形（5 種樹冠＋4 種樹幹，原始尺寸）{tris}，glb {os.path.getsize(glb) / 1024:.0f} KB')
for p in pics:
    print('[forest_trees] 預覽:', p)
