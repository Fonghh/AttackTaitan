// 巨型敵人：程序化模型、狀態機 AI（待機／追擊／預備／揮擊／硬直／死亡）、後頸弱點。
import * as THREE from 'three';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

function part(geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

const easeInQuad = (t) => t * t;

export class Titan {
  constructor(scene, cfg) {
    this.cfg = cfg;
    const T = cfg.titan;
    this.skin = new THREE.MeshStandardMaterial({ color: '#d39a7c', roughness: 0.75, flatShading: true, emissive: '#000000' });
    const dark = new THREE.MeshStandardMaterial({ color: '#a8705a', roughness: 0.8, flatShading: true });
    const hairMat = new THREE.MeshStandardMaterial({ color: '#3a2a1f', roughness: 1, flatShading: true });
    const eyeMat = new THREE.MeshStandardMaterial({ color: '#fff7d6', emissive: '#ffd27a', emissiveIntensity: 0.6 });
    const mouthMat = new THREE.MeshStandardMaterial({ color: '#3b1414', roughness: 1 });
    const toothMat = new THREE.MeshStandardMaterial({ color: '#f1ead8', roughness: 0.6 });
    this.napeMat = new THREE.MeshStandardMaterial({ color: '#ff6a2a', emissive: '#ff4a10', emissiveIntensity: 1.6, roughness: 0.4 });
    this.handMat = this.skin.clone();

    this.root = new THREE.Group();
    this.fall = new THREE.Group();
    this.root.add(this.fall);
    this.pelvis = new THREE.Group();
    this.pelvis.position.y = 9;
    this.fall.add(this.pelvis);
    this.pelvis.add(part(new THREE.SphereGeometry(2.4, 10, 8).scale(1.15, 0.8, 0.9), this.skin));

    const leg = (sx) => {
      const hip = new THREE.Group();
      hip.position.set(1.4 * sx, -0.4, 0);
      hip.add(part(new THREE.CapsuleGeometry(1.15, 3.0, 4, 8), this.skin, 0, -2.2, 0));
      const knee = new THREE.Group();
      knee.position.y = -4.4;
      knee.add(part(new THREE.CapsuleGeometry(0.95, 3.0, 4, 8), this.skin, 0, -2.1, 0));
      knee.add(part(new THREE.BoxGeometry(1.7, 0.7, 2.8), this.skin, 0, -4.0, 0.6));
      hip.add(knee);
      this.pelvis.add(hip);
      return { hip, knee };
    };
    this.legL = leg(1);
    this.legR = leg(-1);

    this.spine = new THREE.Group();
    this.spine.position.y = 0.6;
    this.pelvis.add(this.spine);
    this.spine.add(part(new THREE.CapsuleGeometry(2.3, 2.4, 4, 10).scale(1.15, 1, 0.8), this.skin, 0, 2.4, 0));
    this.chest = new THREE.Group();
    this.chest.position.y = 4.6;
    this.spine.add(this.chest);
    this.chest.add(part(new THREE.SphereGeometry(2.9, 12, 10).scale(1.2, 0.85, 0.85), this.skin, 0, 0.6, 0));
    // 胸肌、腹肌輪廓
    this.chest.add(part(new THREE.BoxGeometry(2.2, 1.4, 0.6), dark, 1.2, 0.6, 2.2), part(new THREE.BoxGeometry(2.2, 1.4, 0.6), dark, -1.2, 0.6, 2.2));
    for (let i = 0; i < 3; i++) {
      this.spine.add(part(new THREE.BoxGeometry(1.0, 0.7, 0.4), dark, 0.6, 1.0 + i * 0.95, 1.85), part(new THREE.BoxGeometry(1.0, 0.7, 0.4), dark, -0.6, 1.0 + i * 0.95, 1.85));
    }

    const arm = (sx) => {
      const shoulder = new THREE.Group();
      shoulder.position.set(3.4 * sx, 1.2, 0);
      shoulder.add(part(new THREE.SphereGeometry(1.3, 8, 6), this.skin));
      shoulder.add(part(new THREE.CapsuleGeometry(0.9, 2.6, 4, 8), this.skin, 0, -2.1, 0));
      const elbow = new THREE.Group();
      elbow.position.y = -4.1;
      elbow.add(part(new THREE.CapsuleGeometry(0.8, 2.6, 4, 8), this.skin, 0, -1.9, 0));
      const hand = part(new THREE.SphereGeometry(1.2, 8, 6).scale(1, 1.3, 0.7), sx < 0 ? this.handMat : this.skin, 0, -4.2, 0);
      elbow.add(hand);
      shoulder.add(elbow);
      this.chest.add(shoulder);
      return { shoulder, elbow, hand };
    };
    this.armL = arm(1); // 巨人自己的左手（模型 +X）
    this.armR = arm(-1);

    this.neck = new THREE.Group();
    this.neck.position.y = 2.6;
    this.chest.add(this.neck);
    this.neck.add(part(new THREE.CapsuleGeometry(1.05, 1.0, 4, 8), this.skin, 0, 0.6, 0));
    this.head = new THREE.Group();
    this.head.position.y = 1.9;
    this.neck.add(this.head);
    this.head.add(part(new THREE.SphereGeometry(1.75, 12, 10).scale(1, 1.15, 1.05), this.skin, 0, 0.6, 0));
    this.head.add(part(new THREE.SphereGeometry(1.85, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.5).scale(1, 1.1, 1.1), hairMat, 0, 0.75, -0.1));
    const eye = new THREE.SphereGeometry(0.28, 8, 6);
    this.head.add(part(eye, eyeMat, 0.6, 0.85, 1.6), part(eye, eyeMat, -0.6, 0.85, 1.6));
    this.head.add(part(new THREE.BoxGeometry(1.9, 0.5, 0.4), mouthMat, 0, -0.1, 1.62));
    this.head.add(part(new THREE.BoxGeometry(1.7, 0.18, 0.3), toothMat, 0, 0.06, 1.72));

    // 弱點：後頸發光區（巨人面向 +Z，背後為 -Z）
    this.nape = part(new THREE.SphereGeometry(1, 16, 12).scale(1.0, 0.75, 0.45), this.napeMat, 0, 1.0, -0.95);
    this.nape.castShadow = false;
    this.nape.userData.nape = true;
    this.neck.add(this.nape);
    this.napeLight = new THREE.PointLight('#ff6a2a', 30, 14, 2);
    this.napeLight.position.set(0, 1.0, -2.2);
    this.neck.add(this.napeLight);

    scene.add(this.root);

    // 碰撞球（相對各部位）
    this.sphereDefs = [
      [this.pelvis, 0, 0, 0, 2.5],
      [this.spine, 0, 2.4, 0, 2.6],
      [this.chest, 0, 0.6, 0, 3.0],
      [this.head, 0, 0.6, 0, 1.9],
      [this.legL.hip, 0, -2.2, 0, 1.3], [this.legR.hip, 0, -2.2, 0, 1.3],
      [this.legL.knee, 0, -2.1, 0, 1.1], [this.legR.knee, 0, -2.1, 0, 1.1],
      [this.armL.shoulder, 0, -2.1, 0, 1.0], [this.armR.shoulder, 0, -2.1, 0, 1.0],
      [this.armL.elbow, 0, -1.9, 0, 0.9], [this.armR.elbow, 0, -1.9, 0, 0.9],
      [this.armL.elbow, 0, -4.2, 0, 1.3], [this.armR.elbow, 0, -4.2, 0, 1.3],
    ];
    this.spheres = this.sphereDefs.map(() => ({ center: new THREE.Vector3(), r: 0 }));
    this.events = [];
    this.forward = new THREE.Vector3(0, 0, 1);
    this.reset();
  }

  reset() {
    const T = this.cfg.titan;
    this.hp = T.hp;
    this.state = 'idle';
    this.stateTime = 0;
    this.yaw = Math.PI * 0.05;
    this.root.position.set(T.start.x, 0, T.start.z);
    this.fall.rotation.set(0, 0, 0);
    this.fall.position.set(0, 0, 0);
    this.walkPhase = 0;
    this.attackCooldown = 2.5;
    this.hitFlash = 0;
    this.swipeHit = false;
    this.events.length = 0;
    this.updatePose(0);
  }

  get alive() {
    return this.state !== 'dying' && this.state !== 'dead';
  }

  setState(s) {
    this.state = s;
    this.stateTime = 0;
  }

  napeWorld(out) {
    return this.nape.getWorldPosition(out);
  }

  takeHit(damage, isNape) {
    if (!this.alive) return;
    this.hp = Math.max(0, this.hp - damage);
    this.hitFlash = isNape ? 0.35 : 0.15;
    if (this.hp <= 0) {
      this.setState('dying');
      this.events.push({ type: 'dying' });
    } else if (isNape) {
      this.setState('stagger');
    }
  }

  update(dt, player) {
    const T = this.cfg.titan;
    this.stateTime += dt;
    this.attackCooldown -= dt;
    if (this.hitFlash > 0) this.hitFlash -= dt;

    const pos = this.root.position;
    const dx = player.pos.x - pos.x;
    const dz = player.pos.z - pos.z;
    const dist = Math.hypot(dx, dz);
    const targetYaw = Math.atan2(dx, dz);
    this.forward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const facing = dist > 1e-3 ? (dx * this.forward.x + dz * this.forward.z) / dist : 1;

    const turn = (rate) => {
      let d = targetYaw - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += Math.max(-rate * dt, Math.min(rate * dt, d));
    };

    switch (this.state) {
      case 'idle':
      case 'walk': {
        turn(T.turnRate);
        const playerAlive = player.hp > 0;
        if (playerAlive && this.attackCooldown <= 0 && dist < T.attackRange && player.pos.y < T.attackMaxHeight && facing > T.attackCone) {
          this.setState('windup');
          this.swipeHit = false;
          this.events.push({ type: 'windup' });
          break;
        }
        if (playerAlive && dist > T.chaseDist) {
          if (this.state !== 'walk') this.setState('walk');
          _v.set(this.forward.x, 0, this.forward.z).multiplyScalar(T.walkSpeed * dt);
          pos.add(_v);
          const r = Math.hypot(pos.x, pos.z);
          if (r > T.arenaRadius) pos.multiplyScalar(T.arenaRadius / r);
          const prev = this.walkPhase;
          this.walkPhase += dt * 1.6;
          if (Math.floor(prev / Math.PI) !== Math.floor(this.walkPhase / Math.PI)) this.events.push({ type: 'step' });
        } else if (this.state !== 'idle') {
          this.setState('idle');
        }
        break;
      }
      case 'windup':
        turn(T.turnRate * 0.6);
        if (this.stateTime >= T.windup) {
          this.setState('swing');
          this.events.push({ type: 'swing' });
        }
        break;
      case 'swing':
        if (this.stateTime >= T.swing) this.setState('recover');
        break;
      case 'recover':
        if (this.stateTime >= T.recover) {
          this.setState('idle');
          this.attackCooldown = T.attackCooldown;
        }
        break;
      case 'stagger':
        if (this.stateTime >= T.staggerTime) {
          this.setState('idle');
          this.attackCooldown = Math.max(this.attackCooldown, 1.2);
        }
        break;
      case 'dying':
        if (this.stateTime >= 2.2) {
          this.setState('dead');
          this.events.push({ type: 'dead' });
        }
        break;
    }

    this.updatePose(dt);
    this.root.updateMatrixWorld(true);
    this._updateSpheres();

    // 揮擊命中判定（手掌 + 前臂）
    if (this.state === 'swing' && !this.swipeHit && player.hp > 0) {
      const hand = this.armR.hand.getWorldPosition(_v);
      const fore = this.spheres[11].center;
      const r = T.swipeRadius;
      if (hand.distanceTo(player.pos) < r || fore.distanceTo(player.pos) < r * 0.8) {
        this.swipeHit = true;
        _v2.set(player.pos.x - pos.x, 0, player.pos.z - pos.z).normalize().multiplyScalar(T.swipeKnock);
        _v2.y = 8;
        this.events.push({ type: 'swipeHit', knock: _v2.clone() });
      }
    }
  }

  _updateSpheres() {
    for (let i = 0; i < this.sphereDefs.length; i++) {
      const [obj, x, y, z, r] = this.sphereDefs[i];
      this.spheres[i].center.set(x, y, z);
      obj.localToWorld(this.spheres[i].center);
      this.spheres[i].r = this.alive ? r : r * 0.9;
    }
  }

  updatePose(dt) {
    const t = performance.now() / 1000;
    this.root.rotation.y = this.yaw;
    const s = this.state;
    const k = this.stateTime;
    const T = this.cfg.titan;

    // 預設：呼吸
    let spineX = Math.sin(t * 1.3) * 0.03;
    let neckX = 0;
    let legA = 0;
    let armLX = 0.15, armLZ = 0.2, armRX = 0.15, armRZ = -0.2, elbowL = -0.3, elbowR = -0.3;
    let pelvisY = 9;

    if (s === 'walk') {
      const ph = this.walkPhase;
      legA = Math.sin(ph) * 0.45;
      armLX = -Math.sin(ph) * 0.35;
      armRX = Math.sin(ph) * 0.35;
      pelvisY = 9 - Math.abs(Math.cos(ph)) * 0.35;
      spineX = 0.08;
    } else if (s === 'windup') {
      const p = Math.min(1, k / T.windup);
      armRX = 2.3 * p;
      armRZ = -0.2 - 0.9 * p;
      elbowR = -0.6 * p;
      spineX = 0.25 * p;
      neckX = -0.15 * p;
    } else if (s === 'swing') {
      const p = Math.min(1, k / T.swing);
      armRX = 2.3 - 3.6 * p;
      armRZ = -1.1 + 1.8 * p;
      elbowR = -0.6 + 0.6 * p;
      spineX = 0.25 + 0.2 * p;
    } else if (s === 'recover') {
      const p = Math.min(1, k / T.recover);
      armRX = -1.3 * (1 - p) + 0.15 * p;
      armRZ = 0.7 * (1 - p) - 0.2 * p;
      spineX = 0.45 * (1 - p);
    } else if (s === 'stagger') {
      const p = Math.min(1, k / 0.25);
      spineX = 0.5 * p;
      neckX = 0.5 * p;
      armLX = armRX = -0.6 * p;
      pelvisY = 9 - 0.8 * p;
    } else if (s === 'dying' || s === 'dead') {
      const p = Math.min(1, k / 2.2);
      this.fall.rotation.x = easeInQuad(p) * 1.48;
      this.fall.position.y = -p * 0.5;
      spineX = 0.4;
      neckX = 0.6;
      armLX = armRX = -0.4 * p;
      armLZ = 0.8 * p;
      armRZ = -0.8 * p;
      if (s === 'dead') this.fall.rotation.x = 1.48;
    }

    this.pelvis.position.y = pelvisY;
    this.spine.rotation.x = spineX;
    this.neck.rotation.x = neckX;
    this.legL.hip.rotation.x = legA;
    this.legR.hip.rotation.x = -legA;
    this.legL.knee.rotation.x = Math.max(0, -legA) * 0.9;
    this.legR.knee.rotation.x = Math.max(0, legA) * 0.9;
    this.armL.shoulder.rotation.set(armLX, 0, armLZ);
    this.armR.shoulder.rotation.set(armRX, 0, armRZ);
    this.armL.elbow.rotation.x = elbowL;
    this.armR.elbow.rotation.x = elbowR;

    // 弱點脈動；受擊閃白；預備揮擊時手掌發紅
    const pulse = 1.4 + Math.sin(t * 5) * 0.5;
    this.napeMat.emissiveIntensity = this.alive ? pulse : 0.2;
    this.napeLight.intensity = this.alive ? 20 + pulse * 10 : 0;
    const hf = this.hitFlash > 0 ? 1 : 0;
    this.skin.emissive.setRGB(0.4 * hf, 0.22 * hf, 0.15 * hf);
    const warn = s === 'windup' ? Math.min(1, k / T.windup) : 0;
    this.handMat.emissive.setRGB(warn * 0.9, 0.05 * warn, 0);
  }
}
