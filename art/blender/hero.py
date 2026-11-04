"""
主角（Q 版、約 3 頭身、身高約 1.6m）。造型沿用遊戲裡的設定：鳳眼、刺刺頭、紅圍巾、綠披風、
棕色短夾克＋白襯衫、白褲、棕長靴、皮帶束具、立體機動裝置（腰後氣罐、大腿刀箱、腰側發射器、雙刀）。

座標：Z 朝上、臉朝 -Y、腳底 Z=0。每個零件一個物件（名稱＝部位），材質名稱照 art/README.md。
這一版是靜態造型（給你確認長相），骨架與動作確認造型後再做。

執行：bash art/tools/run.sh art/blender/hero.py
"""
import math
import os

import bpy  # 一定要先載入 bpy，bmesh／mathutils 才找得到
import bmesh
from mathutils import Vector, Quaternion

import blender_lib as L

L.reset()
COL = bpy.context.scene.collection

M = {
    'skin': L.mat('skin', '#ffdcc4', rough=0.7),
    'hair': L.mat('hair', '#5b3a28', rough=0.8),
    'eye_white': L.mat('eye_white', '#ffffff', rough=0.4),
    'iris': L.mat('iris', '#2f9fbf', rough=0.3, emit=('#2f9fbf', 0.3)),
    'eye_dark': L.mat('eye_dark', '#2a2638', rough=0.5),
    'jacket': L.mat('jacket', '#d99a5f', rough=0.85),
    'shirt': L.mat('shirt', '#fbf6ec', rough=0.9),
    'pants': L.mat('pants', '#fff3df', rough=0.9),
    'boots': L.mat('boots', '#7a4e35', rough=0.6),
    'leather': L.mat('leather', '#3a2a1e', rough=0.7),
    'cape': L.mat('cape', '#6cc39a', rough=0.9),
    'emblem': L.mat('emblem', '#ffffff', rough=0.9),
    'scarf': L.mat('scarf', '#ee5d5d', rough=0.85),
    'metal': L.mat('metal', '#b9c2cc', rough=0.3, metal=0.85),
    'dark_metal': L.mat('dark_metal', '#4d555e', rough=0.4, metal=0.7),
    'blade': L.mat('blade', '#eef4fa', rough=0.15, metal=0.95),
}


# ───────────── 基本形狀 ─────────────
def mesh_obj(name, bm, mat, smooth=True):
    me = bpy.data.meshes.new(name)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    for p in me.polygons:
        p.use_smooth = smooth
    ob = bpy.data.objects.new(name, me)
    COL.objects.link(ob)
    return ob


def ellipsoid(name, center, radii, mat, seg=14, rings=8, rot=None, smooth=True):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=1.0)
    q = rot or Quaternion()
    for v in bm.verts:
        v.co = q @ Vector((v.co.x * radii[0], v.co.y * radii[1], v.co.z * radii[2])) + Vector(center)
    return mesh_obj(name, bm, mat, smooth)


def tube(name, p0, p1, r0, r1, mat, seg=10, caps=True):
    """圓錐管（兩端可加半球帽），拿來做手臂、腿、樹枝、皮帶。"""
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    if max(r0, r1) < 0.02:
        seg = min(seg, 6)  # 細線（眼皮、眉毛、皮帶）用很少的面就夠了
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=not caps, segments=seg, radius1=r0, radius2=r1, depth=d.length)
    q = Vector((0, 0, 1)).rotation_difference(d.normalized())
    for v in bm.verts:
        v.co = q @ v.co + (p0 + p1) / 2
    if caps:
        for c, r in ((p0, r0), (p1, r1)):
            ret = bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=3 if seg <= 6 else max(4, seg // 3), radius=r)
            for v in ret['verts']:
                v.co += c
    return mesh_obj(name, bm, mat)


def box(name, center, size, mat, rot=None, bevel=0.01):
    bpy.ops.mesh.primitive_cube_add(size=1, location=center)
    ob = bpy.context.object
    ob.name = name
    ob.scale = size
    if rot:
        ob.rotation_mode = 'QUATERNION'
        ob.rotation_quaternion = rot
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    if bevel:
        mod = ob.modifiers.new('bevel', 'BEVEL')
        mod.width = bevel
        mod.segments = 1
    L.assign(ob, mat)
    return ob


def torus(name, center, R, r, mat, rot=None, scale=(1, 1, 1), seg=14, minor=4):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, major_segments=seg, minor_segments=minor, location=center)
    ob = bpy.context.object
    ob.name = name
    ob.scale = scale
    if rot:
        ob.rotation_mode = 'QUATERNION'
        ob.rotation_quaternion = rot
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    L.assign(ob, mat)
    L.smooth(ob)
    return ob


