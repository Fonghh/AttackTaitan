// 程序化音效：全部用 WebAudio 即時合成，不需要音檔。
export class Audio {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  /** 必須在使用者手勢中呼叫 */
  init() {
    if (this.ctx) {
      this.ctx.resume?.();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = 0.7;
    this.master.connect(ctx.destination);

    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // 持續音：風聲（隨速度）、噴氣（加速時）、捲收（機械聲）
    this.wind = this._loop('lowpass', 400, 0.7);
    this.gas = this._loop('bandpass', 1800, 1.2);
    this.reel = this._loop('bandpass', 900, 8);
    this.reelOsc = ctx.createOscillator();
    this.reelOsc.type = 'sawtooth';
    this.reelOsc.frequency.value = 70;
    const rg = ctx.createGain();
    rg.gain.value = 0.15;
    this.reelOsc.connect(rg).connect(this.reel.gain);
    this.reelOsc.start();
  }

  _loop(type, freq, q) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(this.master);
    src.start();
    return { src, filter, gain };
  }

  _noiseBurst({ dur = 0.2, type = 'bandpass', f0 = 2000, f1 = 2000, q = 1, vol = 0.5, attack = 0.005 }) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  _tone({ dur = 0.2, type = 'sine', f0 = 440, f1 = 440, vol = 0.3, attack = 0.003 }) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  play(name, opts = {}) {
    if (!this.ctx || this.muted) return;
    switch (name) {
      case 'hookFire':
        this._noiseBurst({ dur: 0.18, f0: 5000, f1: 1500, q: 2, vol: 0.35 });
        this._tone({ dur: 0.06, type: 'square', f0: 900, f1: 300, vol: 0.08 });
        break;
      case 'hookAttach':
        this._tone({ dur: 0.25, type: 'triangle', f0: 1600, f1: 1400, vol: 0.18 });
        this._noiseBurst({ dur: 0.08, type: 'highpass', f0: 3000, f1: 3000, vol: 0.4 });
        break;
      case 'hookRelease':
        this._noiseBurst({ dur: 0.1, f0: 2500, f1: 4000, q: 3, vol: 0.15 });
        break;
      case 'boost':
        this._noiseBurst({ dur: 0.35, f0: 800, f1: 3000, q: 0.8, vol: 0.3 });
        break;
      case 'jump':
        this._noiseBurst({ dur: 0.12, type: 'lowpass', f0: 600, f1: 200, vol: 0.2 });
        break;
      case 'land':
        this._noiseBurst({ dur: 0.25, type: 'lowpass', f0: 500, f1: 120, vol: Math.min(0.6, 0.15 + (opts.speed || 0) / 60) });
        break;
      case 'slash':
        this._noiseBurst({ dur: 0.22, f0: 7000, f1: 1200, q: 1.5, vol: 0.45, attack: 0.01 });
        this._tone({ dur: 0.18, type: 'sawtooth', f0: 2400, f1: 900, vol: 0.05 });
        break;
      case 'hitNape':
        this._tone({ dur: 0.35, type: 'sine', f0: 140, f1: 45, vol: 0.7 });
        this._noiseBurst({ dur: 0.4, type: 'lowpass', f0: 3000, f1: 300, vol: 0.6 });
        this._tone({ dur: 0.5, type: 'triangle', f0: 2200, f1: 1800, vol: 0.12 });
        break;
      case 'hitBody':
        this._tone({ dur: 0.15, type: 'sine', f0: 200, f1: 80, vol: 0.35 });
        this._noiseBurst({ dur: 0.15, type: 'lowpass', f0: 1500, f1: 300, vol: 0.3 });
        break;
      case 'miss':
        this._noiseBurst({ dur: 0.15, f0: 4000, f1: 2000, q: 2, vol: 0.2 });
        break;
      case 'step':
        this._tone({ dur: 0.5, type: 'sine', f0: 70, f1: 32, vol: Math.min(0.6, opts.vol ?? 0.4) });
        this._noiseBurst({ dur: 0.3, type: 'lowpass', f0: 300, f1: 60, vol: Math.min(0.3, opts.vol ?? 0.2) });
        break;
      case 'windup':
        this._tone({ dur: 0.9, type: 'sawtooth', f0: 70, f1: 110, vol: 0.12, attack: 0.2 });
        break;
      case 'swing':
        this._noiseBurst({ dur: 0.5, type: 'lowpass', f0: 300, f1: 1400, q: 1, vol: 0.5, attack: 0.1 });
        break;
      case 'hurt':
        this._tone({ dur: 0.3, type: 'square', f0: 300, f1: 90, vol: 0.2 });
        this._noiseBurst({ dur: 0.3, type: 'lowpass', f0: 1200, f1: 200, vol: 0.5 });
        break;
      case 'kill':
        this._tone({ dur: 1.6, type: 'sine', f0: 90, f1: 30, vol: 0.6, attack: 0.05 });
        this._noiseBurst({ dur: 2.2, type: 'lowpass', f0: 800, f1: 100, vol: 0.5, attack: 0.1 });
        break;
      case 'win':
        [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this._tone({ dur: 0.5, type: 'triangle', f0: f, f1: f, vol: 0.15 }), i * 110));
        break;
      case 'fling':
        this._noiseBurst({ dur: 0.3, f0: 1200, f1: 3500, q: 1, vol: 0.18 });
        break;
      case 'ready':
        this._tone({ dur: 0.12, type: 'triangle', f0: 1320, f1: 1320, vol: 0.08 });
        break;
    }
  }

  /** 每幀更新持續音量 */
  update(speed, boosting, reeling, hooked) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const w = Math.min(1, Math.max(0, (speed - 5) / 60));
    this.wind.gain.gain.setTargetAtTime(this.muted ? 0 : w * w * 0.5, t, 0.1);
    this.wind.filter.frequency.setTargetAtTime(300 + w * 1500, t, 0.1);
    this.gas.gain.gain.setTargetAtTime(this.muted || !boosting ? 0 : 0.22, t, 0.04);
    const r = hooked && reeling > 0 ? 0.08 + reeling * 0.12 : 0;
    this.reel.gain.gain.setTargetAtTime(this.muted ? 0 : r, t, 0.05);
    this.reelOsc.frequency.setTargetAtTime(60 + reeling * 60, t, 0.1);
  }

  setMuted(m) {
    this.muted = m;
  }
}
