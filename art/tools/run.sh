#!/usr/bin/env bash
# 執行一支 Blender 建模腳本：bash art/tools/run.sh art/blender/<名稱>.py [其他參數]
# 腳本會產生：public/models/<名稱>.glb（遊戲用）、art/source/<名稱>.blend（給人在電腦上手修）、art/previews/<名稱>-*.png（預覽圖）
set -euo pipefail
cd "$(dirname "$0")/../.."
bash art/tools/setup.sh >/dev/null
SCRIPT="$1"; shift || true
PYTHONPATH="art/tools${PYTHONPATH:+:$PYTHONPATH}" .venv-blender/bin/python "$SCRIPT" "$@" 2>&1 | grep -vE "Draco is not available|MeshOptimizer is not available" || true
