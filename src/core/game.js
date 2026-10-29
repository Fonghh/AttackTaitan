// 遊戲主控：建立各模組、處理輸入事件、主迴圈、戰鬥流程與遊戲狀態。
import { toonifyScene } from '../fx/toon.js';
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildCity } from '../world/city.js';
import { PlayerController } from '../player/playerController.js';
import { PlayerModel } from '../player/playerModel.js';
import { HookAimer } from '../physics/grapple.js';
import { CameraRig } from '../camera/cameraRig.js';
import { Titan } from '../enemy/titan.js';
import { evaluateStrike, canLunge, napeDamage } from '../combat/strike.js';
import { Input, isTouchDevice } from '../input/input.js';
import { Gyro } from '../input/gyro.js';
import { LEVELS, getLevel, nextLevel, starText, evaluateStars, loadProgress, saveResult, isUnlocked } from '../levels/levels.js';
import { Mission } from '../levels/mission.js';
import { TouchControls } from '../ui/touchControls.js';
import { Hud } from '../ui/hud.js';
import { Effects } from '../fx/effects.js';
import { Audio } from '../audio/audio.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _aimDir = new THREE.Vector3();
/** 迴旋斬傷害：一般斬擊 × spinDamageBonus */
const _aimLock = new THREE.Vector3();
const _bladeTip = new THREE.Vector3();
const napeDamageSpin = (speed, cfg) => napeDamage(speed, cfg) * cfg.strike.spinDamageBonus;

/** 沒有巨人的關卡（光圈競速）用的替身：永遠「已死亡」，讓目標相關的程式不用到處判斷 null */
const NO_TITAN = {
  alive: false,
  state: 'dead',
  hp: 0,
  name: '',
  height: 20,
  scale: 1,
  forward: new THREE.Vector3(0, 0, 1),
  root: { position: new THREE.Vector3(0, -1000, 0) },
  napeWorld: (out) => out.set(0, -1000, 0),
};

const storage = (() => {
  try {
    return localStorage;
  } catch {
    return null;
  }
})();