def look_quat(direction, roll=0.0):
    """讓物件的 +Z 指向 direction（臉上零件貼在頭的表面用）。"""
    q = Vector((0, 0, 1)).rotation_difference(Vector(direction).normalized())
    return q @ Quaternion((0, 0, 1), roll)


# ───────────── 比例（公尺） ─────────────
HEAD_C = Vector((0, 0, 1.31))
HEAD_R = 0.245
SH_Z = 0.98  # 肩膀高度
HIP_Z = 0.6


# ───────────── 頭 ─────────────
def head():
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=28, v_segments=16, radius=HEAD_R)
    for v in bm.verts:
        x, y, z = v.co
        # 下巴微尖、臉頰略寬、後腦勺圓
        if z < 0:
            k = (-z / HEAD_R) ** 2
            x *= 1 - 0.18 * k
            y *= 1 - 0.1 * k
        x *= 1.04
        y *= 0.97
        v.co = Vector((x, y, z)) + HEAD_C
    ob = mesh_obj('head', bm, M['skin'])
    # 耳朵
    for sx in (-1, 1):
        ellipsoid(f'ear_{"L" if sx > 0 else "R"}', HEAD_C + Vector((sx * 0.245, 0.01, -0.02)), (0.03, 0.05, 0.065), M['skin'], seg=8, rings=6)
    # 脖子
    tube('neck', (0, 0.01, 1.02), (0, 0.01, 1.12), 0.06, 0.055, M['skin'], seg=14)
    return ob


def on_head(h, v, depth=0.0):
    """頭表面上的一點：h＝左右角度（右正）、v＝上下角度（上正），回傳（位置, 法線）。"""
    d = Vector((math.sin(h) * math.cos(v), -math.cos(h) * math.cos(v), math.sin(v))).normalized()
    p = HEAD_C + Vector((d.x * HEAD_R * 1.04, d.y * HEAD_R * 0.97, d.z * HEAD_R)) * (1 + depth)
    return p, d


