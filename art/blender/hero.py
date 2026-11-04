"""
主角 v3（寫實動漫比例，約 7 頭身、身高約 1.65m）。原創角色，造型方向參考使用者給的人偶照：
深色短髮（兩側推短、成片的中分瀏海）、細長的冷峻眼神、棕色短版皮夾克＋白襯衫、
只在喉嚨扣起來、往兩側敞開垂到膝蓋的大斗篷、腰間深色布腰封、胸前與腿上的皮帶束具、過膝長靴、
大腿兩側的大刀箱、腰側捲索器、長刀。

座標：Z 朝上、臉朝 -Y、腳底 Z=0。
骨架：art/README.md 的骨頭名稱＋斗篷的 cape_1～3。硬的零件（頭、手臂、刀…）照部位合併後直接掛在骨頭上，
只有斗篷是蒙皮（跟著 cape 骨頭彎）。靜止姿勢（rest）＝雙手自然下垂、刀往正前方伸出（遊戲的程式姿勢也是這樣定義的）。
動畫：idle、run、fly、slash_cross、slash_down、slash_side、slash_side2、roll、backflip、hurt。

執行：bash art/tools/run.sh art/blender/hero.py
"""
import math
import os

import bpy  # 一定要先載入 bpy，bmesh／mathutils 才找得到
import bmesh
from mathutils import Vector, Quaternion, Euler, Matrix

import blender_lib as L
from shapes import ellipsoid, tube, box, torus, look_quat, mesh_obj

L.reset()
COL = bpy.context.scene.collection
FPS = 30
bpy.context.scene.render.fps = FPS

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
for k, m in M.items():
    m.use_backface_culling = k != 'cape'  # 只有斗篷要雙面（匯出 glTF 的 doubleSided）

# ───────────── 比例（公尺） ─────────────
HEAD_C = Vector((0, 0, 1.53))
HR = 0.105  # 頭的半徑
HZ = 1.17  # 臉的長度比例
HX = 0.9  # 臉的寬度比例
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
        z *= HZ  # 臉比較長
        if z < 0:
            k = (-z / (HR * HZ)) ** 1.5
            x *= 1 - 0.4 * k  # 下巴尖、下顎線收窄
            y *= 1 - 0.14 * k
            if y < 0:
                y -= 0.01 * k  # 下巴略往前
        if y < 0 and -0.2 * HR < z < 0.25 * HR:
            x *= 1 + 0.03 * (1 - abs(z) / (0.25 * HR))  # 顴骨
        x *= HX
        y *= 0.95
        v.co = Vector((x, y, z)) + HEAD_C
    mesh_obj('head', bm, M['skin'])
    for sx, side in ((1, 'L'), (-1, 'R')):
        ellipsoid(f'ear_{side}', HEAD_C + Vector((sx * 0.092, 0.012, -0.012)), (0.011, 0.021, 0.03), M['skin'], seg=8, rings=6)
    tube('neck', (0, 0.005, 1.37), (0, 0.005, 1.47), 0.045, 0.041, M['skin'], seg=12)


def on_head(h, v, out=0.0):
    """頭表面上的一點（h＝左右、v＝上下，弧度；h=0 正前方、h=π 正後方），回傳（位置, 法線）。"""
    d = Vector((math.sin(h) * math.cos(v), -math.cos(h) * math.cos(v), math.sin(v))).normalized()
    p = HEAD_C + Vector((d.x * HR * HX, d.y * HR * 0.95, d.z * HR * HZ)) * (1 + out)
    return p, d


def face():
    for sx, side in ((1, 'L'), (-1, 'R')):
        h = sx * 0.37
        tilt = sx * 0.17  # 眼尾上挑
        p, d = on_head(h, 0.04)
        q = look_quat(d, tilt)
        ellipsoid(f'eye_white_{side}', p, (0.023, 0.0085, 0.0058), M['eye_white'], seg=12, rings=6, rot=q)
        p2, _ = on_head(h - sx * 0.025, 0.033, 0.045)
        ellipsoid(f'iris_{side}', p2, (0.0082, 0.0082, 0.0042), M['iris'], seg=10, rings=6, rot=q)
        p3, _ = on_head(h - sx * 0.025, 0.033, 0.07)
        ellipsoid(f'pupil_{side}', p3, (0.0038, 0.0048, 0.0025), M['eye_dark'], seg=8, rings=4, rot=q)
        # 上眼線：粗、眼尾拉長往上（銳利的鳳眼）
        a, _ = on_head(h - sx * 0.21, 0.06, 0.05)
        b, _ = on_head(h + sx * 0.05, 0.085, 0.05)
        c, _ = on_head(h + sx * 0.25, 0.095, 0.04)
        curve_tube(f'lid_{side}', [a, b, c], 0.0034, 0.0022, M['eye_dark'])
        # 下眼線：只有眼尾一小段
        a, _ = on_head(h + sx * 0.08, 0.0, 0.045)
        b, _ = on_head(h + sx * 0.22, 0.05, 0.04)
        tube(f'lowlid_{side}', a, b, 0.0012, 0.0016, M['eye_dark'], seg=6)
        # 眉毛：眉頭往下壓、眉尾上揚（兇一點）
        e, _ = on_head(h - sx * 0.22, 0.15, 0.05)
        f, _ = on_head(h + sx * 0.22, 0.215, 0.05)
        tube(f'brow_{side}', e, f, 0.0052, 0.0032, M['hair'], seg=6)
    # 鼻樑與鼻尖、嘴（薄、略往一邊）
    a, _ = on_head(0, 0.02, 0.02)
    b, _ = on_head(0, -0.15, 0.085)
    tube('nose', a, b, 0.0055, 0.0075, M['skin'], seg=8)
    a, _ = on_head(-0.085, -0.37, 0.012)
    b, _ = on_head(0.075, -0.365, 0.012)
    tube('mouth', a, b, 0.0019, 0.0019, M['eye_dark'], seg=6)


