import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3, Object3D } from 'three';
import { CONFIG } from '../src/config.js';
import { applyRopeConstraint, collideSphereAABB, resolveWorldCollisions } from '../src/physics/motion.js';
import { PlayerController } from '../src/player/playerController.js';
import { evaluateStrike, napeDamage, canLunge } from '../src/combat/strike.js';

const idle = () => ({ move: { x: 0, y: 0 }, boost: false, boostPressed: false, jump: false, jumpHeld: false, reel: 0, reelStrong: false });
const world = (colliders = []) => ({ colliders, wallRadius: 270, camYaw: 0, camForward: new Vector3(0, 0, -1) });

function anchorAt(x, y, z) {
  const o = new Object3D();
  o.position.set(0, 0, 0);
  o.updateMatrixWorld();
  return { point: new Vector3(x, y, z), object: o };
}

test('rope constraint keeps distance <= length and removes outward speed', () => {
  const anchor = new Vector3(0, 10, 0);
  const pos = new Vector3(0, -2, 0);
  const vel = new Vector3(5, -10, 0);
  applyRopeConstraint(pos, vel, anchor, 10);
  assert.ok(Math.abs(pos.distanceTo(anchor) - 10) < 1e-6);
  assert.ok(vel.y >= -1e-9, 'outward (downward) radial velocity removed');
  assert.equal(vel.x, 5, 'tangential velocity kept');
});

test('sphere is pushed out of box and does not keep moving into it', () => {
  const box = { min: new Vector3(0, 0, 0), max: new Vector3(10, 10, 10) };
  const pos = new Vector3(-0.3, 5, 5);
  const vel = new Vector3(20, 0, 0);
  collideSphereAABB(pos, vel, 0.55, box);
  assert.ok(pos.x <= -0.55 + 1e-6);
  assert.equal(vel.x, 0);
});

test('high speed does not tunnel through a thin wall', () => {
  const p = new PlayerController(CONFIG);
  p.pos.set(0, 20, 0);
  p.vel.set(0, 0, -70);
  const wall = { min: new Vector3(-50, 0, -12), max: new Vector3(50, 60, -10) };
  for (let i = 0; i < 30; i++) p.update(1 / 60, idle(), world([wall]));
  assert.ok(p.pos.z > -10, `player stayed in front of wall, z=${p.pos.z}`);
});

test('swinging on a rope never exceeds rope length and gains horizontal speed', () => {
  const p = new PlayerController(CONFIG);
  p.ropeStyle = 'swing';
  p.pos.set(-20, 40, 0);
  p.vel.set(0, 0, 0);
  p.fireHook('right', p.pos.clone(), anchorAt(0, 60, 0));
  // 讓鉤爪飛到
  for (let i = 0; i < 10; i++) p.update(1 / 60, idle(), world());
  assert.ok(p.hooks.right.attached);
  const L0 = p.hooks.right.length;
  let maxHs = 0;
  for (let i = 0; i < 90; i++) {
    p.update(1 / 60, idle(), world());
    const d = p.pos.distanceTo(new Vector3(0, 60, 0));
    assert.ok(d <= p.hooks.right.length + 1e-3);
    maxHs = Math.max(maxHs, Math.hypot(p.vel.x, p.vel.z));
  }
  assert.ok(p.hooks.right.length <= L0);
  assert.ok(maxHs > 15, `swing should build speed, got ${maxHs}`);
});

test('releasing the rope keeps momentum, and upward release gets a bonus + hang', () => {
  const p = new PlayerController(CONFIG);
  p.ropeStyle = 'swing';
  p.pos.set(0, 40, 0);
  p.fireHook('left', p.pos.clone(), anchorAt(0, 60, -10));
  for (let i = 0; i < 10; i++) p.update(1 / 60, idle(), world());
  assert.ok(p.hooks.left.attached);
  p.vel.set(0, 12, -25);
  p.releaseHook('left');
  assert.ok(Math.abs(p.vel.y - 12 * 1.15) < 1e-6, 'upward bonus applied');
  assert.equal(p.vel.z, -25, 'horizontal speed preserved');
  let hung = false;
  for (let i = 0; i < 120; i++) {
    p.update(1 / 60, idle(), world());
    if (p.hangTimer > 0) hung = true;
  }
  assert.ok(hung, 'apex hang triggered');
});