export class Game {
  constructor(container) {
    const cfg = (this.cfg = CONFIG);
    const params = new URLSearchParams(location.search);
    this.touch = isTouchDevice() || params.has('touch');
    // 關卡：網址 ?level=xxx（換關＝重新載入頁面，場景乾淨不殘留）
    this.level = getLevel(params.get('level')) || getLevel(this._load('lastLevel', 'training')) || LEVELS[0];
    this.menuPanel = params.has('level') ? 'brief' : 'start';
    this.progress = loadProgress(storage);
    cfg.player.spawn = this.level.spawn;
    document.body.classList.toggle('touch', this.touch);

    // 渲染器
    const renderer = (this.renderer = new THREE.WebGLRenderer({ antialias: !this.touch, powerPreference: 'high-performance' }));
    renderer.setPixelRatio(Math.min(devicePixelRatio, this.touch ? 1.5 : 2));
    renderer.setSize(innerWidth, innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(cfg.camera.fov, innerWidth / innerHeight, 0.1, 1500);

    // 場景與角色
    const L = this.level;
    const clearings = L.titans.map((t) => ({ x: t.x, z: t.z, r: (t.homeRadius ?? 25) + 6 * (t.scale ?? 1) }));
    // 畫風：toon＝卡通（粉彩、圓角，預設）／classic＝寫實；換畫風要重新載入
    cfg.style = this._load('artStyle', 'toon') === 'classic' ? 'classic' : 'toon';
    document.body.classList.toggle('toon', cfg.style === 'toon');
    this.city = buildCity(this.scene, cfg.world, L.spawn, this.touch, L.map, clearings, cfg.style);
    if (cfg.style === 'toon') toonifyScene(this.scene); // 城市換成分階明暗的卡通材質
    this.pc = new PlayerController(cfg);
    this.model = new PlayerModel(this.scene, cfg);
    // 刀身與裝置的金屬反光：用簡單的室內環境當反射來源（只套在角色的金屬上）
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.model.setEnvMap(pmrem.fromScene(new RoomEnvironment(), 0.04).texture);
    pmrem.dispose();
    this.titans = L.titans.map((sp) => new Titan(this.scene, cfg, sp));
    this.titan = this.titans[0] || NO_TITAN; // 目前的目標巨人（離玩家最近、活著的）
    this.mission = new Mission(L, this.scene, this.touch);
    document.body.classList.toggle('tutorial', L.objective === 'tutorial');
    document.body.classList.toggle('no-titans', this.titans.length === 0);
    this.titanRoots = this.titans.map((t) => t.root);
    this.titanSpheres = this.titans.flatMap((t) => t.spheres);

    this.hookables = [...this.city.hookables, ...this.titanRoots];
    this.aimer = new HookAimer(this.hookables);
    this.rig = new CameraRig(this.camera, cfg, this.city.hookables);
    this.fx = new Effects(this.scene, cfg);
    this.audio = new Audio();
    this.hud = new Hud(cfg);

    this.input = new Input(renderer.domElement, cfg);
    this.touchUI = new TouchControls(document.getElementById('touch'), this.input, cfg);
    this.touchUI.show(false);

    this.spawnYaw = Math.atan2(L.spawn.x - L.faceTo.x, L.spawn.z - L.faceTo.z);
    this.aims = { left: null, right: null, auto: null };
    this.autoSide = 'right';
    this.reticle = { x: 0, y: 0 }; // 準心在畫面上的位置（NDC，-1..1）
    // 鋼索模式：single = 單索（按住擺盪，預設）、dual = 左右雙索（進階）
    this.hookMode = this._load('hookMode2', 'single');
    // 鏡頭模式：follow = 空中自動轉向飛行方向；free = 不自動轉（鉤住時仍跟隨人物）；
    // fixed = 固定視角：只有右邊轉視角（或陀螺儀）會轉鏡頭，飛行、擺盪、繞圈、鎖定巨人都不會自動轉；
    // behind = 緊貼背後：鏡頭永遠轉到角色面朝的方向（空中打轉也一樣）
    this.camMode = this._load('camMode', this._load('cameraFollow2', cfg.camera.autoFollow ? 'on' : 'off') === 'on' ? 'follow' : 'free');
    if (!['follow', 'free', 'fixed', 'behind'].includes(this.camMode)) this.camMode = 'follow';
    this.cameraFollow = this.camMode === 'follow';
    this.pc.ropeStyle = this._load('ropeStyle', cfg.hook.style);
    this.hookFollow = this._load('hookFollow', cfg.camera.hookFollow ? 'on' : 'off') === 'on';
    this.pc.dashScale = Math.max(0.1, Math.min(2, Number(this._load('dashScale', String(cfg.dash.defaultScale))) || cfg.dash.defaultScale));
    this.aimSens = Math.max(0.5, Math.min(2, Number(this._load('aimSens', String(cfg.reticle.defaultSens))) || cfg.reticle.defaultSens));
    this.touchUI.sens = this.aimSens;
    this.touchUI.flickEnabled = this._load('flick2', cfg.reticle.flick.enabled ? 'on' : 'off') === 'on';
    this.gyro = new Gyro();
    this.gyroLevel = this._load('gyro', cfg.camera.gyro.defaultLevel);
    if (!(this.gyroLevel in cfg.camera.gyro.levels)) this.gyroLevel = cfg.camera.gyro.defaultLevel;
    this.lockCam = this._load('lockCam', cfg.camera.lock.enabled ? 'on' : 'off') === 'on';
    this.closeCam = this._load('closeCam', cfg.camera.close.enabled ? 'on' : 'off') === 'on';
    this.camRollLevel = this._load('camRoll2', cfg.camera.roll.defaultLevel);
    if (!(this.camRollLevel in cfg.camera.roll.levels)) this.camRollLevel = cfg.camera.roll.defaultLevel;
    this.joyTurnLevel = this._load('joyTurn', cfg.camera.joyTurn.defaultLevel);
    if (!(this.joyTurnLevel in cfg.camera.joyTurn.levels)) this.joyTurnLevel = cfg.camera.joyTurn.defaultLevel;
    this.speedLineLevel = this._load('speedLines', cfg.speedLines.defaultLevel);
    if (!(this.speedLineLevel in cfg.speedLines.levels)) this.speedLineLevel = cfg.speedLines.defaultLevel;
    this.fx.speedLines.level = cfg.speedLines.levels[this.speedLineLevel];
    this.pc.steerScale = Math.max(0.5, Math.min(3, Number(this._load('steerScale2', String(cfg.hook.pull.defaultSteerScale))) || cfg.hook.pull.defaultSteerScale));
    const num = (key, def, lo, hi) => {
      const v = Number(this._load(key, String(def)));
      return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : def;
    };
    this.pc.autoReel = num('autoReel', cfg.hook.pull.autoReel, 0, 20);
    cfg.hook.range = num('hookRange', cfg.hook.range, 60, 150);
    this.pc.orbitRadius = num('orbitRadius', cfg.hook.pull.orbitRadius, 4, 20);
    this.pc.speedScale = Math.max(0.1, Math.min(1.5, Number(this._load('speedScale2', String(cfg.player.defaultSpeedScale))) || cfg.player.defaultSpeedScale));
    this.touchUI.setMode(this.hookMode);

    this.strikeEval = { dist: 999, speed: 0, ok: false, inRange: false, fastEnough: false, angleOk: false, lunge: false };
    this.napePos = new THREE.Vector3();
    this.state = 'menu';
    this.clock = new THREE.Clock();
    this.hitStop = 0;
    this.strikeCooldown = 0;
    this.endTimer = 0;
    this.wasReady = false;

    this._bindUI();
    addEventListener('resize', () => this.resize());
    this.resize();
    this.restart(false);
    window.__game = this; // 方便除錯與自動化測試
    renderer.setAnimationLoop(() => this.frame());
  }

  _bindUI() {
    const $ = (id) => document.getElementById(id);
    $('btn-start').addEventListener('click', () => this.start());
    $('btn-levels').addEventListener('click', () => this._renderLevels() || this.showPanel('start'));
    for (const b of document.querySelectorAll('[data-levels]')) b.addEventListener('click', () => this._goLevel(null));
    $('btn-next').addEventListener('click', () => {
      const n = nextLevel(this.level.id);
      if (n) this._goLevel(n.id);
    });
    this._renderLevels();
    this._renderBrief();
    $('btn-resume').addEventListener('click', () => this.resume());
    for (const b of document.querySelectorAll('[data-restart]')) b.addEventListener('click', () => this.restart(true));
    $('btn-mode').addEventListener('click', () => {
      this.hookMode = this.hookMode === 'single' ? 'dual' : 'single';
      this._save('hookMode2', this.hookMode);
      this.touchUI.setMode(this.hookMode);
      this._releaseHeld();
      this._syncModeLabel();
    });
    $('btn-style').addEventListener('click', () => {
      this.pc.releaseAll();
      this._releaseHeld();
      this.pc.ropeStyle = this.pc.ropeStyle === 'pull' ? 'swing' : 'pull';
      this._save('ropeStyle', this.pc.ropeStyle);
      this._syncModeLabel();
    });
    $('btn-hookfollow').addEventListener('click', () => {
      this.hookFollow = !this.hookFollow;
      this._save('hookFollow', this.hookFollow ? 'on' : 'off');
      this._syncModeLabel();
    });
    const setSpeed = (d) => {
      this.pc.speedScale = Math.round(Math.max(0.1, Math.min(1.5, this.pc.speedScale + d)) * 10) / 10;
      this._save('speedScale2', String(this.pc.speedScale));
      this._syncModeLabel();
    };
    const setDash = (d) => {
      this.pc.dashScale = Math.round(Math.max(0.1, Math.min(2, this.pc.dashScale + d)) * 10) / 10;
      this._save('dashScale', String(this.pc.dashScale));
      this._syncModeLabel();
    };
    const setSteer = (d) => {
      this.pc.steerScale = Math.round(Math.max(0.5, Math.min(3, this.pc.steerScale + d)) * 10) / 10;
      this._save('steerScale2', String(this.pc.steerScale));
      this._syncModeLabel();
    };
    const setSens = (d) => {
      this.aimSens = Math.round(Math.max(0.5, Math.min(2, this.aimSens + d)) * 10) / 10;
      this.touchUI.sens = this.aimSens;
      this._save('aimSens', String(this.aimSens));
      this._syncModeLabel();
    };
    $('sens-down').addEventListener('click', () => setSens(-0.1));
    $('sens-up').addEventListener('click', () => setSens(0.1));
    $('btn-flick').addEventListener('click', () => {
      this.touchUI.flickEnabled = !this.touchUI.flickEnabled;
      this._save('flick2', this.touchUI.flickEnabled ? 'on' : 'off');
      this._syncModeLabel();
    });
    $('btn-gyro').addEventListener('click', async () => {
      const order = ['off', 'low', 'mid', 'high'];
      const next = order[(order.indexOf(this.gyroLevel) + 1) % order.length];
      if (next !== 'off' && !this.gyro.enabled && !(await this.gyro.enable())) {
        this.gyroLevel = 'off';
        this.hud.toast(this.gyro.available ? '沒有取得陀螺儀權限' : '這個裝置不支援陀螺儀', 'warn', 1.6);
      } else {
        this.gyroLevel = next;
        if (next === 'off') this.gyro.disable();
      }
      this._save('gyro', this.gyroLevel);
      this._syncModeLabel();
    });
    $('btn-artstyle').addEventListener('click', () => {
      this._save('artStyle', this.cfg.style === 'toon' ? 'classic' : 'toon');
      location.reload();
    });
    $('btn-lockcam').addEventListener('click', () => {
      this.lockCam = !this.lockCam;
      this._save('lockCam', this.lockCam ? 'on' : 'off');
      this._syncModeLabel();
    });
    $('btn-closecam').addEventListener('click', () => {
      this.closeCam = !this.closeCam;
      this._save('closeCam', this.closeCam ? 'on' : 'off');
      this._syncModeLabel();
    });
    $('btn-camroll').addEventListener('click', () => {
      const order = ['high', 'low', 'off'];
      this.camRollLevel = order[(order.indexOf(this.camRollLevel) + 1) % order.length];
      this._save('camRoll2', this.camRollLevel);
      this._syncModeLabel();
    });
    $('btn-joyturn').addEventListener('click', () => {
      const order = ['high', 'mid', 'low', 'off'];
      this.joyTurnLevel = order[(order.indexOf(this.joyTurnLevel) + 1) % order.length];
      this._save('joyTurn', this.joyTurnLevel);
      this._syncModeLabel();
    });
    $('btn-lines').addEventListener('click', () => {
      const order = ['high', 'mid', 'low', 'off'];
      this.speedLineLevel = order[(order.indexOf(this.speedLineLevel) + 1) % order.length];
      this.fx.speedLines.level = this.cfg.speedLines.levels[this.speedLineLevel];
      this._save('speedLines', this.speedLineLevel);
      this._syncModeLabel();
    });
    const setReel = (d) => {
      this.pc.autoReel = Math.max(0, Math.min(20, this.pc.autoReel + d));
      this._save('autoReel', String(this.pc.autoReel));
      this._syncModeLabel();
    };
    const setOrbit = (d) => {
      this.pc.orbitRadius = Math.max(4, Math.min(20, this.pc.orbitRadius + d));
      this._save('orbitRadius', String(this.pc.orbitRadius));
      this._syncModeLabel();
    };
    const setRange = (d) => {
      this.cfg.hook.range = Math.max(60, Math.min(150, this.cfg.hook.range + d));
      this._save('hookRange', String(this.cfg.hook.range));
      this._syncModeLabel();
    };
    $('range-down').addEventListener('click', () => setRange(-10));
    $('range-up').addEventListener('click', () => setRange(10));
    $('reel-down').addEventListener('click', () => setReel(-1));
    $('reel-up').addEventListener('click', () => setReel(1));
    $('orbit-down').addEventListener('click', () => setOrbit(-1));
    $('orbit-up').addEventListener('click', () => setOrbit(1));
    $('steer-down').addEventListener('click', () => setSteer(-0.1));
    $('steer-up').addEventListener('click', () => setSteer(0.1));
    $('dash-down').addEventListener('click', () => setDash(-0.1));
    $('dash-up').addEventListener('click', () => setDash(0.1));
    $('spd-down').addEventListener('click', () => setSpeed(-0.1));
    $('spd-up').addEventListener('click', () => setSpeed(0.1));
    $('btn-follow').addEventListener('click', () => {
      const order = ['follow', 'free', 'fixed', 'behind'];
      this.camMode = order[(order.indexOf(this.camMode) + 1) % order.length];
      this.cameraFollow = this.camMode === 'follow';
      this._save('camMode', this.camMode);
      this._syncModeLabel();
    });
    $('btn-mute').addEventListener('click', () => {
      this.audio.setMuted(!this.audio.muted);
      $('btn-mute').textContent = this.audio.muted ? '音效：關' : '音效：開';
    });
    $('btn-help').addEventListener('click', () => $('help').classList.toggle('open'));
    this.renderer.domElement.addEventListener('click', () => {
      if (this.state === 'playing' && !this.touch && !this.input.locked) this.input.requestLock();
    });
    this._syncModeLabel();
  }

  _syncModeLabel() {
    document.getElementById('btn-mode').textContent = this.hookMode === 'single' ? '鋼索：單索（按住擺盪）' : '鋼索：左右雙索（進階）';
    document.getElementById('btn-style').textContent = this.pc.ropeStyle === 'pull' ? '鋼索手感：拉索（勾住被拉過去）' : '鋼索手感：擺盪（鐘擺）';
    document.getElementById('btn-hookfollow').textContent = this.hookFollow ? '鉤住時鏡頭跟隨人物：開' : '鉤住時鏡頭跟隨人物：關';
    document.getElementById('spd-val').textContent = `速度 ${Math.round(this.pc.speedScale * 100)}%`;
    document.getElementById('dash-val').textContent = `衝刺 ${Math.round(this.pc.dashScale * 100)}%（${Math.round(this.cfg.dash.speed * this.pc.dashScale)} m/s）`;
    document.getElementById('range-val').textContent = `鉤索射程 ${this.cfg.hook.range}m`;
    document.getElementById('reel-val').textContent = this.pc.autoReel > 0 ? `自動收繩 ${this.pc.autoReel} m/秒` : '自動收繩：關';
    document.getElementById('orbit-val').textContent = `繞圈半徑 ${this.pc.orbitRadius}m（巨人 ×${(this.cfg.hook.pull.orbitTitanFactor * 1).toFixed(2)}×體型）`;
    document.getElementById('btn-artstyle').textContent = `畫風：${this.cfg.style === 'toon' ? '卡通' : '寫實'}（點一下切換，會重新載入）`;
    document.getElementById('btn-lockcam').textContent = `鎖定鏡頭（勾住巨人時）：${this.lockCam ? '開' : '關'}`;
    document.getElementById('btn-closecam').textContent = `近距離廣角鏡頭：${this.closeCam ? '開' : '關'}`;
    document.getElementById('btn-camroll').textContent = `鏡頭側傾：${{ high: '18°', low: '9°', off: '0°（不傾斜）' }[this.camRollLevel]}`;
    document.getElementById('btn-gyro').textContent = `陀螺儀瞄準：${{ high: '強', mid: '中', low: '弱', off: '關' }[this.gyroLevel]}`;
    document.getElementById('btn-joyturn').textContent = `空中左搖桿轉鏡頭：${{ high: '強', mid: '中', low: '弱', off: '關' }[this.joyTurnLevel]}`;
    document.getElementById('btn-lines').textContent = `速度線：${{ high: '高', mid: '中', low: '低', off: '關' }[this.speedLineLevel]}`;
    document.getElementById('sens-val').textContent = `準心靈敏度 ${Math.round(this.aimSens * 100)}%`;
    document.getElementById('btn-flick').textContent = this.touchUI.flickEnabled ? '快速甩動轉身：開' : '快速甩動轉身：關';
    document.getElementById('steer-val').textContent = `左右擺盪 ${Math.round(this.pc.steerScale * 100)}%（${Math.round(this.cfg.hook.pull.steerAccel * this.pc.steerScale)} m/s²）`;
    document.getElementById('btn-follow').textContent = `鏡頭：${{ follow: '跟隨飛行方向', free: '不跟隨飛行方向', fixed: '固定視角（只手動轉）', behind: '緊貼角色背後' }[this.camMode]}`;
    document.body.classList.toggle('dual', this.hookMode === 'dual');
  }

  _load(key, def) {
    try {
      return localStorage.getItem(key) || def;
    } catch {
      return def;
    }
  }

  _save(key, val) {
    try {
      localStorage.setItem(key, val);
    } catch {}
  }

  _releaseHeld() {
    this.touchUI.cancelAim?.();
  }

  showPanel(id) {
    for (const p of document.querySelectorAll('.panel')) p.hidden = p.id !== id;
    document.body.classList.toggle('panel-open', !!id);
    document.getElementById('hud').classList.toggle('dim', !!id);
  }

  start() {
    this.audio.init();
    // 陀螺儀：iOS 只能在點擊時要權限，所以在「開始遊戲」這一下順便開啟
    if (this.gyroLevel !== 'off' && !this.gyro.enabled) {
      this.gyro.enable().then((ok) => {
        if (!ok) {
          this.gyroLevel = 'off';
          this._syncModeLabel();
        }
      });
    }
    if (this.touch) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      this.input.requestLock();
    }
    this.state = 'playing';
    this.input.enabled = true;
    this.showPanel(null);
    this.touchUI.show(this.touch);
    this._save('lastLevel', this.level.id);
    const hint = { tutorial: '照畫面上方的提示操作，閃爍的按鈕就是現在要用的', training: '照畫面上方的提示一步一步練習', rings: '跟著黃色圓圈與箭頭，依序穿過光圈！', kill: '從高處躍下，用鋼索擺盪接近巨人！' };
    this.hud.toast(hint[this.level.objective === 'kill' ? 'kill' : this.level.objective], '', 2.5);
  }

