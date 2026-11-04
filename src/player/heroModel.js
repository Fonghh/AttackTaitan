// Blender 做的主角（public/models/hero.glb）：骨架＋動作。
// 做法：沿用 PlayerModel 的程式姿勢（傾斜、轉身、各種狀態的手腳角度都已經調好），把它的關節角度「轉貼」到 Blender 的骨頭上；
// 待機、奔跑、斬擊、翻滾、後空翻、被打飛改播 Blender 做的動作。最後整個姿勢做一點平滑，切換動作時不會跳格。
// 程式模型本身留著當「姿勢來源」，只是隱藏起來。
import * as THREE from 'three';
import { PlayerModel } from './playerModel.js';
import { toToonMaterial, outlineMaterial, addOutlines } from '../fx/toon.js';

const SCALE = 1.15; // Blender 主角 1.65m → 和舊模型差不多高
const _q = new THREE.Quaternion();
const _qi = new THREE.Quaternion();
const _v = new THREE.Vector3();
const NO_OUTLINE = new Set(['eye_white', 'iris', 'eye_dark', 'blade', 'cape', 'metal', 'leather']);
const BODY_MATS = new Set(['skin', 'jacket', 'shirt', 'pants', 'boots', 'cape', 'hair', 'wrap']);
const METAL_MATS = new Set(['metal', 'blade', 'dark_metal', 'box_metal']);

