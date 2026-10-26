// 手機觸控操作：左下動態搖桿、右側按鈕、空白處拖曳轉視角。
// 鋼索按鈕＝準心搖桿：按住拖曳時準心在畫面上移動（鏡頭不轉），放開＝朝準心發射
//   （已勾住時會直接換到新勾點）；點一下＝沒勾住時朝畫面中央發射、已勾住時放索。
// 'single'（單索，預設）／'dual'（左右雙鉤）。

const TAP_MOVE = 14; // 手指移動小於此距離（px）視為點一下

export class TouchControls {
  constructor(root, input, cfg) {
    this.input = input;
    this.cfg = cfg;
    this.root = root;
    this.mode = 'single';
    this.joy = null; // { id, ox, oy }
    this.hookActive = { auto: false, left: false, right: false };
    this.looks = new Map(); // pointerId → {x, y}

    root.innerHTML = `
      <div class="joy-base" hidden><div class="joy-knob"></div></div>
      <button class="tbtn t-pause" data-act="pause" aria-label="暫停">II</button>
      <button class="tbtn t-boost" data-act="boost">衝刺</button>
      <div class="aim-stick" hidden><div class="aim-knob"></div></div>
      <button class="tbtn t-hook" data-hold="auto"><span>鋼索</span><small>拖曳瞄準</small></button>
      <button class="tbtn t-hookL" data-hold="left">左鉤</button>
      <button class="tbtn t-hookR" data-hold="right">右鉤</button>
      <button class="tbtn t-strike" data-act="strike">斬擊</button>
      <div class="t-hint">左下＝移動。按住「鋼索」拖曳移動準心、放開發射；勾住後點一下放索</div>`;
    this.base = root.querySelector('.joy-base');
    this.knob = root.querySelector('.joy-knob');
    this.aimStick = root.querySelector('.aim-stick');
    this.aimKnob = root.querySelector('.aim-knob');
    this.btn = {
      boost: root.querySelector('.t-boost'),
      auto: root.querySelector('.t-hook'),
      left: root.querySelector('.t-hookL'),
      right: root.querySelector('.t-hookR'),
      strike: root.querySelector('.t-strike'),
    };
    this.applyMode();

    for (const b of root.querySelectorAll('.tbtn')) this._bindButton(b);

    root.addEventListener('pointerdown', (e) => this._down(e));
    root.addEventListener('pointermove', (e) => this._move(e));
    root.addEventListener('pointerup', (e) => this._up(e));
    root.addEventListener('pointercancel', (e) => this._up(e));
  }

  setMode(mode) {
    this.mode = mode;
    this.applyMode();
  }

  applyMode() {
    const single = this.mode === 'single';
    this.btn.auto.hidden = !single;
    this.btn.left.hidden = single;
    this.btn.right.hidden = single;
  }

  show(on) {
    this.root.hidden = !on;
    this.input.touch.active = on;
    if (!on) this._releaseAll();
  }

  _releaseAll() {
    for (const b of this.root.querySelectorAll('.tbtn.pressed')) {
      b.classList.remove('pressed');
      b._drag = null;
    }
    this.input.touch.boost = false;
  }

  /** 依鋼索狀態讓按鈕亮起 */
  sync(pc, canHook) {
    const l = pc.hooks.left.active, r = pc.hooks.right.active;
    this.hookActive.auto = l || r;
    this.hookActive.left = l;
    this.hookActive.right = r;
    const label = this.btn.auto.firstElementChild;
    const sub = this.btn.auto.lastElementChild;
    const t = l || r ? ['放索', '點一下／拖曳換勾'] : ['鋼索', '拖曳瞄準'];
    if (label.textContent !== t[0]) {
      label.textContent = t[0];
      sub.textContent = t[1];
    }
    this.btn.left.classList.toggle('on', l);
    this.btn.right.classList.toggle('on', r);
    this.btn.auto.classList.toggle('on', l || r);
    this.btn.auto.classList.toggle('no-target', !canHook && !(l || r));
    this.btn.boost.classList.toggle('on', pc.boosting || pc.dashing);
    this.btn.boost.style.setProperty('--gas', `${(pc.gas / this.cfg.boost.gasMax) * 100}%`);
  }