def face():
    for sx, side in ((1, 'L'), (-1, 'R')):  # +X＝角色的左邊
        h = sx * 0.4
        tilt = sx * 0.28  # 鳳眼：眼尾上挑
        p, d = on_head(h, 0.02, 0.0)
        q = look_quat(d, tilt)
        ellipsoid(f'eye_white_{side}', p, (0.058, 0.026, 0.012), M['eye_white'], seg=14, rings=6, rot=q)
        p2, _ = on_head(h - sx * 0.03, 0.0, 0.035)
        ellipsoid(f'iris_{side}', p2, (0.024, 0.022, 0.008), M['iris'], seg=10, rings=6, rot=q)
        p3, _ = on_head(h - sx * 0.03, 0.0, 0.055)
        ellipsoid(f'pupil_{side}', p3, (0.008, 0.018, 0.005), M['eye_dark'], seg=8, rings=4, rot=q)
        p4, _ = on_head(h + sx * 0.0, 0.05, 0.065)
        ellipsoid(f'eye_light_{side}', p4, (0.007, 0.007, 0.004), M['eye_white'], seg=6, rings=4)
        # 上眼皮：粗黑線，眼尾往上翹出一撇
        a, _ = on_head(h - sx * 0.2, 0.07, 0.04)
        b, _ = on_head(h + sx * 0.15, 0.1, 0.04)
        c, _ = on_head(h + sx * 0.22, 0.15, 0.03)
        tube(f'lid_{side}', a, b, 0.008, 0.011, M['eye_dark'], seg=8)
        tube(f'lid_wing_{side}', b, c, 0.01, 0.004, M['eye_dark'], seg=8)
        # 眉毛：眼頭低、眼尾高（兇）
        e, _ = on_head(h - sx * 0.17, 0.2, 0.05)
        f, _ = on_head(h + sx * 0.17, 0.27, 0.05)
        tube(f'brow_{side}', e, f, 0.013, 0.008, M['hair'], seg=8)
    # 鼻子、嘴巴（抿嘴、一邊嘴角微揚）
    p, _ = on_head(0, -0.12, 0.02)
    ellipsoid('nose', p, (0.012, 0.012, 0.01), M['skin'], seg=10, rings=6)
    a, _ = on_head(-0.12, -0.33, 0.01)
    b, _ = on_head(0.08, -0.32, 0.01)
    c, _ = on_head(0.15, -0.28, 0.01)
    tube('mouth', a, b, 0.0055, 0.0055, M['eye_dark'], seg=6)
    tube('mouth_corner', b, c, 0.005, 0.004, M['eye_dark'], seg=6)


def hair():
    # 髮帽：比頭大一點，前面髮際線高、後面低到後頸
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=28, v_segments=16, radius=HEAD_R * 1.07)
    kill = []
    for v in bm.verts:
        n = v.co.normalized()
        front = max(0.0, -n.y)  # 1＝正前方
        line = -0.62 + 0.75 * front  # 髮際線（以 z/半徑表示）：後面低、前面高
        if n.z < line:
            kill.append(v)
        v.co = Vector((v.co.x * 1.04, v.co.y * 0.98, v.co.z)) + HEAD_C + Vector((0, 0.01, 0.015))
    bmesh.ops.delete(bm, geom=kill, context='VERTS')
    mesh_obj('hair_cap', bm, M['hair'])

    def lock(name, base, direction, length, radius, bend=(0, 0, 0), flat=0.7):
        """一撮頭髮：錐形，尖端往 bend 方向彎。"""
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=7, radius1=radius, radius2=0.0, depth=length)
        dirv = Vector(direction).normalized()
        q = Vector((0, 0, 1)).rotation_difference(dirv)
        bend = Vector(bend)
        for v in bm.verts:
            t = (v.co.z + length / 2) / length  # 0 根部～1 尖端
            loc = Vector((v.co.x, v.co.y * flat, v.co.z + length / 2))
            v.co = q @ loc + bend * (t * t) + Vector(base)
        mesh_obj(name, bm, M['hair'])

    # 瀏海：五撮往下、往前，中間最長，左右交錯
    for i, (x, ln, sw) in enumerate([(-0.15, 0.17, -0.5), (-0.08, 0.2, -0.2), (0.0, 0.22, 0.1), (0.08, 0.19, 0.3), (0.15, 0.16, 0.55)]):
        lock(f'bang_{i}', HEAD_C + Vector((x, -0.2, 0.17)), (sw * 0.4 + x * 2, -0.55, -1), ln, 0.055, bend=(0, -0.03, 0))
    # 鬢角
    for sx in (-1, 1):
        lock(f'side_{sx}_0', HEAD_C + Vector((sx * 0.23, -0.08, 0.1)), (sx * 0.25, -0.2, -1), 0.2, 0.05)
        lock(f'side_{sx}_1', HEAD_C + Vector((sx * 0.24, 0.05, 0.08)), (sx * 0.35, 0.2, -1), 0.17, 0.05)
    # 頭頂刺刺（往後翹）
    for i, (x, y, ln) in enumerate([(-0.1, 0.02, 0.2), (0.1, 0.02, 0.2), (0.0, 0.07, 0.23), (-0.14, 0.12, 0.18), (0.14, 0.12, 0.18), (0.0, 0.17, 0.2)]):
        lock(f'top_{i}', HEAD_C + Vector((x, y, 0.2)), (x * 3, 0.9 + y * 2, 0.75), ln, 0.07, bend=(0, 0.04, -0.02))
    # 後腦髮尾
    for i, x in enumerate([-0.14, -0.05, 0.05, 0.14]):
        lock(f'back_{i}', HEAD_C + Vector((x, 0.2, 0.0)), (x * 2, 0.6, -1), 0.16, 0.055, bend=(0, 0.05, 0))
    # 呆毛
    lock('ahoge', HEAD_C + Vector((0.02, -0.02, 0.26)), (0.1, -0.6, 1), 0.13, 0.022, bend=(0, -0.05, -0.02), flat=1)


