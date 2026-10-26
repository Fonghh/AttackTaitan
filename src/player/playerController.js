// 玩家移動與立體機動物理。不依賴渲染，可在 Node 測試。
import { Vector3 } from 'three';
import { Hook } from '../physics/grapple.js';
import {
  resolveWorldCollisions,
  applyRopeConstraint,
  collideSphereSphere,
  substepCount,
  softLimitSpeed,
  sphereOverlaps,
} from '../physics/motion.js';

const _wish = new Vector3();
const _tmp = new Vector3();
const _anchor = new Vector3();
const _right = new Vector3();
const _fwd = new Vector3();

export class PlayerController {
  constructor(cfg) {
    this.cfg = cfg;
    this.pos = new Vector3();
    this.vel = new Vector3();
    this.hooks = { left: new Hook('left'), right: new Hook('right') };
    this.events = []; // 給音效／特效用的事件
    this.ropeStyle = cfg.hook.style;
    this.speedScale = 1; // 速度倍率（暫停選單調整）：影響拉索、加速與最高速度
    this.dashScale = cfg.dash.defaultScale; // 衝刺倍率（暫停選單調整）
    this.steerScale = cfg.hook.pull.defaultSteerScale; // 左右擺盪倍率（暫停選單調整）
    this.grabbedBy = null; // 被哪隻巨人抓住
    this.reset();
  }

  reset() {
    const s = this.cfg.player.spawn;
    this.pos.set(s.x, s.y, s.z);
    this.vel.set(0, 0, 0);
    this.grounded = false;
    this.sliding = false;
    this.gas = this.cfg.boost.gasMax;
    this.hp = this.cfg.player.maxHp;
    this.boosting = false;
    this.reeling = 0;
    this.hangArmed = false;
    this.hangArmTimer = 0;
    this.hangTimer = 0;
    this.invuln = 0;
    this.lunge = null; // { timer, target: () => Vector3 }
    this.levi = null; // 兵長斬 { phase: 'windup'|'dash', t, side, done }
    this.dashing = false;
    this.dashHeld = 0; // 衝刺累積時間（氮氣式漸進加速）
    this.dashRamp = 0; // 目前衝刺力道比例
    this.dashGlow = 0; // 衝刺的速度感（放開後慢慢退，給鏡頭與特效用）
    this.capBoost = 0; // 放開衝刺後保留的最高速度上限（慢慢降）
    this.groundDashTimer = 0;
    this.wallCarry = new Vector3(); // 撞牆損失的水平速度
    this.wallCarryTimer = 0;
    this.carry = new Vector3(); // 放索後等待歸還的水平速度
    this.carryTimer = 0;
    this.pullReleaseTimer = 0;
    this.maxSpeed = 0;
    this.airTime = 0;
    this.hooks.left.reset();
    this.hooks.right.reset();
    this.events.length = 0;
  }

  /** 速度倍率換算後的「體感速度」：斬擊判定、速度線、鏡頭等速度感都用它 */
  get feelSpeed() {
    return this.vel.length() / Math.max(0.25, this.speedScale);
  }

  get speed() {
    return this.vel.length();
  }

  /** 是否有鋼索處於「衝刺後放鬆」狀態 */
  get anySlack() {
    return (this.hooks.left.attached && this.hooks.left.slack) || (this.hooks.right.attached && this.hooks.right.slack);
  }

  /** 衝刺斬／兵長斬期間：角色由招式控制，不受一般物理影響 */
  get busy() {
    return !!(this.lunge || this.levi);
  }

  get anyAttached() {
    return this.hooks.left.attached || this.hooks.right.attached;
  }

  emit(type, data) {
    this.events.push({ type, ...data });
  }

  fireHook(side, origin, hit) {
    const h = this.hooks[side];
    if (h.active) h.release();
    h.fire(origin, hit);
    this.emit('hookFire', { side });
  }

  releaseHook(side) {
    const h = this.hooks[side];
    if (!h.active) return;
    const wasAttached = h.attached;
    h.release();
    this.emit('hookRelease', { side });
    if (wasAttached && !this.anyAttached) this._onFullRelease();
  }

