// 視覺特效：粒子、速度流線、鋼索、鉤爪、刀光。
import * as THREE from 'three';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _Y = new THREE.Vector3(0, 1, 0);
const _from = new THREE.Vector3();
const _to = new THREE.Vector3();

/** 單一 Points 物件的粒子池 */
class ParticlePool {
  constructor(scene, max, additive) {
    this.max = max;
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('pcolor', new THREE.BufferAttribute(this.col, 4));
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uScale: { value: 400 } },
      vertexShader: /* glsl */ `
        attribute float size; attribute vec4 pcolor; varying vec4 vColor; uniform float uScale;
        void main() {
          vColor = pcolor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          // 離鏡頭太近的粒子淡掉（近距離鏡頭時瓦斯雲不會糊住畫面）
          vColor.a *= smoothstep(1.2, 4.5, -mv.z);
          gl_PointSize = size * uScale / max(0.1, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec4 vColor;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          if (d > 0.5) discard;
          gl_FragColor = vec4(vColor.rgb, vColor.a * smoothstep(0.5, 0.1, d));
        }`,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.p = [];
    for (let i = 0; i < max; i++) this.p.push({ life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, s0: 1, s1: 1, r: 1, g: 1, b: 1, a: 1, drag: 0, grav: 0 });
    this.cursor = 0;
  }

  spawn(o) {
    const p = this.p[this.cursor];
    this.cursor = (this.cursor + 1) % this.max;
    Object.assign(p, { drag: 0, grav: 0, a: 1 }, o);
    p.life = p.max;
  }

  update(dt) {
    for (let i = 0; i < this.max; i++) {
      const p = this.p[i];
      if (p.life <= 0) {
        this.col[i * 4 + 3] = 0;
        this.size[i] = 0;
        continue;
      }
      p.life -= dt;
      const k = Math.max(0, p.life / p.max);
      const dr = Math.max(0, 1 - p.drag * dt);
      p.vx *= dr;
      p.vy = p.vy * dr - p.grav * dt;
      p.vz *= dr;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      this.pos[i * 3] = p.x;
      this.pos[i * 3 + 1] = p.y;
      this.pos[i * 3 + 2] = p.z;
      this.col[i * 4] = p.r;
      this.col[i * 4 + 1] = p.g;
      this.col[i * 4 + 2] = p.b;
      this.col[i * 4 + 3] = p.a * k;
      this.size[i] = p.s1 + (p.s0 - p.s1) * k;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.pcolor.needsUpdate = true;
    this.geo.attributes.size.needsUpdate = true;
  }
}

/**
 * 速度流線：固定在世界空間，在角色前方生成，被飛越時往後掠過（真實視差）。
 * 速度越快 → 數量越多、越長、越亮。
 */
