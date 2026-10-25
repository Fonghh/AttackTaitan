// 遊戲主控：建立各模組、處理輸入事件、主迴圈、戰鬥流程與遊戲狀態。
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { buildCity } from '../world/city.js';
import { PlayerController } from '../player/playerController.js';
import { PlayerModel } from '../player/playerModel.js';
import { HookAimer } from '../physics/grapple.js';
import { CameraRig } from '../camera/cameraRig.js';
import { Titan } from '../enemy/titan.js';
import { evaluateStrike, canLunge } from '../combat/strike.js';
import { Input, isTouchDevice } from '../input/input.js';
import { TouchControls } from '../ui/touchControls.js';
import { Hud } from '../ui/hud.js';
import { Effects } from '../fx/effects.js';
import { Audio } from '../audio/audio.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

export class Game {
  constructor(container) {
    const cfg = (this.cfg = CONFIG);
    this.touch = isTouchDevice() || new URLSearchParams(location.search).has('touch');
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
    this.city = buildCity(this.scene, cfg.world, { x: cfg.player.spawn.x, z: cfg.player.spawn.z }, this.touch);
    this.pc = new PlayerController(cfg);
    this.model = new PlayerModel(this.scene);
    this.titan = new Titan(this.scene, cfg);
    this.titan.root.traverse((o) => {
      if (o.isMesh) o.userData.titanPart = true;
    });

    this.hookables = [...this.city.hookables, this.titan.root];
    this.aimer = new HookAimer(this.hookables);
    this.rig = new CameraRig(this.camera, cfg, this.city.hookables);
    this.fx = new Effects(this.scene, cfg);
    this.audio = new Audio();
    this.hud = new Hud(cfg);

    this.input = new Input(renderer.domElement, cfg);
    this.touchUI = new TouchControls(document.getElementById('touch'), this.input, cfg);
    this.touchUI.show(false);

    this.spawnYaw = Math.atan2(cfg.player.spawn.x - cfg.titan.start.x, cfg.player.spawn.z - cfg.titan.start.z);
    this.aims = { left: null, right: null, auto: null };
    this.autoSide = 'right';
    // 鋼索模式：single = 單索（按住擺盪，預設）、dual = 左右雙索（進階）
    this.hookMode = this._load('hookMode2', 'single');
    this.cameraFollow = this._load('cameraFollow', 'on') === 'on';
    this.pc.ropeStyle = this._load('ropeStyle', cfg.hook.style);
    this.touchUI.setMode(this.hookMode);
    this.held = { auto: false, left: false, right: false };
    this.pendingFire = { auto: false, left: false, right: false };
    this.firedSide = { auto: null, left: 'left', right: 'right' };
    this.pendingRelease = { left: false, right: false };
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
    $('btn-follow').addEventListener('click', () => {
      this.cameraFollow = !this.cameraFollow;
      this._save('cameraFollow', this.cameraFollow ? 'on' : 'off');
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
    document.getElementById('btn-follow').textContent = this.cameraFollow ? '鏡頭跟隨飛行方向：開' : '鏡頭跟隨飛行方向：關';
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
    for (const k of Object.keys(this.held)) this.held[k] = this.pendingFire[k] = false;
    this.pendingRelease.left = this.pendingRelease.right = false;
  }

  showPanel(id) {
    for (const p of document.querySelectorAll('.panel')) p.hidden = p.id !== id;
    document.getElementById('hud').classList.toggle('dim', !!id);
  }

  start() {
    this.audio.init();
    if (this.touch) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      this.input.requestLock();
    }
    this.state = 'playing';
    this.input.enabled = true;
    this.showPanel(null);
    this.touchUI.show(this.touch);
    this.hud.toast('從高塔躍下，用鋼索擺盪接近巨人！', '', 2.5);
  }

  resume() {
    if (this.state !== 'paused') return;
    this.audio.init();
    if (!this.touch) this.input.requestLock();
    this.state = 'playing';
    this.showPanel(null);
    this.touchUI.show(this.touch);
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
    this.titan.reset();
    this.rig.reset(this.spawnYaw);
    this.fx.reset();
    this.stats = { time: 0, strikes: 0, napeHits: 0, best: 0 };
    this.hitStop = 0;
    this.endTimer = 0;
    this.strikeCooldown = 0;
    this.hud.setMission('任務：討伐巨人　弱點＝後頸（發光處）');
    if (play) {
      this.state = 'playing';
      this.input.enabled = true;
      this.showPanel(null);
      this.touchUI.show(this.touch);
      this.audio.init();
      if (!this.touch && !this.input.locked) this.input.requestLock();
    } else {
      this.showPanel('start');
    }
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

  /** 按下鋼索鍵：有目標就發射；沒有目標時，按住期間一出現目標就自動發射 */
  _hookDown(key) {
    this.held[key] = true;
    if (!this._tryFire(key)) {
      this.audio.play('miss');
      this.hud.toast('準星附近沒有可勾的目標（射程 85m）', 'warn', 0.8);
    }
  }

  _tryFire(key) {
    const pc = this.pc;
    const aim = this.aims[key];
    if (!aim) {
      this.pendingFire[key] = true;
      return false;
    }
    const side = key === 'auto' ? this.autoSide : key;
    if (key === 'auto') {
      // 單索：同時只有一條，換勾點時直接接到新的
      const other = side === 'left' ? 'right' : 'left';
      if (pc.hooks[other].active) pc.hooks[other].release();
      this.pendingRelease[other] = false;
    }
    this.pendingFire[key] = false;
    this.pendingRelease[side] = false;
    this.firedSide[key] = side;
    pc.fireHook(side, this._launcherPos(side), aim);
    return true;
  }

  /** 放開鋼索鍵。快速點按時，至少讓鋼索勾住一小段時間（minHold）再放 */
  _hookUp(key) {
    this.held[key] = false;
    this.pendingFire[key] = false;
    const side = this.firedSide[key];
    if (!side) return;
    const h = this.pc.hooks[side];
    if (!h.active) return;
    if (h.state === 'flying' || h.attachTime < this.cfg.hook.minHold) this.pendingRelease[side] = true;
    else this.pc.releaseHook(side);
  }

  _updateHookHolds() {
    for (const key of ['auto', 'left', 'right']) {
      if (this.held[key] && this.pendingFire[key]) this._tryFire(key);
    }
    for (const side of ['left', 'right']) {
      if (!this.pendingRelease[side]) continue;
      const h = this.pc.hooks[side];
      if (!h.active) this.pendingRelease[side] = false;
      else if (h.attached && h.attachTime >= this.cfg.hook.minHold) {
        this.pendingRelease[side] = false;
        this.pc.releaseHook(side);
      }
    }
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
    if (this.state !== 'playing' || pc.hp <= 0) return;
    switch (ev) {
      case 'releaseAll':
        this._releaseHeld();
        pc.releaseAll();
        break;
      default:
        if (ev.startsWith('down:') || ev.startsWith('up:')) {
          const [kind, k] = ev.split(':');
          const key = this.hookMode === 'single' ? 'auto' : k === 'auto' ? 'right' : k;
          if (kind === 'down') this._hookDown(key);
          else this._hookUp(key);
        }
        break;
      case 'strike':
        this._strike();
        break;
    }
  }

  // ────────────────────────── 戰鬥 ──────────────────────────
  _evaluate() {
    const t = this.titan;
    t.napeWorld(this.napePos);
    const ev = evaluateStrike({ playerPos: this.pc.pos, playerVel: this.pc.vel, napePos: this.napePos, titanForward: t.forward }, this.cfg);
    _v.subVectors(this.napePos, this.pc.pos);
    ev.lunge = t.alive && !this.pc.lunge && canLunge(ev, _v, this.rig.forward, this.pc.gas, this.cfg);
    return ev;
  }

  _strike() {
    if (this.strikeCooldown > 0 || this.pc.lunge) return;
    this.strikeCooldown = this.cfg.strike.cooldown;
    this.stats.strikes++;
    this.model.startSlash();
    this.audio.play('slash');
    const ev = this._evaluate();
    const dir = this.pc.speed > 2 ? _v2.copy(this.pc.vel).normalize() : _v2.copy(this.rig.forward);
    this.fx.slash(_v.copy(this.pc.pos).addScaledVector(dir, 1.2), dir, this.model.slashSide, false);

    if (!this.titan.alive) return;
    if (ev.ok) {
      this._napeHit(ev);
    } else if (ev.lunge) {
      // 衝刺斬：自動吸向弱點，抵達後再判定
      this.pc.gas -= this.cfg.strike.lungeGas;
      this.pc.releaseAll();
      this.pc.lunge = { timer: this.cfg.strike.lungeDuration, target: () => this.titan.napeWorld(this.napePos), done: false };
      this.audio.play('boost');
      this.rig.addShake(0.15);
    } else if (this._bodyHit()) {
      // 已在 _bodyHit 處理
    } else if (ev.dist < this.cfg.strike.lungeRange && !ev.angleOk) {
      this.hud.toast('正面無法斬擊！繞到巨人後方', 'warn', 1.2);
    } else if (ev.inRange && !ev.fastEnough) {
      this.hud.toast(`速度不足（需 ${this.cfg.strike.minSpeed} m/s）`, 'warn', 1.2);
    }
  }

  _bodyHit() {
    const C = this.cfg.strike;
    for (const s of this.titan.spheres) {
      if (this.pc.pos.distanceTo(s.center) - s.r <= C.bodyRange) {
        this.titan.takeHit(C.bodyDamage, false);
        this.audio.play('hitBody');
        this.fx.napeHit(_v.copy(this.pc.pos).lerp(s.center, 0.6), this.pc.vel.clone().normalize(), false);
        const sp = this.hud.project(s.center, this.camera, {});
        this.hud.popup(sp.x, sp.y, `-${C.bodyDamage}`, 'body');
        this.hud.toast('表皮傷害——瞄準後頸弱點！', '', 1.2);
        this.rig.addShake(0.2);
        if (!this.titan.alive) this._onKill();
        return true;
      }
    }
    return false;
  }

  _napeHit(ev) {
    const C = this.cfg.strike;
    const dmg = ev.damage;
    const perfect = dmg >= C.perfectDamage;
    this.titan.takeHit(dmg, true);
    this.stats.napeHits++;
    this.model.startSlash();
    const dir = _v2.copy(this.pc.vel).normalize();
    this.fx.slash(this.napePos, dir, this.model.slashSide, true);
    this.fx.napeHit(this.napePos, dir, perfect);
    this.audio.play('hitNape');
    this.hitStop = C.hitStop * (perfect ? 1.8 : 1);
    this.rig.addShake(perfect ? 0.9 : 0.55);
    this.hud.flash(perfect ? 'rgba(255,230,190,0.35)' : 'rgba(255,255,255,0.2)');
    const sp = this.hud.project(this.napePos, this.camera, {});
    this.hud.popup(sp.x, sp.y - 20, `${perfect ? '完美斬擊！' : '要害！'} -${dmg}`, perfect ? 'perfect' : 'crit');
    this.pc.vel.y = Math.max(this.pc.vel.y, 0) + 5; // 斬過後微微上彈
    if (!this.titan.alive) this._onKill();
    else this.hud.toast(`速度 ${ev.speed.toFixed(0)} m/s → 傷害 ${dmg}`, 'good', 1.3);
  }

  _onKill() {
    this.audio.play('kill');
    this.hud.toast('討伐成功！', 'good big', 3);
    this.hud.setMission('巨人已討伐！按 R 或「再來一次」重新開始');
    this.hitStop = 0.25;
  }

  // ────────────────────────── 主迴圈 ──────────────────────────
  frame() {
    let dt = Math.min(0.05, this.clock.getDelta());
    const intent = this.input.poll();
    for (const ev of intent.events) this._handleEvent(ev);

    if (this.state === 'playing' || this.state === 'won' || this.state === 'lost') {
      this.rig.look(intent.lookDX, intent.lookDY, intent.manualLook);
    }

    if (this.hitStop > 0) {
      this.hitStop -= dt;
      dt *= 0.06;
    }

    if (this.state === 'playing' || this.state === 'won' || this.state === 'lost') {
      this.step(dt, intent);
    } else {
      // 選單／暫停時仍更新攝影機與巨人呼吸
      this.rig.update(dt, this.pc, { touch: this.touch, joyX: 0 });
      this.titan.updatePose(0);
    }
    this.fx.setPixelScale(this.renderer.domElement.height, this.camera.fov);
    this.renderer.render(this.scene, this.camera);
  }

  step(dt, intent) {
    const pc = this.pc;
    const titan = this.titan;
    const playing = this.state === 'playing' && pc.hp > 0;
    if (!playing) {
      intent = { ...intent, move: { x: 0, y: 0 }, boost: false, boostPressed: false, jump: false, jumpHeld: false, reel: 0, reelStrong: false };
    }
    if (this.state === 'playing') this.stats.time += dt;
    this.strikeCooldown -= dt;

    // 巨人
    titan.update(dt, pc);
    for (const e of titan.events.splice(0)) this._onTitanEvent(e);

    // 玩家物理
    pc.update(dt, intent, {
      colliders: this.city.colliders,
      wallRadius: this.cfg.world.wallRadius,
      titanSpheres: pc.lunge ? null : titan.spheres,
      camYaw: this.rig.yaw,
      camForward: this.rig.forward,
    });
    for (const e of pc.events.splice(0)) this._onPlayerEvent(e);

    // 衝刺斬抵達
    if (pc.lunge && pc.lunge.done) {
      pc.lunge = null;
      const ev = this._evaluate();
      if (ev.ok) this._napeHit(ev);
      else if (!this._bodyHit()) this.hud.toast('偏了！', 'warn', 0.8);
      pc.vel.multiplyScalar(0.8);
    }

    // 攝影機
    this.rig.update(dt, pc, { touch: this.touch, joyX: intent.move.x, autoFollow: this.cameraFollow });
    this.model.update(dt, pc, this.rig.yaw);
    this.city.update(pc.pos);

    // 鋼索瞄準預測（供下一次發射與 HUD 標記使用）
    this._updateAims();
    this._updateHookHolds();

    // 斬擊條件
    this.strikeEval = this._evaluate();
    if (this.strikeEval.ok && !this.wasReady) this.audio.play('ready');
    this.wasReady = this.strikeEval.ok;

    // 特效
    this.fx.update(dt, pc, this.model);
    if (pc.boosting) this.fx.gasPuff(pc.pos, pc.vel, true);
    if (pc.sliding) this.fx.dust(pc.pos, pc.vel, 1);
    if (!titan.alive) {
      titan.chest.getWorldPosition(_v);
      this.fx.steam(_v, titan.state === 'dying' ? 3 : 1);
    } else if (titan.hp < this.cfg.titan.hp && Math.random() < 0.3) {
      this.fx.steam(this.napePos, 1);
    }

    this.audio.update(pc.speed, pc.boosting, pc.reeling, pc.anyAttached);
    this.hud.update(dt, {
      pc,
      titan,
      camera: this.camera,
      aims: this.aims,
      strikeEval: this.strikeEval,
      napePos: this.napePos,
      touchMode: this.hookMode === 'single' ? 'smart' : 'dual',
      smartSide: this.autoSide,
    });
    if (this.touch) this.touchUI.sync(pc, !!(this.aims.auto || this.aims.left || this.aims.right));

    // 勝負
    if (this.state === 'playing') {
      if (titan.state === 'dead') {
        this.endTimer += dt;
        if (this.endTimer > 1.2) this._end(true);
      } else if (pc.hp <= 0) {
        this.endTimer += dt;
        if (this.endTimer > 1.4) this._end(false);
      }
    }
  }

  _updateAims() {
    const H = this.cfg.hook;
    const f = this.rig.forward;
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
      const a = (this.aims.auto = aimAt(0));
      if (a) {
        // 勾點在左邊就用左發射器，右邊用右發射器
        _right.set(-f.z, 0, f.x).normalize();
        this.autoSide = _v.subVectors(a.point, p).dot(_right) < 0 ? 'left' : 'right';
      }
    } else {
      this.aims.auto = null;
      this.aims.left = aimAt(H.aimOffsetDeg);
      this.aims.right = aimAt(-H.aimOffsetDeg);
    }
  }

  _onPlayerEvent(e) {
    switch (e.type) {
      case 'hookFire':
        this.audio.play('hookFire');
        break;
      case 'hookAttach':
        this.audio.play('hookAttach');
        this.fx.hookHit(e.point);
        break;
      case 'hookRelease':
        this.audio.play('hookRelease');
        break;
      case 'land':
        this.audio.play('land', { speed: e.speed });
        if (e.speed > 6 || e.airTime > 0.6) this.fx.dust(this.pc.pos, this.pc.vel, e.slide ? 14 : 6);
        if (e.slide) this.rig.addShake(Math.min(0.35, e.speed / 120));
        break;
      case 'fling':
        this.audio.play('fling');
        if (this.pc.ropeStyle === 'pull') {
          this.rig.addShake(0.12);
          this.fx.gasPuff(this.pc.pos, this.pc.vel, true);
        }
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

  _onTitanEvent(e) {
    const d = this.titan.root.position.distanceTo(this.pc.pos);
    switch (e.type) {
      case 'step':
        this.audio.play('step', { vol: Math.max(0.05, 0.6 - d / 200) });
        if (d < 50) this.rig.addShake(0.12 * (1 - d / 50));
        break;
      case 'windup':
        this.audio.play('windup');
        this.hud.toast('⚠ 巨人準備揮擊！', 'warn', 0.9);
        break;
      case 'swing':
        this.audio.play('swing');
        break;
      case 'swipeHit':
        this.pc.damage(this.cfg.titan.swipeDamage, e.knock);
        break;
    }
  }

  _end(won) {
    this.state = won ? 'won' : 'lost';
    this.touchUI.show(false);
    if (document.pointerLockElement) document.exitPointerLock();
    const s = this.stats;
    document.getElementById('result-title').textContent = won ? '討伐成功' : '任務失敗';
    document.getElementById('result-title').className = won ? 'win' : 'lose';
    document.getElementById('result-body').innerHTML = `
      <div><span>用時</span><b>${s.time.toFixed(1)} 秒</b></div>
      <div><span>最高速度</span><b>${this.pc.maxSpeed.toFixed(0)} m/s（${(this.pc.maxSpeed * 3.6).toFixed(0)} km/h）</b></div>
      <div><span>斬擊次數</span><b>${s.strikes}</b></div>
      <div><span>弱點命中</span><b>${s.napeHits}</b></div>`;
    if (won) this.audio.play('win');
    this.showPanel('result');
  }
}