def lock(name, base, tip, width, normal, arc=0.02, thick=0.32, rings=5):
    """一片成片、有弧度的髮束：從 base 到 tip，中段往 normal 方向拱起，寬度從根部慢慢收成圓圓的尖。"""
    base, tip, normal = Vector(base), Vector(tip), Vector(normal).normalized()
    pts = [base.lerp(tip, t) + normal * arc * math.sin(math.pi * t) for t in (i / rings for i in range(rings + 1))]
    bm = bmesh.new()
    loops = []
    n = 6
    for i, p in enumerate(pts):
        t = i / rings
        T = (pts[min(rings, i + 1)] - pts[max(0, i - 1)]).normalized()
        S = T.cross(normal).normalized()
        N = S.cross(T).normalized()
        w = width * max(0.03, (1 - t ** 1.6)) ** 0.75
        loops.append([bm.verts.new(p + S * math.cos(a) * w + N * math.sin(a) * w * thick) for a in (k / n * math.pi * 2 for k in range(n))])
    for i in range(rings):
        for k in range(n):
            bm.faces.new((loops[i][k], loops[i][(k + 1) % n], loops[i + 1][(k + 1) % n], loops[i + 1][k]))
    bm.faces.new(loops[-1][::-1])
    mesh_obj(name, bm, M['hair'])


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
        v.co = Vector((v.co.x * HX * 1.01, v.co.y * 0.96, v.co.z * HZ)) + HEAD_C + Vector((0, 0.004, 0.006))
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
        v.co = Vector((v.co.x * HX * 1.01, v.co.y * 0.97, v.co.z * 0.99)) + HEAD_C + Vector((0, 0.004, 0.02))
    bmesh.ops.delete(bm, geom=kill, context='VERTS')
    mesh_obj('hair_top', bm, M['hair'])

    # 中分偏一邊的瀏海：從分線往兩側垂下、成片地蓋到眉毛（右邊多、左邊少）
    bangs = [
        # (根部 h, v, 髮尾 h, v, 寬)：分線在 h≈0.12，額頭中間留一道縫
        (0.04, 0.8, -0.3, 0.2, 0.036), (-0.2, 0.74, -0.55, 0.15, 0.036), (-0.45, 0.65, -0.8, 0.1, 0.032),
        (-0.7, 0.55, -1.0, 0.0, 0.028), (0.22, 0.78, 0.42, 0.26, 0.034), (0.45, 0.68, 0.7, 0.16, 0.032), (0.72, 0.56, 0.95, 0.05, 0.028),
    ]
    for i, (hb, vb, ht, vt, w) in enumerate(bangs):
        b, nb = on_head(hb, vb, 0.1)
        t, nt = on_head(ht, vt, 0.075)
        lock(f'bang_{i}', b, t, w, (nb + nt).normalized(), arc=0.012, thick=0.22)
    # 兩鬢
    for sx in (-1, 1):
        b, nb = on_head(sx * 1.12, 0.45, 0.09)
        t, nt = on_head(sx * 1.2, -0.08, 0.06)
        lock(f'side_{sx}', b, t, 0.026, (nb + nt).normalized(), arc=0.008)
    # 頭頂往後梳的層次（蓋住上層殼的線條）
    for i, hb in enumerate((-0.7, -0.25, 0.2, 0.65)):
        b, nb = on_head(hb, 1.0, 0.08)
        t, nt = on_head(math.pi - hb * 0.7, 0.55, 0.08)
        lock(f'top_{i}', b, t, 0.05, (nb + nt).normalized(), arc=0.015, thick=0.25)


