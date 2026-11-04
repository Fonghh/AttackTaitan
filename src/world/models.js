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

/**
 * 依地圖載入需要的模型。
 * @param {string} map 地圖代號（forest…）
 * @returns {Promise<{forestTrees?: {trunks: Record<string, any[]>, canopies: Record<string, any[]>}} | null>}
 */
export async function loadModels(map, timeoutMs = 8000) {
  if (map !== 'forest') return null;
  const loader = new GLTFLoader();
  const url = new URL('models/forest_trees.glb', document.baseURI).href;
  const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs));
  try {
    const gltf = await Promise.race([loader.loadAsync(url), timeout]);
    const trunks = {}, canopies = {};
    for (const child of gltf.scene.children) {
      child.position.set(0, 0, 0); // 每個物件都以自己的原點為準
      if (child.name.startsWith('trunk_')) trunks[child.name.slice(6)] = parts(child);
      else if (child.name.startsWith('canopy_')) canopies[child.name.slice(7)] = parts(child);
    }
    if (!Object.keys(trunks).length || !Object.keys(canopies).length) return null;
    return { forestTrees: { trunks, canopies } };
  } catch (err) {
    console.warn('模型載入失敗，改用程式產生的模型：', err.message);
    return null;
  }
}
