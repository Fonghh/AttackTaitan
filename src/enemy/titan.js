// 巨型敵人：程序化模型、狀態機 AI（待機／追擊／揮擊／抓取／硬直／死亡）、後頸弱點，
// 部位效果（砍眼睛＝暈眩、砍腳＝跪下）、地盤範圍與建築碰撞、死亡後淡出。
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
  /**
   * @param {{x:number, z:number, yaw?:number, scale?:number, homeRadius?:number, name?:string}} spawn
   */
  constructor(scene, cfg, spawn) {
    this.cfg = cfg;
    this.spawn = spawn;
    this.scale = spawn.scale ?? 1;
    this.name = spawn.name ?? '巨人';
    // 每隻巨人自己的材質（受擊閃白、死亡淡出不會互相影響）
    const tint = spawn.tint ?? '#d39a7c';
    this.skin = new THREE.MeshStandardMaterial({ color: tint, roughness: 0.75, flatShading: true, emissive: '#000000' });
    const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(tint).multiplyScalar(0.78), roughness: 0.8, flatShading: true });
    const hairMat = new THREE.MeshStandardMaterial({ color: spawn.hair ?? '#3a2a1f', roughness: 1, flatShading: true });
    this.eyeMat = new THREE.MeshStandardMaterial({ color: '#fff7d6', emissive: '#ffd27a', emissiveIntensity: 0.6 });
    const mouthMat = new THREE.MeshStandardMaterial({ color: '#3b1414', roughness: 1 });
    const toothMat = new THREE.MeshStandardMaterial({ color: '#f1ead8', roughness: 0.6 });
    this.napeMat = new THREE.MeshStandardMaterial({ color: '#ff6a2a', emissive: '#ff4a10', emissiveIntensity: 1.6, roughness: 0.4 });
    this.handMatR = this.skin.clone();
    this.handMatL = this.skin.clone();
    this.materials = [this.skin, dark, hairMat, this.eyeMat, mouthMat, toothMat, this.napeMat, this.handMatR, this.handMatL];

    this.root = new THREE.Group();
    this.root.scale.setScalar(this.scale);
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

    const arm = (sx, handMat) => {
      const shoulder = new THREE.Group();
      shoulder.position.set(3.4 * sx, 1.2, 0);
      shoulder.add(part(new THREE.SphereGeometry(1.3, 8, 6), this.skin));
      shoulder.add(part(new THREE.CapsuleGeometry(0.9, 2.6, 4, 8), this.skin, 0, -2.1, 0));
      const elbow = new THREE.Group();
      elbow.position.y = -4.1;
      elbow.add(part(new THREE.CapsuleGeometry(0.8, 2.6, 4, 8), this.skin, 0, -1.9, 0));
      const hand = part(new THREE.SphereGeometry(1.2, 8, 6).scale(1, 1.3, 0.7), handMat, 0, -4.2, 0);
      elbow.add(hand);
      shoulder.add(elbow);
      this.chest.add(shoulder);
      return { shoulder, elbow, hand };
    };
    this.armL = arm(1, this.handMatL); // 巨人自己的左手（模型 +X）：抓取
    this.armR = arm(-1, this.handMatR); // 右手：揮擊

    this.neck = new THREE.Group();
    this.neck.position.y = 2.6;
    this.chest.add(this.neck);
    this.neck.add(part(new THREE.CapsuleGeometry(1.05, 1.0, 4, 8), this.skin, 0, 0.6, 0));
    this.head = new THREE.Group();
    this.head.position.y = 1.9;
    this.neck.add(this.head);
    this.head.add(part(new THREE.SphereGeometry(1.75, 12, 10).scale(1, 1.15, 1.05), this.skin, 0, 0.6, 0));
    this.head.add(part(new THREE.SphereGeometry(1.85, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.5).scale(1, 1.1, 1.1), hairMat, 0, 0.75, -0.1));
    const eye = new THREE.SphereGeometry(0.32, 8, 6);
    this.eyes = [part(eye, this.eyeMat, 0.6, 0.85, 1.6), part(eye, this.eyeMat, -0.6, 0.85, 1.6)];
    this.head.add(...this.eyes);
    this.head.add(part(new THREE.BoxGeometry(1.9, 0.5, 0.4), mouthMat, 0, -0.1, 1.62));
    this.head.add(part(new THREE.BoxGeometry(1.7, 0.18, 0.3), toothMat, 0, 0.06, 1.72));

    // 弱點：後頸發光區（巨人面向 +Z，背後為 -Z）。不用點光源（多隻巨人時手機吃不消），靠自發光
    this.nape = part(new THREE.SphereGeometry(1, 16, 12).scale(1.0, 0.75, 0.45), this.napeMat, 0, 1.0, -0.95);
    this.nape.castShadow = false;
    this.nape.userData.nape = true;
    this.neck.add(this.nape);

    scene.add(this.root);
    this.root.traverse((o) => {
      if (o.isMesh) {
        o.userData.titanPart = true;
        o.userData.titan = this;
      }
    });

    // 碰撞球（相對各部位，半徑為未縮放值）
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
    this.yaw = this.spawn.yaw ?? 0;
    this.root.position.set(this.spawn.x, 0, this.spawn.z);
    this.root.visible = true;
    this.fall.rotation.set(0, 0, 0);
    this.fall.position.set(0, 0, 0);
    this.walkPhase = 0;
    this.attackCooldown = 2.5 + Math.random() * 2;
    this.hitFlash = 0;
    this.swipeHit = false;
    this.stunTimer = 0; // 眼睛被砍：暈眩
    this.kneelTimer = 0; // 腳被砍：跪下
    this.kneelAmount = 0;
    this.deadTime = 0;
    this.gone = false;
    this.holding = false;
    for (const m of this.materials) {
      m.transparent = false;
      m.opacity = 1;
      m.depthWrite = true;
    }
    this.root.traverse((o) => {
      if (o.isMesh) o.userData.noHook = false;
    });
    this.events.length = 0;
    this.updatePose(0);
    this.root.updateMatrixWorld(true);
    this._updateSpheres();
  }

  get alive() {
    return this.state !== 'dying' && this.state !== 'dead';
  }

  /** 身高（公尺） */
  get height() {
    return 20 * this.scale;
  }

  setState(s) {
    this.state = s;
    this.stateTime = 0;
  }

  napeWorld(out) {
    return this.nape.getWorldPosition(out);
  }

  eyeWorld(i, out) {
    return this.eyes[i].getWorldPosition(out);
  }

  /** 腳踝附近（小腿下段）的世界座標 */
  ankleWorld(side, out) {
    const leg = side === 'L' ? this.legL : this.legR;
    out.set(0, -3.3, 0);
    return leg.knee.localToWorld(out);
  }

  /** 抓取用的左手世界座標 */
  grabHandWorld(out) {
    return this.armL.hand.getWorldPosition(out);
  }

  takeHit(damage, isNape) {
    if (!this.alive) return;
    this.hp = Math.max(0, this.hp - damage);
    this.hitFlash = isNape ? 0.35 : 0.15;
    if (this.hp <= 0) {
      this._die();
    } else if (isNape) {
      this.releaseGrab();
      this.setState('stagger');
    }
  }

  /** 部位攻擊：'eye' 暈眩、'leg' 跪下 */
  takePartHit(partName, damage) {
    if (!this.alive) return;
    this.hp = Math.max(0, this.hp - damage);
    this.hitFlash = 0.2;
    if (this.hp <= 0) {
      this._die();
      return;
    }
    const T = this.cfg.titan;
    this.releaseGrab();
    if (partName === 'eye') {
      this.stunTimer = T.stunTime;
      this.events.push({ type: 'blinded' });
    } else if (partName === 'leg') {
      this.kneelTimer = T.kneelTime;
      this.events.push({ type: 'kneel' });
    }
    if (this.state !== 'idle' && this.state !== 'walk') this.setState('idle');
  }

  _die() {
    this.releaseGrab();
    this.setState('dying');
    this.events.push({ type: 'dying' });
    // 屍體不能再被勾
    this.root.traverse((o) => {
      if (o.isMesh) o.userData.noHook = true;
    });
  }

  releaseGrab(escaped = false) {
    if (!this.holding) return;
    this.holding = false;
    this.events.push({ type: 'grabRelease', escaped });
    if (this.alive) this.setState(escaped ? 'stagger' : 'recover');
  }

  /**
   * @param {{colliders:{min:THREE.Vector3,max:THREE.Vector3}[]}} world
   */
  update(dt, player, world) {
    const T = this.cfg.titan;
    const S = this.scale;
    this.stateTime += dt;
    this.attackCooldown -= dt;
    if (this.hitFlash > 0) this.hitFlash -= dt;
    if (this.stunTimer > 0) this.stunTimer -= dt;
    if (this.kneelTimer > 0) this.kneelTimer -= dt;
    this.kneelAmount += ((this.kneelTimer > 0 ? 1 : 0) - this.kneelAmount) * Math.min(1, dt * 4);

    const pos = this.root.position;
    const dx = player.pos.x - pos.x;
    const dz = player.pos.z - pos.z;
    const dist = Math.hypot(dx, dz);
    const targetYaw = Math.atan2(dx, dz);
    this.forward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const facing = dist > 1e-3 ? (dx * this.forward.x + dz * this.forward.z) / dist : 1;
    const stunned = this.stunTimer > 0;
    const kneeling = this.kneelTimer > 0;
    const aggro = player.hp > 0 && dist < T.aggroRange && !stunned;

    const turn = (rate) => {
      if (stunned) return;
      let d = targetYaw - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += Math.max(-rate * dt, Math.min(rate * dt, d));
    };

    switch (this.state) {
      case 'idle':
      case 'walk': {
        if (aggro) turn(T.turnRate * (kneeling ? 0.5 : 1));
        const reach = T.attackRange * S;
        const relH = player.pos.y / this.height;
        if (aggro && !kneeling && this.attackCooldown <= 0 && dist < reach && relH < 1.3 && facing > T.attackCone) {
          // 玩家在手的高度附近時，有機會改用抓的
          const canGrab = relH > 0.25 && relH < 0.95 && dist < reach * 0.8;
          if (canGrab && Math.random() < T.grabChance) {
            this.setState('grabWindup');
            this.events.push({ type: 'grabWindup' });
          } else {
            this.setState('windup');
            this.swipeHit = false;
            this.events.push({ type: 'windup' });
          }
          break;
        }
        if (aggro && !kneeling && dist > T.chaseDist * S) {
          if (this.state !== 'walk') this.setState('walk');
          _v.set(this.forward.x, 0, this.forward.z).multiplyScalar(T.walkSpeed * S * dt);
          pos.add(_v);
          // 地盤範圍：不會離家太遠
          const hx = pos.x - this.spawn.x, hz = pos.z - this.spawn.z;
          const hr = Math.hypot(hx, hz);
          const lim = this.spawn.homeRadius ?? T.arenaRadius;
          if (hr > lim) {
            pos.x = this.spawn.x + (hx / hr) * lim;
            pos.z = this.spawn.z + (hz / hr) * lim;
          }
          const prev = this.walkPhase;
          this.walkPhase += dt * 1.6 / Math.sqrt(S);
          if (Math.floor(prev / Math.PI) !== Math.floor(this.walkPhase / Math.PI)) this.events.push({ type: 'step' });
        } else if (this.state !== 'idle') {
          this.setState('idle');
        }
        break;
      }
      case 'windup':
        turn(T.turnRate * 0.6);
        if (stunned) this.setState('idle');
        else if (this.stateTime >= T.windup) {
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
      case 'grabWindup':
        turn(T.turnRate * 0.8);
        if (stunned) this.setState('idle');
        else if (this.stateTime >= T.grabWindup) this.setState('grabReach');
        break;
      case 'grabReach':
        if (this.stateTime >= T.grabReach) {
          this.setState('recover');
          this.attackCooldown = T.attackCooldown;
        }
        break;
      case 'holding':
        if (this.stateTime >= T.grabHoldTime) {
          // 沒掙脫：捏下去
          this.events.push({ type: 'crush' });
          this.holding = false;
          this.setState('recover');
          this.attackCooldown = T.attackCooldown * 1.5;
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
      case 'dead':
        this._fadeOut(dt);
        break;
    }

    if (this.alive && world && world.colliders) this._collideBuildings(world.colliders);

    this.updatePose(dt, player);
    this.root.updateMatrixWorld(true);
    this._updateSpheres();

    // 揮擊命中判定（右手掌 + 前臂）
    if (this.state === 'swing' && !this.swipeHit && player.hp > 0) {
      const hand = this.armR.hand.getWorldPosition(_v);
      const fore = this.spheres[11].center;
      const r = T.swipeRadius * S;
      if (hand.distanceTo(player.pos) < r || fore.distanceTo(player.pos) < r * 0.8) {
        this.swipeHit = true;
        _v2.set(player.pos.x - pos.x, 0, player.pos.z - pos.z).normalize().multiplyScalar(T.swipeKnock);
        _v2.y = 8;
        this.events.push({ type: 'swipeHit', knock: _v2.clone() });
      }
    }
    // 抓取判定（左手）
    if (this.state === 'grabReach' && player.hp > 0 && !player.grabbedBy) {
      const hand = this.armL.hand.getWorldPosition(_v);
      if (hand.distanceTo(player.pos) < T.grabRadius * S) {
        this.holding = true;
        this.setState('holding');
        this.events.push({ type: 'grabbed' });
      }
    }
  }

  /** 死亡後：先冒蒸氣躺著，再慢慢淡出消失 */
  _fadeOut(dt) {
    const T = this.cfg.titan;
    this.deadTime += dt;
    if (this.deadTime < T.fadeDelay) return;
    const k = Math.min(1, (this.deadTime - T.fadeDelay) / T.fadeTime);
    for (const m of this.materials) {
      if (!m.transparent) {
        m.transparent = true;
        m.depthWrite = false;
        m.needsUpdate = true;
      }
      m.opacity = 1 - k;
    }
    if (k >= 1 && !this.gone) {
      this.gone = true;
      this.root.visible = false;
      this.events.push({ type: 'gone' });
    }
  }

  /** 巨人身體（圓）與建築（方塊）的水平碰撞，避免穿進大樓 */
  _collideBuildings(colliders) {
    const p = this.root.position;
    const r = 3.2 * this.scale;
    for (const { min, max } of colliders) {
      if (max.y < 6) continue; // 低矮物體略過
      const cx = Math.max(min.x, Math.min(p.x, max.x));
      const cz = Math.max(min.z, Math.min(p.z, max.z));
      const dx = p.x - cx, dz = p.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-6) {
        const d = Math.sqrt(d2);
        p.x += (dx / d) * (r - d);
        p.z += (dz / d) * (r - d);
      } else {
        // 中心在方塊內：往最近的邊推出
        const opts = [[p.x - min.x, -1, 0], [max.x - p.x, 1, 0], [p.z - min.z, 0, -1], [max.z - p.z, 0, 1]];
        opts.sort((a, b) => a[0] - b[0]);
        p.x += opts[0][1] * (opts[0][0] + r);
        p.z += opts[0][2] * (opts[0][0] + r);
      }
    }
  }

  _updateSpheres() {
    const live = this.alive;
    for (let i = 0; i < this.sphereDefs.length; i++) {
      const [obj, x, y, z, r] = this.sphereDefs[i];
      this.spheres[i].center.set(x, y, z);
      obj.localToWorld(this.spheres[i].center);
      // 死掉後不再有碰撞（屍體虛化）
      this.spheres[i].r = live ? r * this.scale : 0;
    }
  }

  updatePose(dt, player) {
    const t = performance.now() / 1000;
    this.root.rotation.y = this.yaw;
    const s = this.state;
    const k = this.stateTime;
    const T = this.cfg.titan;

    // 預設：呼吸
    let spineX = Math.sin(t * 1.3 + this.spawn.x) * 0.03;
    let neckX = 0;
    let neckY = 0;
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
    } else if (s === 'grabWindup' || s === 'grabReach') {
      // 左手伸向玩家的高度
      let elev = 0;
      if (player) {
        this.armL.shoulder.getWorldPosition(_v);
        const hd = Math.hypot(player.pos.x - _v.x, player.pos.z - _v.z);
        elev = Math.atan2(player.pos.y - _v.y, Math.max(1, hd));
      }
      const target = -(Math.PI / 2 + elev);
      const p = s === 'grabWindup' ? Math.min(1, k / T.grabWindup) * 0.55 : 0.55 + Math.min(1, k / T.grabReach) * 0.45;
      armLX = 0.15 + (target - 0.15) * p;
      armLZ = 0.2 - 0.25 * p;
      elbowL = -0.9 * (1 - p);
      spineX = 0.3 * p;
    } else if (s === 'holding') {
      // 把抓到的人舉到臉前
      armLX = -(Math.PI / 2 + 0.35);
      armLZ = -0.35;
      elbowL = -1.1;
      neckX = -0.1;
      spineX = 0.1 + Math.sin(t * 18) * 0.02;
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

    // 暈眩：雙手摀眼、頭亂晃
    if (this.stunTimer > 0 && this.alive && s !== 'holding') {
      armLX = armRX = -2.4;
      armLZ = -0.5;
      armRZ = 0.5;
      elbowL = elbowR = -1.6;
      neckX = 0.25 + Math.sin(t * 7) * 0.12;
      neckY = Math.sin(t * 5) * 0.35;
    }
    // 跪下：骨盆下沉、大腿往前、小腿往後
    const kn = this.alive ? this.kneelAmount : 0;
    pelvisY -= kn * 4.2;
    const hipK = -1.25 * kn;
    const kneeK = 2.2 * kn;
    spineX += 0.35 * kn;

    this.pelvis.position.y = pelvisY;
    this.spine.rotation.x = spineX;
    this.neck.rotation.set(neckX, neckY, 0);
    this.legL.hip.rotation.x = legA * (1 - kn) + hipK;
    this.legR.hip.rotation.x = -legA * (1 - kn) + hipK;
    this.legL.knee.rotation.x = Math.max(0, -legA) * 0.9 * (1 - kn) + kneeK;
    this.legR.knee.rotation.x = Math.max(0, legA) * 0.9 * (1 - kn) + kneeK;
    this.armL.shoulder.rotation.set(armLX, 0, armLZ);
    this.armR.shoulder.rotation.set(armRX, 0, armRZ);
    this.armL.elbow.rotation.x = elbowL;
    this.armR.elbow.rotation.x = elbowR;

    // 弱點脈動；受擊閃白；預備攻擊時手掌發紅；暈眩時眼睛變暗
    const pulse = 1.4 + Math.sin(t * 5) * 0.5;
    this.napeMat.emissiveIntensity = this.alive ? pulse : 0.2;
    this.eyeMat.emissiveIntensity = this.stunTimer > 0 || !this.alive ? 0 : 0.6;
    this.eyeMat.color.set(this.stunTimer > 0 ? '#5a1010' : '#fff7d6');
    const hf = this.hitFlash > 0 ? 1 : 0;
    this.skin.emissive.setRGB(0.4 * hf, 0.22 * hf, 0.15 * hf);
    const warnR = s === 'windup' ? Math.min(1, k / T.windup) : 0;
    this.handMatR.emissive.setRGB(warnR * 0.9, 0.05 * warnR, 0);
    const warnL = s === 'grabWindup' ? Math.min(1, k / T.grabWindup) : s === 'grabReach' ? 1 : 0;
    this.handMatL.emissive.setRGB(warnL * 0.9, 0.3 * warnL, 0);
  }
}