  releaseAll() {
    const wasAttached = this.anyAttached;
    this.hooks.left.release();
    this.hooks.right.release();
    if (wasAttached) {
      this.emit('hookRelease', { side: 'both' });
      this._onFullRelease();
    }
  }

  // 放開最後一條鋼索：往上甩時給額外上升速度，並準備頂點滯空
  _onFullRelease() {
    const f = this.cfg.fling;
    if (!this.grounded && this.vel.y > f.minUpVel) {
      if (this.ropeStyle === 'pull') {
        // 拉索放開：往上衝（像衝過牆頂那樣）
        const P = this.cfg.hook.pull;
        this.vel.y = this.vel.y * (1 + P.launchBonus) + P.launchUp * Math.max(0.3, this.speedScale);
        if (this.wallCarryTimer > 0) {
          this.carry.copy(this.wallCarry).multiplyScalar(P.wallCarry);
          this.carryTimer = 2.0;
        }
        this.pullReleaseTimer = 0.5;
      } else {
        this.vel.y *= 1 + f.releaseBonus;
      }
      this.hangArmed = true;
      this.hangArmTimer = f.armWindow;
      this.emit('fling', {});
    }
  }

  damage(amount, knock) {
    if (this.invuln > 0 || this.hp <= 0) return false;
    this.hp = Math.max(0, this.hp - amount);
    this.invuln = this.cfg.player.invulnTime;
    this.vel.copy(knock);
    this.lunge = null;
    this.releaseAll();
    this.hangArmed = false;
    this.emit('hurt', { amount });
    return true;
  }

