// 第三人稱攝影機：越肩視角、依速度拉遠與加大 FOV、防穿牆、手機自動跟隨飛行方向。
import * as THREE from 'three';

const _target = new THREE.Vector3();
const _desired = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();

export class CameraRig {
  constructor(camera, cfg, blockers) {
    this.camera = camera;
    this.cfg = cfg;
    this.blockers = blockers;
    this.ray = new THREE.Raycaster();
    this.forward = new THREE.Vector3(0, 0, -1);
    this.offset = new THREE.Vector3(0, 2, 6);
    this.followDir = new THREE.Vector3(0, 0, -1);
    this.punchDir = new THREE.Vector3();
    this.reset(0);
  }

  reset(yaw) {
    this.yaw = yaw;
    this.pitch = -0.12;
    this.extraDist = 0;
    this.extraFov = 0;
    this.shake = 0;
    this.fovKick = 0;
    this.cine = null;
    this.lastManualLook = -10;
    this.distSmooth = this.cfg.camera.distance;
    this.time = 0;
    this.roll = 0;
    this.yawRate = 0;
    this._lastYaw = yaw;
    this.punchT = 0;
    this.locked = false;
    this.followDir.set(-Math.sin(yaw), 0, -Math.cos(yaw));
  }

  /** 命中瞬間：鏡頭往命中點推近一下 */
  punch(point) {
    const P = this.cfg.camera.punch;
    this.punchDir.subVectors(point, this.camera.position);
    this.punchT = P.time;
  }

  /** 鏡頭推拉：負值＝往前推（視角變窄），正值＝拉寬，之後自動回復 */
  kick(deg) {
    this.fovKick += deg;
  }

  /** 擊殺特寫：從巨人側面看後頸，慢動作約 1 秒後切回 */
  startKillCam(titan, napePos) {
    const s = titan.scale;
    const f = titan.forward;
    const side = new THREE.Vector3(-f.z, 0, f.x);
    // 選離目前鏡頭比較近的那一側，切換比較不突兀
    if (side.dot(_dir.subVectors(this.camera.position, napePos)) < 0) side.negate();
    const pos = napePos.clone().addScaledVector(side, 9 * s).addScaledVector(f, -3 * s);
    pos.y += 1.2 * s;
    this.cine = { t: 1.1, pos, look: napePos.clone() };
    this.camera.position.copy(pos);
  }

  addShake(a) {
    this.shake = Math.min(1.2, this.shake + a);
  }

  /** 手動轉視角（滑鼠或觸控拖曳） */
  look(dx, dy, manual) {
    this.yaw -= dx;
    this.pitch = Math.max(-1.35, Math.min(1.25, this.pitch - dy));
    if (manual) this.lastManualLook = this.time;
  }

