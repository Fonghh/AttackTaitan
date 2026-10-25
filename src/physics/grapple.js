// 單條鋼索的狀態機：idle → flying（鉤爪飛行中）→ attached（勾住，產生約束）
import { Vector3, Quaternion, Raycaster } from 'three';

const _v = new Vector3();
const _q = new Quaternion();
const _up = new Vector3(0, 1, 0);

export class Hook {
  /** @param {'left'|'right'} side */
  constructor(side) {
    this.side = side;
    this.reset();
  }

  reset() {
    this.state = 'idle';
    this.head = new Vector3(); // 鉤爪目前位置（飛行中）
    this.target = new Vector3(); // 命中點（世界座標，發射時）
    this.object = null; // 勾住的物件（可能會移動，例如巨人）
    this.local = new Vector3(); // 命中點在物件座標系中的位置
    this.length = 0;
    this.taut = false;
    this.attachedAt = 0;
  }

  get attached() {
    return this.state === 'attached';
  }

  get active() {
    return this.state !== 'idle';
  }

  /** 發射鉤爪。hit = { point, object } */
  fire(origin, hit) {
    this.state = 'flying';
    this.head.copy(origin);
    this.target.copy(hit.point);
    this.object = hit.object;
    this.object.updateMatrixWorld();
    this.local.copy(hit.point);
    this.object.worldToLocal(this.local);
  }

  release() {
    const was = this.state;
    this.reset();
    return was;
  }

  /** 錨點的世界座標（跟著物件移動） */
  anchor(out) {
    out.copy(this.local);
    return this.object.localToWorld(out);
  }

  /**
   * 更新飛行中的鉤爪。回傳 true 表示這一幀剛勾住。
   */
  updateFlight(dt, origin, travelSpeed, initialSlack, maxRange) {
    if (this.state !== 'flying') return false;
    this.anchor(this.target);
    _v.subVectors(this.target, this.head);
    const d = _v.length();
    const step = travelSpeed * dt;
    if (d <= step) {
      this.head.copy(this.target);
      const dist = origin.distanceTo(this.target);
      if (dist > maxRange * 1.25) {
        // 目標在飛行期間跑太遠（例如巨人移動）→ 失敗
        this.reset();
        return false;
      }
      this.state = 'attached';
      this.length = Math.max(1, dist * initialSlack);
      return true;
    }
    this.head.addScaledVector(_v, step / d);
    return false;
  }
}

/**
 * 鋼索瞄準：從攝影機沿準星方向（加左右偏角）射線檢測，命中可勾表面才有效。
 * 打空時在錐形範圍內做輔助瞄準，取最接近中心的有效點。
 */
export class HookAimer {
  constructor(hookables) {
    this.hookables = hookables;
    this.ray = new Raycaster();
    this._dir = new Vector3();
    this._axis = new Vector3();
    this._hits = [];
  }

  /**
   * @param {import('three').Camera} camera
   * @param {Vector3} playerPos
   * @param {number} offsetDeg 正值偏左
   * @param {number} assistDeg
   * @param {number} range
   * @returns {{point:Vector3, object:any, assisted:boolean}|null}
   */
  aim(camera, forward, playerPos, offsetDeg, assistDeg, range) {
    const camPos = camera.position;
    const base = this._dir.copy(forward);
    if (offsetDeg) {
      _q.setFromAxisAngle(_up, (offsetDeg * Math.PI) / 180);
      base.applyQuaternion(_q).normalize();
    }
    const skip = Math.max(0, camPos.distanceTo(playerPos) - 1.5);
    const direct = this._cast(camPos, base, playerPos, skip, range);
    if (direct) return { ...direct, assisted: false };
    if (!assistDeg) return null;

    // 輔助瞄準：兩圈各 8 個方向
    this._axis.crossVectors(base, _up);
    if (this._axis.lengthSq() < 1e-6) this._axis.set(1, 0, 0);
    this._axis.normalize();
    let best = null;
    const rings = [assistDeg * 0.5, assistDeg];
    const d = new Vector3();
    for (const ang of rings) {
      for (let k = 0; k < 8; k++) {
        const rollAngle = (k / 8) * Math.PI * 2;
        _q.setFromAxisAngle(this._axis, (ang * Math.PI) / 180);
        d.copy(base).applyQuaternion(_q);
        _q.setFromAxisAngle(base, rollAngle);
        d.applyQuaternion(_q).normalize();
        const hit = this._cast(camPos, d, playerPos, skip, range);
        if (hit) {
          best = hit;
          break;
        }
      }
      if (best) break;
    }
    return best ? { ...best, assisted: true } : null;
  }

  _cast(origin, dir, playerPos, near, range) {
    this.ray.set(origin, dir);
    this.ray.near = near;
    this.ray.far = near + range + 12;
    this._hits.length = 0;
    this.ray.intersectObjects(this.hookables, true, this._hits);
    for (const h of this._hits) {
      if (h.object.userData.noHook) continue;
      if (h.point.distanceTo(playerPos) > range) return null;
      return { point: h.point.clone(), object: h.object };
    }
    return null;
  }
}