class SpeedLines {
  constructor(scene, cfg) {
    this.cfg = cfg;
    const N = cfg.max;
    this.N = N;
    this.pos = new Float32Array(N * 6);
    this.col = new Float32Array(N * 6);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.mesh = new THREE.LineSegments(
      this.geo,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.lines = [];
    for (let i = 0; i < N; i++) this.lines.push({ on: false, head: new THREE.Vector3(), dir: new THREE.Vector3(), len: 0, life: 0, max: 1, bright: 1 });
    this.acc = 0;
    this.intensity = 0;
    this.level = cfg.levels[cfg.defaultLevel];
  }

  /** @param {number} feel 體感速度倍數（速度倍率越低，同樣速度看起來越快） */
  update(dt, pos, vel, feel = 1) {
    const C = this.cfg;
    const speed = vel.length() * feel;
    const f = Math.max(0, Math.min(1, (speed - C.minSpeed) / (C.fullSpeed - C.minSpeed))) * (this.level > 0 ? 1 : 0);
    this.intensity = f;
    const vdir = _v.copy(vel).normalize();
    // 生成
    if (f > 0) {
      this.acc += (C.spawnPerSec * f * f * dt + 6 * f * dt) * this.level;
      const maxActive = Math.floor(C.max * (0.25 + 0.75 * f) * this.level);
      let active = 0;
      for (const l of this.lines) if (l.on) active++;
      while (this.acc >= 1) {
        this.acc -= 1;
        if (active >= maxActive) continue;
        const l = this.lines.find((x) => !x.on);
        if (!l) break;
        // 垂直於速度方向的隨機偏移（離角色 1.2–7m 的圓柱殼）
        _v2.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).cross(vdir);
        if (_v2.lengthSq() < 1e-4) _v2.set(1, 0, 0);
        _v2.normalize().multiplyScalar(C.minRadius + Math.random() * (C.maxRadius - C.minRadius));
        l.head.copy(pos).addScaledVector(vdir, 6 + Math.random() * 26).add(_v2);
        l.dir.copy(vdir);
        l.len = Math.max(1.2, speed * C.lengthPerSpeed * (0.5 + Math.random() * 0.8) * (0.5 + f));
        l.max = l.life = 0.35 + Math.random() * 0.5;
        l.bright = (0.35 + Math.random() * 0.45) * (0.4 + 0.6 * f) * (0.5 + 0.5 * this.level);
        l.on = true;
        active++;
      }
    } else {
      this.acc = 0;
    }
    // 更新
    for (let i = 0; i < this.N; i++) {
      const l = this.lines[i];
      const o = i * 6;
      if (l.on) {
        l.life -= dt;
        _v2.subVectors(l.head, pos);
        if (l.life <= 0 || _v2.dot(vdir) < -14) l.on = false;
      }
      if (!l.on) {
        this.col.fill(0, o, o + 6);
        continue;
      }
      const k = l.life / l.max;
      const fade = Math.sin(k * Math.PI) * l.bright; // 淡入淡出
      this.pos[o] = l.head.x;
      this.pos[o + 1] = l.head.y;
      this.pos[o + 2] = l.head.z;
      this.pos[o + 3] = l.head.x - l.dir.x * l.len;
      this.pos[o + 4] = l.head.y - l.dir.y * l.len;
      this.pos[o + 5] = l.head.z - l.dir.z * l.len;
      this.col[o] = this.col[o + 1] = this.col[o + 2] = fade;
      this.col[o + 3] = 0;
      this.col[o + 4] = 0;
      this.col[o + 5] = 0;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }

  clear() {
    for (const l of this.lines) l.on = false;
  }
}

/** 可彎曲的管子：沿一串點建立圓管（鋼索下垂用），每幀更新頂點 */
class BentTube {
  constructor(segments, radial, radius, material) {
    this.n = segments;
    this.r = radial;
    this.radius = radius;
    const verts = (segments + 1) * radial;
    this.pos = new Float32Array(verts * 3);
    const idx = [];
    for (let i = 0; i < segments; i++) {
      for (let j = 0; j < radial; j++) {
        const a = i * radial + j, b = i * radial + ((j + 1) % radial), c = a + radial, d = b + radial;
        idx.push(a, c, b, b, c, d);
      }
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setIndex(idx);
    this.mesh = new THREE.Mesh(this.geo, material);
    this.mesh.frustumCulled = false;
  }

  /** @param {THREE.Vector3[]} pts n+1 個點 */
  update(pts, scale) {
    const R = this.r;
    for (let i = 0; i <= this.n; i++) {
      const p = pts[i];
      const q = pts[Math.min(this.n, i + 1)], o = pts[Math.max(0, i - 1)];
      _v.subVectors(q, o).normalize(); // 切線
      // 任一垂直向量
      _v2.set(0, 1, 0);
      if (Math.abs(_v.y) > 0.9) _v2.set(1, 0, 0);
      _n1.crossVectors(_v, _v2).normalize();
      _n2.crossVectors(_v, _n1);
      for (let j = 0; j < R; j++) {
        const a = (j / R) * Math.PI * 2;
        const c = Math.cos(a) * this.radius * scale, s = Math.sin(a) * this.radius * scale;
        const k = (i * R + j) * 3;
        this.pos[k] = p.x + _n1.x * c + _n2.x * s;
        this.pos[k + 1] = p.y + _n1.y * c + _n2.y * s;
        this.pos[k + 2] = p.z + _n1.z * c + _n2.z * s;
      }
    }
    this.geo.attributes.position.needsUpdate = true;
  }
}
const _n1 = new THREE.Vector3();
const _n2 = new THREE.Vector3();
const ROPE_SEG = 14;

/** 鋼索：發射器到鉤爪。放鬆時往下垂，重新繃緊時「啪」一下發亮、抖動 */
class RopeVisual {
  constructor(scene, color) {
    // 核心（加粗）＋外層光暈，方便在高速中辨識
    this.core = new BentTube(ROPE_SEG, 6, 0.065, new THREE.MeshBasicMaterial({ color }));
    this.halo = new BentTube(ROPE_SEG, 8, 0.2, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.mesh = this.core.mesh;
    this.glow = this.halo.mesh;
    this.claw = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.6, 6), new THREE.MeshStandardMaterial({ color: '#cfd6dc', metalness: 0.8, roughness: 0.3 }));
    // 勾點標記：發光圓環，被建築擋住也看得到
    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.85, 24),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.marker.renderOrder = 20;
    scene.add(this.mesh, this.glow, this.claw, this.marker);
    this.hide();
    this.baseColor = new THREE.Color(color);
    this.t = 0;
    this.sag = 0;
    this.snap = 0; // 重新繃緊的閃光／抖動
    this.pts = Array.from({ length: ROPE_SEG + 1 }, () => new THREE.Vector3());
  }