  cancelAim() {
    for (const b of Object.values(this.btn)) b._drag = null;
    this._setReticle(0, 0);
    this.aimStick.hidden = true;
  }

  _setReticle(x, y) {
    this.input.touch.aimX = x;
    this.input.touch.aimY = y;
  }

  _bindButton(b) {
    const act = b.dataset.act;
    const hold = b.dataset.hold;
    const R = this.cfg.reticle.stickRadius;
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        b.setPointerCapture?.(e.pointerId);
      } catch {}
      b.classList.add('pressed');
      if (hold) {
        b._drag = { id: e.pointerId, ox: e.clientX, oy: e.clientY, moved: 0, t: performance.now() };
        this.aimStick.hidden = false;
        this.aimStick.style.left = `${e.clientX}px`;
        this.aimStick.style.top = `${e.clientY}px`;
        this.aimKnob.style.transform = 'translate(-50%, -50%)';
      } else if (act === 'boost') this.input.touch.boost = true;
      else this.input.push(act);
    });
    if (hold) {
      b.addEventListener('pointermove', (e) => {
        const d = b._drag;
        if (!d || e.pointerId !== d.id) return;
        e.stopPropagation();
        let dx = e.clientX - d.ox, dy = e.clientY - d.oy;
        d.moved = Math.max(d.moved, Math.hypot(dx, dy));
        const l = Math.hypot(dx, dy);
        if (l > R) {
          dx = (dx / l) * R;
          dy = (dy / l) * R;
        }
        this.aimKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
        // 類比搖桿：推多遠，準心就離畫面中央多遠
        this._setReticle(dx / R, -dy / R);
      });
    }
    const end = (e, cancelled) => {
      e.stopPropagation();
      if (!b.classList.contains('pressed')) return;
      b.classList.remove('pressed');
      if (act === 'boost') this.input.touch.boost = false;
      const d = b._drag;
      b._drag = null;
      if (!hold || !d) return;
      this.aimStick.hidden = true;
      if (!cancelled) {
        const tap = d.moved < TAP_MOVE;
        // 點一下：切換（沒勾住→發射、勾住→放索）；拖曳後放開：朝準心發射（勾住時換勾點）
        this.input.push(tap ? `down:${hold}` : `aim:${hold}`);
      }
      // 準心在遊戲處理完這次發射後才回到中央（見 Game）
      this.input.push('reticleReset');
    };
    b.addEventListener('pointerup', (e) => end(e, false));
    b.addEventListener('pointercancel', (e) => end(e, true));
  }

  _down(e) {
    if (e.target.closest('.tbtn')) return;
    e.preventDefault();
    const w = innerWidth, h = innerHeight;
    if (!this.joy && e.clientX < w * 0.5 && e.clientY > h * 0.5) {
      this.joy = { id: e.pointerId, ox: e.clientX, oy: e.clientY };
      this.base.hidden = false;
      this.base.style.left = `${e.clientX}px`;
      this.base.style.top = `${e.clientY}px`;
      this.knob.style.transform = 'translate(-50%, -50%)';
    } else {
      this.looks.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    try {
      this.root.setPointerCapture?.(e.pointerId);
    } catch {}
  }

  _move(e) {
    if (this.joy && e.pointerId === this.joy.id) {
      const R = 55;
      let dx = e.clientX - this.joy.ox;
      let dy = e.clientY - this.joy.oy;
      const l = Math.hypot(dx, dy);
      if (l > R) {
        dx = (dx / l) * R;
        dy = (dy / l) * R;
      }
      this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      this.input.touch.joyX = dx / R;
      this.input.touch.joyY = -dy / R;
      return;
    }
    const lp = this.looks.get(e.pointerId);
    if (lp) {
      const s = this.cfg.sensitivity.touch;
      this.input.addLook((e.clientX - lp.x) * s, (e.clientY - lp.y) * s);
      lp.x = e.clientX;
      lp.y = e.clientY;
    }
  }

  _up(e) {
    if (this.joy && e.pointerId === this.joy.id) {
      this.joy = null;
      this.base.hidden = true;
      this.input.touch.joyX = this.input.touch.joyY = 0;
    }
    this.looks.delete(e.pointerId);
  }
}
