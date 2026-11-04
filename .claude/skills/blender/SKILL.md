---
name: blender
description: 用 Blender（雲端、無畫面的 bpy）為 AttackTaitan 建模、綁骨架、做動畫、算預覽圖並匯出 .glb。使用者說「用 Blender」「建模」「重新建模」「做模型」「出預覽圖」或輸入 /blender 時使用。
---

# Blender 建模流程（以雲端 A 為主，人工手修 C 為輔）

## 每次開始
1. `bash art/tools/setup.sh`（第一次約 1 分鐘，會裝 `bpy` 到 `.venv-blender`；裝過會直接跳過）。
2. 讀 `art/README.md` 的規格（座標、尺寸、命名、面數上限、標記點）。
3. 先 `git fetch origin` 看 main 有沒有協作者（或使用者在電腦上手修）推的新 `.blend`，有的話先合進來再改。

## 建模
- 一個模型一支腳本：`art/blender/<名稱>.py`，開頭 `import blender_lib as L`、`L.reset()`，結尾 `L.finish('<名稱>')`。
- 執行：`bash art/tools/run.sh art/blender/<名稱>.py`
  - 產生 `art/source/<名稱>.blend`（給人在電腦上用 Blender 打開手修）
  - `public/models/<名稱>.glb`（遊戲載入用）
  - `art/previews/<名稱>-front|side|back|three.png`（預覽，不進 git）
- 拼成一張給手機看：`python3 art/tools/sheet.py <名稱>`，再用 SendUserFile 傳 `art/previews/<名稱>-sheet.png`。
- 改造型時改腳本再重跑，不要只改 .blend（腳本是主要來源）。
  例外：使用者在電腦上手修過的 .blend（commit 訊息會寫「手修」），之後改那個 .blend，不要再用腳本覆蓋，除非使用者同意。

## 風格
- 卡通 Q 版：大頭（約 3 頭身）、圓潤、塊面清楚、粉彩明亮；鳳眼、刺刺頭、紅圍巾、綠披風、立體機動裝置。
- 材質用純色就好（遊戲會依材質名稱套用分階卡通著色與描邊）；材質名稱照 README 的清單。

## 完成
- 跑 `npm test`，遊戲有接上模型時再 `npx vite build && npm run smoke`。
- commit：腳本、`.blend`、`.glb` 一起提交；push 前先 fetch，避免覆蓋協作者的修改。
- 回報時附預覽圖、三角面數、glb 大小。
