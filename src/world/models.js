// Blender 做的模型（public/models/*.glb）：遊戲開始前先載入；載入失敗或逾時就回傳 null，遊戲改用程式產生的模型。
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/** 把一個物件底下的網格拆成 { geometry, material } 清單（套用網格在物件裡的位移／旋轉） */
function parts(root) {
  const out = [];
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    out.push({ geometry: g, material: o.material });
  });
  return out;
}

async function loadGLB(loader, name, timeoutMs) {
  const url = new URL(`models/${name}.glb`, document.baseURI).href;
  const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs));
  return Promise.race([loader.loadAsync(url), timeout]);
}

async function loadForest(loader, timeoutMs) {
  const gltf = await loadGLB(loader, 'forest_trees', timeoutMs);
  const trunks = {}, canopies = {};
  for (const child of gltf.scene.children) {
    child.position.set(0, 0, 0); // 每個物件都以自己的原點為準
    if (child.name.startsWith('trunk_')) trunks[child.name.slice(6)] = parts(child);
    else if (child.name.startsWith('canopy_')) canopies[child.name.slice(7)] = parts(child);
  }
  if (!Object.keys(trunks).length || !Object.keys(canopies).length) throw new Error('forest_trees.glb 內容不完整');
  return { trunks, canopies };
}

/**
 * 依地圖載入需要的模型（主角每張地圖都要；森林地圖另外載入樹）。個別失敗只少那一項，遊戲改用程式產生的模型。
 * @param {string} map 地圖代號（forest…）
 * @param {{hero?: boolean}} [want]
 * @returns {Promise<{forestTrees?: {trunks: Record<string, any[]>, canopies: Record<string, any[]>}, hero?: any} | null>}
 */
export async function loadModels(map, timeoutMs = 8000, want = {}) {
  const loader = new GLTFLoader();
  const warn = (what) => (err) => {
    console.warn(`${what}載入失敗，改用程式產生的模型：`, err.message);
    return null;
  };
  const [forestTrees, hero] = await Promise.all([
    map === 'forest' ? loadForest(loader, timeoutMs).catch(warn('樹的模型')) : null,
    want.hero !== false ? loadGLB(loader, 'hero', timeoutMs).catch(warn('主角模型')) : null,
  ]);
  const out = {};
  if (forestTrees) out.forestTrees = forestTrees;
  if (hero) out.hero = hero;
  return Object.keys(out).length ? out : null;
}
