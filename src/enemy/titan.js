// 巨型敵人：程序化模型、狀態機 AI（待機／追擊／揮擊／抓取／硬直／死亡）、後頸弱點，
// 部位效果（砍眼睛＝暈眩、砍腳＝跪下）、地盤範圍與建築碰撞、死亡後淡出。
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeMat, addOutlines, outlineMaterial } from '../fx/toon.js';

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
const _m4 = new THREE.Matrix4();
const _e = new THREE.Euler();

const SKINS = ['#d39a7c', '#c98f6f', '#e2b190', '#b9805f', '#d6a083', '#a87256', '#e8c0a0'];
const HAIRS = ['#3a2a1f', '#1e1a17', '#6b4a2b', '#c9a25a', '#8a3b1e', '#cfc6b4'];

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** 依名字＋位置決定外觀（每次載入都一樣、每隻不同）；spawn.look 的欄位優先 */
function makeLook(spawn, kind, dummy) {
  let seed = hashStr(`${spawn.name || ''}:${spawn.x}:${spawn.z}`);
  const rnd = () => ((seed = Math.imul(seed ^ (seed >>> 15), 2246822507) ^ Math.imul(seed ^ (seed >>> 13), 3266489909)) >>> 0) / 4294967296;
  const pick = (a) => a[Math.floor(rnd() * a.length) % a.length];
  const body = pick(['normal', 'normal', 'lanky', 'stocky']);
  let look = {
    body,
    girth: body === 'lanky' ? 0.78 : body === 'stocky' ? 1.25 : 1,
    torso: body === 'lanky' ? 0.86 : body === 'stocky' ? 1.15 : 1,
    belly: body === 'stocky' ? 1.3 : 1,
    headScale: 0.95 + rnd() * 0.15,
    eyeSize: 1,
    face: pick(['grin', 'grin', 'blank', 'angry']),
    hair: pick(['short', 'long', 'bald', 'messy']),
    tint: pick(SKINS),
    hairColor: pick(HAIRS),
  };
  if (kind === 'abnormal') {
    // 奇行種：瘦長、大頭、大眼、咧嘴笑
    Object.assign(look, { body: 'lanky', girth: 0.72, torso: 0.82, belly: 1, headScale: 1.3, eyeSize: 1.35, face: 'grin' });
  }
  if (kind === 'thrower') Object.assign(look, { body: 'lanky', girth: 0.85, torso: 0.9, belly: 1, face: 'angry', hair: look.hair === 'bald' ? 'messy' : look.hair });
  if (kind === 'armored') Object.assign(look, { body: 'stocky', girth: 1.2, torso: 1.15, belly: 1.05, face: 'blank', hair: 'short', tint: '#c8a68e' });
  if (kind === 'steam') Object.assign(look, { body: 'stocky', girth: 1.15, torso: 1.1, belly: 1.4, face: 'angry', hair: 'bald', tint: '#e48f7a' });
  if (dummy) Object.assign(look, { tint: '#a8764a', hair: 'bald', face: 'blank', hairColor: '#5a3a20', girth: 1, torso: 1, belly: 1 });
  if (spawn.tint) look.tint = spawn.tint;
  if (spawn.hair) look.hairColor = spawn.hair;
  return Object.assign(look, spawn.look || {});
}