# ───────────── 身體 ─────────────
def body():
    # 襯衫（胸、腰）與鈕扣、高領
    ellipsoid('chest', (0, 0, 1.2), (0.155, 0.105, 0.16), M['shirt'], seg=20, rings=12)
    ellipsoid('waist', (0, 0.005, 1.03), (0.13, 0.092, 0.12), M['shirt'], seg=18, rings=10)
    for i in range(5):
        ellipsoid(f'button_{i}', (0, -0.104 + i * 0.002, 1.31 - i * 0.065), (0.006, 0.003, 0.006), M['metal'], seg=6, rings=4)
    tube('shirt_collar', (0, 0.005, 1.36), (0, 0.005, 1.4), 0.053, 0.051, M['shirt'], seg=14, caps=False)
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
    # 腿：大腿（白褲）＋過膝長靴（膝蓋上方反摺）＋膝蓋
    for sx, side in ((1, 'L'), (-1, 'R')):
        tube(f'thigh_{side}', (sx * 0.08, 0.01, 0.87), (sx * 0.092, 0.0, 0.5), 0.072, 0.055, M['pants'])
        tube(f'boot_{side}', (sx * 0.093, 0.0, 0.58), (sx * 0.097, 0.01, 0.3), 0.062, 0.052, M['boots'])
        tube(f'calf_{side}', (sx * 0.097, 0.012, 0.34), (sx * 0.1, 0.01, 0.07), 0.054, 0.042, M['boots'])
        torus(f'boot_top_{side}', (sx * 0.093, 0.0, 0.57), 0.063, 0.014, M['boots'], seg=12, minor=4)
        ellipsoid(f'knee_{side}', (sx * 0.093, -0.035, 0.5), (0.045, 0.03, 0.05), M['boots'], seg=10, rings=6)
        ellipsoid(f'foot_{side}', (sx * 0.1, -0.055, 0.04), (0.05, 0.12, 0.042), M['boots'], seg=12, rings=8)
        ellipsoid(f'heel_{side}', (sx * 0.1, 0.03, 0.025), (0.042, 0.045, 0.028), M['boots'], seg=10, rings=6)
    # 手臂：袖子（夾克色）＋手
    for sx, side in ((1, 'L'), (-1, 'R')):
        sh, el, wr = ARM[side]
        ellipsoid(f'shoulder_{side}', sh, (0.047, 0.05, 0.045), M['jacket'], seg=12, rings=8)
        tube(f'upperarm_{side}', sh, el, 0.044, 0.038, M['jacket'])
        tube(f'forearm_{side}', el, wr, 0.038, 0.032, M['jacket'])
        torus(f'cuff_{side}', wr + Vector((0, 0, 0.01)), 0.033, 0.009, M['jacket'], rot=look_quat(wr - el), seg=12, minor=4)
        ellipsoid(f'hand_{side}', wr + Vector((sx * 0.004, -0.008, -0.04)), (0.026, 0.034, 0.045), M['skin'], seg=10, rings=8)


ARM = {}
for _sx, _side in ((1, 'L'), (-1, 'R')):
    ARM[_side] = (Vector((_sx * 0.165, 0.0, SH_Z - 0.01)), Vector((_sx * 0.225, 0.02, 1.08)), Vector((_sx * 0.245, -0.01, 0.86)))


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
        tube(f'reel_{side}', hip, hip + Vector((sx * 0.035, 0, 0)), 0.034, 0.034, M['metal'], seg=14, caps=False)
        box(f'launcher_{side}', hip + Vector((sx * 0.02, -0.05, 0.0)), (0.035, 0.07, 0.04), M['dark_metal'], bevel=0.006)
        L.empty(f'launcher_{side}_tip', hip + Vector((sx * 0.02, -0.09, 0.0)))
        # 腰後的氣罐（往後下方）
        tube(f'tank_{side}', (sx * 0.1, 0.1, 0.98), (sx * 0.12, 0.3, 0.9), 0.04, 0.04, M['metal'], seg=12)
    box('odm_core', (0, 0.11, 0.98), (0.12, 0.06, 0.07), M['metal'], bevel=0.008)
    L.empty('nozzle', (0, 0.15, 0.96))
    # 握把（直的握在拳頭裡）＋從握把上端往正前方伸出的長刀（靜止姿勢；動作裡手腕會把刀轉到各種方向）
    for sx, side in ((1, 'L'), (-1, 'R')):
        hand = ARM[side][2] + Vector((sx * 0.004, -0.008, -0.04))
        tube(f'grip_{side}', hand + Vector((0, 0, 0.035)), hand + Vector((0, 0, -0.045)), 0.012, 0.012, M['dark_metal'], seg=8)
        box(f'guard_{side}', hand + Vector((0, -0.035, 0.02)), (0.03, 0.025, 0.04), M['metal'], bevel=0.003)
        base = hand + Vector((0, -0.05, 0.02))
        tip = base + Vector((0, -0.95, 0))
        box(f'sword_{side}', (base + tip) / 2, (0.008, 0.95, 0.04), M['blade'], bevel=0.0015)
        L.empty(f'blade_{side}', tip)
        L.empty(f'blade_{side}_base', base)


