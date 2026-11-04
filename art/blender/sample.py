"""範例：一個 Q 版小人偶（確認 Blender 流程能跑：建模 → .blend → .glb → 預覽圖）。
執行：bash art/tools/run.sh art/blender/sample.py
"""
import bpy
import blender_lib as L

L.reset()
skin = L.mat('skin', '#ffdcc4')
hair = L.mat('hair', '#5b3a28')
coat = L.mat('jacket', '#d99a5f')

bpy.ops.mesh.primitive_uv_sphere_add(radius=0.25, location=(0, 0, 1.25), segments=32, ring_count=16)
L.smooth(L.assign(bpy.context.object, skin)).name = 'head'
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.265, location=(0, 0.02, 1.32), segments=32, ring_count=16)
cap = bpy.context.object
cap.scale = (1, 1, 0.85)
L.smooth(L.assign(cap, hair)).name = 'hair'
bpy.ops.mesh.primitive_cylinder_add(radius=0.2, depth=0.55, location=(0, 0, 0.75))
L.smooth(L.assign(bpy.context.object, coat)).name = 'body'
L.empty('nape', (0, 0.18, 1.05))

L.finish('sample')
