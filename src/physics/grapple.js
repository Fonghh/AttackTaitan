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
    this.attachTime = 0; // 勾住了多久
    this.pullOn = true; // 拉索模式：是否正在拉
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
      this.attachTime = 0;
      this.pullOn = true;
      this.length = Math.max(1, dist * initialSlack);
      return true;
    }
    this.head.addScaledVector(_v, step / d);
    return false;
  }
}

/**
 * 鋼索瞄準：從攝影機沿準星方向射線檢測，命中可勾表面才有效。
 * 擺盪輔助：準星打中的點如果不夠高（或打空），在準星附近扇形搜尋，
 * 選「離準星近、又比角色高」的勾點 → 勾住後能往下盪、再往上甩。
 */
export class HookAimer {
  constructor(hookables) {
    this.hookables = hookables;
    this.ray = new Raycaster();
    this._base = new Vector3();
    this._dir = new Vector3();
    this._right = new Vector3();
    this._hits = [];
  }

  /**
   * @param {import('three').Camera} camera
   * @param {Vector3} forward 準星方向（單位向量）
   * @param {Vector3} playerPos
   * @param {number} centerYawDeg 搜尋中心相對準星的水平偏角（正值偏左）
   * @param {number} range
   * @param {object} sa 擺盪輔助參數（config.hook.swingAim）
   * @returns {{point:Vector3, object:any, assisted:boolean}|null}
   */
  aim(camera, forward, playerPos, centerYawDeg, range, sa) {
    const camPos = camera.position;
    const base = this._base.copy(forward);
    if (centerYawDeg) {
      _q.setFromAxisAngle(_up, (centerYawDeg * Math.PI) / 180);
      base.applyQuaternion(_q).normalize();
    }
    const near = Math.max(0, camPos.distanceTo(playerPos) - 1.5);
    const fx = base.x, fz = base.z;
    const fl = Math.hypot(fx, fz) || 1;
    // 正對著自己的牆面：勾上去一定會在擺盪最低點撞牆，所以扣分
    const headOn = (hit) => {
      const n = hit.normal;
      if (!n || Math.abs(n.y) > 0.5) return false;
      const facing = -(n.x * fx + n.z * fz) / fl / Math.hypot(n.x, n.z);
      const hd = Math.hypot(hit.point.x - playerPos.x, hit.point.z - playerPos.z);
      return facing > sa.headOnDot && hd < sa.headOnDist;
    };
    // 擺盪最低點 = 勾點高度 - 繩長；太低會在半路擦地
    const clearancePenalty = (hit) => {
      const clear = hit.point.y - hit.point.distanceTo(playerPos);
      return clear < sa.minClearance ? Math.min(sa.groundPenalty, (sa.minClearance - clear) * 1.2) : 0;
    };
    const direct = this._cast(camPos, base, playerPos, near, range);
    if (direct && direct.point.y - playerPos.y >= sa.goodHeight && !headOn(direct) && !clearancePenalty(direct)) return { ...direct, assisted: false };

    const score = (hit, angle) => {
      const dy = hit.point.y - playerPos.y;
      return (
        angle -
        Math.min(Math.max(dy, 0), sa.maxHeightBonus) * sa.heightWeight +
        (dy < 2 ? sa.lowPenalty : 0) +
        (headOn(hit) ? sa.headOnPenalty : 0) +
        clearancePenalty(hit)
      );
    };
    let best = direct ? { hit: direct, s: score(direct, 0), assisted: false } : null;

    this._right.crossVectors(base, _up);
    if (this._right.lengthSq() < 1e-6) this._right.set(1, 0, 0);
    this._right.normalize();
    for (const pitch of sa.pitchSteps) {
      for (const yaw of sa.yawSteps) {
        if (!pitch && !yaw) continue;
        const angle = Math.hypot(pitch, yaw);
        if (best && angle - sa.maxHeightBonus * sa.heightWeight >= best.s) continue; // 不可能更好
        const d = this._dir.copy(base);
        _q.setFromAxisAngle(this._right, (pitch * Math.PI) / 180);
        d.applyQuaternion(_q);
        _q.setFromAxisAngle(_up, (yaw * Math.PI) / 180);
        d.applyQuaternion(_q).normalize();
        const hit = this._cast(camPos, d, playerPos, near, range);
        if (!hit) continue;
        const s = score(hit, angle);
        if (!best || s < best.s) best = { hit, s, assisted: true };
      }
    }
    return best ? { ...best.hit, assisted: best.assisted } : null;
  }

