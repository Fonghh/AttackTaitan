"""
主角 v2（寫實動漫比例，約 7 頭身、身高約 1.65m）。原創角色，造型方向參考使用者給的人偶照：
深色旁分短髮（兩側推短）、細長的冷峻眼神、棕色短版皮夾克＋白襯衫、包住肩膀並在胸前扣起的綠色斗篷、
腰間深色布腰封、胸前與腿上交叉的皮帶束具、過膝長靴、大腿兩側的大刀箱、腰側捲索器、長刀。

座標：Z 朝上、臉朝 -Y、腳底 Z=0。每個零件一個物件（名稱＝部位），材質名稱照 art/README.md。
這一版是靜態造型（給你確認長相），骨架與動作確認造型後再做。上一版（Q 版）在 git 歷史裡。

執行：bash art/tools/run.sh art/blender/hero.py
"""
import math
import os

import bpy  # 一定要先載入 bpy，bmesh／mathutils 才找得到
import bmesh
from mathutils import Vector, Quaternion

import blender_lib as L
from shapes import ellipsoid, tube, box, torus, look_quat, mesh_obj

L.reset()
COL = bpy.context.scene.collection

M = {
    'skin': L.mat('skin', '#f4d8c6', rough=0.7),
    'hair': L.mat('hair', '#2b2524', rough=0.6),
    'eye_white': L.mat('eye_white', '#f8f6f2', rough=0.4),
    'iris': L.mat('iris', '#55667a', rough=0.3),
    'eye_dark': L.mat('eye_dark', '#1c1a1f', rough=0.5),
    'jacket': L.mat('jacket', '#8c5634', rough=0.75),
    'shirt': L.mat('shirt', '#f1eee7', rough=0.9),
    'pants': L.mat('pants', '#ebe5d8', rough=0.9),
    'boots': L.mat('boots', '#5c3b27', rough=0.55),
    'leather': L.mat('leather', '#5a3425', rough=0.7),
    'wrap': L.mat('wrap', '#3f2b23', rough=0.9),
    'cape': L.mat('cape', '#2f7048', rough=0.85),
    'metal': L.mat('metal', '#b9c2cc', rough=0.3, metal=0.85),
    'dark_metal': L.mat('dark_metal', '#4d555e', rough=0.4, metal=0.7),
    'box_metal': L.mat('box_metal', '#7f8c86', rough=0.45, metal=0.6),
    'blade': L.mat('blade', '#e9eef3', rough=0.15, metal=0.95),
}

# ───────────── 比例（公尺） ─────────────
HEAD_C = Vector((0, 0, 1.53))
HR = 0.105  # 頭的半徑
SH_Z = 1.34  # 肩膀


def curve_tube(name, pts, r0, r1, mat, seg=6):
    """沿著幾個點的細管（皮帶、眼線）：一段一段接起來。"""
    for i in range(len(pts) - 1):
        k0 = i / (len(pts) - 1)
        k1 = (i + 1) / (len(pts) - 1)
        tube(f'{name}_{i}', pts[i], pts[i + 1], r0 + (r1 - r0) * k0, r0 + (r1 - r0) * k1, mat, seg=seg)


# ───────────── 頭與臉 ─────────────
def head():
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=28, v_segments=18, radius=HR)
    for v in bm.verts:
        x, y, z = v.co
        z *= 1.12  # 臉比較長
        if z < 0:
            k = (-z / (HR * 1.12)) ** 1.6
            x *= 1 - 0.32 * k  # 下巴尖
            y *= 1 - 0.12 * k
            if y < 0:
                y -= 0.008 * k  # 下巴略往前
        x *= 0.92
        y *= 0.95
        v.co = Vector((x, y, z)) + HEAD_C
    mesh_obj('head', bm, M['skin'])
    for sx, side in ((1, 'L'), (-1, 'R')):
        ellipsoid(f'ear_{side}', HEAD_C + Vector((sx * 0.094, 0.01, -0.01)), (0.012, 0.022, 0.03), M['skin'], seg=8, rings=6)
    tube('neck', (0, 0.005, 1.38), (0, 0.005, 1.47), 0.043, 0.04, M['skin'], seg=12)


