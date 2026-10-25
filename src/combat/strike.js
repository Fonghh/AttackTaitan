// 斬擊判定：距離、速度、攻擊方向與命中範圍。純函式，可在 Node 測試。
import { Vector3 } from 'three';

const _to = new Vector3();
const _vd = new Vector3();

/** 依速度計算弱點傷害 */
export function napeDamage(speed, cfg) {
  const s = cfg.strike;
  const dmg = s.baseDamage + Math.max(0, speed - s.minSpeed) * s.damagePerSpeed;
  return Math.round(Math.min(s.maxDamage, dmg));
}

/**
 * 評估目前能否成功斬擊弱點。
 * @param {{playerPos:Vector3, playerVel:Vector3, napePos:Vector3, titanForward:Vector3, speedScale?:number}} s
 *   speedScale：速度倍率，速度條件與傷害用換算後的體感速度
 */
export function evaluateStrike(s, cfg) {
  const C = cfg.strike;
  _to.subVectors(s.playerPos, s.napePos);
  const dist = _to.length();
  const speed = s.playerVel.length() / Math.max(0.25, s.speedScale || 1);
  const dirFromNape = dist > 1e-6 ? _to.multiplyScalar(1 / dist) : _to.set(0, 0, -1);
  // 玩家位於後頸哪一側：只看水平方向；從正上方落下也算有效
  const hx = dirFromNape.x, hz = dirFromNape.z;
  const hl = Math.hypot(hx, hz);
  const frontDot = hl < 0.35 ? -1 : (hx * s.titanForward.x + hz * s.titanForward.z) / hl;
  // 速度方向是否朝向弱點
  let approachDot = 1;
  const rawSpeed = s.playerVel.length();
  if (rawSpeed > 1e-3) {
    _vd.copy(s.playerVel).multiplyScalar(1 / rawSpeed);
    approachDot = -_vd.dot(dirFromNape);
  }
  const inRange = dist <= C.range;
  const fastEnough = speed >= C.minSpeed;
  const angleOk = frontDot <= C.maxFrontDot;
  const approachOk = approachDot >= C.minApproachDot;
  const ok = inRange && fastEnough && angleOk && approachOk;
  return {
    dist,
    speed,
    frontDot,
    approachDot,
    inRange,
    fastEnough,
    angleOk,
    approachOk,
    ok,
    damage: ok ? napeDamage(speed, cfg) : 0,
  };
}

/**
 * 是否可以發動衝刺斬（條件差一點時自動吸向弱點）。
 * @param {Vector3} aimDir 攝影機或速度方向（單位向量）
 */
export function canLunge(evalResult, toNape, aimDir, gas, cfg) {
  const C = cfg.strike;
  if (evalResult.ok) return false;
  if (evalResult.dist > C.lungeRange || gas < C.lungeGas) return false;
  if (!evalResult.angleOk) return false;
  const cos = toNape.dot(aimDir) / Math.max(1e-6, toNape.length());
  return cos >= Math.cos((C.lungeAngleDeg * Math.PI) / 180);
}