  /**
   * @param {number} dt
   * @param {object} intent 本幀輸入
   * @param {{colliders:any[], wallRadius:number, titanSpheres?:{center:Vector3,r:number}[],
   *          camYaw:number, camForward:Vector3}} world
   */
  update(dt, intent, world) {
    const cfg = this.cfg;
    const P = cfg.player;
    if (this.invuln > 0) this.invuln -= dt;

    // 鉤爪飛行
    const origin = _tmp.copy(this.pos);
    origin.y += 0.3;
    for (const side of ['left', 'right']) {
      const h = this.hooks[side];
      const wasFlying = h.state === 'flying';
      if (h.updateFlight(dt, origin, cfg.hook.travelSpeed, cfg.hook.initialSlack, cfg.hook.range)) {
        this.emit('hookAttach', { side, point: h.target.clone() });
      } else if (wasFlying && h.state === 'idle') {
        this.emit('hookFail', { side }); // 目標在飛行途中跑掉（例如巨人移動）
      }
      if (h.attached) h.attachTime += dt;
    }

    // 輸入方向（以攝影機 yaw 為基準的水平方向）
    _fwd.set(-Math.sin(world.camYaw), 0, -Math.cos(world.camYaw));
    _right.set(-_fwd.z, 0, _fwd.x);
    _wish.set(0, 0, 0).addScaledVector(_fwd, intent.move.y).addScaledVector(_right, intent.move.x);
    if (_wish.lengthSq() > 1) _wish.normalize();

    const attached = this.anyAttached;
    // 衝刺：鉤住時按住衝刺鍵＝快速捲收鋼索
    const dashing = attached && intent.boost && this.gas > 0 && !this.busy;
    this.dashing = dashing;
    const D = cfg.dash;
    if (dashing) this.dashHeld = Math.min(D.rampTime, this.dashHeld + dt);
    else this.dashHeld = Math.max(0, this.dashHeld - dt * D.rampDecay);
    const rx = this.dashHeld / D.rampTime;
    this.dashRamp = D.rampStart + (1 - D.rampStart) * rx * rx * (3 - 2 * rx);
    this.dashGlow = dashing ? Math.max(this.dashGlow, this.dashRamp) : Math.max(0, this.dashGlow - dt * 0.6);
    if (dashing) {
      this.gas = Math.max(0, this.gas - cfg.dash.gasUse * dt);
      if (intent.boostPressed) {
        // 重新按下衝刺：放鬆的鋼索重新拉緊
        for (const side of ['left', 'right']) {
          const hk = this.hooks[side];
          if (hk.attached && (hk.slack || !hk.pullOn)) {
            hk.slack = false;
            hk.pullOn = true;
          }
        }
        this._dashKick(_wish);
        this.emit('dash', {});
      }
    }
    // 拉索模式：勾住就一直被拉；擺盪模式：只有 Space 捲收
    // 拉索靠近勾點後停止拉動（鋼索不斷，改成繞勾點擺盪），拉遠了再恢復
    if (attached && this.ropeStyle === 'pull') {
      const A = cfg.hook.pull.arriveDist;
      for (const side of ['left', 'right']) {
        const hk = this.hooks[side];
        if (!hk.attached) continue;
        const d = this.pos.distanceTo(hk.anchor(_anchor));
        const passed = d < A * 2.5 && this.vel.dot(_tmp.subVectors(_anchor, this.pos)) < 0; // 已經衝過勾點
        if (hk.pullOn && (d < A || passed)) {
          hk.pullOn = false;
          if (dashing) this._dashArrive(hk, d);
          else this.emit('arrive', { side });
        } else if (!hk.pullOn && !hk.slack && d > A * 3) hk.pullOn = true;
      }
    }
    const pulling = attached && this.ropeStyle === 'pull' && !this.busy && (this.hooks.left.pullOn || this.hooks.right.pullOn);
    this.pulling = pulling;
    this.reeling = pulling ? 1 : attached ? Math.max(intent.reel, dashing ? 1 : 0) : 0;

    // 地面衝刺：壓低身體滑鏟（可從巨人腳下穿過）
    if (this.groundDashTimer > 0) this.groundDashTimer -= dt;
    if (intent.boostPressed && this.grounded && !attached && !this.busy && this.gas >= D.groundGas * 0.5) this._groundDash(_wish, world);
    // 加速（消耗氣體）：空中沿視角方向噴氣
    this.boosting = false;
    if (intent.boost && this.gas > 0 && !this.busy && !attached && !this.grounded && this.groundDashTimer <= 0) {
      this.boosting = true;
      this.gas = Math.max(0, this.gas - cfg.boost.gasUse * dt);
    }

    // 跳躍 / 空中上升
    if (intent.jump && this.grounded && !attached) {
      this.vel.y = P.jumpSpeed;
      this.grounded = false;
      this.sliding = false;
      this.emit('jump', {});
    }
    const airThrust = intent.jumpHeld && !this.grounded && !attached && this.gas > 0 && !this.busy;
    if (airThrust) this.gas = Math.max(0, this.gas - cfg.boost.gasUse * 0.6 * dt);

    // 氣體回復
    if (!this.boosting && !airThrust) {
      const regen = this.grounded ? cfg.boost.regenGround : cfg.boost.regenAir;
      this.gas = Math.min(cfg.boost.gasMax, this.gas + regen * dt);
    }

    // 滯空計時
    if (this.hangTimer > 0) this.hangTimer -= dt;
    if (this.hangArmed) {
      this.hangArmTimer -= dt;
      if (this.hangArmTimer <= 0 || this.grounded || (attached && !this.anySlack)) this.hangArmed = false;
      else if (this.vel.y < cfg.fling.hangTriggerVy) {
        this.hangArmed = false;
        this.hangTimer = cfg.fling.hangDuration;
        this.emit('hang', {});
      }
    }

    // 兵長斬：空中短拍 → 沿鋼索迴旋直衝勾點
    if (this.levi) this._leviMove(dt);

    // 衝刺斬（lunge）期間：直接朝弱點高速移動
    if (this.lunge) {
      this.lunge.timer -= dt;
      const tgt = this.lunge.target();
      _tmp.subVectors(tgt, this.pos);
      const d = _tmp.length();
      const spd = Math.max(this.speed, cfg.strike.lungeSpeed * Math.max(0.3, this.speedScale));
      this.vel.copy(_tmp).multiplyScalar(spd / Math.max(d, 1e-3));
      if (d <= cfg.strike.lungeHitDist || this.lunge.timer <= 0) {
        this.lunge.done = true;
      }
    }

    const wasGrounded = this.grounded;
    const n = substepCount(this.speed + 10, dt);
    const h = dt / n;
    let grounded = false;
    let hitWall = false;

    for (let i = 0; i < n; i++) {
      if (!this.busy) {
        const gScale = pulling ? (dashing ? cfg.dash.gravityScale : cfg.hook.pull.gravityScale) : this.hangTimer > 0 ? cfg.fling.hangGravityScale : 1;
        this.vel.y -= cfg.gravity * gScale * h;

        if (this.grounded && !(attached && this.reeling > 0)) {
          this._groundMove(h, intent);
        } else {
          // 空中轉向；勾住時側向操控更強（朝方向鍵的方向擺盪／橫移）
          const steer = attached ? (this.ropeStyle === 'pull' ? cfg.hook.pull.steerAccel : P.airAccel) * this.steerScale : P.airAccel;
          this.vel.addScaledVector(_wish, steer * h);
          if (airThrust) this.vel.y += P.airThrust * h;
        }

        // 鋼索的力：捲收（朝勾點的推力）、擺盪推力、勾住時加速沿擺盪方向
        let swingBoosted = false;
        if (attached) swingBoosted = this._ropeForces(h, world);

        if (this.boosting && !swingBoosted) {
          // 沿視角方向推進（地面時偏水平）
          _tmp.copy(world.camForward);
          if (this.grounded) _tmp.y = Math.max(_tmp.y, 0.15);
          _tmp.normalize();
          this.vel.addScaledVector(_tmp, cfg.boost.accel * this.speedScale * h);
        }

        // 空氣阻力
        const s = this.vel.length();
        this.vel.multiplyScalar(Math.max(0, 1 - s * P.dragCoef * h));
      }

      this.pos.addScaledVector(this.vel, h);

      // 鋼索約束（雙索時依序套用兩次以收斂）
      if (attached && !this.busy) {
        for (let it = 0; it < 2; it++) {
          for (const side of ['left', 'right']) {
            const hk = this.hooks[side];
            if (!hk.attached) continue;
            hk.anchor(_anchor);
            if (it === 0 && this.reeling > 0 && !hk.slack) {
              // 捲收時繩長跟著實際距離縮短（不會反過來把角色硬拉過去）
              const dist = this.pos.distanceTo(_anchor);
              hk.length = Math.max(cfg.hook.minLength, Math.min(hk.length, dist));
            }
            const r = applyRopeConstraint(this.pos, this.vel, _anchor, hk.length, cfg.hook.maxCorrection);
            hk.taut = r.taut;
            hk.length = r.length;
          }
        }
      }

      const res = resolveWorldCollisions(this.pos, this.vel, P.radius, world.colliders, world.wallRadius);
      if (world.titanSpheres) {
        for (const sp of world.titanSpheres) {
          if (collideSphereSphere(this.pos, this.vel, P.radius, sp.center, sp.r)) hitWall = true;
        }
      }
      // 勾住時撞牆：把撞擊速度轉成沿牆往上衝（像跑上牆面），放索後就能翻上屋頂
      if ((attached || this.pullReleaseTimer > 0) && !this.busy && res.wallImpact > 4) {
        // 記住撞進牆裡的水平速度，翻過牆頂後還給角色（衝過牆頂繼續往前飛）
        const lost = _tmp.copy(res.wallNormal).multiplyScalar(-res.wallImpact);
        lost.y = 0;
        if (attached) {
          this.vel.y = Math.max(this.vel.y, 0) + res.wallImpact * cfg.hook.wallRunUp;
          if (lost.length() > this.wallCarry.length()) this.wallCarry.copy(lost);
          this.wallCarryTimer = 0.6;
        } else if (lost.length() * cfg.hook.pull.wallCarry > this.carry.length() || this.carryTimer <= 0) {
          // 剛放索就撞牆：直接記下，翻過牆頂後歸還
          this.carry.copy(lost).multiplyScalar(cfg.hook.pull.wallCarry);
          this.carryTimer = 2.0;
        }
        this.emit('wallRun', { speed: res.wallImpact });
      }
      grounded = grounded || res.grounded;
      hitWall = hitWall || res.hitWall;
      this.grounded = res.grounded;
    }
    this.grounded = grounded;

    // 落地判定 → 滑行
    if (this.grounded && !wasGrounded) {
      const hs = Math.hypot(this.vel.x, this.vel.z);
      this.sliding = hs > cfg.slide.minSpeed;
      this.emit('land', { speed: hs, slide: this.sliding, airTime: this.airTime });
      this.hangTimer = 0;
      this.airTime = 0;
    }
    if (!this.grounded) {
      this.airTime += dt;
      this.sliding = false;
    }

    // 撞牆速度的記憶與歸還：離開牆面（翻過牆頂）時把水平速度還回去
    if (this.pullReleaseTimer > 0) this.pullReleaseTimer -= dt;
    if (this.wallCarryTimer > 0) {
      this.wallCarryTimer -= dt;
      if (this.wallCarryTimer <= 0) this.wallCarry.set(0, 0, 0);
    }
    if (this.carryTimer > 0) {
      this.carryTimer -= dt;
      if (this.grounded || (this.anyAttached && !this.anySlack) || this.carryTimer <= 0) {
        this.carryTimer = 0;
    this.pullReleaseTimer = 0;
      } else if (!sphereOverlaps(_tmp.copy(this.carry).normalize().multiplyScalar(1.5).add(this.pos), P.radius, world.colliders)) {
        // 前方 1.5m 已經沒有牆（翻過牆頂了）
        this.vel.add(this.carry);
        this.carryTimer = 0;
    this.pullReleaseTimer = 0;
        this.emit('vault', {});
      }
    }

    // 最高速度：衝刺時依力道逐步放寬；放開後保留當下速度，再慢慢降回一般上限（不會一放就掉速）
    const baseCap = Math.max(P.minSpeedCap, P.maxSpeed * this.speedScale);
    const dashCap = Math.max(baseCap, D.speed * this.dashScale * D.maxSpeedFactor);
    let cap = baseCap;
    if (this.dashing) {
      cap = baseCap + (dashCap - baseCap) * this.dashRamp;
      this.capBoost = Math.max(this.capBoost, Math.min(cap, this.speed));
    } else {
      this.capBoost = Math.max(0, this.capBoost - D.carryDecay * dt);
      cap = Math.max(cap, this.capBoost);
      if (this.anySlack) cap = Math.max(cap, dashCap);
    }
    if (this.levi || this.groundDashTimer > 0) cap = Math.max(cap, this.speed);
    softLimitSpeed(this.vel, cap, P.softLimitRate, dt);
    this.maxSpeed = Math.max(this.maxSpeed, this.speed);
    if (hitWall) this.emit('bump', {});
  }

