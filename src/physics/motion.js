// 簡化的角色物理：球體 vs 方塊碰撞、鋼索長度約束、城牆邊界。
// 全部是純函式，只依賴 three 的 Vector3，可直接在 Node 測試。
import { Vector3 } from 'three';

const _n = new Vector3();

/**
 * 球體與 AABB 碰撞，把球推出並移除撞向表面的速度分量。
 * @param {Vector3} pos 球心（會被修改）
 * @param {Vector3} vel 速度（會被修改）
 * @param {number} r 半徑
 * @param {{min:Vector3,max:Vector3}} box
 * @returns {Vector3|null} 接觸法線（共用暫存向量，需立即使用）
 */
export function collideSphereAABB(pos, vel, r, box) {
  const { min, max } = box;
  if (pos.x < min.x - r || pos.x > max.x + r || pos.y < min.y - r || pos.y > max.y + r || pos.z < min.z - r || pos.z > max.z + r) {
    return null;
  }
  const cx = Math.max(min.x, Math.min(pos.x, max.x));
  const cy = Math.max(min.y, Math.min(pos.y, max.y));
  const cz = Math.max(min.z, Math.min(pos.z, max.z));
  let dx = pos.x - cx;
  let dy = pos.y - cy;
  let dz = pos.z - cz;
  const d2 = dx * dx + dy * dy + dz * dz;
  if (d2 >= r * r) return null;

  let pen;
  if (d2 > 1e-10) {
    const d = Math.sqrt(d2);
    _n.set(dx / d, dy / d, dz / d);
    pen = r - d;
  } else {
    // 球心已在方塊內：沿穿透最淺的軸推出
    const px1 = pos.x - min.x, px2 = max.x - pos.x;
    const py1 = pos.y - min.y, py2 = max.y - pos.y;
    const pz1 = pos.z - min.z, pz2 = max.z - pos.z;
    const m = Math.min(px1, px2, py1, py2, pz1, pz2);
    if (m === py2) _n.set(0, 1, 0);
    else if (m === py1) _n.set(0, -1, 0);
    else if (m === px1) _n.set(-1, 0, 0);
    else if (m === px2) _n.set(1, 0, 0);
    else if (m === pz1) _n.set(0, 0, -1);
    else _n.set(0, 0, 1);
    pen = m + r;
  }
  pos.addScaledVector(_n, pen);
  const vn = vel.dot(_n);
  if (vn < 0) vel.addScaledVector(_n, -vn);
  return _n;
}

/** 球體 vs 球體（巨人身體），把玩家推出。回傳是否接觸。 */
export function collideSphereSphere(pos, vel, r, center, cr) {
  _n.subVectors(pos, center);
  const d2 = _n.lengthSq();
  const rr = r + cr;
  if (d2 >= rr * rr) return false;
  const d = Math.sqrt(d2) || 1e-5;
  _n.multiplyScalar(1 / d);
  pos.addScaledVector(_n, rr - d);
  const vn = vel.dot(_n);
  if (vn < 0) vel.addScaledVector(_n, -vn);
  return true;
}

/**
 * 解析所有世界碰撞（地面、建築、城牆）。
 * @returns {{grounded:boolean, hitWall:boolean}}
 */
export function resolveWorldCollisions(pos, vel, r, colliders, wallRadius) {
  let grounded = false;
  let hitWall = false;
  // 地面 y=0
  if (pos.y < r) {
    pos.y = r;
    if (vel.y < 0) vel.y = 0;
    grounded = true;
  }
  for (let i = 0; i < colliders.length; i++) {
    const n = collideSphereAABB(pos, vel, r, colliders[i]);
    if (n) {
      if (n.y > 0.65) grounded = true;
      else hitWall = true;
    }
  }
  // 城牆（圓柱內側）
  const h = Math.hypot(pos.x, pos.z);
  const lim = wallRadius - r;
  if (h > lim) {
    const nx = -pos.x / h, nz = -pos.z / h;
    pos.x = -nx * lim;
    pos.z = -nz * lim;
    const vn = vel.x * nx + vel.z * nz;
    if (vn < 0) {
      vel.x -= nx * vn;
      vel.z -= nz * vn;
    }
    hitWall = true;
  }
  return { grounded, hitWall };
}

/**
 * 鋼索長度約束：距離超過繩長時把位置投影回球面，並移除向外的徑向速度。
 * 保留切向速度 → 形成擺盪。
 * @returns {boolean} 是否處於繃緊狀態
 */
export function applyRopeConstraint(pos, vel, anchor, length) {
  _n.subVectors(pos, anchor);
  const dist = _n.length();
  if (dist <= length || dist < 1e-6) return false;
  _n.multiplyScalar(1 / dist);
  pos.copy(anchor).addScaledVector(_n, length);
  const vr = vel.dot(_n);
  if (vr > 0) vel.addScaledVector(_n, -vr);
  return true;
}

/** 依速度決定子步數，讓每一步位移不超過 maxStep（防止高速穿牆）。 */
export function substepCount(speed, dt, maxStep = 0.4) {
  return Math.min(16, Math.max(1, Math.ceil((speed * dt) / maxStep)));
}

/** 超過最高速度時平滑衰減，避免硬性截斷造成的頓挫。 */
export function softLimitSpeed(vel, maxSpeed, rate, dt) {
  const s = vel.length();
  if (s > maxSpeed) {
    const target = Math.max(maxSpeed, s - (s - maxSpeed) * Math.min(1, rate * dt) - 0.5);
    vel.multiplyScalar(Math.min(target, maxSpeed * 1.15) / s);
  }
}