  resume() {
    if (this.state !== 'paused') return;
    this.audio.init();
    if (!this.touch) this.input.requestLock();
    this.state = 'playing';
    this.showPanel(null);
    this.touchUI.show(this.touch);
    this._missionEvent('pause'); // 教學：看過暫停選單、按「繼續」回來
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.showPanel('pause');
    this.touchUI.show(false);
    this.pc.releaseAll();
    this._releaseHeld();
    this.input.touch.boost = false;
    if (document.pointerLockElement) document.exitPointerLock();
  }

  restart(play) {
    this.pc.reset();
    this.pc.grabbedBy = null;
    this.grab = null;
    for (const t of this.titans) t.reset();
    this.titan = this.titans[0] || NO_TITAN;
    this.mission.reset();
    this.rig.reset(this.spawnYaw);
    this.fx.reset();
    this.stats = { time: 0, strikes: 0, napeHits: 0, best: 0, hurt: false };
    this.hitStop = 0;
    this.slowMo = 0;
    this.slowMoMax = 1;
    this.burst = 0;
    this.endTimer = 0;
    this.strikeCooldown = 0;
    this.chroma = 0;
    this.impact = 0;
    this.flickTurn = null;
    this.passThrough = 0;
    this.strikeHold = null;
    this.tut = null;
    this._updateMission();
    this._tutorialHighlight();
    if (play) {
      this.state = 'playing';
      this.input.enabled = true;
      this.showPanel(null);
      this.touchUI.show(this.touch);
      this.audio.init();
      if (!this.touch && !this.input.locked) this.input.requestLock();
    } else {
      this.showPanel(this.menuPanel);
    }
  }

  // ────────────────────────── 關卡選擇 ──────────────────────────
  /** 換關：重新載入頁面（null＝回到關卡列表） */
  _goLevel(id) {
    if (id && id === this.level.id) {
      this.restart(false);
      this.showPanel('brief');
      return;
    }
    location.search = id ? `?level=${id}` : '';
  }

  _stars(n, total = 3) {
    return '★'.repeat(n) + '☆'.repeat(total - n);
  }

  _renderLevels() {
    const list = document.getElementById('level-list');
    list.innerHTML = '';
    LEVELS.forEach((L, i) => {
      const unlocked = isUnlocked(this.progress, L.id);
      const p = this.progress[L.id];
      const b = document.createElement('button');
      b.className = `level-card${unlocked ? '' : ' locked'}`;
      b.disabled = !unlocked;
      b.innerHTML = `<span class="lv-no">${i + 1}</span><span class="lv-main"><b>${L.name}</b><small>${unlocked ? L.brief : '過了前一關才會解鎖'}</small></span><span class="lv-stars">${unlocked ? this._stars(p?.stars || 0) : '🔒'}</span>`;
      b.addEventListener('click', () => this._goLevel(L.id));
      list.appendChild(b);
    });
  }

  _renderBrief() {
    const L = this.level;
    const p = this.progress[L.id];
    document.getElementById('brief-title').textContent = `${LEVELS.indexOf(L) + 1}. ${L.name}`;
    document.getElementById('brief-text').textContent = L.brief;
    const goals = L.steps ? L.steps.map((s) => `<li>${s.text}</li>`).join('') : '';
    document.getElementById('brief-steps').innerHTML = goals;
    document.getElementById('brief-steps').hidden = !goals;
    document.getElementById('brief-stars').innerHTML = L.stars.map((s, i) => `<li><span>${p && p.stars > i ? '★' : '☆'}</span>${starText(s)}</li>`).join('');
    document.getElementById('brief-best').textContent = p?.time != null ? `最佳紀錄 ${p.time.toFixed(1)} 秒` : '';
  }

  _missionEvent(type) {
    const msg = this.mission.event(type);
    if (msg) {
      this.hud.toast(msg, 'good', 1.6);
      this.audio.play('ready');
    }
    this._updateMission();
    this._tutorialHighlight();
  }

  /** 操作教學：閃爍提示目前要用的按鈕／搖桿區 */
  _tutorialHighlight() {
    const cur = this.mission.current;
    for (const el of document.querySelectorAll('.tut-hl')) el.classList.remove('tut-hl');
    document.body.classList.toggle('tut-joy', !!(cur && cur.hl === 'joy' && this.touch));
    document.body.classList.toggle('tut-look', !!(cur && cur.hl === 'look' && this.touch));
    if (cur && cur.hl && cur.hl.startsWith('.')) for (const el of document.querySelectorAll(cur.hl)) el.classList.add('tut-hl');
  }

  /** 操作教學：持續動作的判定（走一段路、轉視角、勾住時推搖桿） */
  _tutorialTick(dt, intent) {
    const cur = this.mission.current;
    if (!cur || this.state !== 'playing') return;
    const pc = this.pc;
    const T = (this.tut = this.tut || { move: 0, look: 0, fwd: 0, side: 0 });
    if (cur.id === 'move' && pc.grounded && Math.hypot(pc.vel.x, pc.vel.z) > 2) T.move += Math.hypot(pc.vel.x, pc.vel.z) * dt;
    if (cur.id === 'look') T.look += Math.abs(intent.lookDX || 0) + (this.touch ? Math.abs(this.input.touch.turnX) * this.cfg.reticle.maxTurnRate * dt : 0);
    if (cur.id === 'ropeFwd' && pc.anyAttached && intent.move.y > 0.6) T.fwd += dt;
    if (cur.id === 'ropeSide' && pc.anyAttached && Math.abs(intent.move.x) > 0.6) T.side += dt;
    if (T.move > 12) this._missionEvent('move');
    if (T.look > 1.2) this._missionEvent('look');
    if (T.fwd > 0.6) this._missionEvent('ropeFwd');
    if (T.side > 0.8) this._missionEvent('ropeSide');
  }