# ───────────── 身體 ─────────────
def body():
    # 軀幹（白襯衫）＋短夾克（前面敞開露出襯衫）
    ellipsoid('torso', (0, 0.0, 0.81), (0.175, 0.125, 0.22), M['shirt'], seg=24, rings=14)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=28, v_segments=14, radius=1.0)
    kill = [v for v in bm.verts if (v.co.y < -0.55 and abs(v.co.x) < 0.32) or v.co.z < -0.45]  # 前襟敞開、下襬到腰
    bmesh.ops.delete(bm, geom=kill, context='VERTS')
    for v in bm.verts:
        v.co = Vector((v.co.x * 0.19, v.co.y * 0.14, v.co.z * 0.22)) + Vector((0, 0.003, 0.85))
    jk = mesh_obj('jacket', bm, M['jacket'])
    mod = jk.modifiers.new('solid', 'SOLIDIFY')
    mod.thickness = 0.012
    # 翻領
    for sx in (-1, 1):
        box(f'collar_{sx}', (sx * 0.075, -0.115, 0.99), (0.07, 0.02, 0.07), M['jacket'], rot=Quaternion((0, 1, 0), -sx * 0.5) @ Quaternion((1, 0, 0), 0.35))
    # 骨盆／褲子
    ellipsoid('hips', (0, 0.01, 0.62), (0.165, 0.12, 0.1), M['pants'], seg=22, rings=12)
    # 腿：大腿（白褲）＋長靴
    for sx, side in ((1, 'L'), (-1, 'R')):
        tube(f'thigh_{side}', (sx * 0.085, 0.01, 0.6), (sx * 0.095, 0.0, 0.34), 0.085, 0.07, M['pants'])
        tube(f'boot_{side}', (sx * 0.095, 0.0, 0.33), (sx * 0.1, 0.01, 0.07), 0.075, 0.065, M['boots'])
        torus(f'boot_cuff_{side}', (sx * 0.095, 0.0, 0.31), 0.074, 0.018, M['boots'])
        ellipsoid(f'foot_{side}', (sx * 0.1, -0.05, 0.045), (0.07, 0.12, 0.05), M['boots'], seg=16, rings=10)
        # 大腿綁帶
        for z in (0.52, 0.42):
            torus(f'thigh_strap_{side}_{int(z * 100)}', (sx * 0.09, 0.005, z), 0.083, 0.011, M['leather'])
    # 手臂：袖子（夾克色）＋手
    for sx, side in ((1, 'L'), (-1, 'R')):
        sh = Vector((sx * 0.2, 0.0, SH_Z))
        el = Vector((sx * 0.27, 0.03, 0.77))
        wr = Vector((sx * 0.3, -0.02, 0.6))
        ellipsoid(f'shoulder_{side}', sh, (0.07, 0.07, 0.065), M['jacket'], seg=16, rings=10)
        tube(f'upperarm_{side}', sh, el, 0.058, 0.05, M['jacket'])
        tube(f'forearm_{side}', el, wr, 0.05, 0.042, M['jacket'])
        torus(f'cuff_{side}', wr + Vector((0, 0, 0.01)), 0.043, 0.012, M['shirt'], rot=look_quat(wr - el))
        ellipsoid(f'hand_{side}', wr + Vector((sx * 0.005, -0.01, -0.045)), (0.042, 0.045, 0.05), M['skin'], seg=14, rings=10)


