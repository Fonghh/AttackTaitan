import './style.css';
import { Game } from './core/game.js';
import { getLevel, LEVELS } from './levels/levels.js';
import { loadModels } from './world/models.js';

// iOS Safari 會忽略 user-scalable=no：連點按鈕（翻轉衝刺）會觸發「點兩下放大」，縮放還會在重新整理後保留。
// 1) 遊戲區的快速連點不讓瀏覽器放大（選單面板不攔，按鈕照常能點）
let lastTouchEnd = 0;
document.addEventListener(
  'touchend',
  (e) => {
    const now = performance.now();
    if (now - lastTouchEnd < 400 && !(e.target instanceof Element && e.target.closest('.panel'))) e.preventDefault();
    lastTouchEnd = now;
  },
  { passive: false },
);
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
for (const ev of ['gesturestart', 'gesturechange']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
// 2) 已經被放大（包含重新整理後保留的縮放）→ 重設 viewport 回到 1 倍
const vp = document.querySelector('meta[name=viewport]');
const resetZoom = () => {
  if (!vp || !window.visualViewport || visualViewport.scale <= 1.01) return;
  const c = vp.content;
  vp.content = c.replace(/initial-scale=[\d.]+/, 'initial-scale=1.0001');
  requestAnimationFrame(() => (vp.content = c));
};
window.visualViewport?.addEventListener('resize', resetZoom);
addEventListener('pageshow', resetZoom);
resetZoom();

// 先載入這張地圖要用的 Blender 模型（失敗也沒關係，遊戲會改用程式產生的模型），再開始遊戲
function start(models) {
  try {
    new Game(document.getElementById('app'), { models });
  } catch (err) {
    console.error(err);
    const el = document.getElementById('fatal');
    el.hidden = false;
    el.textContent = `無法啟動遊戲（可能是瀏覽器不支援 WebGL）：${err.message}`;
  }
}
const params = new URLSearchParams(location.search);
let lastLevel = 'training';
try {
  lastLevel = localStorage.getItem('lastLevel') || lastLevel;
} catch {}
const level = getLevel(params.get('level')) || getLevel(lastLevel) || LEVELS[0];
loadModels(level.map).then(start, () => start(null));