def cloak():
    """
    斗篷：一整片布，只在喉嚨扣起來；先包住肩膀，再往兩側敞開、往後垂到膝蓋（胸口整個露出來）。
    phi＝繞身體的角度（0＝正後方、±π＝正前方），t＝從領口往下（0～1）。
    """
    bm = bmesh.new()
    cols, rows = 30, 14
    grid = []
    for j in range(rows + 1):
        t = j / rows
        opening = 0.2 + 1.15 * t ** 0.8  # 前面敞開的半角（越下面越開）
        pmax = math.pi - opening
        s = min(1.0, t / 0.2)  # 肩膀段
        h = max(0.0, (t - 0.2) / 0.8)  # 垂下段
        row = []
        for i in range(cols + 1):
            phi = -pmax + 2 * pmax * i / cols
            r = 0.075 + 0.16 * math.sin(s * math.pi / 2) + 0.09 * h
            r += 0.014 * math.sin(phi * 9) * h  # 縱向的布褶
            zb = 0.5 + 0.4 * (abs(phi) / math.pi) ** 2  # 下緣：後面到膝蓋，往前慢慢變短
            z = 1.425 - 0.1 * s ** 1.6 - h * (1.325 - zb)
            bulge = max(0.0, math.cos(phi)) ** 1.5 * 0.17 * min(1.0, h / 0.35)  # 背後讓開氣罐
            x = math.sin(phi) * r * 1.15
            y = math.cos(phi) * r * 0.85 + bulge
            row.append(bm.verts.new((x, y, z)))
        grid.append(row)
    for j in range(rows):
        for i in range(cols):
            bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
    ob = mesh_obj('cloak', bm, M['cape'])
    ellipsoid('cloak_clasp', (0, -0.072, 1.405), (0.015, 0.006, 0.015), M['metal'], seg=10, rings=6)
    return ob


head()
face()
hair()
body()
harness()
odm_gear()
cloak_ob = cloak()

# ───────────── 骨架 ─────────────
BONES = [
    # 名稱, 頭, 尾, 父
    ('hips', (0, 0.005, 0.9), (0, 0.005, 1.0), None),
    ('spine', (0, 0.005, 1.0), (0, 0.005, 1.13), 'hips'),
    ('chest', (0, 0.005, 1.13), (0, 0.005, 1.36), 'spine'),
    ('neck', (0, 0.005, 1.37), (0, 0.005, 1.45), 'chest'),
    ('head', (0, 0.005, 1.45), (0, 0.005, 1.68), 'neck'),
    ('cape_1', (0, 0.17, 1.33), (0, 0.24, 1.06), 'chest'),
    ('cape_2', (0, 0.24, 1.06), (0, 0.33, 0.78), 'cape_1'),
    ('cape_3', (0, 0.33, 0.78), (0, 0.38, 0.5), 'cape_2'),
]
for sx, side in ((1, 'L'), (-1, 'R')):
    sh, el, wr = ARM[side]
    BONES += [
        (f'upperarm_{side}', tuple(sh), tuple(el), 'chest'),
        (f'forearm_{side}', tuple(el), tuple(wr), f'upperarm_{side}'),
        (f'hand_{side}', tuple(wr), tuple(wr + Vector((0, 0, -0.08))), f'forearm_{side}'),
        (f'thigh_{side}', (sx * 0.085, 0.008, 0.88), (sx * 0.093, 0.0, 0.5), 'hips'),
        (f'shin_{side}', (sx * 0.093, 0.0, 0.5), (sx * 0.1, 0.01, 0.075), f'thigh_{side}'),
        (f'foot_{side}', (sx * 0.1, 0.01, 0.075), (sx * 0.1, -0.15, 0.03), f'shin_{side}'),
    ]

arm_data = bpy.data.armatures.new('hero_rig')
arm = bpy.data.objects.new('hero_rig', arm_data)
COL.objects.link(arm)
bpy.context.view_layer.objects.active = arm
arm.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
for name, h, t, parent in BONES:
    eb = arm_data.edit_bones.new(name)
    eb.head, eb.tail = h, t
    eb.roll = 0
    if parent:
        eb.parent = arm_data.edit_bones[parent]
bpy.ops.object.mode_set(mode='OBJECT')
arm.select_set(False)


def bone_of(name):
    """零件名稱 → 掛在哪根骨頭。"""
    for pre, bone in (('thigh_strap', 'thigh'), ('thigh_buckle', 'thigh'), ('leg_x', 'thigh'), ('blade_box', 'hips'), ('blade_slot', 'hips'),
                      ('launcher', 'hips'), ('reel', 'hips'), ('tank', 'hips'), ('thigh', 'thigh'), ('knee', 'shin'), ('boot', 'shin'), ('calf', 'shin'),
                      ('foot', 'foot'), ('heel', 'foot'), ('shoulder', 'upperarm'), ('upperarm', 'upperarm'), ('forearm', 'forearm'), ('cuff', 'forearm'),
                      ('hand', 'hand'), ('grip', 'hand'), ('guard', 'hand'), ('sword', 'hand')):
        if name.startswith(pre):
            if bone in ('hips',):
                return 'hips'
            s = 'L' if f'_L' in name else 'R'
            return f'{bone}_{s}'
    for pre in ('head', 'ear', 'eye', 'iris', 'pupil', 'lid', 'lowlid', 'brow', 'nose', 'mouth', 'hair', 'bang', 'side_', 'top_', 'crown'):
        if name.startswith(pre):
            return 'head'
    if name.startswith('neck'):
        return 'neck'
    for pre in ('chest', 'button', 'shirt_collar', 'jacket', 'lapel', 'back_strap', 'cloak_clasp'):
        if name.startswith(pre):
            return 'chest'
    for pre in ('waist',):
        if name.startswith(pre):
            return 'spine'
    return 'hips'  # 腰封、皮帶、骨盆、裝置核心…