test('landing fast starts a slide that decays over ~1-2 s', () => {
  const p = new PlayerController(CONFIG);
  p.pos.set(0, 1.5, 0);
  p.vel.set(30, -5, 0);
  let slid = false;
  let t = 0;
  while (t < 3) {
    p.update(1 / 60, idle(), world());
    t += 1 / 60;
    if (p.sliding) slid = true;
    if (slid && !p.sliding) break;
  }
  assert.ok(slid, 'slide started');
  assert.ok(t > 0.6 && t < 2.2, `slide duration ${t.toFixed(2)}s`);
});

test('reeling pulls the player toward the anchor smoothly (force, not snapping)', () => {
  const p = new PlayerController(CONFIG);
  p.pos.set(0, 30, 30);
  p.fireHook('left', p.pos.clone(), anchorAt(0, 30, 0));
  for (let i = 0; i < 10; i++) p.update(1 / 60, idle(), world());
  const d0 = p.pos.distanceTo(new Vector3(0, 30, 0));
  const it = { ...idle(), reel: 1, reelStrong: true };
  let prev = p.pos.clone();
  for (let i = 0; i < 60; i++) {
    p.update(1 / 60, it, world());
    const step = p.pos.distanceTo(prev);
    assert.ok(step <= p.speed / 60 + 0.4, `no teleport: moved ${step.toFixed(2)}m in one frame`);
    prev = p.pos.clone();
  }
  const d1 = p.pos.distanceTo(new Vector3(0, 30, 0));
  assert.ok(d1 < d0 - 10, `pulled from ${d0.toFixed(1)} to ${d1.toFixed(1)}`);
});

test('a rope much shorter than the distance does not teleport the player', () => {
  const p = new PlayerController(CONFIG);
  p.pos.set(0, 30, 40);
  p.fireHook('left', p.pos.clone(), anchorAt(0, 40, 0));
  for (let i = 0; i < 10; i++) p.update(1 / 60, idle(), world());
  p.hooks.left.length = 5; // 模擬繩子穿過建築轉角等極端情況
  const before = p.pos.clone();
  p.update(1 / 60, idle(), world());
  assert.ok(p.pos.distanceTo(before) < 2, `moved ${p.pos.distanceTo(before).toFixed(2)}m`);
});

test('boost while hooked accelerates along the swing, not into the wall', () => {
  const p = new PlayerController(CONFIG);
  p.ropeStyle = 'swing';
  p.pos.set(-20, 40, 0);
  p.fireHook('left', p.pos.clone(), anchorAt(0, 60, 0));
  for (let i = 0; i < 10; i++) p.update(1 / 60, idle(), world());
  p.vel.set(10, -5, 0);
  const w = { ...world(), camForward: new Vector3(0, 0, -1) };
  for (let i = 0; i < 30; i++) p.update(1 / 60, { ...idle(), boost: true }, w);
  assert.ok(Math.abs(p.vel.z) < 3, `boost followed the swing plane, vz=${p.vel.z.toFixed(2)}`);
  assert.ok(p.speed > 15);
});

test('world ground and wall collisions', () => {
  const pos = new Vector3(300, -1, 0);
  const vel = new Vector3(10, -5, 0);
  const r = resolveWorldCollisions(pos, vel, 0.55, [], 270);
  assert.ok(r.grounded);
  assert.ok(Math.hypot(pos.x, pos.z) <= 270);
});

