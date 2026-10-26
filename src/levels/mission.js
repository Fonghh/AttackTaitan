// 任務進行：訓練步驟、全部討伐、光圈競速。給 HUD 的任務文字、下一個目標點，以及是否完成。
import * as THREE from 'three';

export class Mission {
  /**
   * @param {object} level 關卡定義（levels.js）
   * @param {THREE.Scene|null} scene 有場景時建立光圈模型
   */
  constructor(level, scene) {
    this.level = level;
    this.type = level.objective;
    this.rings = (level.rings || []).map(([x, y, z]) => new THREE.Vector3(x, y, z));
    this.ringRadius = level.ringRadius ?? 6;
    this.ringMeshes = [];
    if (scene && this.rings.length) {
      const geo = new THREE.TorusGeometry(this.ringRadius, 0.45, 10, 40);
      this.rings.forEach((p, i) => {
        const m = new THREE.Mesh(
          geo,
          new THREE.MeshBasicMaterial({ color: '#ffd166', transparent: true, opacity: 0.9, depthWrite: false }),
        );
        m.position.copy(p);
        // 光圈面向下一個光圈（最後一個面向前一個）
        const to = this.rings[i + 1] || this.rings[i - 1];
        m.lookAt(to.x, p.y, to.z);
        scene.add(m);
        this.ringMeshes.push(m);
      });
    }
    this.reset();
  }

  reset() {
    this.done = new Set(); // 訓練：完成的步驟
    this.ringIndex = 0;
    this.kills = 0;
    this._syncRings();
  }

  /** 遊戲事件（hook / fling / dash / leg / nape / levi / kill），回傳要提示的文字或 null */
  event(type) {
    if (type === 'kill') this.kills++;
    if (this.type !== 'training') return null;
    const steps = this.level.steps;
    const step = steps.find((s) => s.id === type);
    if (!step || this.done.has(type)) return null;
    this.done.add(type);
    const left = steps.length - this.done.size;
    return left > 0 ? `✓ ${step.text.split('，')[0]}（還剩 ${left} 項）` : '✓ 訓練完成！';
  }

  /** 每幀：光圈通過判定。回傳剛通過的光圈編號（從 1 開始）或 0 */
  update(pos) {
    if (this.type !== 'rings' || this.ringIndex >= this.rings.length) return 0;
    if (pos.distanceTo(this.rings[this.ringIndex]) <= this.ringRadius + 1) {
      this.ringIndex++;
      this._syncRings();
      return this.ringIndex;
    }
    return 0;
  }

  _syncRings() {
    this.ringMeshes.forEach((m, i) => {
      const next = i === this.ringIndex;
      m.visible = i >= this.ringIndex;
      m.material.color.set(next ? '#ffd166' : '#8fd3ff');
      m.material.opacity = next ? 0.95 : 0.35;
      m.scale.setScalar(next ? 1 : 0.8);
    });
  }

  /** 光圈慢慢轉，下一個光圈脈動 */
  animate(time) {
    const m = this.ringMeshes[this.ringIndex];
    if (m) m.scale.setScalar(1 + Math.sin(time * 6) * 0.06);
  }

  /** 下一個目標點（光圈競速用），沒有則 null */
  get waypoint() {
    return this.type === 'rings' ? this.rings[this.ringIndex] || null : null;
  }

  /** 任務完成？ */
  complete(titans) {
    if (this.type === 'training') return this.done.size >= this.level.steps.length;
    if (this.type === 'rings') return this.ringIndex >= this.rings.length;
    return titans.length > 0 && titans.every((t) => t.state === 'dead');
  }

  /** HUD 上方的任務文字 */
  text(titans) {
    if (this.type === 'training') {
      const steps = this.level.steps;
      const cur = steps.find((s) => !this.done.has(s.id));
      return cur ? `訓練 ${this.done.size + 1}/${steps.length}：${cur.text}` : '訓練完成！';
    }
    if (this.type === 'rings') {
      return this.ringIndex >= this.rings.length ? '全部通過！' : `光圈 ${this.ringIndex + 1}/${this.rings.length}：穿過發光的黃色光圈`;
    }
    const dead = titans.filter((t) => !t.alive).length;
    return dead >= titans.length ? '全部討伐完成！' : `任務：討伐巨人 ${dead}/${titans.length}　弱點＝後頸（發光處）`;
  }
}
