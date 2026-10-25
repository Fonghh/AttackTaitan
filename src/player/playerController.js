// 玩家移動與立體機動物理。不依賴渲染，可在 Node 測試。
import { Vector3 } from 'three';
import { Hook } from '../physics/grapple.js';
import {
  resolveWorldCollisions,
  applyRopeConstraint,
  collideSphereSphere,
  substepCount,
  softLimitSpeed,
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
    this.maxSpeed = 0;
    this.airTime = 0;
    this.hooks.left.reset();
    this.hooks.right.reset();
    this.events.length = 0;
  }

  get speed() {
    return this.vel.length();
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
      this.vel.y *= 1 + f.releaseBonus;
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
      if (h.updateFlight(dt, origin, cfg.hook.travelSpeed, cfg.hook.initialSlack, cfg.hook.range)) {
        this.emit('hookAttach', { side, point: h.target.clone() });
      }
    }

    // 輸入方向（以攝影機 yaw 為基準的水平方向）
    _fwd.set(-Math.sin(world.camYaw), 0, -Math.cos(world.camYaw));
    _right.set(-_fwd.z, 0, _fwd.x);
    _wish.set(0, 0, 0).addScaledVector(_fwd, intent.move.y).addScaledVector(_right, intent.move.x);
    if (_wish.lengthSq() > 1) _wish.normalize();

    const attached = this.anyAttached;
    this.reeling = attached ? intent.reel : 0;

    // 加速（消耗氣體）
    this.boosting = false;
    if (intent.boost && this.gas > 0 && !this.lunge) {
      if (this.grounded && intent.boostPressed) {
        // 地面上按加速 → 先起跳
        this.vel.y = Math.max(this.vel.y, P.jumpSpeed);
        this.grounded = false;
      }
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
    const airThrust = intent.jumpHeld && !this.grounded && !attached && this.gas > 0 && !this.lunge;
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
      if (this.hangArmTimer <= 0 || this.grounded || attached) this.hangArmed = false;
      else if (this.vel.y < cfg.fling.hangTriggerVy) {
        this.hangArmed = false;
        this.hangTimer = cfg.fling.hangDuration;
        this.emit('hang', {});
      }
    }

    // 衝刺斬（lunge）期間：直接朝弱點高速移動
    if (this.lunge) {
      this.lunge.timer -= dt;
      const tgt = this.lunge.target();
      _tmp.subVectors(tgt, this.pos);
      const d = _tmp.length();
      const spd = Math.max(this.speed, cfg.strike.lungeSpeed);
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
      if (!this.lunge) {
        const gScale = this.hangTimer > 0 ? cfg.fling.hangGravityScale : 1;
        this.vel.y -= cfg.gravity * gScale * h;

        if (this.grounded && !(attached && this.reeling > 0)) {
          this._groundMove(h, intent);
        } else {
          // 空中轉向
          this.vel.addScaledVector(_wish, P.airAccel * h);
          if (airThrust) this.vel.y += P.airThrust * h;
        }

        if (this.boosting) {
          // 沿視角方向推進（地面時偏水平）
          _tmp.copy(world.camForward);
          if (this.grounded) _tmp.y = Math.max(_tmp.y, 0.15);
          _tmp.normalize();
          this.vel.addScaledVector(_tmp, cfg.boost.accel * h);
        }

        // 空氣阻力
        const s = this.vel.length();
        this.vel.multiplyScalar(Math.max(0, 1 - s * P.dragCoef * h));
      }

      this.pos.addScaledVector(this.vel, h);

      // 鋼索約束（雙索時依序套用兩次以收斂）
      if (attached && !this.lunge) {
        for (let it = 0; it < 2; it++) {
          for (const side of ['left', 'right']) {
            const hk = this.hooks[side];
            if (!hk.attached) continue;
            hk.anchor(_anchor);
            const dist = this.pos.distanceTo(_anchor);
            if (it === 0) this._updateRopeLength(hk, dist, h, intent);
            hk.taut = applyRopeConstraint(this.pos, this.vel, _anchor, hk.length);
          }
        }
      }

      const res = resolveWorldCollisions(this.pos, this.vel, P.radius, world.colliders, world.wallRadius);
      if (world.titanSpheres) {
        for (const sp of world.titanSpheres) {
          if (collideSphereSphere(this.pos, this.vel, P.radius, sp.center, sp.r)) hitWall = true;
        }
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

    softLimitSpeed(this.vel, P.maxSpeed, P.softLimitRate, dt);
    this.maxSpeed = Math.max(this.maxSpeed, this.speed);
    if (hitWall) this.emit('bump', {});
  }

  _updateRopeLength(hk, dist, h, intent) {
    const H = this.cfg.hook;
    // 繩子不會比實際距離長太多（保持接近繃緊）
    hk.length = Math.min(hk.length, dist + H.maxSlack);
    let reelSpeed = H.autoReel;
    let reelAccel = 0;
    if (intent.reel > 0) {
      // k: 0 = 弱捲收（W／搖桿輕推），1 = 強捲收（Space／搖桿推到底）
      const k = intent.reelStrong ? 1 : Math.min(1, intent.reel);
      reelSpeed = Math.max(reelSpeed, H.weakReelSpeed + (H.reelSpeed - H.weakReelSpeed) * k);
      reelAccel = H.weakReelAccel + (H.reelAccel - H.weakReelAccel) * k;
    }
    hk.length = Math.max(H.minLength, hk.length - reelSpeed * h);
    if (reelAccel > 0 && dist > H.minLength) {
      hk.anchor(_anchor);
      _anchor.sub(this.pos).multiplyScalar(1 / dist);
      this.vel.addScaledVector(_anchor, reelAccel * h);
    }
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