test('strike: valid from behind at speed, invalid from front or when slow', () => {
  const nape = new Vector3(0, 18, 0);
  const fwd = new Vector3(0, 0, 1); // 巨人面向 +Z
  const behind = evaluateStrike({ playerPos: new Vector3(0, 19, -5), playerVel: new Vector3(0, 0, 30), napePos: nape, titanForward: fwd }, CONFIG);
  assert.ok(behind.ok);
  assert.equal(behind.damage, napeDamage(30, CONFIG));
  const front = evaluateStrike({ playerPos: new Vector3(0, 19, 5), playerVel: new Vector3(0, 0, -30), napePos: nape, titanForward: fwd }, CONFIG);
  assert.ok(!front.ok && !front.angleOk);
  const slow = evaluateStrike({ playerPos: new Vector3(0, 19, -5), playerVel: new Vector3(0, 0, 8), napePos: nape, titanForward: fwd }, CONFIG);
  assert.ok(!slow.ok && !slow.fastEnough);
  const far = evaluateStrike({ playerPos: new Vector3(0, 19, -15), playerVel: new Vector3(0, 0, 30), napePos: nape, titanForward: fwd }, CONFIG);
  assert.ok(!far.ok && !far.inRange);
  assert.ok(canLunge(far, new Vector3(0, -1, 15), new Vector3(0, 0, 1), 100, CONFIG));
});

test('damage scales with speed and caps', () => {
  assert.equal(napeDamage(20, CONFIG), 40);
  assert.ok(napeDamage(45, CONFIG) >= CONFIG.strike.perfectDamage);
  assert.equal(napeDamage(200, CONFIG), CONFIG.strike.maxDamage);
});

test('pull style: pulls toward the anchor, stops pulling on arrival but keeps the rope', () => {
  const p = new PlayerController(CONFIG);
  assert.equal(p.ropeStyle, 'pull');
  p.pos.set(0, 20, 50);
  p.fireHook('right', p.pos.clone(), anchorAt(0, 40, 0));
  let maxSpeed = 0;
  let arrived = false;
  let prev = p.pos.clone();
  for (let i = 0; i < 300; i++) {
    p.update(1 / 60, idle(), world());
    maxSpeed = Math.max(maxSpeed, p.speed);
    assert.ok(p.pos.distanceTo(prev) <= p.speed / 60 + 0.4, 'no teleport');
    prev = p.pos.clone();
    if (p.events.some((e) => e.type === 'arrive')) arrived = true;
    p.events.length = 0;
  }
  assert.ok(maxSpeed > 35 && maxSpeed < 75, `pull speed ${maxSpeed.toFixed(1)} m/s`);
  assert.ok(arrived, 'reached the anchor');
  assert.ok(p.hooks.right.attached, 'rope is NOT released automatically');
});

test('pull style: steering while hooked gives strong sideways control', () => {
  const p = new PlayerController(CONFIG);
  p.pos.set(0, 20, 60);
  p.fireHook('right', p.pos.clone(), anchorAt(0, 40, 0));
  for (let i = 0; i < 15; i++) p.update(1 / 60, idle(), world());
  for (let i = 0; i < 60; i++) p.update(1 / 60, { ...idle(), move: { x: 1, y: 0 } }, world());
  assert.ok(p.vel.x > 12, `strafed sideways at ${p.vel.x.toFixed(1)} m/s`);
});

test('pull style: releasing while rising launches the player upward', () => {
  const p = new PlayerController(CONFIG);
  p.pos.set(0, 20, 30);
  p.fireHook('left', p.pos.clone(), anchorAt(0, 60, 0));
  for (let i = 0; i < 40; i++) p.update(1 / 60, idle(), world());
  const vy = p.vel.y;
  assert.ok(vy > 5);
  p.releaseAll();
  const P = CONFIG.hook.pull;
  assert.ok(Math.abs(p.vel.y - (vy * (1 + P.launchBonus) + P.launchUp)) < 1e-6);
});

