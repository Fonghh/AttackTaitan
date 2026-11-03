// 畫面氛圍：隨風擺動的草叢、太陽與光暈、斜射的光束。每幀 update(time, camera) 推動風和讓太陽跟著鏡頭。
import * as THREE from 'three';

function radialTexture(stops) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  for (const [o, col] of stops) grad.addColorStop(o, col);
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

/**
 * 草叢：一叢 = 三片交叉的細長三角形，根部深綠、尖端淺黃綠，尖端隨風左右擺（越高擺越多）。
 * 全部放在一個 InstancedMesh 裡（一次 draw call）。避開建築與樹幹的碰撞箱。
 */
function makeGrass(count, radius, colliders, rnd, colors, fog) {
  const blade = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI;
    const c = Math.cos(a) * 0.45, s = Math.sin(a) * 0.45;
    blade.push(-c, 0, -s, c, 0, s, 0, 1, 0);
  }
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(blade, 3));
  const offsets = [];
  const params = [];
  let tries = 0;
  while (offsets.length / 3 < count && tries++ < count * 4) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * radius;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (colliders.some((b) => x > b.min.x - 0.8 && x < b.max.x + 0.8 && z > b.min.z - 0.8 && z < b.max.z + 0.8 && b.min.y < 1)) continue;
    offsets.push(x, 0, z);
    params.push(0.9 + rnd() * 1.6, rnd() * Math.PI * 2, rnd()); // 高度、相位、顏色變化
  }
  geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(new Float32Array(offsets), 3));
  geo.setAttribute('aParam', new THREE.InstancedBufferAttribute(new Float32Array(params), 3));
  geo.instanceCount = offsets.length / 3;
  const mat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      { uTime: { value: 0 }, uBase: { value: new THREE.Color(colors[0]) }, uTip: { value: new THREE.Color(colors[1]) }, uTip2: { value: new THREE.Color(colors[2]) } },
    ]),
    vertexShader: `
      uniform float uTime;
      attribute vec3 aOffset;
      attribute vec3 aParam;
      varying float vH;
      varying float vVar;
      #include <fog_pars_vertex>
      void main() {
        vec3 p = position;
        p.y *= aParam.x;
        float sway = sin(uTime * 1.8 + aParam.y + aOffset.x * 0.05 + aOffset.z * 0.04) * 0.35 + sin(uTime * 3.1 + aParam.y * 2.0) * 0.08;
        p.x += sway * position.y * aParam.x * 0.6;
        p.z += sway * position.y * aParam.x * 0.25;
        vH = position.y;
        vVar = aParam.z;
        vec4 mvPosition = viewMatrix * vec4(p + aOffset, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform vec3 uBase, uTip, uTip2;
      varying float vH;
      varying float vVar;
      #include <fog_pars_fragment>
      void main() {
        vec3 tip = mix(uTip, uTip2, vVar);
        gl_FragColor = vec4(mix(uBase, tip, smoothstep(0.0, 1.0, vH)), 1.0);
        #include <fog_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.userData.keepMaterial = true;
  return mesh;
}

/**
 * @param {THREE.Scene} scene
 * @param {{layout:string, toon:boolean, sunDir:THREE.Vector3, colliders:any[], radius:number, lowSpec:boolean, rnd:()=>number}} o
 */
export function buildAtmosphere(scene, o) {
  const { layout, toon, sunDir, colliders, radius, lowSpec, rnd } = o;
  const green = layout === 'forest' || layout === 'fort';
  const parts = [];

  // 草叢（草地地圖）
  let grass = null;
  if (green) {
    const colors = layout === 'forest' ? (toon ? ['#5fa35a', '#b8e27a', '#d9ef8f'] : ['#3d5a32', '#7e9a52', '#98aa5a']) : toon ? ['#6fb35e', '#c3e683', '#e6f39a'] : ['#4f6e3c', '#8fa65a', '#a6b360'];
    grass = makeGrass(lowSpec ? 9000 : 16000, radius - 15, colliders, rnd, colors);
    scene.add(grass);
    parts.push(grass);
  }

  // 太陽＋光暈（跟著鏡頭，永遠在天空的同一個方向）
  const sun = new THREE.Group();
  const disc = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTexture([[0, 'rgba(255,255,245,1)'], [0.25, 'rgba(255,250,225,0.95)'], [0.4, 'rgba(255,240,200,0.35)'], [1, 'rgba(255,230,180,0)']]), blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  disc.scale.setScalar(140);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTexture([[0, 'rgba(255,245,215,0.45)'], [0.5, 'rgba(255,235,200,0.12)'], [1, 'rgba(255,230,190,0)']]), blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  halo.scale.setScalar(620);
  sun.add(halo, disc);
  sun.renderOrder = -1;
  scene.add(sun);
  const dir = sunDir.clone().normalize();

  // 斜射的光束（森林、要塞）：從太陽那一側斜斜打下來的幾道淡淡的光柱
  const rays = [];
  if (green) {
    const rayTex = (() => {
      const c = document.createElement('canvas');
      c.width = 64;
      c.height = 256;
      const g = c.getContext('2d');
      const grad = g.createLinearGradient(0, 0, 0, 256);
      grad.addColorStop(0, 'rgba(255,250,225,0.0)');
      grad.addColorStop(0.25, 'rgba(255,250,225,0.55)');
      grad.addColorStop(1, 'rgba(255,250,225,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 256);
      const side = g.createLinearGradient(0, 0, 64, 0);
      side.addColorStop(0, 'rgba(0,0,0,1)');
      side.addColorStop(0.5, 'rgba(0,0,0,0)');
      side.addColorStop(1, 'rgba(0,0,0,1)');
      g.globalCompositeOperation = 'destination-out';
      g.fillStyle = side;
      g.fillRect(0, 0, 64, 256);
      return new THREE.CanvasTexture(c);
    })();
    const rayMat = new THREE.MeshBasicMaterial({ map: rayTex, transparent: true, opacity: layout === 'forest' ? 0.32 : 0.2, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    for (let i = 0; i < 9; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(14 + rnd() * 16, 200), rayMat);
      const a = rnd() * Math.PI * 2, r = 30 + rnd() * 170;
      m.position.set(Math.cos(a) * r, 80, Math.sin(a) * r);
      m.userData.tilt = Math.atan2(Math.hypot(dir.x, dir.z), dir.y); // 光柱沿太陽方向傾斜
      m.userData.phase = rnd() * Math.PI * 2;
      scene.add(m);
      rays.push(m);
    }
  }
  const _q = new THREE.Quaternion();
  const _up = new THREE.Vector3(0, 1, 0);

  return {
    update(time, camera) {
      if (grass) grass.material.uniforms.uTime.value = time;
      sun.position.copy(camera.position).addScaledVector(dir, 900);
      if (rays.length) {
        _q.setFromUnitVectors(_up, dir);
        for (const m of rays) {
          // 沿太陽方向傾斜、繞自己的軸轉向鏡頭
          m.quaternion.copy(_q);
          m.rotateY(Math.atan2(camera.position.x - m.position.x, camera.position.z - m.position.z));
        }
        rays[0].material.opacity = (layout === 'forest' ? 0.3 : 0.18) * (0.8 + 0.2 * Math.sin(time * 0.6)); // 亮度緩緩呼吸
      }
    },
  };
}
