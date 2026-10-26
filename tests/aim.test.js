import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { aimCurve, detectFlick } from '../src/input/aimCurve.js';

const R = CONFIG.reticle;

test('dead zone: tiny finger movement does not move the crosshair', () => {
  const a = aimCurve(5, 0, R);
  assert.equal(a.aimX, 0);
  assert.equal(a.turnX, 0);
});

test('slow zone: 45px only moves the crosshair ~30% for fine aiming', () => {
  const a = aimCurve(45, 0, R);
  assert.ok(Math.abs(a.aimX - R.slowFrac) < 1e-9, `aimX ${a.aimX}`);
  const half = aimCurve(26.5, 0, R).aimX;
  assert.ok(half < 0.12, `halfway through the slow zone is still slow: ${half.toFixed(3)}`);
  assert.equal(a.turnX, 0);
});

test('fast zone: 75px reaches the screen edge, no camera turn yet', () => {
  const a = aimCurve(75, 0, R);
  assert.ok(Math.abs(a.aimX - 1) < 1e-9);
  assert.equal(a.turnX, 0);
  const mid = aimCurve(60, 0, R).aimX;
  assert.ok(mid > 0.6 && mid < 0.7, `mid fast zone ${mid.toFixed(2)}`);
});

test('beyond the edge the camera turns, faster the further you push', () => {
  const a = aimCurve(90, 0, R);
  const b = aimCurve(110, 0, R);
  assert.ok(a.turnX > 0 && a.turnX < b.turnX, `${a.turnX} < ${b.turnX}`);
  assert.equal(b.turnX, 1);
  const left = aimCurve(-110, 0, R);
  assert.equal(left.turnX, -1);
});

test('upward drag moves the crosshair up (positive aimY)', () => {
  const a = aimCurve(0, -60, R);
  assert.ok(a.aimY > 0.5);
});

test('finger at the screen edge counts as fully pushed', () => {
  const a = aimCurve(30, 0, R, 1, { x: 1, y: 0 });
  assert.equal(a.turnX, 1);
  assert.equal(a.aimX, 1);
});

test('sensitivity 200% reaches the edge with half the finger distance', () => {
  const a = aimCurve(37.5, 0, R, 2);
  assert.ok(Math.abs(a.aimX - 1) < 1e-9);
});

test('flick: fast horizontal swipe turns, slow or vertical swipes do not', () => {
  const F = R.flick;
  assert.equal(detectFlick(70, 10, 120, F), 1);
  assert.equal(detectFlick(-70, 5, 120, F), -1);
  assert.equal(detectFlick(70, 10, 300, F), 0, 'too slow');
  assert.equal(detectFlick(30, 0, 100, F), 0, 'too short');
  assert.equal(detectFlick(60, 50, 100, F), 0, 'too vertical');
});

import { gyroToLook } from '../src/input/gyro.js';

test('gyro: portrait phone — turning left/right is yaw, tilting is pitch', () => {
  const left = gyroToLook({ alpha: 0, beta: 0, gamma: 90 }, 0);
  assert.ok(Math.abs(left.yaw - Math.PI / 2) < 1e-9 && Math.abs(left.pitch) < 1e-9, JSON.stringify(left));
  const up = gyroToLook({ alpha: 0, beta: 45, gamma: 0 }, 0);
  assert.ok(Math.abs(up.pitch - Math.PI / 4) < 1e-9 && Math.abs(up.yaw) < 1e-9, JSON.stringify(up));
  // 螢幕轉 90° 時換軸
  const land = gyroToLook({ alpha: 0, beta: 90, gamma: 0 }, 90);
  assert.ok(Math.abs(Math.abs(land.yaw) - Math.PI / 2) < 1e-9 && Math.abs(land.pitch) < 1e-9, JSON.stringify(land));
});
