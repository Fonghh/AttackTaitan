// 手機觸控操作：左下動態搖桿、右側按鈕、空白處拖曳轉視角。
// 鋼索按鈕兩種模式：'smart'（智慧單鉤，預設）與 'dual'（右側雙鉤）。

const LONG_PRESS = 0.3;

export class TouchControls {
  constructor(root, input, cfg) {
    this.input = input;
    this.cfg = cfg;
    this.root = root;
    this.mode = 'smart';
    try {
      this.mode = localStorage.getItem('hookMode') || 'smart';
    } catch {}
    this.joy = null; // { id, ox, oy }
    this.looks = new Map(); // pointerId → {x, y}

    root.innerHTML = `
      <div class="joy-base" hidden><div class="joy-knob"></div></div>
      <button class="tbtn t-pause" data-act="pause" aria-label="暫停">II</button>
      <button class="tbtn t-boost" data-act="boost">加速</button>
      <button class="tbtn t-hook" data-act="smart">鋼索</button>
      <button class="tbtn t-hookL" data-act="toggleLeft">左鉤</button>
      <button class="tbtn t-hookR" data-act="toggleRight">右鉤</button>
      <button class="tbtn t-release" data-act="releaseAll">全解除</button>
      <button class="tbtn t-strike" data-act="strike">斬擊</button>
      <div class="t-hint">左下拖曳＝移動／往前推＝捲收　空白處拖曳＝轉視角</div>`;
    this.base = root.querySelector('.joy-base');
    this.knob = root.querySelector('.joy-knob');
    this.btn = {
      boost: root.querySelector('.t-boost'),
      smart: root.querySelector('.t-hook'),
      left: root.querySelector('.t-hookL'),
      right: root.querySelector('.t-hookR'),
      release: root.querySelector('.t-release'),
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
    try {
      localStorage.setItem('hookMode', mode);
    } catch {}
    this.applyMode();
  }

  applyMode() {
    const smart = this.mode === 'smart';
    this.btn.smart.hidden = !smart;
    this.btn.left.hidden = smart;
    this.btn.right.hidden = smart;
    this.btn.release.hidden = smart;
  }

  show(on) {
    this.root.hidden = !on;
    this.input.touch.active = on;
  }

  /** 依鋼索狀態讓按鈕亮起 */
  sync(pc) {
    const l = pc.hooks.left.active, r = pc.hooks.right.active;
    this.btn.left.classList.toggle('on', l);
    this.btn.right.classList.toggle('on', r);
    this.btn.smart.classList.toggle('on', l || r);
    this.btn.smart.textContent = l && r ? '鋼索×2' : '鋼索';
    this.btn.boost.classList.toggle('on', pc.boosting);
    this.btn.boost.style.setProperty('--gas', `${(pc.gas / this.cfg.boost.gasMax) * 100}%`);
  }

  _bindButton(b) {
    const act = b.dataset.act;
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      b.setPointerCapture?.(e.pointerId);
      b.classList.add('pressed');
      if (act === 'boost') this.input.touch.boost = true;
      else if (act === 'smart') {
        b._t = performance.now();
        clearTimeout(b._lp);
        b._lpFired = false;
        b._lp = setTimeout(() => {
          b._lpFired = true;
          this.input.push('releaseAll');
          navigator.vibrate?.(20);
        }, LONG_PRESS * 1000);
      } else this.input.push(act);
    });
    const end = (e) => {
      e.stopPropagation();
      b.classList.remove('pressed');
      if (act === 'boost') this.input.touch.boost = false;
      if (act === 'smart' && b._lp) {
        clearTimeout(b._lp);
        b._lp = null;
        if (!b._lpFired) this.input.push('smartHook');
      }
    };
    b.addEventListener('pointerup', end);
    b.addEventListener('pointercancel', end);
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
    this.root.setPointerCapture?.(e.pointerId);
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
