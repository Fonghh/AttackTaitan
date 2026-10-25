// 所有手感參數集中在這裡，方便調整。單位：公尺、秒。

export const CONFIG = {
  gravity: 22,

  player: {
    radius: 0.55, // 碰撞球半徑（球心即角色位置，腳底 = 球心 - radius）
    runSpeed: 10,
    runAccel: 60,
    jumpSpeed: 9,
    airAccel: 14, // 空中 WASD 轉向加速度
    airThrust: 16, // 空中未勾索時按 Space 的上升噴氣
    maxSpeed: 72,
    softLimitRate: 3, // 超過最高速時，每秒衰減多少比例
    dragCoef: 0.00012,
    maxHp: 100,
    invulnTime: 1.0,
    spawn: { x: 25, y: 45, z: 125 },
  },

  // 落地滑行
  slide: {
    minSpeed: 8, // 落地水平速度高於此值才滑行
    decel: 22, // 30 m/s 約滑 1.3 秒、20 公尺
    steer: 6,
  },

  hook: {
    range: 85,
    travelSpeed: 260, // 鉤爪飛行速度（視覺 + 命中延遲）
    aimOffsetDeg: 10, // 左右鋼索相對準星的偏角
    assistDegDesktop: 5,
    assistDegTouch: 10,
    initialSlack: 0.98, // 勾住瞬間的繩長 = 距離 × 此值（產生一點拉扯）
    autoReel: 2.5, // 勾住期間的輕微自動收緊（m/s）
    reelSpeed: 22, // 強捲收（Space / 搖桿往前推到底）
    reelAccel: 34,
    weakReelSpeed: 9, // 電腦 W 的弱捲收
    weakReelAccel: 12,
    minLength: 2.5,
    maxSlack: 0.6, // 繩子最多比實際距離長多少（避免一直鬆垮）
  },

  boost: {
    accel: 38,
    gasMax: 100,
    gasUse: 26, // 每秒
    regenGround: 35,
    regenAir: 5,
  },

  // 放索上甩與頂點滯空
  fling: {
    releaseBonus: 0.15, // 放開時向上速度額外 +15%
    minUpVel: 2,
    hangTriggerVy: 2.5, // 上升速度降到此值以下 → 進入滯空
    hangGravityScale: 0.4,
    hangDuration: 0.4,
    armWindow: 2.5, // 放索後多久內仍可觸發滯空
  },

  strike: {
    range: 7,
    minSpeed: 20,
    maxFrontDot: 0.3, // 玩家相對後頸的方向與巨人正面的夾角餘弦上限（越小越要從後方）
    minApproachDot: -0.3, // 速度方向不可明顯遠離弱點
    lungeRange: 22,
    lungeAngleDeg: 40,
    lungeDuration: 0.34,
    lungeSpeed: 42,
    lungeGas: 10,
    lungeHitDist: 3.5,
    cooldown: 0.45,
    baseDamage: 40,
    damagePerSpeed: 2.4, // 每多 1 m/s 增加的傷害
    maxDamage: 110,
    perfectDamage: 100,
    bodyDamage: 4,
    bodyRange: 3.5,
    hitStop: 0.09,
  },

  titan: {
    hp: 100,
    walkSpeed: 3.2,
    turnRate: 0.8,
    arenaRadius: 45,
    chaseDist: 22,
    attackRange: 30,
    attackMaxHeight: 26,
    attackCone: 0.5, // cos 60°
    attackCooldown: 1.6,
    windup: 0.9,
    swing: 0.45,
    recover: 0.9,
    swipeDamage: 35,
    swipeKnock: 28,
    swipeRadius: 3.4,
    staggerTime: 1.2,
    start: { x: 0, z: -10 },
  },

  camera: {
    distance: 6.5,
    shoulder: 0.7,
    targetHeight: 1.0,
    distPerSpeed: 0.075,
    maxExtraDist: 6,
    fov: 70,
    fovPerSpeed: 0.28,
    maxExtraFov: 22,
    minHFov: 78, // 直立手機時保證的最小水平視角
    maxVFov: 105,
    offsetSmooth: 10,
    autoFollowRate: 1.6,
    autoFollowDelay: 1.0,
    joystickTurnRate: 1.7,
  },

  speedLines: {
    minSpeed: 16,
    fullSpeed: 60,
    max: 110,
    spawnPerSec: 220,
    lengthPerSpeed: 0.13,
  },

  sensitivity: { mouse: 0.0022, touch: 0.0065 },

  world: {
    wallRadius: 270,
    wallHeight: 60,
  },
};