  /** 地面衝刺：壓低身體沿搖桿（沒推就沿視角）方向滑鏟 */
  _groundDash(wish, world) {
    const D = this.cfg.dash;
    if (wish.lengthSq() > 0.04) _tmp.copy(wish).setY(0);
    else _tmp.copy(world.camForward).setY(0);
    if (_tmp.lengthSq() < 1e-4) return;
    _tmp.normalize();
    const sp = Math.max(Math.hypot(this.vel.x, this.vel.z), D.groundSpeed * Math.max(0.7, this.speedScale));
    this.vel.x = _tmp.x * sp;
    this.vel.z = _tmp.z * sp;
    this.vel.y = Math.min(this.vel.y, 0);
    this.sliding = true;
    this.groundDashTimer = D.groundTime;
    this.gas = Math.max(0, this.gas - D.groundGas);
    this.emit('groundDash', {});
  }

  /** 兵長斬：開始空中短拍（之後自動沿鋼索直衝） */
  startLevi(side) {
    if (!this.hooks[side].attached || this.busy) return false;
    this.levi = { phase: 'windup', t: 0, side, done: false };
    this.hooks[side].slack = false;
    this.grounded = false;
    this.sliding = false;
    this.emit('leviWindup', { side });
    return true;
  }

  _leviMove(dt) {
    const L = this.levi;
    const C = this.cfg.strike;
    const hk = this.hooks[L.side];
    if (!hk.attached) {
      this.levi = null; // 鋼索被解除 → 取消
      return;
    }
    L.t += dt;
    hk.anchor(_anchor);
    if (L.phase === 'windup') {
      // 空中短拍：速度快速收住、微微浮起
      const k = Math.exp(-9 * dt);
      this.vel.x *= k;
      this.vel.z *= k;
      this.vel.y = this.vel.y * k + C.leviFloat * (1 - k);
      if (L.t >= C.leviWindup) {
        L.phase = 'dash';
        L.t = 0;
        L.speed = Math.max(this.speed, C.leviSpeed * Math.max(0.45, this.speedScale));
        this.emit('leviDash', {});
      }
      return;
    }
    _tmp.subVectors(_anchor, this.pos);
    const d = _tmp.length();
    this.vel.copy(_tmp).multiplyScalar(L.speed / Math.max(d, 1e-3));
    hk.length = Math.max(this.cfg.hook.minLength, d);
    if (d <= C.leviHitDist + L.speed * dt || L.t >= C.leviMaxTime) L.done = true;
  }

