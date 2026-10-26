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
