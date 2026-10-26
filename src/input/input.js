// 輸入整合：鍵盤滑鼠與觸控合併成每幀一份 intent。
// 離散操作（發射、解除、斬擊…）放進事件佇列，連續操作（移動、捲收、加速）以狀態提供。

export const isTouchDevice = () =>
  typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0) && matchMedia('(pointer: coarse)').matches;

export class Input {
  constructor(canvas, cfg) {
    this.canvas = canvas;
    this.cfg = cfg;
    this.keys = new Set();
    this.queue = [];
    this.lookDX = 0;
    this.lookDY = 0;
    this.manualLook = false;
    this.mouse = { left: false, right: false };
    this.locked = false;
    this.enabled = false;
    // 觸控狀態（由 TouchControls 寫入）
    this.touch = { joyX: 0, joyY: 0, boost: false, active: false, aimX: 0, aimY: 0, turnX: 0, turnY: 0 }; // aimX/Y：準心 -1..1；turnX/Y：鏡頭轉動 -1..1
    this._prevBoost = false;
    this._prevJump = false;

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      const map = { KeyE: 'strike', KeyF: 'strike', KeyQ: 'releaseAll', KeyR: 'restart', Escape: 'pause', KeyH: 'help', KeyP: 'pause' };
      if (map[e.code]) this.queue.push(map[e.code]);
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    });
    addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'KeyE' || e.code === 'KeyF') this.queue.push('strikeUp'); // 長按斬擊（兵長斬）的放開
    });
    addEventListener('blur', () => {
      this.keys.clear();
      this.queue.push('strikeUp');
      if (this.mouse.left) this.queue.push('up:left');
      if (this.mouse.right) this.queue.push('up:right');
      this.mouse.left = this.mouse.right = false;
    });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled || !this.locked) return;
      if (e.button === 0) {
        this.mouse.left = true;
        this.queue.push('down:left');
      } else if (e.button === 2) {
        this.mouse.right = true;
        this.queue.push('down:right');
      }
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0 && this.mouse.left) {
        this.mouse.left = false;
        this.queue.push('up:left');
      } else if (e.button === 2 && this.mouse.right) {
        this.mouse.right = false;
        this.queue.push('up:right');
      }
    });
    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.lookDX += e.movementX * this.cfg.sensitivity.mouse;
      this.lookDY += e.movementY * this.cfg.sensitivity.mouse;
      this.manualLook = true;
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked && this.enabled) this.queue.push('lockLost');
    });
  }

  requestLock() {
    const c = this.canvas;
    if (!c.requestPointerLock) return;
    const fallback = () => {
      try {
        const p = c.requestPointerLock();
        if (p && p.catch) p.catch(() => {});
      } catch {}
    };
    try {
      const p = c.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(fallback);
    } catch {
      fallback();
    }
  }

  push(evt) {
    this.queue.push(evt);
  }

  addLook(dx, dy) {
    this.lookDX += dx;
    this.lookDY += dy;
    this.manualLook = true;
  }

  /** 取得本幀的輸入並清空累積量 */
  poll() {
    const k = this.keys;
    let mx = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    let my = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const t = this.touch;
    if (t.active && (Math.abs(t.joyX) > 0.05 || Math.abs(t.joyY) > 0.05)) {
      mx = t.joyX;
      my = t.joyY;
    }
    const space = k.has('Space');
    const boost = k.has('ShiftLeft') || k.has('ShiftRight') || t.boost;
    // 捲收：只有 Space（電腦）。手機搖桿往前推只是往前飛，不再捲收（避免被拉去撞牆）
    const reel = space ? 1 : 0;
    const reelStrong = space;
    const intent = {
      move: { x: mx, y: my },
      boost,
      boostPressed: boost && !this._prevBoost,
      jump: space && !this._prevJump,
      jumpHeld: space,
      reel,
      reelStrong,
      lookDX: this.lookDX,
      lookDY: this.lookDY,
      manualLook: this.manualLook,
      events: this.queue.splice(0),
    };
    this._prevBoost = boost;
    this._prevJump = space;
    this.lookDX = this.lookDY = 0;
    this.manualLook = false;
    return intent;
  }
}
