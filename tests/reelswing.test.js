// 牽引擺盪（預設鋼索手感）：高度靠收繩、擺盪靠完整重力＋保留切線速度
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3, Object3D } from 'three';
import { CONFIG } from '../src/config.js';
import { PlayerController } from '../src/player/playerController.js';

const idle = () => ({ move: { x: 0, y: 0 }, boost: false, boostPressed: false, jump: false, jumpHeld: false, reel: 0, reelStrong: false });
const world = () => ({ colliders: [], wallRadius: 270, camYaw: 0, camForward: new Vector3(0, 0, -1) });

function anchorAt(x, y, z) {
  const o = new Object3D();
  o.updateMatrixWorld();
  return { point: new Vector3(x, y, z), object: o };
}

/** 從低處勾住高處的勾點，跑 seconds 秒；回傳軌跡 */
function run(style, seconds = 6) {
  const p = new PlayerController(CONFIG);
  p.ropeStyle = style;
  p.speedScale = CONFIG.player.defaultSpeedScale;
  p.pos.set(0, 25, 40);
  const A = new Vector3(0, 60, 0);
  p.fireHook('right', p.pos.clone(), anchorAt(A.x, A.y, A.z));
  const path = [];
  let prev = p.pos.clone();
  for (let i = 0; i < seconds * 60; i++) {
    p.update(1 / 60, idle(), world());
    assert.ok(p.pos.distanceTo(prev) <= p.speed / 60 + 0.4, 'no teleport');
    prev = p.pos.clone();
    path.push({ pos: p.pos.clone(), vel: p.vel.clone(), len: p.hooks.right.length });
  }
  return { p, path, A };
}

test('reel-swing is the default rope style', () => {
  assert.equal(CONFIG.hook.style, 'reelswing');
  assert.equal(new PlayerController(CONFIG).ropeStyle, 'reelswing');
});

test('reel-swing: climbs toward a high anchor by reeling in', () => {
  const { path } = run('reelswing');
  const maxY = Math.max(...path.map((s) => s.pos.y));
  assert.ok(maxY > 45, `reached ${maxY.toFixed(1)}m (anchor 60m, start 25m)`);
});

test('reel-swing: swings back and forth on the way up (pull does not)', () => {
  const swings = (path) => {
    let n = 0;
    for (let i = 1; i < path.length; i++) if (Math.sign(path[i].vel.z) !== Math.sign(path[i - 1].vel.z) && Math.abs(path[i].vel.z) < 8) n++;
    return n;
  };
  // 偏離「起點 → 勾點」直線的最大距離：擺盪會畫出弧線，拉索幾乎是直線
  const deviation = (path, A) => {
    const s = path[0].pos;
    const d = new Vector3().subVectors(A, s).normalize();
    return Math.max(...path.map((x) => new Vector3().subVectors(x.pos, s).cross(d).length()));
  };
  const rs = run('reelswing');
  const pl = run('pull');
  assert.ok(swings(rs.path) >= 1, `reel-swing changed direction ${swings(rs.path)} times`);
  assert.ok(deviation(rs.path, rs.A) > deviation(pl.path, pl.A) + 5, `arc ${deviation(rs.path, rs.A).toFixed(1)}m vs pull ${deviation(pl.path, pl.A).toFixed(1)}m`);
});

test('reel-swing: reeling in speeds up the swing (angular momentum), it does not shrink it', () => {
  // 同樣的起點，關掉自動收繩只剩鐘擺 vs 牽引擺盪：收繩那一組最低點的速度要更快
  const bottomSpeed = (autoReel) => {
    const p = new PlayerController(CONFIG);
    p.ropeStyle = 'reelswing';
    p.autoReel = autoReel;
    p.pos.set(0, 25, 40);
    p.fireHook('right', p.pos.clone(), anchorAt(0, 60, 0));
    let best = 0;
    for (let i = 0; i < 150; i++) {
      p.update(1 / 60, idle(), world());
      if (Math.abs(p.pos.z) < 3) best = Math.max(best, Math.hypot(p.vel.x, p.vel.z));
    }
    return best;
  };
  const still = bottomSpeed(0);
  const reeled = bottomSpeed(CONFIG.hook.pull.autoReel);
  assert.ok(reeled > still * 1.1, `bottom speed reeled ${reeled.toFixed(1)} vs pendulum ${still.toFixed(1)} m/s`);
});

test('reel-swing: still settles at the orbit radius (hover / circling still work)', () => {
  const { p } = run('reelswing', 10);
  const R = CONFIG.hook.pull.orbitRadius;
  assert.ok(Math.abs(p.hooks.right.length - R) < 1, `rope ${p.hooks.right.length.toFixed(1)}m vs orbit ${R}m`);
});
