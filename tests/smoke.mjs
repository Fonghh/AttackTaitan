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
    g.pc.speedScale = 1; // 物理測試固定用 100% 速度倍率
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
    // 擺盪模式：不調整視角，直接朝巨人方向按住鋼索（擺盪輔助會挑街邊高處的勾點）
    g.pc.ropeStyle = 'swing';
    g.rig.pitch = 0.05;
    for (let i = 0; i < 3; i++) step();
    const aimBefore = !!g.aims.auto;
    step({ ...base(), events: ['down:left'] });
    // 3) 擺盪直到往上甩，再放開
    let t = 0;
    let wasDown = false;
    let prevPos = g.pc.pos.clone();
    log.maxJump = 0;
    while (t < 4) {
      step();
      t += dt;
      log.maxJump = Math.max(log.maxJump, g.pc.pos.distanceTo(prevPos) - g.pc.speed * dt);
      prevPos = g.pc.pos.clone();
      if (g.pc.anyAttached) log.attached = true;
      if (log.attached && g.pc.vel.y < -3) wasDown = true;
      if (log.attached && wasDown && g.pc.vel.y > 3) break;
    }
    log.swingMinY = g.pc.pos.y;
    const vyBefore = g.pc.vel.y;
    g._hookToggle('auto'); // 再按一下＝放索
    log.released = !g.pc.anyAttached;
    log.flingY = g.pc.vel.y / Math.max(0.01, vyBefore);
    for (const e of g.pc.events.splice(0)) g._onPlayerEvent(e);
    const speedAfterRelease = g.pc.speed;
    // 4) 空中再勾第二次（連續擺盪）
    for (let i = 0; i < 20; i++) step();
    step({ ...base(), events: ['down:left'] });
    let swing2 = false;
    for (let i = 0; i < 90; i++) {
      step({ ...base(), boost: i < 40 });
      if (g.pc.anyAttached) swing2 = true;
    }
    step({ ...base(), events: ['up:left'] });
    for (let i = 0; i < 30; i++) step();
    return { aimBefore, ...log, swing2, speedAfterRelease, pos: g.pc.pos.toArray().map((v) => +v.toFixed(1)) };
  });
  check('[swing] hook aim finds a target from the spawn tower (default view)', sim.aimBefore);
  check('no teleport during swing', sim.maxJump < 0.3, `max extra move ${sim.maxJump.toFixed(2)}m/frame`);
  check('swing goes down then back up (real pendulum)', sim.attached && sim.swingMinY > 3, `release height ${sim.swingMinY.toFixed(1)}m`);
  check('second hook in mid-air attaches (chained swing)', sim.swing2);
  check('rope attaches to a building', sim.attached);
  check('rope length constraint respected in real scene', sim.ropeViolation < 0.05, `max excess ${sim.ropeViolation.toFixed(3)}m`);
  check('swing + boost builds speed', sim.maxSpeed > 28, `max ${sim.maxSpeed.toFixed(1)} m/s`);
  check('release keeps momentum', sim.released && sim.speedAfterRelease > 18, `${sim.speedAfterRelease.toFixed(1)} m/s`);
  check('upward release bonus applied', sim.flingY > 1.1, `vy x${sim.flingY.toFixed(2)}`);
  check('apex hang triggered', sim.hung);

  await page.evaluate(() => window.__game.renderer.render(window.__game.scene, window.__game.camera));
  await page.screenshot({ path: `${OUT}/02-after-swing.png` });

  // 拉索模式（預設）：勾住被拉過去 → 到勾點自動放開往上衝 → 翻過屋頂繼續往前飛
  const pull = await page.evaluate(() => {
    const g = window.__game;
    g.restart(true);
    g.renderer.setAnimationLoop(null);
    g.pc.ropeStyle = 'pull';
    g.pc.speedScale = 1;
    const base = () => ({ move: { x: 0, y: 0 }, boost: false, boostPressed: false, jump: false, jumpHeld: false, reel: 0, reelStrong: false, lookDX: 0, lookDY: 0, manualLook: false, events: [] });
    const run = (it) => { for (const e of it.events) g._handleEvent(e); g.step(1 / 60, it); };
    for (let i = 0; i < 50; i++) run({ ...base(), move: { x: 0, y: 1 } });
    g.rig.pitch = 0.35;
    g.rig.yaw -= 0.12;
    for (let i = 0; i < 3; i++) run(base());
    const anchorY = g.aims.auto && g.aims.auto.point.y;
    const ev = new Set();
    const orig = g._onPlayerEvent.bind(g);
    g._onPlayerEvent = (e) => (ev.add(e.type), orig(e));
    run({ ...base(), events: ['down:left'] });
    let maxPull = 0, maxY = 0, prev = g.pc.pos.clone(), maxJump = 0;
    const start = g.pc.pos.clone();
    let releasedAt = -1;
    for (let i = 0; i < 240; i++) {
      // 到達勾點附近時再按一下放索（鋼索不會自己斷）
      const evs = releasedAt < 0 && ev.has('arrive') ? ['down:left'] : [];
      if (evs.length) releasedAt = i;
      if (i === 200 && releasedAt < 0) ev.add('stillAttachedAt200:' + g.pc.anyAttached);
      run({ ...base(), events: evs });
      if (g.pc.anyAttached) maxPull = Math.max(maxPull, g.pc.speed);
      maxY = Math.max(maxY, g.pc.pos.y);
      maxJump = Math.max(maxJump, g.pc.pos.distanceTo(prev) - g.pc.speed / 60);
      prev = g.pc.pos.clone();
    }
    g._onPlayerEvent = orig;
    const travel = Math.hypot(g.pc.pos.x - start.x, g.pc.pos.z - start.z);
    return { anchorY, maxPull, maxY, maxJump, travel, events: [...ev], strikes: g.stats.strikes };
  });
  check('[pull] rope pulls the player toward the anchor (slower, controllable)', pull.maxPull > 28 && pull.maxPull < 55, `${pull.maxPull.toFixed(1)} m/s`);
  check('[pull] rope stays attached until tapped again; release launches upward', pull.events.includes('arrive') && pull.events.includes('fling'), pull.events.join(','));
  check('[pull] flies over the roof and keeps going', pull.events.includes('vault') && pull.maxY > pull.anchorY + 8 && pull.travel > 80, `peak ${pull.maxY.toFixed(0)}m (anchor ${pull.anchorY.toFixed(0)}m), travel ${pull.travel.toFixed(0)}m`);
  check('[pull] no teleport', pull.maxJump < 0.3, `${pull.maxJump.toFixed(2)}m`);
  // 衝刺（快速捲收）：勾住街邊大樓上緣後按住衝刺 → 衝過勾點往上飛，鋼索不斷
  const dash = await page.evaluate(() => {
    const g = window.__game;
    g.restart(true);
    g.renderer.setAnimationLoop(null);
    g.pc.speedScale = g.cfg.player.defaultSpeedScale;
    g.pc.dashScale = g.cfg.dash.defaultScale;
    const base = () => ({ move: { x: 0, y: 0 }, boost: false, boostPressed: false, jump: false, jumpHeld: false, reel: 0, reelStrong: false, lookDX: 0, lookDY: 0, manualLook: false, events: [] });
    const run = (it) => { for (const e of it.events) g._handleEvent(e); g.step(1 / 60, it); };
    for (let i = 0; i < 50; i++) run({ ...base(), move: { x: 0, y: 1 } });
    g.rig.pitch = 0.35;
    g.rig.yaw -= 0.12;
    for (let i = 0; i < 3; i++) run(base());
    const anchorY = g.aims.auto ? g.aims.auto.point.y : 0;
    run({ ...base(), events: ['down:left'] });
    for (let i = 0; i < 10; i++) run(base());
    const ev = new Set();
    const orig = g._onPlayerEvent.bind(g);
    g._onPlayerEvent = (e) => (ev.add(e.type), orig(e));
    let maxY = 0, maxSp = 0;
    for (let i = 0; i < 240; i++) {
      run({ ...base(), boost: true, boostPressed: i === 0 });
      maxY = Math.max(maxY, g.pc.pos.y);
      maxSp = Math.max(maxSp, g.pc.speed);
    }
    g._onPlayerEvent = orig;
    const out = { anchorY, maxY, maxSp, events: [...ev], attached: g.pc.anyAttached };
    g.pc.speedScale = 1;
    return out;
  });
  check('[dash] hold dash while hooked: fast reel, fly up past the anchor', dash.events.includes('dashArrive') && dash.maxY > dash.anchorY + 10, `peak ${dash.maxY.toFixed(0)}m (anchor ${dash.anchorY.toFixed(0)}m), max ${dash.maxSp.toFixed(0)} m/s, ${dash.events.join(',')}`);
  check('[dash] rope does not break after dashing past the anchor', dash.attached || dash.events.includes('vault'), `attached=${dash.attached}`);
  // 低速倍率（20%）：拉力仍拉得動（有下限），速度上限照比例降
  const slow = await page.evaluate(() => {
    const g = window.__game;
    g.restart(true);
    g.renderer.setAnimationLoop(null);
    g.pc.speedScale = 0.2;
    const base = () => ({ move: { x: 0, y: 0 }, boost: false, boostPressed: false, jump: false, jumpHeld: false, reel: 0, reelStrong: false, lookDX: 0, lookDY: 0, manualLook: false, events: [] });
    const run = (it) => { for (const e of it.events) g._handleEvent(e); g.step(1 / 60, it); };
    for (let i = 0; i < 50; i++) run({ ...base(), move: { x: 0, y: 1 } });
    g.rig.pitch = 0.35;
    g.rig.yaw -= 0.12;
    for (let i = 0; i < 3; i++) run(base());
    const anchor = g.aims.auto && g.aims.auto.point.clone();
    run({ ...base(), events: ['down:left'] });
    let maxSp = 0, minDist = 1e9;
    for (let i = 0; i < 900; i++) {
      run(base());
      maxSp = Math.max(maxSp, g.pc.speed);
      if (anchor) minDist = Math.min(minDist, g.pc.pos.distanceTo(anchor));
    }
    g.pc.speedScale = 1;
    return { maxSp, minDist };
  });
  check('slow speed (20%): rope still pulls the player up to the anchor', slow.minDist < 9 && slow.maxSp < 20, `closest ${slow.minDist.toFixed(1)}m, max ${slow.maxSp.toFixed(1)} m/s`);
  check('pressing the rope does not trigger a strike', pull.strikes === 0, `strikes=${pull.strikes}`);
  await page.evaluate(() => window.__game.renderer.render(window.__game.scene, window.__game.camera));
  await page.screenshot({ path: `${OUT}/02b-after-pull.png` });

  // 斬擊命中瞬間的特效截圖（頓點中）
  await page.evaluate(() => {
    const g = window.__game;
    g.restart(true);
    g.renderer.setAnimationLoop(null);
    g.pc.speedScale = 1;
    g.titan.attackCooldown = 99;
    const V = g.pc.pos.constructor;
    const base = () => ({ move: { x: 0, y: 0 }, boost: false, boostPressed: false, jump: false, jumpHeld: false, reel: 0, reelStrong: false, lookDX: 0, lookDY: 0, manualLook: false, events: [] });
    g.step(1 / 60, base());
    const n = g.titan.napeWorld(new V());
    const f = g.titan.forward;
    g.pc.pos.set(n.x - f.x * 9 + 2, n.y + 1, n.z - f.z * 9);
    g.pc.vel.set(f.x * 40, 0, f.z * 40);
    g.rig.yaw = Math.atan2(-f.x, -f.z);
    g.rig.pitch = -0.1;
    for (let i = 0; i < 4; i++) g.step(1 / 60, base());
    g.pc.pos.set(n.x - f.x * 4, n.y + 0.5, n.z - f.z * 4);
    g.strikeCooldown = 0;
    g._strike();
    for (let i = 0; i < 6; i++) g.frame();
    g.renderer.render(g.scene, g.camera);
    window.__hitInfo = { hitStop: g.hitStop, slowMo: g.slowMo, burst: g.burst };
  });
  await page.screenshot({ path: `${OUT}/03b-hit.png` });
  const hitInfo = await page.evaluate(() => window.__hitInfo);
  check('nape hit triggers hit-stop + slow motion + speed burst', hitInfo.slowMo > 0 && hitInfo.burst > 0.3, JSON.stringify(hitInfo));
  await page.evaluate(() => window.__game.restart(true));

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
    return { touch: g.touch, mode: g.hookMode, smartVisible: !document.querySelector('.t-hook').hidden };
  });
  check('mobile: touch UI with single hook button', touchInfo.touch && touchInfo.smartVisible);
  // 點一下鋼索鈕（沒勾住）→ 發射並保持勾住；再點一下 → 放開
  await mp.evaluate(() => {
    const g = window.__game;
    // 準星對準街邊大樓上緣（拉索模式是準星指哪勾哪）
    g.rig.pitch = 0.35;
    g.rig.yaw -= 0.12;
    window.__fired = 0;
    // 只包一層計數（避免前一段測試的包裝疊加）
    g.pc.__origFire = g.pc.__origFire || g.pc.fireHook.bind(g.pc);
    g.pc.fireHook = (...a) => (window.__fired++, g.pc.__origFire(...a));
  });
  await mp.waitForTimeout(300);
  const box = await mp.locator('.t-hook').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await mp.touchscreen.tap(cx, cy);
  // 無頭瀏覽器渲染很慢，用條件等待而不是固定時間
  await mp.waitForFunction(() => window.__game.pc.hooks.left.attachTime > 0.8 || window.__game.pc.hooks.right.attachTime > 0.8, null, { timeout: 30000 }).catch(() => {});
  const tap1 = await mp.evaluate(() => ({ fired: window.__fired, attached: window.__game.pc.anyAttached }));
  check('mobile: tap fires and the rope stays attached (toggle)', tap1.fired === 1 && tap1.attached, JSON.stringify(tap1));
  await mp.touchscreen.tap(cx, cy);
  await mp.waitForFunction(() => !window.__game.pc.anyAttached, null, { timeout: 10000 }).catch(() => {});
  const tap2 = await mp.evaluate(() => !window.__game.pc.anyAttached);
  check('mobile: second tap releases the rope', tap2);
  // 鉤住時「點一下但手指滑了一點」（25px、很快放開）→ 要算放索，不能射出新鉤子
  await mp.evaluate(() => window.__game.restart(true));
  await mp.waitForTimeout(300);
  await mp.evaluate(() => {
    const g = window.__game;
    g.rig.pitch = 0.35;
    g.rig.yaw -= 0.12;
    window.__fired = 0;
    g.pc.__origFire = g.pc.__origFire || g.pc.fireHook.bind(g.pc);
    g.pc.fireHook = (...a) => (window.__fired++, g.pc.__origFire(...a));
  });
  await mp.waitForFunction(() => !!window.__game.aims.auto, null, { timeout: 30000 }).catch(() => {});
  await mp.touchscreen.tap(cx, cy);
  await mp.waitForFunction(() => window.__game.pc.anyAttached, null, { timeout: 30000 }).catch(() => {});
  await mp.dispatchEvent('.t-hook', 'pointerdown', { pointerId: 9, isPrimary: true, clientX: cx, clientY: cy });
  await mp.dispatchEvent('.t-hook', 'pointermove', { pointerId: 9, isPrimary: true, clientX: cx + 18, clientY: cy - 18 });
  await mp.dispatchEvent('.t-hook', 'pointerup', { pointerId: 9, isPrimary: true, clientX: cx + 18, clientY: cy - 18 });
  await mp.waitForFunction(() => !window.__game.pc.anyAttached, null, { timeout: 10000 }).catch(() => {});
  const sloppy = await mp.evaluate(() => ({ fired: window.__fired, attached: window.__game.pc.anyAttached }));
  check('mobile: a slightly sloppy tap while hooked releases (no new hook fired)', sloppy.fired === 1 && !sloppy.attached, JSON.stringify(sloppy));

  // 鋼索鈕＝準心搖桿：拖曳時準心在畫面上移動（鏡頭不轉），放開 → 朝準心發射，準心回到中央
  await mp.evaluate(() => window.__game.restart(true));
  await mp.waitForTimeout(300);
  await mp.evaluate(() => {
    const g = window.__game;
    g.rig.pitch = 0.05;
    window.__fired = 0;
    // 只包一層計數（避免前一段測試的包裝疊加）
    g.pc.__origFire = g.pc.__origFire || g.pc.fireHook.bind(g.pc);
    g.pc.fireHook = (...a) => (window.__fired++, g.pc.__origFire(...a));
  });
  // 先找出準心推到哪個方向會對到建築（模擬玩家看著畫面把準心移到大樓上）
  const stick = await mp.evaluate(() => {
    const g = window.__game;
    for (const [x, y] of [[0.6, 0.2], [0.6, 0.4], [0.8, 0.3], [-0.6, 0.2], [-0.6, 0.4], [-0.8, 0.3], [0.4, 0.6], [-0.4, 0.6]]) {
      g.input.touch.aimX = x;
      g.input.touch.aimY = y;
      g._updateAims();
      if (g.aims.auto) return { x, y };
    }
    return { x: 0.6, y: 0.3 };
  });
  await mp.evaluate(() => (window.__game.input.touch.aimX = window.__game.input.touch.aimY = 0));
  const yaw0 = await mp.evaluate(() => window.__game.rig.yaw);
  await mp.dispatchEvent('.t-hook', 'pointerdown', { pointerId: 7, isPrimary: true, clientX: cx, clientY: cy });
  const R = 70;
  for (let i = 1; i <= 6; i++) await mp.dispatchEvent('.t-hook', 'pointermove', { pointerId: 7, isPrimary: true, clientX: cx + (stick.x * R * i) / 6, clientY: cy - (stick.y * R * i) / 6 });
  await mp.waitForTimeout(600);
  const mid = await mp.evaluate(() => {
    const ch = document.getElementById('crosshair').getBoundingClientRect();
    return { yaw: window.__game.rig.yaw, chX: ch.left + ch.width / 2, chY: ch.top + ch.height / 2, aim: !!window.__game.aims.auto };
  });
  await mp.dispatchEvent('.t-hook', 'pointerup', { pointerId: 7, isPrimary: true, clientX: cx + stick.x * R, clientY: cy - stick.y * R });
  await mp.waitForFunction(() => window.__fired > 0, null, { timeout: 30000 }).catch(() => {});
  await mp.waitForTimeout(400);
  const after = await mp.evaluate(() => ({ fired: window.__fired, aimX: window.__game.input.touch.aimX, rx: window.__game.reticle.x }));
  check('mobile: aim stick moves the crosshair on screen without turning the camera', Math.abs(mid.yaw - yaw0) < 0.02 && Math.hypot(mid.chX - 195, mid.chY - 422) > 60, `crosshair (${mid.chX.toFixed(0)}, ${mid.chY.toFixed(0)}), yaw ${yaw0.toFixed(2)}→${mid.yaw.toFixed(2)}`);
  check('mobile: releasing the aim stick fires at the crosshair and recenters it', after.fired === 1 && after.aimX === 0 && after.rx === 0, JSON.stringify(after) + ' target=' + mid.aim);
  // 鉤住時鏡頭轉向人物面朝方向
  await mp.waitForFunction(() => window.__game.pc.anyAttached, null, { timeout: 30000 }).catch(() => {});
  await mp.waitForFunction(() => {
    const g = window.__game;
    const d = Math.atan2(Math.sin(g.model.yaw - g.rig.yaw), Math.cos(g.model.yaw - g.rig.yaw));
    return g.pc.anyAttached && Math.abs(d) < 0.25 && Math.hypot(g.pc.vel.x, g.pc.vel.z) > 6;
  }, null, { timeout: 30000 }).then(() => true).catch(() => false).then((ok) => check('mobile: while hooked the camera turns to face where the character is heading', ok));
  // 準心吸附：把準心移到大樓轉角附近（偏 20px），應吸到轉角上
  const snap = await mp.evaluate(() => {
    const g = window.__game;
    g.pc.releaseAll();
    const W = innerWidth, H = innerHeight;
    const v = g.pc.pos.clone();
    for (const a of g.city.snapAnchors) {
      if (a.pos.distanceTo(g.pc.pos) > 70) continue;
      v.copy(a.pos).project(g.camera);
      if (Math.abs(v.x) > 0.6 || Math.abs(v.y) > 0.5 || v.z > 1) continue;
      const sx = (v.x * 0.5 + 0.5) * W + 20, sy = (-v.y * 0.5 + 0.5) * H;
      g.input.touch.aimX = (sx / W * 2 - 1) / g.cfg.reticle.rangeX;
      g.input.touch.aimY = -(sy / H * 2 - 1) / g.cfg.reticle.rangeY;
      g._updateAims();
      const aim = g.aims.auto;
      if (aim && aim.snapped) {
        g.input.touch.aimX = g.input.touch.aimY = 0;
        return { snapped: true, err: aim.point.distanceTo(a.pos).toFixed(2) };
      }
    }
    g.input.touch.aimX = g.input.touch.aimY = 0;
    return { snapped: false };
  });
  check('mobile: crosshair snaps to a nearby building corner/edge', snap.snapped, JSON.stringify(snap));
  const dashBtn = await mp.evaluate(() => document.querySelector('.t-boost').textContent.trim());
  check('mobile: boost button is now labelled 衝刺', dashBtn === '衝刺', dashBtn);
  // 速度倍率
  await mp.evaluate(() => window.__game.pause());
  await mp.tap('#spd-up');
  const spd = await mp.evaluate(() => ({ s: window.__game.pc.speedScale, label: document.getElementById('spd-val').textContent }));
  check('pause menu speed control (default 50%, step 10%)', spd.s === 0.6 && spd.label.includes('60'), JSON.stringify(spd));
  for (let i = 0; i < 8; i++) await mp.tap('#spd-down');
  const spdMin = await mp.evaluate(() => window.__game.pc.speedScale);
  check('speed can go down to 10%', spdMin === 0.1, String(spdMin));
  for (let i = 0; i < 4; i++) await mp.tap('#spd-up');
  await mp.tap('#dash-up');
  const dashCfg = await mp.evaluate(() => ({ s: window.__game.pc.dashScale, label: document.getElementById('dash-val').textContent }));
  check('pause menu dash speed control', dashCfg.s === 0.7 && dashCfg.label.includes('70%'), JSON.stringify(dashCfg));
  await mp.tap('#dash-down');
  await mp.tap('#spd-down');
  await mp.tap('#btn-resume');
  await mp.screenshot({ path: `${OUT}/05-mobile.png` });
  check('no page errors (mobile)', merr.length === 0, merr.slice(0, 3).join(' | '));
} finally {
  await browser.close();
  await server.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
