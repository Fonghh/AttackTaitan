// 陀螺儀瞄準（手機）：轉動手機＝轉動鏡頭，和搖桿、準心的轉動相加。
// 用 devicemotion 的角速度（rotationRate，度/秒）積分，不受指南針漂移影響。

const DEG = Math.PI / 180;

/**
 * 把裝置角速度換成鏡頭的 yaw／pitch 角速度（弧度/秒）。
 * 裝置座標：x 往右、y 往上（沿螢幕）、z 從螢幕指向使用者。
 * 直立時：繞 y 軸（gamma）＝左右轉、繞 x 軸（beta）＝上下仰。螢幕旋轉時依角度換軸。
 * @param {{alpha:number,beta:number,gamma:number}} rate 度/秒
 * @param {number} screenAngle 0 / 90 / 180 / 270（screen.orientation.angle）
 */
export function gyroToLook(rate, screenAngle = 0) {
  const bx = (rate.beta || 0) * DEG; // 繞裝置 x 軸
  const gy = (rate.gamma || 0) * DEG; // 繞裝置 y 軸
  const a = (((screenAngle % 360) + 360) % 360) * DEG;
  // 螢幕座標的軸＝裝置軸轉 -angle
  const c = Math.cos(a), s = Math.sin(a);
  const pitch = bx * c + gy * s;
  const yaw = -bx * s + gy * c;
  return { yaw, pitch };
}

export class Gyro {
  constructor() {
    this.available = typeof window !== 'undefined' && 'DeviceMotionEvent' in window;
    this.enabled = false;
    this.yaw = 0;
    this.pitch = 0;
    this.deadZone = 1.5 * DEG; // 小於每秒 1.5° 的抖動不算（避免手持時鏡頭飄）
    this._last = 0;
    this._on = (e) => this._onMotion(e);
  }

  /** 開啟（iOS 需要在點擊事件裡呼叫才能要到權限）。回傳是否成功 */
  async enable() {
    if (!this.available) return false;
    try {
      const DME = window.DeviceMotionEvent;
      if (DME && typeof DME.requestPermission === 'function') {
        const r = await DME.requestPermission();
        if (r !== 'granted') return false;
      }
    } catch {
      return false;
    }
    if (!this.enabled) addEventListener('devicemotion', this._on);
    this.enabled = true;
    this._last = 0;
    return true;
  }

  disable() {
    removeEventListener('devicemotion', this._on);
    this.enabled = false;
    this.yaw = this.pitch = 0;
  }

  _onMotion(e) {
    const r = e.rotationRate;
    if (!r) return;
    const now = performance.now();
    const dt = this._last ? Math.min(0.1, (now - this._last) / 1000) : 0;
    this._last = now;
    if (!dt) return;
    const angle = screen.orientation?.angle ?? window.orientation ?? 0;
    const l = gyroToLook(r, angle);
    if (Math.abs(l.yaw) > this.deadZone) this.yaw += l.yaw * dt;
    if (Math.abs(l.pitch) > this.deadZone) this.pitch += l.pitch * dt;
  }

  /** 取出累積的轉動量（弧度）並歸零 */
  take() {
    const out = { yaw: this.yaw, pitch: this.pitch };
    this.yaw = this.pitch = 0;
    return out;
  }
}
