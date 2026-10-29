// 卡通渲染：分階明暗（cel shading）材質＋沿法線外推的描邊
import * as THREE from 'three';

let _gradient = null;
/** 三階明暗：暗部、中間、亮部（暗部不會太黑，保持粉彩感） */
export function toonGradient() {
  if (_gradient) return _gradient;
  const data = new Uint8Array([150, 150, 150, 255, 205, 205, 205, 255, 255, 255, 255, 255]);
  _gradient = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  _gradient.minFilter = _gradient.magFilter = THREE.NearestFilter;
  _gradient.generateMipmaps = false;
  _gradient.needsUpdate = true;
  return _gradient;
}

const DROP = ['roughness', 'metalness', 'envMapIntensity', 'flatShading', 'envMap'];

/** 依畫風建立材質：卡通＝MeshToonMaterial（分階明暗），寫實＝MeshStandardMaterial */
export function makeMat(toon, params = {}) {
  if (!toon) return new THREE.MeshStandardMaterial(params);
  const p = { ...params, gradientMap: toonGradient() };
  for (const k of DROP) delete p[k];
  return new THREE.MeshToonMaterial(p);
}

/** 把一般的 MeshStandardMaterial 換成卡通材質（保留顏色、貼圖、雙面、透明度） */
export function toToonMaterial(m) {
  if (!m || !m.isMeshStandardMaterial || m.metalness > 0.5) return m;
  const t = new THREE.MeshToonMaterial({
    color: m.color,
    map: m.map,
    emissive: m.emissive,
    emissiveIntensity: m.emissiveIntensity,
    transparent: m.transparent,
    opacity: m.opacity,
    side: m.side,
    depthWrite: m.depthWrite,
    gradientMap: toonGradient(),
  });
  t.name = m.name;
  return t;
}

/** 場景裡（目前為止）所有的標準材質換成卡通材質，同一個材質只換一次 */
export function toonifyScene(root) {
  const cache = new Map();
  const swap = (m) => {
    if (!cache.has(m)) cache.set(m, toToonMaterial(m));
    return cache.get(m);
  };
  root.traverse((o) => {
    if (!o.isMesh || o.userData.keepMaterial) return;
    o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
  });
}

/** 描邊材質：頂點沿法線往外推、只畫背面 → 外圍一圈深色輪廓 */
export function outlineMaterial(thickness, color = '#3a2b33') {
  const m = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
  m.userData.outline = true;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.outlineT = { value: thickness };
    m.userData.shader = sh;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float outlineT;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normalize(normal) * outlineT;');
  };
  m.customProgramCacheKey = () => 'outline';
  // 粗細存在 userData，onBeforeCompile 之後也能改
  Object.defineProperty(m, 'thickness', {
    get: () => thickness,
    set: (v) => {
      thickness = v;
      if (m.userData.shader) m.userData.shader.uniforms.outlineT.value = v;
    },
  });
  return m;
}

/**
 * 幫一群網格加描邊（共用幾何，不另外複製）。
 * skip(mesh) 回傳 true 的不加（例如刀刃、特效、很小的零件）。
 * 回傳新加的描邊網格（巨人淡出時要一起改透明度）。
 */
export function addOutlines(root, mat, skip = () => false) {
  const added = [];
  const list = [];
  root.traverse((o) => {
    if (o.isMesh && !o.userData.isOutline && !skip(o)) list.push(o);
  });
  for (const o of list) {
    const ol = new THREE.Mesh(o.geometry, mat);
    ol.userData.isOutline = true;
    ol.userData.noHook = true;
    ol.raycast = () => {}; // 描邊不參與鋼索／點擊判定
    ol.castShadow = false;
    ol.receiveShadow = false;
    o.add(ol);
    added.push(ol);
  }
  return added;
}