export class Titan {
  /**
   * @param {{x:number, z:number, yaw?:number, scale?:number, homeRadius?:number, name?:string}} spawn
   */
  constructor(scene, cfg, spawn) {
    this.cfg = cfg;
    this.scene = scene;
    this.spawn = spawn;
    this.scale = spawn.scale ?? 1;
    this.name = spawn.name ?? '巨人';
    // 外觀：依名字與位置決定（固定、每隻不同），spawn.look 可以指定
    this.kind = spawn.kind ?? 'normal'; // 'normal' | 'abnormal'（奇行種）
    this.dummy = !!spawn.dummy; // 訓練用木人：木頭色、不會動、不會死（被砍到剩 1 血後自動恢復）
    const look = (this.look = makeLook(spawn, this.kind, this.dummy));
    const T0 = cfg.titan;
    const toon = (this.toon = cfg.style === 'toon'); // 卡通畫風：Q 版大頭、大眼、粉彩膚色、沒有肌肉線條
    const g = look.girth * (toon ? 1.15 : 1); // 四肢粗細（卡通版肉肉的）
    const gt = look.torso; // 軀幹寬度

    // 每隻巨人自己的材質（受擊閃紅、死亡淡出不會互相影響）
    const tint = toon ? '#' + new THREE.Color(look.tint).lerp(new THREE.Color('#fff1e6'), 0.42).getHexString() : look.tint;
    const flat = !toon;
    this.skin = makeMat(toon, { color: tint, roughness: toon ? 0.85 : 0.72, flatShading: flat, emissive: '#000000' });
    const shade = makeMat(toon, { color: new THREE.Color(tint).multiplyScalar(0.8), roughness: 0.8, flatShading: flat });
    const hairMat = makeMat(toon, { color: toon ? new THREE.Color(look.hairColor).lerp(new THREE.Color('#ffffff'), 0.12) : look.hairColor, roughness: toon ? 0.8 : 1, flatShading: flat });
    // 眼睛（eyeWorld 用）：寫實版是發光的眼珠；卡通版是黑色瞳孔（眼白另外做）
    this.eyeColors = toon ? ['#2a2233', '#c23a5a'] : ['#fff7d6', '#5a1010']; // [平常, 暈眩]
    this.eyeGlow = toon ? 0.05 : 0.6;
    this.eyeMat = makeMat(toon, { color: this.eyeColors[0], emissive: toon ? '#2a2233' : '#ffd27a', emissiveIntensity: this.eyeGlow, roughness: 0.3 });
    const socketMat = makeMat(toon, { color: new THREE.Color(tint).multiplyScalar(0.45), roughness: 1, flatShading: flat });
    const mouthMat = makeMat(toon, { color: toon ? '#8a3346' : '#3b1414', roughness: 1 });
    const toothMat = makeMat(toon, { color: '#f1ead8', roughness: 0.6 });
    this.napeMat = new THREE.MeshStandardMaterial({ color: '#ff6a2a', emissive: '#ff4a10', emissiveIntensity: 1.6, roughness: 0.4 });
    this.handMatR = this.skin.clone();
    this.handMatL = this.skin.clone();
    const whiteMat = makeMat(toon, { color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 0.25, roughness: 0.4 });
    const blushMat = makeMat(toon, { color: '#ff9db0', roughness: 0.9, transparent: true, opacity: 0.85 });
    const tongueMat = makeMat(toon, { color: '#ff7f94', roughness: 0.7 });
    // 卡通版穿一件粉彩短褲（顏色依名字固定）；木人不穿
    const SHORTS = ['#8fc9f0', '#f5a3b5', '#a8dba0', '#ffd27a', '#c3a8ec', '#ffb38a'];
    const shortsMat = makeMat(toon, { color: look.shorts || SHORTS[hashStr(this.name) % SHORTS.length], roughness: 0.85 });
    const wearShorts = toon && !this.dummy;
    this.materials = [this.skin, shade, hairMat, this.eyeMat, socketMat, mouthMat, toothMat, this.napeMat, this.handMatR, this.handMatL, whiteMat, blushMat, tongueMat, shortsMat];

    // 同一個關節、同一種材質的零件合併成一個網格（手機上 draw call 少很多）
    const bins = new Map();
    const add = (group, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
      const gg = geo.index ? geo : geo.toNonIndexed();
      _m4.makeRotationFromEuler(_e.set(rx, ry, rz)).setPosition(x, y, z);
      gg.applyMatrix4(_m4);
      const key = group.uuid + mat.uuid;
      if (!bins.has(key)) bins.set(key, { group, mat, geos: [] });
      bins.get(key).geos.push(gg);
    };
    const flush = () => {
      for (const { group, mat, geos } of bins.values()) {
        for (const gg of geos) for (const k of Object.keys(gg.attributes)) if (!['position', 'normal', 'uv'].includes(k)) gg.deleteAttribute(k);
        const m = new THREE.Mesh(mergeGeometries(geos), mat);
        m.castShadow = m.receiveShadow = true;
        group.add(m);
      }
      bins.clear();
    };
    const sph = (r, ws = 10, hs = 8) => new THREE.SphereGeometry(r, ws, hs);
    const cap = (r, l) => new THREE.CapsuleGeometry(r, l, 4, 8);

    this.root = new THREE.Group();
    this.root.scale.setScalar(this.scale);
    this.fall = new THREE.Group();
    this.root.add(this.fall);
    this.pelvis = new THREE.Group();
    this.pelvis.position.y = 9;
    this.fall.add(this.pelvis);
    add(this.pelvis, sph(2.4, 14, 10).scale(1.15 * gt, 0.8, 0.9 * gt), wearShorts ? shortsMat : this.skin);

    const leg = (sx) => {
      const hip = new THREE.Group();
      hip.position.set(1.4 * sx, -0.4, 0);
      const knee = new THREE.Group();
      knee.position.y = -4.4;
      hip.add(knee);
      this.pelvis.add(hip);
      add(hip, cap(1.15 * g, 3.0), this.skin, 0, -2.2, 0);
      if (wearShorts) add(hip, cap(1.32 * g, 0.9), shortsMat, 0, -0.9, 0); // 短褲褲管
      if (!toon) {
        add(hip, sph(1.0 * g, 8, 6).scale(1, 1.6, 0.8), shade, 0.15 * sx, -2.0, 0.55 * g); // 大腿前側肌肉
        add(knee, sph(0.55 * g, 8, 6), shade, 0, 0.1, 0.75 * g); // 膝蓋骨
        add(knee, sph(0.85 * g, 8, 6).scale(1, 1.5, 0.9), shade, 0, -1.4, -0.45 * g); // 小腿肚
      }
      add(knee, cap(0.95 * g, 3.0), this.skin, 0, -2.1, 0);
      if (toon) add(knee, sph(1.0 * g, 10, 8).scale(1, 0.55, 1.5), this.skin, 0, -4.0, 0.6); // 圓圓的腳丫
      else add(knee, new THREE.BoxGeometry(1.7 * g, 0.7, 2.8), this.skin, 0, -4.0, 0.6);
      for (let i = 0; i < 4; i++) add(knee, sph(0.22, 6, 4), this.skin, (-0.55 + i * 0.37) * g, -4.15, 2.0); // 腳趾
      return { hip, knee };
    };
    this.legL = leg(1);
    this.legR = leg(-1);

    this.spine = new THREE.Group();
    this.spine.position.y = 0.6;
    this.pelvis.add(this.spine);
    add(this.spine, cap(2.3, 2.4).scale(1.15 * gt * look.belly, 1, 0.8 * look.belly), this.skin, 0, 2.4, 0);
    this.chest = new THREE.Group();
    this.chest.position.y = 4.6;
    this.spine.add(this.chest);
    add(this.chest, sph(2.9, 12, 10).scale(1.2 * gt, 0.85, 0.85 * gt), this.skin, 0, 0.6, 0);
    // 胸肌、鎖骨
    for (const sx of toon ? [] : [1, -1]) {
      add(this.chest, sph(1.4, 10, 6).scale(1.2 * gt, 0.55, 0.3), shade, 1.15 * sx * gt, 0.75, 2.15 * gt);
      add(this.chest, cap(0.18, 2.0), shade, 1.25 * sx * gt, 1.75, 1.75 * gt, 0, 0, Math.PI / 2 - 0.25 * sx);
    }
    // 腹肌（六塊）＋肚臍
    if (look.belly < 1.2 && !toon) {
      for (let i = 0; i < 3; i++) {
        for (const sx of [1, -1]) add(this.spine, new THREE.BoxGeometry(0.9, 0.72, 0.3), shade, 0.52 * sx * gt, 1.05 + i * 0.9, 1.78 * gt);
      }
    }
    add(this.spine, sph(0.16, 6, 4), socketMat, 0, 0.55, 1.9 * gt * look.belly);

    const arm = (sx, handMat) => {
      const shoulder = new THREE.Group();
      shoulder.position.set(3.4 * sx, 1.2, 0);
      const elbow = new THREE.Group();
      elbow.position.y = -4.1;
      shoulder.add(elbow);
      this.chest.add(shoulder);
      add(shoulder, sph(1.3 * g, 8, 6), this.skin); // 三角肌
      add(shoulder, cap(0.9 * g, 2.6), this.skin, 0, -2.1, 0);
      if (!toon) add(shoulder, sph(0.75 * g, 8, 6).scale(1, 1.4, 1), shade, 0, -1.7, 0.45 * g); // 二頭肌
      add(elbow, cap(0.8 * g, 2.6), this.skin, 0, -1.9, 0);
      if (!toon) add(elbow, sph(0.75 * g, 8, 6).scale(1, 1.3, 0.9), shade, 0, -0.9, 0.2 * g); // 前臂肌肉
      const hand = new THREE.Mesh(sph(1.2, 8, 6).scale(1, 1.3, 0.7), handMat);
      hand.position.set(0, -4.2, 0);
      hand.castShadow = true;
      elbow.add(hand);
      for (let i = 0; i < 4; i++) add(elbow, cap(0.2, 0.9), handMat, (-0.6 + i * 0.4) * sx, -5.6, 0.15); // 手指
      add(elbow, cap(0.22, 0.7), handMat, 0.95 * sx, -4.6, 0.5, 0.5, 0, 0.6 * sx); // 拇指
      return { shoulder, elbow, hand };
    };
    this.armL = arm(1, this.handMatL); // 巨人自己的左手（模型 +X）：抓取
    this.armR = arm(-1, this.handMatR); // 右手：揮擊

    this.neck = new THREE.Group();
    this.neck.position.y = 2.6;
    this.chest.add(this.neck);
    add(this.neck, cap(1.05 * Math.min(1.15, g), 1.0), this.skin, 0, 0.6, 0);
    this.head = new THREE.Group();
    // 卡通版：大頭（Q 版），頭往上抬，讓後頸弱點露出來、不會被大頭蓋住
    const hs = look.headScale * (toon ? 1.8 : 1);
    this.head.position.y = toon ? 1.9 + (hs - 1) * 2 : 1.9;
    this.head.scale.setScalar(hs);
    this.neck.add(this.head);
    const H = this.head;
    add(H, toon ? sph(1.75, 18, 14).scale(1.05, 1.08, 1.02) : sph(1.75, 12, 10).scale(1, 1.15, 1.05), this.skin, 0, 0.6, 0);
    if (toon) {
      this._toonFace(H, look, add, { hairMat, mouthMat, whiteMat, blushMat, tongueMat });
    } else {
      add(H, sph(0.45, 6, 4).scale(0.5, 1, 0.8), this.skin, 1.72, 0.6, 0); // 耳朵
      add(H, sph(0.45, 6, 4).scale(0.5, 1, 0.8), this.skin, -1.72, 0.6, 0);
      add(H, new THREE.ConeGeometry(0.32, 0.8, 4).rotateX(Math.PI / 2 + 0.25), this.skin, 0, 0.35, 1.9); // 鼻子
      add(H, sph(0.55, 8, 6).scale(1.4, 0.7, 0.6), this.skin, 0, -0.75, 1.45); // 下巴
      // 眼窩（深色）＋眼睛（發光，eyeWorld 用）
      for (const sx of [1, -1]) add(H, sph(0.46, 8, 6).scale(1.2, 0.85, 0.5), socketMat, 0.6 * sx, 0.85, 1.5);
      const eye = new THREE.SphereGeometry(0.32 * look.eyeSize, 8, 6);
      this.eyes = [part(eye, this.eyeMat, 0.6, 0.85, 1.6), part(eye, this.eyeMat, -0.6, 0.85, 1.6)];
      H.add(...this.eyes);
      // 眉毛：表情
      const browTilt = look.face === 'angry' ? 0.38 : look.face === 'grin' ? -0.15 : 0.05;
      const browY = look.face === 'grin' ? 1.38 : 1.25;
      for (const sx of [1, -1]) add(H, new THREE.BoxGeometry(0.85, 0.16, 0.25), hairMat, 0.62 * sx, browY, 1.62, 0, 0, browTilt * sx);
      // 嘴巴
      if (look.face === 'grin') {
        // 咧到耳邊的笑：沿著上揚的弧線排一排牙齒
        const N = 9;
        for (let i = 0; i < N; i++) {
          const u = i / (N - 1) - 0.5;
          const x = u * 2.6;
          const y = -0.2 + u * u * 1.4;
          const z = 1.62 - u * u * 0.9;
          add(H, new THREE.BoxGeometry(0.34, 0.42, 0.25), mouthMat, x, y, z);
          add(H, new THREE.BoxGeometry(0.24, 0.17, 0.2), toothMat, x, y + 0.1, z + 0.08);
          add(H, new THREE.BoxGeometry(0.24, 0.15, 0.2), toothMat, x, y - 0.11, z + 0.08);
        }
      } else if (look.face === 'angry') {
        add(H, new THREE.BoxGeometry(1.4, 0.75, 0.35), mouthMat, 0, -0.25, 1.6);
        add(H, new THREE.BoxGeometry(1.25, 0.16, 0.25), toothMat, 0, 0.05, 1.72);
        add(H, new THREE.BoxGeometry(1.25, 0.16, 0.25), toothMat, 0, -0.55, 1.72);
      } else {
        add(H, new THREE.BoxGeometry(1.3, 0.16, 0.3), mouthMat, 0, -0.2, 1.65);
      }
    }
    // 頭髮
    if (look.hair !== 'bald') add(H, new THREE.SphereGeometry(1.85, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.5).scale(1, 1.1, 1.1), hairMat, 0, 0.75, -0.1);
    if (toon && look.hair !== 'bald') {
      // 卡通瀏海：額頭上三團圓圓的頭髮
      for (const [x, sc] of [[-0.75, 0.9], [0, 1.05], [0.75, 0.9]]) add(H, sph(0.62 * sc, 10, 8).scale(1.25, 0.75, 0.6), hairMat, x, 1.92 - Math.abs(x) * 0.2, 1.12 - Math.abs(x) * 0.3);
    }
    if (look.hair === 'long' && toon) {
      // 卡通長髮：後腦垂下來的圓弧髮片＋兩側垂到肩膀的髮束
      add(H, new THREE.SphereGeometry(1.92, 16, 12, Math.PI, Math.PI, Math.PI * 0.25, Math.PI * 0.7).scale(1.05, 1.45, 1.08), hairMat, 0, 0.35, -0.05);
      for (const sx of [1, -1]) add(H, cap(0.48, 2.0).scale(1, 1, 0.8), hairMat, 1.72 * sx, -0.25, 0.35, 0, 0, 0.08 * sx);
    } else if (look.hair === 'long') {
      add(H, new THREE.BoxGeometry(3.2, 3.2, 0.5), hairMat, 0, -0.4, -1.55);
      for (const sx of [1, -1]) add(H, new THREE.BoxGeometry(0.5, 2.6, 1.6), hairMat, 1.75 * sx, -0.1, -0.3);
    } else if (look.hair === 'messy') {
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        add(H, new THREE.ConeGeometry(0.45, 1.3, 5), hairMat, Math.sin(a) * 1.3, 2.25, Math.cos(a) * 1.1 - 0.2, Math.cos(a) * 0.7, 0, -Math.sin(a) * 0.7);
      }
    }
    // 種類專屬的外觀
    if (this.kind === 'thrower') {
      // 頭帶＋手上（舉起時才出現）的石頭
      add(H, new THREE.TorusGeometry(1.82, 0.16, 6, 28).rotateX(Math.PI / 2), makeMat(toon, { color: '#e2574c' }), 0, 1.25, 0);
      add(H, new THREE.BoxGeometry(0.5, 0.9, 0.15), makeMat(toon, { color: '#e2574c' }), 0.3, 1.0, -1.85, 0.3, 0, 0.4);
    }
    if (this.kind === 'armored') {
      // 水晶鎧甲：肩甲、胸甲、前臂護甲（後頸的鎧甲另外做，會被砍碎）
      this.armorMat = makeMat(toon, { color: toon ? '#9fd4ff' : '#b8c6d4', emissive: toon ? '#3a7fc0' : '#1a2430', emissiveIntensity: 0.35, roughness: 0.3, metalness: 0.4 });
      for (const arm of [this.armL, this.armR]) {
        add(arm.shoulder, new THREE.SphereGeometry(1.55 * g, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), this.armorMat, 0, 0.15, 0);
        add(arm.elbow, cap(0.95 * g, 1.6), this.armorMat, 0, -2.2, 0);
      }
      add(this.chest, sph(2.95, 14, 10).scale(1.18 * gt, 0.6, 0.55 * gt), this.armorMat, 0, 0.9, 0.75 * gt);
      this.materials.push(this.armorMat);
    }
    if (this.kind === 'steam') {
      // 背上的散熱孔（噴蒸氣的地方）
      const ventMat = makeMat(toon, { color: '#7a3b33' });
      for (const sx of [1, -1]) for (const y of [0.4, 1.4]) add(this.chest, sph(0.45, 8, 6).scale(1, 0.6, 0.4), ventMat, 1.1 * sx * gt, y, -2.2 * gt);
      this.materials.push(ventMat);
    }
    flush();
    if (this.kind === 'thrower') {
      this.rockMat = makeMat(toon, { color: toon ? '#b9a48e' : '#7d7266', flatShading: true });
      this.materials.push(this.rockMat);
      this.heldRock = new THREE.Mesh(new THREE.IcosahedronGeometry(T0.thrower.rockRadius / Math.max(0.5, this.scale), 0), this.rockMat);
      this.heldRock.position.set(0, -4.6, 0.8);
      this.heldRock.visible = false;
      this.armR.elbow.add(this.heldRock);
    }