def on_head(h, v, out=0.0):
    """頭表面上的一點（h＝左右、v＝上下，弧度），回傳（位置, 法線）。"""
    d = Vector((math.sin(h) * math.cos(v), -math.cos(h) * math.cos(v), math.sin(v))).normalized()
    p = HEAD_C + Vector((d.x * HR * 0.92, d.y * HR * 0.95, d.z * HR * 1.12)) * (1 + out)
    return p, d


def face():
    for sx, side in ((1, 'L'), (-1, 'R')):
        h = sx * 0.36
        tilt = sx * 0.12  # 眼尾微微上挑
        p, d = on_head(h, 0.04)
        q = look_quat(d, tilt)
        ellipsoid(f'eye_white_{side}', p, (0.022, 0.0085, 0.006), M['eye_white'], seg=12, rings=6, rot=q)
        p2, _ = on_head(h - sx * 0.02, 0.035, 0.045)
        ellipsoid(f'iris_{side}', p2, (0.0085, 0.0082, 0.004), M['iris'], seg=10, rings=6, rot=q)
        p3, _ = on_head(h - sx * 0.02, 0.035, 0.07)
        ellipsoid(f'pupil_{side}', p3, (0.004, 0.005, 0.0025), M['eye_dark'], seg=8, rings=4, rot=q)
        # 上眼線：細長、眼尾略長（冷峻的半垂眼）
        a, _ = on_head(h - sx * 0.2, 0.07, 0.05)
        b, _ = on_head(h + sx * 0.06, 0.085, 0.05)
        c, _ = on_head(h + sx * 0.22, 0.075, 0.04)
        curve_tube(f'lid_{side}', [a, b, c], 0.0028, 0.0018, M['eye_dark'])
        # 眉毛：平直、眉頭微壓
        e, _ = on_head(h - sx * 0.2, 0.17, 0.05)
        f, _ = on_head(h + sx * 0.2, 0.2, 0.05)
        tube(f'brow_{side}', e, f, 0.0045, 0.003, M['hair'], seg=6)
    # 鼻樑與鼻尖（側面才看得出來）、嘴
    a, _ = on_head(0, 0.02, 0.02)
    b, _ = on_head(0, -0.14, 0.08)
    tube('nose', a, b, 0.006, 0.008, M['skin'], seg=8)
    a, _ = on_head(-0.1, -0.36, 0.01)
    b, _ = on_head(0.1, -0.36, 0.01)
    tube('mouth', a, b, 0.0022, 0.0022, M['eye_dark'], seg=6)


