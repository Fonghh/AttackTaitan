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
      defaultSteerScale: 2.0, // 左右擺盪倍率預設值（暫停選單可調 50%～300%）
      arriveDist: 6, // 衝刺時離勾點這麼近算抵達（之後放鬆、衝過頭往上飛）
      // 自動收繩：勾住後繩子每秒固定收短（不管搖桿往哪推），收到「繞圈半徑」為止。
      // 往側邊推＝一邊收一邊繞（螺旋往內），最後繞小圈；往後推（遠離勾點）＝暫停收繩、維持距離
      autoReel: 8, // 每秒收幾公尺（暫停選單可調 0～20）
      orbitRadius: 8, // 勾在建築上的繞圈半徑（m，暫停選單可調 4～20）
      orbitTitanFactor: 1.25, // 勾在巨人身上：繞圈半徑 × 此值 × 巨人體型
      holdDot: -0.35, // 搖桿往後拉超過這個程度就暫停收繩
      // 勾住時搖桿：前＝沿著繩子朝勾點捲進（不受鏡頭方向影響）、左右＝繞著勾點橫移、後＝暫停收繩
      forwardAccel: 70, // 往前推時沿繩子的加速度（m/s²）
      forwardSpeed: 60, // 往前推時沿繩子的最高速度 × 速度倍率
      forwardGravity: 0, // 推到底時的重力比例（0＝無重力直線捲進；擺盪時照常有重力）
      brakeDecel: 35, // 接近勾點時的減速度（避免往前推時撞上或衝過頭；衝刺不受限）
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
    // 擺盪式衝刺：快速收繩，保留並放大擺盪（繩子變短 → 轉得更快，像溜冰收手）
    reelSpeed: 55, // 收繩速度（m/s）× 衝刺倍率
    radialAccel: 140, // 朝勾點方向的加速度上限
    gravityScale: 0.15, // 衝刺時保留的重力（低一點才衝得到高處；推前進時再降到 0）
    spinUpMax: 1.05, // 每個子步驟切線速度最多放大幾倍（角動量守恆的上限）
    swingKick: 9, // 按下衝刺瞬間，沿擺盪／搖桿方向補的推力（m/s）× 衝刺倍率
    maxSpeedFactor: 1.2, // 衝刺時最高速度 = speed × 衝刺倍率 × 此值
    gasUse: 22, // 每秒消耗氣體
    slackExtra: 45, // 衝到勾點後鋼索放鬆，繩長 = 當下距離 + 這麼多（往上衝不會被扯住）
    slackTakeUp: 4, // 放鬆的鋼索會跟著收：最多只比當下距離長這麼多（掉回來時很快接住，不會甩大圈）
    launchBonus: 0.45, // 衝到勾點時向上速度加成
    launchUp: 12, // 額外向上速度（m/s，× 衝刺倍率）
    // 氮氣式加速：按住越久力道越大；放開後速度上限慢慢降，不會一放就掉速
    rampTime: 1.4, // 按住幾秒達到全力
    rampStart: 0.25, // 剛按下時的力道比例
    rampDecay: 1.5, // 放開後累積的力道以幾倍速度消退（短暫放開再按可以接著加速）
    carryDecay: 7, // 放開衝刺後，最高速度上限每秒下降多少（m/s）
    // 地面衝刺：沒勾住、在地上按住衝刺＝壓低身體滑鏟，一樣是氮氣式越按越快
    // （可穿過巨人腳下、經過腳踝自動砍）；速度都 × max(0.7, 速度倍率)
    groundStart: 14, // 按下瞬間的滑鏟速度（m/s）
    groundAccel: 30, // 全力時的加速度（m/s²），力道跟著按住時間漸增
    groundMax: 42, // 地面衝刺最高速度（m/s）
    groundTime: 0.35, // 放開後還能穿過巨人／自動砍腳的秒數
    groundGas: 4, // 按下瞬間耗氣
    groundGasUse: 16, // 按住時每秒耗氣
    // 翻轉衝刺：空中快速連點兩下衝刺 → 身體翻一圈，往搖桿（沒推就往鏡頭）方向爆衝一段，之後保留慣性
    // （速度上限像放開衝刺一樣每秒慢慢降）。會衝過頭的話調低 speed
    flip: {
      window: 0.3, // 兩次按下的間隔（秒）
      tuck: 0.6, // 捲身翻轉（空中幾乎停住、縮身翻一圈）的秒數＝頓點，之後才爆衝
      speed: 44, // 爆衝速度 m/s × max(0.6, 速度倍率)
      time: 1.4, // 爆衝秒數（原本 0.42 再加約 1 秒，速度不變）
      detachDist: 6, // 勾住時沿繩子爆衝：離勾點這麼近＝自動脫勾，帶著速度繼續衝（衝上雲端）
      brake: 1, // 結束時速度保留比例（1＝完全保留慣性）
      hang: 0, // 結束後滯空秒數（減重）
      gas: 15,
      cooldown: 0.8,
    },
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
    legSlideSpeed: 26, // 砍腳後滑向巨人背後的最低速度（m/s）
    legSlideBehind: 7, // 滑到巨人背後多遠（× 巨人體型）
    passThrough: 0.8, // 滑行期間可穿過巨人身體的秒數
    // 兵長斬：勾住時長按斬擊 → 空中短拍蓄力 → 沿鋼索迴旋直衝目標，命中後鋼索自動解除
    leviHold: 0.22, // 長按多久算長按（秒）；短按仍是一般斬擊
    leviWindup: 0.3, // 空中短拍（蓄力浮空）秒數
    leviFloat: 3, // 短拍時往上浮的速度（m/s）
    leviSpeed: 76, // 直衝速度（m/s）× max(0.45, 速度倍率)
    leviMaxTime: 1.8, // 直衝最長秒數
    leviHitDist: 3.2, // 距離勾點多近算抵達
    leviRange: 7, // 抵達時的命中範圍（× 巨人體型）
    leviDamageBonus: 1.3, // 後頸傷害加成
    leviPop: 10, // 命中後往上彈（m/s）
    groundSpinRange: 1.6, // 地面迴旋斬：離腳踝 partRange × 此值以內
    spinRange: 7, // 迴旋斬範圍（× 巨人體型）
    spinSpeedFactor: 0.6, // 迴旋斬的速度門檻 = 一般斬擊 × 此值
    spinDamageBonus: 1.15,
    impactFrame: 0.12, // 衝擊幀：命中後頸／兵長斬／擊殺時，畫面變成白底黑剪影的秒數（真實時間）
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
    // 奇行種：跑得快、方向亂飄、蹲低後朝玩家撲過去（撲擊途中撞到就受傷）
    abnormal: {
      runSpeed: 9, // m/s × 體型（一般巨人走路 3.2）
      turnRate: 2.2,
      wobble: 0.7, // 跑步時方向左右亂飄的幅度（弧度）
      homeFactor: 2, // 地盤範圍 × 這個倍數（比較會追出去）
      pounceRange: 34, // 距離這麼近（× 體型）就可能撲過來
      pounceMin: 7,
      pounceMaxHeight: 1.4, // 玩家高度 ≤ 巨人身高 × 這個倍數才撲
      windup: 0.65, // 蹲低預備（有警告）
      leapTime: 0.95,
      leapHeight: 0.4, // 拋物線高度 = 距離 × 此值
      hitRadius: 4.2, // 撲擊途中，胸口／頭離玩家這麼近（× 體型）＝撞到
      damage: 30,
      knock: 26,
      recover: 1.4, // 落地後的硬直（趁機砍）
      cooldown: 4,
    },
    // 死亡後屍體淡出
    fadeDelay: 3,
    fadeTime: 2,
    start: { x: 0, z: -10 },
  },

  // 巨人配置：廣場一隻、大樓間街道上各處，其中兩隻成對在附近
  titans: [
    { name: '廣場巨人', x: 0, z: -10, yaw: 0.15, scale: 1.0, homeRadius: 40, look: { body: 'normal', girth: 1, torso: 1, belly: 1, face: 'angry', hair: 'short', tint: '#d39a7c', hairColor: '#3a2a1f' } },
    { name: '西街奇行種', kind: 'abnormal', x: -100, z: 50, yaw: 1.2, scale: 1.3, homeRadius: 12 },
    { name: '東街巨人 A', x: 100, z: -50, yaw: -1.4, scale: 1.15, homeRadius: 12, look: { body: 'stocky', girth: 1.25, torso: 1.15, belly: 1.3, face: 'blank', hair: 'bald', tint: '#c98f6f' } },
    { name: '東街巨人 B', x: 100, z: -100, yaw: -1.0, scale: 1.45, homeRadius: 12, look: { body: 'lanky', girth: 0.78, torso: 0.86, belly: 1, face: 'grin', hair: 'long', tint: '#e2b190', hairColor: '#c9a25a' } },
    { name: '南巷大巨人', x: -100, z: -100, yaw: 0.6, scale: 1.6, homeRadius: 10, look: { body: 'normal', girth: 1.05, torso: 1.05, belly: 1, face: 'grin', hair: 'messy', tint: '#b9805f', hairColor: '#1e1a17' } },
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
    // 手機：空中推左搖桿左右＝鏡頭跟著轉（和右邊準心搖桿的轉動相加，不衝突）
    // 鎖定鏡頭：鋼索勾在巨人身上時，鏡頭自動對準那隻巨人（左搖桿左右＝繞著牠轉）
    lock: {
      enabled: true,
      rate: 5, // 轉向目標的速度（每秒）
      manualPause: 0.7, // 手動轉鏡頭後幾秒內不搶鏡頭
      breakAfter: 0.5, // 準心推到邊緣持續轉鏡頭超過這麼久＝解除鎖定（直到下次勾住）
      aimDrop: 2.5, // 對準點 = 後頸往下 × 巨人體型（畫面裡看得到上半身）
      raise: 1.4, // 鎖定時鏡頭往上抬，角色落在畫面下方前景
    },
    // 鏡頭側傾：依側向加速度（繞圈、擺盪轉彎）傾斜，像飛機轉彎
    // perYawRate：鏡頭每秒轉 1 弧度時傾斜多少弧度（繞圈、轉彎時往彎內傾）
    // 等級：high＝最多 18°、low＝最多 9°、off＝0°（不傾斜）
    roll: { levels: { high: 1, low: 0.5, off: 0 }, defaultLevel: 'low', maxDeg: 18, perAccel: 0.012, perYawRate: 0.32, rate: 6 },
    // 近距離廣角鏡頭：角色更大、背景掠過更快
    close: { enabled: true, distance: 3.3, maxExtraDist: 2.0, fovPerSpeed: 0.42, maxExtraFov: 34 },
    groundSkim: { height: 4, minSpeed: 15, drop: 1.0 }, // 貼地高速飛行時鏡頭壓低
    punch: { amount: 0.4, time: 0.28 }, // 命中時鏡頭往命中點推近（比例）
    // 手機：陀螺儀瞄準（轉動手機＝轉動鏡頭），倍率 1 = 手機轉多少鏡頭就轉多少
    gyro: {
      levels: { off: 0, low: 0.7, mid: 1.2, high: 1.8 },
      defaultLevel: 'off',
    },
    joyTurn: {
      deadZone: 0.2, // 搖桿推超過 20% 才開始轉
      rate: 2.4, // 推到底每秒轉幾弧度（約 140°/秒）× 強度
      curve: 1.6, // 輕推轉得慢、推到底轉得快
      levels: { high: 1.5, mid: 1, low: 0.55, off: 0 },
      defaultLevel: 'mid',
    },
    // 手機：鉤住時鏡頭轉向人物面朝的方向（放索後再跟一小段）
    hookFollow: true,
    hookFollowRate: 3.0,
    hookFollowAfter: 0.8, // 放索後繼續跟隨幾秒
  },

  // 瓦斯雲帶：飛行時身後兩條柔和的雲狀帶子，停留數秒、慢慢擴散（和細長發亮的鋼索區分開）
  trailLines: { life: 3.5, interval: 0.04, width: 0.32, alpha: 0.42, spread: 3.5 },

  speedLines: {
    // 速度線濃度（暫停選單切換）：數量與亮度倍率
    levels: { high: 1, mid: 0.55, low: 0.28, off: 0 },
    defaultLevel: 'mid',
    minRadius: 4, // 只在角色外圍生成（m），角色、鋼索與畫面中央保持乾淨
    maxRadius: 11,
    minSpeed: 16,
    fullSpeed: 60,
    max: 110,
    spawnPerSec: 220,
    lengthPerSpeed: 0.13,
  },

  sensitivity: { mouse: 0.0022, touch: 0.0065 },

  // 手機準心搖桿（右邊鋼索鈕）：準心在畫面上移動，而不是轉鏡頭
  reticle: {
    rangeX: 0.75, // 準心最遠到畫面寬度的幾成（NDC）
    rangeY: 0.6,
    // 兩段速度（px，皆會除以靈敏度倍率）
    deadZone: 8, // 這麼近不動（防手抖）
    slowEnd: 45, // 慢速區結束：準心只到最大範圍的 slowFrac
    slowFrac: 0.3,
    fastEnd: 75, // 快速區結束：準心到邊緣
    turnRamp: 35, // 再推這麼遠，鏡頭轉速從 0 加到最快
    maxTurnRate: 3.5, // 鏡頭最快轉速（rad/s，約 200°/秒）
    edgePx: 14, // 手指離螢幕邊緣這麼近 → 視為推到底
    defaultSens: 1.3, // 準心靈敏度預設（暫停選單 50%～200%；實測 120～150% 順手）
    snap: true, // 準心吸附：靠近建築轉角／屋頂邊緣時吸過去（手機）
    snapRadiusPx: 44,
    // 快速甩動轉身
    flick: { enabled: false, minPx: 50, maxMs: 180, angleDeg: 90, duration: 0.16 },
  },

  world: {
    wallRadius: 270,
    wallHeight: 60,
  },
};