export class HeroModel extends PlayerModel {
  /**
   * @param {THREE.Scene} scene
   * @param {any} cfg
   * @param {{scene: THREE.Group, animations: THREE.AnimationClip[]}} gltf
   */
  constructor(scene, cfg, gltf) {
    super(scene, cfg);
    const toon = cfg.style === 'toon';
    // 程式模型只當姿勢來源：網格全部藏起來
    this.root.traverse((o) => {
      if (o.isMesh) o.visible = false;
    });

    const rig = gltf.scene;
    this.rig = rig;
    this.rigRoot = new THREE.Group();
    this.rigRoot.rotation.y = Math.PI; // Blender 臉朝 -Y → glTF 臉朝 +Z → 轉成遊戲的 -Z
    this.rigRoot.scale.setScalar(SCALE);
    this.rigRoot.add(rig);
    this.body.add(this.rigRoot);

    // 材質：卡通畫風換成分階明暗；收集發光（兵長斬）與金屬反光要用的材質
    const swap = new Map();
    this.bodyMats = [];
    this.metalMats = [];
    rig.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      if (o.isSkinnedMesh) o.frustumCulled = false;
      const m0 = o.material;
      if (!swap.has(m0)) {
        let m = toon ? toToonMaterial(m0) : m0;
        if (m0.name === 'cape') m.side = THREE.DoubleSide;
        if (m0.name === 'skin' && toon) m.emissive.set(m.color).multiplyScalar(0.22);
        if (m0.name === 'blade') {
          m.emissive?.set('#1a2533');
          m.envMapIntensity = 1.6;
        }
        swap.set(m0, m);
        if (BODY_MATS.has(m0.name)) this.bodyMats.push(m);
        if (METAL_MATS.has(m0.name)) this.metalMats.push(m);
      }
      o.material = swap.get(m0);
    });
    if (toon) {
      this.heroOutline = outlineMaterial(0.008, '#3b2a2e');
      addOutlines(rig, this.heroOutline, (o) => o.isSkinnedMesh || NO_OUTLINE.has(o.material.name));
    }

    // 標記點
    const find = (n) => rig.getObjectByName(n);
    this.marks = {
      bladeL: find('blade_L'), bladeLBase: find('blade_L_base'), bladeR: find('blade_R'), bladeRBase: find('blade_R_base'),
      launcherL: find('launcher_L_tip'), launcherR: find('launcher_R_tip'),
    };

    // 骨頭：記下靜止姿勢（本地旋轉 L0、在身體座標裡的旋轉 W0）
    this.root.updateMatrixWorld(true);
    this.body.getWorldQuaternion(_qi).invert();
    this.bones = [];
    this.boneMap = {};
    rig.traverse((o) => {
      if (!o.isBone) return;
      const b = { o, L0: o.quaternion.clone(), P0: o.position.clone(), W0: o.getWorldQuaternion(new THREE.Quaternion()).premultiply(_qi), q: new THREE.Quaternion(), p: new THREE.Vector3(), sq: o.quaternion.clone(), sp: o.position.clone() };
      b.W0i = b.W0.clone().invert();
      this.bones.push(b);
      this.boneMap[o.name] = b;
    });
    // 程式關節 → 骨頭
    const A = this;
    this.retarget = [
      ['hips', () => A.hips],
      ['head', () => A.head],
      ['upperarm_L', () => A.armL.shoulder], ['forearm_L', () => A.armL.fore], ['hand_L', () => A.armL.sword],
      ['upperarm_R', () => A.armR.shoulder], ['forearm_R', () => A.armR.fore], ['hand_R', () => A.armR.sword],
      ['thigh_L', () => A.legL.hip], ['shin_L', () => A.legL.knee],
      ['thigh_R', () => A.legR.hip], ['shin_R', () => A.legR.knee],
    ].filter(([n]) => this.boneMap[n]);
    const hb = this.boneMap.hips;
    this._hipsParentQi = hb ? hb.o.parent.getWorldQuaternion(new THREE.Quaternion()).premultiply(_qi).invert() : null;
    this._hipsParentScale = hb ? hb.o.parent.getWorldScale(new THREE.Vector3()).x : 1;

    // 動作
    this.mixer = new THREE.AnimationMixer(rig);
    this.clips = {};
    for (const clip of gltf.animations) {
      const a = this.mixer.clipAction(clip);
      a.setLoop(THREE.LoopRepeat, Infinity);
      this.clips[clip.name] = { action: a, dur: clip.duration };
    }
    this._curClip = null;
    this.idleT = 0;
    this.runT = 0;
    this._first = true;
    this.isHero = true;
  }

  bladeWorld(side, base, tip, full = true) {
    const m = this.marks;
    const t = side === 'left' ? m.bladeL : m.bladeR;
    const b = side === 'left' ? m.bladeLBase : m.bladeRBase;
    if (!t || !b) return super.bladeWorld(side, base, tip, full);
    b.getWorldPosition(base);
    t.getWorldPosition(tip);
    if (!full) base.lerp(tip, 0.7); // 飛行時只取刀尖一小段
  }

  launcherWorld(side, out) {
    const l = side === 'left' ? this.marks.launcherL : this.marks.launcherR;
    return l ? l.getWorldPosition(out) : super.launcherWorld(side, out);
  }

  /** 這一格要播哪個 Blender 動作：[名稱, 時間] 或 null（用程式姿勢） */
  _pickClip(dt, pc) {
    const hs = Math.hypot(pc.vel.x, pc.vel.z);
    if (this.leviMode) return null;
    if (this.slashTimer > 0) {
      const k = 1 - Math.max(0, this.slashTimer) / 0.28;
      const name = this.spinTimer > 0 || this.slashType === 'side' ? (this.slashSide > 0 ? 'slash_side' : 'slash_side2') : this.slashType === 'down' ? 'slash_down' : 'slash_cross';
      return [name, k];
    }
    if (this.hurtTimer > 0) return ['hurt', 1 - this.hurtTimer / 0.6];
    if (pc.flip?.phase === 'back') return ['backflip', 1 - Math.max(0, pc.flip.t) / pc.flip.time];
    if (pc.flip?.phase === 'tuck') return ['roll', 0.25 + 0.5 * (1 - Math.max(0, pc.flip.t) / pc.flip.tuck)];
    if (this.landAnim?.kind === 'roll') return ['roll', this.landAnim.t / this.landAnim.dur];
    if (this.landAnim || pc.sliding) return null;
    if (pc.grounded && this._running) {
      this.runT += (dt * (hs + 5)) / (Math.PI * 2);
      return ['run', this.runT % 1];
    }
    if (pc.grounded && hs <= 0.5) {
      this.idleT += dt / 2;
      return ['idle', this.idleT % 1];
    }
    return null;
  }

  update(dt, pc, camYaw, faceYaw = null) {
    super.update(dt, pc, camYaw, faceYaw);
    const bones = this.bones;
    // 1) 程式姿勢轉貼到骨頭：local = L0 · W0⁻¹ · q · W0
    for (const b of bones) {
      b.q.copy(b.L0);
      b.p.copy(b.P0);
    }
    for (const [name, get] of this.retarget) {
      const b = this.boneMap[name];
      const j = get();
      _q.copy(b.W0i).multiply(j.quaternion).multiply(b.W0);
      b.q.copy(b.L0).multiply(_q);
    }
    const hb = this.boneMap.hips;
    if (hb && this._hipsParentQi) {
      _v.set(0, this.hips.position.y - 0.95, 0).applyQuaternion(this._hipsParentQi).divideScalar(this._hipsParentScale);
      hb.p.add(_v);
    }
    // 2) Blender 動作（有的話蓋過程式姿勢）
    const pick = this._pickClip(dt, pc);
    const clip = pick && this.clips[pick[0]];
    if (clip) {
      if (this._curClip !== clip) {
        if (this._curClip) this._curClip.action.stop();
        clip.action.play();
        this._curClip = clip;
      }
      clip.action.time = Math.max(0, Math.min(0.999, pick[1])) * clip.dur;
      this.mixer.update(0);
      for (const b of bones) {
        b.q.copy(b.o.quaternion);
        b.p.copy(b.o.position);
      }
    } else if (this._curClip) {
      this._curClip.action.stop();
      this._curClip = null;
    }
    // 3) 斗篷：照程式的布料模擬（被速度吹向後方、側向移動吹向側邊、下墜時往上飄）
    const cs = this.capeSim;
    if (cs) {
      const flutter = Math.min(1, pc.speed / 35);
      const w = Math.sin(this.time * (8 + flutter * 14));
      const ang = [
        cs.back[2] * 1.3 + cs.lift[2] * 1.2,
        (cs.back[5] - cs.back[2]) * 1.6 + cs.lift[5] * 0.6 + w * 0.12 * (0.3 + flutter),
        (cs.back[7] - cs.back[5]) * 2.0 + Math.sin(this.time * (8 + flutter * 14) + 1.3) * 0.18 * (0.3 + flutter),
      ];
      const side = [cs.side[2] * 1.3, (cs.side[5] - cs.side[2]) * 1.4, (cs.side[7] - cs.side[5]) * 1.6];
      for (let i = 0; i < 3; i++) {
        const b = this.boneMap[`cape_${i + 1}`];
        if (!b) continue;
        _q.setFromEuler(new THREE.Euler(-Math.min(1.5, ang[i]), 0, side[i], 'XYZ'));
        b.q.copy(b.L0).multiply(_q.premultiply(b.W0i).multiply(b.W0));
      }
    }
    // 4) 平滑：揮刀、翻滾這種快的動作跟得緊，其他切換慢一點（不會跳格）
    const fast = this.slashTimer > 0 || this.hurtTimer > 0 || pc.flip || this.landAnim;
    const a = this._first ? 1 : 1 - Math.exp(-dt * (fast ? 40 : 16));
    this._first = false;
    for (const b of bones) {
      b.sq.slerp(b.q, a);
      b.sp.lerp(b.p, a);
      b.o.quaternion.copy(b.sq);
      b.o.position.copy(b.sp);
    }
  }
}
