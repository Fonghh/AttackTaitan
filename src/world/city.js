// 城市場景：天空、地面、可勾索的建築、外圍城牆、燈光與陰影。
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { facadeTexture, toonFacadeTexture, groundTexture, wallTexture, barkTexture, mulberry32 } from './textures.js';

const TILE = 32; // 外牆貼圖一張代表 32m（8 格 × 4m）

/** 依實際尺寸調整 UV，讓窗戶大小在不同建築上一致 */
/** 方塊的 6 個面群組合併成「牆面」「屋頂」兩組：每棟樓少 4 次 draw call（陰影也是） */
function wallRoofGroups(geo) {
  const idx = geo.index ? geo.index.array : null; // RoundedBoxGeometry 沒有 index
  const wall = [];
  const roof = [];
  geo.groups.forEach((grp, f) => {
    const out = f === 2 || f === 3 ? roof : wall;
    for (let k = grp.start; k < grp.start + grp.count; k++) out.push(idx ? idx[k] : k);
  });
  geo.setIndex([...wall, ...roof]);
  geo.clearGroups();
  geo.addGroup(0, wall.length, 0);
  geo.addGroup(wall.length, roof.length, 1);
  return geo;
}

function boxWithWorldUV(w, h, d) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.attributes.uv;
  // 面順序：+x, -x, +y, -y, +z, -z，每面 4 個頂點
  const spans = [
    [d, h], [d, h], [w, d], [w, d], [w, h], [w, h],
  ];
  for (let f = 0; f < 6; f++) {
    const [su, sv] = spans[f];
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, (uv.getX(i) * su) / TILE, (uv.getY(i) * sv) / TILE);
    }
  }
  return geo;
}

/** 圓角方塊（卡通風）＋依實際尺寸的 UV（窗戶大小一致） */
function roundedBoxWithWorldUV(w, h, d, r) {
  const geo = new RoundedBoxGeometry(w, h, d, 2, r);
  const uv = geo.attributes.uv;
  const spans = [
    [d, h], [d, h], [w, d], [w, d], [w, h], [w, h],
  ];
  const idx = geo.index;
  const done = new Set();
  geo.groups.forEach((grp, f) => {
    const [su, sv] = spans[f] || [w, h];
    for (let k = grp.start; k < grp.start + grp.count; k++) {
      const i = idx ? idx.getX(k) : k;
      if (done.has(i)) continue;
      done.add(i);
      uv.setXY(i, (uv.getX(i) * su) / TILE, (uv.getY(i) * sv) / TILE);
    }
  });
  return geo;
}

const SKY_CLASSIC = ['#3f7fc4', '#a9cbe6', '#e9dcc4'];
const SKY_TOON = ['#7cc4f2', '#cdeafc', '#fdf1dc'];