test('dash (fast reel): faster than the normal pull and flies up past the anchor without breaking the rope', () => {
  const run = (dash) => {
    const p = new PlayerController(CONFIG);
    p.speedScale = CONFIG.player.defaultSpeedScale; // 遊戲預設速度倍率（衝刺倍率獨立）
    p.pos.set(0, 20, 40);
    p.fireHook('right', p.pos.clone(), anchorAt(0, 50, 0));
    let maxSpeed = 0, maxY = 0, arrived = false;
    for (let i = 0; i < 240; i++) {
      p.update(1 / 60, { ...idle(), boost: dash, boostPressed: dash && i === 0 }, world());
      maxSpeed = Math.max(maxSpeed, p.speed);
      maxY = Math.max(maxY, p.pos.y);
      if (p.events.some((e) => e.type === 'dashArrive')) arrived = true;
      p.events.length = 0;
    }
    return { maxSpeed, maxY, arrived, attached: p.hooks.right.attached };
  };
  const normal = run(false);
  const dash = run(true);
  assert.ok(dash.maxSpeed > normal.maxSpeed + 5, `dash ${dash.maxSpeed.toFixed(1)} vs pull ${normal.maxSpeed.toFixed(1)} m/s`);
  assert.ok(dash.arrived, 'reached the anchor while dashing');
  assert.ok(dash.maxY > 50 + 10, `flew up past the anchor to ${dash.maxY.toFixed(1)}m (anchor 50m)`);
  assert.ok(dash.attached, 'rope is still attached (slack, not broken)');
});

test('dash keeps and amplifies sideways swing (not a straight pull)', () => {
  const p = new PlayerController(CONFIG);
  p.speedScale = CONFIG.player.defaultSpeedScale;
  p.pos.set(0, 20, 40);
  p.vel.set(12, 0, 0); // 帶著側向速度勾住
  p.fireHook('right', p.pos.clone(), anchorAt(0, 50, 0));
  let side = 0, maxTangential = 0;
  for (let i = 0; i < 90; i++) {
    p.update(1 / 60, { ...idle(), boost: true, boostPressed: i === 0 }, world());
    side = Math.max(side, Math.abs(p.pos.x));
    if (p.hooks.right.attached && !p.hooks.right.slack) {
      const toA = new Vector3(0, 50, 0).sub(p.pos).normalize();
      const t = p.vel.clone().addScaledVector(toA, -p.vel.dot(toA)).length();
      maxTangential = Math.max(maxTangential, t);
    }
  }
  assert.ok(side > 8, `swung ${side.toFixed(1)}m sideways`);
  assert.ok(maxTangential > 20, `tangential swing speed grew to ${maxTangential.toFixed(1)} m/s`);
});

test('dash builds up like nitro: speed rises gradually instead of jumping at once', () => {
  const p = new PlayerController(CONFIG);
  p.speedScale = CONFIG.player.defaultSpeedScale;
  p.pos.set(0, 45, 82); // 勾點很遠，衝刺途中不會先抵達
  p.fireHook('right', p.pos.clone(), anchorAt(0, 50, 0));
  for (let i = 0; i < 12; i++) p.update(1 / 60, idle(), world());
  const base = p.speed;
  const speeds = [];
  for (let i = 0; i < 90; i++) {
    p.update(1 / 60, { ...idle(), boost: true, boostPressed: i === 0 }, world());
    speeds.push(p.speed);
  }
  const early = speeds[14] - base; // 0.25 秒
  const late = speeds[89] - base; // 1.5 秒
  assert.ok(early < 10, `first 0.25 s adds only ${early.toFixed(1)} m/s`);
  assert.ok(late > early + 8, `keeps stacking speed: +${late.toFixed(1)} m/s after 1.5 s`);
  assert.ok(p.dashRamp > 0.95, 'reached full nitro');
});

