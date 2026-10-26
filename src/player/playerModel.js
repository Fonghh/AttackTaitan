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

  update(dt, pc, camYaw) {
    this.time += dt;
    const v = pc.vel;
    const hs = Math.hypot(v.x, v.z);
    const speed = pc.speed;
    this.root.position.copy(pc.pos);

    // 朝向：移動時面向速度方向，靜止時面向攝影機前方
    let targetYaw = camYaw;
    if (hs > 2) targetYaw = Math.atan2(-v.x, -v.z);
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
    } else {
      _q.identity();
    }
    // 轉向時側傾
    _q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -dy * 1.5));
    this.lean.slerp(_q, Math.min(1, dt * 8));
    this.body.quaternion.copy(this.lean);
    if (this.spinTimer > 0) {
      this.spinTimer -= dt;
      const k = 1 - Math.max(0, this.spinTimer) / 0.45;
      this._spinQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), k * Math.PI * 4);
      this.body.quaternion.premultiply(this._spinQ);
    }

    // 姿勢
    const L = this.legL, R = this.legR;
    if (pc.grounded && !pc.sliding && hs > 0.5) {
      const ph = t * (hs * 1.1 + 4);
      const a = Math.sin(ph) * Math.min(1, hs / 8) * 0.9;
      L.hip.rotation.x = a;
      R.hip.rotation.x = -a;
      L.knee.rotation.x = -Math.max(0, -a) * 1.2;
      R.knee.rotation.x = -Math.max(0, a) * 1.2;
      this.armL.shoulder.rotation.x = -a * 0.7;
      this.armR.shoulder.rotation.x = a * 0.7;
      this.hips.position.y = 0.95 + Math.abs(Math.cos(ph)) * 0.05;
    } else if (pc.sliding) {
      L.hip.rotation.x = 1.2;
      L.knee.rotation.x = -0.1;
      R.hip.rotation.x = -0.2;
      R.knee.rotation.x = -1.7;
      this.hips.position.y = 0.6;
      this.armL.shoulder.rotation.x = -0.6;
      this.armR.shoulder.rotation.x = -0.6;
    } else if (airborne) {
      // 飛行姿勢：雙腿併攏微彎，雙刀向後
      const flap = Math.sin(t * 9) * 0.05;
      L.hip.rotation.x = 0.35 + flap;
      R.hip.rotation.x = 0.2 - flap;
      L.knee.rotation.x = -0.7;
      R.knee.rotation.x = -0.5;
      this.hips.position.y = 0.95;
      this.armL.shoulder.rotation.x = -0.7;
      this.armR.shoulder.rotation.x = -0.7;
    } else {
      L.hip.rotation.x = R.hip.rotation.x = 0;
      L.knee.rotation.x = R.knee.rotation.x = 0;
      this.armL.shoulder.rotation.x = this.armR.shoulder.rotation.x = Math.sin(t * 2) * 0.03;
      this.hips.position.y = 0.95;
    }
    this.armL.shoulder.rotation.z = -0.25;
    this.armR.shoulder.rotation.z = 0.25;
    this.armL.fore.rotation.x = -0.5;
    this.armR.fore.rotation.x = -0.5;
    this.armL.sword.rotation.x = this.armR.sword.rotation.x = 0;

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