function makeSky(colors = SKY_CLASSIC) {
  const geo = new THREE.SphereGeometry(900, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(colors[0]) },
      mid: { value: new THREE.Color(colors[1]) },
      bottom: { value: new THREE.Color(colors[2]) },
      sunDir: { value: new THREE.Vector3(0.45, 0.55, 0.35).normalize() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; uniform vec3 sunDir;
      varying vec3 vDir;
      void main() {
        float h = vDir.y;
        vec3 c = h > 0.0 ? mix(mid, top, pow(h, 0.6)) : mix(mid, bottom, pow(-h, 0.4));
        float s = max(dot(vDir, sunDir), 0.0);
        c += vec3(1.0, 0.85, 0.6) * (pow(s, 600.0) * 2.0 + pow(s, 12.0) * 0.25);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(geo, mat);
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  return sky;
}

/**
 * @param {THREE.Scene} scene
 * @param {{wallRadius:number, wallHeight:number}} cfg
 * @param {{x:number,z:number}} spawn
 * @param {boolean} lowSpec
 * @param {'city'|'training'|'forest'} layout 地圖：城區／訓練場／巨木森林
 * @param {{x:number,z:number,r:number}[]} clearings 森林裡要留空的地方（巨人地盤）
 */
export function buildCity(scene, cfg, spawn, lowSpec, layout = 'city', clearings = [], style = 'classic') {
  const colliders = [];
  const hookables = [];
  const snapAnchors = [];
  const rnd = mulberry32(1234);
  const forest = layout === 'forest';
  const toon = style === 'toon'; // 卡通風：粉彩、圓角、明亮柔和的光

  if (toon) {
    scene.background = new THREE.Color(forest ? '#c4ead8' : '#cdeafc');
    scene.fog = forest ? new THREE.Fog('#cbe9d6', 110, 470) : new THREE.Fog('#dcefff', 170, 620);
    scene.add(makeSky(SKY_TOON));
  } else {
    scene.background = new THREE.Color(forest ? '#9fc2c8' : '#a9cbe6');
    scene.fog = forest ? new THREE.Fog('#a8c3b4', 90, 430) : new THREE.Fog('#b9cfe0', 140, 560);
    scene.add(makeSky());
  }

  // 燈光
  const hemi = toon ? new THREE.HemisphereLight('#ffffff', '#d6e6c6', 1.35) : new THREE.HemisphereLight('#dbe8ff', '#7a6a55', 0.9);
  scene.add(hemi);
  const sun = toon ? new THREE.DirectionalLight('#fff6e6', 1.9) : new THREE.DirectionalLight('#fff1d8', 2.4);
  const sunOffset = new THREE.Vector3(90, 120, 70);
  sun.castShadow = true;
  const sm = lowSpec ? 1024 : 2048;
  sun.shadow.mapSize.set(sm, sm);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -90;
  sc.right = sc.top = 90;
  sc.near = 10;
  sc.far = 400;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.6;
  if (toon) sun.shadow.radius = 4; // 陰影邊緣柔和
  scene.add(sun, sun.target);

  // 地面
  const gtex = groundTexture();
  gtex.repeat.set(70, 70);
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(cfg.wallRadius + 20, 64).rotateX(-Math.PI / 2),
    toon
      ? new THREE.MeshStandardMaterial({ color: forest ? '#b5dc96' : layout === 'training' ? '#f3e7cf' : '#e9e4d8', roughness: 1 })
      : new THREE.MeshStandardMaterial({ map: gtex, roughness: 1, color: forest ? '#7f9a66' : '#ffffff' }),
  );
  ground.receiveShadow = true;
  scene.add(ground);

  // 中央廣場（巨人活動區）；訓練場是一片沙地
  if (layout !== 'forest') {
    const plaza = new THREE.Mesh(
      new THREE.CircleGeometry(layout === 'training' ? 75 : 55, 48).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: toon ? (layout === 'training' ? '#f6dcb0' : '#f7e9cf') : layout === 'training' ? '#b9a27a' : '#9b927f', roughness: 1 }),
    );
    plaza.position.y = 0.02;
    plaza.receiveShadow = true;
    scene.add(plaza);
  }

  // 建築材質
  const palettes = [
    ['#d8c9a8', '#a8967a', '#2c3a48'],
    ['#b5664b', '#7d4434', '#29323c'],
    ['#c9c6bd', '#8c897f', '#33424f'],
    ['#e3d6bd', '#9d8c6c', '#3a4652'],
  ];
  // 卡通風：粉紅、天藍、奶油黃、薄荷綠、薰衣草、杏桃
  const toonPalettes = [
    ['#f7c5c5', '#fde3e3'],
    ['#bfe0f5', '#e3f2fc'],
    ['#f8e2a8', '#fdf2d2'],
    ['#c9ead0', '#e7f6ea'],
    ['#ddd0f3', '#efe9fb'],
    ['#fbd3b4', '#feeadb'],
  ];
  const wallMats = toon
    ? toonPalettes.map((p, i) => new THREE.MeshStandardMaterial({ map: toonFacadeTexture(20 + i, ...p), roughness: 0.9 }))
    : palettes.map((p, i) => new THREE.MeshStandardMaterial({ map: facadeTexture(10 + i, ...p), roughness: 0.85 }));
  const roofMat = new THREE.MeshStandardMaterial({ color: toon ? '#f6f1e7' : '#4a4e57', roughness: 0.9 });
  const trimMat = new THREE.MeshStandardMaterial({ color: toon ? '#ffffff' : '#6b6359', roughness: 0.9 });
  // 裝飾小物（遮雨棚、招牌、屋頂冷氣…）依材質合併成一個網格，手機上 draw call 少很多
  const propBins = new Map();
  const addProp = (m) => {
    m.updateMatrix();
    const g = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()).applyMatrix4(m.matrix);
    if (!propBins.has(m.material)) propBins.set(m.material, []);
    propBins.get(m.material).push(g);
  };
  const flushProps = () => {
    for (const [mat, geos] of propBins) {
      const merged = new THREE.Mesh(mergeGeometries(geos), mat);
      merged.castShadow = !lowSpec;
      merged.receiveShadow = true;
      scene.add(merged);
    }
    propBins.clear();
  };
  const propMats = toon
    ? {
        ac: new THREE.MeshStandardMaterial({ color: '#dfe5ea', roughness: 0.8 }),
        tank: new THREE.MeshStandardMaterial({ color: '#9fd2ee', roughness: 0.7 }),
        bush: new THREE.MeshStandardMaterial({ color: '#8fd27a', roughness: 1, flatShading: true }),
        awnings: ['#f26d6d', '#4fb3c9', '#f6b73c', '#7ac97a', '#b48ae0'].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 })),
        sign: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.8 }),
      }
    : null;

  // 卡通風的造型變化（另一組亂數）：階梯高樓、斜屋頂、圓頂、陽台、屋頂花園、屋頂看板
  const drnd = mulberry32(4242);
  const decoMats = toon
    ? {
        roofs: ['#f08a7e', '#7cc4c9', '#f4b860', '#9b8fd9', '#8fcf8a'].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 })),
        white: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.8 }),
        grass: new THREE.MeshStandardMaterial({ color: '#9fdc84', roughness: 1 }),
        board: ['#ff8fa3', '#7fd0f0', '#ffd27a', '#b8e08a'].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, emissive: c, emissiveIntensity: 0.2 })),
      }
    : null;
  function decorateBuilding(x, z, w, d, h, wm) {
    const r = drnd();
    let roofTaken = false;
    const nearSpawn = Math.hypot(x - spawn.x, z - spawn.z) < 100; // 起點附近保持原樣（起跳的第一勾不受影響）
    if (h > 38 && r < 0.3 && !nearSpawn) {
      // 階梯高樓：屋頂再疊一層較小的樓（可勾、可碰撞）
      const tw = w * 0.62, td = d * 0.62, th = 8 + drnd() * 10;
      const tg = roundedBoxWithWorldUV(tw, th, td, Math.min(1.2, Math.min(tw, td) * 0.07));
      const tier = new THREE.Mesh(wallRoofGroups(tg), [wm, roofMat]);
      tier.position.set(x, h + th / 2, z);
      tier.castShadow = tier.receiveShadow = true;
      tier.userData.building = true;
      scene.add(tier);
      hookables.push(tier);
      colliders.push({ min: new THREE.Vector3(x - tw / 2, h, z - td / 2), max: new THREE.Vector3(x + tw / 2, h + th, z + td / 2) });
      if (drnd() < 0.5) {
        const dome = new THREE.Mesh(new THREE.SphereGeometry(Math.min(tw, td) * 0.38, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), decoMats.roofs[Math.floor(drnd() * 5)]);
        dome.position.set(x, h + th, z);
        addProp(dome);
      }
      roofTaken = true;
    } else if (h < 32 && r < 0.62) {
      // 斜屋頂（三角柱），顏色隨機
      const along = w > d;
      const len = (along ? w : d) + 0.6, span = (along ? d : w) + 0.6;
      const rh = Math.min(7, span * 0.38);
      const prism = new THREE.CylinderGeometry(1, 1, 1, 3, 1);
      prism.rotateZ(Math.PI / 2).rotateX(-Math.PI / 2); // 軸沿 x、尖端朝上（高 -0.5～1、寬 1.73）
      const roof = new THREE.Mesh(prism, decoMats.roofs[Math.floor(drnd() * 5)]);
      roof.scale.set(len, rh / 1.5, span / 1.73);
      roof.rotation.y = along ? 0 : Math.PI / 2;
      roof.position.set(x, h + 0.5 * (rh / 1.5) + 0.3, z);
      addProp(roof);
      // 煙囪
      const ch = new THREE.Mesh(new THREE.BoxGeometry(1.4, 3, 1.4), decoMats.white);
      ch.position.set(x + (along ? w * 0.25 : 0), h + rh * 0.6, z + (along ? 0 : d * 0.25));
      addProp(ch);
      roofTaken = true;
    } else if (r < 0.8) {
      // 屋頂花園：草皮＋幾叢灌木
      const lawn = new THREE.Mesh(new THREE.BoxGeometry(w - 2, 0.4, d - 2), decoMats.grass);
      lawn.position.set(x, h + 0.2, z);
      addProp(lawn);
      for (let i = 0; i < 4; i++) {
        const b = new THREE.Mesh(new THREE.IcosahedronGeometry(1 + drnd() * 0.9, 1), propMats.bush);
        b.position.set(x + (drnd() - 0.5) * (w - 5), h + 1, z + (drnd() - 0.5) * (d - 5));
        addProp(b);
      }
      roofTaken = true;
    } else if (h > 20) {
      // 屋頂看板
      const bw = Math.min(w * 0.7, 12);
      const board = new THREE.Mesh(new RoundedBoxGeometry(bw, 4.5, 0.6, 2, 0.25), decoMats.board[Math.floor(drnd() * 4)]);
      board.position.set(x, h + 4.6, z);
      board.rotation.y = drnd() < 0.5 ? 0 : Math.PI / 2;
      addProp(board);
      for (const sx of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.4, 2.6, 0.4), decoMats.white);
        leg.position.set(x + (board.rotation.y ? 0 : sx * bw * 0.35), h + 1.3, z + (board.rotation.y ? sx * bw * 0.35 : 0));
        addProp(leg);
      }
    }
    // 陽台：其中一面每隔 6m 一條白色陽台（中高樓）
    if (h > 18 && drnd() < 0.45) {
      const side = Math.floor(drnd() * 4);
      for (let y = 9; y < h - 3; y += 6) {
        const bw = (side < 2 ? w : d) * 0.55;
        const geo = new THREE.BoxGeometry(side < 2 ? bw : 1.6, 0.35, side < 2 ? 1.6 : bw);
        const b = new THREE.Mesh(geo, decoMats.white);
        const off = (side < 2 ? d : w) / 2 + 0.8;
        b.position.set(x + (side === 2 ? off : side === 3 ? -off : 0), y, z + (side === 0 ? off : side === 1 ? -off : 0));
        addProp(b);
        const rail = new THREE.Mesh(new THREE.BoxGeometry(side < 2 ? bw : 0.15, 1, side < 2 ? 0.15 : bw), decoMats.white);
        rail.position.set(b.position.x + (side === 2 ? 0.75 : side === 3 ? -0.75 : 0), y + 0.6, b.position.z + (side === 0 ? 0.75 : side === 1 ? -0.75 : 0));
        addProp(rail);
      }
    }
    return roofTaken;
  }

  function addBuilding(x, z, w, d, h, plain = false) {
    const wm = wallMats[Math.floor(rnd() * wallMats.length)];
    const geo = toon ? roundedBoxWithWorldUV(w, h, d, Math.min(1.4, Math.min(w, d) * 0.07)) : boxWithWorldUV(w, h, d);
    const mesh = new THREE.Mesh(wallRoofGroups(geo), [wm, roofMat]);
    mesh.position.set(x, h / 2, z);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.userData.building = true;
    scene.add(mesh);
    hookables.push(mesh);
    colliders.push({
      min: new THREE.Vector3(x - w / 2, 0, z - d / 2),
      max: new THREE.Vector3(x + w / 2, h, z + d / 2),
    });
    // 屋頂矮牆（視覺用，不另外碰撞）
    const pw = 0.6;
    const ph = 1.0;
    const parts = [
      [w, ph, pw, 0, d / 2 - pw / 2],
      [w, ph, pw, 0, -d / 2 + pw / 2],
      [pw, ph, d, w / 2 - pw / 2, 0],
      [pw, ph, d, -w / 2 + pw / 2, 0],
    ];
    for (const [a, b, c, ox, oz] of parts) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(a, b, c), trimMat);
      m.position.set(x + ox, h + ph / 2, z + oz);
      m.castShadow = !lowSpec;
      if (toon) addProp(m);
      else scene.add(m);
    }
    // 卡通風：造型變化（用另一組亂數，不影響建築配置）
    let roofTaken = false;
    if (toon && !plain) roofTaken = decorateBuilding(x, z, w, d, h, wm);
    // 卡通風：一樓的彩色遮雨棚＋招牌、屋頂的冷氣／水塔／盆栽
    if (toon && !plain) {
      if (h > 12) {
        const am = propMats.awnings[Math.floor(rnd() * propMats.awnings.length)];
        const side = Math.floor(rnd() * 4);
        const [aw, ad, ox, oz] = side === 0 ? [w * 0.7, 1.6, 0, d / 2 + 0.8] : side === 1 ? [w * 0.7, 1.6, 0, -d / 2 - 0.8] : side === 2 ? [1.6, d * 0.7, w / 2 + 0.8, 0] : [1.6, d * 0.7, -w / 2 - 0.8, 0];
        const awn = new THREE.Mesh(new RoundedBoxGeometry(aw, 0.5, ad, 2, 0.2), am);
        awn.position.set(x + ox, 4.2, z + oz);
        awn.rotation.set(side === 0 ? 0.25 : side === 1 ? -0.25 : 0, 0, side === 2 ? -0.25 : side === 3 ? 0.25 : 0);
        addProp(awn);
        const sign = new THREE.Mesh(new RoundedBoxGeometry(side < 2 ? aw * 0.6 : 0.3, 1.6, side < 2 ? 0.3 : ad * 0.6, 2, 0.12), propMats.sign);
        sign.position.set(x + ox * (side < 2 ? 1 : 0.62), 6.4, z + oz * (side < 2 ? 0.62 : 1));
        addProp(sign);
      }
      // 屋頂被花園／斜屋頂佔用時不放小物，但亂數照抽（不然後面整座城的配置都會跟著變）
      const n = 1 + Math.floor(rnd() * 3);
      for (let i = 0; i < n; i++) {
        const px = x + (rnd() - 0.5) * (w - 5), pz = z + (rnd() - 0.5) * (d - 5);
        const kind = rnd();
        let m;
        if (kind < 0.4) {
          m = new THREE.Mesh(new RoundedBoxGeometry(2.4, 1.6, 2.4, 2, 0.3), propMats.ac);
          m.position.set(px, h + 0.8, pz);
        } else if (kind < 0.7) {
          m = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 2.6, 12), propMats.tank);
          m.position.set(px, h + 1.3, pz);
        } else {
          m = new THREE.Mesh(new THREE.IcosahedronGeometry(1.2, 1), propMats.bush);
          m.position.set(px, h + 1.0, pz);
        }
        if (!roofTaken) addProp(m);
      }
    }
    // 屋頂小屋 / 水塔，增加輪廓
    if (!toon && !plain && rnd() < 0.6) {
      const sw = 3 + rnd() * 4;
      const shh = 2 + rnd() * 3;
      const m = new THREE.Mesh(new THREE.BoxGeometry(sw, shh, sw), roofMat);
      m.position.set(x + (rnd() - 0.5) * (w - sw - 2), h + shh / 2, z + (rnd() - 0.5) * (d - sw - 2));
      m.castShadow = true;
      scene.add(m);
      colliders.push({
        min: new THREE.Vector3(m.position.x - sw / 2, h, m.position.z - sw / 2),
        max: new THREE.Vector3(m.position.x + sw / 2, h + shh, m.position.z + sw / 2),
      });
    }
    return mesh;
  }

  if (layout === 'city') buildStreets();
  else if (layout === 'training') buildTraining();
  else buildForest();

  function buildTraining() {
    // 起點台
    addBuilding(spawn.x, spawn.z, 10, 10, spawn.y - 1, true);
    // 內圈 8 根柱子（勾點）、外圈 6 棟高樓
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      addBuilding(Math.sin(a) * 48, Math.cos(a) * 48, 8, 8, 32 + (i % 3) * 7, true);
    }
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      addBuilding(Math.sin(a) * 105, Math.cos(a) * 105, 22, 22, 48 + (i % 2) * 14);
    }
  }

  function buildForest() {
    // 起點：高木台
    addBuilding(spawn.x, spawn.z, 12, 12, spawn.y - 1, true);
    const bark = toon ? new THREE.MeshStandardMaterial({ color: '#c08a5c', roughness: 1 }) : new THREE.MeshStandardMaterial({ map: barkTexture(), roughness: 1 });
    const leaves = toon
      ? ['#8fd27a', '#a6dd8c', '#7cc87a'].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 1, flatShading: true }))
      : [
          new THREE.MeshStandardMaterial({ color: '#3f6b3a', roughness: 1, flatShading: true }),
          new THREE.MeshStandardMaterial({ color: '#4d7a40', roughness: 1, flatShading: true }),
        ];
    const free = (x, z, r) =>
      Math.hypot(x - spawn.x, z - spawn.z) > r + 12 && clearings.every((c) => Math.hypot(x - c.x, z - c.z) > c.r + r);
    // 起點正前方幾棵樹：一開始準星就有東西可以勾
    for (const [x, z, r, h] of [[5, 118, 5, 78], [-26, 128, 4.5, 72], [30, 100, 5, 84]]) addTree(x, z, r, h);
    const step = 36;
    for (let gx = -230; gx <= 230; gx += step) {
      for (let gz = -230; gz <= 230; gz += step) {
        const x = gx + (rnd() - 0.5) * step * 0.6;
        const z = gz + (rnd() - 0.5) * step * 0.6;
        const r = 3.5 + rnd() * 2.5;
        if (Math.hypot(x, z) > cfg.wallRadius - 25 || !free(x, z, r)) continue;
        if (Math.hypot(x - 5, z - 118) < 22 || Math.hypot(x + 26, z - 128) < 20 || Math.hypot(x - 30, z - 100) < 22) continue;
        addTree(x, z, r, 60 + rnd() * 30);
      }
    }
    // 卡通風：林地的灌木叢、花、蘑菇（裝飾，不擋路、不能勾；另一組亂數）
    if (toon) {
      const bushes = [], flowers = [], shrooms = [];
      for (let i = 0; i < 420; i++) {
        const a = drnd() * Math.PI * 2, rr = Math.sqrt(drnd()) * (cfg.wallRadius - 20);
        const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
        if (colliders.some((c) => x > c.min.x - 2 && x < c.max.x + 2 && z > c.min.z - 2 && z < c.max.z + 2 && c.min.y < 1)) continue;
        const k = drnd();
        if (k < 0.45) bushes.push([x, z, 1.2 + drnd() * 1.6]);
        else if (k < 0.85) flowers.push([x, z]);
        else shrooms.push([x, z, 0.7 + drnd() * 0.8]);
      }
      const m4 = new THREE.Matrix4();
      const bush = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ color: '#7fcf6e', roughness: 1, flatShading: true }), bushes.length);
      bushes.forEach(([x, z, sc], i) => bush.setMatrixAt(i, m4.makeScale(sc * 1.3, sc, sc * 1.3).setPosition(x, sc * 0.6, z)));
      const flower = new THREE.InstancedMesh(new THREE.SphereGeometry(0.35, 6, 5), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9 }), flowers.length);
      const fc = ['#ff8fa3', '#ffd27a', '#b48ae0', '#ffffff', '#7fd0f0'].map((c) => new THREE.Color(c));
      flowers.forEach(([x, z], i) => {
        flower.setMatrixAt(i, m4.makeTranslation(x, 0.4, z));
        flower.setColorAt(i, fc[Math.floor(drnd() * fc.length)]);
      });
      const stem = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.35, 0.45, 1.2, 8).translate(0, 0.6, 0), new THREE.MeshStandardMaterial({ color: '#fff3df', roughness: 1 }), shrooms.length);
      const capM = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#ff6f61', roughness: 0.8 }), shrooms.length);
      shrooms.forEach(([x, z, sc], i) => {
        stem.setMatrixAt(i, m4.makeScale(sc, sc, sc).setPosition(x, 0, z));
        capM.setMatrixAt(i, m4.makeScale(sc * 1.1, sc * 0.8, sc * 1.1).setPosition(x, 1.1 * sc, z));
      });
      bush.castShadow = !lowSpec;
      scene.add(bush, flower, stem, capM);
    }
    function addTree(x, z, r, h) {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.75, r * 1.15, h, 10), bark);
      trunk.position.set(x, h / 2, z);
      trunk.castShadow = trunk.receiveShadow = true;
      trunk.userData.building = true;
      scene.add(trunk);
      hookables.push(trunk);
      const half = r * 0.85; // 圓柱用略小的方塊當碰撞
      colliders.push({ min: new THREE.Vector3(x - half, 0, z - half), max: new THREE.Vector3(x + half, h, z + half) });
      // 樹冠：可以勾；中間有實心的碰撞（可以站在上面、撞得到），外圍的葉子穿得過
      const cr = r * 3.2;
      const cy = h + r * 1.6;
      const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(cr, toon ? 1 : 0), leaves[Math.floor(rnd() * leaves.length)]);
      crown.position.set(x, cy, z);
      crown.scale.y = 0.7;
      crown.castShadow = !lowSpec;
      crown.userData.building = true;
      scene.add(crown);
      hookables.push(crown);
      const ch = cr * 0.6, cv = cr * 0.7 * 0.6;
      colliders.push({ min: new THREE.Vector3(x - ch, cy - cv, z - ch), max: new THREE.Vector3(x + ch, cy + cv, z + ch) });
      // 準心吸附點：樹冠下緣一圈
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.3;
        snapAnchors.push({ pos: new THREE.Vector3(x + Math.sin(a) * cr * 0.78, cy - cr * 0.7 * 0.35, z + Math.cos(a) * cr * 0.78), object: crown });
      }
      // 準心吸附點：樹幹四周的上段與中段
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        for (const k of [0.85, 0.6]) {
          const rr = r * (1.15 - 0.4 * k) - 0.1;
          snapAnchors.push({ pos: new THREE.Vector3(x + Math.sin(a) * rr, h * k, z + Math.cos(a) * rr), object: trunk });
        }
      }
    }
  }

  function buildStreets() {
  // 8×8 街廓，中央 4 格留給廣場
  const cells = [-175, -125, -75, -25, 25, 75, 125, 175];
  for (const cx of cells) {
    for (const cz of cells) {
      // 起點高塔放在 (25,125) 這一格，但往街道中央挪，讓起跳時正對一條開闊街道
      const isSpawn = cx === 25 && cz === 125;
      if (Math.abs(cx) < 50 && Math.abs(cz) < 50) continue;
      if (Math.hypot(cx, cz) > cfg.wallRadius - 30) continue;
      const ring = Math.abs(cx) <= 75 && Math.abs(cz) <= 75; // 廣場周圍一圈一定有建築
      if (!isSpawn && !ring && rnd() < 0.15) continue;
      if (isSpawn) {
        addBuilding(spawn.x, spawn.z, 14, 14, 44, true);
        continue;
      }
      const nearPlaza = Math.hypot(cx, cz) < 110;
      const w = 16 + rnd() * 16;
      const d = 16 + rnd() * 16;
      const h = nearPlaza ? 50 + rnd() * 18 : 15 + rnd() * 55;
      addBuilding(cx + (rnd() - 0.5) * (32 - w) * 0.8, cz + (rnd() - 0.5) * (32 - d) * 0.8, w, d, h);
    }
  }

  // 廣場周圍的鐘塔（可勾，靠近巨人）
  const tower = (x, z, h) => {
    const tg = toon ? roundedBoxWithWorldUV(7, h, 7, 0.8) : boxWithWorldUV(7, h, 7);
    const m = new THREE.Mesh(wallRoofGroups(tg), [wallMats[2], roofMat]);
    m.position.set(x, h / 2, z);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    hookables.push(m);
    colliders.push({ min: new THREE.Vector3(x - 3.5, 0, z - 3.5), max: new THREE.Vector3(x + 3.5, h, z + 3.5) });
    const cap = new THREE.Mesh(new THREE.ConeGeometry(5.5, 8, toon ? 8 : 4).rotateY(Math.PI / 4), toon ? new THREE.MeshStandardMaterial({ color: '#f28b8b', roughness: 0.8 }) : roofMat);
    cap.position.set(x, h + 4, z);
    cap.castShadow = true;
    scene.add(cap);
  };
  tower(-48, 48, 38);
  tower(48, -48, 44);
  flushProps();
  if (toon) buildStreetDecor();
  }

  /** 卡通風的街道：深灰藍馬路、白色虛線、路口斑馬線、人行道上的圓樹 */
  function buildStreetDecor() {
    const roadMat = new THREE.MeshStandardMaterial({ color: '#7f8a9b', roughness: 1 });
    const lineMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9 });
    const R = cfg.wallRadius - 8;
    const lines = [-150, -100, -50, 0, 50, 100, 150];
    for (const c of lines) {
      for (const horiz of [true, false]) {
        const half = Math.sqrt(Math.max(0, R * R - c * c));
        // 中央廣場（|x|,|z| < 50）不鋪馬路
        const segs = Math.abs(c) < 50 ? [[-half, -52], [52, half]] : [[-half, half]];
        for (const [a, b] of segs) {
          if (b - a < 4) continue;
          const road = new THREE.Mesh(new THREE.PlaneGeometry(horiz ? b - a : 16, horiz ? 16 : b - a).rotateX(-Math.PI / 2), roadMat);
          road.position.set(horiz ? (a + b) / 2 : c, 0.03 + (horiz ? 0 : 0.005), horiz ? c : (a + b) / 2);
          road.receiveShadow = true;
          scene.add(road);
        }
      }
    }
    // 白色虛線與斑馬線（InstancedMesh：一次畫完）
    const dash = [];
    const cross = [];
    for (const c of lines) {
      for (let t = -R; t <= R; t += 8) {
        if (Math.hypot(t, c) > R - 4) continue;
        const nearCross = lines.some((l) => Math.abs(t - l) < 11);
        const inPlaza = Math.abs(t) < 52 && Math.abs(c) < 52;
        if (!nearCross && !inPlaza) {
          dash.push([t, c, true]);
          dash.push([c, t, false]);
        }
      }
      for (const l of lines) {
        if (Math.abs(l) < 52 && Math.abs(c) < 52) continue;
        if (Math.hypot(l, c) > R - 12) continue;
        for (let k = -3; k <= 3; k++) {
          cross.push([l + k * 2.1, c + 10, true]);
          cross.push([l + k * 2.1, c - 10, true]);
        }
      }
    }
    const inst = (list, w, d, mat) => {
      const im = new THREE.InstancedMesh(new THREE.BoxGeometry(w, 0.06, d), mat, list.length);
      const m4 = new THREE.Matrix4();
      list.forEach(([x, z, horiz], i) => {
        m4.makeRotationY(horiz ? 0 : Math.PI / 2).setPosition(x, 0.07, z);
        im.setMatrixAt(i, m4);
      });
      im.receiveShadow = true;
      scene.add(im);
    };
    inst(dash, 3.2, 0.35, lineMat);
    inst(cross, 1.1, 4.2, lineMat);
    // 路邊的圓樹（裝飾，不能勾、不擋路）
    const trunkGeo = new THREE.CylinderGeometry(0.35, 0.45, 3, 8);
    const crownGeo = new THREE.IcosahedronGeometry(2.3, 1);
    const trees = [];
    for (const c of lines) {
      for (let t = -R + 20; t <= R - 20; t += 18) {
        for (const side of [-1, 1]) {
          const x = t, z = c + side * 9.6;
          if (Math.hypot(x, z) > R - 10 || (Math.abs(x) < 56 && Math.abs(z) < 56)) continue;
          if (lines.some((l) => Math.abs(x - l) < 12)) continue;
          if (colliders.some((b) => x > b.min.x - 1.5 && x < b.max.x + 1.5 && z > b.min.z - 1.5 && z < b.max.z + 1.5)) continue;
          if (rnd() < 0.55) trees.push([x, z], [z, x]);
        }
      }
    }
    // 三種樹：圓樹（綠）、櫻花樹（粉紅）、松樹（疊起來的圓錐）；用另一組亂數分配，不影響配置
    const kinds = trees.map(() => drnd());
    const tm = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: '#b07a52', roughness: 1 }), trees.length);
    const pineGeo = mergeGeometries([new THREE.ConeGeometry(2.4, 3.2, 8).translate(0, -0.6, 0), new THREE.ConeGeometry(1.8, 2.8, 8).translate(0, 1.1, 0), new THREE.ConeGeometry(1.1, 2.2, 8).translate(0, 2.5, 0)]);
    const lists = [[], [], []];
    trees.forEach((t, i) => lists[kinds[i] < 0.55 ? 0 : kinds[i] < 0.78 ? 1 : 2].push(i));
    const crowns = [
      new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ color: '#8fd27a', roughness: 1, flatShading: true }), lists[0].length),
      new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ color: '#ffb7cf', roughness: 1, flatShading: true }), lists[1].length),
      new THREE.InstancedMesh(pineGeo, new THREE.MeshStandardMaterial({ color: '#5fb987', roughness: 1, flatShading: true }), lists[2].length),
    ];
    const m4 = new THREE.Matrix4();
    const scales = trees.map(() => 0.8 + rnd() * 0.5);
    trees.forEach(([x, z], i) => {
      const s = scales[i];
      m4.makeScale(s, s, s).setPosition(x, 1.5 * s, z);
      tm.setMatrixAt(i, m4);
    });
    lists.forEach((list, k) => {
      list.forEach((i, j) => {
        const [x, z] = trees[i];
        const s = scales[i];
        if (k === 2) m4.makeScale(s, s, s).setPosition(x, 4.4 * s, z);
        else m4.makeScale(s * (k === 1 ? 1.1 : 1), s * 0.9, s * (k === 1 ? 1.1 : 1)).setPosition(x, 4.6 * s, z);
        crowns[k].setMatrixAt(j, m4);
      });
      crowns[k].castShadow = !lowSpec;
    });
    tm.castShadow = !lowSpec;
    scene.add(tm, ...crowns);
    // 路燈（路口四角）＋花圃（人行道上）
    const lamps = [];
    const beds = [];
    for (const a of lines) {
      for (const b of lines) {
        if (Math.abs(a) < 52 && Math.abs(b) < 52) continue;
        if (Math.hypot(a, b) > R - 14) continue;
        for (const [ox, oz] of [[9.2, 9.2], [-9.2, -9.2]]) {
          const x = a + ox, z = b + oz;
          if (colliders.some((c) => x > c.min.x - 1 && x < c.max.x + 1 && z > c.min.z - 1 && z < c.max.z + 1)) continue;
          lamps.push([x, z]);
        }
        if (drnd() < 0.6) {
          const x = a + 9.6, z = b + 20 + drnd() * 6;
          if (!colliders.some((c) => x > c.min.x - 2 && x < c.max.x + 2 && z > c.min.z - 3 && z < c.max.z + 3)) beds.push([x, z]);
        }
      }
    }
    const poleGeo = new THREE.CylinderGeometry(0.15, 0.2, 6, 6).translate(0, 3, 0);
    const bulbGeo = new THREE.SphereGeometry(0.55, 10, 8);
    const pole = new THREE.InstancedMesh(poleGeo, new THREE.MeshStandardMaterial({ color: '#5d6b80', roughness: 0.7 }), lamps.length);
    const bulb = new THREE.InstancedMesh(bulbGeo, new THREE.MeshStandardMaterial({ color: '#fff4c8', emissive: '#ffe08a', emissiveIntensity: 0.8 }), lamps.length);
    lamps.forEach(([x, z], i) => {
      pole.setMatrixAt(i, m4.makeTranslation(x, 0, z));
      bulb.setMatrixAt(i, m4.makeTranslation(x, 6.3, z));
    });
    scene.add(pole, bulb);
    const bedGeo = new RoundedBoxGeometry(1.6, 0.7, 5, 2, 0.25);
    const flowerGeo = new THREE.SphereGeometry(0.32, 6, 5);
    const bed = new THREE.InstancedMesh(bedGeo, new THREE.MeshStandardMaterial({ color: '#f3e3c8', roughness: 1 }), beds.length);
    const flowers = new THREE.InstancedMesh(flowerGeo, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9 }), beds.length * 6);
    const fc = ['#ff8fa3', '#ffd27a', '#b48ae0', '#ffffff', '#ff6f61'].map((c) => new THREE.Color(c));
    beds.forEach(([x, z], i) => {
      bed.setMatrixAt(i, m4.makeTranslation(x, 0.35, z));
      for (let k = 0; k < 6; k++) {
        flowers.setMatrixAt(i * 6 + k, m4.makeTranslation(x + (drnd() - 0.5) * 0.9, 0.85, z - 2 + k * 0.8));
        flowers.setColorAt(i * 6 + k, fc[Math.floor(drnd() * fc.length)]);
      }
    });
    scene.add(bed, flowers);
  }

  // 外圍城牆（內側可勾索）
  const wtex = wallTexture();
  wtex.repeat.set(60, 4);
  const wallMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(cfg.wallRadius, cfg.wallRadius, cfg.wallHeight, 96, 1, true),
    new THREE.MeshStandardMaterial({ map: wtex, roughness: 1, side: THREE.BackSide, color: toon ? '#fff3dc' : '#ffffff' }),
  );
  wallMesh.position.y = cfg.wallHeight / 2;
  wallMesh.receiveShadow = true;
  scene.add(wallMesh);
  hookables.push(wallMesh);
  // 城牆頂
  const rim = new THREE.Mesh(
    new THREE.RingGeometry(cfg.wallRadius, cfg.wallRadius + 10, 96).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: toon ? '#f4e2c4' : '#7d786d', roughness: 1 }),
  );
  rim.position.y = cfg.wallHeight;
  scene.add(rim);

  // 遠山
  const hillMat = new THREE.MeshStandardMaterial({ color: toon ? '#a9d9b8' : '#7f97a8', roughness: 1, flatShading: true });
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2 + rnd() * 0.2;
    const r = 520 + rnd() * 120;
    const hill = new THREE.Mesh(new THREE.ConeGeometry(90 + rnd() * 80, 80 + rnd() * 120, 6), hillMat);
    hill.position.set(Math.cos(a) * r, 30, Math.sin(a) * r);
    scene.add(hill);
  }

  scene.updateMatrixWorld(true);

  // 準心吸附點：每棟建築的屋頂四角、屋頂邊緣中點、轉角直邊（上段與中段），略往內縮避免打在邊線外
  for (const m of hookables) {
    const g = m.geometry.parameters;
    if ((m.geometry.type !== 'BoxGeometry' && m.geometry.type !== 'RoundedBoxGeometry') || !g) continue;
    const { x, z } = m.position;
    const hw = g.width / 2 - 0.15, hd = g.depth / 2 - 0.15, top = g.height - 0.3;
    const add = (px, py, pz) => snapAnchors.push({ pos: new THREE.Vector3(px, py, pz), object: m });
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      add(x + sx * hw, top, z + sz * hd);
      add(x + sx * hw, top * 0.7, z + sz * hd);
      add(x + sx * hw, top * 0.45, z + sz * hd);
    }
    add(x, top, z - hd);
    add(x, top, z + hd);
    add(x - hw, top, z);
    add(x + hw, top, z);
  }

  return {
    colliders,
    hookables,
    snapAnchors,
    sun,
    /** 讓陰影範圍跟著玩家 */
    update(focus) {
      sun.position.copy(focus).add(sunOffset);
      sun.target.position.copy(focus);
      sun.target.updateMatrixWorld();
    },
  };
}