test('releasing dash keeps the momentum (cap eases down instead of snapping)', () => {
  const p = new PlayerController(CONFIG);
  p.speedScale = CONFIG.player.defaultSpeedScale;
  p.pos.set(0, 45, 82);
  p.fireHook('right', p.pos.clone(), anchorAt(0, 50, 0));
  for (let i = 0; i < 12; i++) p.update(1 / 60, idle(), world());
  for (let i = 0; i < 90; i++) p.update(1 / 60, { ...idle(), boost: true, boostPressed: i === 0 }, world());
  const atRelease = p.speed;
  p.releaseAll();
  for (let i = 0; i < 15; i++) p.update(1 / 60, idle(), world());
  assert.ok(p.speed > atRelease * 0.85, `0.25 s after release: ${p.speed.toFixed(1)} of ${atRelease.toFixed(1)} m/s`);
  assert.ok(p.dashGlow > 0.5, 'speed feel fades out slowly');
});

test('ground dash: low slide along the stick direction, no jump', () => {
  const p = new PlayerController(CONFIG);
  p.speedScale = CONFIG.player.defaultSpeedScale;
  p.pos.set(0, CONFIG.player.radius, 0);
  for (let i = 0; i < 10; i++) p.update(1 / 60, idle(), world());
  const z0 = p.pos.z;
  let maxY = 0;
  const sp = [];
  for (let i = 0; i < 90; i++) {
    p.update(1 / 60, { ...idle(), move: { x: 0, y: 1 }, boost: true, boostPressed: i === 0 }, world());
    maxY = Math.max(maxY, p.pos.y);
    sp.push(p.speed);
  }
  assert.ok(z0 - p.pos.z > 15, `slid ${(z0 - p.pos.z).toFixed(1)}m forward`);
  assert.ok(maxY < 1.5, `stayed low (max y ${maxY.toFixed(2)})`);
  assert.ok(sp[10] < 16 && sp[89] > sp[10] + 8, `nitro build-up on the ground: ${sp[10].toFixed(1)} → ${sp[89].toFixed(1)} m/s`);
  // 放開：照一般滑行慢慢減速，不會瞬間停
  const atRelease = p.speed;
  for (let i = 0; i < 15; i++) p.update(1 / 60, idle(), world());
  assert.ok(p.speed > atRelease * 0.6, `0.25 s after release still ${p.speed.toFixed(1)} m/s`);
});

test('Levi slash: brief hover, then spins straight along the rope to the anchor', () => {
  const p = new PlayerController(CONFIG);
  p.speedScale = CONFIG.player.defaultSpeedScale;
  p.pos.set(0, 20, 50);
  p.vel.set(15, -5, 0);
  p.fireHook('right', p.pos.clone(), anchorAt(0, 40, 0));
  for (let i = 0; i < 20; i++) p.update(1 / 60, idle(), world());
  assert.ok(p.hooks.right.attached);
  assert.ok(p.startLevi('right'));
  for (let i = 0; i < 12; i++) p.update(1 / 60, idle(), world());
  assert.equal(p.levi.phase, 'windup');
  assert.ok(p.speed < 8, `hover during wind-up (${p.speed.toFixed(1)} m/s)`);
  let frames = 0;
  while (p.levi && !p.levi.done && frames < 200) {
    p.update(1 / 60, idle(), world());
    frames++;
  }
  assert.ok(p.levi && p.levi.done, 'arrived');
  assert.ok(p.pos.distanceTo(new Vector3(0, 40, 0)) < CONFIG.strike.leviHitDist + 2, `ends next to the anchor (${p.pos.distanceTo(new Vector3(0, 40, 0)).toFixed(1)}m)`);
  assert.ok(frames < 90, `fast dash (${frames} frames)`);
});

