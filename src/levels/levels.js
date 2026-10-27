// 關卡定義、星等評分與進度（存在瀏覽器）。純資料與純函式，可在 Node 測試。
import { CONFIG } from '../config.js';

/**
 * 星等條件：clear＝完成任務、time＝幾秒內完成、nohit＝沒有受傷
 * @typedef {{type:'clear'}|{type:'time',max:number}|{type:'nohit'}} StarRule
 */

export const LEVELS = [
  {
    id: 'training',
    name: '訓練場',
    map: 'training',
    objective: 'training',
    brief: '在訓練場依序練習立體機動與斬擊。木人不會攻擊、也不會被砍倒。',
    spawn: { x: 0, y: 21, z: 80 },
    faceTo: { x: 0, z: 0 },
    titans: [
      { name: '木人 A', x: 0, z: 0, yaw: 0, scale: 1, dummy: true },
      { name: '木人 B', x: -32, z: -28, yaw: 0.6, scale: 1, dummy: true },
      { name: '木人 C', x: 32, z: -28, yaw: -0.6, scale: 1, dummy: true },
    ],
    steps: [
      { id: 'hook', text: '把準星對準柱子上方，發射鋼索勾住' },
      { id: 'fling', text: '被拉著往上衝時，再按一次鋼索放開，往上飛' },
      { id: 'dash', text: '勾住後按住「衝刺」：越按越快，衝到勾點會往上衝過頭' },
      { id: 'leg', text: '靠近木人腳邊按「斬擊」砍腳踝（地上按住衝刺滑鏟也行）' },
      { id: 'nape', text: '繞到木人背後，高速飛過後頸時按「斬擊」' },
      { id: 'levi', text: '勾住木人時「長按斬擊」：兵長斬' },
    ],
    stars: [{ type: 'clear' }, { type: 'time', max: 180 }, { type: 'time', max: 90 }],
  },
  {
    id: 'city',
    name: '城區討伐',
    map: 'city',
    objective: 'kill',
    brief: '巨人闖進城區：廣場 1 隻，大樓之間的街道上 4 隻（東街有 2 隻靠得很近）。全部討伐。',
    spawn: CONFIG.player.spawn,
    faceTo: { x: CONFIG.titans[0].x, z: CONFIG.titans[0].z },
    titans: CONFIG.titans,
    stars: [{ type: 'clear' }, { type: 'time', max: 300 }, { type: 'nohit' }],
  },
  {
    id: 'rings',
    name: '空中競速',
    map: 'city',
    objective: 'rings',
    brief: '依序穿過懸在街道上空的 12 個光圈，越快越好。沒有巨人。',
    spawn: CONFIG.player.spawn,
    faceTo: { x: 0, z: 0 },
    titans: [],
    // 光圈都放在街道（x 是 50 的倍數）上空，不會卡進建築
    rings: [
      [0, 30, 95],
      [0, 22, 50],
      [0, 36, 0],
      [-50, 26, -50],
      [-50, 40, -100],
      [-100, 30, -150],
      [-150, 26, -100],
      [-150, 36, -50],
      [-100, 22, 0],
      [-100, 44, 50],
      [-50, 30, 100],
      [50, 34, 100],
    ],
    ringRadius: 6,
    stars: [{ type: 'clear' }, { type: 'time', max: 120 }, { type: 'time', max: 75 }],
  },
  {
    id: 'forest',
    name: '巨木森林',
    map: 'forest',
    objective: 'kill',
    brief: '60～90 公尺高的巨木林，勾點都在樹幹上。討伐林中的 4 隻巨人。',
    spawn: { x: 0, y: 46, z: 165 },
    faceTo: { x: 0, z: 40 },
    titans: [
      { name: '林間巨人', x: 0, z: 40, yaw: 0, scale: 1.2, homeRadius: 28 },
      { name: '西林巨人', x: -95, z: -30, yaw: 0.8, scale: 1.0, homeRadius: 28 },
      { name: '東林巨人', x: 95, z: -55, yaw: -0.8, scale: 1.4, homeRadius: 28 },
      { name: '深林大巨人', x: -10, z: -140, yaw: 3.1, scale: 1.6, homeRadius: 30 },
    ],
    stars: [{ type: 'clear' }, { type: 'time', max: 300 }, { type: 'nohit' }],
  },
];

export function getLevel(id) {
  return LEVELS.find((l) => l.id === id) || null;
}

export function nextLevel(id) {
  const i = LEVELS.findIndex((l) => l.id === id);
  return i >= 0 && i < LEVELS.length - 1 ? LEVELS[i + 1] : null;
}

export function starText(rule) {
  if (rule.type === 'clear') return '完成任務';
  if (rule.type === 'time') return `${rule.max} 秒內完成`;
  if (rule.type === 'nohit') return '沒有受傷';
  return '';
}

/**
 * 依結果計算拿到哪幾顆星。
 * @param {{won:boolean, time:number, hurt:boolean}} r
 * @returns {boolean[]}
 */
export function evaluateStars(level, r) {
  return level.stars.map((s) => {
    if (!r.won) return false;
    if (s.type === 'clear') return true;
    if (s.type === 'time') return r.time <= s.max;
    if (s.type === 'nohit') return !r.hurt;
    return false;
  });
}

const KEY = 'progress1';

/** 測試期間：所有關卡一開始就解鎖（改成 false 恢復「過前一關才解鎖」） */
export const UNLOCK_ALL = true;

/** @param {Storage|null} storage */
export function loadProgress(storage) {
  try {
    return JSON.parse(storage?.getItem(KEY) || '{}') || {};
  } catch {
    return {};
  }
}

/** 記錄成績（只保留最佳），回傳更新後的進度 */
export function saveResult(storage, id, stars, time) {
  const p = loadProgress(storage);
  const old = p[id] || { stars: 0, time: null };
  p[id] = { stars: Math.max(old.stars, stars), time: old.time == null ? time : Math.min(old.time, time) };
  try {
    storage?.setItem(KEY, JSON.stringify(p));
  } catch {}
  return p;
}

/** 第一關一定開；其他關要前一關至少拿到 1 顆星 */
export function isUnlocked(progress, id, unlockAll = UNLOCK_ALL) {
  const i = LEVELS.findIndex((l) => l.id === id);
  if (i < 0) return false;
  if (unlockAll || i === 0) return true;
  return (progress[LEVELS[i - 1].id]?.stars || 0) > 0;
}