# 修改器先套用（合併時才不會掉），再依骨頭合併成一個物件（減少遊戲裡的 draw call）
meshes = [o for o in COL.objects if o.type == 'MESH' and o is not cloak_ob]
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.convert(target='MESH')
bpy.ops.object.select_all(action='DESELECT')
groups = {}
for o in [o for o in COL.objects if o.type == 'MESH' and o is not cloak_ob]:
    groups.setdefault(bone_of(o.name), []).append(o)
parts = {}
for bone, objs in groups.items():
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = ob.data.name = f'hero_{bone}'
    bpy.ops.object.select_all(action='DESELECT')
    parts[bone] = ob


def parent_to_bone(ob, bone):
    b = arm_data.bones[bone]
    mw = ob.matrix_world.copy()
    ob.parent = arm
    ob.parent_type = 'BONE'
    ob.parent_bone = bone
    ob.matrix_parent_inverse = (b.matrix_local @ Matrix.Translation((0, b.length, 0))).inverted()
    ob.matrix_basis = mw


for bone, ob in parts.items():
    parent_to_bone(ob, bone)
# 標記點跟著骨頭走
for nm, bone in (('blade_L', 'hand_L'), ('blade_R', 'hand_R'), ('blade_L_base', 'hand_L'), ('blade_R_base', 'hand_R'),
                 ('launcher_L_tip', 'hips'), ('launcher_R_tip', 'hips'), ('nozzle', 'hips')):
    parent_to_bone(bpy.data.objects[nm], bone)

# 斗篷：蒙皮。上段跟著胸口、往下依序交給 cape_1～3
levels = [(1.33, 'chest'), (1.06, 'cape_1'), (0.78, 'cape_2'), (0.5, 'cape_3')]
vg = {n: cloak_ob.vertex_groups.new(name=n) for _, n in levels}
for v in cloak_ob.data.vertices:
    z = v.co.z
    if z >= levels[0][0]:
        vg['chest'].add([v.index], 1.0, 'REPLACE')
        continue
    for (z0, b0), (z1, b1) in zip(levels, levels[1:]):
        if z >= z1 or b1 == 'cape_3':
            f = max(0.0, min(1.0, (z0 - z) / (z0 - z1)))
            vg[b0].add([v.index], 1 - f, 'REPLACE')
            vg[b1].add([v.index], f, 'REPLACE')
            break
cloak_ob.parent = arm
mod = cloak_ob.modifiers.new('rig', 'ARMATURE')
mod.object = arm

# ───────────── 動畫 ─────────────
# 姿勢用「身體座標」的尤拉角寫（X＝左右軸、Y＝前後軸、Z＝垂直軸），再換成每根骨頭自己的座標。
# 正負號：X 正＝往前彎（脊椎、頭）／往後擺（手臂、腿），膝蓋 X 正＝彎；
#         左手 Y 負＝往外張；Z 正＝轉向左邊。右邊鏡像（y、z 反號），sym() 幫你處理。
REST_Q = {b.name: b.matrix_local.to_3x3().to_quaternion() for b in arm_data.bones}
pbones = arm.pose.bones
for pb in pbones:
    pb.rotation_mode = 'QUATERNION'


def sym(**kw):
    """sym(upperarm=(x,y,z)) → 左右兩邊（右邊鏡像）。"""
    out = {}
    for k, (x, y, z) in kw.items():
        out[f'{k}_L'] = (x, y, z)
        out[f'{k}_R'] = (x, -y, -z)
    return out


def set_pose(pose, loc=(0, 0, 0)):
    for pb in pbones:
        e = pose.get(pb.name, (0, 0, 0))
        qm = Euler(e, 'XYZ').to_quaternion()
        w0 = REST_Q[pb.name]
        pb.rotation_quaternion = w0.inverted() @ qm @ w0
        pb.location = (0, 0, 0)
    pbones['hips'].location = REST_Q['hips'].inverted() @ Vector(loc)


def key_all(frame):
    for pb in pbones:
        pb.keyframe_insert('rotation_quaternion', frame=frame, group=pb.name)
        pb.keyframe_insert('location', frame=frame, group=pb.name)


def P(*dicts):
    out = {}
    for d in dicts:
        out.update(d)
    return out


ANIMS = {}


def action(name, frames, cyclic=False):
    """frames：[(影格, 姿勢 dict, 骨盆位移)]。"""
    act = bpy.data.actions.new(name)
    arm.animation_data_create()
    arm.animation_data.action = act
    for f, pose, loc in frames:
        set_pose(pose, loc)
        key_all(f)
    act.use_fake_user = True
    ANIMS[name] = (act, frames[0][0], frames[-1][0], cyclic)
    arm.animation_data.action = None
    return act


HOLD_DOWN = sym(hand=(2.1, 0, 0))  # 刀往後下方
# idle：站姿，雙刀垂在身側往後，緩慢呼吸
idle_a = P(sym(upperarm=(0.05, -0.12, 0), forearm=(-0.35, 0, 0.1), thigh=(0, -0.05, 0)), HOLD_DOWN, {'thigh_R': (0.12, 0.05, 0), 'shin_R': (0.12, 0, 0), 'foot_R': (-0.1, 0, 0), 'head': (0.06, 0, -0.05)})
idle_b = P(idle_a, {'chest': (-0.035, 0, 0), 'head': (0.02, 0, -0.03), 'upperarm_L': (0.03, -0.15, 0), 'upperarm_R': (0.03, 0.15, 0)})
action('idle', [(0, idle_a, (0, 0, 0)), (30, idle_b, (0, 0, 0.004)), (60, idle_a, (0, 0, 0))], cyclic=True)

