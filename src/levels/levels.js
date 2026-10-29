// 關卡定義、星等評分與進度（存在瀏覽器）。純資料與純函式，可在 Node 測試。
import { CONFIG } from '../config.js';

/**
 * 星等條件：clear＝完成任務、time＝幾秒內完成、nohit＝沒有受傷
 * @typedef {{type:'clear'}|{type:'time',max:number}|{type:'nohit'}} StarRule
 */

export const LEVELS = [
  {
    id: 'controls',
    name: '操作教學',
    map: 'training',
    objective: 'tutorial',
    brief: '一步一步認識操作：左右搖桿、鋼索、衝刺、斬擊與暫停選單。照畫面上方的提示做，閃爍的按鈕就是現在要用的。',
    spawn: { x: 0, y: 21, z: 80 },
    faceTo: { x: 0, z: 0 },
    titans: [{ name: '木人', x: 0, z: 0, yaw: 0, scale: 1, dummy: true }],
    // text＝手機、pc＝電腦；hl＝要閃爍提示的按鈕（手機）
    steps: [
      { id: 'move', text: '左下半部拖曳＝移動搖桿：走下高台、跑一段路', pc: 'W A S D＝移動：走下高台、跑一段路', hl: 'joy' },
      { id: 'look', text: '右邊空白處拖曳＝轉動視角：左右看一圈', pc: '移動滑鼠＝轉動視角：左右看一圈', hl: 'look' },
      { id: 'hook', text: '點一下「鋼索」＝朝準心發射，勾住柱子上方', pc: '準星對準柱子上方，點滑鼠左鍵勾住', hl: '.t-hook' },
      { id: 'release', text: '勾住後再點一下「鋼索」＝放開（往上衝時放開會飛更高）', pc: '再點一下左鍵＝放開（往上衝時放開會飛更高）', hl: '.t-hook' },
      { id: 'aimFire', text: '按住「鋼索」拖曳＝移動準心（拖遠一點鏡頭會跟著轉），放開＝朝準心發射', pc: '準星就在畫面中央：瞄準另一根柱子，點左鍵勾住', hl: '.t-hook' },
      { id: 'ropeFwd', text: '勾住時左搖桿往前推＝沿著繩子捲向勾點', pc: '勾住時按住 W＝沿著繩子捲向勾點', hl: 'joy' },
      { id: 'ropeSide', text: '勾住時左搖桿往左右推＝繞著勾點轉圈（往後拉＝停止收繩）', pc: '勾住時按住 A 或 D＝繞著勾點轉圈（S＝停止收繩）', hl: 'joy' },
      { id: 'dashHold', text: '勾住時按住「衝刺」＝快速捲收，越按越快', pc: '勾住時按住 Shift＝快速捲收，越按越快', hl: '.t-boost' },
      { id: 'flip', text: '在空中快速點兩下「衝刺」＝翻轉衝刺（勾住時沿搖桿方向，沒推就沿繩子）', pc: '在空中快速按兩下 Shift＝翻轉衝刺', hl: '.t-boost' },
      { id: 'groundDash', text: '落地後按住「衝刺」＝壓低身體滑鏟，越按越快', pc: '落地後按住 Shift＝滑鏟，越按越快', hl: '.t-boost' },
      { id: 'strike', text: '靠近木人點一下「斬擊」＝出刀（勾住時長按＝兵長斬，下一關訓練場會練）', pc: '靠近木人按 E 或 F＝出刀（勾住時長按＝兵長斬）', hl: '.t-strike' },
      { id: 'pause', text: '點左上角「II」＝暫停：可以調靈敏度、鏡頭、速度等設定，看完按「繼續」', pc: '按 Esc＝暫停：可以調靈敏度、鏡頭、速度等設定，看完按「繼續」', hl: '.t-pause' },
    ],
    stars: [{ type: 'clear' }, { type: 'time', max: 240 }, { type: 'time', max: 150 }],
  },
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
    brief: '巨人闖進城區：廣場 1 隻，大樓之間的街道上 4 隻（東街有 2 隻靠得很近，西街是會狂奔飛撲的奇行種）。全部討伐。',
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
    brief: '60～90 公尺高的巨木林，樹幹和樹冠都能勾。討伐林中的 4 隻巨人（其中 1 隻是會飛撲的奇行種）。',
    spawn: { x: 0, y: 46, z: 165 },
    faceTo: { x: 0, z: 40 },
    titans: [
      { name: '林間巨人', x: 0, z: 40, yaw: 0, scale: 1.2, homeRadius: 28 },
      { name: '西林巨人', x: -95, z: -30, yaw: 0.8, scale: 1.0, homeRadius: 28 },
      { name: '東林奇行種', kind: 'abnormal', x: 95, z: -55, yaw: -0.8, scale: 1.3, homeRadius: 28 },
      { name: '深林大巨人', x: -10, z: -140, yaw: 3.1, scale: 1.6, homeRadius: 30 },
    ],
    stars: [{ type: 'clear' }, { type: 'time', max: 300 }, { type: 'nohit' }],
  },
  {
    id: 'variety',
    name: '特殊巨人',
    map: 'city',
    objective: 'kill',
    brief: '三種新巨人：投石巨人（遠遠丟石頭，看到警告就閃開）、鎧甲巨人（後頸有水晶鎧甲，先砍兩下砍碎）、蒸氣巨人（全身發紅時快離開，噴完再砍）。全部討伐。',
    spawn: CONFIG.player.spawn,
    faceTo: { x: 0, z: 0 },
    titans: [
      { name: '投石巨人', kind: 'thrower', x: 0, z: -20, yaw: 0, scale: 1.1, homeRadius: 20 },
      { name: '鎧甲巨人', kind: 'armored', x: 100, z: 50, yaw: -1.2, scale: 1.25, homeRadius: 26 },
      { name: '蒸氣巨人', kind: 'steam', x: -100, z: 0, yaw: 1.2, scale: 1.2, homeRadius: 26 },
      { name: '北街投石巨人', kind: 'thrower', x: -50, z: -150, yaw: 0.3, scale: 0.95, homeRadius: 20 },
    ],
    stars: [{ type: 'clear' }, { type: 'time', max: 360 }, { type: 'nohit' }],
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
