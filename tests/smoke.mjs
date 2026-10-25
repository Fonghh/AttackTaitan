// 煙霧測試：實際啟動遊戲（vite preview），在瀏覽器中驅動真實場景與物理，
// 跑一段「從塔頂起跳 → 勾索擺盪 → 放索 → 接近巨人 → 斬擊弱點 → 擊殺」的流程並截圖。
// 用法：npm run build && npm run smoke
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

// 優先用專案內的 playwright，否則用全域安裝（環境預裝的 Chromium）
async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    const root = execSync('npm root -g').toString().trim();
    return createRequire(`${root}/`)('playwright');
  }
}
const { chromium } = await loadPlaywright();
import { preview } from 'vite';
import { mkdirSync } from 'node:fs';

const OUT = 'tests/screenshots';
mkdirSync(OUT, { recursive: true });

// 用 Vite 的 JS API 開 preview server（port 0 = 自動挑空閒埠），結束時確實關閉
const server = await preview({ preview: { port: 0, host: '127.0.0.1' }, logLevel: 'silent' });
const URL_BASE = server.resolvedUrls.local[0];

const results = [];
const check = (name, ok, info = '') => {
  results.push({ name, ok, info });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  (${info})` : ''}`);
};

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  // ───────── 桌機 ─────────
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(URL_BASE);
  await page.waitForFunction(() => window.__game, null, { timeout: 20000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/01-start.png` });
  // 無頭瀏覽器的 pointer lock 會立刻失效並觸發暫停；測試中略過鎖定
  await page.evaluate(() => (window.__game.input.requestLock = () => {}));
  await page.click('#btn-start');
  await page.waitForTimeout(500);
  check('game enters playing state', await page.evaluate(() => window.__game.state === 'playing'));

  // 以固定步長直接驅動遊戲（不受無頭瀏覽器幀率影響）
  const sim = await page.evaluate(() => {
    const g = window.__game;
    g.renderer.setAnimationLoop(null);
    const base = () => ({ move: { x: 0, y: 0 }, boost: false, boostPressed: false, jump: false, jumpHeld: false, reel: 0, reelStrong: false, lookDX: 0, lookDY: 0, manualLook: false, events: [] });
    const dt = 1 / 60;
    const log = { maxSpeed: 0, attached: false, swingMaxLen: 0, ropeViolation: 0, released: false, flingY: 0, hung: false, landedSlide: false };
    const step = (it = base()) => {
      for (const e of it.events) g._handleEvent(e);
      g.step(dt, it);
      log.maxSpeed = Math.max(log.maxSpeed, g.pc.speed);
      for (const s of ['left', 'right']) {
        const h = g.pc.hooks[s];
        if (h.attached) {
          const a = h.anchor(new g.pc.pos.constructor());
          const d = a.distanceTo(g.pc.pos);
          log.ropeViolation = Math.max(log.ropeViolation, d - h.length);
        }
      }
      if (g.pc.hangTimer > 0) log.hung = true;
    };
    // 1) 往巨人方向跑下塔頂
    for (let i = 0; i < 60; i++) step({ ...base(), move: { x: 0, y: 1 } });
    // 2) 視角略為朝上，射出鋼索
    // 往左看向街道，用左鋼索勾住街邊建築的側面 → 沿街擺盪（正面勾牆會直接撞上去）
    g.rig.pitch = 0.05;
    g.rig.yaw += 0.4;
    for (let i = 0; i < 3; i++) step();
    const aimBefore = !!g.aims.left;
    step({ ...base(), events: ['fireLeft'] });
    // 3) 擺盪直到往上甩，再放開
    let t = 0;
    let wasDown = false;
    while (t < 4) {
      step();
      t += dt;
      if (g.pc.anyAttached) log.attached = true;
      if (log.attached && g.pc.vel.y < -3) wasDown = true;
      if (log.attached && wasDown && g.pc.vel.y > 4) break;
    }
    const vyBefore = g.pc.vel.y;
    g.pc.releaseAll(); // 直接放開，量測放開瞬間的上甩加成
    log.released = !g.pc.anyAttached;
    log.flingY = g.pc.vel.y / Math.max(0.01, vyBefore);
    for (const e of g.pc.events.splice(0)) g._onPlayerEvent(e);
    const speedAfterRelease = g.pc.speed;
    for (let i = 0; i < 90; i++) step({ ...base(), boost: i < 40 });
    return { aimBefore, ...log, speedAfterRelease, pos: g.pc.pos.toArray().map((v) => +v.toFixed(1)) };
  });
  check('hook aim finds a target from the spawn tower', sim.aimBefore);
  check('rope attaches to a building', sim.attached);
  check('rope length constraint respected in real scene', sim.ropeViolation < 0.05, `max excess ${sim.ropeViolation.toFixed(3)}m`);
  check('swing + boost builds speed', sim.maxSpeed > 25, `max ${sim.maxSpeed.toFixed(1)} m/s`);
  check('release keeps momentum', sim.released && sim.speedAfterRelease > 10, `${sim.speedAfterRelease.toFixed(1)} m/s`);
  check('upward release bonus applied', sim.flingY > 1.1, `vy x${sim.flingY.toFixed(2)}`);
  check('apex hang triggered', sim.hung);

  await page.evaluate(() => window.__game.renderer.render(window.__game.scene, window.__game.camera));
  await page.screenshot({ path: `${OUT}/02-after-swing.png` });

  // 4) 高速從巨人背後接近並斬擊
  const fight = await page.evaluate(() => {
    const g = window.__game;
    const V = g.pc.pos.constructor;
    const base = () => ({ move: { x: 0, y: 0 }, boost: false, boostPressed: false, jump: false, jumpHeld: false, reel: 0, reelStrong: false, lookDX: 0, lookDY: 0, manualLook: false, events: [] });
    const dt = 1 / 60;
    const out = { hits: [], frontBlocked: null, lungeHit: null };
    g.titan.attackCooldown = 99;
    const placeBehind = (dist, speed, height = 1) => {
      const nape = g.titan.napeWorld(new V());
      const f = g.titan.forward;
      g.pc.releaseAll();
      g.pc.pos.set(nape.x - f.x * dist, nape.y + height, nape.z - f.z * dist);
      g.pc.vel.set(f.x * speed, 0, f.z * speed);
      g.rig.yaw = Math.atan2(-f.x, -f.z);
      g.rig.pitch = -0.05;
    };
    // 正面攻擊應無效
    const nape0 = g.titan.napeWorld(new V());
    const f0 = g.titan.forward.clone();
    g.pc.pos.set(nape0.x + f0.x * 5, nape0.y, nape0.z + f0.z * 5);
    g.pc.vel.set(-f0.x * 30, 0, -f0.z * 30);
    const hp0 = g.titan.hp;
    g.strikeCooldown = 0;
    g._strike();
    out.frontBlocked = g.titan.hp >= hp0 - g.cfg.strike.bodyDamage;
    // 衝刺斬：12m 外、速度不足
    placeBehind(12, 12, 1.5);
    g.strikeCooldown = 0;
    const hp1 = g.titan.hp;
    g.step(dt, base());
    g._strike();
    const lunging = !!g.pc.lunge;
    for (let i = 0; i < 40; i++) g.step(dt, base());
    out.lungeHit = { lunging, dmg: hp1 - g.titan.hp };
    // 直接高速斬擊直到擊殺
    let guard = 0;
    while (g.titan.alive && guard++ < 6) {
      for (let i = 0; i < 80; i++) g.step(dt, base());
      placeBehind(4, 40, 0.5);
      g.strikeCooldown = 0;
      const before = g.titan.hp;
      g.step(dt, base());
      g._strike();
      out.hits.push(+(before - g.titan.hp).toFixed(0));
    }
    out.alive = g.titan.alive;
    for (let i = 0; i < 240; i++) g.step(dt, base());
    out.state = g.state;
    out.titanState = g.titan.state;
    return out;
  });
  check('frontal strike does not hit the weak point', fight.frontBlocked);
  check('lunge strike triggers and damages', fight.lungeHit.lunging && fight.lungeHit.dmg > 0, `dmg ${fight.lungeHit.dmg}`);
  check('high-speed nape strikes kill the titan', !fight.alive, `hits ${fight.hits.join(', ')}`);
  check('win screen shown', fight.state === 'won', `state ${fight.state}/${fight.titanState}`);
  await page.evaluate(() => window.__game.renderer.render(window.__game.scene, window.__game.camera));
  await page.screenshot({ path: `${OUT}/03-win.png` });

  // 5) 重新開始
  await page.click('#result [data-restart]');
  await page.waitForTimeout(200);
  const rs = await page.evaluate(() => ({ s: window.__game.state, hp: window.__game.titan.hp, y: window.__game.pc.pos.y }));
  check('restart resets titan and player', rs.s === 'playing' && rs.hp === 100 && rs.y > 42);

  // 6) 巨人揮擊會傷害玩家
  const hurt = await page.evaluate(() => {
    const g = window.__game;
    g.renderer.setAnimationLoop(null);
    const base = () => ({ move: { x: 0, y: 0 }, boost: false, boostPressed: false, jump: false, jumpHeld: false, reel: 0, reelStrong: false, lookDX: 0, lookDY: 0, manualLook: false, events: [] });
    const t = g.titan;
    t.attackCooldown = 0;
    let minHp = 100;
    for (let i = 0; i < 400; i++) {
      // 讓玩家停在巨人正前方、手的高度附近
      const f = t.forward;
      g.pc.pos.set(t.root.position.x + f.x * 7, 12, t.root.position.z + f.z * 7);
      g.pc.vel.set(0, 0, 0);
      g.step(1 / 60, base());
      minHp = Math.min(minHp, g.pc.hp);
    }
    return { minHp };
  });
  check('titan swipe can hurt the player', hurt.minHp < 100, `hp ${hurt.minHp}`);

  // 7) 實際渲染幾幀（動畫迴圈）並截一張飛行中畫面
  await page.evaluate(() => {
    const g = window.__game;
    g.restart(true);
    g.pc.pos.set(0, 40, 80);
    g.pc.vel.set(0, 2, -45);
    g.rig.yaw = 0;
    g.rig.pitch = -0.1;
    g.renderer.setAnimationLoop(() => g.frame());
  });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/04-speed.png` });
  check('no console/page errors (desktop)', errors.length === 0, errors.slice(0, 3).join(' | '));

  // ───────── 手機直立 ─────────
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const mp = await ctx.newPage();
  const merr = [];
  mp.on('pageerror', (e) => merr.push(e.message));
  await mp.goto(`${URL_BASE}?touch`);
  await mp.waitForFunction(() => window.__game, null, { timeout: 20000 });
  await mp.tap('#btn-start');
  await mp.waitForTimeout(600);
  const touchInfo = await mp.evaluate(() => {
    const g = window.__game;
    return { touch: g.touch, mode: g.touchUI.mode, smartVisible: !document.querySelector('.t-hook').hidden };
  });
  check('mobile: touch UI with smart hook button', touchInfo.touch && touchInfo.smartVisible);
  // 點鋼索鈕 → 應該發射
  await mp.evaluate(() => {
    window.__game.rig.pitch = 0.05;
  });
  await mp.waitForTimeout(300);
  const box = await mp.locator('.t-hook').boundingBox();
  await mp.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await mp.waitForTimeout(500);
  const fired = await mp.evaluate(() => {
    const h = window.__game.pc.hooks;
    return h.left.active || h.right.active;
  });
  check('mobile: tapping hook button fires a rope', fired);
  await mp.screenshot({ path: `${OUT}/05-mobile.png` });
  check('no page errors (mobile)', merr.length === 0, merr.slice(0, 3).join(' | '));
} finally {
  await browser.close();
  await server.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
