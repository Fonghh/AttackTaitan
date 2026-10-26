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
    maxSpeed: 68,
    minSpeedCap: 10, // 速度倍率很低時，最高速度至少保留這麼多（m/s）
    defaultSpeedScale: 0.5, // 速度倍率預設值（暫停選單可調 10%～150%）
    softLimitRate: 3, // 超過最高速時，每秒衰減多少比例
    dragCoef: 0.00012,
    maxHp: 100,
    invulnTime: 1.0,
    spawn: { x: 12, y: 45, z: 125 },
  },

  // 落地滑行
  slide: {
    minSpeed: 8, // 落地水平速度高於此值才滑行
    decel: 22, // 30 m/s 約滑 1.3 秒、20 公尺
    steer: 6,
  },

  hook: {
    range: 85,
    // 鋼索手感：'pull' = 拉索（勾住後被強力拉向勾點，快到時自動放開往上衝；預設）
    //           'swing' = 擺盪（鐘擺式，往上甩時放開）
    style: 'pull',
    pull: {
      accel: 54, // 朝勾點的拉力（m/s²）
      maxSpeed: 50, // 拉索時朝勾點方向的最高速度
      minAccel: 18, // 速度倍率很低時的拉力下限（要拉得贏重力）
      minSpeed: 6,
      gravityScale: 0.5, // 拉索期間的重力比例
      sideDamp: 0.35, // 側向速度每秒收斂比例（越小越保留側向橫移）
      steerAccel: 26, // 勾住時方向鍵／搖桿的側向操控力（m/s²）× 左右擺盪倍率
      defaultSteerScale: 1.5, // 左右擺盪倍率預設值（暫停選單可調 50%～300%）
      arriveDist: 6, // 離勾點這麼近時停止拉動，鋼索保持勾住（變成繞勾點擺盪）
      launchBonus: 0.15, // 放開時向上速度 ×(1+此值)
      launchUp: 5, // 放開時額外的向上速度（m/s）
      wallCarry: 0.7, // 撞牆損失的水平速度，翻過牆頂後還回這個比例
      aimAssistDeg: 2, // 準星沒打中時，在這個角度內找最近的勾點（小，避免限制瞄準）
      aimAssistDegTouch: 3,
    },
    titanAssistDeg: 5, // 準星附近這個角度內有巨人 → 優先勾巨人
    titanAssistDegTouch: 7,
    travelSpeed: 260, // 鉤爪飛行速度（視覺 + 命中延遲）
    aimOffsetDeg: 10, // 雙索模式：左右鋼索相對準星的偏角
    initialSlack: 1.0, // 勾住瞬間的繩長 = 距離 × 此值（1 = 不會瞬間拉動位置）
    reelAccel: 32, // 捲收時朝勾點的推力（m/s²），只加速度、不直接搬動位置
    swingPump: 5, // 繃緊擺盪時沿切線方向的推力，讓擺盪越盪越快
    boostSwing: 1.0, // 勾住時加速：推力沿擺盪切線方向（倍率）
    minLength: 2.5,
    maxCorrection: 0.35, // 每個子步驟鋼索最多修正的位置量（防止瞬移）
    wallRunUp: 0.35, // 勾住時撞牆：撞擊速度的這個比例轉成沿牆往上的速度
    // 擺盪輔助瞄準：準星打中的點不夠高時，在附近找更高的勾點
    swingAim: {
      goodHeight: 6, // 準星直接打中的點比角色高這麼多 → 直接採用
      yawSteps: [0, 7, -7, 14, -14, 21, -21],
      pitchSteps: [0, 7, 14, 21, 28],
      heightWeight: 0.7, // 每高 1m 相當於離準星近幾度
      maxHeightBonus: 30,
      lowPenalty: 20, // 勾點不比角色高時的懲罰（度）
      headOnDot: 0.75, // 牆面法線與視線的夾角餘弦超過此值視為「正對著」
      headOnDist: 60,
      headOnPenalty: 14,
      minClearance: 8, // 擺盪最低點至少離地幾公尺
      groundPenalty: 30,
    },
  },

  // 衝刺（原「加速」）：鉤住時按住＝快速捲收鋼索，衝到勾點時鋼索放鬆，帶著速度衝過頭往上飛
  dash: {
    speed: 70, // 衝刺最高速度（m/s）× 衝刺倍率
    accel: 120, // 衝刺拉力（m/s²）
    defaultScale: 0.6, // 衝刺倍率預設值（暫停選單可調 10%～200%）
    sideDamp: 3, // 衝刺時側向速度收斂（路線比較直）
    gasUse: 22, // 每秒消耗氣體
    slackExtra: 45, // 衝到勾點後鋼索放鬆，繩長 = 當下距離 + 這麼多
    launchBonus: 0.45, // 衝到勾點時向上速度加成
    launchUp: 12, // 額外向上速度（m/s，× 衝刺倍率）
  },

  boost: {
    accel: 36,
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
    spinRange: 7, // 迴旋斬範圍（× 巨人體型）
    spinSpeedFactor: 0.6, // 迴旋斬的速度門檻 = 一般斬擊 × 此值
    spinDamageBonus: 1.15,
    hitStop: 0.11, // 頓點：命中瞬間畫面停住（秒）
    hitStopPerfect: 0.18,
    slowMo: 0.35, // 頓點後的慢動作恢復時間（秒）
    slowMoPerfect: 0.55,
    slowMoScale: 0.25, // 慢動作開始時的時間倍率
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
    aggroRange: 95, // 玩家進入這個水平距離才會追擊／攻擊
    // 部位效果
    stunTime: 5, // 砍眼睛：暈眩秒數（不能轉身、攻擊、走路）
    kneelTime: 4.5, // 砍腳：跪下秒數（後頸變低）
    eyeDamage: 8,
    legDamage: 12,
    partRange: 4.5, // 部位斬擊距離（× 巨人體型）
    // 抓取
    grabChance: 0.45,
    grabWindup: 0.7,
    grabReach: 0.4,
    grabRadius: 3.5,
    grabHoldTime: 2.6, // 被抓住後幾秒沒掙脫就被捏
    grabEscapeTaps: 5, // 連打斬擊幾次掙脫
    crushDamage: 45,
    // 死亡後屍體淡出
    fadeDelay: 3,
    fadeTime: 2,
    start: { x: 0, z: -10 },
  },

  // 巨人配置：廣場一隻、大樓間街道上各處，其中兩隻成對在附近
  titans: [
    { name: '廣場巨人', x: 0, z: -10, yaw: 0.15, scale: 1.0, homeRadius: 40 },
    { name: '西街巨人', x: -100, z: 50, yaw: 1.2, scale: 1.3, homeRadius: 12 },
    { name: '東街巨人 A', x: 100, z: -50, yaw: -1.4, scale: 1.15, homeRadius: 12, tint: '#c98f74' },
    { name: '東街巨人 B', x: 100, z: -100, yaw: -1.0, scale: 1.45, homeRadius: 12, tint: '#b98670', hair: '#1f1712' },
    { name: '南巷大巨人', x: -100, z: -100, yaw: 0.6, scale: 1.6, homeRadius: 10, tint: '#ddb090' },
  ],

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
    autoFollow: false, // 空中自動轉向飛行方向（預設關閉，暫停選單可開啟）
    autoFollowRate: 2.2,
    autoFollowDelayMouse: 0.9, // 滑鼠停止移動多久後開始跟隨
    autoFollowDelayTouch: 0.7,
    followSmoothTime: 0.4, // 飛行方向的平滑時間（擺盪時不會急轉）
    followPitch: -0.14,
    joystickTurnRate: 1.0,
    // 手機：鉤住時鏡頭轉向人物面朝的方向（放索後再跟一小段）
    hookFollow: true,
    hookFollowRate: 3.0,
    hookFollowAfter: 0.8, // 放索後繼續跟隨幾秒
  },

  speedLines: {
    minSpeed: 16,
    fullSpeed: 60,
    max: 110,
    spawnPerSec: 220,
    lengthPerSpeed: 0.13,
  },

  sensitivity: { mouse: 0.0022, touch: 0.0065 },

  // 手機準心搖桿（右邊鋼索鈕）：準心在畫面上移動，而不是轉鏡頭
  reticle: {
    stickRadius: 70, // 手指拖多遠（px）準心到最邊
    rangeX: 0.75, // 準心最遠到畫面寬度的幾成（NDC）
    rangeY: 0.6,
    edgeTurnRate: 1.6, // 推到邊緣時鏡頭慢慢轉的速度（rad/s）
    snap: true, // 準心吸附：靠近建築轉角／屋頂邊緣時吸過去（手機）
    snapRadiusPx: 44,
  },

  world: {
    wallRadius: 270,
    wallHeight: 60,
  },
};
