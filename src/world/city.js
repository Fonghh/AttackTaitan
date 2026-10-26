// 城市場景：天空、地面、可勾索的建築、外圍城牆、燈光與陰影。
import * as THREE from 'three';
import { facadeTexture, groundTexture, wallTexture, mulberry32 } from './textures.js';

const TILE = 32; // 外牆貼圖一張代表 32m（8 格 × 4m）

/** 依實際尺寸調整 UV，讓窗戶大小在不同建築上一致 */
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

function makeSky() {
  const geo = new THREE.SphereGeometry(900, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color('#3f7fc4') },
      mid: { value: new THREE.Color('#a9cbe6') },
      bottom: { value: new THREE.Color('#e9dcc4') },
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
 */
export function buildCity(scene, cfg, spawn, lowSpec) {
  const colliders = [];
  const hookables = [];
  const rnd = mulberry32(1234);

  scene.background = new THREE.Color('#a9cbe6');
  scene.fog = new THREE.Fog('#b9cfe0', 140, 560);
  scene.add(makeSky());

  // 燈光
  const hemi = new THREE.HemisphereLight('#dbe8ff', '#7a6a55', 0.9);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff1d8', 2.4);
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
  scene.add(sun, sun.target);

  // 地面
  const gtex = groundTexture();
  gtex.repeat.set(70, 70);
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(cfg.wallRadius + 20, 64).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: gtex, roughness: 1 }),
  );
  ground.receiveShadow = true;
  scene.add(ground);

  // 中央廣場（巨人活動區）
  const plaza = new THREE.Mesh(
    new THREE.CircleGeometry(55, 48).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: '#9b927f', roughness: 1 }),
  );
  plaza.position.y = 0.02;
  plaza.receiveShadow = true;
  scene.add(plaza);

  // 建築材質
  const palettes = [
    ['#d8c9a8', '#a8967a', '#2c3a48'],
    ['#b5664b', '#7d4434', '#29323c'],
    ['#c9c6bd', '#8c897f', '#33424f'],
    ['#e3d6bd', '#9d8c6c', '#3a4652'],
  ];
  const wallMats = palettes.map(
    (p, i) => new THREE.MeshStandardMaterial({ map: facadeTexture(10 + i, ...p), roughness: 0.85 }),
  );
  const roofMat = new THREE.MeshStandardMaterial({ color: '#4a4e57', roughness: 0.9 });
  const trimMat = new THREE.MeshStandardMaterial({ color: '#6b6359', roughness: 0.9 });

  function addBuilding(x, z, w, d, h, plain = false) {
    const wm = wallMats[Math.floor(rnd() * wallMats.length)];
    const mesh = new THREE.Mesh(boxWithWorldUV(w, h, d), [wm, wm, roofMat, roofMat, wm, wm]);
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
      scene.add(m);
    }
    // 屋頂小屋 / 水塔，增加輪廓
    if (!plain && rnd() < 0.6) {
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
    const m = new THREE.Mesh(boxWithWorldUV(7, h, 7), [wallMats[2], wallMats[2], roofMat, roofMat, wallMats[2], wallMats[2]]);
    m.position.set(x, h / 2, z);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    hookables.push(m);
    colliders.push({ min: new THREE.Vector3(x - 3.5, 0, z - 3.5), max: new THREE.Vector3(x + 3.5, h, z + 3.5) });
    const cap = new THREE.Mesh(new THREE.ConeGeometry(5.5, 8, 4).rotateY(Math.PI / 4), roofMat);
    cap.position.set(x, h + 4, z);
    cap.castShadow = true;
    scene.add(cap);
  };
  tower(-48, 48, 38);
  tower(48, -48, 44);

  // 外圍城牆（內側可勾索）
  const wtex = wallTexture();
  wtex.repeat.set(60, 4);
  const wallMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(cfg.wallRadius, cfg.wallRadius, cfg.wallHeight, 96, 1, true),
    new THREE.MeshStandardMaterial({ map: wtex, roughness: 1, side: THREE.BackSide }),
  );
  wallMesh.position.y = cfg.wallHeight / 2;
  wallMesh.receiveShadow = true;
  scene.add(wallMesh);
  hookables.push(wallMesh);
  // 城牆頂
  const rim = new THREE.Mesh(
    new THREE.RingGeometry(cfg.wallRadius, cfg.wallRadius + 10, 96).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: '#7d786d', roughness: 1 }),
  );
  rim.position.y = cfg.wallHeight;
  scene.add(rim);

  // 遠山
  const hillMat = new THREE.MeshStandardMaterial({ color: '#7f97a8', roughness: 1, flatShading: true });
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2 + rnd() * 0.2;
    const r = 520 + rnd() * 120;
    const hill = new THREE.Mesh(new THREE.ConeGeometry(90 + rnd() * 80, 80 + rnd() * 120, 6), hillMat);
    hill.position.set(Math.cos(a) * r, 30, Math.sin(a) * r);
    scene.add(hill);
  }

  scene.updateMatrixWorld(true);

  // 準心吸附點：每棟建築的屋頂四角、屋頂邊緣中點、轉角直邊（上段與中段），略往內縮避免打在邊線外
  const snapAnchors = [];
  for (const m of hookables) {
    const g = m.geometry.parameters;
    if (m.geometry.type !== 'BoxGeometry' || !g) continue;
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
