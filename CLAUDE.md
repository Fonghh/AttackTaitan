# AttackTaitan（給 Claude 的專案說明）

- 瀏覽器 3D 立體機動遊戲：Three.js 0.186 + Vite 8，純 JavaScript，手機直式為主。說明文件在 `README.md`。
- 與使用者溝通一律用繁體中文。
- main 會自動部署到 Cloudflare Workers（https://attacktaitan.alegu.workers.dev）；有協作者透過 PR 改 main，push 前先 `git fetch origin` 確認沒有新的改動。
- 測試：`npm test`（單元）；`npx vite build && npm run smoke`（Playwright 實機測試，smoke 不會自己 build）。
- 美術（Blender 建模）：見 `art/README.md` 與 `/blender` 指令（`.claude/skills/blender/SKILL.md`）。雲端用 `bash art/tools/setup.sh` 安裝無畫面的 Blender（bpy），不需要使用者開電腦。
