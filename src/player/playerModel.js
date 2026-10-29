// 程序化角色模型：外套、披風、腰間鋼索發射器、雙刀，並依狀態擺姿勢。
import * as THREE from 'three';
import { makeMat, addOutlines, outlineMaterial } from '../fx/toon.js';

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _bq = new THREE.Quaternion();
const _pq = new THREE.Quaternion();
const _bd = new THREE.Vector3();
const _NEG_Z = new THREE.Vector3(0, 0, -1);
const _up = new THREE.Vector3(0, 1, 0);

function mesh(geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

/**
 * 卡通畫風的頭：大頭（Q 版）、動漫大眼（眼白＋有顏色的虹膜＋瞳孔＋兩點高光＋上睫毛）、眉毛、腮紅、
 * 小嘴巴、一撮一撮的髮束、配件。模型面向 -Z（臉在 -Z 那面）。頭的原始半徑 0.14，整顆頭再放大 headScale 倍。
 * 臉上的小零件標記 noOutline（不描邊，避免臉髒髒的）。
 */
function buildToonHead(head, HL, skin, hairMat) {
  head.scale.setScalar(HL.headScale);
  head.position.y += 0.02;
  const dark = makeMat(true, { color: HL.eyeColor });
  const iris = makeMat(true, { color: HL.irisColor || '#3a9fb8', emissive: HL.irisColor || '#3a9fb8', emissiveIntensity: 0.25 });
  const white = new THREE.MeshBasicMaterial({ color: '#ffffff' });
  const blush = new THREE.MeshBasicMaterial({ color: '#ff8fa3', transparent: true, opacity: 0.7 });
  const acc = makeMat(true, { color: HL.accessoryColor });
  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0, face = false) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    if (face) m.userData.noOutline = true;
    head.add(m);
    return m;
  };
  const face = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => add(geo, mat, x, y, z, rx, ry, rz, true);
  // 眼睛
  for (const sx of [-1, 1]) {
    const ex = 0.052 * sx;
    if (HL.eyes === 'sleepy') {
      face(new THREE.TorusGeometry(0.022, 0.006, 4, 10, Math.PI), dark, ex, 0.06, -0.134, 0, 0, Math.PI);
    } else {
      const sharp = HL.eyes === 'sharp';
      const tilt = sharp ? -0.22 * sx : 0;
      const sy = sharp ? 0.85 : 1.2;
      face(new THREE.SphereGeometry(0.033, 14, 10), white, ex, 0.056, -0.126, 0, 0, tilt).scale.set(0.85, sy, 0.35);
      face(new THREE.SphereGeometry(0.024, 14, 10), iris, ex, 0.052, -0.134, 0, 0, tilt).scale.set(0.9, sy * 0.95, 0.3);
      face(new THREE.SphereGeometry(0.012, 10, 8), dark, ex, 0.052, -0.139, 0, 0, tilt).scale.set(0.9, sy, 0.3);
      face(new THREE.SphereGeometry(0.0075, 8, 6), white, ex + 0.008, 0.066, -0.142); // 大高光
      face(new THREE.SphereGeometry(0.0038, 6, 4), white, ex - 0.009, 0.041, -0.141); // 小高光
      // 上睫毛：粗粗的弧線，外側微微翹起
      const lash = face(new THREE.TorusGeometry(0.031, 0.0055, 4, 14, Math.PI * 0.85), dark, ex, 0.054, -0.133, 0, 0, Math.PI * 0.075 + tilt);
      lash.scale.set(0.95, sy * 0.95, 0.5);
    }
    // 眉毛：有自信的角度（內低外高）
    const brow = face(new THREE.CapsuleGeometry(0.0055, 0.03, 3, 6), makeMat(true, { color: HL.hair }), ex, 0.104, -0.124, 0, 0, Math.PI / 2 - 0.28 * sx);
    brow.scale.set(1, 1, 0.6);
    if (HL.blush) {
      const b = face(new THREE.CircleGeometry(0.02, 14), blush, 0.08 * sx, 0.024, -0.124, 0, Math.PI - 0.55 * sx, 0);
      b.scale.set(1.35, 0.7, 1);
    }
  }
  // 嘴巴：淺淺的壞笑（一邊高一點）
  face(new THREE.TorusGeometry(0.015, 0.0035, 4, 10, Math.PI * 0.8), dark, 0.006, 0.014, -0.137, 0, 0, Math.PI * 1.13);

  // 髮型：底層髮帽＋一撮一撮的錐形髮束（每撮都有描邊，輪廓很清楚）
  const UP = new THREE.Vector3(0, 1, 0);
  const lock = (ax, ay, az, dx, dy, dz, len, r, flat = 0.75) => {
    const dir = new THREE.Vector3(dx, dy, dz).normalize();
    const m = new THREE.Mesh(new THREE.ConeGeometry(r, len, 10, 1), hairMat);
    m.quaternion.setFromUnitVectors(UP, dir);
    m.position.set(ax, ay, az).addScaledVector(dir, len * 0.42);
    m.scale.set(1, 1, flat);
    m.userData.noOutline = true; // 髮束不描邊（尖端描邊會變成鋸齒），輪廓交給髮帽
    head.add(m);
    return m;
  };
  const cap = add(new THREE.SphereGeometry(0.152, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.52), hairMat, 0, 0.082, 0.012);
  cap.scale.set(1.03, 1.04, 1.06);
  const back = add(new THREE.SphereGeometry(0.152, 18, 10, 0, Math.PI, Math.PI * 0.35, Math.PI * 0.45), hairMat, 0, 0.07, 0.008);
  back.scale.set(1.03, 1.05, 1.06);
  // 瀏海：五撮往下、往前，中間最長，左右交錯
  const bangs = [[-0.088, 0.095, -0.3], [-0.042, 0.112, -0.1], [0.006, 0.118, 0.12], [0.05, 0.106, 0.25], [0.09, 0.09, 0.4]];
  for (const [x, len, sway] of bangs) lock(x, 0.17, -0.1, sway * 0.5 + x * 2, -1, -0.5, len, 0.042, 0.55);
  // 鬢角：兩側垂到臉頰
  for (const sx of [-1, 1]) {
    lock(0.128 * sx, 0.12, -0.045, 0.2 * sx, -1, -0.15, 0.135, 0.034);
    lock(0.138 * sx, 0.12, 0.03, 0.3 * sx, -1, 0.1, 0.11, 0.036);
  }
  if (HL.hairStyle === 'spiky') {
    // 頭頂往後翹的刺刺髮束
    const tops = [[-0.06, 0.0, 0.1], [0.06, 0.0, 0.1], [0, 0.04, 0.115], [-0.075, 0.08, 0.1], [0.075, 0.08, 0.1]];
    for (const [x, z, len] of tops) lock(x, 0.19, z, x * 4, 0.75, 1 + z * 2, len, 0.048);
    // 呆毛：頭頂一撮往前翹
    lock(0.01, 0.215, -0.02, 0.1, 1, -0.6, 0.075, 0.016, 1).rotation.z += 0.2;
  }
  if (HL.hairStyle !== 'bob') {
    // 後腦：往下、往後翹的髮尾
    for (const x of [-0.09, -0.03, 0.03, 0.09]) lock(x, 0.1, 0.12, x * 2.5, -0.35, 1, 0.12, 0.04);
    for (const x of [-0.06, 0, 0.06]) lock(x, 0.02, 0.12, x * 2, -1, 0.55, 0.11, 0.036);
  }
  if (HL.hairStyle === 'ponytail') {
    add(new THREE.SphereGeometry(0.035, 10, 8), acc, 0, 0.13, 0.155);
    lock(0, 0.13, 0.17, 0, -0.5, 1, 0.24, 0.05);
    lock(0, 0.11, 0.17, 0.25, -0.9, 0.7, 0.2, 0.04);
  } else if (HL.hairStyle === 'bob') {
    for (let i = 0; i < 9; i++) {
      const a = Math.PI * (0.2 + (i / 8) * 1.6); // 側邊到後面一圈
      const x = Math.cos(a) * 0.14, z = Math.sin(a) * 0.14 + 0.01;
      lock(x, 0.1, z, x * 2, -1, z * 2, 0.17, 0.05);
    }
  }
  // 配件
  if (HL.accessory === 'goggles') {
    add(new THREE.TorusGeometry(0.15, 0.012, 6, 24), acc, 0, 0.13, 0, Math.PI / 2 - 0.25, 0, 0);
    for (const sx of [-1, 1]) add(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 12), new THREE.MeshStandardMaterial({ color: '#9fd8f5', metalness: 0.3, roughness: 0.2 }), 0.045 * sx, 0.165, -0.13, Math.PI / 2 + 0.6, 0, 0);
  } else if (HL.accessory === 'headband') {
    add(new THREE.TorusGeometry(0.145, 0.014, 6, 24), acc, 0, 0.11, 0, Math.PI / 2 - 0.12, 0, 0);
  } else if (HL.accessory === 'scarf') {
    // 圍巾：脖子一圈＋往後飄的兩條尾巴
    const s = add(new THREE.TorusGeometry(0.075, 0.032, 8, 18), acc, 0, -0.085, 0, Math.PI / 2, 0, 0);
    s.scale.set(1, 1, 0.9);
    const tail = add(new THREE.BoxGeometry(0.055, 0.16, 0.02), acc, 0.04, -0.15, 0.085, 0.6, 0, 0.2);
    tail.userData.scarfTail = true;
    const tail2 = add(new THREE.BoxGeometry(0.045, 0.12, 0.02), acc, -0.01, -0.14, 0.09, 0.5, 0, -0.15);
    tail2.userData.scarfTail = true;
  }
}