  /** 按下衝刺瞬間：沿搖桿方向（沒推搖桿就沿目前擺盪方向）補一下推力 */
  _dashKick(wish) {
    const D = this.cfg.dash;
    for (const side of ['left', 'right']) {
      const hk = this.hooks[side];
      if (!hk.attached) continue;
      hk.anchor(_anchor).sub(this.pos).normalize();
      if (wish.lengthSq() > 0.04) _tmp.copy(wish);
      else _tmp.copy(this.vel);
      _tmp.addScaledVector(_anchor, -_tmp.dot(_anchor)); // 只取垂直於繩子的方向
      if (_tmp.lengthSq() < 1e-3) return;
      this.vel.addScaledVector(_tmp.normalize(), D.swingKick * Math.max(0.4, this.dashScale) * this.dashRamp);
      return;
    }
  }

  /** 衝刺到勾點：鋼索放鬆（不斷），向上加成，帶著速度衝過頭往上飛 */
  _dashArrive(hk, d) {
    const D = this.cfg.dash;
    hk.slack = true;
    hk.length = d + D.slackExtra;
    if (this.vel.y > 0) this.vel.y = this.vel.y * (1 + D.launchBonus) + D.launchUp * Math.max(0.3, this.dashScale);
    // 撞牆損失的水平速度一樣在翻過牆頂後歸還
    if (this.wallCarryTimer > 0) {
      this.carry.copy(this.wallCarry).multiplyScalar(this.cfg.hook.pull.wallCarry);
      this.carryTimer = 2.0;
    }
    this.pullReleaseTimer = 0.5;
    this.hangArmed = true;
    this.hangArmTimer = this.cfg.fling.armWindow;
    this.emit('dashArrive', {});
  }