// 自動收繩：鏡頭朝向勾點（像瞄著目標時）
const facing = (p, a) => {
  const d = a.clone().sub(p.pos).setY(0).normalize();
  return { ...world(), camYaw: Math.atan2(-d.x, -d.z), camForward: d };
};
const reelRun = (move, object) => {
  const p = new PlayerController(CONFIG);
  p.speedScale = CONFIG.player.defaultSpeedScale;
  p.pos.set(0, 30, 50);
  const A = new Vector3(0, 40, 0);
  const aim = anchorAt(0, 40, 0);
  if (object) aim.object = object;
  p.fireHook('right', p.pos.clone(), aim);
  for (let i = 0; i < 360; i++) p.update(1 / 60, { ...idle(), move }, facing(p, A));
  return p;
};

test('auto-reel: rope shortens to the orbit radius with the stick neutral or pushed sideways', () => {
  const R = CONFIG.hook.pull.orbitRadius;
  const n = reelRun({ x: 0, y: 0 });
  assert.ok(Math.abs(n.hooks.right.length - R) < 0.5, `neutral → ${n.hooks.right.length.toFixed(1)}m`);
  const s = reelRun({ x: 1, y: 0 });
  assert.ok(s.hooks.right.length < R + 1, `sideways spirals in → ${s.hooks.right.length.toFixed(1)}m`);
});

test('auto-reel: pushing away from the anchor holds the distance', () => {
  const p = reelRun({ x: 0, y: -1 });
  assert.ok(p.hooks.right.length > 45, `held at ${p.hooks.right.length.toFixed(1)}m`);
});

test('auto-reel: hooked on a titan orbits at a wider radius (× factor × titan size)', () => {
  const o = new Object3D();
  o.updateMatrixWorld();
  o.userData.titan = { scale: 1.4 };
  const p = reelRun({ x: 0, y: 0 }, o);
  const want = CONFIG.hook.pull.orbitRadius * CONFIG.hook.pull.orbitTitanFactor * 1.4;
  assert.ok(Math.abs(p.hooks.right.length - want) < 1.2, `${p.hooks.right.length.toFixed(1)}m vs ${want.toFixed(1)}m`);
});

test('after a dash the slack rope takes up as you fall back (no huge swing radius)', () => {
  const p = new PlayerController(CONFIG);
  p.speedScale = CONFIG.player.defaultSpeedScale;
  p.pos.set(0, 30, 70);
  p.vel.set(8, 0, 0);
  const A = new Vector3(0, 45, 0);
  p.fireHook('right', p.pos.clone(), anchorAt(0, 45, 0));
  let arrived = false, maxExcess = 0, peak = 0;
  for (let i = 0; i < 360; i++) {
    const b = i >= 10 && i < 190;
    p.update(1 / 60, { ...idle(), boost: b, boostPressed: i === 10 }, world());
    const justArrived = p.events.some((e) => e.type === 'dashArrive');
    if (justArrived) arrived = true;
    p.events.length = 0;
    const h = p.hooks.right;
    const dA = p.pos.distanceTo(A);
    if (arrived) peak = Math.max(peak, dA);
    // 飛過最遠點、開始往下掉、往勾點回來時：繩子最多只比距離長 slackTakeUp
    if (arrived && !justArrived && h.attached && p.vel.y < 0 && dA < peak - 3 && p.vel.dot(p.pos.clone().sub(A)) < 0) maxExcess = Math.max(maxExcess, h.length - dA);
  }
  assert.ok(arrived, 'dash reached the anchor');
  assert.ok(maxExcess <= CONFIG.dash.slackTakeUp + 0.5, `falling back: rope at most ${maxExcess.toFixed(1)}m longer than the distance`);
  assert.ok(p.hooks.right.length < 25, `final rope ${p.hooks.right.length.toFixed(1)}m (was ~59m before)`);
});

