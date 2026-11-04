"""
Blender 建模共用工具（在 bpy 裡跑，不需要畫面）。

座標慣例（照 Blender 的習慣）：
- 單位公尺，Z 朝上，角色臉朝 -Y（Blender 前視圖看到的是臉），腳底在 Z=0。
- 匯出 glTF 時 Blender 會自動轉成 Y 朝上；遊戲載入時再轉成遊戲用的面向。

每支模型腳本的基本流程：
    import blender_lib as L
    L.reset()
    ...建模型...
    L.finish('hero')   # 存 .blend、匯出 .glb、算預覽圖
"""
import math
import os
import sys

import bpy
import mathutils

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT_GLB = os.path.join(ROOT, 'public', 'models')
OUT_BLEND = os.path.join(ROOT, 'art', 'source')
OUT_PREVIEW = os.path.join(ROOT, 'art', 'previews')


def reset():
    """清空場景（不帶預設的方塊、燈、鏡頭）。"""
    bpy.ops.wm.read_factory_settings(use_empty=True)


def hex_color(h):
    h = h.lstrip('#')
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    # sRGB → 線性（Blender 材質顏色是線性的）
    f = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (f(r), f(g), f(b), 1.0)


_mats = {}


def mat(name, color, rough=0.8, metal=0.0, emit=None):
    """同名材質只建一次。顏色用 '#rrggbb'。遊戲載入時會依材質名稱套用卡通著色。"""
    if name in _mats:
        return _mats[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = hex_color(color)
    p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = metal
    if emit:
        p.inputs['Emission Color'].default_value = hex_color(emit[0])
        p.inputs['Emission Strength'].default_value = emit[1]
    m.diffuse_color = hex_color(color)
    _mats[name] = m
    return m


def assign(obj, material):
    obj.data.materials.clear()
    obj.data.materials.append(material)
    return obj


def smooth(obj, angle=40):
    """平滑著色（超過 angle 度的邊保持銳利）。"""
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    try:
        bpy.ops.object.shade_auto_smooth(angle=math.radians(angle))
    except Exception:
        bpy.ops.object.shade_smooth()
    obj.select_set(False)
    return obj


def empty(name, location, parent=None):
    """標記點（例如刀尖、鋼索發射口、後頸）：遊戲用名稱找到它。"""
    e = bpy.data.objects.new(name, None)
    e.empty_display_size = 0.05
    e.location = location
    bpy.context.scene.collection.objects.link(e)
    if parent:
        e.parent = parent
    return e


def stats():
    tris = 0
    for o in bpy.context.scene.objects:
        if o.type == 'MESH':
            o.data.calc_loop_triangles()
            tris += len(o.data.loop_triangles)
    return tris


def _bounds():
    pts = []
    for o in bpy.context.scene.objects:
        if o.type == 'MESH':
            pts += [o.matrix_world @ mathutils.Vector(c) for c in o.bound_box]
    lo = mathutils.Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = mathutils.Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


def preview(name, views=('front', 'side', 'back', 'three'), size=520, samples=12):
    """
    算預覽圖（Cycles CPU，淺灰背景、柔和的天光＋太陽），自動框住整個模型。
    產生 art/previews/<name>-<view>.png，回傳路徑清單。
    """
    os.makedirs(OUT_PREVIEW, exist_ok=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = samples
    sc.render.resolution_x = size
    sc.render.resolution_y = size
    sc.render.film_transparent = False
    world = bpy.data.worlds.new('preview') if not sc.world else sc.world
    sc.world = world
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.78, 0.84, 0.9, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.9
    sun = bpy.data.objects.new('_sun', bpy.data.lights.new('_sun', 'SUN'))
    sun.data.energy = 3.0
    sun.rotation_euler = (math.radians(50), 0, math.radians(30))
    sc.collection.objects.link(sun)
    lo, hi = _bounds()
    center = (lo + hi) / 2
    span = max(hi.x - lo.x, hi.y - lo.y, hi.z - lo.z)
    cam = bpy.data.objects.new('_cam', bpy.data.cameras.new('_cam'))
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = span * 1.15
    sc.collection.objects.link(cam)
    sc.camera = cam
    dirs = {'front': (0, -1, 0.08), 'side': (1, 0, 0.08), 'back': (0, 1, 0.08), 'three': (0.75, -0.9, 0.35)}
    paths = []
    for v in views:
        d = mathutils.Vector(dirs[v]).normalized()
        cam.location = center + d * span * 3
        cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
        path = os.path.join(OUT_PREVIEW, f'{name}-{v}.png')
        sc.render.filepath = path
        bpy.ops.render.render(write_still=True)
        paths.append(path)
    bpy.data.objects.remove(cam)
    bpy.data.objects.remove(sun)
    return paths


def export(name):
    """匯出 public/models/<name>.glb（Y 朝上、套用修改器、含動畫與標記點）。"""
    os.makedirs(OUT_GLB, exist_ok=True)
    path = os.path.join(OUT_GLB, f'{name}.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_apply=True, export_yup=True, export_animations=True, export_extras=True)
    return path


def save(name):
    """存 art/source/<name>.blend（給人在電腦上打開手修）。"""
    os.makedirs(OUT_BLEND, exist_ok=True)
    path = os.path.join(OUT_BLEND, f'{name}.blend')
    bpy.ops.wm.save_as_mainfile(filepath=path, compress=True)
    return path


def finish(name, previews=True):
    """存檔＋匯出＋預覽，印出摘要。"""
    blend = save(name)
    glb = export(name)
    pics = preview(name) if previews else []
    kb = os.path.getsize(glb) / 1024
    print(f'[{name}] 三角面 {stats()}、glb {kb:.0f} KB')
    print(f'[{name}] blend: {blend}')
    print(f'[{name}] glb:   {glb}')
    for p in pics:
        print(f'[{name}] 預覽: {p}')
