import './style.css';
import { Game } from './core/game.js';

try {
  new Game(document.getElementById('app'));
} catch (err) {
  console.error(err);
  const el = document.getElementById('fatal');
  el.hidden = false;
  el.textContent = `無法啟動遊戲（可能是瀏覽器不支援 WebGL）：${err.message}`;
}
