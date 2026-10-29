import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene, Vector3 } from 'three';
import { CONFIG } from '../src/config.js';
import { Titan } from '../src/enemy/titan.js';

const box = (x0, x1, h) => ({ min: new Vector3(x0, 0, -20), max: new Vector3(x1, h, 20) });

test('abnormal leap: stops before a tall building, clears a low one', () => {
  const t = new Titan(new Scene(), CONFIG, { name: '測試奇行種', kind: 'abnormal', x: 0, z: 0, scale: 1 });
  const from = new Vector3(0, 0, 0), to = new Vector3(30, 0, 0);
  const tall = t._planLeap(from.clone(), to.clone(), [box(14, 18, 60)]);
  assert.ok(tall.to.x < 14 - 2, `stopped before the tall building (x ${tall.to.x.toFixed(1)})`);
  const low = t._planLeap(from.clone(), to.clone(), [box(14, 18, 7)]);
  assert.ok(Math.abs(low.to.x - 30) < 0.01, `jumped over the low building (x ${low.to.x.toFixed(1)})`);
});

test('titan looks are deterministic per spawn and differ between titans', () => {
  const a1 = new Titan(new Scene(), CONFIG, { name: 'A', x: 10, z: 20 }).look;
  const a2 = new Titan(new Scene(), CONFIG, { name: 'A', x: 10, z: 20 }).look;
  assert.deepEqual(a1, a2);
  const looks = new Set(['A', 'B', 'C', 'D', 'E', 'F'].map((n, i) => JSON.stringify(new Titan(new Scene(), CONFIG, { name: n, x: i * 7, z: i * 3 }).look)));
  assert.ok(looks.size >= 5, `${looks.size} distinct looks out of 6`);
});

test('toon titans: the nape sticks out of the big head and the chest collision spheres', () => {
  const cfg = { ...CONFIG, style: 'toon' };
  for (const sp of [{ name: '一般', x: 0, z: 0 }, { name: '奇行種', kind: 'abnormal', x: 5, z: 5 }]) {
    const t = new Titan(new Scene(), cfg, sp);
    t.root.updateMatrixWorld(true);
    t._updateSpheres();
    const nape = t.napeWorld(new Vector3());
    for (const i of [2, 3]) {
      const s = t.spheres[i]; // 2 = 胸口、3 = 頭
      const d = s.center.distanceTo(nape);
      assert.ok(d > s.r + 0.1, `${sp.name}: nape outside sphere ${i} (dist ${d.toFixed(2)}, r ${s.r.toFixed(2)})`);
    }
  }
});

const fakePlayer = (x, y, z) => ({ pos: new Vector3(x, y, z), vel: new Vector3(), hp: 100 });

test('thrower: raises a rock, throws it along a parabola and hits a player standing still', () => {
  const t = new Titan(new Scene(), CONFIG, { name: '投石', kind: 'thrower', x: 0, z: 0, scale: 1 });
  t.attackCooldown = 0;
  const p = fakePlayer(0, 2, 60);
  const ev = [];
  for (let i = 0; i < 60 * 5 && !ev.some((e) => e.type === 'rockHit'); i++) {
    t.update(1 / 60, p, { colliders: [] });
    ev.push(...t.events.splice(0));
  }
  const types = ev.map((e) => e.type);
  assert.ok(types.includes('throwWindup') && types.includes('throw'), types.join(','));
  assert.ok(types.includes('rockHit'), `rock hits a standing player (${types.join(',')})`);
});

test('armored: nape plates absorb the first hits, then break', () => {
  const t = new Titan(new Scene(), CONFIG, { name: '鎧甲', kind: 'armored', x: 0, z: 0 });
  const A = CONFIG.titan.armored;
  t.takeHit(60, true);
  assert.ok(t.hp > CONFIG.titan.hp - 60 * A.damageScale - 1e-6 && t.armor === A.plates - 1);
  for (let i = 1; i < A.plates; i++) t.takeHit(60, true);
  assert.equal(t.armor, 0);
  assert.ok(t.events.some((e) => e.type === 'armorBreak') && !t.napeArmor.visible);
  const hp = t.hp;
  t.takeHit(30, true);
  assert.equal(t.hp, Math.max(0, hp - 30), 'full damage after the armor is gone');
});

test('steam: charges, bursts, pushes a nearby player away and burns once', () => {
  const t = new Titan(new Scene(), CONFIG, { name: '蒸氣', kind: 'steam', x: 0, z: 0 });
  t.root.updateMatrixWorld(true);
  const nape = t.napeWorld(new Vector3());
  const p = fakePlayer(nape.x, nape.y, nape.z - 6);
  t.steamT = CONFIG.titan.steam.interval;
  const ev = [];
  for (let i = 0; i < 60 * 3; i++) {
    p.vel.set(0, 0, 0);
    t.update(1 / 60, p, { colliders: [] });
    ev.push(...t.events.splice(0));
    if (t.steamPhase === 'burst') break;
  }
  t.update(1 / 60, p, { colliders: [] });
  ev.push(...t.events.splice(0));
  assert.ok(ev.some((e) => e.type === 'steamWindup') && ev.some((e) => e.type === 'steamBurst'));
  assert.ok(ev.filter((e) => e.type === 'steamHit').length === 1);
  assert.ok(p.vel.z < -0.5, `pushed away from the nape (vz ${p.vel.z.toFixed(2)})`);
});
