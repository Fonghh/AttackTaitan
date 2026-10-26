// 程序化貼圖（canvas），不需要任何外部素材。
import * as THREE from 'three';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTexture(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  draw(g, size);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** 建築外牆：8×8 格窗戶，一格代表 4m × 4m（一層樓） */
export function facadeTexture(seed, wall, trim, glass) {
  const rnd = mulberry32(seed);
  return canvasTexture(512, (g, S) => {
    g.fillStyle = wall;
    g.fillRect(0, 0, S, S);
    // 牆面雜訊
    for (let i = 0; i < 2500; i++) {
      g.fillStyle = `rgba(0,0,0,${rnd() * 0.06})`;
      g.fillRect(rnd() * S, rnd() * S, 2 + rnd() * 6, 2 + rnd() * 3);
    }
    const cell = S / 8;
    for (let y = 0; y < 8; y++) {
      // 樓層線腳
      g.fillStyle = trim;
      g.fillRect(0, y * cell + cell - 5, S, 5);
      for (let x = 0; x < 8; x++) {
        const wx = x * cell + cell * 0.28;
        const wy = y * cell + cell * 0.2;
        const ww = cell * 0.44;
        const wh = cell * 0.55;
        g.fillStyle = trim;
        g.fillRect(wx - 3, wy - 3, ww + 6, wh + 8);
        const lit = rnd() < 0.12;
        g.fillStyle = lit ? '#f3d58a' : glass;
        g.fillRect(wx, wy, ww, wh);
        g.fillStyle = 'rgba(255,255,255,0.12)';
        g.fillRect(wx, wy, ww, wh * 0.3);
        g.fillStyle = trim;
        g.fillRect(wx + ww / 2 - 1.5, wy, 3, wh);
      }
    }
  });
}

export function groundTexture() {
  const rnd = mulberry32(7);
  return canvasTexture(512, (g, S) => {
    g.fillStyle = '#6d675d';
    g.fillRect(0, 0, S, S);
    // 石板
    const n = 16;
    const c = S / n;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const off = y % 2 ? c / 2 : 0;
        const v = 95 + rnd() * 30;
        g.fillStyle = `rgb(${v},${v - 4},${v - 12})`;
        g.fillRect(x * c + off + 1, y * c + 1, c - 2, c - 2);
      }
    }
    for (let i = 0; i < 3000; i++) {
      g.fillStyle = `rgba(0,0,0,${rnd() * 0.08})`;
      g.fillRect(rnd() * S, rnd() * S, 2, 2);
    }
  });
}

export function wallTexture() {
  const rnd = mulberry32(99);
  return canvasTexture(512, (g, S) => {
    g.fillStyle = '#8f8a7e';
    g.fillRect(0, 0, S, S);
    const rows = 16;
    const h = S / rows;
    for (let y = 0; y < rows; y++) {
      const w = S / 8;
      for (let x = -1; x < 9; x++) {
        const off = y % 2 ? w / 2 : 0;
        const v = 120 + rnd() * 25;
        g.fillStyle = `rgb(${v},${v - 3},${v - 10})`;
        g.fillRect(x * w + off + 2, y * h + 2, w - 4, h - 4);
      }
    }
  });
}

/** 樹皮：直向的深淺紋路 */
export function barkTexture() {
  const rnd = mulberry32(31);
  const tex = canvasTexture(256, (g, S) => {
    g.fillStyle = '#5a4130';
    g.fillRect(0, 0, S, S);
    for (let i = 0; i < 90; i++) {
      const x = rnd() * S;
      const w = 2 + rnd() * 6;
      const v = 60 + rnd() * 40;
      g.fillStyle = `rgb(${v + 20},${v},${v - 18})`;
      g.fillRect(x, 0, w, S);
    }
    for (let i = 0; i < 400; i++) {
      g.fillStyle = `rgba(0,0,0,${rnd() * 0.25})`;
      g.fillRect(rnd() * S, rnd() * S, 2 + rnd() * 3, 6 + rnd() * 20);
    }
  });
  tex.repeat.set(3, 6);
  return tex;
}
