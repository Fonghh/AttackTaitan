"""
建模用的基本形狀（在 bpy 裡跑）：橢球、圓錐管（可加半球帽）、圓角方塊、圓環，以及讓零件朝某個方向的旋轉。
用法：from shapes import ellipsoid, tube, box, torus, look_quat, mesh_obj
"""
import bpy  # 一定要先載入 bpy，bmesh／mathutils 才找得到
import bmesh
from mathutils import Vector, Quaternion

import blender_lib as L

def mesh_obj(name, bm, mat, smooth=True):
    me = bpy.data.meshes.new(name)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    for p in me.polygons:
        p.use_smooth = smooth
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
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


