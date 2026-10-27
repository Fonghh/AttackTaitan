// 程序化角色模型：外套、披風、腰間鋼索發射器、雙刀，並依狀態擺姿勢。
import * as THREE from 'three';

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);

function mesh(geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

export class PlayerModel {
  constructor(scene) {
    const skin = new THREE.MeshStandardMaterial({ color: '#e7c3a0', roughness: 0.7 });
    const jacket = new THREE.MeshStandardMaterial({ color: '#7a5a3a', roughness: 0.8 });
    const pants = new THREE.MeshStandardMaterial({ color: '#e8e2d2', roughness: 0.9 });
    const boots = new THREE.MeshStandardMaterial({ color: '#2b211b', roughness: 0.6 });
    const cape = new THREE.MeshStandardMaterial({ color: '#2f5d3a', roughness: 0.9, side: THREE.DoubleSide });
    const metal = new THREE.MeshStandardMaterial({ color: '#a8b0b8', metalness: 0.85, roughness: 0.3 });
    const blade = new THREE.MeshStandardMaterial({ color: '#dfe8f0', metalness: 0.9, roughness: 0.15, emissive: '#223344' });
    const hair = new THREE.MeshStandardMaterial({ color: '#2a2018', roughness: 0.9 });

    this.root = new THREE.Group(); // 位置與朝向
    this.body = new THREE.Group(); // 傾斜
    this.root.add(this.body);
    // 腳底在 body 原點下方：球心到腳底 = 0.55
    this.body.position.y = -0.55;

    this.hips = new THREE.Group();
    this.hips.position.y = 0.95;
    this.body.add(this.hips);

    const torso = mesh(new THREE.CapsuleGeometry(0.2, 0.42, 4, 8), jacket, 0, 0.38, 0);
    this.hips.add(torso);
    this.hips.add(mesh(new THREE.BoxGeometry(0.42, 0.12, 0.26), boots, 0, 0.08, 0)); // 腰帶
    // 頭
    this.head = new THREE.Group();
    this.head.position.y = 0.82;
    this.hips.add(this.head);
    this.head.add(mesh(new THREE.SphereGeometry(0.14, 12, 10), skin, 0, 0.06, 0));
    this.head.add(mesh(new THREE.SphereGeometry(0.15, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), hair, 0, 0.09, 0.01));

    // 腰間發射器
    this.launcherL = mesh(new THREE.BoxGeometry(0.12, 0.16, 0.34), metal, 0.3, 0.05, 0);
    this.launcherR = mesh(new THREE.BoxGeometry(0.12, 0.16, 0.34), metal, -0.3, 0.05, 0);
    this.hips.add(this.launcherL, this.launcherR);
    // 背後氣罐
    const tank = new THREE.CylinderGeometry(0.07, 0.07, 0.5, 8).rotateX(Math.PI / 2);
    this.hips.add(mesh(tank, metal, 0.24, -0.02, 0.1), mesh(tank, metal, -0.24, -0.02, 0.1));

    // 手臂（肩膀為關節）
    const makeArm = (sx) => {
      const shoulder = new THREE.Group();
      shoulder.position.set(0.27 * sx, 0.62, 0);
      const upper = mesh(new THREE.CapsuleGeometry(0.065, 0.26, 4, 6), jacket, 0, -0.17, 0);
      const fore = new THREE.Group();
      fore.position.y = -0.34;
      fore.add(mesh(new THREE.CapsuleGeometry(0.055, 0.24, 4, 6), skin, 0, -0.14, 0));
      const sword = new THREE.Group();
      sword.position.y = -0.3;
      sword.add(mesh(new THREE.BoxGeometry(0.05, 0.1, 0.08), metal, 0, 0, 0));
      const b = mesh(new THREE.BoxGeometry(0.015, 0.06, 0.9), blade, 0, 0, -0.48);
      sword.add(b);
      fore.add(sword);
      shoulder.add(upper, fore);
      this.hips.add(shoulder);
      return { shoulder, fore, sword };
    };
    // 模型面向 -Z（與攝影機前方一致），+X 為右側
    this.armR = makeArm(1);
    this.armL = makeArm(-1);
    // 左右發射器位置對調：+x 為右
    this.launcherL.position.x = -0.3;
    this.launcherR.position.x = 0.3;

    const makeLeg = (sx) => {
      const hip = new THREE.Group();
      hip.position.set(0.11 * sx, 0, 0);
      hip.add(mesh(new THREE.CapsuleGeometry(0.08, 0.32, 4, 6), pants, 0, -0.22, 0));
      const knee = new THREE.Group();
      knee.position.y = -0.45;
      knee.add(mesh(new THREE.CapsuleGeometry(0.07, 0.3, 4, 6), boots, 0, -0.2, 0));
      hip.add(knee);
      this.hips.add(hip);
      return { hip, knee };
    };
    this.legL = makeLeg(-1);
    this.legR = makeLeg(1);

    // 披風（可擺動的頂點）
    const capeGeo = new THREE.PlaneGeometry(0.55, 0.85, 4, 6);
    capeGeo.translate(0, -0.42, 0);
    this.capeBase = capeGeo.attributes.position.array.slice();
    this.cape = mesh(capeGeo, cape, 0, 0.72, 0.17);
    this.hips.add(this.cape);

    scene.add(this.root);

    this.yaw = 0;
    this.time = 0;
    this.slashTimer = 0;
    this.spinTimer = 0;
    this.slashSide = 1;
    this.lean = new THREE.Quaternion();
    this._spinQ = new THREE.Quaternion();

    // 兵長斬：紅色光暈＋沿飛行方向高速旋轉
    this.aura = new THREE.Mesh(
      new THREE.SphereGeometry(1.15, 16, 12),
      new THREE.MeshBasicMaterial({ color: '#ff2a3a', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.aura.position.y = 0.2;
    this.aura.visible = false;
    this.root.add(this.aura);
    this.leviMode = 0;
    this.leviAngle = 0;
    this._leviAxis = new THREE.Vector3();
  }

  /** 兵長斬狀態：0 無、1 空中短拍（蓄力）、2 迴旋直衝 */
  setLevi(mode, vel) {
    this.leviMode = mode;
    this._leviVel = vel;
  }

  /** 刀身根部與刀尖的世界座標（刀身殘光用） */
  bladeWorld(side, base, tip, full = true) {
    const sword = (side === 'left' ? this.armL : this.armR).sword;
    base.set(0, 0, full ? -0.1 : -0.72); // 飛行時只取刀尖一小段
    tip.set(0, 0, -0.95);
    sword.localToWorld(base);
    sword.localToWorld(tip);
  }

  /** 迴旋斬：整個人高速旋轉兩圈 */
  startSpin() {
    this.spinTimer = 0.45;
    this.slashTimer = 0.28;
  }

  /** 鋼索發射口的世界座標 */
  launcherWorld(side, out) {
    return (side === 'left' ? this.launcherL : this.launcherR).getWorldPosition(out);
  }

  startSlash() {
    this.slashTimer = 0.28;
    this.slashSide *= -1;
  }

  /** faceYaw：指定身體朝向（鎖定鏡頭時朝向目標），null＝照移動方向 */
  update(dt, pc, camYaw, faceYaw = null) {
    this.time += dt;
    const v = pc.vel;
    const hs = Math.hypot(v.x, v.z);
    const speed = pc.speed;
    this.root.position.copy(pc.pos);

    // 朝向：移動時面向速度方向，靜止時面向攝影機前方
    let targetYaw = camYaw;
    if (faceYaw != null && !pc.grounded) targetYaw = faceYaw;
    else if (hs > 2) targetYaw = Math.atan2(-v.x, -v.z);
    let dy = targetYaw - this.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.yaw += dy * Math.min(1, dt * 10);
    this.root.rotation.y = this.yaw;

    // 空中依速度向量前傾
    const airborne = !pc.grounded;
    const t = this.time;
    if (airborne && speed > 3) {
      _v.copy(v).normalize();
      const pitch = Math.asin(Math.max(-1, Math.min(1, _v.y)));
      const lean = -Math.min(1.2, (speed / 40) * 1.1) + pitch * 0.5;
      _q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), lean);
    } else if (pc.sliding) {
      _q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.35);
    } else if (pc.grounded && hs > 1) {
      // 地面奔跑：壓低身體前傾
      _q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.45 * Math.min(1, hs / 9));
    } else {
      _q.identity();
    }
    // 側傾：重心往彎內傾（右轉往右傾）。地面依轉向角度、空中依側向加速度（繞圈、擺盪時整個人斜躺）
    let bank = Math.max(-0.35, Math.min(0.35, dy * 0.9)) * Math.min(1, hs / 6);
    if (airborne && pc.accel) {
      const lat = pc.accel.x * Math.cos(this.yaw) - pc.accel.z * Math.sin(this.yaw);
      bank = Math.max(-1.1, Math.min(1.1, -lat / 26)) + bank * 0.5;
    }
    this.bank = bank;
    _q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), bank));
    this.lean.slerp(_q, Math.min(1, dt * 8));
    this.body.quaternion.copy(this.lean);
    if (this.leviMode) {
      // 短拍：身體縮起慢轉蓄力；直衝：沿飛行方向像鑽頭一樣高速旋轉
      this.leviAngle += dt * (this.leviMode === 2 ? Math.PI * 9 : Math.PI * 2.5);
      const lv = this._leviVel;
      if (this.leviMode === 2 && lv && lv.lengthSq() > 1) {
        // 飛行方向轉到 root 的座標系（root 只有 yaw）
        this._leviAxis.copy(lv).normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), -this.yaw);
        this._spinQ.setFromAxisAngle(this._leviAxis, this.leviAngle);
      } else {
        this._spinQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.leviAngle);
      }
      this.body.quaternion.premultiply(this._spinQ);
      this.slashTimer = Math.max(this.slashTimer, 0.1);
    }
    const auraTarget = this.leviMode === 2 ? 0.55 : this.leviMode === 1 ? 0.35 + 0.15 * Math.sin(this.time * 30) : 0;
    const am = this.aura.material;
    am.opacity += (auraTarget - am.opacity) * Math.min(1, dt * 14);
    this.aura.visible = am.opacity > 0.02;
    this.aura.scale.setScalar(this.leviMode === 1 ? 1.25 : 1);
    if (pc.flip) {
      // 翻轉衝刺：往前翻一圈
      const k = 1 - pc.flip.t / pc.flip.time;
      this._spinQ.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -k * Math.PI * 2);
      this.body.quaternion.premultiply(this._spinQ);
    }
    if (this.spinTimer > 0) {
      this.spinTimer -= dt;
      const k = 1 - Math.max(0, this.spinTimer) / 0.45;
      this._spinQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), k * Math.PI * 4);
      this.body.quaternion.premultiply(this._spinQ);
    }

    // 姿勢
    const L = this.legL, R = this.legR;
    let running = false;
    if (pc.grounded && !pc.sliding && hs > 0.5) {
      // 持刀壓低奔跑：步幅大、膝蓋彎，雙手握刀往後拖（不擺手）
      running = true;
      const k = Math.min(1, hs / 8);
      const ph = t * (hs * 1.0 + 5);
      const a = Math.sin(ph) * k * 1.05;
      L.hip.rotation.x = a + 0.25 * k;
      R.hip.rotation.x = -a + 0.25 * k;
      L.knee.rotation.x = -(0.35 + Math.max(0, -a) * 1.5) * k;
      R.knee.rotation.x = -(0.35 + Math.max(0, a) * 1.5) * k;
      const bob = Math.sin(ph * 2) * 0.05 * k;
      this.armL.shoulder.rotation.x = -0.25 - 0.8 * k + bob;
      this.armR.shoulder.rotation.x = -0.25 - 0.8 * k - bob;
      this.hips.position.y = 0.95 - 0.13 * k + Math.abs(Math.cos(ph)) * 0.05 * k;
    } else if (pc.sliding) {
      L.hip.rotation.x = 1.2;
      L.knee.rotation.x = -0.1;
      R.hip.rotation.x = -0.2;
      R.knee.rotation.x = -1.7;
      this.hips.position.y = 0.6;
      this.armL.shoulder.rotation.x = -0.6;
      this.armR.shoulder.rotation.x = -0.6;
    } else if (airborne && (pc.dashing || pc.levi)) {
      // 衝刺：縮身前衝，雙刀往後拖
      L.hip.rotation.x = 1.05;
      R.hip.rotation.x = 0.85;
      L.knee.rotation.x = -1.4;
      R.knee.rotation.x = -1.2;
      this.hips.position.y = 0.95;
      this.armL.shoulder.rotation.x = this.armR.shoulder.rotation.x = -1.65;
    } else if (airborne) {
      // 飛行姿勢：速度越快雙刀越往後張開、雙腿越往後拖
      const k = Math.max(0, Math.min(1, (speed - 10) / 35));
      const flap = Math.sin(t * 9) * 0.05;
      L.hip.rotation.x = 0.35 + 0.35 * k + flap;
      R.hip.rotation.x = 0.2 + 0.3 * k - flap;
      L.knee.rotation.x = -0.7 + 0.2 * k;
      R.knee.rotation.x = -0.5 + 0.2 * k;
      this.hips.position.y = 0.95;
      this.armL.shoulder.rotation.x = -0.7 - 0.75 * k;
      this.armR.shoulder.rotation.x = -0.7 - 0.75 * k;
    } else {
      L.hip.rotation.x = R.hip.rotation.x = 0;
      L.knee.rotation.x = R.knee.rotation.x = 0;
      this.armL.shoulder.rotation.x = this.armR.shoulder.rotation.x = Math.sin(t * 2) * 0.03;
      this.hips.position.y = 0.95;
    }
    // 手臂張開：飛越快張越開
    const spread = airborne ? 0.25 + Math.max(0, Math.min(1, (speed - 10) / 35)) * 0.55 : 0.25;
    this.armL.shoulder.rotation.z = -spread;
    this.armR.shoulder.rotation.z = spread;
    this.armL.fore.rotation.x = -0.5;
    this.armR.fore.rotation.x = -0.5;
    this.armL.sword.rotation.x = this.armR.sword.rotation.x = 0;
    if (running) {
      // 手臂往兩側張開一點，刀尖朝後下方
      const k = Math.min(1, hs / 8);
      this.armL.shoulder.rotation.z = -0.25 - 0.3 * k;
      this.armR.shoulder.rotation.z = 0.25 + 0.3 * k;
      this.armL.fore.rotation.x = this.armR.fore.rotation.x = -0.25;
      this.armL.sword.rotation.x = this.armR.sword.rotation.x = 0.5 * k;
    }
    if (pc.sliding && hs > 6) {
      // 滑行／滑鏟：右手的刀壓低拖在地上（刮出火花）
      this.armR.shoulder.rotation.x = 0.35;
      this.armR.shoulder.rotation.z = 1.15;
      this.armR.fore.rotation.x = -0.15;
      this.armR.sword.rotation.x = -0.7;
    }

    // 斬擊動作：雙臂由上往下交叉揮砍
    if (this.slashTimer > 0) {
      this.slashTimer -= dt;
      const k = 1 - Math.max(0, this.slashTimer) / 0.28;
      const swing = -2.6 + k * 4.2;
      this.armL.shoulder.rotation.x = swing;
      this.armR.shoulder.rotation.x = swing;
      this.armL.shoulder.rotation.z = -0.25 - Math.sin(k * Math.PI) * 0.8 * this.slashSide;
      this.armR.shoulder.rotation.z = 0.25 - Math.sin(k * Math.PI) * 0.8 * this.slashSide;
      this.armL.fore.rotation.x = this.armR.fore.rotation.x = -0.2;
    }

    // 披風隨速度飄動
    const pos = this.cape.geometry.attributes.position;
    const base = this.capeBase;
    const flutter = Math.min(1, speed / 35);
    for (let i = 0; i < pos.count; i++) {
      const by = base[i * 3 + 1];
      const bx = base[i * 3];
      const d = -by; // 0（上）~ 0.85（下）
      const wave = Math.sin(t * (8 + flutter * 14) + d * 7 + bx * 3) * 0.05 * (0.3 + flutter) * d;
      const back = d * (0.15 + flutter * 0.9);
      pos.setXYZ(i, bx, by + back * 0.5 * flutter, back + wave);
    }
    pos.needsUpdate = true;
    this.cape.geometry.computeVertexNormals();

    // 無敵時間閃爍
    this.root.visible = pc.invuln > 0 ? Math.sin(t * 40) > -0.3 : true;
  }
}