# run：迎風低姿勢奔跑（上身往前壓、頭抬起看前方、雙刀往後拖）
run_frames = []
N = 18
for i in range(N + 1):
    p = i / N * math.pi * 2
    pose = {
        'spine': (0.55, 0, 0.06 * math.sin(p)), 'chest': (0.25, 0, -0.1 * math.sin(p)), 'neck': (-0.3, 0, 0), 'head': (-0.4, 0, 0),
        'thigh_L': (-0.3 - 0.8 * math.sin(p), 0, 0), 'thigh_R': (-0.3 + 0.8 * math.sin(p), 0, 0),
        'shin_L': (0.35 + 0.85 * (0.5 + 0.5 * math.cos(p - 0.9)), 0, 0), 'shin_R': (0.35 + 0.85 * (0.5 - 0.5 * math.cos(p - 0.9)), 0, 0),
        'foot_L': (0.25 * math.sin(p - 0.5), 0, 0), 'foot_R': (-0.25 * math.sin(p - 0.5), 0, 0),
        'upperarm_L': (0.45 + 0.1 * math.sin(p), -0.6, 0), 'upperarm_R': (0.45 - 0.1 * math.sin(p), 0.6, 0),
        'forearm_L': (-0.25, 0, 0), 'forearm_R': (-0.25, 0, 0), 'hand_L': (2.3, 0, -0.3), 'hand_R': (2.3, 0, 0.3),
        'cape_1': (0.15, 0, 0), 'cape_2': (0.15 + 0.08 * math.sin(p * 2), 0, 0), 'cape_3': (0.1 + 0.12 * math.sin(p * 2 + 1), 0, 0),
    }
    run_frames.append((i, pose, (0, -0.02, -0.12 + 0.035 * abs(math.cos(p)))))
action('run', run_frames, cyclic=True)

# fly：空中滑翔（雙刀往後張開、一腳彎一腳伸，斗篷往後飄）
fly_frames = []
N = 36
for i in range(N + 1):
    p = i / N * math.pi * 2
    w = math.sin(p)
    pose = {
        'spine': (0.1, 0, 0), 'head': (-0.15, 0, 0),
        'thigh_L': (-0.55 + 0.05 * w, 0.04, 0), 'shin_L': (1.0 + 0.06 * w, 0, 0), 'thigh_R': (-0.1 - 0.05 * w, -0.04, 0), 'shin_R': (0.45, 0, 0),
        'foot_L': (0.4, 0, 0), 'foot_R': (0.5, 0, 0),
        'upperarm_L': (0.8 + 0.05 * w, -0.65, 0), 'upperarm_R': (0.8 - 0.05 * w, 0.65, 0), 'forearm_L': (-0.3, 0, 0), 'forearm_R': (-0.3, 0, 0),
        'hand_L': (2.1, 0, -0.4), 'hand_R': (2.1, 0, 0.4),
        'cape_1': (0.9, 0, 0), 'cape_2': (0.35 + 0.15 * math.sin(p * 2), 0, 0.05 * w), 'cape_3': (0.25 + 0.2 * math.sin(p * 2 + 1.2), 0, -0.05 * w),
    }
    fly_frames.append((i, pose, (0, 0, 0)))
action('fly', fly_frames, cyclic=True)

# 斬擊（0.3 秒，遊戲依揮刀進度直接取時間點）
LEGS_STRIKE = {'thigh_L': (-0.55, 0, 0), 'shin_L': (0.8, 0, 0), 'thigh_R': (0.15, 0, 0), 'shin_R': (0.5, 0, 0)}
action('slash_cross', [
    (0, P(LEGS_STRIKE, sym(upperarm=(-2.6, -0.35, 0), forearm=(-0.4, 0, 0), hand=(0.5, 0, 0)), {'chest': (-0.25, 0, 0), 'spine': (-0.1, 0, 0), 'head': (0.1, 0, 0)}), (0, 0, 0)),
    (3, P(LEGS_STRIKE, sym(upperarm=(-1.7, 0.1, 0), forearm=(-0.2, 0, 0), hand=(0.6, 0, 0)), {'chest': (0.1, 0, 0), 'head': (-0.05, 0, 0)}), (0, 0, 0)),
    (6, P(LEGS_STRIKE, sym(upperarm=(-0.9, 0.55, 0.2), forearm=(-0.15, 0, 0), hand=(0.9, 0, 0.3)), {'chest': (0.35, 0, 0), 'spine': (0.15, 0, 0), 'head': (-0.25, 0, 0)}), (0, 0, -0.03)),
    (9, P(LEGS_STRIKE, sym(upperarm=(-0.45, 0.75, 0.3), forearm=(-0.2, 0, 0), hand=(1.2, 0, 0.4)), {'chest': (0.45, 0, 0), 'spine': (0.2, 0, 0), 'head': (-0.35, 0, 0)}), (0, 0, -0.04)),
])
action('slash_down', [
    (0, P(sym(upperarm=(-3.0, -0.12, 0), forearm=(-0.5, 0, 0), hand=(0.3, 0, 0), thigh=(-0.25, 0, 0), shin=(0.4, 0, 0)), {'chest': (-0.35, 0, 0), 'spine': (-0.15, 0, 0)}), (0, 0, 0)),
    (3, P(sym(upperarm=(-2.4, -0.1, 0), forearm=(-0.2, 0, 0), hand=(0.2, 0, 0), thigh=(-0.4, 0, 0), shin=(0.6, 0, 0)), {'chest': (-0.1, 0, 0)}), (0, 0, 0)),
    (6, P(sym(upperarm=(-1.1, -0.08, 0), forearm=(-0.05, 0, 0), hand=(0.4, 0, 0), thigh=(-0.8, 0, 0), shin=(1.0, 0, 0)), {'chest': (0.45, 0, 0), 'spine': (0.25, 0, 0), 'head': (-0.3, 0, 0)}), (0, 0, -0.04)),
    (9, P(sym(upperarm=(-0.45, -0.1, 0), forearm=(-0.1, 0, 0), hand=(0.9, 0, 0), thigh=(-0.95, 0, 0), shin=(1.2, 0, 0)), {'chest': (0.6, 0, 0), 'spine': (0.3, 0, 0), 'head': (-0.45, 0, 0)}), (0, 0, -0.06)),
])