  /**
   * 勾住時的額外力量。回傳 true 表示加速已沿擺盪方向套用。
   */
  _ropeForces(h, world) {
    const H = this.cfg.hook;
    let boosted = false;
    for (const side of ['left', 'right']) {
      const hk = this.hooks[side];
      if (!hk.attached || hk.slack) continue; // 放鬆中的鋼索不施力
      hk.anchor(_anchor);
      _anchor.sub(this.pos);
      const dist = _anchor.length();
      if (dist < 1e-3) continue;
      _anchor.multiplyScalar(1 / dist); // 指向勾點的單位向量
      if (this.pulling && hk.pullOn) {
        // 拉索：朝勾點加速到 maxSpeed，切線速度保留 → 帶著原本的慣性畫出弧線
        const along = this.vel.dot(_anchor);
        // 速度倍率很低時，拉力仍保有下限（否則拉不贏重力），但最高速度照比例降
        if (this.dashing) {
          // 衝刺（擺盪式）：快速收繩，但不壓掉側向速度；繩子變短時切線速度變快（角動量守恆）
          const D = this.cfg.dash;
          const r = this.dashRamp; // 氮氣式：按越久收得越快
          const reel = D.reelSpeed * this.dashScale * r;
          // 實際把繩子收短（鋼索約束每步最多修正 maxCorrection，不會瞬移）
          hk.length = Math.max(H.minLength, Math.min(hk.length, dist) - reel * h);
          if (along < reel) this.vel.addScaledVector(_anchor, Math.min(D.radialAccel * Math.max(0.4, this.dashScale) * r * h, reel - along));
          if (hk.prevDist && dist < hk.prevDist) {
            const k = (Math.min(D.spinUpMax, hk.prevDist / dist) - 1) * r;
            _tmp.copy(this.vel).addScaledVector(_anchor, -this.vel.dot(_anchor));
            this.vel.addScaledVector(_tmp, k);
          }
          hk.prevDist = dist;
          continue;
        }
        hk.prevDist = 0;
        const room = Math.max(H.pull.minSpeed, H.pull.maxSpeed * this.speedScale) - along;
        const acc = Math.max(H.pull.minAccel, H.pull.accel * this.speedScale);
        const damp = H.pull.sideDamp;
        if (room > 0) this.vel.addScaledVector(_anchor, Math.min(acc * h, room));
        // 側向速度慢慢收斂，路線最後會對準勾點（但保留一段弧線）
        _tmp.copy(this.vel).addScaledVector(_anchor, -this.vel.dot(_anchor));
        this.vel.addScaledVector(_tmp, -Math.min(1, damp * h));
        continue;
      }
      if (this.reeling > 0 && dist > H.minLength) {
        // 擺盪模式的衝刺＝強力捲收
        const acc = this.dashing ? this.cfg.dash.accel * Math.max(0.4, this.dashScale) : H.reelAccel * this.reeling;
        if (!this.dashing || this.vel.dot(_anchor) < this.cfg.dash.speed * this.dashScale) this.vel.addScaledVector(_anchor, acc * h);
      }
      // 切線方向：速度扣掉沿繩方向的分量
      _tmp.copy(this.vel).addScaledVector(_anchor, -this.vel.dot(_anchor));
      const ts = _tmp.length();
      if (ts > 2) {
        _tmp.multiplyScalar(1 / ts);
        if (hk.taut) this.vel.addScaledVector(_tmp, H.swingPump * h);
        if (this.boosting && !boosted) {
          this.vel.addScaledVector(_tmp, this.cfg.boost.accel * this.speedScale * H.boostSwing * h);
          boosted = true;
        }
      }
    }
    return boosted;
  }

  _groundMove(h, intent) {
    const cfg = this.cfg;
    const P = cfg.player;
    if (this.sliding) {
      // 慣性滑行：水平速度逐漸衰減，可微調方向
      const hs = Math.hypot(this.vel.x, this.vel.z);
      const ns = Math.max(0, hs - cfg.slide.decel * h);
      if (hs > 1e-4) {
        this.vel.x *= ns / hs;
        this.vel.z *= ns / hs;
      }
      this.vel.addScaledVector(_wish, cfg.slide.steer * h);
      if (ns < P.runSpeed * 0.9) this.sliding = false;
      return;
    }
    const tx = _wish.x * P.runSpeed;
    const tz = _wish.z * P.runSpeed;
    const dx = tx - this.vel.x;
    const dz = tz - this.vel.z;
    const dl = Math.hypot(dx, dz);
    const maxDv = P.runAccel * h;
    if (dl > maxDv) {
      this.vel.x += (dx / dl) * maxDv;
      this.vel.z += (dz / dl) * maxDv;
    } else {
      this.vel.x = tx;
      this.vel.z = tz;
    }
  }
}