    // 弱點：後頸發光區（巨人面向 +Z，背後為 -Z）。不用點光源（多隻巨人時手機吃不消），靠自發光
    this.nape = part(new THREE.SphereGeometry(1, 16, 12).scale(1.0, 0.75, 0.45), this.napeMat, 0, toon ? 0.9 : 1.0, toon ? -1.2 : -0.95);
    this.nape.castShadow = false;
    this.nape.userData.nape = true;
    this.neck.add(this.nape);
    if (this.kind === 'armored') {
      // 後頸鎧甲：蓋住弱點，砍碎之前弱點幾乎無效
      this.napeArmor = new THREE.Mesh(new THREE.SphereGeometry(1.35, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.6).rotateX(-Math.PI / 2).scale(1.15, 1.0, 0.75), this.armorMat);
      this.napeArmor.position.copy(this.nape.position);
      this.napeArmor.position.z -= 0.15;
      this.napeArmor.userData.armor = true;
      this.neck.add(this.napeArmor);
    }

    scene.add(this.root);
    this.root.traverse((o) => {
      if (o.isMesh) {
        o.userData.titanPart = true;
        o.userData.titan = this;
      }
    });
    // 卡通畫風：身體、頭髮、短褲加深色描邊（臉上的小零件、後頸弱點不加）
    if (toon) {
      this.outlineMat = outlineMaterial(0.07, '#4a2f36');
      const noLine = new Set([this.eyeMat, whiteMat, blushMat, tongueMat, mouthMat, this.napeMat]);
      addOutlines(this.root, this.outlineMat, (o) => noLine.has(o.material));
      this.materials.push(this.outlineMat);
    }