def side_sweep(sign):
    """橫掃：雙手往前平舉、從一側掃到另一側，腰跟著扭（sign=1：右→左）。"""
    fr = []
    for f, k in ((0, 0.0), (3, 0.35), (6, 0.75), (9, 1.0)):
        a = (k - 0.5) * 2 * sign
        pose = {
            'chest': (0.1, 0, 0.75 * a), 'spine': (0.05, 0, 0.3 * a), 'head': (-0.1, 0, -0.5 * a),
            'upperarm_L': (-1.45, -0.25, 0.9 * a), 'upperarm_R': (-1.45, 0.25, 0.9 * a),
            'forearm_L': (-0.1, 0, 0), 'forearm_R': (-0.1, 0, 0), 'hand_L': (1.35, 0, 0.3), 'hand_R': (1.35, 0, -0.3),
            'thigh_L': (-0.4, -0.1, 0), 'shin_L': (0.7, 0, 0), 'thigh_R': (0.1, 0.1, 0), 'shin_R': (0.6, 0, 0),
        }
        fr.append((f, pose, (0, 0, 0)))
    return fr


action('slash_side', side_sweep(1))
action('slash_side2', side_sweep(-1))

# roll：落地前滾翻（身體的翻轉由遊戲處理；這裡是縮成一團再展開）
TUCK = P(sym(thigh=(-2.0, 0, 0), shin=(2.3, 0, 0), foot=(0.4, 0, 0), upperarm=(-0.9, 0.25, 0), forearm=(-1.0, 0, 0), hand=(2.4, 0, 0)), {'spine': (0.6, 0, 0), 'chest': (0.35, 0, 0), 'head': (0.4, 0, 0)})
action('roll', [
    (0, P(sym(thigh=(-0.8, 0, 0), shin=(1.2, 0, 0), upperarm=(-0.5, -0.2, 0), hand=(2.1, 0, 0)), {'spine': (0.3, 0, 0)}), (0, 0, -0.1)),
    (4, TUCK, (0, 0, 0)),
    (11, TUCK, (0, 0, 0)),
    (15, P(sym(thigh=(-0.5, 0, 0), shin=(0.8, 0, 0), upperarm=(0.3, -0.3, 0), forearm=(-0.3, 0, 0), hand=(2.1, 0, 0)), {'spine': (0.3, 0, 0), 'head': (-0.1, 0, 0)}), (0, 0, -0.05)),
])
# backflip：後空翻（翻轉交給遊戲；雙手往兩側張開、刀尖朝外，收腿再踢直）
action('backflip', [
    (0, P(sym(upperarm=(-2.3, -0.7, 0), forearm=(-0.2, 0, 0), hand=(1.0, 0, -0.4), thigh=(-0.5, 0, 0), shin=(0.6, 0, 0)), {'chest': (-0.3, 0, 0), 'head': (-0.4, 0, 0)}), (0, 0, 0)),
    (4, P(sym(upperarm=(-0.2, -1.45, 0), forearm=(0, 0, 0), hand=(1.57, 0, -0.9), thigh=(-1.9, 0, 0), shin=(2.2, 0, 0), foot=(0.4, 0, 0)), {'spine': (0.4, 0, 0), 'head': (0.3, 0, 0)}), (0, 0, 0)),
    (10, P(sym(upperarm=(-0.1, -1.5, 0), forearm=(0, 0, 0), hand=(1.57, 0, -1.0), thigh=(-1.8, 0, 0), shin=(2.1, 0, 0), foot=(0.4, 0, 0)), {'spine': (0.45, 0, 0), 'head': (0.3, 0, 0)}), (0, 0, 0)),
    (15, P(sym(upperarm=(0.6, -0.7, 0), forearm=(-0.3, 0, 0), hand=(2.1, 0, -0.3), thigh=(-0.3, 0, 0), shin=(0.4, 0, 0), foot=(0.3, 0, 0)), {'spine': (0.1, 0, 0)}), (0, 0, 0)),
])
# hurt：被打飛（頭往後甩、手腳亂甩，最後縮起來）
action('hurt', [
    (0, P(sym(upperarm=(-2.4, -0.8, 0), forearm=(-0.6, 0, 0), hand=(1.0, 0, 0)), {'thigh_L': (-0.9, -0.3, 0), 'shin_L': (1.1, 0, 0), 'thigh_R': (0.4, 0.2, 0), 'shin_R': (0.6, 0, 0), 'chest': (-0.45, 0, 0.2), 'head': (-0.6, 0, 0)}), (0, 0, 0)),
    (6, P({'upperarm_L': (-1.0, -1.3, 0), 'upperarm_R': (-2.8, 0.4, 0), 'forearm_L': (-0.9, 0, 0), 'forearm_R': (-0.3, 0, 0), 'thigh_L': (0.3, -0.4, 0), 'shin_L': (1.4, 0, 0), 'thigh_R': (-1.1, 0.3, 0), 'shin_R': (0.5, 0, 0), 'chest': (-0.3, 0, -0.3), 'head': (-0.4, 0, 0.3)}, sym(hand=(1.4, 0, 0))), (0, 0, 0)),
    (12, P({'upperarm_L': (-2.6, -0.5, 0), 'upperarm_R': (-0.9, 1.2, 0), 'forearm_L': (-0.3, 0, 0), 'forearm_R': (-1.0, 0, 0), 'thigh_L': (-1.2, -0.2, 0), 'shin_L': (0.7, 0, 0), 'thigh_R': (0.2, 0.4, 0), 'shin_R': (1.5, 0, 0), 'chest': (-0.2, 0, 0.3), 'head': (-0.3, 0, -0.2)}, sym(hand=(1.6, 0, 0))), (0, 0, 0)),
    (18, P(sym(upperarm=(-0.8, -0.4, 0), forearm=(-0.8, 0, 0), hand=(2.0, 0, 0), thigh=(-1.2, 0, 0), shin=(1.6, 0, 0)), {'spine': (0.4, 0, 0), 'head': (0.2, 0, 0)}), (0, 0, 0)),
])