def hair():
    # 兩側與後腦推短：貼著頭的薄殼（髮際線在耳朵上方、後腦到頸部）
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=28, v_segments=16, radius=HR * 1.05)
    kill = []
    for v in bm.verts:
        n = v.co.normalized()
        front = max(0.0, -n.y)
        if n.z < -0.55 + 0.85 * front or (front > 0.6 and n.z < 0.45):
            kill.append(v)
        v.co = Vector((v.co.x * 0.93, v.co.y * 0.96, v.co.z * 1.12)) + HEAD_C + Vector((0, 0.004, 0.006))
    bmesh.ops.delete(bm, geom=kill, context='VERTS')
    mesh_obj('hair_under', bm, M['hair'])
    # 上層：頭頂一層較厚的頭髮（蓋住推短的部分上緣）
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=28, v_segments=16, radius=HR * 1.1)
    kill = []
    for v in bm.verts:
        n = v.co.normalized()
        front = max(0.0, -n.y)
        back = max(0.0, n.y)
        if n.z < 0.1 + 0.35 * front - 0.35 * back:
            kill.append(v)
        v.co = Vector((v.co.x * 0.93, v.co.y * 0.97, v.co.z * 0.98)) + HEAD_C + Vector((0, 0.004, 0.018))
    bmesh.ops.delete(bm, geom=kill, context='VERTS')
    mesh_obj('hair_top', bm, M['hair'])

    def lock(name, base, direction, length, width, bend=(0, 0, 0), thick=0.45):
        """一撮扁平、尖端彎曲的髮束。"""
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=8, radius1=width, radius2=0.0, depth=length)
        dirv = Vector(direction).normalized()
        q = Vector((0, 0, 1)).rotation_difference(dirv)
        bend = Vector(bend)
        for v in bm.verts:
            t = (v.co.z + length / 2) / length
            loc = Vector((v.co.x, v.co.y * thick, v.co.z + length / 2))
            v.co = q @ loc + bend * (t * t) + Vector(base)
        mesh_obj(name, bm, M['hair'])

    # 旁分的瀏海：從頭頂中間往兩側垂下、蓋到眉毛（左邊多、右邊少）
    for i, (h, sx, ln, w) in enumerate([(-0.05, -1, 0.1, 0.04), (-0.25, -1, 0.095, 0.038), (-0.48, -1, 0.085, 0.035), (-0.7, -1, 0.07, 0.03),
                                        (0.12, 1, 0.09, 0.038), (0.35, 1, 0.08, 0.035), (0.6, 1, 0.065, 0.03)]):
        base, d = on_head(h, 0.62, 0.1)
        lock(f'bang_{i}', base, (sx * 0.35 + d.x * 0.3, d.y * 0.5 - 0.2, -1), ln, w, bend=(sx * 0.01, -0.018, 0), thick=0.26)
    # 兩鬢垂下的長髮束
    for sx in (-1, 1):
        lock(f'side_{sx}', HEAD_C + Vector((sx * 0.082, -0.04, 0.06)), (sx * 0.08, -0.15, -1), 0.1, 0.022, bend=(0, -0.008, 0))
    # 頭頂往後梳的層次
    for i, (x, y) in enumerate([(-0.05, 0.0), (0.0, 0.01), (0.05, 0.0), (-0.035, 0.05), (0.035, 0.05), (0.0, 0.07)]):
        lock(f'top_{i}', HEAD_C + Vector((x * 0.9, y - 0.02, 0.105)), (x * 2, 1, -0.7), 0.09, 0.034, bend=(0, 0, -0.01), thick=0.28)