def harness():
    # 胸前 X 字皮帶、腰帶、背後的 X
    for sx in (-1, 1):
        tube(f'strap_front_{sx}', (sx * 0.12, -0.11, 1.0), (-sx * 0.12, -0.12, 0.68), 0.012, 0.012, M['leather'], seg=8)
        tube(f'strap_back_{sx}', (sx * 0.12, 0.12, 1.0), (-sx * 0.12, 0.13, 0.68), 0.012, 0.012, M['leather'], seg=8)
    torus('belt', (0, 0.005, 0.67), 0.17, 0.02, M['leather'], scale=(1.0, 0.74, 1))
    box('buckle', (0, -0.128, 0.67), (0.045, 0.012, 0.035), M['metal'], bevel=0.004)


def odm_gear():
    for sx, side in ((1, 'L'), (-1, 'R')):
        # 腰後兩側的氣罐（往後伸）
        tube(f'tank_{side}', (sx * 0.17, 0.1, 0.68), (sx * 0.19, 0.42, 0.66), 0.055, 0.055, M['metal'], seg=12)
        tube(f'valve_{side}', (sx * 0.18, 0.3, 0.72), (sx * 0.18, 0.3, 0.77), 0.012, 0.012, M['dark_metal'], seg=8)
        # 大腿外側的刀箱
        box(f'blade_box_{side}', (sx * 0.2, 0.05, 0.47), (0.07, 0.34, 0.15), M['dark_metal'], bevel=0.012)
        box(f'blade_box_strap_{side}', (sx * 0.2, 0.05, 0.47), (0.075, 0.035, 0.155), M['leather'], bevel=0.004)
        # 腰側的鋼索發射器
        box(f'launcher_{side}', (sx * 0.19, -0.04, 0.66), (0.06, 0.12, 0.07), M['metal'], bevel=0.01)
        tube(f'launcher_nozzle_{side}', (sx * 0.19, -0.1, 0.66), (sx * 0.19, -0.14, 0.66), 0.018, 0.014, M['dark_metal'], seg=10)
        L.empty(f'launcher_{side}_tip', (sx * 0.19, -0.15, 0.66))
    # 腰後的主機（捲索器）
    box('odm_core', (0, 0.15, 0.66), (0.16, 0.08, 0.09), M['metal'], bevel=0.012)
    for sx in (-1, 1):
        tube(f'reel_{sx}', (sx * 0.05, 0.19, 0.66), (sx * 0.05, 0.21, 0.66), 0.035, 0.035, M['dark_metal'], seg=14, caps=False)
    L.empty('nozzle', (0, 0.22, 0.64))
    # 握把＋刀（刀尖朝後下）
    for sx, side in ((1, 'L'), (-1, 'R')):
        hand = Vector((sx * 0.305, -0.03, 0.555))
        tube(f'grip_{side}', hand + Vector((0, 0.0, 0.04)), hand + Vector((0, 0.0, -0.05)), 0.016, 0.016, M['dark_metal'], seg=10)
        box(f'guard_{side}', hand + Vector((0, 0.0, -0.06)), (0.04, 0.05, 0.018), M['metal'], bevel=0.004)
        d = Vector((sx * 0.08, 0.4, -1)).normalized()
        base = hand + Vector((0, 0, -0.07))
        tip = base + d * 0.72
        q = Vector((0, 0, -1)).rotation_difference(d)
        box(f'blade_{side}', (base + tip) / 2, (0.012, 0.045, 0.72), M['blade'], rot=q, bevel=0.002)
        L.empty(f'blade_{side}', tip)