# 每個動作放一條 NLA 軌（匯出 glTF 時每個動作都是一段動畫）
for name, (act, f0, f1, cyc) in ANIMS.items():
    tr = arm.animation_data.nla_tracks.new()
    tr.name = name
    st = tr.strips.new(name, int(f0), act)
for pb in pbones:
    pb.rotation_quaternion = (1, 0, 0, 0)
    pb.location = (0, 0, 0)


def show(name, frame):
    """預覽用：套上某個動作的某一格。"""
    act = ANIMS[name][0]
    arm.animation_data.action = act
    bpy.context.scene.frame_set(int(frame))


def rest():
    arm.animation_data.action = None
    for pb in pbones:
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
    bpy.context.view_layer.update()


rest()
glb = L.export('hero')
for tr in arm.animation_data.nla_tracks:
    tr.mute = True  # 存檔時軌道靜音（在 Blender 裡一次看一個動作）
L.save('hero')

# 預覽：站姿（idle 第 0 格）四個角度＋臉部特寫＋每個動作的連續格
show('idle', 0)
pics = L.preview('hero', size=640, samples=16)
sc = bpy.context.scene
cam = bpy.data.objects.new('_face', bpy.data.cameras.new('_face'))
cam.data.type = 'ORTHO'
COL.objects.link(cam)
sc.camera = cam
sun = bpy.data.objects.new('_sun2', bpy.data.lights.new('_sun2', 'SUN'))
sun.data.energy = 3.0
sun.data.angle = math.radians(18)
sun.rotation_euler = (math.radians(55), 0, math.radians(25))
COL.objects.link(sun)


def shoot(path, d, center, scale, size):
    d = Vector(d).normalized()
    cam.data.ortho_scale = scale
    cam.location = Vector(center) + d * 4
    cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
    sc.render.resolution_x = sc.render.resolution_y = size
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


for nm, d in (('face', (0, -1, 0.05)), ('face34', (0.7, -0.8, 0.12))):
    p = os.path.join(L.OUT_PREVIEW, f'hero-{nm}.png')
    shoot(p, d, HEAD_C + Vector((0, 0, -0.03)), 0.36, 640)
    pics.append(p)
sc.cycles.samples = 8
anim_dir = os.path.join(L.OUT_PREVIEW, 'hero-anim')
os.makedirs(anim_dir, exist_ok=True)
for name, (act, f0, f1, cyc) in ANIMS.items():
    n = 5
    for i in range(n):
        f = f0 + (f1 - f0) * i / (n - 1 if not cyc else n)
        show(name, round(f))
        shoot(os.path.join(anim_dir, f'{name}_{i}.png'), (0.8, -0.85, 0.3), (0, 0, 0.85), 2.4, 300)
rest()
print(f'[hero] 三角面 {L.stats()}、glb {os.path.getsize(glb) / 1024:.0f} KB、動作 {", ".join(ANIMS)}')
for p in pics:
    print('[hero] 預覽:', p)