# ───────────── 身體 ─────────────
def body():
    # 襯衫（胸、腰）與鈕扣、高領
    ellipsoid('chest', (0, 0, 1.2), (0.155, 0.105, 0.16), M['shirt'], seg=20, rings=12)
    ellipsoid('waist', (0, 0.005, 1.03), (0.13, 0.092, 0.12), M['shirt'], seg=18, rings=10)
    for i in range(5):
        ellipsoid(f'button_{i}', (0, -0.104 + i * 0.002, 1.31 - i * 0.065), (0.006, 0.003, 0.006), M['metal'], seg=6, rings=4)
    tube('shirt_collar', (0, 0.005, 1.36), (0, 0.005, 1.4), 0.052, 0.05, M['shirt'], seg=14, caps=False)
    # 短版皮夾克：只到胸口下方，前襟敞開
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=26, v_segments=14, radius=1.0)
    kill = [v for v in bm.verts if (v.co.y < -0.5 and abs(v.co.x) < 0.42) or v.co.z < -0.38 or v.co.z > 0.92]
    bmesh.ops.delete(bm, geom=kill, context='VERTS')
    for v in bm.verts:
        v.co = Vector((v.co.x * 0.168, v.co.y * 0.118, v.co.z * 0.17)) + Vector((0, 0.002, 1.22))
    jk = mesh_obj('jacket', bm, M['jacket'])
    jk.modifiers.new('solid', 'SOLIDIFY').thickness = 0.01
    for sx in (-1, 1):
        box(f'lapel_{sx}', (sx * 0.06, -0.105, 1.3), (0.045, 0.012, 0.1), M['jacket'], rot=Quaternion((0, 1, 0), sx * 0.25) @ Quaternion((1, 0, 0), 0.25), bevel=0.004)
    # 腰封（深色布，綁兩圈）＋皮帶
    ellipsoid('wrap', (0, 0.006, 0.95), (0.142, 0.103, 0.075), M['wrap'], seg=20, rings=8)
    torus('wrap_knot', (-0.06, -0.098, 0.93), 0.022, 0.009, M['wrap'], rot=Quaternion((1, 0, 0), math.pi / 2), seg=10, minor=4)
    torus('belt', (0, 0.006, 1.01), 0.137, 0.015, M['leather'], scale=(1, 0.74, 1), seg=20, minor=4)
    box('buckle', (0, -0.1, 1.01), (0.04, 0.008, 0.03), M['metal'], bevel=0.003)
    # 骨盆／褲子
    ellipsoid('hips', (0, 0.01, 0.88), (0.145, 0.1, 0.1), M['pants'], seg=18, rings=10)
    # 腿：大腿（白褲）＋過膝長靴（膝蓋上方反摺）
    for sx, side in ((1, 'L'), (-1, 'R')):
        tube(f'thigh_{side}', (sx * 0.08, 0.01, 0.87), (sx * 0.092, 0.0, 0.5), 0.072, 0.055, M['pants'])
        tube(f'boot_{side}', (sx * 0.093, 0.0, 0.58), (sx * 0.1, 0.01, 0.07), 0.062, 0.045, M['boots'])
        torus(f'boot_top_{side}', (sx * 0.093, 0.0, 0.57), 0.063, 0.014, M['boots'], seg=12, minor=4)
        ellipsoid(f'foot_{side}', (sx * 0.1, -0.055, 0.04), (0.05, 0.12, 0.042), M['boots'], seg=12, rings=8)
        ellipsoid(f'heel_{side}', (sx * 0.1, 0.03, 0.025), (0.042, 0.045, 0.028), M['boots'], seg=10, rings=6)
    # 手臂：袖子（夾克色）＋手
    for sx, side in ((1, 'L'), (-1, 'R')):
        sh = Vector((sx * 0.165, 0.0, SH_Z - 0.01))
        el = Vector((sx * 0.23, 0.03, 1.08))
        wr = Vector((sx * 0.26, -0.02, 0.86))
        ellipsoid(f'shoulder_{side}', sh, (0.047, 0.05, 0.045), M['jacket'], seg=12, rings=8)
        tube(f'upperarm_{side}', sh, el, 0.044, 0.038, M['jacket'])
        tube(f'forearm_{side}', el, wr, 0.038, 0.032, M['jacket'])
        torus(f'cuff_{side}', wr + Vector((0, 0, 0.01)), 0.033, 0.009, M['jacket'], rot=look_quat(wr - el), seg=12, minor=4)
        ellipsoid(f'hand_{side}', wr + Vector((sx * 0.004, -0.008, -0.04)), (0.026, 0.034, 0.045), M['skin'], seg=10, rings=8)