  resize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
  }

  // ────────────────────────── 輸入事件 ──────────────────────────
  _launcherPos(side) {
    return this.model.launcherWorld(side, new THREE.Vector3());
  }

  /**
   * 鋼索鍵（切換式）：沒勾住 → 發射；已勾住（或飛行中）→ 放開。
   * key = 'auto'（單索，依勾點位置選左右發射器）或 'left' / 'right'（雙索）
   */
  _hookToggle(key) {
    const pc = this.pc;
    if (key === 'auto') {
      if (pc.hooks.left.active || pc.hooks.right.active) {
        pc.releaseAll();
        return;
      }
    } else if (pc.hooks[key].active) {
      pc.releaseHook(key);
      return;
    }
    const aim = this.aims[key];
    if (!aim) {
      this.audio.play('miss');
      this.hud.toast(`準星上沒有可勾的目標（射程 ${this.cfg.hook.range}m）`, 'warn', 0.8);
      return;
    }
    const side = key === 'auto' ? this.autoSide : key;
    pc.fireHook(side, this._launcherPos(side), aim);
    if (!this.touch) this._missionEvent('aimFire'); // 電腦：瞄準後點左鍵發射＝教學的「瞄準發射」
  }

  /** 準心搖桿放開：朝準心發射；已勾住時直接換到新的勾點 */
  _hookAimFire(key) {
    const pc = this.pc;
    const aim = this.aims[key];
    if (!aim) {
      this.audio.play('miss');
      this.hud.toast(`準心上沒有可勾的目標（射程 ${this.cfg.hook.range}m）`, 'warn', 0.8);
      return;
    }
    const side = key === 'auto' ? this.autoSide : key;
    if (key === 'auto') {
      const other = side === 'left' ? 'right' : 'left';
      if (pc.hooks[other].active) pc.hooks[other].release(); // 換勾點：舊的直接收回，不觸發放索加成
    }
    pc.fireHook(side, this._launcherPos(side), aim);
    this._missionEvent('aimFire');
  }

  _handleEvent(ev) {
    const pc = this.pc;
    if (ev === 'pause' || ev === 'lockLost') {
      if (this.state === 'playing') this.pause();
      else if (this.state === 'paused' && ev === 'pause') this.resume();
      return;
    }
    if (ev === 'restart') {
      this.restart(true);
      return;
    }
    if (ev === 'help') {
      document.getElementById('help').classList.toggle('open');
      return;
    }
    if (ev.startsWith('flick:')) {
      if (this.state === 'playing') {
        const a = (Number(ev.slice(6)) * this.cfg.reticle.flick.angleDeg * Math.PI) / 180;
        this.flickTurn = { total: a, left: a };
        this.audio.play('hookRelease');
      }
      return;
    }
    if (ev === 'reticleReset') {
      this.input.touch.aimX = this.input.touch.aimY = 0;
      return;
    }
    if (this.state !== 'playing' || pc.hp <= 0) return;
    switch (ev) {
      case 'releaseAll':
        this._releaseHeld();
        pc.releaseAll();
        break;
      default:
        if (ev.startsWith('down:') || ev.startsWith('up:') || ev.startsWith('aim:')) {
          const [kind, k] = ev.split(':');
          const key = this.hookMode === 'single' ? 'auto' : k === 'auto' ? 'right' : k;
          if (kind === 'down') this._hookToggle(key); // 放開按鍵不做事（按一下勾、再按一下放）
          else if (kind === 'aim') this._hookAimFire(key); // 準心搖桿拖曳後放開：朝準心發射
        }
        break;
      case 'strike':
        if (this.grab) this._struggle();
        else if (this._leviSide()) this.strikeHold = { t: 0 }; // 勾住時：放開前看是短按還是長按（兵長斬）
        else this._strike();
        break;
      case 'strikeUp':
        if (this.strikeHold) {
          this.strikeHold = null;
          this._strike();
        }
        break;
    }
  }

  // ────────────────────────── 戰鬥 ──────────────────────────
  _updateMission() {
    this.hud.setMission(this.mission.text(this.titans));
  }

  /** 目前勾住的巨人（沒有則 null） */
  _hookedTitan() {
    for (const side of ['left', 'right']) {
      const h = this.pc.hooks[side];
      if (h.attached && h.object && h.object.userData.titan) return h.object.userData.titan;
    }
    return null;
  }

  /** 選擇目標巨人：勾住的優先，否則選後頸離玩家最近的（有一點黏性，避免一直切換） */
  _pickTarget() {
    const hooked = this._hookedTitan();
    if (hooked && hooked.alive) {
      this.titan = hooked;
      return;
    }
    let best = null, bestD = Infinity;
    for (const t of this.titans) {
      if (!t.alive) continue;
      const d = t.napeWorld(_v).distanceTo(this.pc.pos) * (t === this.titan ? 0.8 : 1);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    if (best) this.titan = best;
  }

  _evaluate() {
    const t = this.titan;
    t.napeWorld(this.napePos);
    const ev = evaluateStrike({ playerPos: this.pc.pos, playerVel: this.pc.vel, napePos: this.napePos, titanForward: t.forward, speedScale: this.pc.speedScale }, this.cfg);
    _v.subVectors(this.napePos, this.pc.pos);
    ev.lunge = t.alive && !this.pc.lunge && canLunge(ev, _v, this.rig.forward, this.pc.gas, this.cfg);
    return ev;
  }

  _strike() {
    if (this.strikeCooldown > 0 || this.pc.lunge) return;
    this._missionEvent('strike');
    this.strikeCooldown = this.cfg.strike.cooldown;
    this.stats.strikes++;
    this.audio.play('slash');
    const dir = this.pc.speed > 2 ? _v2.copy(this.pc.vel).normalize() : _v2.copy(this.rig.forward);

    // 勾在巨人身上、而且離巨人不遠 → 迴旋斬
    const hooked = this._hookedTitan();
    if (hooked && hooked.alive && hooked.napeWorld(_v).distanceTo(this.pc.pos) < this.cfg.strike.spinRange * hooked.scale + 8) {
      this._spinAttack(hooked);
      return;
    }

    // 地面（或低空）靠近巨人腳邊 → 迴旋斬砍腳
    const T = this.cfg.titan;
    for (const t of this.titans) {
      if (!t.alive || t.kneelTimer > 0) continue;
      if (this.pc.pos.y > 5 * t.scale) continue;
      const r = T.partRange * t.scale * this.cfg.strike.groundSpinRange;
      if (t.ankleWorld('L', _v).distanceTo(this.pc.pos) < r || t.ankleWorld('R', _v).distanceTo(this.pc.pos) < r) {
        this._spinAttack(t, true);
        return;
      }
    }

    this.model.startSlash();
    this.fx.slash(_v.copy(this.pc.pos).addScaledVector(dir, 1.2), dir, this.model.slashSide, false);
    if (!this.titan.alive) return;
    const ev = this._evaluate();
    if (ev.ok) {
      this._napeHit(ev);
    } else if (this._partHit()) {
      // 已在 _partHit 處理（眼睛／腳）
    } else if (ev.lunge) {
      // 衝刺斬：自動吸向弱點，抵達後再判定
      const target = this.titan;
      this.pc.gas -= this.cfg.strike.lungeGas;
      this.pc.releaseAll();
      this.pc.lunge = { timer: this.cfg.strike.lungeDuration, target: () => target.napeWorld(this.napePos), done: false };
      this.audio.play('boost');
      this.rig.addShake(0.2);
      this.rig.kick(10); // 衝刺斬：視角拉寬，速度感
      this.chroma = 0.45;
    } else if (this._bodyHit()) {
      // 已在 _bodyHit 處理
    } else if (ev.dist < this.cfg.strike.lungeRange && !ev.angleOk) {
      this.hud.toast('正面無法斬擊後頸！繞到後方，或砍眼睛、腳', 'warn', 1.4);
    } else if (ev.inRange && !ev.fastEnough) {
      this.hud.toast(`速度不足（需 ${(this.cfg.strike.minSpeed * this.pc.speedScale).toFixed(0)} m/s）`, 'warn', 1.2);
    }
  }

  /** 可以發動兵長斬的鋼索（勾住中，優先勾在巨人身上的那條）；沒有則 null */
  _leviSide() {
    const pc = this.pc;
    if (pc.busy || this.grab) return null;
    let side = null;
    for (const s of ['left', 'right']) {
      const h = pc.hooks[s];
      if (!h.attached) continue;
      if (h.object && h.object.userData.titan) return s;
      side = side || s;
    }
    return side;
  }

  /** 長按斬擊（勾住時）：處理短按／長按判定 */
  _updateStrikeHold(realDt) {
    const hold = this.strikeHold;
    if (!hold) return;
    const side = this._leviSide();
    if (!side) {
      // 鋼索在按住期間被解除：當成一般斬擊
      this.strikeHold = null;
      this._strike();
      return;
    }
    hold.t += realDt;
    if (hold.t < this.cfg.strike.leviHold) return;
    this.strikeHold = null;
    if (this.pc.startLevi(side)) {
      this.leviTitan = this.pc.hooks[side].object?.userData.titan || null;
      this.audio.play('ready');
      this.rig.kick(-5); // 短拍：鏡頭先往內收
    }
  }

  /** 兵長斬抵達：依勾點位置判定後頸／眼睛／腳／身體，命中後鋼索自動解除 */
  _leviFinish() {
    const pc = this.pc;
    const C = this.cfg.strike;
    const titan = this.leviTitan;
    pc.levi = null;
    this.leviTitan = null;
    this.stats.strikes++;
    this.model.startSpin();
    this.fx.spinRing(pc.pos, '#ff7ab8');
    this.audio.play('slash');
    this.audio.play('swing');
    let legCut = false;
    if (titan && titan.alive) {
      this.titan = titan;
      const range = C.leviRange * titan.scale;
      const ev = this._evaluate();
      // 勾在哪就砍哪：取離角色最近的部位（後頸／眼睛／腳踝）
      const p = pc.pos;
      const eye = Math.min(titan.eyeWorld(0, _v).distanceTo(p), titan.eyeWorld(1, _v).distanceTo(p));
      const ankle = Math.min(titan.ankleWorld('L', _v).distanceTo(p), titan.ankleWorld('R', _v).distanceTo(p));
      const kneel = titan.kneelTimer;
      if (ev.dist <= range && ev.dist <= eye && ev.dist <= ankle) {
        ev.damage = Math.round(Math.min(C.maxDamage, napeDamage(Math.max(ev.speed, C.minSpeed), this.cfg) * C.leviDamageBonus));
        this._napeHit(ev, true, '兵長斬！');
      } else if (!this._partHit(range * 0.7, true)) {
        this._bodyHit(range * 0.5);
      }
      this._missionEvent('levi');
      legCut = titan.kneelTimer > kneel; // 砍到腳：交給「滑到背後」處理速度
    } else {
      this.rig.addShake(0.3);
    }
    // 鋼索自動解除，帶著慣性往上彈出去（可穿過巨人身體一下）
    pc.releaseAll();
    if (legCut) return;
    pc.vel.multiplyScalar(0.7);
    pc.vel.y = Math.max(pc.vel.y, 0) + C.leviPop * Math.max(0.6, pc.speedScale);
    this.passThrough = Math.max(this.passThrough, 0.6);
  }

  /** 地面滑鏟經過巨人腳踝：自動砍腳 */
  _groundDashCut() {
    const pc = this.pc;
    if (pc.groundDashTimer <= 0 || this.strikeCooldown > 0) return;
    const T = this.cfg.titan;
    for (const t of this.titans) {
      if (!t.alive || t.kneelTimer > 0) continue;
      const r = T.partRange * t.scale * this.cfg.strike.groundSpinRange;
      if (t.ankleWorld('L', _v).distanceTo(pc.pos) < r || t.ankleWorld('R', _v).distanceTo(pc.pos) < r) {
        this.strikeCooldown = this.cfg.strike.cooldown;
        this.stats.strikes++;
        this.audio.play('slash');
        this._spinAttack(t, true);
        return;
      }
    }
  }

  /** 迴旋斬：勾在巨人身上時出招，範圍大、不限方向（後頸仍需從側後方） */
  _spinAttack(titan, ground = false) {
    const C = this.cfg.strike;
    this.model.startSpin();
    this.fx.spinRing(this.pc.pos);
    this.audio.play('swing');
    this.rig.addShake(0.3);
    this.titan = titan;
    if (ground) {
      // 地面迴旋斬：專砍腳（不需要速度）
      const r = this.cfg.titan.partRange * titan.scale * C.groundSpinRange;
      if (!this._partHit(r, true)) this._bodyHit(r);
      return;
    }
    const ev = this._evaluate();
    const range = C.spinRange * titan.scale;
    const minSp = C.minSpeed * C.spinSpeedFactor;
    if (ev.dist <= range && ev.speed >= minSp && ev.angleOk) {
      ev.damage = Math.round(Math.min(C.maxDamage, napeDamageSpin(ev.speed, this.cfg)));
      this._napeHit(ev, true);
    } else if (!this._partHit(range)) {
      this._bodyHit(range);
    }
  }

  /** 部位斬擊：眼睛＝暈眩、腳（小腿下段）＝跪下 */
  _partHit(rangeOverride, ignoreSpeed = false) {
    const T = this.cfg.titan;
    const C = this.cfg.strike;
    if (!ignoreSpeed && this.pc.feelSpeed < C.minSpeed * 0.6) return false;
    for (const t of this.titans) {
      if (!t.alive) continue;
      const r = rangeOverride ?? T.partRange * t.scale;
      for (const i of [0, 1]) {
        if (t.stunTimer <= 0 && t.eyeWorld(i, _v).distanceTo(this.pc.pos) <= r) {
          t.takePartHit('eye', T.eyeDamage);
          this._partFx(_v, '眼睛！暈眩', t);
          return true;
        }
      }
      for (const side of ['L', 'R']) {
        if (t.kneelTimer <= 0 && t.ankleWorld(side, _v).distanceTo(this.pc.pos) <= r * 1.2) {
          t.takePartHit('leg', T.legDamage);
          this._partFx(_v, '腳筋！跪下', t);
          this._missionEvent('leg');
          this._legSlide(t);
          return true;
        }
      }
    }
    return false;
  }

  /** 砍完腳：帶著慣性從巨人腳邊滑到它背後（滑行時可穿過巨人身體） */
  _legSlide(titan) {
    const C = this.cfg.strike;
    const pc = this.pc;
    for (const side of ['left', 'right']) {
      const h = pc.hooks[side];
      if (h.active && h.object && h.object.userData.titan === titan) h.release();
    }
    const behind = _v2.copy(titan.root.position).addScaledVector(titan.forward, -C.legSlideBehind * titan.scale);
    const dir = behind.sub(pc.pos).setY(0);
    const dist = dir.length();
    if (dist < 1e-3) return;
    dir.multiplyScalar(1 / dist);
    // 速度至少要能滑到背後（滑行減速 decel：v² = 2·a·d）
    const need = Math.sqrt(2 * this.cfg.slide.decel * dist) + 2;
    const hs = Math.hypot(pc.vel.x, pc.vel.z);
    const sp = Math.max(hs, need, C.legSlideSpeed * Math.max(0.5, pc.speedScale));
    pc.vel.x = dir.x * sp;
    pc.vel.z = dir.z * sp;
    if (pc.pos.y < 3) {
      pc.vel.y = Math.min(pc.vel.y, 0);
      pc.sliding = true;
    }
    this.passThrough = C.passThrough;
    this.rig.kick(6);
    this.fx.dust(pc.pos, pc.vel, 12);
  }

  _partFx(point, label, titan) {
    const p = point.clone();
    const dir = _v2.copy(this.pc.vel).normalize();
    this.model.startSlash();
    this.fx.burst(p, 1.0, '#ffd0a0', 0.2);
    this.fx.bladeHit(p, dir, false);
    this.fx.napeHit(p, dir, false);
    titan.addWound(p, 0.9 * titan.scale);
    this.rig.punch(p);
    this.audio.play('hitNape');
    this.hitStop = 0.08;
    this.slowMo = this.slowMoMax = 0.25;
    this.rig.addShake(0.5);
    this.rig.kick(-6);
    this.chroma = 0.3;
    const sp = this.hud.project(p, this.camera, {});
    this.hud.popup(sp.x, sp.y - 16, label, 'crit');
    if (!titan.alive) this._onKill(titan);
  }

  _bodyHit(rangeOverride) {
    const C = this.cfg.strike;
    for (const t of this.titans) {
      if (!t.alive) continue;
      for (const s of t.spheres) {
        if (this.pc.pos.distanceTo(s.center) - s.r <= (rangeOverride ?? C.bodyRange)) {
          t.takeHit(C.bodyDamage, false);
          t.addWound(_v.copy(this.pc.pos).lerp(s.center, 0.75), 0.7 * t.scale);
          this.audio.play('hitBody');
          this.fx.napeHit(_v.copy(this.pc.pos).lerp(s.center, 0.6), this.pc.vel.clone().normalize(), false);
          this.hud.toast('表皮傷害——瞄準後頸、眼睛或腳', '', 1.2);
          this.rig.addShake(0.3);
          this.hitStop = 0.05; // 小頓點
          if (!t.alive) this._onKill(t);
          return true;
        }
      }
    }
    return false;
  }

  _napeHit(ev, spin = false, label = null) {
    const C = this.cfg.strike;
    const titan = this.titan;
    const dmg = ev.damage;
    const perfect = dmg >= C.perfectDamage;
    const armored = titan.armor > 0;
    titan.takeHit(dmg, true);
    if (armored) label = label || '鎧甲！';
    this.stats.napeHits++;
    this._missionEvent('nape');
    if (!spin) this.model.startSlash();
    const dir = _v2.copy(this.pc.vel).normalize();
    this.fx.burst(this.napePos, perfect ? 1.8 : 1.3, perfect ? '#ffb070' : '#ffd8b0', 0.24);
    this.fx.bladeHit(this.napePos, dir, perfect);
    this.fx.napeHit(this.napePos, dir, perfect);
    titan.addWound(this.napePos, 1.3 * titan.scale);
    this.rig.punch(this.napePos);
    this.impact = this.cfg.strike.impactFrame;
    if (perfect) this.hud.killBurst(false);
    this.audio.play('hitNape');
    // 頓點 → 慢動作 → 恢復；鏡頭往前推並猛震
    this.hitStop = perfect ? C.hitStopPerfect : C.hitStop;
    this.slowMo = this.slowMoMax = perfect ? C.slowMoPerfect : C.slowMo;
    this.rig.kick(perfect ? -14 : -9);
    this.rig.addShake(perfect ? 1.1 : 0.75);
    this.burst = 1;
    this.chroma = perfect ? 0.6 : 0.4;
    this.hud.flash(perfect ? 'rgba(255,225,180,0.5)' : 'rgba(255,255,255,0.3)');
    // 不顯示傷害數字，只用一個字強調
    const sp = this.hud.project(this.napePos, this.camera, {});
    this.hud.popup(sp.x, sp.y - 20, label || (spin ? '迴旋斬！' : perfect ? '完美斬擊！' : '斬！'), perfect ? 'perfect' : 'crit');
    this.pc.vel.y = Math.max(this.pc.vel.y, 0) + 5; // 斬過後微微上彈
    if (!titan.alive) this._onKill(titan);
  }

  /** 巨人死亡：勾在它身上的鋼索自動解除、擊殺特寫、更新任務 */
  _onKill(titan) {
    for (const side of ['left', 'right']) {
      const h = this.pc.hooks[side];
      if (h.active && h.object && h.object.userData.titan === titan) h.release();
    }
    if (this.grab && this.grab.titan === titan) this._endGrab(true);
    this.audio.play('kill');
    this.audio.play('killBoom');
    this.impact = this.cfg.strike.impactFrame * 1.5;
    this.hud.killBurst(true);
    this.hitStop = 0.2;
    this.slowMo = this.slowMoMax = 1.2;
    this.rig.startKillCam(titan, this.napePos, this.pc);
    this.fx.shockRing(this.napePos, 16 * titan.scale, '#ffd27a', 0.6);
    this.fx.impactStar(this.napePos, 10, '#fff2c0', 0.32);
    const left = this.titans.filter((t) => t.alive).length;
    this.hud.toast(left === 0 ? '全部討伐完成！' : `討伐成功！還剩 ${left} 隻`, 'good big', 2.2);
    this._missionEvent('kill');
  }

  // ── 被巨人抓住：連打斬擊掙脫 ──
  _startGrab(titan) {
    if (this.grab || this.pc.hp <= 0) return;
    this.pc.releaseAll();
    this.pc.lunge = null;
    this.pc.grabbedBy = titan;
    this.grab = { titan, taps: 0 };
    this.audio.play('hurt');
    this.rig.addShake(0.6);
    this.hud.toast(`被抓住了！連打「斬擊」掙脫 0/${this.cfg.titan.grabEscapeTaps}`, 'bad big', 3);
  }

  _struggle() {
    const g = this.grab;
    const need = this.cfg.titan.grabEscapeTaps;
    g.taps++;
    this.model.startSlash();
    this.audio.play('hitBody');
    g.titan.grabHandWorld(_v);
    this.fx.napeHit(_v, this.rig.forward, false);
    this.rig.addShake(0.25);
    if (g.taps >= need) {
      g.titan.takeHit(6, false);
      g.titan.releaseGrab(true);
      this._endGrab(true);
      this.hud.toast('掙脫了！', 'good', 1);
    } else {
      this.hud.toast(`連打「斬擊」掙脫 ${g.taps}/${need}`, 'bad big', 1.5);
    }
  }

  _endGrab(escaped) {
    const g = this.grab;
    if (!g) return;
    this.grab = null;
    this.pc.grabbedBy = null;
    // 從手中彈開
    _v.subVectors(this.pc.pos, g.titan.root.position).setY(0).normalize();
    this.pc.vel.copy(_v).multiplyScalar(escaped ? 14 : 22).setY(escaped ? 12 : 6);
    this.pc.invuln = Math.max(this.pc.invuln, 0.8);
  }

  /** 高速貼地或貼牆時，刀尖刮出火花 */
  _bladeSparks() {
    const pc = this.pc;
    // 地面奔跑轉彎：往內傾時內側刀尖壓到地面 → 刮出火花
    const m = this.model;
    if (pc.grounded && m._running && Math.abs(m.bank || 0) > 0.18 && pc.speed > 6) {
      m.bladeWorld(m.bank < 0 ? 'right' : 'left', _v2, _bladeTip, true);
      if (_bladeTip.y < 0.55) {
        _bladeTip.y = 0.05;
        this.fx.sparks(_bladeTip, pc.vel, 3);
        if (Math.random() < 0.15) this.audio.play('scrape');
      }
      return;
    }
    if (pc.feelSpeed < 24 && !(pc.sliding && pc.speed > 8)) return;
    const tip = this.model.bladeWorld('right', _v2, _bladeTip, true) || _bladeTip;
    let hit = null;
    if (pc.pos.y < 1.8 && (pc.sliding || !pc.grounded)) {
      hit = _bladeTip.set(_bladeTip.x, 0.05, _bladeTip.z);
    } else {
      // 最近的牆面（建築方塊的水平距離）
      for (const c of this.city.colliders) {
        if (pc.pos.y > c.max.y + 0.5) continue;
        const dx = Math.max(c.min.x - pc.pos.x, 0, pc.pos.x - c.max.x);
        const dz = Math.max(c.min.z - pc.pos.z, 0, pc.pos.z - c.max.z);
        if (Math.hypot(dx, dz) < 1.6) {
          hit = _bladeTip.set(Math.min(c.max.x, Math.max(c.min.x, pc.pos.x)), pc.pos.y, Math.min(c.max.z, Math.max(c.min.z, pc.pos.z)));
          break;
        }
      }
    }
    if (!hit) return;
    this.fx.sparks(hit, pc.vel, pc.feelSpeed > 40 ? 8 : 4);
    if (Math.random() < 0.25) this.audio.play('scrape');
  }

  /** 色差（紅藍錯位）：命中與衝刺斬的瞬間 */
  _updateChroma(dt) {
    if (this.pc.lunge || this.pc.levi?.phase === 'dash') this.chroma = Math.max(this.chroma, 0.4);
    this.chroma = Math.max(0, (this.chroma || 0) - dt * 1.6);
    if (this.impact > 0) this.impact -= dt;
    const c = this.renderer.domElement;
    const px = (this.chroma * 9).toFixed(1);
    // 衝擊幀：命中瞬間整個畫面變成白底黑剪影（真實時間約 0.12 秒）
    const f =
      this.impact > 0
        ? 'grayscale(1) brightness(2.6) contrast(9)'
        : this.chroma > 0.02
          ? `drop-shadow(${px}px 0 0 rgba(255,40,60,0.55)) drop-shadow(-${px}px 0 0 rgba(40,170,255,0.55))`
          : 'none';
    if (c.style.filter !== f) c.style.filter = f;
  }

  /** 放射狀速度線：衝刺斬／鋼索衝刺時出現，命中瞬間爆一下 */
  _updateSpeedBurst(dt) {
    const pc = this.pc;
    let target = 0;
    if (pc.lunge || pc.levi?.phase === 'dash') target = 1;
    else if (pc.dashGlow > 0) target = 0.15 + 0.45 * pc.dashGlow; // 衝刺越久越強，放開後慢慢退
    else if (pc.feelSpeed > 45) target = Math.min(0.35, (pc.feelSpeed - 45) / 40);
    this.burst = Math.max(target, (this.burst || 0) - dt * 2.5);
    const el = this.speedBurstEl || (this.speedBurstEl = document.getElementById('speedburst'));
    const lv = this.cfg.speedLines.levels[this.speedLineLevel] ?? 1;
    el.style.opacity = (this.burst * Math.min(1, lv * 1.3)).toFixed(3);
    if (this.burst > 0.01) el.style.transform = `rotate(${(Math.random() * 6).toFixed(2)}deg) scale(${(1 + Math.random() * 0.04).toFixed(3)})`;
  }

  // ────────────────────────── 主迴圈 ──────────────────────────
  frame() {
    let dt = Math.min(0.05, this.clock.getDelta());
    const intent = this.input.poll();
    for (const ev of intent.events) this._handleEvent(ev);

    if (this.state === 'playing' || this.state === 'won' || this.state === 'lost') {
      this.rig.look(intent.lookDX, intent.lookDY, intent.manualLook);
      // 陀螺儀：轉動手機＝轉動鏡頭（暫停時丟掉累積量，回到遊戲不會突然轉一大圈）
      if (this.gyro.enabled) {
        const gy = this.gyro.take();
        const k = this.rig.locked ? 0 : (this.cfg.camera.gyro.levels[this.gyroLevel] ?? 0); // 鎖定鏡頭時先停用
        if (this.state === 'playing' && k > 0 && (gy.yaw || gy.pitch)) {
          this.rig.yaw += gy.yaw * k;
          this.rig.pitch = Math.max(-1.35, Math.min(1.25, this.rig.pitch + gy.pitch * k));
          if (Math.abs(gy.yaw) + Math.abs(gy.pitch) > 0.002) this.rig.lastManualLook = this.rig.time;
        }
      }
    }

    // 頓點：命中瞬間幾乎停住，接著慢動作逐漸恢復（卡肉感）
    const realDt = dt;
    this.realDt = realDt;
    this._updateChroma(realDt);
    if (this.hitStop > 0) {
      this.hitStop -= realDt;
      dt *= 0.02;
    } else if (this.slowMo > 0) {
      this.slowMo -= realDt;
      const k = 1 - Math.max(0, this.slowMo) / this.slowMoMax;
      dt *= this.cfg.strike.slowMoScale + (1 - this.cfg.strike.slowMoScale) * k * k;
    }
    this._updateSpeedBurst(realDt);
    if (this.state === 'playing') this._updateStrikeHold(realDt);

    if (this.state === 'playing' || this.state === 'won' || this.state === 'lost') {
      this.step(dt, intent);
    } else {
      // 選單／暫停時仍更新攝影機與巨人呼吸
      this.rig.update(dt, this.pc, { touch: this.touch, joyX: 0, realDt });
      for (const t of this.titans) t.updatePose(0);
    }
    this.fx.setPixelScale(this.renderer.domElement.height, this.camera.fov);
    this.renderer.render(this.scene, this.camera);
  }

  step(dt, intent) {
    const pc = this.pc;
    const playing = this.state === 'playing' && pc.hp > 0;
    if (!playing) {
      intent = { ...intent, move: { x: 0, y: 0 }, boost: false, boostPressed: false, jump: false, jumpHeld: false, reel: 0, reelStrong: false };
    }
    if (this.state === 'playing') this.stats.time += dt;
    if (this.passThrough > 0) this.passThrough -= dt;
    this.strikeCooldown -= dt;

    // 巨人
    const world = { colliders: this.city.colliders };
    for (const t of this.titans) {
      if (t.gone) continue;
      t.update(dt, pc, world);
      for (const e of t.events.splice(0)) this._onTitanEvent(e, t);
      // 新種類的持續特效：飛行中的石頭拖煙、蒸氣巨人蓄熱／噴發
      for (const r of t.rocks) this.fx.rockTrail(r.pos);
      if (t.steamPhase === 'charge') this.fx.steamCharge(t.napeWorld(_v));
      else if (t.steamPhase === 'burst' && Math.random() < 0.5) this.fx.steamBurst(t.napeWorld(_v), this.cfg.titan.steam.radius * t.scale * 0.5);
    }
    this._pickTarget();
    const titan = this.titan;

    // 玩家物理
    pc.update(dt, intent, {
      colliders: this.city.colliders,
      wallRadius: this.cfg.world.wallRadius,
      titanSpheres: pc.busy || this.grab || this.passThrough > 0 || pc.groundDashTimer > 0 ? null : this.titanSpheres,
      camYaw: this.rig.yaw,
      camForward: this.rig.forward,
    });
    for (const e of pc.events.splice(0)) this._onPlayerEvent(e);

    // 被抓住：角色固定在巨人手裡
    if (this.grab) {
      this.grab.titan.grabHandWorld(pc.pos);
      pc.vel.set(0, 0, 0);
    }

    // 兵長斬抵達／地面滑鏟砍腳
    if (pc.levi && pc.levi.done) this._leviFinish();
    if (!pc.levi) this.leviTitan = null;
    this._groundDashCut();

    // 衝刺斬抵達
    if (pc.lunge && pc.lunge.done) {
      pc.lunge = null;
      const ev = this._evaluate();
      if (ev.ok) this._napeHit(ev);
      else if (!this._partHit() && !this._bodyHit()) this.hud.toast('偏了！', 'warn', 0.8);
      pc.vel.multiplyScalar(0.8);
    }

    // 攝影機
    // 手機：鉤住時（與放索後一小段）鏡頭轉向人物面朝的方向
    if (pc.anyAttached) this.sinceHooked = 0;
    else this.sinceHooked = (this.sinceHooked ?? 99) + dt;
    const C = this.cfg.camera;
    const hookFollow = this.touch && this.hookFollow && this.sinceHooked < C.hookFollowAfter && Math.hypot(pc.vel.x, pc.vel.z) > 4;
    // 準心推到畫面邊緣時，鏡頭慢慢跟著轉
    const t = this.input.touch;
    const R = this.cfg.reticle;
    // 準心推過邊緣：鏡頭轉動（用真實時間，慢動作時也轉得動）；轉動中暫停「鉤住時鏡頭跟隨」
    const rdt = this.realDt ?? dt;
    if (this.touch && (t.turnX || t.turnY)) {
      this.rig.lastManualLook = this.rig.time;
      this.rig.yaw -= t.turnX * R.maxTurnRate * rdt;
      this.rig.pitch = Math.max(-1.35, Math.min(1.25, this.rig.pitch + t.turnY * R.maxTurnRate * 0.6 * rdt));
    }
    // 快速甩動轉身：0.16 秒內轉 90°
    if (this.flickTurn) {
      const f = this.flickTurn;
      const step = Math.min(Math.abs(f.left), (Math.abs(f.total) / R.flick.duration) * rdt) * Math.sign(f.left);
      this.rig.yaw -= step;
      f.left -= step;
      this.rig.lastManualLook = this.rig.time;
      if (Math.abs(f.left) < 1e-4) this.flickTurn = null;
    }
    // 靠近巨人時鏡頭壓低、往上仰（巨人顯得更巨大）
    let low = 0;
    if (titan.alive) {
      const hd = Math.hypot(titan.root.position.x - pc.pos.x, titan.root.position.z - pc.pos.z);
      low = Math.max(0, Math.min(1, 1 - (hd - 12 * titan.scale) / (35 * titan.scale)));
      if (pc.pos.y > titan.height * 0.9) low *= 0.3; // 在巨人頭上時不仰拍
    }
    this.lowAngle += (low - (this.lowAngle || 0)) * Math.min(1, dt * 2);
    // 鎖定鏡頭：勾在巨人身上 → 鏡頭對準牠；手動轉鏡頭持續一段時間＝解除（直到下次勾住）
    const fixedCam = this.camMode === 'fixed' || this.camMode === 'behind'; // 這兩種都不做其他自動轉向
    const behindCam = this.camMode === 'behind';
    const lockTitan = this.lockCam && !fixedCam ? this._hookedTitan() : null;
    const manualTurning = (this.touch && (t.turnX || t.turnY)) || (!this.touch && intent.manualLook && Math.hypot(intent.lookDX, intent.lookDY) > 0.004);
    this.manualTurnTime = manualTurning ? (this.manualTurnTime || 0) + rdt : 0;
    if (!lockTitan) this.lockBroken = false;
    else if (this.manualTurnTime > C.lock.breakAfter) this.lockBroken = true;
    let lockTarget = null;
    if (lockTitan && lockTitan.alive && !this.lockBroken && !pc.levi) {
      lockTarget = lockTitan.napeWorld(_aimLock);
      lockTarget.y -= C.lock.aimDrop * lockTitan.scale;
    }
    document.body.classList.toggle('cam-locked', !!lockTarget);
    this.rig.update(dt, pc, {
      touch: this.touch,
      joyX: intent.move.x,
      joyTurn: lockTarget || fixedCam ? 0 : (this.cfg.camera.joyTurn.levels[this.joyTurnLevel] ?? 1), // 鎖定時左搖桿＝繞圈，不轉鏡頭
      autoFollow: this.cameraFollow,
      followYaw: hookFollow && !fixedCam ? this.model.yaw : null,
      fixed: fixedCam && !behindCam,
      behindYaw: behindCam ? this.model.yaw : null,
      lowAngle: this.lowAngle,
      lockTarget,
      rollLevel: this.cfg.camera.roll.levels[this.camRollLevel] ?? 0,
      closeCam: this.closeCam,
      close: !!(pc.lunge || pc.levi || pc.dashGlow > 0.35), // 衝刺時鏡頭拉近（放開後跟著速度感慢慢退）
      realDt: this.realDt,
    });
    // 鎖定時角色身體朝向目標（背對鏡頭繞圈，出刀一直朝著巨人）
    this.model.update(dt, pc, this.rig.yaw, lockTarget ? this.rig.yaw : null);
    this.city.update(pc.pos);

    // 鋼索瞄準預測（供下一次發射與 HUD 標記使用）
    this._updateAims();

    // 斬擊條件
    this.strikeEval = this._evaluate();
    if (this.strikeEval.ok && !this.wasReady) this.audio.play('ready');
    this.wasReady = this.strikeEval.ok;

    // 特效
    this.fx.update(dt, pc, this.model, this.camera);
    // 瓦斯雲軌跡：勾住飛行、噴氣、衝刺時身後拖出白色瓦斯（衝刺最濃）
    const flying = !pc.grounded && pc.feelSpeed > 14;
    if (pc.dashing || pc.flip?.phase === 'burst' || pc.levi?.phase === 'dash') this.fx.gasTrail(pc.pos, pc.vel, 1);
    else if (pc.groundDashing) this.fx.gasTrail(pc.pos, pc.vel, 0.45);
    else if (pc.boosting || (flying && pc.anyAttached)) this.fx.gasTrail(pc.pos, pc.vel, 0.55);
    else if (flying && pc.feelSpeed > 30) this.fx.gasTrail(pc.pos, pc.vel, 0.2);
    // 瓦斯軌跡線：空中、在噴氣或勾著飛（或高速）時拉出兩條細長白線
    const trailEmit = !pc.grounded && (pc.boosting || pc.dashing || pc.flip?.phase === 'burst' || (pc.anyAttached && pc.feelSpeed > 14) || pc.feelSpeed > 30);
    this.fx.updateTrailLines(dt, trailEmit, pc, this.model, this.camera);
    // 刀刃擦地／擦牆火花
    this._bladeSparks();
    // 鎖定繞圈、靠近巨人時：自動甩出連續的淡刀光
    this.idleSlashT = (this.idleSlashT || 0) - dt;
    if (lockTarget && pc.feelSpeed > 20 && this.idleSlashT <= 0 && pc.pos.distanceTo(lockTarget) < 16 * (lockTitan?.scale || 1)) {
      this.idleSlashT = 0.2;
      this.idleSide = -(this.idleSide || 1);
      this.fx.idleSlash(_v.copy(pc.pos).addScaledVector(this.rig.forward, 1.0), this.rig.forward, this.idleSide);
    }
    // 風壓漩渦：高速繞圈（側向加速度大）、衝刺、兵長斬、迴旋斬
    const lat = Math.hypot(pc.accel.x, pc.accel.z);
    let swirl = flying ? Math.min(1, Math.max(0, (pc.feelSpeed - 35) / 40) * Math.min(1, lat / 25)) : 0;
    if (pc.dashing) swirl = Math.max(swirl, 0.4 * pc.dashRamp);
    if (pc.levi || pc.flip || this.model.spinTimer > 0) swirl = 1;
    this.fx.updateSwirl(dt, pc.pos, pc.vel, swirl);
    if (pc.lunge) this.fx.trail(pc.pos);
    if (pc.levi) this.fx.leviTrail(pc.pos, pc.levi.phase === 'dash');
    this.model.setLevi(pc.levi ? (pc.levi.phase === 'dash' ? 2 : 1) : 0, pc.vel);
    this.fx.setBladeTint(!!pc.levi);
    if (pc.sliding) this.fx.dust(pc.pos, pc.vel, 1);
    this.fx.updateBlades(this.model, pc.feelSpeed, this.model.slashTimer > 0 || this.model.spinTimer > 0 || !!pc.levi);
    for (const t of this.titans) {
      if (t.gone) continue;
      if (!t.alive) {
        if (Math.random() < 0.6) {
          t.chest.getWorldPosition(_v);
          this.fx.steam(_v, t.state === 'dying' ? 3 : 1);
        }
      } else {
        if (t.hp < this.cfg.titan.hp && Math.random() < 0.2) this.fx.steam(t.napeWorld(_v), 1);
        // 傷口冒蒸氣
        for (const w of t.wounds) if (Math.random() < 0.12) this.fx.steam(w.mesh.getWorldPosition(_v), 1);
        if (t.stunTimer > 0 && Math.random() < 0.4) this.fx.steam(t.eyeWorld(0, _v), 1);
      }
    }

    this.audio.update(pc.feelSpeed, pc.boosting || pc.dashing || pc.groundDashing, pc.dashing || pc.groundDashing ? 1 : 0, pc.anyAttached);
    this.hud.update(dt, {
      pc,
      titan,
      camera: this.camera,
      aims: this.aims,
      strikeEval: this.strikeEval,
      napePos: this.napePos,
      touchMode: this.hookMode === 'single' ? 'smart' : 'dual',
      smartSide: this.autoSide,
      reticle: this.reticle,
      waypoint: this.mission.waypoint,
    });
    if (this.touch) this.touchUI.sync(pc, !!(this.aims.auto || this.aims.left || this.aims.right));

    // 勝負
    if (this.state === 'playing') {
      // 操作教學的持續動作判定
      if (this.mission.type === 'tutorial') this._tutorialTick(dt, intent);
      // 光圈競速：通過判定
      const ring = this.mission.update(pc.pos);
      if (ring) {
        this.audio.play('ready');
        this.fx.burst(pc.pos, 1.2, '#ffe08a', 0.25);
        this.rig.kick(6);
        const left = this.mission.rings.length - ring;
        this.hud.toast(left ? `光圈 ${ring}　${this.stats.time.toFixed(1)} 秒` : `全部通過！${this.stats.time.toFixed(1)} 秒`, 'good', 1.2);
        this._updateMission();
      }
      this.mission.animate(this.stats.time);
      if (this.mission.complete(this.titans)) {
        this.endTimer += dt;
        if (this.endTimer > (this.mission.type === 'kill' ? 1.2 : 0.6)) this._end(true);
      } else if (pc.hp <= 0) {
        this.endTimer += dt;
        if (this.endTimer > 1.4) this._end(false);
      }
    }
  }

  _updateAims() {
    const H = this.cfg.hook;
    // 準心位置（手機準心搖桿可以把準心移離畫面中央）
    const R = this.cfg.reticle;
    this.reticle.x = this.touch ? this.input.touch.aimX * R.rangeX : 0;
    this.reticle.y = this.touch ? this.input.touch.aimY * R.rangeY : 0;
    let f = this.rig.forward;
    if (this.reticle.x || this.reticle.y) {
      this.camera.updateMatrixWorld();
      f = _aimDir.set(this.reticle.x, this.reticle.y, 0.5).unproject(this.camera).sub(this.camera.position).normalize();
    }
    const p = this.pc.pos;
    // 拉索：準星指哪勾哪（小範圍輔助）；擺盪：擺盪輔助瞄準
    const assist = this.touch ? H.pull.aimAssistDegTouch : H.pull.aimAssistDeg;
    const aimAt = (yawOff) => {
      if (this.pc.ropeStyle === 'pull') {
        let d = f;
        if (yawOff) d = _v2.copy(f).applyAxisAngle(_up, (yawOff * Math.PI) / 180);
        return this.aimer.aimDirect(this.camera, d, p, H.range, assist);
      }
      return this.aimer.aim(this.camera, f, p, yawOff, H.range, H.swingAim);
    };
    if (this.hookMode === 'single') {
      this.aims.left = this.aims.right = null;
      // 手機準心吸附（拉索模式）：準心靠近轉角／屋頂邊緣時優先吸過去
      let snapped = null;
      if (this.touch && R.snap && this.pc.ropeStyle === 'pull') {
        snapped = this.aimer.snapAim(this.camera, this.reticle, p, H.range, this.city.snapAnchors, R.snapRadiusPx, innerWidth, innerHeight);
      }
      // 準心附近有巨人（且沒被建築擋住）→ 優先勾巨人
      const titanAim = this.aimer.aimTitan(this.camera, f, p, H.range, this.touch ? H.titanAssistDegTouch : H.titanAssistDeg, this.titanRoots);
      const a = (this.aims.auto = titanAim || snapped || aimAt(0));
      if (a) {
        // 勾點在左邊就用左發射器，右邊用右發射器
        _right.set(-f.z, 0, f.x).normalize();
        this.autoSide = _v.subVectors(a.point, p).dot(_right) < 0 ? 'left' : 'right';
      }
    } else {
      this.aims.auto = null;
      const tAim = (yawOff) => this.aimer.aimTitan(this.camera, _v2.copy(f).applyAxisAngle(_up, (yawOff * Math.PI) / 180), p, H.range, this.touch ? H.titanAssistDegTouch : H.titanAssistDeg, this.titanRoots);
      this.aims.left = tAim(H.aimOffsetDeg) || aimAt(H.aimOffsetDeg);
      this.aims.right = tAim(-H.aimOffsetDeg) || aimAt(-H.aimOffsetDeg);
    }
  }

  _onPlayerEvent(e) {
    switch (e.type) {
      case 'hookFire':
        this.audio.play('hookFire');
        break;
      case 'hookAttach':
        this.lockBroken = false; // 重新勾住＝重新鎖定
        this._missionEvent('hook');
        this.audio.play('hookAttach');
        this.fx.hookHit(e.point);
        this.hud.hookStatus('勾住', 'ok');
        break;
      case 'hookFail':
        this.audio.play('miss');
        this.hud.hookStatus('沒勾到', 'fail');
        break;
      case 'hookRelease':
        this._missionEvent('release');
        this.audio.play('hookRelease');
        break;
      case 'land':
        this.audio.play('land', { speed: e.speed });
        if (e.speed > 6 || e.airTime > 0.6) this.fx.dust(this.pc.pos, this.pc.vel, e.slide ? 14 : 6);
        if (e.slide) this.rig.addShake(Math.min(0.35, e.speed / 120));
        break;
      case 'fling':
        this._missionEvent('fling');
        this.audio.play('fling');
        if (this.pc.ropeStyle === 'pull') {
          this.rig.addShake(0.12);
          this.fx.gasPuff(this.pc.pos, this.pc.vel, true);
        }
        break;
      case 'dash':
        this._missionEvent('dashHold');
        this.audio.play('boost');
        break;
      case 'flip': // 捲身翻轉開始
        this._missionEvent('flip');
        this.audio.play('swing');
        this.rig.addShake(0.12);
        break;
      case 'flipBurst': // 翻完 → 爆衝
        this.audio.play('boost');
        this.rig.kick(12);
        this.rig.addShake(0.25);
        this.chroma = Math.max(this.chroma, 0.35);
        this.fx.gasPuff(this.pc.pos, this.pc.vel, true);
        break;
      case 'flipDetach': // 衝到勾點自動脫勾
        this.audio.play('fling');
        this.fx.gasPuff(this.pc.pos, this.pc.vel, true);
        this.rig.addShake(0.15);
        break;
      case 'flipEnd':
        this.fx.gasPuff(this.pc.pos, this.pc.vel, true);
        break;
      case 'groundDash':
        this._missionEvent('groundDash');
        this.audio.play('boost');
        this.passThrough = Math.max(this.passThrough, this.cfg.dash.groundTime);
        this.fx.dust(this.pc.pos, this.pc.vel, 10);
        this.rig.kick(5);
        break;
      case 'leviWindup':
        this.fx.leviCharge(this.pc.pos);
        break;
      case 'leviDash':
        this.audio.play('boost');
        this.rig.kick(12);
        this.rig.addShake(0.35);
        this.chroma = 0.55;
        this.burst = 1;
        break;
      case 'dashArrive':
        this._missionEvent('dash');
        this.audio.play('fling');
        this.rig.addShake(0.15);
        this.fx.gasPuff(this.pc.pos, this.pc.vel, true);
        break;
      case 'arrive':
        this.audio.play('hookRelease');
        break;
      case 'wallRun':
        this.fx.dust(this.pc.pos, this.pc.vel, 4);
        break;
      case 'jump':
        this.audio.play('jump');
        break;
      case 'hurt':
        this.stats.hurt = true;
        this.audio.play('hurt');
        this.hud.hurt();
        this.rig.addShake(0.8);
        if (this.pc.hp <= 0) {
          this.hud.toast('你被巨人擊倒了…', 'bad big', 2.5);
        } else {
          this.hud.toast(`受到 ${e.amount} 傷害！`, 'bad', 1.2);
        }
        break;
    }
  }

  _onTitanEvent(e, titan) {
    const d = titan.root.position.distanceTo(this.pc.pos);
    switch (e.type) {
      case 'step':
        this.audio.play('step', { vol: Math.max(0.05, 0.6 - d / 200) });
        if (d < 50) this.rig.addShake(0.12 * (1 - d / 50));
        break;
      case 'windup':
        if (d < 70) {
          this.audio.play('windup');
          this.hud.toast('⚠ 巨人準備揮擊！', 'warn', 0.9);
        }
        break;
      case 'swing':
        this.audio.play('swing');
        break;
      case 'swipeHit':
        if (!this.grab) this.pc.damage(this.cfg.titan.swipeDamage, e.knock);
        break;
      case 'pounceWindup':
        if (d < 90) {
          this.audio.play('windup');
          this.hud.toast(`⚠ ${titan.name}要撲過來了！`, 'warn', 1.0);
        }
        break;
      case 'leap':
        if (d < 90) this.audio.play('swing');
        break;
      case 'pounceHit':
        if (!this.grab) this.pc.damage(this.cfg.titan.abnormal.damage, e.knock);
        break;
      case 'throwWindup':
        if (d < 130) {
          this.audio.play('windup');
          this.hud.toast(`⚠ ${titan.name}舉起石頭了！`, 'warn', 1.0);
        }
        break;
      case 'throw':
        if (d < 130) this.audio.play('swing');
        break;
      case 'rockHit':
        if (!this.grab) this.pc.damage(this.cfg.titan.thrower.damage, e.knock);
        this.fx.rockShatter(e.pos, true);
        this.rig.addShake(0.9);
        break;
      case 'rockLand': {
        const rd = e.pos.distanceTo(this.pc.pos);
        this.fx.rockShatter(e.pos, false);
        if (rd < 60) this.rig.addShake(0.45 * (1 - rd / 60));
        this.audio.play('land', { speed: 30 });
        break;
      }
      case 'armorHit':
        this.fx.armorShards(titan.napeWorld(_v), false);
        this.hud.toast(`鎧甲出現裂痕！還要 ${e.left} 下`, 'warn', 1.0);
        break;
      case 'armorBreak':
        this.fx.armorShards(titan.napeWorld(_v), true);
        this.rig.addShake(0.6);
        this.hud.toast('鎧甲碎裂！後頸露出來了！', 'good', 1.4);
        break;
      case 'steamWindup':
        if (d < 80) this.hud.toast(`⚠ ${titan.name}全身發燙，快離開！`, 'warn', 1.1);
        break;
      case 'steamBurst':
        this.fx.steamBurst(titan.napeWorld(_v), this.cfg.titan.steam.radius * titan.scale * 0.6);
        this.fx.shockRing(titan.napeWorld(_v), this.cfg.titan.steam.radius * titan.scale, '#fff2ea', 0.6);
        if (d < 70) this.rig.addShake(0.35);
        break;
      case 'steamHit':
        if (!this.grab) this.pc.damage(this.cfg.titan.steam.damage, this.pc.vel.clone()); // 被蒸氣吹開（推力在巨人那邊已經加上）
        break;
      case 'pounceLand':
        if (d < 70) this.rig.addShake(0.5 * (1 - d / 70));
        this.audio.play('land', { speed: 40 });
        this.fx.dust(titan.root.position, _v.set(0, 0, 0), 30);
        break;
      case 'grabWindup':
        if (d < 70) {
          this.audio.play('windup');
          this.hud.toast('⚠ 巨人伸手要抓你！', 'warn', 0.9);
        }
        break;
      case 'grabbed':
        this._startGrab(titan);
        break;
      case 'crush':
        if (this.grab && this.grab.titan === titan) {
          this._endGrab(false);
          this.pc.invuln = 0;
          _v.subVectors(this.pc.pos, titan.root.position).setY(0).normalize().multiplyScalar(22).setY(6);
          this.pc.damage(this.cfg.titan.crushDamage, _v.clone());
        }
        break;
      case 'grabRelease':
        if (this.grab && this.grab.titan === titan) this._endGrab(e.escaped);
        break;
      case 'blinded':
        this.audio.play('kill');
        this.hud.toast(`${titan.name}：眼睛受傷，暈眩 ${this.cfg.titan.stunTime} 秒！`, 'good', 1.8);
        break;
      case 'kneel':
        this.rig.addShake(0.5);
        this.audio.play('step', { vol: 0.6 });
        this.hud.toast(`${titan.name}：腳筋被砍，跪下了！趁現在砍後頸`, 'good', 2);
        break;
      case 'dying':
        if (d < 60) this.rig.addShake(0.4);
        break;
    }
  }

  _end(won) {
    this.state = won ? 'won' : 'lost';
    this.touchUI.show(false);
    if (document.pointerLockElement) document.exitPointerLock();
    const s = this.stats;
    const L = this.level;
    const got = evaluateStars(L, { won, time: s.time, hurt: s.hurt });
    const n = got.filter(Boolean).length;
    const before = this.progress[L.id]?.time;
    if (won) this.progress = saveResult(storage, L.id, n, s.time);
    const next = nextLevel(L.id);
    const nextBtn = document.getElementById('btn-next');
    nextBtn.hidden = !(won && next && isUnlocked(this.progress, next.id));
    if (next) nextBtn.textContent = `下一關：${next.name}`;
    document.getElementById('result-title').textContent = won ? (L.objective === 'kill' ? '討伐成功' : '任務完成') : '任務失敗';
    document.getElementById('result-title').className = won ? 'win' : 'lose';
    const record = won && (before == null || s.time < before) ? '（新紀錄！）' : '';
    document.getElementById('result-body').innerHTML = `
      <p class="result-stars">${this._stars(n)}</p>
      ${L.stars.map((r, i) => `<div><span>${got[i] ? '★' : '☆'} ${starText(r)}</span><b>${got[i] ? '達成' : '—'}</b></div>`).join('')}
      <div><span>用時</span><b>${s.time.toFixed(1)} 秒${record}</b></div>
      <div><span>最高速度</span><b>${this.pc.maxSpeed.toFixed(0)} m/s（${(this.pc.maxSpeed * 3.6).toFixed(0)} km/h）</b></div>
      <div><span>斬擊次數</span><b>${s.strikes}</b></div>
      <div><span>弱點命中</span><b>${s.napeHits}</b></div>`;
    if (won) this.audio.play('win');
    this.showPanel('result');
  }
}
