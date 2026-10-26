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
const _aimDir = new THREE.Vector3();

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
    this.reticle = { x: 0, y: 0 }; // 準心在畫面上的位置（NDC，-1..1）
    // 鋼索模式：single = 單索（按住擺盪，預設）、dual = 左右雙索（進階）
    this.hookMode = this._load('hookMode2', 'single');
    this.cameraFollow = this._load('cameraFollow2', cfg.camera.autoFollow ? 'on' : 'off') === 'on';
    this.pc.ropeStyle = this._load('ropeStyle', cfg.hook.style);
    this.hookFollow = this._load('hookFollow', cfg.camera.hookFollow ? 'on' : 'off') === 'on';
    this.pc.dashScale = Math.max(0.1, Math.min(2, Number(this._load('dashScale', String(cfg.dash.defaultScale))) || cfg.dash.defaultScale));
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
    $('dash-down').addEventListener('click', () => setDash(-0.1));
    $('dash-up').addEventListener('click', () => setDash(0.1));
    $('spd-down').addEventListener('click', () => setSpeed(-0.1));
    $('spd-up').addEventListener('click', () => setSpeed(0.1));
    $('btn-follow').addEventListener('click', () => {
      this.cameraFollow = !this.cameraFollow;
      this._save('cameraFollow2', this.cameraFollow ? 'on' : 'off');
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
    this.touchUI.cancelAim?.();
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
    this.slowMo = 0;
    this.slowMoMax = 1;
    this.burst = 0;
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
      this.hud.toast('準星上沒有可勾的目標（射程 85m）', 'warn', 0.8);
      return;
    }
    const side = key === 'auto' ? this.autoSide : key;
    pc.fireHook(side, this._launcherPos(side), aim);
  }

  /** 準心搖桿放開：朝準心發射；已勾住時直接換到新的勾點 */
  _hookAimFire(key) {
    const pc = this.pc;
    const aim = this.aims[key];
    if (!aim) {
      this.audio.play('miss');
      this.hud.toast('準心上沒有可勾的目標（射程 85m）', 'warn', 0.8);
      return;
    }
    const side = key === 'auto' ? this.autoSide : key;
    if (key === 'auto') {
      const other = side === 'left' ? 'right' : 'left';
      if (pc.hooks[other].active) pc.hooks[other].release(); // 換勾點：舊的直接收回，不觸發放索加成
    }
    pc.fireHook(side, this._launcherPos(side), aim);
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
        this._strike();
        break;
    }
  }

  // ────────────────────────── 戰鬥 ──────────────────────────
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
      this.rig.addShake(0.2);
      this.rig.kick(10); // 衝刺斬：視角拉寬，速度感
    } else if (this._bodyHit()) {
      // 已在 _bodyHit 處理
    } else if (ev.dist < this.cfg.strike.lungeRange && !ev.angleOk) {
      this.hud.toast('正面無法斬擊！繞到巨人後方', 'warn', 1.2);
    } else if (ev.inRange && !ev.fastEnough) {
      this.hud.toast(`速度不足（需 ${(this.cfg.strike.minSpeed * this.pc.speedScale).toFixed(0)} m/s）`, 'warn', 1.2);
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
        this.rig.addShake(0.3);
        this.hitStop = 0.05; // 小頓點
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
    this.fx.burst(this.napePos, perfect ? 1.8 : 1.3, perfect ? '#ffb070' : '#ffd8b0', 0.24);
    this.fx.bladeHit(this.napePos, dir, perfect);
    this.fx.napeHit(this.napePos, dir, perfect);
    this.audio.play('hitNape');
    // 頓點 → 慢動作 → 恢復；鏡頭往前推並猛震
    this.hitStop = perfect ? C.hitStopPerfect : C.hitStop;
    this.slowMo = this.slowMoMax = perfect ? C.slowMoPerfect : C.slowMo;
    this.rig.kick(perfect ? -14 : -9);
    this.rig.addShake(perfect ? 1.1 : 0.75);
    this.burst = 1;
    this.hud.flash(perfect ? 'rgba(255,225,180,0.5)' : 'rgba(255,255,255,0.3)');
    const sp = this.hud.project(this.napePos, this.camera, {});
    this.hud.popup(sp.x, sp.y - 20, `${perfect ? '完美斬擊！' : '要害！'} -${dmg}`, perfect ? 'perfect' : 'crit');
    this.pc.vel.y = Math.max(this.pc.vel.y, 0) + 5; // 斬過後微微上彈
    if (!this.titan.alive) this._onKill();
    else this.hud.toast(`速度 ${this.pc.speed.toFixed(0)} m/s → 傷害 ${dmg}`, 'good', 1.3);
  }

  _onKill() {
    this.audio.play('kill');
    this.hud.toast('討伐成功！', 'good big', 3);
    this.hud.setMission('巨人已討伐！按 R 或「再來一次」重新開始');
    this.hitStop = 0.25;
    this.slowMo = this.slowMoMax = 0.9;
  }

  /** 放射狀速度線：衝刺斬／鋼索衝刺時出現，命中瞬間爆一下 */
  _updateSpeedBurst(dt) {
    const pc = this.pc;
    let target = 0;
    if (pc.lunge) target = 1;
    else if (pc.dashing) target = 0.55;
    else if (pc.feelSpeed > 45) target = Math.min(0.35, (pc.feelSpeed - 45) / 40);
    this.burst = Math.max(target, (this.burst || 0) - dt * 2.5);
    const el = this.speedBurstEl || (this.speedBurstEl = document.getElementById('speedburst'));
    el.style.opacity = this.burst.toFixed(3);
    if (this.burst > 0.01) el.style.transform = `rotate(${(Math.random() * 6).toFixed(2)}deg) scale(${(1 + Math.random() * 0.04).toFixed(3)})`;
  }

  // ────────────────────────── 主迴圈 ──────────────────────────
  frame() {
    let dt = Math.min(0.05, this.clock.getDelta());
    const intent = this.input.poll();
    for (const ev of intent.events) this._handleEvent(ev);

    if (this.state === 'playing' || this.state === 'won' || this.state === 'lost') {
      this.rig.look(intent.lookDX, intent.lookDY, intent.manualLook);
    }

    // 頓點：命中瞬間幾乎停住，接著慢動作逐漸恢復（卡肉感）
    const realDt = dt;
    if (this.hitStop > 0) {
      this.hitStop -= realDt;
      dt *= 0.02;
    } else if (this.slowMo > 0) {
      this.slowMo -= realDt;
      const k = 1 - Math.max(0, this.slowMo) / this.slowMoMax;
      dt *= this.cfg.strike.slowMoScale + (1 - this.cfg.strike.slowMoScale) * k * k;
    }
    this._updateSpeedBurst(realDt);

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
    // 手機：鉤住時（與放索後一小段）鏡頭轉向人物面朝的方向
    if (pc.anyAttached) this.sinceHooked = 0;
    else this.sinceHooked = (this.sinceHooked ?? 99) + dt;
    const C = this.cfg.camera;
    const hookFollow = this.touch && this.hookFollow && this.sinceHooked < C.hookFollowAfter && Math.hypot(pc.vel.x, pc.vel.z) > 4;
    // 準心推到畫面邊緣時，鏡頭慢慢跟著轉
    const t = this.input.touch;
    const R = this.cfg.reticle;
    if (this.touch && (Math.abs(t.aimX) > 0.85 || Math.abs(t.aimY) > 0.85)) this.rig.lastManualLook = this.rig.time;
    if (this.touch && Math.abs(t.aimX) > 0.85) this.rig.yaw -= Math.sign(t.aimX) * ((Math.abs(t.aimX) - 0.85) / 0.15) * R.edgeTurnRate * dt;
    if (this.touch && Math.abs(t.aimY) > 0.85) this.rig.pitch = Math.max(-1.35, Math.min(1.25, this.rig.pitch + Math.sign(t.aimY) * ((Math.abs(t.aimY) - 0.85) / 0.15) * R.edgeTurnRate * 0.6 * dt));
    this.rig.update(dt, pc, {
      touch: this.touch,
      joyX: intent.move.x,
      autoFollow: this.cameraFollow,
      followYaw: hookFollow ? this.model.yaw : null,
    });
    this.model.update(dt, pc, this.rig.yaw);
    this.city.update(pc.pos);

    // 鋼索瞄準預測（供下一次發射與 HUD 標記使用）
    this._updateAims();

    // 斬擊條件
    this.strikeEval = this._evaluate();
    if (this.strikeEval.ok && !this.wasReady) this.audio.play('ready');
    this.wasReady = this.strikeEval.ok;

    // 特效
    this.fx.update(dt, pc, this.model, this.camera);
    if (pc.boosting || pc.dashing) this.fx.gasPuff(pc.pos, pc.vel, true);
    if (pc.lunge) this.fx.trail(pc.pos);
    if (pc.sliding) this.fx.dust(pc.pos, pc.vel, 1);
    if (!titan.alive) {
      titan.chest.getWorldPosition(_v);
      this.fx.steam(_v, titan.state === 'dying' ? 3 : 1);
    } else if (titan.hp < this.cfg.titan.hp && Math.random() < 0.3) {
      this.fx.steam(this.napePos, 1);
    }

    this.audio.update(pc.feelSpeed, pc.boosting || pc.dashing, pc.dashing ? 1 : 0, pc.anyAttached);
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
      const a = (this.aims.auto = snapped || aimAt(0));
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
      case 'dash':
        this.audio.play('boost');
        break;
      case 'dashArrive':
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