def harness():
    leather = M['leather']
    # 胸前：從肩膀垂直往下的兩條皮帶（中間的 V 收到腰帶）
    for sx in (-1, 1):
        curve_tube(f'chest_strap_{sx}', [(sx * 0.07, -0.085, 1.37), (sx * 0.075, -0.112, 1.22), (sx * 0.06, -0.104, 1.02)], 0.009, 0.009, leather)
        curve_tube(f'back_strap_{sx}', [(sx * 0.07, 0.085, 1.37), (sx * 0.06, 0.112, 1.2), (sx * 0.04, 0.1, 1.02)], 0.009, 0.009, leather)
    # 胸口下的橫帶
    torus('chest_band', (0, 0.0, 1.13), 0.135, 0.008, leather, scale=(1, 0.78, 1), seg=18, minor=4)
    # 大腿：兩道綁帶＋往下交叉到膝蓋的皮帶（X）
    for sx, side in ((1, 'L'), (-1, 'R')):
        for z in (0.78, 0.7):
            torus(f'thigh_strap_{side}_{int(z * 100)}', (sx * 0.083, 0.004, z), 0.07, 0.008, leather, seg=12, minor=4)
            box(f'thigh_buckle_{side}_{int(z * 100)}', (sx * 0.083, -0.07, z), (0.022, 0.006, 0.016), M['metal'], bevel=0.002)
        curve_tube(f'leg_x1_{side}', [(sx * 0.04, -0.062, 0.86), (sx * 0.08, -0.07, 0.72), (sx * 0.13, -0.045, 0.6)], 0.007, 0.007, leather)
        curve_tube(f'leg_x2_{side}', [(sx * 0.135, -0.03, 0.86), (sx * 0.1, -0.068, 0.72), (sx * 0.055, -0.05, 0.6)], 0.007, 0.007, leather)


def odm_gear():
    for sx, side in ((1, 'L'), (-1, 'R')):
        # 大腿外側的大刀箱（直立、正面有一格一格的刀槽）
        c = Vector((sx * 0.19, 0.02, 0.72))
        box(f'blade_box_{side}', c, (0.075, 0.15, 0.32), M['box_metal'], bevel=0.01)
        for k in range(3):
            box(f'blade_slot_{side}_{k}', c + Vector((sx * 0.039, -0.045 + k * 0.045, 0.06)), (0.004, 0.022, 0.15), M['dark_metal'], bevel=0)
        box(f'blade_box_clip_{side}', c + Vector((0, 0, 0.17)), (0.08, 0.155, 0.025), M['dark_metal'], bevel=0.004)
        # 腰側的捲索器與發射口
        hip = Vector((sx * 0.16, -0.01, 1.0))
        tube(f'reel_{side}', hip + Vector((sx * 0.0, 0.0, 0.0)), hip + Vector((sx * 0.035, 0, 0)), 0.034, 0.034, M['metal'], seg=14, caps=False)
        box(f'launcher_{side}', hip + Vector((sx * 0.02, -0.05, 0.0)), (0.035, 0.07, 0.04), M['dark_metal'], bevel=0.006)
        L.empty(f'launcher_{side}_tip', hip + Vector((sx * 0.02, -0.09, 0.0)))
        # 腰後的氣罐（往後下方）
        tube(f'tank_{side}', (sx * 0.1, 0.1, 0.98), (sx * 0.12, 0.3, 0.9), 0.04, 0.04, M['metal'], seg=12)
    box('odm_core', (0, 0.11, 0.98), (0.12, 0.06, 0.07), M['metal'], bevel=0.008)
    L.empty('nozzle', (0, 0.15, 0.96))
    # 握把＋長刀：右手往下斜持、左手往下垂（像人偶照的站姿）
    for sx, side, d in ((1, 'L', Vector((0.12, -0.15, -1))), (-1, 'R', Vector((-0.45, -0.35, -1)))):
        hand = Vector((sx * 0.262, -0.025, 0.82))
        tube(f'grip_{side}', hand + Vector((0, 0, 0.03)), hand + Vector((0, 0, -0.04)), 0.012, 0.012, M['dark_metal'], seg=8)
        box(f'guard_{side}', hand + Vector((0, 0, -0.05)), (0.03, 0.04, 0.012), M['metal'], bevel=0.003)
        d = d.normalized()
        base = hand + Vector((0, 0, -0.055))
        tip = base + d * 0.95
        q = Vector((0, 0, -1)).rotation_difference(d)
        box(f'blade_{side}', (base + tip) / 2, (0.008, 0.04, 0.95), M['blade'], rot=q, bevel=0.0015)
        L.empty(f'blade_{side}', tip)


