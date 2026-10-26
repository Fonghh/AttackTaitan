// 手機準心搖桿的反應曲線（兩段速度＋邊緣轉鏡頭）。純函式，可在 Node 測試。
//
//   手指距離   0 ── dead ── slowEnd ───── fastEnd ───── fastEnd+turnRamp
//   準心位置   不動   慢速（最多 slowFrac）  快速衝到邊緣    停在邊緣
//   鏡頭轉動   ──────────────────────────────  0 ──────→ 最快
//
// sens（靈敏度）越大，同樣的手指距離反應越大（各段距離都除以 sens）。

/**
 * @param {number} dx 手指相對按下點的位移（px，右為正）
 * @param {number} dy （px，下為正）
 * @param {{deadZone:number, slowEnd:number, slowFrac:number, fastEnd:number, turnRamp:number}} R
 * @param {number} sens 靈敏度倍率（1 = 100%）
 * @param {{x:number,y:number}} [edge] 手指貼到螢幕邊緣時（-1/0/1），該方向視為推到底
 * @returns {{aimX:number, aimY:number, turnX:number, turnY:number}} aim：準心 -1..1（上為正）；turn：鏡頭轉動 -1..1
 */
export function aimCurve(dx, dy, R, sens = 1, edge = { x: 0, y: 0 }) {
  const s = Math.max(0.2, sens);
  const dead = R.deadZone / s;
  const slowEnd = R.slowEnd / s;
  const fastEnd = R.fastEnd / s;
  const ramp = R.turnRamp / s;
  const d = Math.hypot(dx, dy);
  const out = { aimX: 0, aimY: 0, turnX: 0, turnY: 0 };
  if (d > dead) {
    let m;
    if (d < slowEnd) {
      // 慢速區：曲線起步很緩，方便精準微調
      m = R.slowFrac * Math.pow((d - dead) / (slowEnd - dead), 1.5);
    } else if (d < fastEnd) {
      // 快速區：從 slowFrac 加速衝到邊緣
      const k = (d - slowEnd) / (fastEnd - slowEnd);
      m = R.slowFrac + (1 - R.slowFrac) * k;
    } else {
      m = 1;
    }
    const ux = dx / d, uy = dy / d;
    out.aimX = ux * m;
    out.aimY = -uy * m;
    if (d > fastEnd) {
      // 推過邊緣：鏡頭開始轉，越遠越快
      const t = Math.min(1, (d - fastEnd) / ramp);
      out.turnX = ux * t;
      out.turnY = -uy * t;
    }
  }
  // 手指貼到螢幕邊緣：那個方向直接視為推到底（不會因為沒空間而轉不動）
  if (edge.x) {
    out.aimX = Math.sign(edge.x) * Math.max(Math.abs(out.aimX), 1);
    out.turnX = Math.sign(edge.x);
  }
  if (edge.y) {
    out.aimY = -Math.sign(edge.y) * Math.max(Math.abs(out.aimY), 1);
    out.turnY = -Math.sign(edge.y);
  }
  return out;
}

/**
 * 快速甩動：短時間內水平拖很遠 → 轉身（回傳 -1 左轉、1 右轉、0 不是甩動）
 */
export function detectFlick(dx, dy, ms, F) {
  if (ms > F.maxMs) return 0;
  if (Math.abs(dx) < F.minPx) return 0;
  if (Math.abs(dx) < Math.abs(dy) * 2) return 0;
  return Math.sign(dx);
}
