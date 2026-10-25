// 遊戲介面：速度、氣體、生命、鋼索狀態、巨人血條、準星與預測標記、弱點提示、訊息與面板。
import * as THREE from 'three';

const _p = new THREE.Vector3();
const $ = (id) => document.getElementById(id);

export class Hud {
  constructor(cfg) {
    this.cfg = cfg;
    this.el = {
      speed: $('speed-val'),
      speedKmh: $('speed-kmh'),
      speedBar: $('speed-bar'),
      gas: $('gas-fill'),
      hp: $('hp-fill'),
      ropeL: $('rope-l'),
      ropeR: $('rope-r'),
      titanHp: $('titan-hp-fill'),
      titanHpText: $('titan-hp-text'),
      mark: { left: $('mark-l'), right: $('mark-r'), smart: $('mark-s') },
      nape: $('nape-marker'),
      napeDist: $('nape-dist'),
      napeArrow: $('nape-arrow'),
      checks: $('strike-checks'),
      chkDist: $('chk-dist'),
      chkSpeed: $('chk-speed'),
      chkAngle: $('chk-angle'),
      mission: $('mission'),
      toast: $('toast'),
      popups: $('popups'),
      vignette: $('vignette'),
      flash: $('flash'),
      hurt: $('hurt'),
      hang: $('hang-ind'),
      crosshair: $('crosshair'),
    };
    this.toastTimer = 0;
  }

  toast(text, cls = '', time = 1.4) {
    const t = this.el.toast;
    t.textContent = text;
    t.className = `show ${cls}`;
    this.toastTimer = time;
  }

  popup(screenX, screenY, text, cls) {
    const d = document.createElement('div');
    d.className = `popup ${cls}`;
    d.textContent = text;
    d.style.left = `${screenX}px`;
    d.style.top = `${screenY}px`;
    this.el.popups.appendChild(d);
    setTimeout(() => d.remove(), 1200);
  }

  flash(color = 'rgba(255,255,255,0.5)') {
    const f = this.el.flash;
    f.style.background = color;
    f.style.transition = 'none';
    f.style.opacity = '1';
    requestAnimationFrame(() => {
      f.style.transition = 'opacity 0.35s';
      f.style.opacity = '0';
    });
  }

  hurt() {
    const h = this.el.hurt;
    h.style.transition = 'none';
    h.style.opacity = '1';
    requestAnimationFrame(() => {
      h.style.transition = 'opacity 0.8s';
      h.style.opacity = '0';
    });
  }

  setMission(text) {
    this.el.mission.textContent = text;
  }

  /** 世界座標 → 螢幕座標；回傳 {x, y, behind} */
  project(world, camera, out = {}) {
    _p.copy(world).project(camera);
    out.behind = _p.z > 1;
    out.x = (_p.x * 0.5 + 0.5) * innerWidth;
    out.y = (-_p.y * 0.5 + 0.5) * innerHeight;
    return out;
  }

