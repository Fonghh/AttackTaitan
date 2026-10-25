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
    this.reset(0);
  }

  reset(yaw) {
    this.yaw = yaw;
    this.pitch = -0.12;
    this.extraDist = 0;
    this.extraFov = 0;
    this.shake = 0;
    this.lastManualLook = -10;
    this.distSmooth = this.cfg.camera.distance;
    this.time = 0;
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
    const C = this.cfg.camera;
    this.time += dt;
    const speed = pc.speed;

    // 手機：放開拖曳一段時間後，空中自動轉向飛行方向；搖桿左右也帶動鏡頭
    if (opts.touch) {
      if (Math.abs(opts.joyX) > 0.2 && !pc.grounded) this.yaw -= opts.joyX * C.joystickTurnRate * dt;
      const hs = Math.hypot(pc.vel.x, pc.vel.z);
      if (this.time - this.lastManualLook > C.autoFollowDelay && !pc.grounded && hs > 8) {
        const ty = Math.atan2(-pc.vel.x, -pc.vel.z);
        let d = ty - this.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        const k = Math.min(1, C.autoFollowRate * dt * Math.min(1.5, hs / 25));
        this.yaw += d * k;
        const tp = Math.max(-0.5, Math.min(0.35, Math.atan2(pc.vel.y, hs) * 0.5)) - 0.08;
        this.pitch += (tp - this.pitch) * k * 0.6;
      }
    }

    this.updateForward();
    const f = this.forward;

    // 速度帶來的距離與 FOV
    const tgtDist = Math.min(C.maxExtraDist, Math.max(0, speed - 8) * C.distPerSpeed);
    const tgtFov = Math.min(C.maxExtraFov, Math.max(0, speed - 10) * C.fovPerSpeed);
    const kk = 1 - Math.exp(-3 * dt);
    this.extraDist += (tgtDist - this.extraDist) * kk;
    this.extraFov += (tgtFov - this.extraFov) * kk;

    // 目標點：角色上方，並加一點速度前導，方便預判下一勾
    _target.copy(pc.pos);
    _target.y += C.targetHeight;
    const dist = C.distance + this.extraDist;

    _right.set(-f.z, 0, f.x).normalize();
    _desired.copy(f).multiplyScalar(-dist).addScaledVector(_right, C.shoulder);
    _desired.y += 0.6;

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

    // 看向準星方向（準星 = 畫面中心 = forward 射線）
    _target.copy(cam.position).add(f);
    cam.lookAt(_target);

    // FOV：直立手機保證最小水平視角
    const aspect = cam.aspect;
    let vfov = C.fov + this.extraFov;
    const minV = (2 * Math.atan(Math.tan((C.minHFov * Math.PI) / 360) / aspect) * 180) / Math.PI;
    vfov = Math.min(C.maxVFov, Math.max(vfov, minV + this.extraFov * 0.5));
    if (Math.abs(cam.fov - vfov) > 0.01) {
      cam.fov = vfov;
      cam.updateProjectionMatrix();
    }
  }
}
