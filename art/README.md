# 美術資源（Blender）

## 協作方式

- **A（主要，手機就能做，不用開電腦）**：在 Claude 的雲端對話裡說「用 Blender 做○○」或輸入 `/blender`。
  Claude 會在雲端寫 Blender 腳本建模型、算預覽圖傳給你看；你在手機上說哪裡要改，滿意後匯出 `.glb` 放進遊戲、推上 GitHub。
- **C（有空坐在電腦前時）**：從 GitHub 拉下 `art/source/<名稱>.blend`，用 Blender 打開手修（臉、髮型、細節），
  存檔後推回 GitHub（commit 訊息寫「手修 ○○」）。之後 Claude 會以你手修過的 .blend 為準，不會再用腳本蓋掉。
  手修完要重新匯出 `.glb` 的話：Blender 選單 檔案 → 匯出 → glTF 2.0，格式選 glb，存到 `public/models/<名稱>.glb`（或請 Claude 幫你匯出）。

## 資料夾

| 路徑 | 內容 |
| --- | --- |
| `art/blender/*.py` | 建模腳本（主要來源，一個模型一支） |
| `art/source/*.blend` | Blender 原始檔（給人手修） |
| `public/models/*.glb` | 遊戲載入的模型（會跟著網站發佈） |
| `art/previews/` | 預覽圖（不進 git） |
| `art/tools/` | 安裝、執行、共用工具、拼預覽圖 |

指令：`bash art/tools/setup.sh`（安裝 Blender 5.2 的 Python 版）、`bash art/tools/run.sh art/blender/<名稱>.py`、`python3 art/tools/sheet.py <名稱>`。

## 規格

- **座標**：單位公尺，Z 朝上，臉朝 -Y（Blender 前視圖看到臉），腳底在 Z=0、身體中心在原點正上方。
- **尺寸**：主角身高約 1.6m（Q 版約 3 頭身）；巨人以 20m 高為基準（遊戲裡再依體型縮放）。
- **面數上限（手機）**：主角 14,000 三角面（含斗篷與刀箱）、巨人 6,000、小道具 1,500。貼圖最大 1024×1024，能用純色就用純色。
- **材質名稱**（遊戲依名稱套卡通著色、決定描邊）：`skin`、`hair`、`eye_white`、`iris`、`eye_dark`、`jacket`、`pants`、`boots`、`cape`、`leather`、`metal`、`blade`、`scarf`。
- **標記點（Empty，名稱固定）**：主角 `blade_L` / `blade_R`（刀尖）、`launcher_L` / `launcher_R`（鋼索發射口）、`nozzle`（噴氣口）；
  巨人 `nape`（後頸弱點）、`eye_L` / `eye_R`、`ankle_L` / `ankle_R`。
- **骨架與動畫**：骨頭名稱 `hips`、`spine`、`chest`、`neck`、`head`、`upperarm_L/R`、`forearm_L/R`、`hand_L/R`、`thigh_L/R`、`shin_L/R`、`foot_L/R`，斗篷 `cape_1～3`；
  動畫名稱 `idle`、`run`、`fly`、`slash_cross`、`slash_down`、`slash_side`、`slash_side2`、`roll`、`backflip`、`hurt`。
  主角的靜止姿勢（rest）＝雙手自然下垂、刀往正前方伸出；硬的零件直接掛在骨頭上（不蒙皮），只有斗篷蒙皮。
  翻滾、後空翻、被打飛的「整個人轉圈」由遊戲處理，動畫裡只做手腳的動作。
  動作預覽：`python3 art/tools/animsheet.py hero` → `art/previews/hero-anim-sheet.png`。