  /**
   * 準星直指：打中哪裡就勾哪裡；沒打中時在 assistDeg 內找最接近準星的勾點。
   */
  aimDirect(camera, forward, playerPos, range, assistDeg) {
    const camPos = camera.position;
    const near = Math.max(0, camPos.distanceTo(playerPos) - 1.5);
    const direct = this._cast(camPos, forward, playerPos, near, range);
    if (direct) return { ...direct, assisted: false };
    this._right.crossVectors(forward, _up);
    if (this._right.lengthSq() < 1e-6) this._right.set(1, 0, 0);
    this._right.normalize();
    for (const ang of [assistDeg * 0.5, assistDeg]) {
      for (let k = 0; k < 8; k++) {
        const d = this._dir.copy(forward);
        _q.setFromAxisAngle(this._right, (ang * Math.PI) / 180);
        d.applyQuaternion(_q);
        _q.setFromAxisAngle(forward, (k / 8) * Math.PI * 2);
        d.applyQuaternion(_q).normalize();
        const hit = this._cast(camPos, d, playerPos, near, range);
        if (hit) return { ...hit, assisted: true };
      }
    }
    return null;
  }

  /**
   * 準心吸附：準心附近（螢幕距離 radiusPx 內）有建築的轉角／屋頂邊緣時，吸到那一點。
   * 只採用鏡頭看得到的點（射線第一個打到的就是那棟建築、且就在該點附近）。
   * @param {{x:number,y:number}} reticle 準心 NDC
   * @param {{pos:Vector3, object:any}[]} anchors 可吸附點
   */
  snapAim(camera, reticle, playerPos, range, anchors, radiusPx, viewW, viewH) {
    const rx = (reticle.x * 0.5 + 0.5) * viewW;
    const ry = (-reticle.y * 0.5 + 0.5) * viewH;
    const cands = [];
    const p = this._dir;
    for (const a of anchors) {
      if (a.pos.distanceToSquared(playerPos) > range * range) continue;
      p.copy(a.pos).project(camera);
      if (p.z > 1 || p.z < -1) continue;
      const sx = (p.x * 0.5 + 0.5) * viewW;
      const sy = (-p.y * 0.5 + 0.5) * viewH;
      const d = Math.hypot(sx - rx, sy - ry);
      if (d < radiusPx) cands.push({ a, d });
    }
    cands.sort((u, v) => u.d - v.d);
    const camPos = camera.position;
    for (let i = 0; i < Math.min(4, cands.length); i++) {
      const { a } = cands[i];
      const dir = this._base.subVectors(a.pos, camPos);
      const dist = dir.length();
      dir.multiplyScalar(1 / dist);
      this.ray.set(camPos, dir);
      this.ray.near = 0;
      this.ray.far = dist + 2;
      this._hits.length = 0;
      this.ray.intersectObjects(this.hookables, true, this._hits);
      const h = this._hits.find((x) => !x.object.userData.noHook);
      if (h && h.object === a.object && h.distance > dist - 1.5 && h.point.distanceTo(playerPos) <= range) {
        return { point: h.point.clone(), object: h.object, assisted: true, snapped: true };
      }
    }
    return null;
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
      const normal = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : null;
      return { point: h.point.clone(), object: h.object, normal };
    }
    return null;
  }
}