test('flip dash: double-tap dash in the air bursts, then keeps its momentum', () => {
  const p = new PlayerController(CONFIG);
  p.speedScale = CONFIG.player.defaultSpeedScale;
  p.pos.set(0, 40, 0);
  const start = p.pos.clone();
  const press = (i) => ({ ...idle(), move: { x: 1, y: 0 }, boost: i === 0 || i === 6, boostPressed: i === 0 || i === 6 });
  let flipped = false, maxSpeed = 0, tuckSpeed = 99;
  for (let i = 0; i < 100; i++) {
    if (p.flip?.phase === 'tuck' && p.flip.t < p.flip.tuck * 0.4) tuckSpeed = Math.min(tuckSpeed, p.speed);
    p.update(1 / 60, press(i), world());
    if (p.flip) flipped = true;
    maxSpeed = Math.max(maxSpeed, p.speed);
    p.events.length = 0;
  }
  const dist = Math.hypot(p.pos.x - start.x, p.pos.z - start.z);
  assert.ok(flipped, 'second tap within the window starts the flip');
  assert.ok(tuckSpeed < 6, `tuck: nearly stops in the air before the burst (${tuckSpeed.toFixed(1)} m/s)`);
  assert.ok(dist > 28, `burst ${dist.toFixed(1)}m sideways`);
  assert.ok(p.speed > maxSpeed * 0.8, `keeps momentum after the burst (${p.speed.toFixed(1)} of ${maxSpeed.toFixed(1)} m/s)`);
  // 一次單按不會翻轉
  const q = new PlayerController(CONFIG);
  q.pos.set(0, 40, 0);
  for (let i = 0; i < 20; i++) q.update(1 / 60, { ...idle(), boost: i === 0, boostPressed: i === 0 }, world());
  assert.ok(!q.flip && q.flipCool <= 0, 'single tap does not flip');
});

test('hooked + stick forward: reel straight along the rope to a high anchor, independent of the camera, no overshoot', () => {
  const run = (move, camYaw) => {
    const p = new PlayerController(CONFIG);
    p.speedScale = CONFIG.player.defaultSpeedScale;
    p.pos.set(0, 8, 60);
    const A = new Vector3(0, 48, 0); // 像遠處巨人的頭
    p.fireHook('right', p.pos.clone(), anchorAt(0, 48, 0));
    const w = { ...world(), camYaw, camForward: new Vector3(-Math.sin(camYaw), 0, -Math.cos(camYaw)) };
    let minD = 1e9, maxY = 0, maxX = 0;
    for (let i = 0; i < 40 && !p.hooks.right.attached; i++) p.update(1 / 60, idle(), w); // 等鉤爪勾住
    assert.ok(p.hooks.right.attached);
    for (let i = 0; i < 300; i++) {
      p.update(1 / 60, { ...idle(), move }, w);
      minD = Math.min(minD, p.pos.distanceTo(A));
      maxY = Math.max(maxY, p.pos.y);
      maxX = Math.max(maxX, Math.abs(p.pos.x));
    }
    return { minD, maxY, maxX };
  };
  const fwd = run({ x: 0, y: 1 }, Math.PI / 2); // 鏡頭朝側面，往前推仍然沿繩子
  assert.ok(fwd.minD < 9, `forward reached ${fwd.minD.toFixed(1)}m from the anchor`);
  assert.ok(fwd.maxX < 3, `went straight along the rope (sideways drift ${fwd.maxX.toFixed(1)}m)`);
  assert.ok(fwd.maxY < 48 + 6, `no big overshoot above the anchor (peak ${fwd.maxY.toFixed(1)}m)`);
});

test('hooked + stick sideways: circles around the anchor (perpendicular to the rope)', () => {
  const p = new PlayerController(CONFIG);
  p.speedScale = CONFIG.player.defaultSpeedScale;
  p.pos.set(0, 30, 40);
  const A = new Vector3(0, 40, 0);
  p.fireHook('right', p.pos.clone(), anchorAt(0, 40, 0));
  for (let i = 0; i < 20; i++) p.update(1 / 60, idle(), facing(p, A));
  const d0 = p.pos.distanceTo(A);
  let swept = 0, prev = Math.atan2(p.pos.x, p.pos.z);
  for (let i = 0; i < 120; i++) {
    p.update(1 / 60, { ...idle(), move: { x: 1, y: 0 } }, facing(p, A));
    const a = Math.atan2(p.pos.x, p.pos.z);
    swept += Math.atan2(Math.sin(a - prev), Math.cos(a - prev));
    prev = a;
  }
  assert.ok(Math.abs(swept) > 1.0, `orbited ${((Math.abs(swept) * 180) / Math.PI).toFixed(0)}° around the anchor`);
  assert.ok(p.pos.distanceTo(A) < d0, 'and spiralled inward (auto-reel)');
});