  /** ropeLen：繩長（比距離長＝放鬆下垂） */
  set(from, to, taut, attached, camera, dt, ropeLen = 0) {
    _v.subVectors(to, from);
    const len = _v.length();
    if (len < 1e-3) return;
    dt = dt || 0;
    this.t += dt;
    this.mesh.visible = this.claw.visible = true;
    this.glow.visible = attached;
    // 下垂量：繩子比距離長多少（懸鏈線近似），最多 14m；繃緊時快速收回並觸發「啪」
    const slack = attached ? Math.max(0, ropeLen - len) : 0;
    const want = Math.min(14, Math.sqrt(0.375 * len * slack));
    if (this.sag > 1.2 && want < 0.3) this.snap = 1;
    this.sag += (want - this.sag) * Math.min(1, dt * (want < this.sag ? 18 : 6));
    this.snap = Math.max(0, this.snap - dt * 3.5);
    // 抖動方向：垂直於繩子的水平方向
    _n1.set(-_v.z, 0, _v.x).normalize();
    for (let i = 0; i <= ROPE_SEG; i++) {
      const u = i / ROPE_SEG;
      const bell = 4 * u * (1 - u);
      const p = this.pts[i].copy(from).addScaledVector(_v, u);
      p.y -= this.sag * bell;
      if (this.snap > 0) p.addScaledVector(_n1, Math.sin(u * Math.PI * 3 - this.t * 60) * this.snap * 0.5 * bell);
    }
    // 飛行中細、勾住後粗；繃緊時最亮；重新繃緊瞬間更粗更亮
    const w = (attached ? (taut ? 1.0 : 0.85) : 0.6) * (1 + this.snap * 0.8);
    this.core.update(this.pts, w);
    this.halo.update(this.pts, w);
    this.mesh.material.color.copy(this.baseColor).multiplyScalar((attached ? (taut ? 1.35 : 1.0) : 0.8) + this.snap * 1.5);
    this.glow.material.opacity = 0.28 + this.snap * 0.5;
    this.claw.position.copy(to);
    _q.setFromUnitVectors(_Y, _v.multiplyScalar(1 / len));
    this.claw.quaternion.copy(_q);
    // 勾點標記：面向鏡頭，依距離放大，輕微脈動
    this.marker.visible = attached && !!camera;
    if (this.marker.visible) {
      this.marker.position.copy(to);
      this.marker.lookAt(camera.position);
      const d = camera.position.distanceTo(to);
      this.marker.scale.setScalar(Math.max(1, d * 0.045) * (1 + Math.sin(this.t * 8) * 0.12));
    }
  }

  hide() {
    this.mesh.visible = this.claw.visible = this.glow.visible = this.marker.visible = false;
    this.sag = 0;
  }
}