export class PlayerModel {
  constructor(scene, cfg = {}) {
    const toon = cfg.style === 'toon';
    const HL = toon ? cfg.hero : null; // 卡通畫風的外觀設定
    const skin = makeMat(toon, { color: HL ? HL.skin : '#e7c3a0', roughness: 0.7 });
    if (HL) skin.emissive.set(HL.skin).multiplyScalar(0.26); // 卡通膚色亮一點，不會灰灰的
    const jacket = makeMat(toon, { color: HL ? HL.jacket : '#7a5a3a', roughness: 0.8 });
    const pants = makeMat(toon, { color: HL ? HL.pants : '#e8e2d2', roughness: 0.9 });
    const boots = makeMat(toon, { color: HL ? HL.boots : '#2b211b', roughness: 0.6 });
    const cape = makeMat(toon, { color: HL ? HL.cape : '#2f5d3a', roughness: 0.9, side: THREE.DoubleSide });
    const metal = new THREE.MeshStandardMaterial({ color: '#a8b0b8', metalness: 0.85, roughness: 0.3 });
    const blade = new THREE.MeshStandardMaterial({ color: '#e6eef6', metalness: 0.95, roughness: 0.12, emissive: '#1a2533', envMapIntensity: 1.6 });
    const leather = makeMat(toon, { color: '#3a2a1e', roughness: 0.75 });
    const darkMetal = new THREE.MeshStandardMaterial({ color: '#4d555e', metalness: 0.8, roughness: 0.35 });
    const edge = new THREE.MeshBasicMaterial({ color: '#dff4ff', transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
    this.metalMats = [metal, blade, darkMetal];
    const hair = makeMat(toon, { color: HL ? HL.hair : '#2a2018', roughness: 0.9 });
    this.bodyMats = [skin, jacket, pants, boots, cape, hair]; // 兵長斬時全身發紅光

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
    this.head.add(mesh(new THREE.SphereGeometry(0.14, 16, 12), skin, 0, 0.06, 0));
    if (HL) buildToonHead(this.head, HL, skin, hair);
    else this.head.add(mesh(new THREE.SphereGeometry(0.15, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), hair, 0, 0.09, 0.01));

    // 腰間發射器
    this.launcherL = mesh(new THREE.BoxGeometry(0.12, 0.16, 0.34), metal, 0.3, 0.05, 0);
    this.launcherR = mesh(new THREE.BoxGeometry(0.12, 0.16, 0.34), metal, -0.3, 0.05, 0);
    this.hips.add(this.launcherL, this.launcherR);
    // 立體機動裝置：腰後兩側的氣罐（含閥門）＋刀箱、腰間鋼索盒的捲筒與噴嘴
    const tank = new THREE.CylinderGeometry(0.085, 0.085, 0.56, 10).rotateX(Math.PI / 2);
    const tankCap = new THREE.SphereGeometry(0.085, 8, 6);
    for (const sx of [1, -1]) {
      this.hips.add(mesh(tank, metal, 0.27 * sx, 0.14, 0.16));
      this.hips.add(mesh(tankCap, metal, 0.27 * sx, 0.14, 0.44), mesh(tankCap, metal, 0.27 * sx, 0.14, -0.12));
      this.hips.add(mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.1, 6), darkMetal, 0.27 * sx, 0.24, 0.3)); // 閥門
      this.hips.add(mesh(new THREE.BoxGeometry(0.13, 0.24, 0.62), darkMetal, 0.36 * sx, -0.08, 0.1)); // 刀箱
      this.hips.add(mesh(new THREE.BoxGeometry(0.135, 0.03, 0.63), leather, 0.36 * sx, 0.0, 0.1)); // 刀箱綁帶
      // 鋼索盒的捲筒＋往前的噴嘴
      this.hips.add(mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.07, 12).rotateZ(Math.PI / 2), darkMetal, 0.37 * sx, 0.05, -0.02));
      this.hips.add(mesh(new THREE.ConeGeometry(0.035, 0.12, 6).rotateX(-Math.PI / 2), darkMetal, 0.3 * sx, 0.05, -0.22));
    }
    // 皮帶：胸前 X 字、肩帶、腰帶
    for (const sx of [1, -1]) {
      const strap = mesh(new THREE.BoxGeometry(0.05, 0.62, 0.03), leather, 0.06 * sx, 0.42, -0.2);
      strap.rotation.z = 0.55 * sx;
      this.hips.add(strap);
      const back = mesh(new THREE.BoxGeometry(0.05, 0.62, 0.03), leather, 0.06 * sx, 0.42, 0.2);
      back.rotation.z = -0.55 * sx;
      this.hips.add(back);
    }
    this.hips.add(mesh(new THREE.TorusGeometry(0.215, 0.025, 6, 16).rotateX(Math.PI / 2), leather, 0, 0.14, 0));

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
      // 握把（扳機、護手）＋刀身＋刀刃反光條
      sword.add(mesh(new THREE.BoxGeometry(0.06, 0.12, 0.16), darkMetal, 0, 0, 0.02));
      sword.add(mesh(new THREE.BoxGeometry(0.02, 0.05, 0.05), metal, 0, -0.08, -0.02));
      sword.add(mesh(new THREE.BoxGeometry(0.09, 0.03, 0.03), metal, 0, 0, -0.07));
      const b = mesh(new THREE.BoxGeometry(0.015, 0.07, 0.95), blade, 0, 0, -0.55);
      sword.add(b);
      const e = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.012, 0.93), edge);
      e.position.set(0, 0.036, -0.55);
      sword.add(e);
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
      // 大腿綁帶
      hip.add(mesh(new THREE.TorusGeometry(0.085, 0.018, 6, 14).rotateX(Math.PI / 2), leather, 0, -0.18, 0));
      hip.add(mesh(new THREE.TorusGeometry(0.08, 0.018, 6, 14).rotateX(Math.PI / 2), leather, 0, -0.32, 0));
      this.hips.add(hip);
      return { hip, knee };
    };
    this.legL = makeLeg(-1);
    this.legR = makeLeg(1);

    // 披風（可擺動的頂點）
    const capeGeo = new THREE.PlaneGeometry(0.55, 0.85, 4, 6);
    capeGeo.translate(0, -0.42, 0);
    // 上窄下寬（像斗篷），下襬兩角往內收一點
    {
      const cp = capeGeo.attributes.position;
      for (let i = 0; i < cp.count; i++) {
        const d = -cp.getY(i) / 0.85;
        cp.setX(i, cp.getX(i) * (0.62 + 0.45 * d));
        if (d > 0.95) cp.setY(i, cp.getY(i) + Math.abs(cp.getX(i)) * 0.25);
      }
    }
    this.capeBase = capeGeo.attributes.position.array.slice();
    this.cape = mesh(capeGeo, cape, 0, 0.72, 0.17);
    this.hips.add(this.cape);

    // 卡通畫風：整個角色加深色描邊（臉上小零件、披風、刀刃不加）
    if (toon) {
      this.outlineMat = outlineMaterial(0.011, '#3b2a2e');
      addOutlines(this.root, this.outlineMat, (o) => o.userData.noOutline || !o.material.isMeshToonMaterial && !o.material.isMeshStandardMaterial || o.material === blade || o.material === cape || o.material === leather);
    }
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
    // 外層光暈（更大、更淡）
    this.aura2 = new THREE.Mesh(
      new THREE.SphereGeometry(1.15, 16, 12),
      new THREE.MeshBasicMaterial({ color: '#ff5a2a', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide }),
    );
    this.aura2.position.y = 0.2;
    this.aura2.visible = false;
    this.root.add(this.aura2);
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

  /** 金屬（刀身、裝置）的環境反射貼圖 */
  setEnvMap(tex) {
    for (const m of this.metalMats) {
      m.envMap = tex;
      m.needsUpdate = true;
    }
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
    // 轉身速度（往右轉為負）：拿來決定往彎內傾斜多少
    const yr = dt > 1e-5 ? (dy * Math.min(1, dt * 10)) / dt : 0;
    this.yawRate = (this.yawRate || 0) + (yr - (this.yawRate || 0)) * Math.min(1, dt * 10);

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
      // 地面奔跑：整體微微前傾（主要的彎腰在腰部）
      _q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.15 * Math.min(1, hs / 9));
    } else {
      _q.identity();
    }
    // 側傾：重心往彎內傾（右轉往右傾）。地面依轉向角度、空中依側向加速度（繞圈、擺盪時整個人斜躺）
    let bank = Math.max(-0.55, Math.min(0.55, this.yawRate * 0.26)) * Math.min(1, hs / 6);
    if (airborne && pc.accel) {
      const lat = pc.accel.x * Math.cos(this.yaw) - pc.accel.z * Math.sin(this.yaw);
      bank = Math.max(-1.1, Math.min(1.1, -lat / 26)) + bank * 0.5;
    }
    this.bank = bank;
    _q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), bank));
    this.lean.slerp(_q, Math.min(1, dt * 8));
    this.body.quaternion.copy(this.lean);
    if (this.leviMode) {
      // 兵長斬：以「身體自己的軸心」高速旋轉（軸心沿用出招當下身體的角度，和鋼索垂直或傾斜，不是順著鋼索鑽過去）
      if (!this._leviLean) this._leviLean = this.body.quaternion.clone();
      this.leviAngle += dt * (this.leviMode === 2 ? Math.PI * 9 : Math.PI * 2.5);
      this._spinQ.setFromAxisAngle(_up, this.leviAngle);
      this.body.quaternion.copy(this._leviLean).multiply(this._spinQ);
    } else this._leviLean = null;
    // 光暈＋全身發紅光：蓄力時脈動、直衝時最亮
    const glow = this.leviMode === 2 ? 1 : this.leviMode === 1 ? 0.6 + 0.25 * Math.sin(this.time * 30) : 0;
    this.leviGlow = (this.leviGlow || 0) + (glow - (this.leviGlow || 0)) * Math.min(1, dt * 14);
    const lg = this.leviGlow;
    this.aura.material.opacity = lg * 0.7;
    this.aura.visible = lg > 0.02;
    this.aura.scale.setScalar(1.3 + 0.15 * Math.sin(this.time * 40));
    this.aura2.material.opacity = lg * 0.35;
    this.aura2.visible = lg > 0.02;
    this.aura2.scale.setScalar(2.2 + 0.3 * Math.sin(this.time * 23));
    for (const m of this.bodyMats) {
      const b = m.userData.baseEm || (m.userData.baseEm = m.emissive.clone());
      m.emissive.setRGB(b.r + 0.9 * lg, b.g + 0.06 * lg, b.b + 0.08 * lg);
    }
    if (pc.flip && pc.flip.phase === 'tuck') {
      // 捲身翻轉：縮身往前翻一圈，翻完才爆衝
      const k = 1 - Math.max(0, pc.flip.t) / pc.flip.tuck;
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
    this.hips.rotation.x = 0;
    this.head.rotation.x = 0;
    if (pc.grounded && !pc.sliding && hs > 0.5) {
      // 迎風奔跑：上身往前彎到接近水平（頭在前上、腰在中、膝蓋與腳跟拖在後下），雙手握刀往後拖
      running = true;
      const k = Math.min(1, hs / 8);
      const ph = t * (hs * 1.0 + 5);
      const a = Math.sin(ph) * k * 0.6;
      const bend = 1.25 * k; // 腰往前彎（加上身體微傾，上身約 80°）
      this.hips.rotation.x = -bend;
      this.head.rotation.x = bend * 0.85; // 頭抬起來看前方
      // 腿：抵銷腰彎後整體往後下方斜（腳跟遠離腰），前後擺動
      const legBase = bend + 0.15 * k - 0.42 * k;
      L.hip.rotation.x = legBase + a;
      R.hip.rotation.x = legBase - a;
      L.knee.rotation.x = -(0.5 + Math.max(0, a) * 1.4) * k;
      R.knee.rotation.x = -(0.5 + Math.max(0, -a) * 1.4) * k;
      const bob = Math.sin(ph * 2) * 0.04 * k;
      // 手臂沿著背往後拖（上身彎下時「往下」就是往後）
      this.armL.shoulder.rotation.x = -0.15 + bob;
      this.armR.shoulder.rotation.x = -0.15 - bob;
      this.hips.position.y = 0.95 - 0.24 * k + Math.abs(Math.cos(ph)) * 0.05 * k;
    } else if (pc.sliding) {
      L.hip.rotation.x = 1.2;
      L.knee.rotation.x = -0.1;
      R.hip.rotation.x = -0.2;
      R.knee.rotation.x = -1.7;
      this.hips.position.y = 0.6;
      this.armL.shoulder.rotation.x = -0.6;
      this.armR.shoulder.rotation.x = -0.6;
    } else if (airborne && pc.flip?.phase === 'tuck') {
      // 捲身：膝蓋抱到胸前、手臂收起
      L.hip.rotation.x = R.hip.rotation.x = 1.9;
      L.knee.rotation.x = R.knee.rotation.x = -2.3;
      this.hips.position.y = 0.95;
      this.armL.shoulder.rotation.x = this.armR.shoulder.rotation.x = 0.9;
    } else if (airborne && (pc.dashing || pc.levi || pc.flip)) {
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
      // 手臂往兩側張開
      const k = Math.min(1, hs / 8);
      this.armL.shoulder.rotation.z = -0.3 - 0.35 * k;
      this.armR.shoulder.rotation.z = 0.3 + 0.35 * k;
      this.armL.fore.rotation.x = this.armR.fore.rotation.x = -0.15;
    }
    this._running = running;
    if (pc.sliding && hs > 6) {
      // 滑行／滑鏟：右手的刀壓低拖在地上（刮出火花）
      this.armR.shoulder.rotation.x = 0.35;
      this.armR.shoulder.rotation.z = 1.15;
      this.armR.fore.rotation.x = -0.15;
      this.armR.sword.rotation.x = -0.7;
    }

    // 兵長斬：雙手往兩側張開打直（刀和手臂連成一直線），雙腿併攏
    if (this.leviMode) {
      this.armL.shoulder.rotation.set(0, 0, -Math.PI / 2);
      this.armR.shoulder.rotation.set(0, 0, Math.PI / 2);
      this.armL.fore.rotation.x = this.armR.fore.rotation.x = 0;
      L.hip.rotation.x = R.hip.rotation.x = 0.1;
      L.knee.rotation.x = R.knee.rotation.x = -0.15;
      this.slashTimer = 0;
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

    // 刀的方向：刀身與身體垂直（往兩側伸出、刀尖略朝外下、略往後），跟著身體傾斜；
    // 轉彎往內傾時，內側的刀尖會壓向地面。揮砍、迴旋、滑行時交給動作本身
    const posing = this.slashTimer > 0 || this.spinTimer > 0 || (pc.sliding && hs > 6);
    if (!posing) {
      this.root.updateMatrixWorld(true);
      // 兵長斬：刀身順著手臂往外（一直線）
      const back = this.leviMode ? 0 : running ? 0.3 : airborne ? 0.45 : 0.15;
      const down = this.leviMode ? 0 : running ? 0.32 : airborne ? 0.15 : 0.7;
      this.body.getWorldQuaternion(_bq);
      for (const [arm, sx] of [[this.armL, -1], [this.armR, 1]]) {
        _bd.set(sx, -down, back).normalize().applyQuaternion(_bq); // 身體座標 → 世界
        arm.fore.getWorldQuaternion(_pq);
        _bd.applyQuaternion(_pq.invert()); // 世界 → 前臂座標
        arm.sword.quaternion.setFromUnitVectors(_NEG_Z, _bd);
      }
    } else {
      this.armL.sword.quaternion.identity();
      this.armR.sword.quaternion.identity();
      if (pc.sliding && hs > 6) this.armR.sword.rotation.x = -0.7;
    }

    // 披風：每一列是一個有彈性的擺（越下面越慢），被速度吹向後方、被側向移動吹向側邊、下墜時往上飄
    const pos = this.cape.geometry.attributes.position;
    const base = this.capeBase;
    const flutter = Math.min(1, speed / 35);
    const fwdX = -Math.sin(this.yaw), fwdZ = -Math.cos(this.yaw);
    const fs = v.x * fwdX + v.z * fwdZ; // 往前的速度
    const ls = v.x * -fwdZ + v.z * fwdX; // 往右的速度
    const cs = this.capeSim || (this.capeSim = { back: new Float32Array(8), side: new Float32Array(8), lift: new Float32Array(8), vb: new Float32Array(8), vs: new Float32Array(8), vl: new Float32Array(8) });
    const sdt = Math.min(dt, 1 / 30);
    for (let r = 0; r < 8; r++) {
      const d = r / 7;
      const k = 70 / (1 + r * 0.7);
      const c = 2 * Math.sqrt(k) * 0.35; // 欠阻尼：會擺動
      const tb = d * (0.12 + Math.max(0, Math.min(1, (Math.abs(fs) + Math.abs(v.y) * 0.5) / 35)) * 0.95);
      const ts = -Math.max(-1, Math.min(1, ls / 25)) * 0.45 * d;
      const tl = Math.max(0, Math.min(1, -v.y / 30)) * 0.5 * d;
      cs.vb[r] += (k * (tb - cs.back[r]) - c * cs.vb[r]) * sdt;
      cs.vs[r] += (k * (ts - cs.side[r]) - c * cs.vs[r]) * sdt;
      cs.vl[r] += (k * (tl - cs.lift[r]) - c * cs.vl[r]) * sdt;
      cs.back[r] += cs.vb[r] * sdt;
      cs.side[r] += cs.vs[r] * sdt;
      cs.lift[r] += cs.vl[r] * sdt;
    }
    for (let i = 0; i < pos.count; i++) {
      const by = base[i * 3 + 1];
      const bx = base[i * 3];
      const d = Math.max(0, -by / 0.85); // 0（上）~ 1（下）
      const rf = Math.min(6.999, d * 7);
      const r0 = Math.floor(rf), u = rf - r0;
      const lerp = (a) => a[r0] + (a[r0 + 1] - a[r0]) * u;
      const back = lerp(cs.back), side = lerp(cs.side), lift = lerp(cs.lift);
      const wave = Math.sin(t * (8 + flutter * 14) + d * 6 + bx * 3) * 0.05 * (0.3 + flutter) * d;
      pos.setXYZ(i, bx + side, by + back * 0.45 + lift, back + wave);
    }
    pos.needsUpdate = true;
    this.cape.geometry.computeVertexNormals();

    // 無敵時間閃爍
    this.root.visible = pc.invuln > 0 ? Math.sin(t * 40) > -0.3 : true;
  }
}
