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
  page.setDefaultTimeout(90000); // 軟體繪圖（swiftshader）第一次截圖可能要 30 秒左右
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  // 關卡選單
  await page.goto(URL_BASE);
  await page.waitForFunction(() => window.__game, null, { timeout: 20000 });
  const menu = await page.evaluate(() => {
    return [...document.querySelectorAll('#level-list .level-card')].map((b) => ({ name: b.querySelector('b').textContent, locked: b.disabled }));
  });
  check('[levels] menu lists 5 levels (controls tutorial first), all unlocked', menu.length === 5 && menu[0].name === '操作教學' && menu.every((m) => !m.locked), JSON.stringify(menu));
  await page.goto(`${URL_BASE}?level=city`);
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
    g.closeCam = false; // 這段測物理：用標準鏡頭距離，讓瞄準點固定（近距離鏡頭會讓射線起點不同）
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
  await page.evaluate(() => (window.__game.closeCam = true));
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

  // 4) 多巨人配置、部位斬擊、抓取、巨人優先瞄準、擊殺自動解鋼索
  const multi = await page.evaluate(() => {
    const g = window.__game;
    g.restart(true);
    g.renderer.setAnimationLoop(null);
    g.pc.speedScale = 1;
    const V = g.pc.pos.constructor;
    const ts = g.titans;
    const out = {};
    out.count = ts.length;
    out.outsidePlaza = ts.filter((t) => Math.hypot(t.root.position.x, t.root.position.z) > 60).length;
    let minPair = 1e9;
    for (let i = 0; i < ts.length; i++) for (let j = i + 1; j < ts.length; j++) minPair = Math.min(minPair, ts[i].root.position.distanceTo(ts[j].root.position));
    out.minPair = minPair;
    out.heights = ts.map((t) => Math.round(t.height));
    return out;
  });
  check('5 titans: some between buildings, a pair close together, varied sizes', multi.count === 5 && multi.outsidePlaza >= 3 && multi.minPair < 70 && Math.max(...multi.heights) >= 30, JSON.stringify(multi));
  // 巨人外觀各不相同；奇行種：狂奔 → 蹲低 → 飛撲（拋物線）→ 落地硬直；瓦斯軌跡線
  const looks = await page.evaluate(() => {
    const g = window.__game;
    const ls = g.titans.map((t) => `${t.look.body}/${t.look.face}/${t.look.hair}/${t.look.tint}`);
    const meshes = g.titans[0].root.children.length;
    let count = 0;
    g.titans[0].root.traverse((o) => o.isMesh && count++);
    return { distinct: new Set(ls).size, total: ls.length, meshesPerTitan: count };
  });
  check('titans look different from each other (body/face/hair/skin), parts merged for performance', looks.distinct === looks.total && looks.meshesPerTitan < 40, JSON.stringify(looks));
  const abn = await page.evaluate(() => {
    const g = window.__game;
    g.restart(true);
    g.renderer.setAnimationLoop(null);
    const base = () => ({ move: { x: 0, y: 0 }, boost: false, boostPressed: false, jump: false, jumpHeld: false, reel: 0, reelStrong: false, lookDX: 0, lookDY: 0, manualLook: false, events: [] });
    const t = g.titans.find((x) => x.kind === 'abnormal');
    for (const x of g.titans) x.attackCooldown = 99;
    t.attackCooldown = 0;
    const p = t.root.position;
    g.pc.pos.set(p.x + t.forward.x * 16 * t.scale, 0.6, p.z + t.forward.z * 16 * t.scale); // 在牠的地盤內
    g.pc.vel.set(0, 0, 0);
    const states = [];
    let maxY = 0;
    const hp0 = g.pc.hp;
    for (let i = 0; i < 200; i++) {
      g.step(1 / 60, base());
      if (states[states.length - 1] !== t.state) states.push(t.state);
      maxY = Math.max(maxY, p.y);
    }
    const home = Math.hypot(p.x - t.spawn.x, p.z - t.spawn.z) <= t.spawn.homeRadius * g.cfg.titan.abnormal.homeFactor + 0.01;
    return { name: t.name, states, maxY: +maxY.toFixed(1), hurt: hp0 - g.pc.hp, home };
  });
  check('abnormal titan crouches, pounces in an arc at the player, hits a player who stays put, lands inside its territory (staggered)', abn.states.includes('pounceWindup') && abn.states.includes('leap') && abn.states.includes('landed') && abn.maxY > 5 && abn.hurt > 0 && abn.home, JSON.stringify(abn));

  const parts = await page.evaluate(() => {
    const g = window.__game;
    const V = g.pc.pos.constructor;
    const base = () => ({ move: { x: 0, y: 0 }, boost: false, boostPressed: false, jump: false, jumpHeld: false, reel: 0, reelStrong: false, lookDX: 0, lookDY: 0, manualLook: false, events: [] });
    for (const t of g.titans) t.attackCooldown = 99;
    const t = g.titans[0];
    const out = {};
    // 砍腳：貼近腳踝、有速度
    g.step(1 / 60, base());
    const ank = t.ankleWorld('L', new V());
    g.pc.pos.set(ank.x + 2, ank.y + 1, ank.z + 2);
    g.pc.vel.set(-25, 0, -10);
    g.strikeCooldown = 0;
    g._strike();
    out.kneel = t.kneelTimer > 0;
    for (let i = 0; i < 60; i++) g.step(1 / 60, base());
    const nKneel = t.napeWorld(new V()).y;
    out.napeLowered = nKneel;
    // 砍眼睛：在臉前方
    const eye = t.eyeWorld(0, new V());
    g.pc.pos.set(eye.x + t.forward.x * 2.5, eye.y, eye.z + t.forward.z * 2.5);
    g.pc.vel.set(-t.forward.x * 25, 0, -t.forward.z * 25);
    g.strikeCooldown = 0;
    g._strike();
    out.stun = t.stunTimer > 0;
    // 正面砍後頸：不會造成後頸傷害
    const hits0 = g.stats.napeHits;
    const n0 = t.napeWorld(new V());
    g.pc.pos.set(n0.x + t.forward.x * 5, n0.y + 2, n0.z + t.forward.z * 5);
    g.pc.vel.set(-t.forward.x * 30, 0, -t.forward.z * 30);
    g.strikeCooldown = 0;
    g._strike();
    out.frontNoNape = g.stats.napeHits === hits0;
    return out;
  });
  check('cutting the ankle makes the titan kneel', parts.kneel, JSON.stringify(parts));
  const slide = await page.evaluate(() => {
    const g = window.__game;
    const V = g.pc.pos.constructor;
    const base = () => ({ move: { x: 0, y: 0 }, boost: false, boostPressed: false, jump: false, jumpHeld: false, reel: 0, reelStrong: false, lookDX: 0, lookDY: 0, manualLook: false, events: [] });
    const t = g.titans[2];
    for (const x of g.titans) x.attackCooldown = 99;
    t.kneelTimer = 0;
    t.stunTimer = 0;
    g.step(1 / 60, base());
    // 站在巨人正前方、腳邊的地面上，慢慢走（不需要速度）
    const ank = t.ankleWorld('R', new V());
    g.pc.pos.set(ank.x + t.forward.x * 3, 0.6, ank.z + t.forward.z * 3);
    g.pc.vel.set(0, 0, 0);
    g.step(1 / 60, base());
    g.strikeCooldown = 0;
    g._strike();
    const spin = g.model.spinTimer > 0;
    const kneel = t.kneelTimer > 0;
    let maxBehind = -1e9;
    for (let i = 0; i < 100; i++) {
      g.step(1 / 60, base());
      const rel = new V().subVectors(g.pc.pos, t.root.position);
      maxBehind = Math.max(maxBehind, -(rel.x * t.forward.x + rel.z * t.forward.z));
    }
    return { spin, kneel, behind: +maxBehind.toFixed(1), scale: t.scale };
  });
  check('ground spin slash at the ankle makes the titan kneel', slide.spin && slide.kneel, JSON.stringify(slide));
  check('after the leg cut the player slides through to behind the titan', slide.behind > 3 * slide.scale, JSON.stringify(slide));
  // 手機：空中推左搖桿左右 → 鏡頭跟著轉（鉤住時也一樣，不被「鏡頭跟隨人物」拉回去）
  const joyTurn = await page.evaluate(() => {
    const g = window.__game;
    g.restart(true);
    g.renderer.setAnimationLoop(null);
    const base = () => ({ move: { x: 0, y: 0 }, boost: false, boostPressed: false, jump: false, jumpHeld: false, reel: 0, reelStrong: false, lookDX: 0, lookDY: 0, manualLook: false, events: [] });
    const wasTouch = g.touch;
    g.touch = true;
    g.realDt = 1 / 60;
    g.pc.pos.y += 30; // 空中（地面上不轉）
    g.pc.vel.set(0, 0, 0);
    for (let i = 0; i < 5; i++) g.step(1 / 60, base());
    const y0 = g.rig.yaw;
    for (let i = 0; i < 60; i++) g.step(1 / 60, { ...base(), move: { x: 1, y: 0 } });
    const free = g.rig.yaw - y0;
    g._hookToggle('auto');
    for (let i = 0; i < 15; i++) g.step(1 / 60, base());
    const y1 = g.rig.yaw;
    for (let i = 0; i < 60; i++) g.step(1 / 60, { ...base(), move: { x: -1, y: 0 } });
    const hooked = g.rig.yaw - y1;
    g.touch = wasTouch;
    g.pc.releaseAll();
    return { free: +free.toFixed(2), hooked: +hooked.toFixed(2), attached: true };
  });
  check('[mobile] left stick turns the camera in the air (also while hooked)', joyTurn.free < -1.5 && joyTurn.hooked > 1.0, JSON.stringify(joyTurn));
  // 陀螺儀：累積的轉動量會轉動鏡頭
  const gyro = await page.evaluate(async () => {
    const g = window.__game;
    g.gyro.available = true; // 無頭瀏覽器：模擬已授權
    if (window.DeviceMotionEvent) window.DeviceMotionEvent.requestPermission = async () => 'granted';
    const ok = await g.gyro.enable();
    g.gyroLevel = 'mid';
    const y0 = g.rig.yaw, p0 = g.rig.pitch;
    g.gyro.yaw = 0.3;
    g.gyro.pitch = 0.1;
    g.frame();
    const out = { ok, dYaw: +(g.rig.yaw - y0).toFixed(3), dPitch: +(g.rig.pitch - p0).toFixed(3) };
    g.renderer.setAnimationLoop(null);
    g.gyro.disable();
    g.gyroLevel = 'off';
    return out;
  });
  check('[gyro] phone rotation turns the camera', gyro.ok && gyro.dYaw > 0.3 && gyro.dPitch > 0.1, JSON.stringify(gyro));
  // 兵長斬：勾在巨人後頸上 → 長按斬擊 → 短拍 → 沿鋼索迴旋直衝 → 命中後鋼索自動解除
  const levi = await page.evaluate(() => {
    const g = window.__game;
    const V = g.pc.pos.constructor;
    const base = () => ({ move: { x: 0, y: 0 }, boost: false, boostPressed: false, jump: false, jumpHeld: false, reel: 0, reelStrong: false, lookDX: 0, lookDY: 0, manualLook: false, events: [] });
    const t = g.titans[1];
    for (const x of g.titans) x.attackCooldown = 99;
    t.stunTimer = 5; // 不轉身
    g.step(1 / 60, base());
    const nape = t.napeWorld(new V());
    let mesh = null;
    t.root.traverse((o) => { if (!mesh && o.isMesh && o.userData.titanPart) mesh = o; });
    g.pc.pos.copy(nape).addScaledVector(t.forward, -22).setY(nape.y + 8);
    g.pc.vel.set(0, 0, 0);
    g.pc.fireHook('right', g.pc.pos.clone(), { point: nape.clone(), object: mesh });
    for (let i = 0; i < 30 && !g.pc.hooks.right.attached; i++) g.step(1 / 60, base());
    const hooked = g.pc.hooks.right.attached;
    const hp0 = t.hp;
    const evs = new Set();
    const orig = g._onPlayerEvent.bind(g);
    g._onPlayerEvent = (e) => (evs.add(e.type), orig(e));
    g._handleEvent('strike'); // 按住
    let windupSpeed = 99, frames = 0;
    while (frames < 200 && (g.strikeHold || g.pc.levi)) {
      g._updateStrikeHold(1 / 60);
      g.step(1 / 60, base());
      if (g.pc.levi && g.pc.levi.phase === 'windup' && g.pc.levi.t > 0.2) windupSpeed = Math.min(windupSpeed, g.pc.speed);
      frames++;
    }
    g._onPlayerEvent = orig;
    // 短按（勾住時）仍是一般斬擊
    return { hooked, dmg: hp0 - t.hp, released: !g.pc.anyAttached, events: [...evs], windupSpeed: +windupSpeed.toFixed(1), frames, aura: g.model.aura.material.opacity > 0 || true };
  });
  check('[levi] long-press strike while hooked: wind-up hover, spin-dash along the rope, hits, rope auto-releases', levi.hooked && levi.events.includes('leviWindup') && levi.events.includes('leviDash') && levi.dmg > 0 && levi.released && levi.windupSpeed < 8, JSON.stringify(levi));
  const tapHooked = await page.evaluate(() => {
    const g = window.__game;
    g.restart(true);
    g.renderer.setAnimationLoop(null);
    const base = () => ({ move: { x: 0, y: 0 }, boost: false, boostPressed: false, jump: false, jumpHeld: false, reel: 0, reelStrong: false, lookDX: 0, lookDY: 0, manualLook: false, events: [] });
    g._hookToggle('auto');
    for (let i = 0; i < 20; i++) g.step(1 / 60, base());
    const s0 = g.stats.strikes;
    g._handleEvent('strike');
    g._updateStrikeHold(0.05);
    g._handleEvent('strikeUp');
    return { attached: g.pc.anyAttached, strikes: g.stats.strikes - s0, levi: !!g.pc.levi };
  });
  check('[levi] short tap while hooked is still a normal strike', tapHooked.strikes === 1 && !tapHooked.levi, JSON.stringify(tapHooked));
  // 地面衝刺：滑鏟穿過巨人腳下，經過腳踝自動砍
  const gdash = await page.evaluate(() => {
    const g = window.__game;
    const V = g.pc.pos.constructor;
    const base = () => ({ move: { x: 0, y: 0 }, boost: false, boostPressed: false, jump: false, jumpHeld: false, reel: 0, reelStrong: false, lookDX: 0, lookDY: 0, manualLook: false, events: [] });
    g.pc.releaseAll();
    const t = g.titans[2];
    for (const x of g.titans) x.attackCooldown = 99;
    t.kneelTimer = 0;
    t.stunTimer = 5;
    g.step(1 / 60, base());
    const ank = t.ankleWorld('R', new V());
    g.pc.pos.set(ank.x + t.forward.x * 14, 0.6, ank.z + t.forward.z * 14);
    g.pc.vel.set(0, 0, 0);
    for (let i = 0; i < 5; i++) g.step(1 / 60, base());
    // 面向腳踝滑鏟
    g.rig.yaw = Math.atan2(-(ank.x - g.pc.pos.x), -(ank.z - g.pc.pos.z));
    g.strikeCooldown = 0;
    let maxY = 0;
    for (let i = 0; i < 60; i++) {
      g.step(1 / 60, { ...base(), move: { x: 0, y: 1 }, boost: true, boostPressed: i === 0 });
      maxY = Math.max(maxY, g.pc.pos.y);
    }
    for (let i = 0; i < 40; i++) g.step(1 / 60, base()); // 放開衝刺，滑鏟結束
    return { kneel: t.kneelTimer > 0, maxY: +maxY.toFixed(2), ended: g.pc.groundDashTimer <= 0 };
  });
  check('[ground dash] slide under the titan cuts the ankle automatically', gdash.kneel && gdash.maxY < 2 && gdash.ended, JSON.stringify(gdash));
  check('cutting the eye stuns the titan', parts.stun, JSON.stringify(parts));
  check('frontal strike does not hit the weak point', parts.frontNoNape);

  const grab = await page.evaluate(() => {
    const g = window.__game;
    const V = g.pc.pos.constructor;
    const base = () => ({ move: { x: 0, y: 0 }, boost: false, boostPressed: false, jump: false, jumpHeld: false, reel: 0, reelStrong: false, lookDX: 0, lookDY: 0, manualLook: false, events: [] });
    const t = g.titans[1];
    t.stunTimer = 0;
    t.kneelTimer = 0; // 前面的測試可能砍過它的腳
    t.setState('grabReach');
    for (let i = 0; i < 3; i++) {
      t.grabHandWorld(g.pc.pos);
      g.pc.vel.set(0, 0, 0);
      g.step(1 / 60, base());
    }
    const grabbed = !!g.grab;
    for (let i = 0; i < g.cfg.titan.grabEscapeTaps; i++) g._handleEvent('strike');
    for (let i = 0; i < 5; i++) g.step(1 / 60, base());
    return { grabbed, escaped: !g.grab && !t.holding, alive: t.alive, state: t.state, hp: t.hp };
  });
  check('titan can grab the player; mashing strike escapes', grab.grabbed && grab.escaped, JSON.stringify(grab));

  const prio = await page.evaluate(() => {
    const g = window.__game;
    const V = g.pc.pos.constructor;
    const base = () => ({ move: { x: 0, y: 0 }, boost: false, boostPressed: false, jump: false, jumpHeld: false, reel: 0, reelStrong: false, lookDX: 0, lookDY: 0, manualLook: false, events: [] });
    g.restart(true);
    g.renderer.setAnimationLoop(null);
    for (const t of g.titans) t.attackCooldown = 99;
    const t = g.titans[0];
    g.step(1 / 60, base());
    // 站在巨人前方 45m 的空中，準星對準巨人身體旁邊 3°（縫隙、後面是建築）
    const c = t.chest.getWorldPosition(new V());
    g.pc.pos.set(c.x + t.forward.x * 45, c.y, c.z + t.forward.z * 45);
    g.pc.vel.set(0, 0, 0);
    const dx = c.x - g.pc.pos.x, dz = c.z - g.pc.pos.z;
    g.rig.yaw = Math.atan2(-dx, -dz) + (5 * Math.PI) / 180;
    g.rig.pitch = 0.05;
    for (let i = 0; i < 15; i++) g.step(1 / 60, base());
    const a = g.aims.auto;
    return { titan: !!(a && a.object.userData.titan), what: a ? (a.object.userData.titan ? 'titan' : 'building') : 'none' };
  });
  check('aiming near a titan in front of buildings hooks the titan first', prio.titan, prio.what);

  const kill = await page.evaluate(() => {
    const g = window.__game;
    const V = g.pc.pos.constructor;
    const base = () => ({ move: { x: 0, y: 0 }, boost: false, boostPressed: false, jump: false, jumpHeld: false, reel: 0, reelStrong: false, lookDX: 0, lookDY: 0, manualLook: false, events: [] });
    const t = g.titans[0];
    // 勾在巨人身上，然後擊殺
    g._hookToggle('auto');
    for (let i = 0; i < 20; i++) g.step(1 / 60, base());
    const hookedBefore = g._hookedTitan() === t;
    t.takeHit(999, true);
    g._onKill(t);
    const ropeGone = !g.pc.anyAttached;
    for (let i = 0; i < 60; i++) g.step(1 / 60, base());
    const noHook = t.root.children[0] && (() => { let ok = true; t.root.traverse((o) => { if (o.isMesh && !o.userData.noHook) ok = false; }); return ok; })();
    const noCollide = t.spheres.every((s) => s.r === 0);
    // 等屍體淡出（倒下 2.2 秒 + 躺著 3 秒 + 淡出 2 秒）
    for (let i = 0; i < 540; i++) g.step(1 / 60, base());
    return { hookedBefore, ropeGone, noHook, noCollide, gone: t.gone };
  });
  check('killing a titan auto-releases the rope attached to it', kill.hookedBefore && kill.ropeGone, JSON.stringify(kill));
  check('dead titan cannot be hooked, has no collision, and fades away', kill.noHook && kill.noCollide && kill.gone, JSON.stringify(kill));

  // 高速從背後斬擊：依序討伐全部巨人 → 勝利
  const fight = await page.evaluate(() => {
    const g = window.__game;
    const V = g.pc.pos.constructor;
    const base = () => ({ move: { x: 0, y: 0 }, boost: false, boostPressed: false, jump: false, jumpHeld: false, reel: 0, reelStrong: false, lookDX: 0, lookDY: 0, manualLook: false, events: [] });
    const dt = 1 / 60;
    const out = { hits: [], lungeHit: null };
    const placeBehind = (t, dist, speed, height = 1) => {
      const nape = t.napeWorld(new V());
      const f = t.forward;
      g.pc.releaseAll();
      g.pc.pos.set(nape.x - f.x * dist, nape.y + height, nape.z - f.z * dist);
      g.pc.vel.set(f.x * speed, 0, f.z * speed);
      g.rig.yaw = Math.atan2(-f.x, -f.z);
      g.rig.pitch = -0.05;
    };
    // 衝刺斬：12m 外、速度不足
    const t1 = g.titans[1];
    for (const t of g.titans) t.attackCooldown = 99;
    t1.stunTimer = 0;
    t1.kneelTimer = 0;
    g.step(dt, base());
    placeBehind(t1, 12, 12, 1.5);
    g.strikeCooldown = 0;
    const hp1 = t1.hp;
    g.step(dt, base());
    g._strike();
    const lunging = !!g.pc.lunge;
    for (let i = 0; i < 40; i++) g.step(dt, base());
    out.lungeHit = { lunging, dmg: hp1 - t1.hp };
    for (const t of g.titans) {
      let guard = 0;
      while (t.alive && guard++ < 8) {
        for (const x of g.titans) x.attackCooldown = 99;
        for (let i = 0; i < 30; i++) g.step(dt, base());
        placeBehind(t, 4, 40, 0.5);
        g.strikeCooldown = 0;
        const before = t.hp;
        g.step(dt, base());
        placeBehind(t, 4, 40, 0.5);
        g._strike();
        out.hits.push(+(before - t.hp).toFixed(0));
      }
    }
    out.alive = g.titans.filter((t) => t.alive).length;
    for (let i = 0; i < 240; i++) g.step(dt, base());
    out.state = g.state;
    return out;
  });
  check('lunge strike triggers and damages', fight.lungeHit.lunging && fight.lungeHit.dmg > 0, `dmg ${fight.lungeHit.dmg}`);
  check('high-speed nape strikes kill all titans', fight.alive === 0, `hits ${fight.hits.join(', ')}`);
  check('win screen shown after all titans are dead', fight.state === 'won', `state ${fight.state}`);
  await page.evaluate(() => window.__game.renderer.render(window.__game.scene, window.__game.camera));
  await page.screenshot({ path: `${OUT}/03-win.png` });

  // 5) 重新開始
  await page.click('#result [data-restart]');
  await page.waitForTimeout(200);
  const rs = await page.evaluate(() => ({ s: window.__game.state, hp: window.__game.titans.every((t) => t.hp === 100 && t.alive && !t.gone), y: window.__game.pc.pos.y }));
  check('restart resets titans and player', rs.s === 'playing' && rs.hp && rs.y > 42);

  // 6) 巨人揮擊會傷害玩家
  const hurt = await page.evaluate(() => {
    const g = window.__game;
    g.renderer.setAnimationLoop(null);
    const base = () => ({ move: { x: 0, y: 0 }, boost: false, boostPressed: false, jump: false, jumpHeld: false, reel: 0, reelStrong: false, lookDX: 0, lookDY: 0, manualLook: false, events: [] });
    const t = g.titans[0];
    t.attackCooldown = 0;
    const gc = g.cfg.titan.grabChance;
    g.cfg.titan.grabChance = 0; // 這裡只測揮擊（抓取另有測試）
    let minHp = 100;
    for (let i = 0; i < 400; i++) {
      // 讓玩家停在巨人正前方、手的高度附近
      const f = t.forward;
      g.pc.pos.set(t.root.position.x + f.x * 7, 12, t.root.position.z + f.z * 7);
      g.pc.vel.set(0, 0, 0);
      g.step(1 / 60, base());
      minHp = Math.min(minHp, g.pc.hp);
    }
    g.cfg.titan.grabChance = gc;
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
  // 其他關卡：訓練場、光圈競速、巨木森林
  const levelRun = async (id, fn) => {
    await page.goto(`${URL_BASE}?level=${id}`);
    await page.waitForFunction(() => window.__game, null, { timeout: 20000 });
    await page.evaluate(() => (window.__game.input.requestLock = () => {}));
    await page.click('#btn-start');
    return page.evaluate(fn);
  };
  const tutorial = await levelRun('controls', () => {
    const g = window.__game;
    g.renderer.setAnimationLoop(null);
    const base = () => ({ move: { x: 0, y: 0 }, boost: false, boostPressed: false, jump: false, jumpHeld: false, reel: 0, reelStrong: false, lookDX: 0, lookDY: 0, manualLook: false, events: [] });
    const first = g.hud.el.mission.textContent;
    // 走一段路（持續動作判定）
    g.pc.pos.set(12, 0.6, 30); // 柱子圈內的空地
    g.pc.vel.set(0, 0, 0);
    for (let i = 0; i < 140; i++) g.step(1 / 60, { ...base(), move: { x: 0, y: 1 } });
    const afterMove = g.mission.current?.id;
    // 轉視角（持續動作判定）
    for (let i = 0; i < 30; i++) g.step(1 / 60, { ...base(), lookDX: 0.06, manualLook: true });
    const afterLook = g.mission.current?.id;
    for (const s of ['hook', 'release', 'aimFire', 'ropeFwd', 'ropeSide', 'dashHold', 'flip', 'groundDash', 'strike', 'pause']) g._missionEvent(s);
    for (let i = 0; i < 60; i++) g.step(1 / 60, base());
    return { first, afterMove, afterLook, state: g.state, next: document.getElementById('btn-next').textContent };
  });
  check('[tutorial] controls tutorial: walking and looking are detected, steps go in order, finishing leads to the training ground', tutorial.first.startsWith('教學 1/12') && tutorial.afterMove === 'look' && tutorial.afterLook === 'hook' && tutorial.state === 'won' && tutorial.next.includes('訓練場'), JSON.stringify(tutorial));
  const training = await levelRun('training', () => {
    const g = window.__game;
    g.renderer.setAnimationLoop(null);
    const base = () => ({ move: { x: 0, y: 0 }, boost: false, boostPressed: false, jump: false, jumpHeld: false, reel: 0, reelStrong: false, lookDX: 0, lookDY: 0, manualLook: false, events: [] });
    const dummy = g.titans[0];
    dummy.takeHit(999, true);
    const survived = dummy.alive && dummy.hp >= 1;
    for (let i = 0; i < 200; i++) g.step(1 / 60, base());
    const regen = dummy.hp === g.cfg.titan.hp;
    // 鎖定鏡頭＋側傾：勾在木人身上往側邊推 → 鏡頭鎖定、側傾；斬到後頸留下傷口
    const V = g.pc.pos.constructor;
    let mesh = null;
    dummy.root.traverse((o) => { if (!mesh && o.isMesh && o.userData.titanPart) mesh = o; });
    const nape = dummy.napeWorld(new V());
    g.pc.pos.set(nape.x + 30, nape.y + 4, nape.z + 15);
    g.pc.vel.set(0, 0, 0);
    g.pc.fireHook('right', g.pc.pos.clone(), { point: nape.clone(), object: mesh });
    for (let i = 0; i < 100; i++) g.step(1 / 60, { ...base(), move: { x: 1, y: 0 } });
    const cam = { locked: g.rig.locked, roll: +g.rig.roll.toFixed(3) };
    const ev = g._evaluate();
    ev.damage = 40;
    g._napeHit(ev, false);
    cam.wounds = dummy.wounds.length;
    g.pc.releaseAll();
    const texts = [g.hud.el.mission.textContent];
    for (const s of ['hook', 'fling', 'dash', 'leg', 'nape', 'levi']) g._missionEvent(s);
    texts.push(g.hud.el.mission.textContent);
    for (let i = 0; i < 60; i++) g.step(1 / 60, base());
    return { cam, survived, regen, texts, state: g.state, title: document.getElementById('result-title').textContent, stars: document.querySelector('.result-stars')?.textContent, next: !document.getElementById('btn-next').hidden };
  });
  check('[training] wooden dummies never die and heal back', training.survived && training.regen, JSON.stringify(training));
  check('[camera] hooked on a titan: camera locks on and banks into the orbit; hits leave wounds', training.cam.locked && Math.abs(training.cam.roll) > 0.05 && training.cam.wounds > 0, JSON.stringify(training.cam));
  check('[training] finishing all 6 steps completes the level, shows stars and unlocks the next level', training.state === 'won' && /★/.test(training.stars || '') && training.next, JSON.stringify(training));
  const rings = await levelRun('rings', () => {
    const g = window.__game;
    g.renderer.setAnimationLoop(null);
    const base = () => ({ move: { x: 0, y: 0 }, boost: false, boostPressed: false, jump: false, jumpHeld: false, reel: 0, reelStrong: false, lookDX: 0, lookDY: 0, manualLook: false, events: [] });
    // 光圈不能和建築重疊（含半徑）
    const R = g.mission.ringRadius;
    let worst = 1e9;
    for (const r of g.mission.rings) {
      for (const c of g.city.colliders) {
        const dx = Math.max(c.min.x - r.x, 0, r.x - c.max.x), dy = Math.max(c.min.y - r.y, 0, r.y - c.max.y), dz = Math.max(c.min.z - r.z, 0, r.z - c.max.z);
        worst = Math.min(worst, Math.hypot(dx, dy, dz) - R);
      }
    }
    const marker = !document.getElementById('wp-marker').hidden || !document.getElementById('wp-arrow').hidden;
    // 依序把玩家放到每個光圈中心
    for (const r of g.mission.rings) {
      g.pc.pos.copy(r);
      g.pc.vel.set(0, 0, 0);
      g.step(1 / 60, base());
    }
    for (let i = 0; i < 60; i++) g.step(1 / 60, base());
    return { clearance: +worst.toFixed(1), marker, passed: g.mission.ringIndex, total: g.mission.rings.length, state: g.state, noTitans: document.body.classList.contains('no-titans') };
  });
  check('[rings] 12 rings, none overlapping buildings', rings.total === 12 && rings.clearance > 0.5, JSON.stringify(rings));
  check('[rings] passing every ring in order finishes the course', rings.passed === 12 && rings.state === 'won' && rings.noTitans, JSON.stringify(rings));
  const forest = await levelRun('forest', () => {
    const g = window.__game;
    g.renderer.setAnimationLoop(null);
    const base = () => ({ move: { x: 0, y: 0 }, boost: false, boostPressed: false, jump: false, jumpHeld: false, reel: 0, reelStrong: false, lookDX: 0, lookDY: 0, manualLook: false, events: [] });
    for (let i = 0; i < 30; i++) g.step(1 / 60, base());
    const trees = g.city.hookables.filter((m) => m.geometry.type === 'CylinderGeometry' && m.userData.building).length;
    const crowns = g.city.hookables.filter((m) => m.geometry.type === 'IcosahedronGeometry').length;
    const inside = g.titans.filter((t) => g.city.colliders.some((c) => c.min.y < t.height && t.root.position.x > c.min.x && t.root.position.x < c.max.x && t.root.position.z > c.min.z && t.root.position.z < c.max.z)).length;
    const aim = !!g.aims.auto;
    return { trees, crowns, titans: g.titans.length, inside, aim, y: +g.pc.pos.y.toFixed(1) };
  });
  check('[forest] giant trees (trunks and leafy crowns) to hook, 4 titans in clearings, spawn on the platform', forest.trees > 40 && forest.crowns === forest.trees && forest.titans === 4 && forest.inside === 0 && forest.y > 40 && forest.aim, JSON.stringify(forest));

  check('no console/page errors (desktop)', errors.length === 0, errors.slice(0, 3).join(' | '));
  await page.close(); // 關掉桌機頁面，避免背景持續渲染拖慢手機測試

  // ───────── 手機直立 ─────────
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const mp = await ctx.newPage();
  mp.setDefaultTimeout(90000);
  const merr = [];
  mp.on('pageerror', (e) => merr.push(e.message));
  await mp.goto(`${URL_BASE}?touch&level=city`);
  await mp.waitForFunction(() => window.__game, null, { timeout: 60000 });
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
  const sloppyPre = await mp.evaluate(() => ({ aim: !!window.__game.aims.auto, state: window.__game.state, active: window.__game.pc.hooks.left.active || window.__game.pc.hooks.right.active, toast: document.getElementById('toast').textContent }));
  await mp.touchscreen.tap(cx, cy);
  await mp.waitForFunction(() => window.__game.pc.anyAttached, null, { timeout: 30000 }).catch(() => {});
  sloppyPre.afterTap = await mp.evaluate(() => ({ fired: window.__fired, att: window.__game.pc.anyAttached }));
  await mp.dispatchEvent('.t-hook', 'pointerdown', { pointerId: 9, isPrimary: true, clientX: cx, clientY: cy });
  await mp.dispatchEvent('.t-hook', 'pointermove', { pointerId: 9, isPrimary: true, clientX: cx + 18, clientY: cy - 18 });
  await mp.dispatchEvent('.t-hook', 'pointerup', { pointerId: 9, isPrimary: true, clientX: cx + 18, clientY: cy - 18 });
  await mp.waitForFunction(() => !window.__game.pc.anyAttached, null, { timeout: 10000 }).catch(() => {});
  const sloppy = await mp.evaluate(() => ({ fired: window.__fired, attached: window.__game.pc.anyAttached }));
  check('mobile: a slightly sloppy tap while hooked releases (no new hook fired)', sloppy.fired === 1 && !sloppy.attached, JSON.stringify({ ...sloppy, sloppyPre }));

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
  // 依新的兩段速度曲線，反推手指要拖多遠才會讓準心到 stick 的位置
  const RC = await mp.evaluate(() => window.__game.cfg.reticle);
  const m = Math.min(0.99, Math.hypot(stick.x, stick.y));
  const sens = await mp.evaluate(() => window.__game.touchUI.sens);
  const dist = (m <= RC.slowFrac ? RC.deadZone + (RC.slowEnd - RC.deadZone) * Math.pow(m / RC.slowFrac, 2 / 3) : RC.slowEnd + ((RC.fastEnd - RC.slowEnd) * (m - RC.slowFrac)) / (1 - RC.slowFrac)) / sens;
  const ux = stick.x / Math.hypot(stick.x, stick.y), uy = stick.y / Math.hypot(stick.x, stick.y);
  const fx = ux * dist, fy = -uy * dist;
  for (let i = 1; i <= 6; i++) await mp.dispatchEvent('.t-hook', 'pointermove', { pointerId: 7, isPrimary: true, clientX: cx + (fx * i) / 6, clientY: cy + (fy * i) / 6 });
  await mp.waitForTimeout(600);
  const mid = await mp.evaluate(() => {
    const ch = document.getElementById('crosshair').getBoundingClientRect();
    return { yaw: window.__game.rig.yaw, chX: ch.left + ch.width / 2, chY: ch.top + ch.height / 2, aim: !!window.__game.aims.auto };
  });
  await mp.dispatchEvent('.t-hook', 'pointerup', { pointerId: 7, isPrimary: true, clientX: cx + fx, clientY: cy + fy });
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
  // 準心推過邊緣 → 鏡頭轉；快速甩動 → 轉 90°
  await mp.evaluate(() => window.__game.restart(true));
  await mp.waitForTimeout(300);
  const hb2 = await mp.locator('.t-hook').boundingBox();
  const hx = hb2.x + hb2.width / 2, hy = hb2.y + hb2.height / 2;
  const yawA = await mp.evaluate(() => window.__game.rig.yaw);
  await mp.dispatchEvent('.t-hook', 'pointerdown', { pointerId: 11, isPrimary: true, clientX: hx, clientY: hy });
  for (let i = 1; i <= 5; i++) await mp.dispatchEvent('.t-hook', 'pointermove', { pointerId: 11, isPrimary: true, clientX: hx + i * 22, clientY: hy });
  await mp.waitForTimeout(800);
  const yawB = await mp.evaluate(() => window.__game.rig.yaw);
  await mp.dispatchEvent('.t-hook', 'pointerup', { pointerId: 11, isPrimary: true, clientX: hx + 110, clientY: hy });
  await mp.waitForTimeout(200);
  check('mobile: pushing the aim stick past the edge turns the camera (right = yaw decreases)', yawA - yawB > 0.3, `yaw ${yawA.toFixed(2)} → ${yawB.toFixed(2)}`);
  const room = await mp.evaluate(() => {
    const h = document.querySelector('.t-hook').getBoundingClientRect();
    const st = document.querySelector('.t-strike').getBoundingClientRect();
    const bo = document.querySelector('.t-boost').getBoundingClientRect();
    return { roomRight: innerWidth - (h.left + h.width / 2), between: h.left + h.width / 2 > st.left + st.width / 2 && h.left + h.width / 2 < bo.left + bo.width / 2 };
  });
  check('mobile: rope button sits above strike/dash with ~100px+ room to drag right', room.between && room.roomRight >= 100, JSON.stringify(room));
  // 無頭瀏覽器送觸控事件很慢（每次數百毫秒），測試時放寬甩動的時間門檻；判定邏輯另有單元測試
  await mp.waitForTimeout(1500); // 等前一個測試的發射處理完
  await mp.evaluate(() => {
    const g = window.__game;
    g.pc.releaseAll();
    g.touchUI.flickEnabled = true; // 預設關閉，這裡打開來測
    g.cfg.reticle.flick.maxMs = 10000;
    window.__evlog = [];
    g.input.__origPush = g.input.__origPush || g.input.push.bind(g.input);
    g.input.push = (e) => (window.__evlog.push(e), g.input.__origPush(e));
    window.__yawC = g.rig.yaw;
  });
  await mp.dispatchEvent('.t-hook', 'pointerdown', { pointerId: 12, isPrimary: true, clientX: hx, clientY: hy });
  await mp.dispatchEvent('.t-hook', 'pointermove', { pointerId: 12, isPrimary: true, clientX: hx - 40, clientY: hy + 3 });
  await mp.dispatchEvent('.t-hook', 'pointermove', { pointerId: 12, isPrimary: true, clientX: hx - 75, clientY: hy + 5 });
  await mp.dispatchEvent('.t-hook', 'pointerup', { pointerId: 12, isPrimary: true, clientX: hx - 75, clientY: hy + 5 });
  await mp.waitForFunction(() => !!window.__game.flickTurn, null, { timeout: 20000 }).catch(() => {});
  await mp.waitForFunction(() => !window.__game.flickTurn, null, { timeout: 20000 }).catch(() => {});
  const flick = await mp.evaluate(() => ({ dyaw: window.__game.rig.yaw - window.__yawC, events: window.__evlog.filter((e) => e !== 'reticleReset') }));
  await mp.evaluate(() => {
    const g = window.__game;
    g.cfg.reticle.flick.maxMs = 180;
    g.touchUI.flickEnabled = false;
    g.input.push = g.input.__origPush;
  });
  check('mobile: quick swipe on the rope button turns ~90° left without firing', Math.abs(flick.dyaw - Math.PI / 2) < 0.25 && flick.events.join() === 'flick:-1', JSON.stringify(flick));

  // 鋼索辨識：勾住後有光暈、勾點標記、準心旁「勾住」提示
  await mp.evaluate(() => window.__game.restart(true));
  await mp.evaluate(() => {
    const g = window.__game;
    g.rig.pitch = 0.35;
    g.rig.yaw -= 0.12;
  });
  await mp.waitForFunction(() => !!window.__game.aims.auto, null, { timeout: 30000 }).catch(() => {});
  await mp.evaluate(() => window.__game._hookToggle('auto'));
  await mp.waitForFunction(() => window.__game.pc.anyAttached, null, { timeout: 30000 }).catch(() => {});
  await mp.waitForTimeout(300);
  const rope = await mp.evaluate(() => {
    const g = window.__game;
    const side = g.pc.hooks.left.attached ? 'left' : 'right';
    const r = g.fx.ropes[side];
    return { glow: r.glow.visible, marker: r.marker.visible, status: document.getElementById('hook-status').textContent };
  });
  check('mobile: attached rope shows glow + anchor marker + "勾住" status', rope.glow && rope.marker && rope.status === '勾住', JSON.stringify(rope));
  await mp.screenshot({ path: `${OUT}/06-mobile-rope.png` });
  // 速度線設定：預設「中」，可切換到「關」
  const lines = await mp.evaluate(() => {
    const g = window.__game;
    const start = g.speedLineLevel;
    const seen = [];
    for (let i = 0; i < 4; i++) {
      document.getElementById('btn-lines').click();
      seen.push(g.speedLineLevel + ':' + g.fx.speedLines.level);
    }
    return { start, seen, flickDefault: g.touchUI.flickEnabled };
  });
  check('speed lines setting defaults to 中 and cycles 高/中/低/關; flick turn off by default', lines.start === 'mid' && lines.seen.includes('off:0') && lines.flickDefault === false, JSON.stringify(lines));

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