/** 風壓漩渦：圓錐形的透明管，貼上斜向的風紋，沿飛行方向旋轉 */
function makeSwirl() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 256, 128);
  for (let i = 0; i < 26; i++) {
    const y = Math.random() * 128, w = 40 + Math.random() * 120, x = Math.random() * 256;
    const grad = g.createLinearGradient(x, 0, x + w, 0);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.5, `rgba(235,250,255,${0.4 + Math.random() * 0.5})`);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.strokeStyle = grad;
    g.lineWidth = 1 + Math.random() * 3;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + w, y + 18);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 1);
  const m = new THREE.Mesh(
    new THREE.CylinderGeometry(0.7, 1.7, 3.2, 20, 1, true),
    new THREE.MeshBasicMaterial({ map: tex, color: '#dff8ef', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  m.frustumCulled = false;
  m.visible = false;
  return m;
}

/** 雲帶貼圖：橫向（u）中間濃、兩邊淡；縱向（v）是一團一團的雲 */
function cloudBandTexture() {
  const W = 64, Hh = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = Hh;
  const g = c.getContext('2d');
  g.clearRect(0, 0, W, Hh);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 70; i++) {
    const y = rnd() * Hh, x = W / 2 + (rnd() - 0.5) * W * 0.35, r = 10 + rnd() * 18;
    for (const dy of [-Hh, 0, Hh]) {
      const grad = g.createRadialGradient(x, y + dy, 0, x, y + dy, r);
      grad.addColorStop(0, `rgba(255,255,255,${0.35 + rnd() * 0.3})`);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(x, y + dy, r, 0, Math.PI * 2);
      g.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/**
 * 瓦斯軌跡線：身後兩條細長的白線（像飛機雲），停留幾秒、慢慢變寬變淡，把飛行路線畫在空中。
 * 面向鏡頭的帶子，中斷時（落地、停止噴氣）斷開不相連。
 */
class TrailLines {
  constructor(scene, cfg) {
    this.cfg = cfg;
    this.max = Math.ceil(cfg.life / cfg.interval) + 2;
    this.trails = [0, 1].map(() => ({ pts: [], acc: 0 }));
    const n = this.max * 2 * 2;
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 4);
    this.uv = new Float32Array(n * 2);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4));
    this.geo.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2));
    this.idx = new Uint16Array(this.max * 2 * 6);
    this.geo.setIndex(new THREE.BufferAttribute(this.idx, 1));
    // 雲狀貼圖：橫向邊緣柔和、縱向一團一團（不是一條實線）
    this.mesh = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({ map: cloudBandTexture(), vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  /** emit：這一幀有沒有在噴（沒有＝斷開）；sources：兩個噴口的世界座標 */
  update(dt, emit, sources, camera) {
    const C = this.cfg;
    for (let k = 0; k < 2; k++) {
      const tr = this.trails[k];
      for (const p of tr.pts) p.age += dt;
      while (tr.pts.length && tr.pts[0].age > C.life) tr.pts.shift();
      tr.acc += dt;
      if (emit) {
        if (tr.acc >= C.interval || !tr.on) {
          tr.acc = 0;
          const last = tr.pts[tr.pts.length - 1];
          const dist = last && tr.on ? last.dist + last.p.distanceTo(sources[k]) : Math.random() * 10;
          tr.pts.push({ p: sources[k].clone(), age: 0, brk: !tr.on, dist });
          if (tr.pts.length > this.max) tr.pts.shift();
        } else if (tr.pts.length) tr.pts[tr.pts.length - 1].p.copy(sources[k]); // 最新的點跟著噴口
      }
      tr.on = emit;
    }
    // 建立面向鏡頭的帶子
    let v = 0, ii = 0;
    for (const tr of this.trails) {
      const pts = tr.pts;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[Math.min(pts.length - 1, i + 1)], o = pts[Math.max(0, i - 1)];
        _v.subVectors(b.p, o.p);
        if (_v.lengthSq() < 1e-8) _v.set(0, 0, 1);
        _v2.subVectors(camera.position, a.p);
        _v.cross(_v2).normalize();
        const u = a.age / C.life;
        const w = C.width * (1 + u * C.spread);
        const alpha = C.alpha * (1 - u) * (1 - u * 0.3) * Math.min(1, a.age * 6 + 0.15);
        this.pos.set([a.p.x + _v.x * w, a.p.y + _v.y * w, a.p.z + _v.z * w, a.p.x - _v.x * w, a.p.y - _v.y * w, a.p.z - _v.z * w], v * 3);
        this.col.set([0.93, 0.95, 0.98, alpha, 0.93, 0.95, 0.98, alpha], v * 4);
        // 沿著路徑的貼圖座標：跟著點走（雲團不會在帶子上滑動）
        const tv = a.dist * 0.18;
        this.uv.set([0, tv, 1, tv], v * 2);
        if (i > 0 && !a.brk) this.idx.set([v - 2, v - 1, v, v - 1, v + 1, v], ii), (ii += 6);
        v += 2;
      }
    }
    this.geo.setDrawRange(0, ii);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.attributes.uv.needsUpdate = true;
    this.geo.index.needsUpdate = true;
    this.mesh.visible = ii > 0;
  }

  clear() {
    for (const tr of this.trails) tr.pts.length = 0;
  }
}

/** 刀光弧 */
class SlashArcs {
  constructor(scene) {
    this.items = [];
    // 新月形刀光：外緣厚、兩端尖（用頂點位置把內圈往外推做出新月）
    const geo = new THREE.RingGeometry(1.5, 2.35, 48, 2, -0.25, Math.PI * 1.05);
    const pa = geo.attributes.position;
    for (let i = 0; i < pa.count; i++) {
      const x = pa.getX(i), y = pa.getY(i);
      const r = Math.hypot(x, y), a = Math.atan2(y, x);
      const u = (a + 0.25) / (Math.PI * 1.05); // 0..1 沿著弧
      const thick = Math.sin(Math.max(0, Math.min(1, u)) * Math.PI); // 中間厚、兩端尖
      const nr = 2.35 - (2.35 - r) * thick;
      pa.setXY(i, Math.cos(a) * nr, Math.sin(a) * nr);
    }
    for (let i = 0; i < 12; i++) {
      const m = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({ color: '#e8f6ff', transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      m.visible = false;
      scene.add(m);
      this.items.push({ m, t: 0, max: 0.25 });
    }
    this.i = 0;
  }

  spawn(pos, dir, roll, scale, color, alpha = 0.85, life = 0.28) {
    const it = this.items[this.i];
    this.i = (this.i + 1) % this.items.length;
    it.m.position.copy(pos);
    it.m.lookAt(_v.copy(pos).add(dir));
    it.m.rotateZ(roll);
    it.m.scale.setScalar(scale);
    it.m.material.color.set(color);
    it.m.visible = true;
    it.t = it.max = life;
    it.s = scale;
    it.a = alpha;
  }

  update(dt) {
    for (const it of this.items) {
      if (!it.m.visible) continue;
      it.t -= dt;
      const k = Math.max(0, it.t / it.max);
      it.m.material.opacity = k * it.a;
      it.m.scale.setScalar(it.s * (1.35 - 0.35 * k));
      if (it.t <= 0) it.m.visible = false;
    }
  }
}

/** 刀身殘光：沿著刀身（根部→刀尖）掃過的軌跡畫成一條漸淡的帶子 */
class BladeRibbon {
  constructor(scene, color) {
    this.N = 7; // 殘光長度（幀數）
    this.pos = new Float32Array(this.N * 2 * 3);
    this.col = new Float32Array(this.N * 2 * 3);
    const idx = [];
    for (let i = 0; i < this.N - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, b, c, b, d, c);
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.geo.setIndex(idx);
    this.mesh = new THREE.Mesh(
      this.geo,
      new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.color = new THREE.Color(color);
    this.hist = [];
  }

  update(base, tip, intensity) {
    this.hist.unshift([base.clone(), tip.clone()]);
    if (this.hist.length > this.N) this.hist.length = this.N;
    for (let i = 0; i < this.N; i++) {
      const h = this.hist[Math.min(i, this.hist.length - 1)];
      const o = i * 6;
      this.pos.set([h[0].x, h[0].y, h[0].z, h[1].x, h[1].y, h[1].z], o);
      const f = intensity * Math.pow(1 - i / this.N, 1.6);
      this.col.set([this.color.r * f * 0.4, this.color.g * f * 0.4, this.color.b * f * 0.4, this.color.r * f, this.color.g * f, this.color.b * f], o);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.mesh.visible = intensity > 0.01;
  }
}

/**
 * 刀光線：命中時劃過弱點的長條發光線（面向鏡頭的細長平面，沿刀路方向）。
 * 先快速伸長，再變細淡出。
 */
class BladeStreaks {
  constructor(scene) {
    this.items = [];
    const geo = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }),
      );
      m.visible = false;
      m.renderOrder = 10;
      scene.add(m);
      this.items.push({ m, t: 0, max: 0.3, center: new THREE.Vector3(), dir: new THREE.Vector3(), len: 1, width: 0.3 });
    }
    this.i = 0;
    this._a = new THREE.Vector3();
    this._b = new THREE.Vector3();
  }

  spawn(center, dir, len, width, color, life = 0.32) {
    const it = this.items[this.i];
    this.i = (this.i + 1) % this.items.length;
    it.center.copy(center);
    it.dir.copy(dir).normalize();
    it.len = len;
    it.width = width;
    it.t = it.max = life;
    it.m.material.color.set(color);
    it.m.visible = true;
  }

  update(dt, camera) {
    for (const it of this.items) {
      if (!it.m.visible) continue;
      it.t -= dt;
      if (it.t <= 0) {
        it.m.visible = false;
        continue;
      }
      const age = it.max - it.t;
      const grow = Math.min(1, 0.75 + age / 0.08); // 一出現就接近全長（頓點停格時也看得到）
      const k = it.t / it.max;
      it.m.position.copy(it.center);
      it.m.lookAt(camera.position);
      // 依刀路在螢幕上的方向旋轉
      this._a.copy(it.center).addScaledVector(it.dir, -it.len / 2).project(camera);
      this._b.copy(it.center).addScaledVector(it.dir, it.len / 2).project(camera);
      const ang = Math.atan2(this._b.y - this._a.y, (this._b.x - this._a.x) * camera.aspect);
      it.m.rotateZ(ang);
      it.m.scale.set(it.len * grow * (1 + (1 - k) * 0.25), it.width * Math.max(0.15, k), 1);
      it.m.material.opacity = Math.min(1, k * 1.6);
    }
  }
}

export class Effects {
  constructor(scene, cfg) {
    this.glow = new ParticlePool(scene, 700, true);
    this.smoke = new ParticlePool(scene, 1100, false);
    this.swirl = makeSwirl();
    scene.add(this.swirl);
    this.trailLines = new TrailLines(scene, cfg.trailLines);
    this._tsrc = [new THREE.Vector3(), new THREE.Vector3()];
    this.speedLines = new SpeedLines(scene, cfg.speedLines);
    this.ropes = { left: new RopeVisual(scene, '#9fb8c8'), right: new RopeVisual(scene, '#c8b89f') };
    this.slashes = new SlashArcs(scene);
    this.streaks = new BladeStreaks(scene);
    this.blades = { left: new BladeRibbon(scene, '#b98bff'), right: new BladeRibbon(scene, '#7fd8ff') };
    this._bBase = new THREE.Vector3();
    this._bTip = new THREE.Vector3();
    // 鉤爪命中閃光
    this.flashes = [];
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.visible = false;
      scene.add(m);
      this.flashes.push({ m, t: 0, max: 0.18, size: 1 });
    }
    this.fi = 0;
  }

  setPixelScale(h, fovDeg) {
    const s = h / (2 * Math.tan((fovDeg * Math.PI) / 360));
    this.glow.mat.uniforms.uScale.value = s;
    this.smoke.mat.uniforms.uScale.value = s;
  }

  hookHit(point) {
    const f = this.flashes[this.fi];
    this.fi = (this.fi + 1) % this.flashes.length;
    f.m.position.copy(point);
    f.m.visible = true;
    f.t = f.max = 0.18;
    f.size = 1;
    f.m.material.color.set('#ffffff');
    for (let i = 0; i < 14; i++) {
      this.glow.spawn({ x: point.x, y: point.y, z: point.z, vx: (Math.random() - 0.5) * 18, vy: (Math.random() - 0.2) * 14, vz: (Math.random() - 0.5) * 18, max: 0.25 + Math.random() * 0.2, s0: 0.25, s1: 0.05, r: 1, g: 0.8, b: 0.45, grav: 20, drag: 2 });
    }
    for (let i = 0; i < 5; i++) {
      this.smoke.spawn({ x: point.x, y: point.y, z: point.z, vx: (Math.random() - 0.5) * 3, vy: Math.random() * 2, vz: (Math.random() - 0.5) * 3, max: 0.7, s0: 0.6, s1: 1.8, r: 0.75, g: 0.72, b: 0.68, a: 0.5, drag: 1.5 });
    }
  }

  gasPuff(pos, vel, strong) {
    const n = strong ? 3 : 1;
    for (let i = 0; i < n; i++) {
      this.smoke.spawn({
        x: pos.x + (Math.random() - 0.5) * 0.4, y: pos.y + 0.2, z: pos.z + (Math.random() - 0.5) * 0.4,
        vx: -vel.x * 0.15 + (Math.random() - 0.5) * 3, vy: -vel.y * 0.15 + (Math.random() - 0.5) * 3, vz: -vel.z * 0.15 + (Math.random() - 0.5) * 3,
        max: 0.5 + Math.random() * 0.4, s0: 0.35, s1: 1.6, r: 0.95, g: 0.97, b: 1, a: strong ? 0.55 : 0.3, drag: 3,
      });
    }
  }

  /**
   * 瓦斯雲軌跡：飛行時身後一團一團的白色瓦斯，停留一秒多、慢慢擴散，把飛行路線畫在空中。
   * @param {number} k 濃度 0～1（衝刺最濃）
   */
  gasTrail(pos, vel, k) {
    this._gasAcc = (this._gasAcc || 0) + 1.2 + k * 3.2;
    const sp = vel.length() || 1;
    while (this._gasAcc >= 1) {
      this._gasAcc -= 1;
      const back = 0.5 + Math.random() * 0.6;
      this.smoke.spawn({
        x: pos.x - (vel.x / sp) * back + (Math.random() - 0.5) * 0.5,
        y: pos.y + 0.15 - (vel.y / sp) * back + (Math.random() - 0.5) * 0.5,
        z: pos.z - (vel.z / sp) * back + (Math.random() - 0.5) * 0.5,
        vx: vel.x * 0.04 + (Math.random() - 0.5) * 2.2, vy: vel.y * 0.04 + (Math.random() - 0.3) * 1.6, vz: vel.z * 0.04 + (Math.random() - 0.5) * 2.2,
        max: 1.0 + Math.random() * 0.7 + k * 0.4, s0: 0.5 + k * 0.3, s1: 2.6 + k * 1.4, r: 0.96, g: 0.97, b: 1, a: 0.42 + k * 0.3, drag: 1.6,
      });
    }
  }

  /** 刀刃擦地／擦牆的火花 */
  sparks(point, vel, n = 6) {
    for (let i = 0; i < n; i++) {
      this.glow.spawn({
        x: point.x, y: point.y, z: point.z,
        vx: -vel.x * 0.25 + (Math.random() - 0.5) * 9, vy: 2 + Math.random() * 7, vz: -vel.z * 0.25 + (Math.random() - 0.5) * 9,
        max: 0.2 + Math.random() * 0.3, s0: 0.16 + Math.random() * 0.12, s1: 0.03, r: 1, g: 0.6 + Math.random() * 0.3, b: 0.15, grav: 26, drag: 1.2,
      });
    }
  }

  /** 風壓漩渦：高速繞圈、衝刺、兵長斬時身邊的旋風。k = 0～1 */
  updateSwirl(dt, pos, vel, k) {
    const m = this.swirl;
    const mat = m.material;
    mat.opacity += (k * 0.55 - mat.opacity) * Math.min(1, dt * 8);
    m.visible = mat.opacity > 0.02;
    if (!m.visible) return;
    const sp = vel.length();
    if (sp > 1) {
      _v.copy(vel).multiplyScalar(1 / sp);
      _q.setFromUnitVectors(_Y, _v);
      m.quaternion.slerp(_q, Math.min(1, dt * 12));
    }
    m.position.copy(pos).addScaledVector(_v, -0.6);
    m.position.y += 0.2;
    m.scale.set(1, 1 + k * 0.8, 1);
    mat.map.offset.x -= dt * (2.5 + k * 3);
    mat.map.offset.y -= dt * 1.5;
  }

  dust(pos, vel, amount) {
    for (let i = 0; i < amount; i++) {
      this.smoke.spawn({
        x: pos.x + (Math.random() - 0.5), y: pos.y - 0.45, z: pos.z + (Math.random() - 0.5),
        vx: vel.x * 0.3 + (Math.random() - 0.5) * 4, vy: 1 + Math.random() * 2.5, vz: vel.z * 0.3 + (Math.random() - 0.5) * 4,
        max: 0.6 + Math.random() * 0.6, s0: 0.5, s1: 2.2, r: 0.62, g: 0.57, b: 0.5, a: 0.55, drag: 2.5,
      });
    }
  }

  slash(pos, dir, side, big) {
    const color = big ? '#ffe2b0' : '#dff2ff';
    this.slashes.spawn(pos, dir, 0.6 * side, big ? 2.6 : 1.7, color);
    this.slashes.spawn(pos, dir, Math.PI + 0.6 * side, big ? 2.2 : 1.4, '#bfe0ff', 0.6);
  }

  /** 鎖定繞圈接近目標時，自動甩出的淡刀光（連續揮刀的感覺） */
  idleSlash(pos, dir, side) {
    this.slashes.spawn(pos, dir, (0.5 + Math.random() * 0.6) * side, 1.5 + Math.random() * 0.4, '#d8ecff', 0.35, 0.22);
  }

  /** 命中點的大閃光 */
  burst(point, size, color, life = 0.22) {
    const f = this.flashes[this.fi];
    this.fi = (this.fi + 1) % this.flashes.length;
    f.m.position.copy(point);
    f.m.visible = true;
    f.t = f.max = life;
    f.size = size;
    f.m.material.color.set(color);
  }

  /** 斬擊命中：交叉的長刀光線（白色核心 + 紅色外層） */
  bladeHit(point, dir, big) {
    const up = _v.set(0, 1, 0);
    const side = _v2.crossVectors(dir, up);
    if (side.lengthSq() < 1e-4) side.set(1, 0, 0);
    side.normalize();
    const len = big ? 13 : 9;
    // 兩刀：一刀斜下、一刀斜上，交叉成 X
    for (const tilt of [0.45, -0.35]) {
      const d = side.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(up, Math.sin(tilt));
      this.streaks.spawn(point, d, len * 1.05, big ? 0.6 : 0.45, '#ff3a2a', 0.38);
      this.streaks.spawn(point, d, len, big ? 0.2 : 0.14, '#ffffff', 0.32);
    }
  }

  /** 刀身殘光：飛行速度越快越亮；揮刀時全亮 */
  updateBlades(model, speed, slashing) {
    const k = slashing ? 1 : Math.max(0, Math.min(0.45, (speed - 15) / 50));
    for (const side of ['left', 'right']) {
      model.bladeWorld(side, this._bBase, this._bTip, slashing);
      this.blades[side].update(this._bBase, this._bTip, k);
    }
  }

  /** 迴旋斬：繞著角色一圈的刀光 */
  spinRing(pos, color = '#bfe6ff') {
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const dir = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
      this.slashes.spawn(_v2.copy(pos).addScaledVector(dir, 1.2), dir, Math.PI / 2, 2.4, color);
    }
    for (let i = 0; i < 24; i++) {
      const a = Math.random() * Math.PI * 2;
      this.glow.spawn({ x: pos.x, y: pos.y + 0.3, z: pos.z, vx: Math.sin(a) * 16, vy: (Math.random() - 0.5) * 3, vz: Math.cos(a) * 16, max: 0.3, s0: 0.4, s1: 0.05, r: 0.75, g: 0.9, b: 1, drag: 3 });
    }
  }

  /** 兵長斬：刀身殘光換成粉紅色 */
  setBladeTint(levi) {
    if (this._bladeTint === levi) return;
    this._bladeTint = levi;
    this.blades.left.color.set(levi ? '#ff4f9a' : '#b98bff');
    this.blades.right.color.set(levi ? '#ff86c0' : '#7fd8ff');
  }

  /** 兵長斬蓄力：紅光往內收 */
  leviCharge(pos) {
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * Math.PI * 2, e = (Math.random() - 0.5) * 2;
      const dx = Math.sin(a) * 3, dz = Math.cos(a) * 3, dy = e * 2;
      this.glow.spawn({ x: pos.x + dx, y: pos.y + 0.3 + dy, z: pos.z + dz, vx: -dx * 7, vy: -dy * 7, vz: -dz * 7, max: 0.18, s0: 0.35, s1: 0.05, r: 1, g: 0.2, b: 0.25, drag: 2 });
    }
  }

  /** 兵長斬的粉紅殘光（直衝時又多又長） */
  leviTrail(pos, dashing) {
    const n = dashing ? 7 : 1;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = dashing ? 0.6 + Math.random() * 0.6 : 0.8;
      this.glow.spawn({ x: pos.x + Math.sin(a) * r, y: pos.y + 0.3 + Math.cos(a) * r, z: pos.z + Math.cos(a) * r * 0.6, vx: 0, vy: 0, vz: 0, max: dashing ? 0.45 : 0.25, s0: dashing ? 0.8 : 0.4, s1: 0.08, r: 1, g: 0.35 + Math.random() * 0.25, b: 0.65, a: 0.9 });
    }
  }

  /** 衝刺斬的殘光 */
  trail(pos) {
    for (let i = 0; i < 3; i++) {
      this.glow.spawn({ x: pos.x + (Math.random() - 0.5) * 0.4, y: pos.y + 0.3 + (Math.random() - 0.5) * 0.6, z: pos.z + (Math.random() - 0.5) * 0.4, vx: 0, vy: 0, vz: 0, max: 0.25, s0: 0.7, s1: 0.1, r: 0.6, g: 0.85, b: 1, a: 0.8 });
    }
  }

  /** 命中弱點：蒸氣、火花與噴血 */
  napeHit(point, dir, big) {
    const n = big ? 80 : 45;
    for (let i = 0; i < n; i++) {
      this.glow.spawn({ x: point.x, y: point.y, z: point.z, vx: dir.x * 15 + (Math.random() - 0.5) * 26, vy: (Math.random() - 0.3) * 20, vz: dir.z * 15 + (Math.random() - 0.5) * 26, max: 0.3 + Math.random() * 0.4, s0: 0.45, s1: 0.05, r: 1, g: 0.45 + Math.random() * 0.3, b: 0.2, grav: 18, drag: 1.5 });
    }
    for (let i = 0; i < n * 0.6; i++) {
      this.smoke.spawn({ x: point.x, y: point.y, z: point.z, vx: (Math.random() - 0.5) * 8, vy: 2 + Math.random() * 6, vz: (Math.random() - 0.5) * 8, max: 1.2 + Math.random(), s0: 0.6, s1: 2.6, r: 0.95, g: 0.93, b: 0.92, a: 0.45, drag: 1.2 });
      this.smoke.spawn({ x: point.x, y: point.y, z: point.z, vx: (Math.random() - 0.5) * 10, vy: (Math.random() - 0.2) * 8, vz: (Math.random() - 0.5) * 10, max: 0.6, s0: 0.5, s1: 1.2, r: 0.75, g: 0.1, b: 0.08, a: 0.8, grav: 10, drag: 1 });
    }
    // 沿刀路方向噴出的大量血花
    for (let i = 0; i < n; i++) {
      const sp = 10 + Math.random() * 22;
      this.smoke.spawn({ x: point.x, y: point.y, z: point.z, vx: dir.x * sp + (Math.random() - 0.5) * 12, vy: 4 + Math.random() * 12, vz: dir.z * sp + (Math.random() - 0.5) * 12, max: 0.7 + Math.random() * 0.5, s0: 0.35 + Math.random() * 0.5, s1: 0.9, r: 0.7 + Math.random() * 0.2, g: 0.04, b: 0.05, a: 0.95, grav: 22, drag: 0.8 });
    }
  }

  /** 巨人倒下時持續冒出蒸氣 */
  steam(point, rate) {
    for (let i = 0; i < rate; i++) {
      this.smoke.spawn({ x: point.x + (Math.random() - 0.5) * 6, y: point.y + Math.random() * 2, z: point.z + (Math.random() - 0.5) * 6, vx: (Math.random() - 0.5) * 2, vy: 3 + Math.random() * 4, vz: (Math.random() - 0.5) * 2, max: 2 + Math.random() * 1.5, s0: 1.5, s1: 7, r: 0.96, g: 0.95, b: 0.95, a: 0.45, drag: 0.5 });
    }
  }

  update(dt, pc, model, camera) {
    this.glow.update(dt);
    this.smoke.update(dt);
    this.speedLines.update(dt, pc.pos, pc.vel, pc.speed > 1e-3 ? pc.feelSpeed / pc.speed : 1);
    this.slashes.update(dt);
    if (camera) this.streaks.update(dt, camera);
    for (const f of this.flashes) {
      if (!f.m.visible) continue;
      f.t -= dt;
      const k = Math.max(0, f.t / f.max);
      f.m.scale.setScalar(f.size * (0.3 + (1 - k) * 1.1));
      f.m.material.opacity = k;
      if (f.t <= 0) f.m.visible = false;
    }
    for (const side of ['left', 'right']) {
      const h = pc.hooks[side];
      const r = this.ropes[side];
      if (!h.active) {
        r.hide();
        continue;
      }
      model.launcherWorld(side, _from);
      if (h.attached) h.anchor(_to);
      else _to.copy(h.head);
      r.set(_from, _to, h.attached && h.taut, h.attached, camera, dt, h.length);
      // 鉤爪飛行中：沿路留下白色光跡
      if (!h.attached) {
        for (let i = 0; i < 2; i++) {
          this.glow.spawn({ x: _to.x + (Math.random() - 0.5) * 0.3, y: _to.y + (Math.random() - 0.5) * 0.3, z: _to.z + (Math.random() - 0.5) * 0.3, vx: 0, vy: 0, vz: 0, max: 0.35, s0: 0.45, s1: 0.05, r: 0.9, g: 0.95, b: 1, a: 0.9 });
        }
      }
    }
  }

  /** 瓦斯軌跡線：噴口在腰後兩側（氣罐的位置） */
  updateTrailLines(dt, emit, pc, model, camera) {
    const yaw = model.yaw;
    const rx = Math.cos(yaw), rz = -Math.sin(yaw), fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    for (const [k, sx] of [[0, -1], [1, 1]]) {
      this._tsrc[k].set(pc.pos.x + rx * 0.32 * sx - fx * 0.45, pc.pos.y + 0.1, pc.pos.z + rz * 0.32 * sx - fz * 0.45);
    }
    this.trailLines.update(dt, emit, this._tsrc, camera);
  }

  reset() {
    this.trailLines.clear();
    this.speedLines.clear();
    for (const p of this.glow.p) p.life = 0;
    for (const p of this.smoke.p) p.life = 0;
  }
}