test('double-tap dash while hooked: flips along the rope when the stick is centered (not toward the camera)', () => {
  const p = new PlayerController(CONFIG);
  p.speedScale = CONFIG.player.defaultSpeedScale;
  p.pos.set(0, 10, 3);
  p.fireHook('right', p.pos.clone(), anchorAt(0, 45, 0));
  for (let i = 0; i < 40 && !p.hooks.right.attached; i++) p.update(1 / 60, idle(), world());
  let flipped = false, maxHoriz = 0;
  for (let i = 0; i < 60; i++) {
    const tap = i === 0 || i === 6;
    p.update(1 / 60, { ...idle(), boost: true, boostPressed: tap }, world());
    if (p.flip) flipped = true;
    maxHoriz = Math.max(maxHoriz, Math.hypot(p.pos.x, p.pos.z - 3));
  }
  assert.ok(flipped, 'flip happens while hooked');
  assert.ok(p.pos.y > 25, `went up along the rope (y ${p.pos.y.toFixed(1)})`);
  assert.ok(maxHoriz < 8, `no horizontal burst (${maxHoriz.toFixed(1)}m)`);
});

test('double-tap dash while hooked + stick sideways: flips around the anchor (perpendicular to the rope)', () => {
  const p = new PlayerController(CONFIG);
  p.speedScale = CONFIG.player.defaultSpeedScale;
  p.pos.set(0, 30, 30);
  const A = new Vector3(0, 40, 0);
  p.fireHook('right', p.pos.clone(), anchorAt(0, 40, 0));
  for (let i = 0; i < 40 && !p.hooks.right.attached; i++) p.update(1 / 60, idle(), facing(p, A));
  let dir = null;
  for (let i = 0; i < 12; i++) {
    const tap = i === 0 || i === 6;
    p.update(1 / 60, { ...idle(), move: { x: 1, y: 0 }, boost: tap, boostPressed: tap }, facing(p, A));
    if (p.flip && !dir) dir = p.flip.dir.clone();
  }
  assert.ok(dir, 'flipped');
  const toA = A.clone().sub(p.pos).normalize();
  assert.ok(Math.abs(dir.dot(toA)) < 0.4, `sideways relative to the rope (dot ${dir.dot(toA).toFixed(2)})`);
});

test('flip along the rope: tuck, burst to the hook point, auto-detach and keep flying up past it', () => {
  const p = new PlayerController(CONFIG);
  p.speedScale = CONFIG.player.defaultSpeedScale;
  p.pos.set(0, 10, 3);
  p.fireHook('right', p.pos.clone(), anchorAt(0, 45, 0));
  for (let i = 0; i < 40 && !p.hooks.right.attached; i++) p.update(1 / 60, idle(), world());
  let detached = false, maxY = 0;
  for (let i = 0; i < 220; i++) {
    const tap = i === 0 || i === 6;
    p.update(1 / 60, { ...idle(), boost: tap, boostPressed: tap }, world());
    if (p.events.some((e) => e.type === 'flipDetach')) detached = true;
    p.events.length = 0;
    maxY = Math.max(maxY, p.pos.y);
  }
  assert.ok(detached, 'rope auto-released at the hook point');
  assert.ok(!p.hooks.right.active, 'no rope left');
  assert.ok(maxY > 45 + 10, `flew on past the hook point (peak ${maxY.toFixed(1)}m, hook at 45m)`);
});