    // 碰撞球（相對各部位，半徑為未縮放值）
    // 依體型調整：四肢 × 粗細、軀幹 × 寬度、頭 × 頭的大小
    this.sphereDefs = [
      [this.pelvis, 0, 0, 0, 2.5 * gt],
      [this.spine, 0, 2.4, 0, 2.6 * gt * look.belly],
      [this.chest, 0, 0.6, 0, 3.0 * gt],
      [this.head, 0, 0.6, 0, 1.9 * hs],
      [this.legL.hip, 0, -2.2, 0, 1.3 * g], [this.legR.hip, 0, -2.2, 0, 1.3 * g],
      [this.legL.knee, 0, -2.1, 0, 1.1 * g], [this.legR.knee, 0, -2.1, 0, 1.1 * g],
      [this.armL.shoulder, 0, -2.1, 0, 1.0 * g], [this.armR.shoulder, 0, -2.1, 0, 1.0 * g],
      [this.armL.elbow, 0, -1.9, 0, 0.9 * g], [this.armR.elbow, 0, -1.9, 0, 0.9 * g],
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
    this.regenTimer = 0;
    this.leap = null;
    this.leapHit = false;
    // 種類專屬狀態
    this.armor = this.kind === 'armored' ? T.armored.plates : 0;
    if (this.napeArmor) this.napeArmor.visible = true;
    for (const r of this.rocks || []) this.scene.remove(r.mesh);
    this.rocks = [];
    if (this.heldRock) this.heldRock.visible = false;
    this.steamT = this.kind === 'steam' ? T.steam.interval * 0.6 : 0;
    this.steamPhase = 'idle'; // idle | charge | burst
    this.steamHitDone = false;
    for (const w of this.wounds || []) w.mesh.parent?.remove(w.mesh);
    this.wounds = [];
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

  /** 卡通版的臉：大眼睛（眼白＋黑瞳孔＋高光）、腮紅、小鼻子、可愛嘴型；奇行種是鬥雞眼＋吐舌頭 */
  _toonFace(H, look, add, { hairMat, mouthMat, whiteMat, blushMat, tongueMat }) {
    const sph = (r, ws = 12, hs = 10) => new THREE.SphereGeometry(r, ws, hs);
    const es = look.eyeSize;
    const odd = this.kind === 'abnormal';
    add(H, sph(0.16, 8, 6), this.skin, 0, 0.32, 1.8); // 小鼻子
    for (const sx of [1, -1]) add(H, sph(0.42, 8, 6).scale(0.55, 1, 0.8), this.skin, 1.8 * sx, 0.55, 0); // 耳朵
    // 眼白
    const sr = (odd ? 0.68 : 0.55) * es;
    for (const sx of [1, -1]) add(H, sph(sr).scale(0.85, 1.1, 0.5), whiteMat, 0.68 * sx, 0.78, 1.5);
    // 瞳孔（eyeWorld 用的眼睛）：奇行種的瞳孔小小的、各看各的
    const pr = (odd ? 0.2 : 0.32) * es;
    const off = odd ? [[0.14, 0.16], [-0.1, -0.14]] : [[0, -0.04], [0, -0.04]];
    const pupil = sph(pr).scale(1, 1.15, 0.45);
    this.eyes = [0.68, -0.68].map((x, i) => part(pupil, this.eyeMat, x + off[i][0], 0.78 + off[i][1], 1.5 + sr * 0.5 * 0.9 + 0.02));
    H.add(...this.eyes);
    for (let i = 0; i < 2; i++) {
      const e = this.eyes[i].position;
      add(H, sph(pr * 0.35, 8, 6), whiteMat, e.x + pr * 0.35, e.y + pr * 0.45, e.z + pr * 0.4); // 高光
    }
    // 腮紅
    for (const sx of [1, -1]) add(H, sph(0.38, 10, 8).scale(1.2, 0.6, 0.25), blushMat, 1.1 * sx, 0.12, 1.38);
    // 嘴巴
    if (look.face === 'grin') {
      // 張嘴笑（Ｄ字形）＋小舌頭
      add(H, new THREE.SphereGeometry(0.55, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).scale(1.2, 0.9, 0.35), mouthMat, 0, -0.12, 1.6);
      add(H, sph(0.3, 10, 6).scale(1.2, 0.55, 0.4), tongueMat, 0, -0.46, 1.68);
      if (odd) add(H, new THREE.CapsuleGeometry(0.22, 0.6, 4, 8), tongueMat, 0.3, -0.95, 1.78, 0.25, 0, 0.25); // 吐舌頭
    } else if (look.face === 'angry') {
      // 嘟起來的小 o 嘴＋皺眉
      add(H, sph(0.28, 10, 8).scale(1.2, 0.85, 0.4), mouthMat, 0, -0.25, 1.72);
      for (const sx of [1, -1]) add(H, new THREE.CapsuleGeometry(0.09, 0.55, 4, 6), hairMat, 0.66 * sx, 1.42, 1.66, 0, 0, Math.PI / 2 + 0.4 * sx);
    } else {
      // 小小的微笑
      add(H, new THREE.TorusGeometry(0.3, 0.07, 6, 14, Math.PI), mouthMat, 0, -0.08, 1.76, 0, 0, Math.PI);
    }
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

  /** 在命中點留下傷口（附著在最近的身體部位上，跟著動、會冒蒸氣，約 15 秒後淡掉） */
  addWound(point, size = 1) {
    let best = this.fall, bd = Infinity;
    for (const g of [this.neck, this.head, this.chest, this.pelvis, this.legL.hip, this.legL.knee, this.legR.hip, this.legR.knee]) {
      const d = g.getWorldPosition(_v).distanceTo(point);
      if (d < bd) {
        bd = d;
        best = g;
      }
    }
    const mat = new THREE.MeshBasicMaterial({ color: '#7a0d0d', transparent: true, opacity: 0.95, depthWrite: false });
    const m = new THREE.Mesh(this._woundGeo || (this._woundGeo = new THREE.SphereGeometry(0.7, 8, 6)), mat);
    best.worldToLocal(m.position.copy(point));
    m.scale.set(size * (0.8 + Math.random() * 0.6), size * 0.35, size * (0.8 + Math.random() * 0.6));
    m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    m.userData.noHook = true;
    best.add(m);
    this.wounds.push({ mesh: m, t: 15 });
    if (this.wounds.length > 10) {
      const old = this.wounds.shift();
      old.mesh.parent?.remove(old.mesh);
    }
  }

  /**
   * 受擊反應：第一格就甩到最大，再帶過衝彈回（約 0.6 秒）。
   * dir＝刀路方向（世界座標），kind：'nape' 頭往前栽、'eye' 頭往後仰、'leg' 往那一側歪、'body' 小晃
   */
  reactHit(dir, kind = 'body', strength = 1) {
    const side = dir ? Math.sign(dir.x * this.forward.z - dir.z * this.forward.x) || 1 : 1;
    const A = { nape: [0.55, 0.22, 0.28], eye: [-0.5, -0.12, 0.18], leg: [0.12, 0.1, 0.3], body: [0.14, 0.06, 0.1] }[kind] || [0.14, 0.06, 0.1];
    this.react = { t: 0, neckX: A[0] * strength, spineX: A[1] * strength, roll: A[2] * strength * side, yaw: 0.25 * strength * side };
  }

  takeHit(damage, isNape) {
    if (!this.alive) return;
    if (isNape && this.armor > 0) {
      // 鎧甲巨人：先砍碎後頸的鎧甲
      this.armor--;
      damage *= this.cfg.titan.armored.damageScale;
      if (this.armor === 0) {
        this.napeArmor.visible = false;
        this.events.push({ type: 'armorBreak' });
      } else this.events.push({ type: 'armorHit', left: this.armor });
    }
    this.hp = Math.max(this.dummy ? 1 : 0, this.hp - damage);
    this.regenTimer = 2.5;
    this.hitFlash = isNape ? 0.45 : 0.3;
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
    this.hp = Math.max(this.dummy ? 1 : 0, this.hp - damage);
    this.regenTimer = 2.5;
    this.hitFlash = 0.35;
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

    if (this.dummy) {
      // 木人：只回血、做受擊與跪下的姿勢，不追擊、不攻擊
      if (this.regenTimer > 0 && (this.regenTimer -= dt) <= 0) this.hp = T.hp;
      this.state = 'idle';
      this.updatePose(dt, player);
      this.root.updateMatrixWorld(true);
      this._updateSpheres();
      return;
    }

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
        if (this.kind === 'abnormal' && !kneeling && this._abnormalMove(dt, player, aggro, dist, targetYaw)) break;
        if (this.kind === 'thrower' && !kneeling && this._throwerMove(player, dist, facing, stunned, turn)) break;
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
          _v.set(this.forward.x, 0, this.forward.z).multiplyScalar(T.walkSpeed * S * dt * (this.kind === 'armored' ? T.armored.walkFactor : 1));
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
      case 'pounceWindup': {
        // 奇行種：蹲低預備，快速轉向玩家
        const A = T.abnormal;
        turn(A.turnRate * 1.5);
        if (stunned) this.setState('idle');
        else if (this.stateTime >= A.windup) {
          // 預判玩家位置，撲過去（拋物線）
          _v.set(player.pos.x + player.vel.x * 0.35, 0, player.pos.z + player.vel.z * 0.35);
          _v2.set(_v.x - pos.x, 0, _v.z - pos.z);
          const d0 = Math.min(_v2.length(), A.pounceRange * S * 1.2);
          _v2.setLength(Math.max(1, d0));
          const to = pos.clone().add(_v2);
          to.y = 0;
          // 落點不超出地盤（不然落地後會被拉回原位）
          const lim = (this.spawn.homeRadius ?? T.arenaRadius) * A.homeFactor;
          _v.set(to.x - this.spawn.x, 0, to.z - this.spawn.z);
          if (_v.length() > lim) to.set(this.spawn.x + _v.x * (lim / _v.length()), 0, this.spawn.z + _v.z * (lim / _v.length()));
          const leap = this._planLeap(pos.clone(), to, world?.colliders || []);
          this.leap = leap;
          this.leapHit = false;
          this.yaw = Math.atan2(_v2.x, _v2.z);
          this.setState('leap');
          this.events.push({ type: 'leap' });
        }
        break;
      }
      case 'leap': {
        const L = this.leap;
        L.t += dt;
        const u = Math.min(1, L.t / L.dur);
        pos.x = L.from.x + (L.to.x - L.from.x) * u;
        pos.z = L.from.z + (L.to.z - L.from.z) * u;
        pos.y = 4 * L.h * u * (1 - u);
        if (u >= 1) {
          pos.y = 0;
          this.leap = null;
          this.setState('landed');
          this.attackCooldown = T.abnormal.cooldown;
          this.events.push({ type: 'pounceLand' });
        }
        break;
      }
      case 'landed':
        if (this.stateTime >= T.abnormal.recover) this.setState('idle');
        break;
      case 'throwWindup':
        turn(T.turnRate * 1.2);
        if (stunned) {
          this.heldRock.visible = false;
          this.setState('idle');
        } else if (this.stateTime >= T.thrower.windup) {
          this._launchRock(player);
          this.setState('throw');
          this.events.push({ type: 'throw' });
        }
        break;
      case 'throw':
        if (this.stateTime >= 0.55) {
          this.setState('idle');
          this.attackCooldown = T.thrower.cooldown;
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
    if (this.rocks.length) this._updateRocks(dt, player, world);
    if (this.kind === 'steam') this._updateSteam(dt, player, dist);

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
    // 奇行種撲擊：飛撲途中身體任何部位撞到玩家，或落地瞬間玩家在落點附近
    if ((this.state === 'leap' || (this.state === 'landed' && this.stateTime < 0.1)) && !this.leapHit && player.hp > 0) {
      let hit = this.spheres.some((sp) => sp.center.distanceTo(player.pos) < sp.r + 1.2 * S);
      if (!hit && this.state === 'landed') {
        hit = Math.hypot(player.pos.x - pos.x, player.pos.z - pos.z) < T.abnormal.hitRadius * S * 1.3 && player.pos.y < 6 * S;
      }
      if (hit) {
        this.leapHit = true;
        _v2.set(player.pos.x - pos.x, 0, player.pos.z - pos.z).normalize().multiplyScalar(T.abnormal.knock);
        _v2.y = 10;
        this.events.push({ type: 'pounceHit', knock: _v2.clone() });
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

  /** 投石巨人：遠了就舉石頭丟，近了交給一般揮擊（回傳 true＝這一幀已處理） */
  _throwerMove(player, dist, facing, stunned, turn) {
    const A = this.cfg.titan.thrower;
    const S = this.scale;
    if (stunned || player.hp <= 0 || dist < A.minRange * S || dist > A.range * S) return false;
    turn(this.cfg.titan.turnRate * 1.2);
    if (this.state !== 'idle') this.setState('idle');
    if (this.attackCooldown <= 0 && facing > 0.6) {
      this.setState('throwWindup');
      this.heldRock.visible = true;
      this.events.push({ type: 'throwWindup' });
    }
    return true;
  }

  /** 丟石頭：預判玩家（照目前速度）飛行時間後的位置，算出拋物線初速 */
  _launchRock(player) {
    const A = this.cfg.titan.thrower;
    const from = this.heldRock.getWorldPosition(new THREE.Vector3());
    this.heldRock.visible = false;
    const target = new THREE.Vector3();
    let tFly = from.distanceTo(player.pos) / A.throwSpeed;
    for (let i = 0; i < 3; i++) {
      tFly = Math.max(0.5, Math.min(2.4, tFly));
      target.copy(player.pos).addScaledVector(player.vel, tFly * 0.8);
      target.y = Math.max(0.5, target.y);
      tFly = Math.hypot(target.x - from.x, target.z - from.z) / A.throwSpeed;
    }
    tFly = Math.max(0.5, Math.min(2.4, tFly));
    const vel = new THREE.Vector3((target.x - from.x) / tFly, (target.y - from.y) / tFly + 0.5 * A.gravity * tFly, (target.z - from.z) / tFly);
    const mesh = new THREE.Mesh(this.heldRock.geometry, this.rockMat);
    mesh.scale.setScalar(this.scale);
    mesh.position.copy(from);
    mesh.castShadow = true;
    if (this.outlineMat) {
      const ol = new THREE.Mesh(this.heldRock.geometry, this.outlineMat);
      ol.raycast = () => {};
      mesh.add(ol);
    }
    this.scene.add(mesh);
    this.rocks.push({ mesh, pos: mesh.position, vel, t: 0, spin: new THREE.Vector3(Math.random() * 6, Math.random() * 6, 0) });
  }

  _updateRocks(dt, player, world) {
    const A = this.cfg.titan.thrower;
    for (let i = this.rocks.length - 1; i >= 0; i--) {
      const r = this.rocks[i];
      r.t += dt;
      r.vel.y -= A.gravity * dt;
      r.pos.addScaledVector(r.vel, dt);
      r.mesh.rotation.x += r.spin.x * dt;
      r.mesh.rotation.y += r.spin.y * dt;
      let end = null;
      if (player.hp > 0 && r.pos.distanceTo(player.pos) < A.hitRadius) {
        _v2.copy(r.vel).setY(0).normalize().multiplyScalar(A.knock);
        _v2.y = 7;
        this.events.push({ type: 'rockHit', knock: _v2.clone(), pos: r.pos.clone() });
        end = 'hit';
      } else if (r.pos.y < A.rockRadius * 0.6) end = 'ground';
      else if (world?.colliders?.some((b) => r.pos.x > b.min.x && r.pos.x < b.max.x && r.pos.z > b.min.z && r.pos.z < b.max.z && r.pos.y < b.max.y)) end = 'wall';
      else if (r.t > 6) end = 'gone';
      if (end) {
        if (end !== 'hit' && end !== 'gone') this.events.push({ type: 'rockLand', pos: r.pos.clone() });
        this.scene.remove(r.mesh);
        this.rocks.splice(i, 1);
      }
    }
  }

  /** 蒸氣巨人：計時 → 蓄熱（警告）→ 噴蒸氣（範圍內推開＋燙傷一次）→ 回到計時 */
  _updateSteam(dt, player, dist) {
    const C = this.cfg.titan.steam;
    if (!this.alive) {
      this.steamPhase = 'idle';
      return;
    }
    this.steamT += dt;
    if (this.steamPhase === 'idle') {
      if (this.steamT >= C.interval && dist < 70 * this.scale && player.hp > 0) {
        this.steamPhase = 'charge';
        this.steamT = 0;
        this.events.push({ type: 'steamWindup' });
      }
    } else if (this.steamPhase === 'charge') {
      if (this.steamT >= C.windup) {
        this.steamPhase = 'burst';
        this.steamT = 0;
        this.steamHitDone = false;
        this.events.push({ type: 'steamBurst' });
      }
    } else if (this.steamPhase === 'burst') {
      const nape = this.nape.getWorldPosition(_v);
      const d = nape.distanceTo(player.pos);
      const R = C.radius * this.scale;
      if (d < R && player.hp > 0) {
        // 往外吹：越靠近越強
        _v2.subVectors(player.pos, nape).normalize();
        const k = 1 - d / R;
        player.vel.addScaledVector(_v2, C.push * (0.4 + k) * dt);
        if (!this.steamHitDone) {
          this.steamHitDone = true;
          this.events.push({ type: 'steamHit' });
        }
      }
      if (this.steamT >= C.burst) {
        this.steamPhase = 'idle';
        this.steamT = 0;
      }
    }
  }

  /**
   * 規劃飛撲路線：沿拋物線取樣，會撞到建築（建築頂比當下腳的高度高）就在撞到前落下。
   * 跳得過矮房子，跳不過高樓。
   */
  _planLeap(from, to, colliders) {
    const A = this.cfg.titan.abnormal;
    const S = this.scale;
    const r = 3.2 * S;
    const full = Math.hypot(to.x - from.x, to.z - from.z);
    const h = Math.max(6 * S, full * A.leapHeight);
    const steps = Math.max(2, Math.ceil(full / 1.5));
    let ok = 1;
    for (let i = 1; i <= steps && ok === 1; i++) {
      const u = i / steps;
      const x = from.x + (to.x - from.x) * u, z = from.z + (to.z - from.z) * u;
      const y = 4 * h * u * (1 - u);
      for (const { min, max } of colliders) {
        if (max.y < 6 || max.y < y + 0.5 || min.y > y + this.height) continue;
        const cx = Math.max(min.x, Math.min(x, max.x)), cz = Math.max(min.z, Math.min(z, max.z));
        if ((x - cx) ** 2 + (z - cz) ** 2 < r * r) {
          ok = Math.max(0, (i - 1) / steps);
          break;
        }
      }
    }
    const end = from.clone().lerp(to, ok);
    const d = full * ok;
    return { from, to: end, t: 0, dur: A.leapTime * Math.max(0.45, Math.sqrt(ok)), h: Math.max(3 * S, d * A.leapHeight) };
  }

  /**
   * 奇行種的移動：方向亂飄地狂奔，距離剛好就蹲低準備撲過去。回傳 true＝已處理（不走一般巨人的邏輯）
   */
  _abnormalMove(dt, player, aggro, dist, targetYaw) {
    const T = this.cfg.titan;
    const A = T.abnormal;
    const S = this.scale;
    const pos = this.root.position;
    if (!aggro) return false;
    const relH = player.pos.y / this.height;
    if (this.attackCooldown <= 0 && dist < A.pounceRange * S && dist > A.pounceMin * S && relH < A.pounceMaxHeight) {
      this.setState('pounceWindup');
      this.events.push({ type: 'pounceWindup' });
      return true;
    }
    if (dist < T.chaseDist * S * 0.5) return false; // 很近：用一般的揮擊／抓取
    // 狂奔：方向左右亂飄
    const t = performance.now() / 1000;
    const wob = Math.sin(t * 1.9 + this.spawn.x * 0.37) * A.wobble * Math.min(1, dist / (40 * S));
    let d = targetYaw + wob - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += Math.max(-A.turnRate * dt, Math.min(A.turnRate * dt, d));
    if (this.state !== 'walk') this.setState('walk');
    pos.x += Math.sin(this.yaw) * A.runSpeed * S * dt;
    pos.z += Math.cos(this.yaw) * A.runSpeed * S * dt;
    const hx = pos.x - this.spawn.x, hz = pos.z - this.spawn.z;
    const hr = Math.hypot(hx, hz);
    const lim = (this.spawn.homeRadius ?? T.arenaRadius) * A.homeFactor;
    if (hr > lim) {
      pos.x = this.spawn.x + (hx / hr) * lim;
      pos.z = this.spawn.z + (hz / hr) * lim;
    }
    const prev = this.walkPhase;
    this.walkPhase += (dt * 4.2) / Math.sqrt(S);
    if (Math.floor(prev / Math.PI) !== Math.floor(this.walkPhase / Math.PI)) this.events.push({ type: 'step' });
    return true;
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
      if (max.y < p.y + 0.5) continue; // 跳在屋頂上方：不擋
      if (min.y > this.height) continue; // 在頭頂上方的東西（例如樹冠）不擋路
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

    let crouch = 0; // 奇行種蹲低（0～1）
    if (s === 'walk' && this.kind === 'abnormal') {
      // 奇行種狂奔：大步、上身前傾、手臂往後亂甩、頭歪來歪去
      const ph = this.walkPhase;
      legA = Math.sin(ph) * 0.85;
      armLX = 0.9 + Math.sin(ph) * 0.7;
      armRX = 0.9 - Math.sin(ph) * 0.7;
      armLZ = 0.7;
      armRZ = -0.7;
      elbowL = elbowR = -0.2;
      pelvisY = 9 - Math.abs(Math.cos(ph)) * 0.7;
      spineX = 0.55;
      neckX = -0.45;
      neckY = Math.sin(t * 3.1) * 0.45;
    } else if (s === 'pounceWindup') {
      const p = Math.min(1, k / T.abnormal.windup);
      crouch = p;
      armLX = armRX = 1.3 * p;
      armLZ = 0.5 * p;
      armRZ = -0.5 * p;
      spineX = 0.65 * p;
      neckX = -0.5 * p;
    } else if (s === 'leap') {
      // 飛撲：雙手往前抓、腳縮起
      armLX = armRX = -2.1;
      armLZ = 0.25;
      armRZ = -0.25;
      elbowL = elbowR = -0.3;
      spineX = 0.35;
      neckX = -0.3;
      crouch = 0.45;
    } else if (s === 'landed') {
      crouch = Math.max(0, 0.8 - k / T.abnormal.recover);
      spineX = 0.5;
      armLX = armRX = -0.5;
    } else if (s === 'walk') {
      const ph = this.walkPhase;
      legA = Math.sin(ph) * 0.45;
      armLX = -Math.sin(ph) * 0.35;
      armRX = Math.sin(ph) * 0.35;
      pelvisY = 9 - Math.abs(Math.cos(ph)) * 0.35;
      spineX = 0.08;
    } else if (s === 'windup' || s === 'throwWindup') {
      const p = Math.min(1, k / (s === 'windup' ? T.windup : T.thrower.windup));
      armRX = 2.3 * p;
      armRZ = -0.2 - 0.9 * p;
      elbowR = -0.6 * p;
      spineX = 0.25 * p;
      neckX = -0.15 * p;
    } else if (s === 'swing' || s === 'throw') {
      const p = Math.min(1, k / (s === 'swing' ? T.swing : 0.3));
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
    // 受擊反應（疊加在其他姿勢上）：e^(-7t)·cos(13t)，t=0 就是最大值
    let reactRoll = 0;
    if (this.react) {
      const r = this.react;
      r.t += dt;
      const a = Math.exp(-7 * r.t) * Math.cos(13 * r.t);
      neckX += r.neckX * a;
      spineX += r.spineX * a;
      neckY += r.yaw * a;
      reactRoll = r.roll * a;
      if (r.t > 0.8) this.react = null;
    }
    // 跪下：骨盆下沉、大腿往前、小腿往後
    const kn = this.alive ? this.kneelAmount : 0;
    pelvisY -= kn * 4.2;
    const hipK = -1.25 * kn - 1.1 * crouch;
    const kneeK = 2.2 * kn + 2.0 * crouch;
    pelvisY -= crouch * 3.4;
    spineX += 0.35 * kn;

    this.pelvis.position.y = pelvisY;
    this.spine.rotation.x = spineX;
    this.spine.rotation.z = reactRoll;
    this.neck.rotation.set(neckX, neckY, reactRoll * 0.6);
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
    this.eyeMat.emissiveIntensity = this.stunTimer > 0 || !this.alive ? 0 : this.eyeGlow;
    this.eyeMat.color.set(this.eyeColors[this.stunTimer > 0 ? 1 : 0]);
    // 受擊：整隻閃紅，逐漸退回
    const hf = Math.max(0, Math.min(1, this.hitFlash / 0.25));
    // 蒸氣巨人發熱：蓄力時越來越紅，噴發時最亮
    const heat = this.kind === 'steam' && this.alive ? (this.steamPhase === 'charge' ? Math.min(1, this.steamT / T.steam.windup) : this.steamPhase === 'burst' ? 0.8 + Math.sin(t * 20) * 0.2 : 0) : 0;
    this.skin.emissive.setRGB(1.1 * hf + 0.55 * heat, 0.08 * hf + 0.16 * heat, 0.05 * hf + 0.04 * heat);
    // 傷口：慢慢淡掉
    for (let i = this.wounds.length - 1; i >= 0; i--) {
      const w = this.wounds[i];
      w.t -= dt;
      w.mesh.material.opacity = Math.min(0.95, w.t / 3);
      if (w.t <= 0) {
        w.mesh.parent?.remove(w.mesh);
        this.wounds.splice(i, 1);
      }
    }
    const warnR = s === 'windup' ? Math.min(1, k / T.windup) : 0;
    this.handMatR.emissive.setRGB(warnR * 0.9, 0.05 * warnR, 0);
    const warnL = s === 'grabWindup' ? Math.min(1, k / T.grabWindup) : s === 'grabReach' ? 1 : 0;
    this.handMatL.emissive.setRGB(warnL * 0.9, 0.3 * warnL, 0);
  }
}
