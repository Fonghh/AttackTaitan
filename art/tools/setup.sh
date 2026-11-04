#!/usr/bin/env bash
# 安裝 Blender（Python 模組版 bpy，不需要畫面也不需要顯示卡）到專案的 .venv-blender。
# 用法：bash art/tools/setup.sh   （已經裝過會直接跳過）
set -euo pipefail
cd "$(dirname "$0")/../.."
VENV=.venv-blender
BPY_VERSION=5.2.3
if [ -x "$VENV/bin/python" ] && "$VENV/bin/python" -c "import bpy" 2>/dev/null; then
  echo "Blender 已安裝：$("$VENV/bin/python" -c 'import bpy; print(bpy.app.version_string)')"
  exit 0
fi
python3 -m venv "$VENV"
"$VENV/bin/pip" install -q --upgrade pip
"$VENV/bin/pip" install -q "bpy==$BPY_VERSION"
echo "Blender 安裝完成：$("$VENV/bin/python" -c 'import bpy; print(bpy.app.version_string)')"