def cloak():
    # 斗篷：包住雙肩的短披肩（前面在胸口扣起來）＋往後飄的長擺
    bm = bmesh.new()
    seg, rings = 32, 7
    rows = []
    for j in range(rings + 1):
        t = j / rings  # 0＝領口、1＝披肩下緣
        row = []
        for i in range(seg):
            a = i / seg * math.pi * 2
            fr = max(0.0, -math.sin(a))  # 1＝正前方
            r = 0.065 + 0.19 * math.sqrt(t)  # 先往外貼著肩膀、再往下垂
            drop = 0.08 * t + 0.16 * t * t
            z = 1.43 - drop + 0.06 * fr * t  # 前面比較短（露出胸口）
            x = math.cos(a) * r * 1.12
            y = math.sin(a) * r * 0.8 + 0.008
            fold = 0.007 * math.sin(a * 12) * t * t
            row.append(bm.verts.new((x + fold * math.cos(a), y + fold * math.sin(a), z)))
        rows.append(row)
    for j in range(rings):
        for i in range(seg):
            a = (i + 0.5) / seg * math.pi * 2
            ang = abs(((a + math.pi / 2 + math.pi) % (2 * math.pi)) - math.pi)  # 離正前方的角度
            if ang < 0.12 + 0.55 * (j / rings):  # 前面 V 字開口
                continue
            bm.faces.new((rows[j][i], rows[j][(i + 1) % seg], rows[j + 1][(i + 1) % seg], rows[j + 1][i]))
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    mt = mesh_obj('cloak_mantle', bm, M['cape'])
    mt.modifiers.new('solid', 'SOLIDIFY').thickness = 0.01
    ellipsoid('cloak_clasp', (0, -0.062, 1.405), (0.016, 0.006, 0.016), M['metal'], seg=10, rings=6)
    # 長擺：從肩膀後面垂下、往後（和側邊）飄起
    bm = bmesh.new()
    cols, rws = 12, 12
    grid = []
    for j in range(rws + 1):
        t = j / rws
        z = 1.35 - t * 0.62
        half = 0.19 + 0.17 * t
        row = []
        for i in range(cols + 1):
            u = i / cols * 2 - 1
            x = u * half + 0.03 * t * t  # 往一側飄一點點
            y = 0.13 + 0.2 * t ** 1.4 + 0.03 * (1 - u * u) + 0.02 * math.sin(u * 9 + t * 5) * t
            zz = z + 0.06 * t * t * (0.5 + 0.5 * u)  # 飄起來（一側高）
            row.append(bm.verts.new((x, y, zz)))
        grid.append(row)
    for j in range(rws):
        for i in range(cols):
            bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
    cp = mesh_obj('cloak_tail', bm, M['cape'])
    cp.modifiers.new('solid', 'SOLIDIFY').thickness = 0.01


head()
face()
hair()
body()
harness()
odm_gear()
cloak()

L.save('hero')
glb = L.export('hero')
pics = L.preview('hero', size=640, samples=16)

# 臉部特寫
sc = bpy.context.scene
cam = bpy.data.objects.new('_face', bpy.data.cameras.new('_face'))
cam.data.type = 'ORTHO'
cam.data.ortho_scale = 0.36
COL.objects.link(cam)
sc.camera = cam
sun = bpy.data.objects.new('_sun2', bpy.data.lights.new('_sun2', 'SUN'))
sun.data.energy = 3.0
sun.data.angle = math.radians(18)
sun.rotation_euler = (math.radians(55), 0, math.radians(25))
COL.objects.link(sun)
for nm, d in (('face', Vector((0, -1, 0.05))), ('face34', Vector((0.7, -0.8, 0.12)))):
    d.normalize()
    cam.location = HEAD_C + Vector((0, 0, -0.03)) + d * 3
    cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = os.path.join(L.OUT_PREVIEW, f'hero-{nm}.png')
    bpy.ops.render.render(write_still=True)
    pics.append(sc.render.filepath)
print(f'[hero] 三角面 {L.stats()}、glb {os.path.getsize(glb) / 1024:.0f} KB')
for p in pics:
    print('[hero] 預覽:', p)
