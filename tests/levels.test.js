import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS, getLevel, nextLevel, evaluateStars, loadProgress, saveResult, isUnlocked } from '../src/levels/levels.js';

const memStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
};

test('levels: 4 levels in order, each with 3 star rules', () => {
  assert.deepEqual(LEVELS.map((l) => l.id), ['training', 'city', 'rings', 'forest']);
  for (const l of LEVELS) assert.equal(l.stars.length, 3, l.id);
  assert.equal(nextLevel('training').id, 'city');
  assert.equal(nextLevel('forest'), null);
  assert.equal(getLevel('nope'), null);
});

test('levels: star rating by clear / time / no damage', () => {
  const city = getLevel('city');
  assert.deepEqual(evaluateStars(city, { won: true, time: 200, hurt: false }), [true, true, true]);
  assert.deepEqual(evaluateStars(city, { won: true, time: 400, hurt: true }), [true, false, false]);
  assert.deepEqual(evaluateStars(city, { won: false, time: 10, hurt: false }), [false, false, false]);
  const rings = getLevel('rings');
  assert.deepEqual(evaluateStars(rings, { won: true, time: 100, hurt: true }), [true, true, false]);
});

test('levels: progress keeps the best result and unlocks the next level', () => {
  const st = memStorage();
  let p = loadProgress(st);
  assert.ok(isUnlocked(p, 'training'));
  assert.ok(!isUnlocked(p, 'city'));
  p = saveResult(st, 'training', 2, 120);
  p = saveResult(st, 'training', 1, 150); // 較差的成績不覆蓋
  assert.deepEqual(p.training, { stars: 2, time: 120 });
  assert.ok(isUnlocked(loadProgress(st), 'city'));
  assert.ok(!isUnlocked(loadProgress(st), 'rings'));
});