  updateForward() {
    const cp = Math.cos(this.pitch);
    this.forward.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  update(dt, pc, opts) {
    // 擊殺特寫中：鏡頭固定在側面看著後頸（用真實時間計時，不受慢動作影響）
    if (this.cine) {
      const c = this.cine;
      c.t -= opts.realDt ?? dt;
      this.camera.position.lerp(c.pos, 0.2);
      this.camera.lookAt(c.look);
      if (Math.abs(this.camera.fov - 55) > 0.01) {
        this.camera.fov = 55;
        this.camera.updateProjectionMatrix();
      }
      if (c.t <= 0) this.cine = null;
      return;
    }
    const C = this.cfg.camera;
    this.time += dt;
    const speed = pc.feelSpeed ?? pc.speed; // 速度倍率換算後的體感速度

    // 空中自動轉向飛行方向。用平滑過的速度方向，擺盪時鏡頭不會跟著急轉。
    const hs = Math.hypot(pc.vel.x, pc.vel.z);
    if (hs > 3) {
      const k = 1 - Math.exp(-dt / C.followSmoothTime);
      this.followDir.x += (pc.vel.x / hs - this.followDir.x) * k;
      this.followDir.z += (pc.vel.z / hs - this.followDir.z) * k;
    }
    // 空中推左搖桿左右：鏡頭跟著轉（用真實時間，慢動作時也轉得動）；轉動時暫停「鉤住時鏡頭跟隨」
    const J = C.joyTurn;
    const ax = Math.abs(opts.joyX || 0);
    if (opts.touch && opts.joyTurn > 0 && ax > J.deadZone && !pc.grounded) {
      const k = Math.pow((ax - J.deadZone) / (1 - J.deadZone), J.curve);
      this.yaw -= Math.sign(opts.joyX) * k * J.rate * opts.joyTurn * (opts.realDt ?? dt);
      this.lastManualLook = this.time;
    }
    // 鎖定鏡頭：對準目標巨人（手動轉鏡頭後一小段時間不搶）
    const LK = C.lock;
    this.locked = !!opts.lockTarget;
    if (opts.lockTarget && this.time - this.lastManualLook > LK.manualPause) {
      _dir.subVectors(opts.lockTarget, pc.pos);
      _dir.y -= C.targetHeight + LK.raise * 0.5;
      const ty = Math.atan2(-_dir.x, -_dir.z);
      const tp = Math.max(-1.1, Math.min(1.1, Math.atan2(_dir.y, Math.hypot(_dir.x, _dir.z))));
      let d = ty - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      const k = Math.min(1, LK.rate * (opts.realDt ?? dt));
      this.yaw += d * k;
      this.pitch += (tp - this.pitch) * k;
    }
    // 鉤住時跟隨人物面朝方向（手動拖曳轉視角後 0.5 秒內不干擾）
    if (!opts.lockTarget && opts.followYaw != null && this.time - this.lastManualLook > 0.5) {
      let d = opts.followYaw - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      const k = Math.min(1, C.hookFollowRate * dt);
      this.yaw += d * k;
      // 靠近巨人時往上仰（lowAngle 0～1）
      this.pitch += (C.followPitch + (opts.lowAngle || 0) * 0.34 - this.pitch) * k * 0.3;
    }
    const delay = opts.touch ? C.autoFollowDelayTouch : C.autoFollowDelayMouse;
    const fl = Math.hypot(this.followDir.x, this.followDir.z);
    if (!opts.lockTarget && opts.autoFollow && this.time - this.lastManualLook > delay && !pc.grounded && hs > 8 && fl > 0.3) {
      const ty = Math.atan2(-this.followDir.x, -this.followDir.z);
      let d = ty - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      // 速度越快跟得越緊；快要掉頭（>120°）時放慢，避免鏡頭甩過頭
      const rate = C.autoFollowRate * Math.min(1.3, hs / 25) * (Math.abs(d) > 2.1 ? 0.4 : 1);
      const k = Math.min(1, rate * dt);
      this.yaw += d * k;
      this.pitch += (C.followPitch - this.pitch) * k * 0.5;
    }

    this.updateForward();
    const f = this.forward;

    // 速度帶來的距離與 FOV（近距離廣角鏡頭：角色更大、FOV 拉更開）
    // 衝刺時鏡頭拉近角色，平常速度越快拉越遠
    const CL = opts.closeCam ? C.close : null;
    const baseDist = CL ? CL.distance : C.distance;
    const maxExtra = CL ? CL.maxExtraDist : C.maxExtraDist;
    const tgtDist = opts.close ? -Math.min(2.2, baseDist * 0.4) : Math.min(maxExtra, Math.max(0, speed - 8) * C.distPerSpeed);
    const tgtFov = Math.min(CL ? CL.maxExtraFov : C.maxExtraFov, Math.max(0, speed - 10) * (CL ? CL.fovPerSpeed : C.fovPerSpeed));
    const kk = 1 - Math.exp(-3 * dt);
    this.extraDist += (tgtDist - this.extraDist) * kk;
    this.extraFov += (tgtFov - this.extraFov) * kk;

    // 目標點：角色上方，並加一點速度前導，方便預判下一勾
    _target.copy(pc.pos);
    _target.y += C.targetHeight;
    const dist = baseDist + this.extraDist;

    // 貼地高速飛行：鏡頭壓低，地面從旁邊刷過去
    const G = C.groundSkim;
    const skim = !pc.grounded && pc.pos.y < G.height && speed > G.minSpeed ? 1 - pc.pos.y / G.height : 0;
    this.skim = (this.skim || 0) + (skim - (this.skim || 0)) * Math.min(1, dt * 4);
    _right.set(-f.z, 0, f.x).normalize();
    _desired.copy(f).multiplyScalar(-dist).addScaledVector(_right, C.shoulder);
    _desired.y += 0.6 - (opts.lowAngle || 0) * 1.6 - this.skim * G.drop + (this.locked ? C.lock.raise : 0); // 靠近巨人時鏡頭壓低

    // 平滑的是「相對位移」，所以高速時不會落後角色
    const ko = 1 - Math.exp(-C.offsetSmooth * dt);
    this.offset.lerp(_desired, ko);

    // 防穿牆：從角色往攝影機射線
    _dir.copy(this.offset);
    const len = _dir.length();
    _dir.multiplyScalar(1 / len);
    this.ray.set(_target, _dir);
    this.ray.far = len + 0.4;
    const hits = this.ray.intersectObjects(this.blockers, false);
    let useLen = len;
    if (hits.length) useLen = Math.max(0.8, hits[0].distance - 0.4);
    this.distSmooth = useLen < this.distSmooth ? useLen : this.distSmooth + (useLen - this.distSmooth) * (1 - Math.exp(-6 * dt));

    const cam = this.camera;
    cam.position.copy(_target).addScaledVector(_dir, this.distSmooth);
    if (cam.position.y < 0.4) cam.position.y = 0.4;

    // 震動
    if (this.shake > 0) {
      const s = this.shake * this.shake * 0.5;
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
      cam.position.z += (Math.random() - 0.5) * s;
      this.shake = Math.max(0, this.shake - dt * 2.5);
    }

    // 命中推近
    if (this.punchT > 0) {
      const P = this.cfg.camera.punch;
      this.punchT -= opts.realDt ?? dt;
      const k = Math.sin(Math.max(0, this.punchT / P.time) * Math.PI);
      cam.position.addScaledVector(this.punchDir, P.amount * k * 0.5);
    }

    // 看向準星方向（準星 = 畫面中心 = forward 射線）
    _target.copy(cam.position).add(f);
    cam.lookAt(_target);

    // 側傾：側向加速度往哪邊，鏡頭就往哪邊傾（像飛機轉彎）
    // 傾斜來源：鏡頭轉動的速度（繞圈、轉彎時往彎內傾）＋側向加速度（擺盪甩動）
    const R = C.roll;
    let dyaw = this.yaw - this._lastYaw;
    dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    this._lastYaw = this.yaw;
    if (dt > 1e-5) this.yawRate += (dyaw / dt - this.yawRate) * Math.min(1, dt * 6);
    let tgtRoll = 0;
    if (opts.rollLevel > 0 && pc.accel && !pc.grounded) {
      const lat = pc.accel.x * _right.x + pc.accel.z * _right.z;
      const max = (R.maxDeg * Math.PI) / 180;
      tgtRoll = Math.max(-max, Math.min(max, this.yawRate * R.perYawRate - lat * R.perAccel)) * opts.rollLevel;
    }
    this.roll += (tgtRoll - this.roll) * Math.min(1, R.rate * dt);
    if (Math.abs(this.roll) > 1e-4) cam.rotateZ(this.roll);

    // FOV：直立手機保證最小水平視角
    const aspect = cam.aspect;
    this.fovKick *= Math.exp(-7 * dt);
    let vfov = C.fov + this.extraFov + this.fovKick;
    const minV = (2 * Math.atan(Math.tan((C.minHFov * Math.PI) / 360) / aspect) * 180) / Math.PI;
    vfov = Math.min(C.maxVFov, Math.max(vfov, minV + this.extraFov * 0.5));
    if (Math.abs(cam.fov - vfov) > 0.01) {
      cam.fov = vfov;
      cam.updateProjectionMatrix();
    }
  }
}