def cape_and_scarf():
    # 披風：從肩膀垂到膝蓋上方，上窄下寬，往後微微鼓起
    bm = bmesh.new()
    cols, rows = 12, 10
    grid = []
    for j in range(rows + 1):
        t = j / rows  # 0 上～1 下
        z = 1.0 - t * 0.66
        half = 0.17 + 0.2 * t
        row = []
        for i in range(cols + 1):
            u = i / cols * 2 - 1
            x = u * half
            # 往後鼓起、蓋過腰後的氣罐（上段貼背，腰的高度往後撐開）
            back = 0.15 + 0.32 * min(1.0, t / 0.5) ** 1.5
            y = back + 0.035 * (1 - u * u) + 0.012 * math.sin(u * 7 + t * 4) * t
            if t > 0.95:
                z += 0.03 * abs(u)  # 下襬兩角往內收
            row.append(bm.verts.new((x, y, z)))
        grid.append(row)
    for j in range(rows):
        for i in range(cols):
            bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
    cp = mesh_obj('cape', bm, M['cape'])
    mod = cp.modifiers.new('solid', 'SOLIDIFY')
    mod.thickness = 0.012
    # 背上的徽章（原創：一片白色的葉子）
    # 徽章貼在披風背面（披風在這個高度大約往後 0.3m）
    q = Quaternion((1, 0, 0), -0.45) @ Quaternion((0, 1, 0), 0.4)
    ellipsoid('emblem', (0, 0.375, 0.8), (0.055, 0.006, 0.09), M['emblem'], seg=14, rings=8, rot=q)
    # 圍巾：脖子一圈＋往後飄的兩條尾巴
    torus('scarf', (0, 0.0, 1.07), 0.105, 0.042, M['scarf'], scale=(1, 0.92, 0.8), seg=20, minor=8)  # 圍巾離鏡頭近，圓一點
    for k, (x, ln, ang) in enumerate([(0.06, 0.3, 0.9), (-0.02, 0.24, 0.7)]):
        d = Vector((x * 1.5, 1, -ang)).normalized()
        a = Vector((x, 0.1, 1.05))
        b = a + d * ln
        q = Vector((0, 0, -1)).rotation_difference(d)
        box(f'scarf_tail_{k}', (a + b) / 2, (0.08 - k * 0.012, 0.018, ln), M['scarf'], rot=q, bevel=0.008)


head()
face()
hair()
body()
harness()
odm_gear()
cape_and_scarf()

# 平滑一點（手臂、腿、頭用平滑著色；箱子保持銳利）
for o in COL.objects:
    if o.type == 'MESH' and not o.name.startswith(('blade_box', 'launcher', 'odm_core', 'buckle', 'guard', 'collar', 'scarf_tail', 'blade_')):
        o.data.shade_smooth() if hasattr(o.data, 'shade_smooth') else None

L.save('hero')
glb = L.export('hero')
pics = L.preview('hero', size=640, samples=16)

# 臉部特寫
sc = bpy.context.scene
cam = bpy.data.objects.new('_face', bpy.data.cameras.new('_face'))
cam.data.type = 'ORTHO'
cam.data.ortho_scale = 0.75
COL.objects.link(cam)
sc.camera = cam
sun = bpy.data.objects.new('_sun2', bpy.data.lights.new('_sun2', 'SUN'))
sun.data.energy = 3.0
sun.data.angle = math.radians(18)
sun.rotation_euler = (math.radians(55), 0, math.radians(25))
COL.objects.link(sun)
for nm, d in (('face', Vector((0, -1, 0.05))), ('face34', Vector((0.7, -0.8, 0.12)))):
    d.normalize()
    cam.location = HEAD_C + Vector((0, 0, -0.05)) + d * 3
    cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = os.path.join(L.OUT_PREVIEW, f'hero-{nm}.png')
    bpy.ops.render.render(write_still=True)
    pics.append(sc.render.filepath)
print(f'[hero] 三角面 {L.stats()}、glb {os.path.getsize(glb) / 1024:.0f} KB')
for p in pics:
    print('[hero] 預覽:', p)