  update(dt, s) {
    const { pc, titan, camera, aims, strikeEval, napePos, touchMode, smartSide } = s;
    const e = this.el;
    const sp = pc.speed;
    e.speed.textContent = sp.toFixed(0);
    e.speedKmh.textContent = `${(sp * 3.6).toFixed(0)} km/h`;
    e.speedBar.style.width = `${Math.min(100, (sp / this.cfg.player.maxSpeed) * 100)}%`;
    e.speedBar.classList.toggle('fast', sp > 35);
    e.gas.style.width = `${(pc.gas / this.cfg.boost.gasMax) * 100}%`;
    e.gas.classList.toggle('low', pc.gas < 20);
    e.hp.style.width = `${(pc.hp / this.cfg.player.maxHp) * 100}%`;
    for (const side of ['left', 'right']) {
      const h = pc.hooks[side];
      const el = side === 'left' ? e.ropeL : e.ropeR;
      el.className = `rope ${h.attached ? 'attached' : h.active ? 'flying' : ''}`;
    }
    e.titanHp.style.width = `${(titan.hp / this.cfg.titan.hp) * 100}%`;
    e.titanHpText.textContent = titan.alive ? `${Math.ceil(titan.hp)} / ${this.cfg.titan.hp}` : '討伐完成';

    // 鋼索預測標記
    const pos = {};
    const showMark = (el, aim, label) => {
      if (!aim) {
        el.className = 'aim-mark none';
        el.style.left = el.style.top = '';
        return;
      }
      this.project(aim.point, camera, pos);
      if (pos.behind) {
        el.className = 'aim-mark none';
        return;
      }
      el.className = `aim-mark ok ${aim.object.userData.titanPart ? 'titan' : ''}`;
      el.style.left = `${pos.x}px`;
      el.style.top = `${pos.y}px`;
      if (label) el.dataset.label = label;
    };
    if (touchMode === 'smart') {
      showMark(e.mark.smart, aims.auto, smartSide === 'left' ? 'L' : 'R');
      e.mark.left.className = e.mark.right.className = 'aim-mark hidden';
    } else {
      showMark(e.mark.left, aims.left, 'L');
      showMark(e.mark.right, aims.right, 'R');
      e.mark.smart.className = 'aim-mark hidden';
    }

    // 準星：附近沒有可勾目標時變紅
    e.crosshair.classList.toggle('no-target', !(aims.auto || aims.left || aims.right));
    // 準星位置（手機準心搖桿）
    const rt = s.reticle || { x: 0, y: 0 };
    e.crosshair.style.left = `${(rt.x * 0.5 + 0.5) * 100}%`;
    e.crosshair.style.top = `${(-rt.y * 0.5 + 0.5) * 100}%`;

    // 弱點提示
    if (titan.alive) {
      this.project(napePos, camera, pos);
      const m = e.nape;
      const margin = 40;
      const onScreen = !pos.behind && pos.x > margin && pos.x < innerWidth - margin && pos.y > margin && pos.y < innerHeight - margin;
      const ev = strikeEval;
      const state = ev.ok ? 'ready' : ev.lunge ? 'lunge' : ev.dist < 40 ? 'near' : 'far';
      m.className = `nape ${state}`;
      e.napeDist.textContent = `${ev.dist.toFixed(0)}m`;
      if (onScreen) {
        m.style.left = `${pos.x}px`;
        m.style.top = `${pos.y}px`;
        e.napeArrow.hidden = true;
        m.hidden = false;
      } else {
        m.hidden = true;
        // 畫面外：邊緣箭頭指向弱點
        let dx = pos.x - innerWidth / 2;
        let dy = pos.y - innerHeight / 2;
        if (pos.behind) {
          dx = -dx;
          dy = -dy;
        }
        const ang = Math.atan2(dy, dx);
        const rx = innerWidth / 2 - 50, ry = innerHeight / 2 - 50;
        const t = Math.min(rx / Math.abs(Math.cos(ang) || 1e-6), ry / Math.abs(Math.sin(ang) || 1e-6));
        e.napeArrow.hidden = false;
        e.napeArrow.style.left = `${innerWidth / 2 + Math.cos(ang) * t}px`;
        e.napeArrow.style.top = `${innerHeight / 2 + Math.sin(ang) * t}px`;
        e.napeArrow.style.transform = `translate(-50%,-50%) rotate(${ang}rad)`;
        e.napeArrow.dataset.dist = `${ev.dist.toFixed(0)}m`;
      }
      // 斬擊條件
      const show = ev.dist < this.cfg.strike.lungeRange * 1.6;
      e.checks.hidden = !show;
      if (show) {
        e.chkDist.className = ev.inRange ? 'ok' : ev.lunge ? 'mid' : '';
        e.chkSpeed.className = ev.fastEnough ? 'ok' : '';
        e.chkAngle.className = ev.angleOk ? 'ok' : 'bad';
        e.chkDist.textContent = `距離 ${ev.dist.toFixed(1)}m`;
        e.chkSpeed.textContent = `速度 ${ev.speed.toFixed(0)}`;
        e.chkAngle.textContent = ev.angleOk ? '角度 後方' : '角度 正面✕';
      }
    } else {
      e.nape.hidden = true;
      e.napeArrow.hidden = true;
      e.checks.hidden = true;
    }

    // 速度暗角
    const v = Math.max(0, Math.min(1, (sp - 18) / 45));
    e.vignette.style.opacity = (v * 0.85).toFixed(3);
    e.hang.classList.toggle('on', pc.hangTimer > 0);

    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) e.toast.className = '';
    }
  }
}
